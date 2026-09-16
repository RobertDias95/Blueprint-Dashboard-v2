import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMemberActiveInQuarter } from '../lib/teamQuarterHelpers';
import { LAYOUT_LOOKBACK_ROW_CAP } from '../hooks/useQuarterLayout';

// ===========================================================================
// fix-578 (P-284) — the Draw Schedule layout rolls forward
// ===========================================================================
//
// Bobby, 2026-09-15: *"I am noticing that Jade is not populating on future
// quarters… **It should be taking our current draw schedule and replicating
// that every quarter unless we go in there and make a change for the
// future.**"*
//
// ═══════════════════════════════════════════════════════════════════════════
// ★★★ §0 — THE MEASURED CAUSE, AND IT IS NOT WHAT THE BRIEF EXPECTED
// ═══════════════════════════════════════════════════════════════════════════
//
// The brief's candidate was that `groups` is built from DAs who have
// draw-schedule rows in the visible window, so a manager with no work booked in
// 2027 has an empty group. **That is wrong.** `groups` comes from
// `useDmDaGroups`, which reads `dm_da_groups` — a table with no quarter column
// at all. It cannot vary by quarter.
//
// ★★★ THE ACTUAL CHAIN, MEASURED ON PROD 2026-09-15:
//
//   1. A quarter with no saved layout takes the fallback and derives its
//      columns from `dm_da_groups`.
//   2. `filteredGroups` keeps a DA only if `isMemberActiveInQuarter(...)` or
//      they are in `forcedDAs` (work whose MAJORITY lands in the window).
//   3. **Jade's group in `dm_da_groups` is Alex + Nidhi, and both are
//      `active = false` with `active_end_quarter = '2026-Q1'`.**
//   4. For any quarter after 2026-Q1 both fail the predicate, `g.das` is empty,
//      and `.filter((g) => g.das.length > 0)` **drops the whole group**.
//   5. Neither has a draw row past 2026-03-09, so `forcedDAs` cannot rescue
//      them either.
//
// ★★★ SO §0's "ESTABLISHED" LIST WAS HALF RIGHT, AND THE HALF THAT WAS WRONG IS
//     THE ONE THAT MATTERED. *"Every active roster member has
//     `active_start_quarter` and `active_end_quarter` NULL"* is TRUE — and the
//     DAs doing the damage are **not active**. The filter runs over the names in
//     `dm_da_groups`, not over the active roster, so checking only active
//     members excluded the actual cause.
//
// ★★ AND IT IS NOT ONLY JADE. **Gena disappears identically** — her group is
//    George alone, `active_end_quarter = '2025-Q1'`. Two managers vanish in
//    2027-Q1, and only one was reported.
//
// ★ Why 2026-Q2/Q3/Q4 still show her: those quarters HAVE saved layout rows, so
//   the grid is in layout mode and never reaches the fallback. 2027 has none.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const hookSrc = read('src/hooks/useQuarterLayout.ts');
const gridSrc = read('src/components/DrawScheduleGrid.tsx');
const editorSrc = read('src/components/Settings/QuarterLayoutEditor.tsx');

// ---------------------------------------------------------------------------
// §0 · THE DIAGNOSIS, AS ARITHMETIC
// ---------------------------------------------------------------------------

