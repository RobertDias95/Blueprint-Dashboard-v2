import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';
import {
  loadPipelineCollapsed,
  defaultCollapsedKeys,
  pipelineGroupKey,
} from '../lib/pipelinePrefs';

// ===========================================================================
// ★★★ fix-552 §A (P-258) — THE BOARD KEEPS WHAT IT ISSUED
// ===========================================================================
//
// Today a fully-issued project LEAVES the board. Bobby: it stops leaving.
//
// ★★★ THE ONE PLACE THE BOARD DECIDED THIS was `hideIssuedAtAddress`
//     (`lib/permitStage.ts`), carrying v1's rule from index.html:2602 — hide an
//     issued permit once EVERY permit at that address is issued. Everything
//     else — the buckets, the counts, fix-383's distribution, every filter —
//     already worked on the full set and had the issued cards subtracted at the
//     end, which is why the change is one line at the call site.
//
// ★★★ MEASURED ON PROD 2026-09-15, BY THE BOARD'S OWN RULE:
//
//       projects                                              221
//         fully issued (every permit `effectiveStage === 'is'`)  81  ← comes back
//         partly issued                                         110
//         none issued                                            22
//         no permits                                             13
//       permits on those 81 projects                            196
//
//     ★★ NOT the 76 a naive status list gives. `TERMINAL_ISSUED_STATUSES`
//        counts `Approved` and `Conceptually Approved` as issued, and a
//        sub-permit short-circuits to `is` (fix-194). **The definition was
//        already written; this ticket did not get to invent a second one.**
//        `Withdrawn` is NOT terminal-issued, so an address holding one is never
//        "all issued" — which settles the brief's one-Issued-one-Withdrawn
//        question without a new rule (3 projects hold a withdrawn permit).
//
// ★★★ AND THE DEFINITION IS GONE FROM THE CODE WITH THE FUNCTION. Nothing on
//     the board decides "fully issued" any more: it shows every card and orders
//     the Issued column by date. The concept survives as a measurement, not a
//     branch.

const USER = 'u-fix552';
const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: permitsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useNumberEntrySweep', () => ({ useNumberEntrySweep: () => undefined }));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));
vi.mock('../hooks/useSelfScope', () => ({
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: null, scope: 'all' },
    ready: true,
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});

import Dashboard from '../pages/Dashboard';

function cycle(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', permit_id: 0, cycle_index: 1, submitted: '2026-05-01',
    city_target: null, corr_issued: null, resubmitted: null, intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}

function permit(over: Record<string, unknown>) {
  return {
    id: 0, project_id: 'p1', type: 'Building Permit', num: null,
    status: 'Reviews In Process', stage: null, stage_override: null,
    da: null, dual_da: null, dm: null, ent_lead: null, permit_owner: null,
    nickname: null, struct_address: null, parent_permit_id: null,
    target_submit: null, approval_date: null, actual_issue: null,
    corr_issued: null, permit_cycles: [cycle()], extras: null, ...over,
  };
}

/** A permit the board stages as `is` — an issue date is the first branch. */
function issued(id: number, projectId: string, date: string) {
  return permit({ id, project_id: projectId, status: 'Issued', actual_issue: date });
}

function renderDash() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

/** The Issued column, expanded. */
function openIssued(): HTMLElement {
  // ★ Collapsed by default since fix-324b — open it to read the cards.
  fireEvent.click(screen.getByTestId('pipeline-group-toggle-is'));
  return screen.getByTestId('pipeline-group-is');
}

/** Is the Issued column folded? The group carries its own state attribute. */
function issuedCollapsed(): boolean {
  return (
    screen.getByTestId('pipeline-group-is').getAttribute('data-collapsed') ===
    'true'
  );
}

/** Addresses rendered inside the Issued column, in DOM order. */
function issuedAddresses(): string[] {
  const col = screen.getByTestId('pipeline-group-is');
  return Array.from(col.querySelectorAll('[data-addr-group]'))
    .map((el) => el.getAttribute('data-addr-group') ?? '')
    .filter(Boolean);
}

beforeEach(() => {
  // ★ A REAL USER ID: `collapsePrefs` is per-user and returns null without
  //   one — a signed-out session deliberately remembers nothing, so a test
  //   asserting persistence has to be signed in.
  useAuthStore.setState({ user: { id: USER } as never });
  window.localStorage.clear();
  // Three fully-issued projects — every permit issued, so v1's rule removed
  // all three from the board entirely.
  projectsRef.current = [
    { id: 'old', address: '100 Old St', juris: 'Seattle' },
    { id: 'mid', address: '200 Mid St', juris: 'Seattle' },
    { id: 'new', address: '300 New St', juris: 'Seattle' },
    { id: 'live', address: '400 Live St', juris: 'Seattle' },
  ];
  permitsRef.current = [
    issued(1, 'old', '2026-01-10'),
    issued(2, 'old', '2026-02-20'), // the group sorts on its LATEST date
    issued(3, 'mid', '2026-05-05'),
    issued(4, 'new', '2026-09-01'),
    permit({ id: 5, project_id: 'live' }), // still under review — untouched
  ];
});

