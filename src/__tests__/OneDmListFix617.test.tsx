import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type {
  TeamMember,
  DrawScheduleQuarterLayoutRow,
} from '../lib/database.types';
import { describeDmMove } from '../hooks/useSetDmForDa';
import { unmappedActiveDas } from '../lib/dmCoAssign';
import { teamMappingGap } from '../lib/myBoard';
import {
  daHasRoutingFor,
  groupRoutingByDa,
  isDefaultRule,
  type DaTeamRoutingRow,
} from '../lib/daRouting';

// ===========================================================================
// ★★★ fix-617 (P-006 · P-166 step 4a · census gaps 38, 40, 41)
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-01: **"Settings decides; the Draw Schedule follows."**
//
// Team Structure (`dm_da_groups`) is the ONE list of who sits under which DM.
// The Draw Schedule Layout editor used to hold a second, free-text answer in
// `group_label`, and the two could disagree while only one of them reached the
// work — fix-379's derived `permits.dm`, fix-346's task co-assignee, the board
// lens and the wizard all read the mapping, and nothing read the layout label.
//
// ★ NO LIVE DATABASE IN CI (see the project memory note), so the server half is
//   pinned the way this repo has pinned SQL since fix-153: assert the shape of
//   the staged migration's text, and test the parts that CAN be pure — the
//   quarter comparison, the sentence, the predicates — for real.

const SQL = readFileSync(
  resolve(__dirname, '../../migrations/fix_617_one_dm_list.sql'),
  'utf8',
);

/** ★ Comments stripped before asserting on code. Tenth-plus outing for this
 *  trap in this codebase: every one of these files documents its own reasoning
 *  at length, so a `grep` for a rule keeps finding the PROSE describing it.
 *
 *  ★★ CRLF FIRST. `\r` is a JavaScript regex line terminator, so `/--.*$/m`
 *     against CRLF text matches nothing past the split — fix-608 lost an entire
 *     sweep to exactly this. */