describe('fix-578 §0 — why a manager vanishes from a future quarter', () => {
  // The two groups, exactly as `dm_da_groups` holds them on prod.
  const JADE = [
    { name: 'Alex', start: '2025-Q4', end: '2026-Q1' },
    { name: 'Nidhi', start: null, end: '2026-Q1' },
  ];
  const GENA = [{ name: 'George', start: null, end: '2025-Q1' }];
  const LINDSAY = [
    { name: 'Francesca', start: null, end: null },
    { name: 'Ainsley', start: null, end: null },
    { name: 'Trevor', start: null, end: null },
  ];

  const visible = (
    das: { start: string | null; end: string | null }[],
    quarter: string,
  ) => das.filter((d) => isMemberActiveInQuarter(d.start, d.end, quarter)).length;

  it('★★★ every DA in Jade’s group is inactive in 2027-Q1, so the group empties', () => {
    expect(visible(JADE, '2027-Q1')).toBe(0);
    // ★ …and the fallback drops a group with no DAs, which is the vanishing.
    expect(strip(gridSrc)).toContain('.filter((g) => g.das.length > 0)');
  });

  it('★★★ it is GENA too — two managers, and only one was reported', () => {
    expect(visible(GENA, '2027-Q1')).toBe(0);
    expect(visible(LINDSAY, '2027-Q1')).toBe(3);
  });

  it('★★★ the boundary is 2026-Q1 — the last quarter Jade survives the fallback', () => {
    // ★★ THE SHAPE OF THE BUG, PINNED: it is not "the future", it is "after the
    //    last quarter either of her DAs was active". Bobby saw it at 2027
    //    because 2026-Q2…Q4 carry saved layouts that bypass the fallback.
    expect(visible(JADE, '2026-Q1')).toBe(2);
    expect(visible(JADE, '2026-Q2')).toBe(0);
  });

  it('★★★ the brief’s candidate is ruled OUT — `groups` cannot vary by quarter', () => {
    // ★★★ `dm_da_groups` has no quarter column, and the hook that reads it takes
    //     no quarter argument. A manager's group is the same object in 2024 and
    //     in 2027, so "no work booked in 2027" cannot empty it.
    const dmHook = strip(read('src/hooks/useDmDaGroups.ts'));
    expect(dmHook).toContain("from('dm_da_groups')");
    expect(dmHook).not.toContain('quarter');
    expect(strip(gridSrc)).toContain('const groupsQ = useDmDaGroups();');
  });

  it('★★ `forcedDAs` cannot rescue them — neither has work that late', () => {
    // Measured: Alex's last draw row ends 2026-03-09, Nidhi's 2026-02-16,
    // George's 2025-03-17. `forcedDAs` needs a block whose MAJORITY lands in the
    // viewed window (fix-530 §E), so none of them qualifies in 2027.
    expect(strip(gridSrc)).toContain('blockMajorityInRange(');
  });
});

// ---------------------------------------------------------------------------
// §A · THE LAYOUT ROLLS FORWARD
// ---------------------------------------------------------------------------

