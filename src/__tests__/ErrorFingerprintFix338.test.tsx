import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import migrationSql from '../../migrations/fix_338_error_fingerprint_and_recurrence.sql?raw';
import {
  currentStatusOf,
  errorDiscriminator,
  errorFingerprintKey,
  listErrorGroups,
  normalizeErrorMessage,
  resolveGroup,
  summariseGroup,
  type ErrorOccurrence,
} from '../lib/errorGrouping';

// fix-338 — the error triage groups the wrong things together.
//
// ★★ THE INCIDENT. Two rows, both `TypeError: Failed to fetch`, both Miles,
// four hours apart on 2026-08-14 — one on /projects querying
// permit_cycle_reviewers (resolved), one on a project page querying
// notes/search-index (new). They shared fingerprint
// a52a318b357738475fcd8c38fa671cda, because bp_log_error hashed only the source
// and the normalised message. Resolving one silently resolved the other.
//
// ★ CI HAS NO DATABASE, so the rules are asserted three ways and each covers a
// different failure: a pure MIRROR carries the rule, assertions on the MIGRATION
// TEXT stop the SQL drifting away from the mirror, and a rolled-back PROD PROBE
// (recorded in the PR and the migration) proves the live functions actually
// behave this way. This is the fix-153 pattern.

const T = 'tenant-uuid';

// ===========================================================================
// ★★ 1. The fingerprint
// ===========================================================================

describe('fix-338 §1: the fingerprint separates different failures', () => {
  // ★★ THE REGRESSION TEST FOR THE INCIDENT — the exact pair, by name.
  it('★★ REGRESSION: the two 2026-08-14 "Failed to fetch" rows no longer share a fingerprint', () => {
    const a = errorFingerprintKey('backend_rpc', 'TypeError: Failed to fetch', {
      kind: 'query',
      queryKey: ['permit_cycle_reviewers', '00000000-0000-0000-0000-000000000001'],
    });
    const b = errorFingerprintKey('backend_rpc', 'TypeError: Failed to fetch', {
      kind: 'query',
      queryKey: ['notes', '00000000-0000-0000-0000-000000000001', 'search-index'],
    });
    expect(a).not.toBe(b);
    expect(a).toBe('backend_rpc|typeerror: failed to fetch|permit_cycle_reviewers');
    expect(b).toBe('backend_rpc|typeerror: failed to fetch|notes');
  });

  it('two occurrences of genuinely the same failure still share one fingerprint', () => {
    const one = errorFingerprintKey('backend_rpc', 'TypeError: Failed to fetch', {
      queryKey: ['notes', 't-1', 'search-index'],
    });
    // Same query, different project — still the same failure.
    const two = errorFingerprintKey('backend_rpc', 'TypeError: Failed to fetch', {
      queryKey: ['notes', 't-1', { projectId: 'p-2' }],
    });
    expect(one).toBe(two);
  });

  // ★★ THE OPPOSITE FAILURE, AND THE WORSE ONE. A fingerprint carrying a
  // project id makes every occurrence unique and hides frequency.
  it('★★ a project id in the query key does NOT split the group', () => {
    const p1 = errorFingerprintKey('backend_rpc', 'boom', {
      queryKey: ['project_messages', 't-1', 'aaaaaaaa-1111-2222-3333-444444444444'],
    });
    const p2 = errorFingerprintKey('backend_rpc', 'boom', {
      queryKey: ['project_messages', 't-1', 'bbbbbbbb-5555-6666-7777-888888888888'],
    });
    expect(p1).toBe(p2);
  });

  // ★ Or every existing group splits for no reason.
  it('★ a context-free error fingerprints exactly as it does today', () => {
    const before = 'scraper|scraper:seattle:bp — workflow extraction failed';
    expect(
      errorFingerprintKey(
        'scraper',
        'scraper:seattle:bp — workflow extraction failed',
        {},
      ),
    ).toBe(before);
    expect(
      errorFingerprintKey(
        'scraper',
        'scraper:seattle:bp — workflow extraction failed',
        undefined,
      ),
    ).toBe(before);
    // A context with no queryKey is the same case — 100 of the 116 production
    // rows are in exactly this shape.
    expect(
      errorFingerprintKey(
        'scraper',
        'scraper:seattle:bp — workflow extraction failed',
        { module: 'bp', juris: 'seattle', permit_num: 'BLD2026-0001' },
      ),
    ).toBe(before);
  });

  it('a malformed queryKey is ignored rather than guessed at', () => {
    const base = errorFingerprintKey('backend_rpc', 'boom', {});
    expect(errorFingerprintKey('backend_rpc', 'boom', { queryKey: 'notes' })).toBe(base);
    expect(errorFingerprintKey('backend_rpc', 'boom', { queryKey: [] })).toBe(base);
    expect(errorFingerprintKey('backend_rpc', 'boom', { queryKey: [{ a: 1 }] })).toBe(base);
    expect(errorFingerprintKey('backend_rpc', 'boom', { queryKey: ['   '] })).toBe(base);
  });

  it('the discriminator is only ever the first element', () => {
    expect(errorDiscriminator({ queryKey: ['Notes', 'x', 'y'] })).toBe('notes');
    expect(errorDiscriminator({ queryKey: ['permit_cycle_reviewers'] })).toBe(
      'permit_cycle_reviewers',
    );
    expect(errorDiscriminator({ kind: 'query' })).toBeNull();
  });

  // ★ The normalisation's intent — bounded values only — is what constrains the
  // context slice, so it is pinned here too.
  it('★ digit runs and timestamps are still normalised away', () => {
    expect(normalizeErrorMessage('failed at 2026-08-14T18:56:00Z for 7133442')).toBe(
      'failed at <ts> for <num>',
    );
    expect(
      normalizeErrorMessage('Cycle 1: resubmitted') ===
        normalizeErrorMessage('cycle 1: resubmitted'),
    ).toBe(true);
  });
});