function sqlCodeOnly(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

const SQL_CODE = sqlCodeOnly(SQL);

/** ★★ The migration with every FUNCTION BODY removed, so "does this file
 *  change data?" can be asked of the statements that RUN ON APPLY. A function's
 *  own `INSERT ... SELECT` (bp_clone_quarter_layout builds a quarter that way)
 *  is behaviour for later callers, not a write this file performs — asking the
 *  question of the whole text conflates the two and the answer is useless. */
const SQL_TOP_LEVEL = SQL_CODE.replace(/\$function\$[\s\S]*?\$function\$/g, "''");

/** ONE SQL statement out of `src`: from the first line beginning with `head`
 *  up to the next `;`.
 *
 *  ★★★ THIS EXISTS BECAUSE THE RED-PROOF CAUGHT ME. The first version of the
 *      two assertions below matched `UPDATE …draw_schedule_quarter_layout` and
 *      then `[\s\S]*?` ran on until it found `col_kind = 'da'` — which it did,
 *      **in the next statement**. Deleting the guard from the UPDATE left both
 *      tests green. A regex that may cross a statement boundary is not testing
 *      the statement it names. */
function stmt(src: string, head: string): string {
  const start = src.indexOf(head);
  expect(start, `${head} appears`).toBeGreaterThan(-1);
  const end = src.indexOf(';', start);
  expect(end, `${head} terminates`).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** The body of one `CREATE OR REPLACE FUNCTION public.<name>` in the migration,
 *  comments already stripped, so an assertion about one function cannot be
 *  satisfied by text belonging to another. */
function fnBody(name: string): string {
  const start = SQL_CODE.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is declared`).toBeGreaterThan(-1);
  const end = SQL_CODE.indexOf('$function$;', start);
  expect(end, `${name} body terminates`).toBeGreaterThan(start);
  return SQL_CODE.slice(start, end);
}

// ---------------------------------------------------------------------------
// §A.1 — the move is ONE server call, and it stops at the current quarter
// ---------------------------------------------------------------------------
describe('fix-617 §A.1 — Settings decides, the Draw Schedule follows', () => {
  it('writes dm_da_groups AND the layout in one function', () => {
    const body = fnBody('bp_set_dm_for_da');
    expect(body).toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+public\.dm_da_groups/);
    expect(body).toMatch(/UPDATE public\.draw_schedule_quarter_layout/);
  });

  it('★★★ touches the CURRENT quarter and later, never the past', () => {
    const body = fnBody('bp_set_dm_for_da');
    // The layout UPDATE is scoped by `quarter >= v_cur`. A `=` would freeze the
    // move to this quarter alone; no bound at all would rewrite history.
    const update = stmt(body, 'UPDATE public.draw_schedule_quarter_layout');
    expect(update).toMatch(/l\.quarter >= v_cur/);
    expect(update).not.toMatch(/l\.quarter\s*=\s*v_cur/);
    expect(body).not.toMatch(/l\.quarter\s*<\s*v_cur/);
    expect(body).toContain('public.bp_current_quarter()');
  });

  it('★★★ scopes the layout write to col_kind = \'da\' — Jade is a DA and a DM', () => {
    // Measured on prod 2026-10-01: 2026-Q4 position 3 is
    // (col_kind='dm', da_name='Jade', group_label='Jade'). A manager's own
    // column stores the MANAGER's name in `da_name`, so without this guard
    // moving the ASSOCIATE Jade would rewrite the MANAGER Jade's header.
    // Every statement that reaches a layout row by `da_name` needs it: the
    // UPDATE that moves the group, the SELECT that reports which quarters
    // moved, and the preview's count.
    const set = fnBody('bp_set_dm_for_da');
    expect(
      stmt(set, 'UPDATE public.draw_schedule_quarter_layout'),
    ).toMatch(/l\.col_kind = 'da'/);
    expect(stmt(set, '  SELECT coalesce(array_agg')).toMatch(/l\.col_kind = 'da'/);
    const preview = fnBody('bp_preview_dm_move');
    expect(stmt(preview, '  SELECT coalesce(array_agg')).toMatch(/l\.col_kind = 'da'/);
  });

  it('★★ never writes permits.dm — fix-379\'s trigger derives it', () => {
    const body = fnBody('bp_set_dm_for_da');
    expect(body).not.toMatch(/UPDATE\s+public\.permits/);
    expect(body).not.toMatch(/\bSET\b[^;]*\bdm\s*=/);
  });

  it('★★ is admin-gated in the function, because SECURITY DEFINER bypasses RLS', () => {
    const body = fnBody('bp_set_dm_for_da');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toMatch(/NOT public\.is_tenant_admin\(/);
  });

  it('★★★ never bypasses the fix-379 delete guard', () => {
    // `bp_trg_dm_da_group_guard` honours `app.bp_allow_dm_da_group_delete`.
    // That escape hatch exists for a deliberate, supervised data change — a
    // function the UI calls must never set it, or the guard protects nothing.
    expect(SQL_CODE).not.toContain('bp_allow_dm_da_group_delete');
  });

  it('revokes from public AND anon, never from anon alone (fix-157)', () => {
    for (const fn of [
      'bp_current_quarter()',
      'bp_preview_dm_move(text, text)',
      'bp_set_dm_for_da(text, text)',
      'bp_clone_quarter_layout(text, text, boolean)',
    ]) {
      expect(SQL_CODE).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM public, anon;`,
      );
      expect(SQL_CODE).toContain(
        `GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`,
      );
    }
    // ★ `FROM anon` alone is the fix-157 hole: anon inherits PUBLIC, so
    //   revoking from anon while PUBLIC still holds EXECUTE changes nothing.
    expect(SQL_CODE).not.toMatch(/REVOKE ALL ON FUNCTION[^;]*FROM anon;/);
  });

  it('★★ the quarter bound is a LEXICAL compare, and that is why >= works', () => {
    // 'YYYY-Qn' sorts lexically in chronological order — the property the whole
    // "current and later, never the past" rule rests on. If this ever stopped
    // being true, `quarter >= v_cur` would silently select the wrong quarters.
    const cur = '2026-Q4';
    const past = ['2024-Q1', '2025-Q4', '2026-Q1', '2026-Q3'];
    const future = ['2026-Q4', '2027-Q1', '2030-Q2'];
    for (const q of past) expect(q >= cur).toBe(false);
    for (const q of future) expect(q >= cur).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §A.3 — a new quarter takes its groups from Team Structure
// ---------------------------------------------------------------------------
describe('fix-617 §A.3 — a new quarter seeds groups from Team Structure', () => {
  it('the CLONE path reads bp_dm_for_da for a DA column', () => {
    const body = fnBody('bp_clone_quarter_layout');
    expect(body).toMatch(
      /WHEN src\.col_kind = 'da'[\s\S]*?public\.bp_dm_for_da\(src\.da_name/,
    );
  });

  it('★ and the SEED path already did, so the migration leaves it alone', () => {
    // `bp_seed_quarter_layout_from_current` selects `g.dm_name AS group_label`
    // from `dm_da_groups` on prod already — re-stating a correct function is how
    // a migration quietly reverts someone else's later fix.
    expect(SQL_CODE).not.toContain(
      'CREATE OR REPLACE FUNCTION public.bp_seed_quarter_layout_from_current',
    );
  });
});

// ---------------------------------------------------------------------------
// §A.4 — the confirm says what moves, in plain words, with the counts
// ---------------------------------------------------------------------------
describe('fix-617 §A.4 — the sentence the confirm shows', () => {
  const base = {
    da: 'Erick',
    from_dm: 'Derry',
    to_dm: 'Brittani',
    open_permits: 14,
    open_tasks: 22,
    layout_quarters: ['2026-Q4', '2027-Q1'],
    layout_rows: 2,
  };

  it('names both counts and where they go', () => {
    const s = describeDmMove(base);
    expect(s).toContain('Erick will report to Brittani.');
    expect(s).toContain('14 open permits and 22 open tasks');
    expect(s).toContain('move to Brittani');
  });

  it('★ says the Draw Schedule follows, and names the quarters', () => {
    const s = describeDmMove(base);
    expect(s).toContain('2026-Q4, 2027-Q1');
    expect(s).toContain('earlier quarters stay as they were');
  });

  it('★★ says "nothing else changes" rather than going quiet', () => {
    const s = describeDmMove({ ...base, open_permits: 0, open_tasks: 0 });
    expect(s).toContain('no open permits or tasks');
    expect(s).toContain('nothing else changes');
  });

  it('singularises, and an UNMAP reads as a real choice', () => {
    expect(describeDmMove({ ...base, open_permits: 1, open_tasks: 0 })).toContain(
      '1 open permit move',
    );
    const un = describeDmMove({ ...base, to_dm: null });
    expect(un).toContain('Erick will report to nobody.');
    expect(un).toContain('lose their design manager');
  });

  it('★★★ the fix-379 guard message reaches the person verbatim', () => {
    // That message is the ANSWER — *"A departed associate keeps their mapping —
    // mark them inactive on the roster instead."* Wrapping it in "Could not
    // save" prose would throw away the only sentence that tells somebody what
    // to do instead.
    const src = readFileSync(
      resolve(__dirname, '../hooks/useSetDmForDa.ts'),
      'utf8',
    );
    const code = src
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/onError:[\s\S]*?pushToast\(error\.message,\s*'error'\)/);
    expect(code).not.toMatch(/pushToast\(`[^`]*\$\{error\.message\}/);
  });
});

// ---------------------------------------------------------------------------
// §A.2 — the layout editor SHOWS a DA's group; it does not offer it
// ---------------------------------------------------------------------------
const NOW = '2026-06-18T00:00:00Z';

const qlState = vi.hoisted(() => ({ rows: [] as unknown[], dataUpdatedAt: 1 }));
const qlMocks = vi.hoisted(() => ({
  clone: vi.fn(),
  seed: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
}));

// ═══ the Team Structure render ═══
const tsState = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
}));
const tsMocks = vi.hoisted(() => ({ setDm: vi.fn() }));

vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    rows: tsState.rows,
    data: tsState.rows,
    groups: [],
    isLoading: false,
  }),
}));
// ★ Keep the REAL `describeDmMove` — the sentence is the thing under test in
//   §A.4, and a mocked one would assert nothing.
vi.mock('../hooks/useSetDmForDa', async (orig) => ({
  ...(await orig<typeof import('../hooks/useSetDmForDa')>()),
  useSetDmForDa: () => ({
    mutate: tsMocks.setDm,
    isPending: false,
    error: tsState.error,
  }),
  useDmMovePreview: () => ({
    data: {
      da: 'Erick',
      from_dm: 'Derry',
      to_dm: 'Brittani',
      open_permits: 14,
      open_tasks: 22,
      layout_quarters: ['2026-Q4'],
      layout_rows: 1,
    },
    isLoading: false,
  }),
}));
vi.mock('../hooks/useOpenTaskCounts', () => ({
  useOpenTaskCounts: () => ({ data: {}, isLoading: false }),
}));

vi.mock('../hooks/useQuarterLayout', () => ({
  useQuarterLayout: () => ({
    rows: qlState.rows,
    data: qlState.rows,
    isLoading: false,
    error: null,
    dataUpdatedAt: qlState.dataUpdatedAt,
    refetch: qlMocks.refetch.mockResolvedValue({ data: qlState.rows }),
  }),
}));
vi.mock('../hooks/useBuildQuarterLayout', () => ({
  useCloneQuarterLayout: () => ({ mutate: qlMocks.clone, isPending: false }),
  useSeedQuarterLayoutFromCurrent: () => ({ mutate: qlMocks.seed, isPending: false }),
}));
vi.mock('../hooks/useReplaceQuarterLayout', async (orig) => ({
  ...(await orig<typeof import('../hooks/useReplaceQuarterLayout')>()),
  useReplaceQuarterLayout: () => ({ mutate: qlMocks.replace, isPending: false }),
}));