describe('fix-578 §A — a quarter with no layout inherits the last saved one', () => {
  it('★★★ the query asks for `quarter <= asked`, newest first', () => {
    // ★★★ ONE QUERY FOR BOTH CASES. If the asked quarter has rows it IS the
    //     newest qualifying quarter, so the saved case and the inherited case
    //     are the same fetch — and which happened is read off `rows[0].quarter`.
    const h = strip(hookSrc);
    expect(h).toContain(".lte('quarter', quarter as string)");
    expect(h).toContain(".order('quarter', { ascending: false })");
    expect(h).toContain(".order('position', { ascending: true })");
    // ★ `eq` would be the old behaviour; its absence is the change.
    expect(h).not.toContain(".eq('quarter'");
  });

  it('★★★ only the leading run is returned — not a pile of older quarters', () => {
    const h = strip(hookSrc);
    expect(h).toContain('const donor = all.length > 0 ? all[0].quarter : null;');
    expect(h).toContain('all.filter((r) => r.quarter === donor)');
  });

  it('★★★ `inheritedFrom` is null when the quarter owns its layout', () => {
    // ★★★ THE DISTINCTION §A HAD TO BUY BACK. Inheriting on read makes "no
    //     layout" and "a saved layout" identical in the rows, so the flag is how
    //     an editing surface tells them apart.
    expect(strip(hookSrc)).toContain(
      'inheritedFrom: donor !== null && donor !== quarter ? donor : null,',
    );
  });

  it('★★★ AN EXPLICIT LAYOUT ALWAYS WINS — by sort order, not by a branch', () => {
    // ★ A branch could be got wrong; a sort cannot be half-applied. The asked
    //   quarter is the maximum of `quarter <= asked` whenever it has rows.
    const h = strip(hookSrc);
    const lte = h.indexOf(".lte('quarter'");
    const order = h.indexOf(".order('quarter', { ascending: false })");
    expect(lte).toBeGreaterThan(-1);
    expect(order).toBeGreaterThan(lte);
  });

  it('★★ the lookback is capped, and the cap clears a real team by 4×', () => {
    // ★ The donor is the FIRST run, so the cap only has to exceed ONE quarter's
    //   column count. Prod's widest is 12 (2026-Q1).
    expect(LAYOUT_LOOKBACK_ROW_CAP).toBe(64);
    expect(LAYOUT_LOOKBACK_ROW_CAP).toBeGreaterThan(12 * 4);
    expect(strip(hookSrc)).toContain('.limit(LAYOUT_LOOKBACK_ROW_CAP)');
  });

  it('★★★ NOTHING IS WRITTEN — inheriting on read issues no mutation', () => {
    // ★★★ THE REASON THIS SHAPE WAS CHOSEN OVER SEEDING. A seed fires on a VIEW,
    //     so it needs write permission merely to look — and the Draw Schedule is
    //     admin-write, view-only for most of the team (fix-220), so for them the
    //     seed would fail silently and the quarter would stay broken.
    const h = strip(hookSrc);
    expect(h).not.toContain('.insert(');
    expect(h).not.toContain('.upsert(');
    expect(h).not.toContain('useMutation');
    expect(h).not.toContain('rpc(');
  });

  it('★★★ editing a future quarter cannot touch a past one', () => {
    // ★★★ *"unless we go in there and make a change for the future"* — the half
    //     that rules OUT retroactive edits. `bp_replace_quarter_layout` deletes
    //     and inserts `WHERE quarter = p_quarter`, so a save reaches exactly the
    //     quarter being edited; inheritance is a READ and adds no write path.
    expect(strip(read('src/hooks/useReplaceQuarterLayout.ts'))).toContain(
      'p_quarter: quarter',
    );
  });
});

// ---------------------------------------------------------------------------
// §A2 · THE OCC TRAP THIS SHAPE CREATES, AND THE FIX
// ---------------------------------------------------------------------------

describe('fix-578 §A — an inherited quarter can actually be saved', () => {
  it('★★★ the OCC fingerprint is NULL when the rows came from elsewhere', () => {
    // ★★★ THE BUG THIS SHAPE WOULD OTHERWISE HAVE SHIPPED, and it is total:
    //     `layoutFingerprint` is `max(updated_at)` over the LOADED rows, while
    //     `bp_replace_quarter_layout` compares it to `max(updated_at)` FOR THE
    //     TARGET QUARTER. On an inherited quarter the target is empty (server
    //     reads NULL) and the donor carries a real timestamp — so every save
    //     would raise `40001 (conflict)` and **the layout could never be created
    //     at all.** Read off the live RPC, not assumed.
    //
    // ★★ NULL IS THE HONEST BASELINE, not an evasion: there is no prior version
    //    of THIS quarter to collide with, and the RPC still takes its advisory
    //    lock, so two people creating the same quarter at once are serialised.
    expect(strip(editorSrc)).toContain(
      'setLoadedFingerprint(inherited ? null : layoutFingerprint(rows));',
    );
  });

  it('★★ an absent flag does not read as "inherited"', () => {
    // ★ `undefined !== null` is TRUE, which would null the fingerprint on a real
    //   saved layout and quietly disable its OCC check.
    expect(strip(editorSrc)).toContain(
      'const inherited = Boolean(layoutQ.inheritedFrom);',
    );
  });

  it('★★★ the editor SAYS which layout it is showing, and names the donor', () => {
    // ★★★ THE COST §A ACCEPTED, PAID. Somebody must not reorder what they think
    //     is 2027-Q3's layout without being told they are creating one.
    expect(editorSrc).toContain('data-testid="ql-inherited-banner"');
    expect(editorSrc).toContain('{layoutQ.inheritedFrom}');
    expect(editorSrc).toContain('has no saved');
  });
});