// ===========================================================================
// ★ 2. Resolving one group must not resolve another
// ===========================================================================

describe('fix-338: resolving one group leaves the other alone', () => {
  function pair(): ErrorOccurrence[] {
    return [
      {
        id: 451,
        fingerprint: errorFingerprintKey('backend_rpc', 'TypeError: Failed to fetch', {
          queryKey: ['permit_cycle_reviewers', 't-1'],
        }),
        status: 'new',
        created_at: '2026-08-14T18:56:00Z',
        resolved_at: null,
      },
      {
        id: 452,
        fingerprint: errorFingerprintKey('backend_rpc', 'TypeError: Failed to fetch', {
          queryKey: ['notes', 't-1', 'search-index'],
        }),
        status: 'new',
        created_at: '2026-08-14T22:51:00Z',
        resolved_at: null,
      },
    ];
  }

  // ★★ THE DEFECT ITSELF. Before fix-338 both rows carried one fingerprint, so
  // this single call closed a failure nobody had ever looked at.
  it('★★ resolving the reviewers failure leaves the notes failure OPEN', () => {
    const rows = pair();
    expect(rows[0]!.fingerprint).not.toBe(rows[1]!.fingerprint);
    const after = resolveGroup(rows, rows[0]!.fingerprint);
    expect(after.find((o) => o.id === 451)!.status).toBe('resolved');
    expect(after.find((o) => o.id === 452)!.status).toBe('new');
  });

  it('★ and under the OLD one-fingerprint grouping it would have closed both', () => {
    // The pre-fix-338 formula, spelled out so the regression is visible rather
    // than implied.
    const oldFp = (msg: string) => `backend_rpc|${normalizeErrorMessage(msg)}`;
    const rows = pair().map((o) => ({
      ...o,
      fingerprint: oldFp('TypeError: Failed to fetch'),
    }));
    const after = resolveGroup(rows, rows[0]!.fingerprint);
    expect(after.every((o) => o.status === 'resolved')).toBe(true);
  });
});

// ===========================================================================
// ★★ 3. A group must show its recurrences
// ===========================================================================