const { default: QuarterLayoutEditor } = await import(
  '../components/Settings/QuarterLayoutEditor'
);
const { default: TeamActiveQuartersEditor } = await import(
  '../components/Settings/TeamActiveQuartersEditor'
);
const { default: TeamStructureEditor } = await import(
  '../components/Settings/TeamStructureEditor'
);

/** The quarters editor owns a mutation hook, so it needs a client. */
function renderWithQc(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: 'm', name: 'X', role: 'da', active: true, former: false, email: null,
    notes: null, updated_at: NOW, active_start_quarter: null,
    active_end_quarter: null, ...over,
  } as TeamMember;
}

function layoutRow(
  over: Partial<DrawScheduleQuarterLayoutRow>,
): DrawScheduleQuarterLayoutRow {
  return {
    id: 'r0', quarter: 'Q', position: 0, col_kind: 'da', da_name: 'Marc',
    group_label: 'Brittani', label_override: null, top_label: null,
    updated_at: NOW, ...over,
  };
}

function renderLayout() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <QuarterLayoutEditor
            das={[member({ id: 'da-1', name: 'Marc' })]}
            dms={[member({ id: 'dm-1', name: 'Jade', role: 'dm' })]}
          />
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('fix-617 §A.2 — the layout editor cannot change a DA\'s group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qlState.rows = [
      layoutRow({ id: 'r-da', position: 0, col_kind: 'da', da_name: 'Marc', group_label: 'Brittani' }),
      layoutRow({ id: 'r-dm', position: 1, col_kind: 'dm', da_name: 'Jade', group_label: 'Jade' }),
    ];
    qlState.dataUpdatedAt += 1;
  });

  it('★★★ a DA column\'s group is read-only, not an input', () => {
    renderLayout();
    const cell = screen.getByTestId('ql-group-r-da');
    expect(cell.getAttribute('data-readonly')).toBe('true');
    expect(cell.tagName).not.toBe('INPUT');
    expect(cell.textContent).toContain('Brittani');
  });

  it('★★ and it links to the block that DOES decide', () => {
    renderLayout();
    const link = screen.getByTestId('ql-group-link-r-da');
    expect(link.getAttribute('href')).toBe('/settings/teams#team-structure');
    expect(link.textContent).toContain('Team Structure');
  });

  it('★ a MANAGER\'s column keeps its editable label', () => {
    // For a `dm` column the group label IS the column; it is not a claim about
    // who reports to whom, so taking it away would remove a real control.
    renderLayout();
    const cell = screen.getByTestId('ql-group-r-dm');
    expect(cell.tagName).toBe('INPUT');
    expect(cell.getAttribute('data-readonly')).toBeNull();
  });

  it('★★ a DA column\'s group never reaches the save payload as free text', () => {
    renderLayout();
    // There is no control to type one into: the only `ql-group-*` element for a
    // DA row is the read-only span asserted above.
    const cell = screen.getByTestId('ql-group-r-da');
    expect((cell as HTMLElement).querySelector('input')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// census gap 40 — ONE predicate for "active DA with no manager"
// ---------------------------------------------------------------------------
describe('fix-617 gap 40 — one unmapped predicate', () => {
  const rows = [{ dm_name: 'Brittani', da_name: 'Marc' }];

  it('★★★ a DA whose `active` is NULL is a CURRENT member, so the gap list names them', () => {
    // RED-PROOF: `myBoard.teamMappingGap` tested `active === true`, and
    // `team_members.active` is nullable (DEFAULT true). Before this change the
    // one list whose job is to find DAs with no manager was the only place that
    // could not see a DA whose `active` had never been filled in.
    const members = [
      member({ id: 'a', name: 'Marc' }),
      member({ id: 'b', name: 'Cam', active: null as unknown as boolean }),
    ];
    const gap = teamMappingGap(members, rows, []);
    expect(gap.unassignedDas.map((d) => d.name)).toEqual(['Cam']);
  });

  it('agrees with unmappedActiveDas on the same inputs', () => {
    const members = [
      member({ id: 'a', name: 'Marc' }),
      member({ id: 'b', name: 'Cam', active: null as unknown as boolean }),
      member({ id: 'c', name: 'Shire' }),
      member({ id: 'd', name: 'Nidhi', former: true }),
      member({ id: 'e', name: 'Miles', role: 'ent' }),
    ];
    const viaBoard = teamMappingGap(members, rows, []).unassignedDas.map((d) => d.name);
    const viaShared = unmappedActiveDas(
      members
        .filter((m) => m.role === 'da' && m.active !== false && m.former !== true)
        .map((m) => m.name),
      rows,
    );
    expect([...viaBoard].sort()).toEqual([...viaShared].sort());
    expect(viaShared).toEqual(['Cam', 'Shire']);
  });

  it('★★ a BLANK dm_name is unmapped — there is no manager in it to derive', () => {
    const blank = [{ dm_name: '', da_name: 'Marc' }];
    expect(unmappedActiveDas(['Marc'], blank)).toEqual(['Marc']);
    expect(
      teamMappingGap([member({ id: 'a', name: 'Marc' })], blank, []).unassignedDas.map(
        (d) => d.name,
      ),
    ).toEqual(['Marc']);
  });

  it('matches names trimmed + case-folded, like bp_dm_for_da', () => {
    expect(unmappedActiveDas(['marc '], rows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// census gap 41 — the DA routing rule in ONE copy
// ---------------------------------------------------------------------------
describe('fix-617 gap 41 — one routing rule', () => {
  const r = (over: Partial<DaTeamRoutingRow>): DaTeamRoutingRow => ({
    da: 'Trevor', jurisdiction: null, ent_lead: 'Miles', ...over,
  });

  it('★★★ the rule lives in lib/daRouting, not in the hook module', () => {
    // Six test files replace `hooks/useDaTeamRouting` wholesale, which makes
    // every non-hook export of it `undefined` inside a render (fix-415's trap).
    const hook = readFileSync(
      resolve(__dirname, '../hooks/useDaTeamRouting.ts'),
      'utf8',
    )
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(hook).not.toMatch(/export function daHasRoutingFor/);
    expect(hook).not.toMatch(/jurisdiction === null/);
  });

  it('★★ the wizard gate and the Settings layout use the SAME default test', () => {
    // A blank-string jurisdiction is NOT a default: `bp_ent_lead_for_da` selects
    // `jurisdiction = p_juris OR jurisdiction IS NULL`, so such a row applies
    // nowhere. Settings used to call it a default and the wizard did not.
    const blank = r({ jurisdiction: '' });
    expect(isDefaultRule(blank)).toBe(false);
    expect(daHasRoutingFor('Trevor', 'Seattle', [blank])).toBe(false);
    const grouped = groupRoutingByDa([blank]);
    expect(grouped[0].default).toBeNull();
    expect(grouped[0].overrides).toHaveLength(1);
  });

  it('a NULL-juris row still routes a DA everywhere', () => {
    const rows = [r({})];
    expect(isDefaultRule(rows[0])).toBe(true);
    expect(daHasRoutingFor('Trevor', 'Seattle', rows)).toBe(true);
    expect(daHasRoutingFor('Trevor', null, rows)).toBe(true);
    expect(groupRoutingByDa(rows)[0].default).not.toBeNull();
  });

  it('a juris-specific row routes only that juris', () => {
    const rows = [r({ jurisdiction: 'Bellevue' })];
    expect(daHasRoutingFor('Trevor', 'Bellevue', rows)).toBe(true);
    expect(daHasRoutingFor('Trevor', 'Seattle', rows)).toBe(false);
  });

  it('an unrouted DA is routed nowhere — a legitimate state (fix-497)', () => {
    expect(daHasRoutingFor('Cam', 'Seattle', [r({})])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// census gap 38 — a former DA's Active Quarters are editable by an admin
// ---------------------------------------------------------------------------
describe('fix-617 gap 38 — a former DA\'s Active Quarters', () => {
  const current = [member({ id: 'cur', name: 'Marc' })];
  const former = [
    member({
      id: 'gone',
      name: 'Nidhi',
      active: false,
      former: true,
      active_end_quarter: '2026-Q1',
    }),
  ];

  it('★★★ renders the rows that actually hold a window', () => {
    // Measured on prod 2026-10-01: all 12 current DAs have NULL/NULL, and all
    // four windows that exist belong to inactive DAs. The editor was editable
    // exactly where there was nothing to edit.
    renderWithQc(
      <TeamActiveQuartersEditor activeDas={current} formerDas={former} />,
    );
    expect(screen.getByTestId('team-quarters-former')).toBeTruthy();
    const end = screen.getByTestId('team-quarters-end-Nidhi') as HTMLSelectElement;
    expect(end.value).toBe('2026-Q1');
    expect(end.disabled).toBe(false);
  });

  it('★★ read-only for a non-admin, like every other row here', () => {
    renderWithQc(
      <TeamActiveQuartersEditor activeDas={current} formerDas={former} readOnly />,
    );
    expect(
      (screen.getByTestId('team-quarters-end-Nidhi') as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it('★ says what editing does — and what it does NOT do', () => {
    renderWithQc(
      <TeamActiveQuartersEditor activeDas={current} formerDas={former} />,
    );
    const note = screen.getByTestId('team-quarters-former').textContent ?? '';
    expect(note).toContain('past');
    expect(note).toMatch(/does not bring anyone back/i);
  });

  it('★ a former row is not ALSO badged "inactive this quarter"', () => {
    renderWithQc(
      <TeamActiveQuartersEditor activeDas={current} formerDas={former} />,
    );
    expect(screen.queryByTestId('team-quarters-badge-inactive-Nidhi')).toBeNull();
  });

  it('★★★ AdminTeamTab actually hands the former DAs over', () => {
    // RED-PROOF FOUND THIS TOO: every test above renders the editor directly
    // with `formerDas`, so deleting the prop from the one real caller left them
    // all green. A component that CAN do the job is not the same as a screen
    // that DOES — and the whole of gap 38 is that the rows holding the data
    // were not being passed in.
    const tab = readFileSync(
      resolve(__dirname, '../components/Settings/AdminTeamTab.tsx'),
      'utf8',
    );
    expect(tab).toMatch(/<TeamActiveQuartersEditor[\s\S]{0,200}?formerDas=\{teamQ\.formerDas\}/);
  });

  it('still renders with no former DAs at all', () => {
    renderWithQc(<TeamActiveQuartersEditor activeDas={current} />);
    expect(screen.queryByTestId('team-quarters-former')).toBeNull();
    expect(screen.getByTestId('team-quarters-row-Marc')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §B — the stale rows, and the guard that rules on them
// ---------------------------------------------------------------------------
describe('fix-617 §B — stale-row removal refuses a row with open work', () => {
  it('★★★ the migration changes NO data, and says so', () => {
    // §B's removals were to run "through the new path" after the migration.
    // They did not run: `bp_trg_dm_da_group_guard` counts EVERY permit naming
    // the DA (not just open ones) and refuses all three — Alex 4, Nidhi 3,
    // George 22 — and its message prescribes the remedy those three are
    // already in ("mark them inactive on the roster instead"). The migration
    // therefore carries no DML at all, which is the thing to pin: a later edit
    // that slips an UPDATE or DELETE into it would change prod on apply.
    const dml = SQL_TOP_LEVEL.match(
      /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+(public\.)?(dm_da_groups|permits|team_members|draw_schedule_quarter_layout)\b/g,
    );
    expect(dml, `unexpected data change: ${dml?.join(' | ')}`).toBeNull();
  });

  it('★★ the guard is named in the file, so the reasoning travels with it', () => {
    expect(SQL).toContain('fix-379');
    expect(SQL).toMatch(/\bCam\b/);
    expect(SQL).toMatch(/\bShire\b/);
    expect(SQL).toMatch(/do not place them/i);
  });
});

// ---------------------------------------------------------------------------
// §A.1 / §A.4 rendered — one write path, behind a confirm that says what moves
// ---------------------------------------------------------------------------
describe('fix-617 §A.4 — Team Structure confirms before it moves anybody', () => {
  const DMS = [
    member({ id: 'dm-d', name: 'Derry', role: 'dm' }),
    member({ id: 'dm-b', name: 'Brittani', role: 'dm' }),
  ];
  const DAS = [member({ id: 'da-e', name: 'Erick' })];

  function renderTs() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <TeamStructureEditor dms={DMS} activeDas={DAS} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tsState.error = null;
    tsState.rows = [
      {
        id: 'g1',
        dm_name: 'Derry',
        da_name: 'Erick',
        dm_order: 1,
        da_order: 1,
        updated_at: NOW,
      },
    ];
  });

  it('★★★ picking a new manager WRITES NOTHING until it is confirmed', () => {
    renderTs();
    fireEvent.change(screen.getByTestId('team-da-move-Erick'), {
      target: { value: 'Brittani' },
    });
    expect(tsMocks.setDm).not.toHaveBeenCalled();
    expect(screen.getByTestId('dm-move-confirm')).toBeTruthy();
  });

  it('★★ the dialog says what moves, with the counts', () => {
    renderTs();
    fireEvent.change(screen.getByTestId('team-da-move-Erick'), {
      target: { value: 'Brittani' },
    });
    const said = screen.getByTestId('dm-move-consequence').textContent ?? '';
    expect(said).toContain('14 open permits and 22 open tasks');
    expect(said).toContain('Brittani');
    expect(said).toContain('2026-Q4');
  });

  it('★★ confirming calls the ONE server function, once', () => {
    renderTs();
    fireEvent.change(screen.getByTestId('team-da-move-Erick'), {
      target: { value: 'Brittani' },
    });
    fireEvent.click(screen.getByTestId('dm-move-confirm-btn'));
    expect(tsMocks.setDm).toHaveBeenCalledTimes(1);
    expect(tsMocks.setDm.mock.calls[0][0]).toEqual({
      daName: 'Erick',
      dmName: 'Brittani',
    });
  });

  it('★★★ REMOVE is the same call with dmName: null, not a different operation', () => {
    renderTs();
    fireEvent.click(screen.getByTestId('team-chip-remove-Erick'));
    expect(tsMocks.setDm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('dm-move-confirm-btn'));
    expect(tsMocks.setDm.mock.calls[0][0]).toEqual({
      daName: 'Erick',
      dmName: null,
    });
  });

  it('★ ADD is the same call too', () => {
    renderTs();
    fireEvent.change(screen.getByTestId('team-add-da-select-Brittani'), {
      target: { value: 'Erick' },
    });
    fireEvent.click(screen.getByTestId('dm-move-confirm-btn'));
    expect(tsMocks.setDm.mock.calls[0][0]).toEqual({
      daName: 'Erick',
      dmName: 'Brittani',
    });
  });

  it('Cancel closes it and writes nothing', () => {
    renderTs();
    fireEvent.change(screen.getByTestId('team-da-move-Erick'), {
      target: { value: 'Brittani' },
    });
    fireEvent.click(screen.getByTestId('dm-move-cancel'));
    expect(screen.queryByTestId('dm-move-confirm')).toBeNull();
    expect(tsMocks.setDm).not.toHaveBeenCalled();
  });

  it('★★★ the fix-379 refusal is shown IN the dialog, in its own words', () => {
    // *"A departed associate keeps their mapping — mark them inactive on the
    //  roster instead."* The person is standing in front of the control that
    //  failed; the sentence telling them what to do instead belongs there.
    tsState.error = {
      message:
        'The Jade → Alex mapping cannot be removed: 4 permit(s) still name Alex '
        + 'as their design associate and the DM derivation reads this row. A '
        + 'departed associate keeps their mapping — mark them inactive on the '
        + 'roster instead. (fix-379)',
    };
    renderTs();
    fireEvent.click(screen.getByTestId('team-chip-remove-Erick'));
    const shown = screen.getByTestId('dm-move-error').textContent ?? '';
    expect(shown).toContain('mark them inactive on the roster instead');
    expect(shown).toContain('(fix-379)');
  });

  it('★ re-picking the manager they already have is not a move', () => {
    renderTs();
    fireEvent.change(screen.getByTestId('team-da-move-Erick'), {
      target: { value: 'Derry' },
    });
    expect(screen.queryByTestId('dm-move-confirm')).toBeNull();
    expect(tsMocks.setDm).not.toHaveBeenCalled();
  });
});