// ---------------------------------------------------------------------------
// §B · THE EMPTY-GROUP DROP — the judgement, stated
// ---------------------------------------------------------------------------

describe('fix-578 §B — the fallback filter is LEFT ALONE, deliberately', () => {
  it('★★★ `.filter((g) => g.das.length > 0)` is unchanged', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // ★★★ THE JUDGEMENT, AND WHY IT IS "HIDDEN" RATHER THAN "SHOWN EMPTY"
    // ═══════════════════════════════════════════════════════════════════════
    //
    // §A makes the fallback UNREACHABLE for every quarter at or after the first
    // saved layout — and prod's first is 2024-Q1, which is the whole range
    // anybody works in. The only quarters still deriving columns are those
    // BEFORE any layout exists (the selector floors at 2023-Q1, fix-470 §2).
    //
    // ★★★ AND IN THOSE QUARTERS, HIDING IS CORRECT. A manager whose every DA
    //     was inactive in 2023 genuinely had no team then — rendering an empty
    //     column would assert a structure that did not exist, which is a
    //     different wrong answer, not a safer one.
    //
    // ★★ THE BRIEF'S OWN WARNING IS THE DECIDING ARGUMENT: *"Do not fix this by
    //    widening the fallback if §A makes the fallback unreachable in practice.
    //    Two fixes for one symptom is how the next person inherits a mystery."*
    //    Widening it would leave a second mechanism that never runs, and the
    //    next person debugging a missing column would have two places to look
    //    and no way to tell which one was responsible.
    expect(strip(gridSrc)).toContain('.filter((g) => g.das.length > 0)');
  });

  it('★★ the fallback still decides layout mode purely on row count', () => {
    // ★ Inherited rows ARE rows, so an inherited quarter is in layout mode and
    //   the derivation never runs — which is what makes §A the single fix.
    expect(strip(gridSrc)).toContain('const isLayoutMode = layoutRows.length > 0;');
  });
});

// ---------------------------------------------------------------------------
// §C · THE GAP IN THE MIDDLE
// ---------------------------------------------------------------------------

describe('fix-578 §C — a gap BETWEEN saved layouts is fixed by the same rule', () => {
  it('★★★ "newest at or before" covers a hole as well as the far end', () => {
    // ★★★ 2025-Q4 has no rows while 2025-Q3 and 2026-Q1 both do. The rule is
    //     `quarter <= asked ORDER BY quarter DESC`, which for 2025-Q4 selects
    //     2025-Q3 — the same single rule that gives 2027-Q1 its 2026-Q4 layout.
    //     There is no separate "gap" case to get wrong.
    //
    // ⚠️ IT INHERITS BACKWARDS, NEVER FORWARDS. 2025-Q4 shows 2025-Q3's layout,
    //    not 2026-Q1's, even though 2026-Q1 is nearer in one sense. A layout
    //    saved AFTER a quarter is a later decision about a later time; applying
    //    it backwards would rewrite what the team looked like then.
    const h = strip(hookSrc);
    expect(h).toContain(".lte('quarter', quarter as string)");
    expect(h).not.toContain(".gte('quarter'");
  });

  it('★★★ NOTHING IS BACKFILLED — the gap stays a gap in the table', () => {
    // ★ The brief: *"Do not backfill history — nobody asked, and a wrong guess
    //   about a past quarter's team is worse than a gap."* Inheriting on read
    //   writes nothing, so 2025-Q4 still has no rows; it simply renders
    //   2025-Q3's columns instead of falling back to derivation.
    expect(strip(hookSrc)).not.toContain('.insert(');
  });

  it('★★ a quarter before ANY saved layout still derives, and that is right', () => {
    // ★ There is nothing to inherit from, so `donor` is null and `rows` is
    //   empty — `isLayoutMode` is false and the old path runs, unchanged. The
    //   floor is 2023-Q1 and the earliest layout is 2024-Q1.
    expect(strip(hookSrc)).toContain(
      'const rows = donor === null ? [] : all.filter((r) => r.quarter === donor);',
    );
  });
});