describe('fix-338 §2: a group shows its recurrences', () => {
  const FP = 'fp-1';
  function recurring(): ErrorOccurrence[] {
    return [
      { id: 1, fingerprint: FP, status: 'resolved', created_at: '2026-08-14T18:56:00Z', resolved_at: '2026-08-15T09:00:00Z' },
      { id: 2, fingerprint: FP, status: 'new', created_at: '2026-08-16T22:51:00Z', resolved_at: null },
    ];
  }

  // ★★ THE FACT BOBBY WAS REACHING FOR — "I just felt like they were already
  // marked as resolved." He said it days before anybody looked, and he was right.
  it('★★ a group resolved and then recurring is visibly a recurrence', () => {
    const g = summariseGroup(recurring())!;
    expect(g.recurred).toBe(true);
    expect(g.status).toBe('new');
  });

  // ★ The count used to mean "occurrences still open" while the page rendered
  // it as "occurrences".
  it('★ and its count INCLUDES the resolved occurrences', () => {
    expect(summariseGroup(recurring())!.count).toBe(2);
    expect(summariseGroup(recurring())!.resolvedCount).toBe(1);
  });

  it('a group that has never been resolved is not a recurrence', () => {
    const g = summariseGroup([
      { id: 1, fingerprint: FP, status: 'new', created_at: '2026-08-14T00:00:00Z', resolved_at: null },
      { id: 2, fingerprint: FP, status: 'new', created_at: '2026-08-15T00:00:00Z', resolved_at: null },
    ])!;
    expect(g.recurred).toBe(false);
    expect(g.count).toBe(2);
  });

  it('a group that is resolved and has stayed resolved is not a recurrence', () => {
    const g = summariseGroup([
      { id: 1, fingerprint: FP, status: 'resolved', created_at: '2026-08-14T00:00:00Z', resolved_at: '2026-08-15T00:00:00Z' },
    ])!;
    expect(g.recurred).toBe(false);
  });

  // ★ Filter which GROUPS are shown; do not let the filter distort what a shown
  // group reports.
  it('★ the recurring group appears in the ACTIVE list, with its full count', () => {
    const active = listErrorGroups(recurring(), ['new', 'queued', 'in_progress']);
    expect(active).toHaveLength(1);
    expect(active[0]!.count).toBe(2);
  });

  it('★ a fully resolved group stays OUT of the default list', () => {
    const rows = resolveGroup(recurring(), FP);
    expect(listErrorGroups(rows, ['new', 'queued', 'in_progress'])).toEqual([]);
    expect(listErrorGroups(rows, ['resolved', 'dismissed'])).toHaveLength(1);
  });

  // ★★ THE TIE-BREAK A PROD PROBE CAUGHT BEFORE THIS SHIPPED. `now()` is
  // constant inside a transaction, so occurrences written together share a
  // created_at and ordering on it alone is arbitrary — a just-recurred group
  // reported itself resolved and vanished from the Active list.
  it('★★ occurrences with an identical created_at still resolve to the LATER one', () => {
    const same = '2026-08-16T00:00:00Z';
    const rows: ErrorOccurrence[] = [
      { id: 10, fingerprint: FP, status: 'resolved', created_at: same, resolved_at: same },
      { id: 11, fingerprint: FP, status: 'new', created_at: same, resolved_at: null },
    ];
    expect(currentStatusOf(rows)).toBe('new');
    // ...and the order they arrive in must not change the answer.
    expect(currentStatusOf([...rows].reverse())).toBe('new');
    expect(summariseGroup(rows)!.recurred).toBe(true);
  });
});

// ===========================================================================
// ★ The SQL must not drift away from the mirror
// ===========================================================================

/** The SQL with `--` comments removed, so prose describing a pattern is not
 *  mistaken for the pattern. Same trick fix-300b's ratchet uses. */