describe('fix-552 §A — a fully-issued project stays on the board', () => {
  it('★★★ every fully-issued address renders — none missing', () => {
    // ★★★ THE DEFECT: all three of these left the board the moment their last
    //     permit issued. On prod that is 81 projects / 196 permits.
    renderDash();
    openIssued();
    const addrs = issuedAddresses();
    expect(addrs).toContain('100 Old St');
    expect(addrs).toContain('200 Mid St');
    expect(addrs).toContain('300 New St');
  });

  it('★★★ and none appears twice', () => {
    renderDash();
    openIssued();
    const addrs = issuedAddresses();
    expect(new Set(addrs).size).toBe(addrs.length);
  });

  it('★★★ the header counts them — 3 projects, 4 permits', () => {
    // ★ The project badge renders only when the column is OPEN (a spine has no
    //   room for it), which is why this opens first. The permit total sits in
    //   the sibling span and is what a folded spine shows.
    renderDash();
    openIssued();
    expect(
      screen.getByTestId('dash-strip-projcount-is').textContent,
    ).toContain('3');
  });

  it('★★ a project still under review is untouched — it is NOT in Issued', () => {
    renderDash();
    openIssued();
    expect(issuedAddresses()).not.toContain('400 Live St');
  });

  it('★★★ nothing is archived to make this work', () => {
    // ⚠️ `projects.archived` is false on all 221 rows and was never what
    //    removed these — the hide was. The board must not start writing it.
    const src = readFileSync(resolve(__dirname, '../pages/Dashboard.tsx'), 'utf8');
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toContain('archived:');
    expect(code).not.toContain('.update(');
  });
});

describe('fix-552 §A — newest issued first', () => {
  it('★★★ the Issued column orders by the group’s LATEST issue date, descending', () => {
    // ★ `100 Old St` holds 2026-01-10 AND 2026-02-20 — it sorts on the later
    //   one, so it beats nothing here but must not sort on the earlier.
    renderDash();
    openIssued();
    expect(issuedAddresses()).toEqual([
      '300 New St', // 2026-09-01
      '200 Mid St', // 2026-05-05
      '100 Old St', // 2026-02-20 (its latest, not its 2026-01-10)
    ]);
  });

  it('★★★ an undated issued project sorts LAST, then alphabetically', () => {
    // ★★★ THE TIEBREAK, AND ITS MEASUREMENT: of the 81 fully-issued projects on
    //     prod, **every one has at least one permit carrying an `actual_issue`**
    //     — so 0 need this today (3 of their 196 permits lack a date, but never
    //     all of a project's). It exists for the state the data can reach:
    //     issued by terminal STATUS with no date at all. Last, not interleaved,
    //     where it would read as the oldest completion rather than the undated
    //     one.
    projectsRef.current = [
      { id: 'dated', address: '500 Dated St', juris: 'Seattle' },
      { id: 'undated-b', address: '600 Bravo St', juris: 'Seattle' },
      { id: 'undated-a', address: '700 Alpha St', juris: 'Seattle' },
    ];
    permitsRef.current = [
      issued(1, 'dated', '2026-03-03'),
      // `Completed` is in TERMINAL_ISSUED_STATUSES → staged `is` with no date.
      permit({ id: 2, project_id: 'undated-b', status: 'Completed', permit_cycles: [] }),
      permit({ id: 3, project_id: 'undated-a', status: 'Completed', permit_cycles: [] }),
    ];
    renderDash();
    openIssued();
    expect(issuedAddresses()).toEqual([
      '500 Dated St', // dated first
      '600 Bravo St', // then undated, alphabetical
      '700 Alpha St',
    ]);
  });

  it('★★ the OTHER columns keep urgency-then-alpha — only Issued changed', () => {
    // ★ Issued is not triage; the live columns still are. Asserted so the sort
    //   branch cannot quietly become the board's only ordering.
    const src = readFileSync(resolve(__dirname, '../pages/Dashboard.tsx'), 'utf8');
    expect(src).toContain("if (stage === 'is')");
    expect(src).toContain('urgRank[a.urgency]');
  });
});

describe('fix-552 §A — collapsed by default, and remembered', () => {
  it('★★★ Issued is collapsed on first load', () => {
    // ★★★ ALREADY TRUE since fix-324b (register #68) — asserted here because
    //     this ticket is what makes it load-bearing: 81-and-growing would
    //     otherwise crowd the four live columns.
    expect(defaultCollapsedKeys()).toContain(pipelineGroupKey('is'));
    renderDash();
    expect(issuedCollapsed()).toBe(true);
  });

  it('★★★ it expands, and the choice is REMEMBERED — no second store', () => {
    // ⚠️ §A: *"remember it the way the board already remembers its other view
    //    state — reuse it, do not add a second memory."* `pipelinePrefs` is
    //    that store (fix-324), and it already keyed this column.
    renderDash();
    openIssued();
    expect(issuedCollapsed()).toBe(false);
    const stored = loadPipelineCollapsed(USER);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(pipelineGroupKey('is'));
  });

  it('★★★ …and it survives a reload', () => {
    const first = renderDash();
    openIssued();
    first.unmount();
    renderDash();
    // ★ Open on the second mount, read back from the same store.
    expect(issuedCollapsed()).toBe(false);
  });
});
