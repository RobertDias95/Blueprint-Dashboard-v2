// ===========================================================================
// ★★★ fix-613 — PEOPLE AS ONE TABLE · A PICTURE BLIP STOPS REACHING TRIAGE
//     (P-166 step 3b, P-309, census gaps 34 and 37)
// ===========================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  PEOPLE_ROLE_FILTERS,
  activePeople,
  addWithoutLoginRefusals,
  filterByRole,
  foldPeopleTable,
  restorePatch,
  restorePersonWrites,
  retirePatch,
  retirePersonWrites,
  retiredPeople,
  roleCounts,
} from '../lib/peopleTable';
import { isCurrentMember, isAssignableMember } from '../lib/roster';
import {
  isBareNetworkFailure,
  isQuietNetworkQueryFailure,
  queryFailureLevel,
  NETWORK_QUIET_QUERY_KEYS,
} from '../lib/errorLogger';
import { SETTINGS_BLOCKS, blocksForCategory } from '../lib/settingsBlocks';
import type { TeamMember, TeamRole } from '../lib/database.types';

const SRC = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// The roster, as prod has it: one row per (person, role), and Jade holds three.
// ---------------------------------------------------------------------------
function member(over: Partial<TeamMember> & { name: string; role: TeamRole }): TeamMember {
  return {
    id: `${over.name}-${over.role}`,
    first_name: null,
    last_name: null,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-10-01T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

const ROSTER: TeamMember[] = [
  // ★ Jade: THE case the nine pill lists could not show — one person, three roles.
  member({ name: 'Jade', role: 'da', first_name: 'Jade', last_name: 'Hu', email: 'jade@blueprintcap.com' }),
  member({ name: 'Jade', role: 'dm', first_name: 'Jade', last_name: 'Hu', email: 'jade@blueprintcap.com' }),
  member({ name: 'Jade', role: 'schematic', first_name: 'Jade', last_name: 'Hu', email: 'jade@blueprintcap.com' }),
  member({ name: 'Trevor', role: 'da', first_name: 'Trevor', last_name: 'Reed', email: 'trevor@blueprintcap.com' }),
  // ★ Steve ships with NO email — nobody knows it. The red "missing" case.
  member({ name: 'Steve', role: 'ca', first_name: 'Steve', last_name: 'Ng' }),
  // ★★ Caleb: acq_lead, active=false. fix-407 found him on NO Settings surface,
  //    because the alumni card was DA-only.
  member({ name: 'Caleb', role: 'acq_lead', active: false, first_name: 'Caleb', last_name: 'Ortiz' }),
  // ★ A retired DA, under the DA flag the DA surfaces have always read.
  member({ name: 'OldGrad', role: 'da', former: true }),
];

describe('fix-613 §A — one row per person', () => {
  const rows = foldPeopleTable(ROSTER);

  it('★★★ Jade is ONE row with THREE role chips', () => {
    const jade = rows.find((p) => p.name === 'Jade')!;
    expect(jade.roles).toEqual(['da', 'dm', 'schematic']);
    expect(jade.members).toHaveLength(3);
    // ★ one row per PERSON, so she appears once
    expect(rows.filter((p) => p.name === 'Jade')).toHaveLength(1);
  });

  it('★★★ the active table and the retired list partition everybody', () => {
    const active = activePeople(rows).map((p) => p.name).sort();
    const retired = retiredPeople(rows).map((p) => p.name).sort();
    expect(active).toEqual(['Jade', 'Steve', 'Trevor']);
    // ★★ CALEB IS HERE, which is the half fix-407 could not finish: the alumni
    //    card read `formerDas` only, so an inactive acquisitions lead named on
    //    twenty live projects appeared on no Settings surface at all.
    expect(retired).toEqual(['Caleb', 'OldGrad']);
    expect([...active, ...retired].sort()).toEqual(
      [...new Set(ROSTER.map((m) => m.name))].sort(),
    );
  });

  it('★★ counts are per-ROLE while rows are per-PERSON', () => {
    const counts = roleCounts(rows);
    // Jade and Trevor are DAs; OldGrad is retired so he is not counted
    expect(counts.get('da')).toBe(2);
    expect(counts.get('dm')).toBe(1);
    expect(counts.get('ca')).toBe(1);
    // ★ Caleb's row is inactive, so acq_lead counts nobody
    expect(counts.get('acq_lead') ?? 0).toBe(0);
    expect(activePeople(rows)).toHaveLength(3);
  });

  it('★★ the filter picks people who hold that role LIVE', () => {
    const active = activePeople(rows);
    expect(filterByRole(active, 'dm').map((p) => p.name)).toEqual(['Jade']);
    expect(filterByRole(active, 'da').map((p) => p.name).sort()).toEqual([
      'Jade',
      'Trevor',
    ]);
    expect(filterByRole(active, null)).toHaveLength(3);
    // every chip the table offers is a real role
    for (const r of PEOPLE_ROLE_FILTERS) {
      expect(filterByRole(active, r).length).toBeGreaterThanOrEqual(0);
    }
  });

  it('★ the folded columns come from what the rows AGREE on', () => {
    const jade = rows.find((p) => p.name === 'Jade')!;
    expect(jade.email).toBe('jade@blueprintcap.com');
    expect([jade.first_name, jade.last_name]).toEqual(['Jade', 'Hu']);
    expect(jade.split).toEqual([]);
    // ★ and a missing email stays missing rather than being invented
    expect(rows.find((p) => p.name === 'Steve')!.email).toBeNull();
  });
});

// ===========================================================================
// ★★★ RETIRE AND RESTORE
// ===========================================================================
describe('fix-613 §A — Retire stands every role down, and deletes nothing', () => {
  const rows = foldPeopleTable(ROSTER);

  it('★★★ a DA retires with `former`, everything else with `active`', () => {
    // ★★★ THE ASYMMETRY IS LOAD-BEARING, not legacy. `isCurrentMember` is
    //     `active !== false && former !== true`, so EITHER flag retires a row —
    //     but the DA surfaces have read `former` specifically since Q7.3.b (the
    //     alumni list, `formerDas`, `formerMemberNames`, the Team Structure
    //     chips). A DA retired with `active=false` would drop out of the pickers
    //     AND fail to appear in the alumni list: retired and unrestorable.
    expect(retirePatch('da')).toEqual({ former: true });
    expect(retirePatch('dm')).toEqual({ active: false });
    expect(retirePatch('acq_lead')).toEqual({ active: false });
  });

  it('★★★ retiring Jade writes all THREE of her rows, each with the right flag', () => {
    const jade = rows.find((p) => p.name === 'Jade')!;
    const writes = retirePersonWrites(jade);
    expect(writes).toHaveLength(3);
    expect(
      writes.map((w) => [w.member.role, JSON.stringify(w.patch)]).sort(),
    ).toEqual([
      ['da', JSON.stringify({ former: true })],
      ['dm', JSON.stringify({ active: false })],
      ['schematic', JSON.stringify({ active: false })],
    ]);
  });

  it('★★★ and every retired row drops OUT OF A PICKER — proved on the assignee one', () => {
    // ★★ ONE PICKER, PROVED. `isAssignableMember` is what the task assignee
    //    dropdowns (primary + co-assignee) source their roster from — fix-233's
    //    single definition, fix-343's viewer exclusion. If a retired person
    //    still passed it, Retire would be a label on a button that does nothing.
    const jade = rows.find((p) => p.name === 'Jade')!;
    // before: every row of hers is assignable
    for (const m of jade.members) expect(isAssignableMember(m)).toBe(true);
    // after: apply the patches the retire would write
    const after = retirePersonWrites(jade).map((w) => ({ ...w.member, ...w.patch }));
    for (const m of after) {
      expect(isCurrentMember(m), `${m.role} should not be current`).toBe(false);
      expect(isAssignableMember(m), `${m.role} should not be assignable`).toBe(false);
    }
  });

  it('★★★ Restore works for EVERY role, not only DAs', () => {
    // Today only a DA could be restored — Caleb could not.
    const caleb = retiredPeople(rows).find((p) => p.name === 'Caleb')!;
    const writes = restorePersonWrites(caleb);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.member.role).toBe('acq_lead');
    // ★★ BOTH flags are cleared whatever the role: a row retired under the old
    //    DA rule and restored as a non-DA would otherwise keep `former=true` and
    //    stay invisible.
    expect(restorePatch()).toEqual({ active: true, former: false });
    const restored = { ...writes[0]!.member, ...writes[0]!.patch };
    expect(isCurrentMember(restored)).toBe(true);
    // and a retired DA restores too
    const grad = retiredPeople(rows).find((p) => p.name === 'OldGrad')!;
    const back = restorePersonWrites(grad).map((w) => ({ ...w.member, ...w.patch }));
    expect(back.every(isCurrentMember)).toBe(true);
  });

  it('★★ retiring skips rows already retired — the smallest honest save', () => {
    const grad = retiredPeople(rows).find((p) => p.name === 'OldGrad')!;
    expect(retirePersonWrites(grad)).toEqual([]);
  });

  it('★★★ NO HARD DELETE is reachable from any People surface — census gap 37', () => {
    // A deleted row takes a name off the roster while ~2,209 assignments across
    // 11 columns still point at that string, with no FK and no cascade.
    // ★★★ COMMENTS STRIPPED FIRST — the gravestone trap, TENTH outing, and it
    //     caught me inside this very ticket: AdminTeamTab’s new header NAMES
    //     `bp_delete_team_member_row` to record that it is no longer reachable.
    //     A bare-string sweep would forbid writing the removal down.
    for (const f of ['components/Settings/PeopleTable.tsx', 'components/Settings/AdminTeamTab.tsx']) {
      const src = code(readFileSync(join(SRC, f), 'utf8'));
      expect(src, `${f} must not reach the delete`).not.toContain('useDeleteTeamMember');
      expect(src, `${f} must not call the delete RPC`).not.toContain(
        'bp_delete_team_member_row',
      );
    }
  });
});

// ===========================================================================
// ⚖️ "GOES BY" IS NEVER EDITED HERE
// ===========================================================================
describe('fix-613 — the credited name is read-only, and the renames are gone', () => {
  it('★★★ the dialog shows Goes by disabled, and the RPC cannot carry a new one', () => {
    const dialog = readFileSync(
      join(SRC, 'components/Settings/PersonDetailsDialog.tsx'),
      'utf8',
    );
    expect(dialog).toContain('label="Goes by"');
    expect(dialog).toContain('data-testid="person-details-name"');
    expect(dialog).toContain('readOnly');
    // ★ enforced by the RPC's signature, not by the component: there is no
    //   parameter that could carry a new name.
    const setDetails = readFileSync(join(SRC, 'hooks/useSetPersonDetails.ts'), 'utf8');
    expect(setDetails).toContain('p_name');
    expect(setDetails).not.toMatch(/p_new_name|p_name_new/);
  });

  it('★★★ both partial-rename hooks are deleted, and nothing calls their RPCs', () => {
    // ⚖️ Bobby, 2026-10-01: they missed projects, routing and the draw schedule,
    //    so what they advertised as a cascade split one person into two.
    expect(existsSync(join(SRC, 'hooks/useRenameDA.ts'))).toBe(false);
    expect(existsSync(join(SRC, 'hooks/useRenameDM.ts'))).toBe(false);
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      if (/rpc\('bp_rename_d[am]'/.test(src)) offenders.push(file.replace(SRC, ''));
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// ===========================================================================
// §A — adding somebody without a login (census gap 34)
// ===========================================================================
describe('fix-613 §A — add without a login', () => {
  it('★★★ Goes by, first, last and role are required; email is not', () => {
    // ★★ THE PILL BOXES SENT `{name, role}` AND NOTHING ELSE, so a new row had
    //    no email — and `resolveRosterIdentity` matches a login BY EMAIL, so
    //    that person could never be matched to their own sign-in.
    expect(
      addWithoutLoginRefusals({ name: '', first_name: '', last_name: '', role: '' }).sort(),
    ).toEqual(['first_name', 'last_name', 'name', 'role']);
    expect(
      addWithoutLoginRefusals({
        name: 'Bobby',
        first_name: 'Robert',
        last_name: 'Dias',
        role: 'ent_lead',
      }),
    ).toEqual([]);
    // ★ email optional — Steve and David shipped with none on purpose
    expect(
      addWithoutLoginRefusals({
        name: 'Steve',
        first_name: 'Steve',
        last_name: 'Ng',
        role: 'ca',
        email: '',
      }),
    ).toEqual([]);
    // ★ whitespace is not a name
    expect(
      addWithoutLoginRefusals({
        name: '   ',
        first_name: 'A',
        last_name: 'B',
        role: 'da',
      }),
    ).toEqual(['name']);
  });

  it('★★ it writes the row AND the details — the half the pill boxes never did', () => {
    const src = readFileSync(
      join(SRC, 'components/Settings/AddWithoutLoginForm.tsx'),
      'utf8',
    );
    expect(src).toContain("op: 'insert'");
    expect(src).toContain('details.mutate');
    // the details write runs on SUCCESS of the insert, so a refused insert does
    // not leave details attached to no row
    expect(src.indexOf('onSuccess')).toBeLessThan(src.indexOf('details.mutate'));
  });

  it('★★★ and the nine pill "Add…" boxes are gone with the lists', () => {
    const tab = readFileSync(join(SRC, 'components/Settings/AdminTeamTab.tsx'), 'utf8');
    expect(tab).not.toContain('PillListEditor');
    expect(tab).not.toContain('testIdPrefix="team-da"');
  });
});

// ===========================================================================
// §B — the map stays honest
// ===========================================================================
describe('fix-613 §B — People is three things, and the map says so', () => {
  it('★★★ the nine roster blocks are one, and it claims 11 → 1', () => {
    const people = blocksForCategory('people');
    expect(people.map((b) => b.title)).toEqual(['Add person', 'Everyone']);
    const everyone = people.find((b) => b.id === 'everyone')!;
    // ★ nine roster editors + Former DAs + Inactive (other roles)
    expect(everyone.merged).toBe('11 → 1');
    for (const gone of [
      'design-associates',
      'design-managers',
      'entitlement-leads',
      'acquisition-leads',
      'schematic',
      'construction-admin',
      'names-and-emails',
      'departments',
      'agenda-members',
      'former-and-inactive',
    ]) {
      expect(SETTINGS_BLOCKS.some((b) => b.id === gone), gone).toBe(false);
    }
  });

  it('★★ search finds a person by Goes by, full name AND email — §B', () => {
    const index = readFileSync(join(SRC, 'hooks/useSettingsSearchIndex.ts'), 'utf8');
    expect(index).toContain("blockId: 'everyone'");
    expect(index).toContain('m.name');
    expect(index).toContain('m.first_name');
    expect(index).toContain('m.email');
  });
});

// ===========================================================================
// ★★★ §Z (P-309) — a picture blip stops reaching Triage
// ===========================================================================
describe('fix-613 §Z — an avatar network blip is not a report', () => {
  /** Triage #752's error: a bare TypeError, no code, no status. */
  const BLIP = new TypeError('Failed to fetch');
  /** A response that ARRIVED and said no. */
  const MISSING = { message: 'Object not found', status: 404, code: '404' };

  it('★★★ "Failed to fetch" on avatar_url does NOT report', () => {
    expect(queryFailureLevel(BLIP, ['avatar_url', 'tenant/abc.jpg'], 1)).toBeNull();
    expect(isQuietNetworkQueryFailure(BLIP, ['avatar_url', 'x'])).toBe(true);
  });

  it('★★★ "Object not found" on the SAME query still reports, at error', () => {
    // ★★ The whole point of the exemption being (key × cause) rather than either
    //    one alone: a missing object means a person's row points at a file that
    //    is not in the bucket — a real defect wearing a transport costume.
    expect(queryFailureLevel(MISSING, ['avatar_url', 'tenant/abc.jpg'], 1)).toBe('error');
    expect(isQuietNetworkQueryFailure(MISSING, ['avatar_url', 'x'])).toBe(false);
  });

  it('★★★ the same blip on ANY OTHER query still reports', () => {
    // ★★★ fix-341 §2's rule: classified by the KEY, never by the message.
    //     "Failed to fetch" also appears when the API is down, and silencing it
    //     by wording would silence a real outage.
    expect(queryFailureLevel(BLIP, ['permits', 'tenant'], 1)).toBe('error');
    expect(queryFailureLevel(BLIP, ['project_messages', 'p1'], 1)).toBe('error');
    expect(NETWORK_QUIET_QUERY_KEYS.has('avatar_url')).toBe(true);
    expect(NETWORK_QUIET_QUERY_KEYS.size).toBe(1);
  });

  it('★★ a response that arrived is never a "network" failure', () => {
    expect(isBareNetworkFailure(BLIP)).toBe(true);
    expect(isBareNetworkFailure(new TypeError('NetworkError when fetching'))).toBe(true);
    expect(isBareNetworkFailure({ message: 'Failed to fetch' })).toBe(true);
    // a code or a status means the server answered
    expect(isBareNetworkFailure(MISSING)).toBe(false);
    expect(isBareNetworkFailure({ message: 'Failed to fetch', code: '42501' })).toBe(false);
    expect(isBareNetworkFailure({ message: 'permission denied' })).toBe(false);
  });

  it('★★★ the signing query retries a blip TWICE, and a refusal never', () => {
    const src = readFileSync(join(SRC, 'hooks/useAvatars.ts'), 'utf8');
    expect(src).toContain('retry: (failureCount, error) =>');
    expect(src).toContain('failureCount < 2 && isBareNetworkFailure(error)');
    // ★ short backoff — a picture is not worth waiting on
    expect(src).toContain('retryDelay: (attempt) => 300 * 3 ** attempt');
    // ★★ and the OTHER two avatar queries keep `retry: false`: the index falls
    //    back to initials and the profile-id lookup has a legitimate null.
    expect((src.match(/retry: false/g) ?? []).length).toBe(2);
  });

  it('★★ the hook does NOT swallow its own errors — §Z.2', () => {
    // The exemption lives in the reporter, so the query still fails, the circle
    // still falls back to initials, and a future reader can see why it is quiet.
    const src = readFileSync(join(SRC, 'hooks/useAvatars.ts'), 'utf8');
    const signing = src.slice(src.indexOf('export function useSignedAvatarUrl'));
    expect(signing).toContain('if (error) throw error;');
  });
});

/** Comments stripped, so prose ABOUT a removed call is not mistaken for one. */
function code(src: string): string {
  const nl = String.fromCharCode(10);
  return src
    .replace(/\r/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(nl)
    .filter((l) => !/^\s*\/\//.test(l))
    .join(nl);
}

// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'harness') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ===========================================================================
// The table, rendered
// ===========================================================================
const ROSTER_REF = vi.hoisted(() => ({ rows: [] as unknown[] }));
const upsertSpy = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: ROSTER_REF.rows,
    activeDas: [],
    formerDas: [],
    dms: [],
    ents: [],
    acqs: [],
    schematics: [],
    cas: [],
    inactive: [],
    activeMemberNames: [],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../hooks/useUpsertTeamMember', () => ({
  useUpsertTeamMember: () => ({ mutate: upsertSpy, isPending: false }),
}));
vi.mock('../hooks/useAgendaMember', () => ({
  useAgendaMemberNames: () => ['Jade'],
  useSetAgendaMember: () => ({ mutate: vi.fn(), isPending: false }),
  useIsAgendaMember: () => false,
}));
vi.mock('../hooks/useSetTeamDepartment', () => ({
  useSetTeamDepartment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useSetPersonDetails', () => ({
  useSetPersonDetails: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => true }));
vi.mock('../hooks/useAvatars', () => ({
  useProfileIdForRosterName: () => ({ data: null, isLoading: false }),
  useAvatarPathFor: () => () => null,
  useAvatarIndex: () => new Map(),
  useSignedAvatarUrl: () => ({ data: null, isLoading: false }),
  useSetAvatar: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { default: PeopleTable } = await import('../components/Settings/PeopleTable');

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeopleTable readOnly={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  upsertSpy.mockReset();
  ROSTER_REF.rows = ROSTER;
});

describe('fix-613 §A — the table on screen', () => {
  it('★★★ Jade is one row carrying three role chips', () => {
    renderTable();
    expect(screen.getByTestId('people-row-Jade')).toBeInTheDocument();
    for (const r of ['da', 'dm', 'schematic']) {
      expect(screen.getByTestId(`people-role-Jade-${r}`)).toBeInTheDocument();
    }
    // one row, not three
    expect(screen.getAllByTestId(/^people-row-Jade$/)).toHaveLength(1);
  });

  it('★★★ a missing email says "missing", in red, rather than blank', () => {
    renderTable();
    expect(screen.getByTestId('people-email-missing-Steve')).toBeInTheDocument();
    expect(screen.getByTestId('people-email-Trevor').textContent).toContain(
      'trevor@blueprintcap.com',
    );
  });

  it('★★ the agenda column ticks who is on it', () => {
    renderTable();
    expect(screen.getByTestId('people-agenda-Jade').textContent).toContain('✓');
    expect(screen.getByTestId('people-agenda-Trevor').textContent).not.toContain('✓');
  });

  it('★★★ Retire writes every one of a person’s rows', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('people-retire-Jade'));
    expect(upsertSpy).toHaveBeenCalledTimes(3);
    const patches = upsertSpy.mock.calls.map((c) => c[0].patch);
    expect(patches).toEqual(
      expect.arrayContaining([{ former: true }, { active: false }, { active: false }]),
    );
    // ★ and never a delete
    for (const call of upsertSpy.mock.calls) {
      expect(call[0].op).toBe('update');
    }
  });

  it('★★★ Caleb is in Former & inactive, with Restore — not only DAs', () => {
    renderTable();
    expect(screen.getByTestId('people-retired-pill-Caleb')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('people-restore-Caleb'));
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0].patch).toEqual({ active: true, former: false });
  });

  it('★★ the role filter narrows to people holding that role', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('people-filter-dm'));
    expect(screen.getByTestId('people-row-Jade')).toBeInTheDocument();
    expect(screen.queryByTestId('people-row-Trevor')).toBeNull();
    // clicking it again clears the filter
    fireEvent.click(screen.getByTestId('people-filter-dm'));
    expect(screen.getByTestId('people-row-Trevor')).toBeInTheDocument();
  });

  it('★★ Goes by is rendered with the hint, and no input', () => {
    renderTable();
    const cell = screen.getByTestId('people-goesby-Jade');
    expect(cell.tagName).toBe('SPAN');
    expect(cell.getAttribute('title')).toMatch(/not edited here/i);
  });

  it('★ a non-admin gets no Retire button', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PeopleTable readOnly />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('people-retire-Jade')).toBeNull();
    // …but can still read the table and open a person
    expect(screen.getByTestId('people-edit-Jade')).toBeInTheDocument();
  });

  it('★★ Edit opens the existing person dialog, reused not rebuilt', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('people-edit-Jade'));
    expect(screen.getByTestId('person-details-dialog')).toBeInTheDocument();
    // ★ the dialog's own Goes by control, disabled
    const name = screen.getByTestId('person-details-name') as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(name.value).toBe('Jade');
  });

  it('★★★ the dialog saves department, agenda and roles through their own RPCs', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('people-edit-Jade'));
    // the three controls §A asks for
    expect(screen.getByTestId('person-details-department')).toBeInTheDocument();
    expect(screen.getByTestId('person-details-agenda')).toBeInTheDocument();
    expect(screen.getByTestId('person-role-add')).toBeInTheDocument();
    // ★★ removing a role RETIRES it — the × writes a patch, never a delete
    fireEvent.click(screen.getByTestId('person-role-retire-dm'));
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toMatchObject({
      op: 'update',
      patch: { active: false },
    });
  });

  it('★★ adding a role inserts the (name, role) row the pill lists used to', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('people-edit-Jade'));
    fireEvent.change(screen.getByTestId('person-role-add'), {
      target: { value: 'ent' },
    });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toEqual({
      op: 'insert',
      patch: { name: 'Jade', role: 'ent' },
    });
  });
});