function executableSql(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

describe('fix-338: the migration matches the mirror', () => {
  it('★ the fingerprint takes only queryKey element 0', () => {
    expect(migrationSql).toMatch(
      /NULLIF\(btrim\(lower\(p_context -> 'queryKey' ->> 0\)\), ''\)/,
    );
    expect(migrationSql).toMatch(/jsonb_typeof\(p_context -> 'queryKey'\) = 'array'/);
  });

  // ★ A row with no discriminator must hash exactly as before, or every
  // existing group splits for nothing.
  it('★ a null discriminator appends nothing', () => {
    expect(migrationSql).toMatch(
      /p_source \|\| '\|' \|\| trim\(v_normalized\)\s*\n\s*\|\| COALESCE\('\|' \|\| v_discriminator, ''\)/,
    );
  });

  // ★★ No unbounded value may enter the fingerprint.
  it('★★ no id, timestamp, url or permit number reaches the fingerprint', () => {
    const fn = migrationSql.slice(
      migrationSql.indexOf('v_discriminator := CASE'),
      migrationSql.indexOf('IF v_user_id IS NOT NULL'),
    );
    for (const forbidden of ['permit_num', 'permit_id', 'project_id', 'url', 'traceback', 'created_at']) {
      expect(fn, `${forbidden} must not be in the fingerprint`).not.toContain(forbidden);
    }
  });

  // ★ The filter selects groups, not occurrences.
  it('★ the status filter is a HAVING on the group, not a WHERE on the rows', () => {
    const list = migrationSql.slice(migrationSql.indexOf('bp_list_error_groups'));
    expect(list).toMatch(/HAVING \(array_agg\(status ORDER BY created_at DESC, id DESC\)\)\[1\] = ANY\(p_status\)/);
    expect(list).not.toMatch(/AND status = ANY\(p_status\)/);
  });

  it('★ every ordered aggregate carries the id tie-break', () => {
    // ★ Comments stripped first — this file's own prose explains the bug by
    // quoting `ORDER BY created_at DESC`, and a guard that trips on the
    // explanation of the thing it guards is a guard nobody keeps.
    const list = executableSql(migrationSql).slice(
      executableSql(migrationSql).indexOf('bp_list_error_groups'),
    );
    const ordered = list.match(/ORDER BY created_at DESC[^)]*/g) ?? [];
    expect(ordered.length).toBeGreaterThan(0);
    for (const o of ordered) expect(o).toContain('id DESC');
  });

  it('the group reports resolved_count, last_resolved_at and recurred', () => {
    expect(migrationSql).toMatch(/AS resolved_count/);
    expect(migrationSql).toMatch(/AS last_resolved_at/);
    expect(migrationSql).toMatch(/AS recurred/);
  });

  // ★ The badge and the list must not disagree about the same group — the
  // defect fix-298 Phase 2 spent a ticket collapsing.
  it('★ the badge uses the same current-status rule as the list', () => {
    const badge = migrationSql.slice(migrationSql.indexOf('bp_new_error_count'));
    expect(badge).toMatch(/HAVING \(array_agg\(status ORDER BY created_at DESC, id DESC\)\)\[1\] = 'new'/);
  });

  // ★★ HISTORY IS NOT REWRITTEN — that is a write to existing rows and it is
  // Bobby's call. Nothing in this migration touches error_reports.
  it('★★ the migration writes to no existing row', () => {
    expect(migrationSql).not.toMatch(/UPDATE public\.error_reports/);
    expect(migrationSql).not.toMatch(/DELETE FROM public\.error_reports/);
    expect(migrationSql).not.toMatch(/INSERT INTO public\.error_reports\s*\(user_id[\s\S]{0,80}SELECT/);
  });
});

// ===========================================================================
// The page renders the recurrence
// ===========================================================================

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));
vi.mock('../lib/errorLogger', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import ErrorsPage from '../pages/Errors';

const RECURRED = {
  fingerprint: 'fp-recurred',
  source: 'backend_rpc',
  level: 'error',
  sample_message: 'TypeError: Failed to fetch',
  sample_context: { queryKey: ['notes', 't-1', 'search-index'] },
  status: 'new',
  first_seen: '2026-08-14T18:56:00Z',
  last_seen: '2026-08-16T22:51:00Z',
  count: 3,
  user_count: 1,
  resolved_count: 2,
  last_resolved_at: '2026-08-15T09:00:00Z',
  recurred: true,
  backlog_ref: null,
};

const FRESH = {
  ...RECURRED,
  fingerprint: 'fp-fresh',
  sample_message: 'Something new broke',
  count: 1,
  resolved_count: 0,
  last_resolved_at: null,
  recurred: false,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ErrorsPage />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [RECURRED, FRESH], error: null });
});

describe('fix-338: the page says a group came back', () => {
  it('★★ a recurred group carries a Recurred badge', async () => {
    renderPage();
    expect(
      await screen.findByTestId('error-group-recurred-fp-recurred'),
    ).toHaveTextContent('Recurred');
  });

  it('a group that has never been resolved carries no badge', async () => {
    renderPage();
    await screen.findByTestId('error-group-fp-fresh');
    expect(screen.queryByTestId('error-group-recurred-fp-fresh')).toBeNull();
  });

  // ★ The count is every occurrence now, so the split is shown rather than left
  // for somebody to wonder about.
  it('★ the count shows the resolved share', async () => {
    renderPage();
    const counts = await screen.findByTestId('error-group-counts-fp-recurred');
    expect(counts).toHaveTextContent('3×');
    expect(counts).toHaveTextContent('2 resolved');
  });

  it('a group with nothing resolved shows a plain count', async () => {
    renderPage();
    const counts = await screen.findByTestId('error-group-counts-fp-fresh');
    expect(counts).toHaveTextContent('1×');
    expect(counts).not.toHaveTextContent('resolved');
  });

  // ★ A bug report that omits "this was fixed once and came back" sends
  // somebody to re-do the same investigation.
  it('★ the copied bug report says it recurred', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    fireEvent.click(await screen.findByTestId('error-group-toggle-fp-recurred'));
    fireEvent.click(screen.getByTestId('error-group-copy-fp-recurred'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const report = writeText.mock.calls[0]![0] as string;
    expect(report).toMatch(/Recurred:\*\* yes/);
    expect(report).toContain('2 occurrence(s) already resolved');
  });
});
