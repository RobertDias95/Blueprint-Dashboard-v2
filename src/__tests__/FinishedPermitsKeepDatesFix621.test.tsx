import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UnitType } from '../lib/database.types';
import {
  isFinishedPermit,
  isOpenPermit,
  countFinishedPermits,
  finishedPermitsNote,
  finishedPermitsNoteAcross,
} from '../lib/finishedPermits';
import { isPermitDone } from '../lib/projectViewHelpers';
import OverlapPrompt from '../components/OverlapPrompt';
import UnitTypesEditor from '../components/wizard/UnitTypesEditor';

// ===========================================================================
// ★★★ fix-621 (P-316) — a block move leaves finished permits' dates alone ·
//     the wizard keeps a custom roof-deck pick
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-03 (popup): **"Approved/issued keep them"**
//
// ★ NO LIVE DATABASE IN CI, so the server half is pinned the way this repo has
//   pinned SQL since fix-153: assertions on the staged migration's text, plus a
//   pure TS mirror of the predicate tested for real.

const SRC = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');
const SQL = readFileSync(
  resolve(SRC, '../migrations/fix_621_finished_permits_keep_their_dates.sql'),
  'utf8',
);

/** ★★ Comments stripped before asserting on code, and CRLF normalised FIRST:
 *  `\r` is a JS regex line terminator, so `/\/\/.*$/m` against CRLF text matches
 *  nothing past the split (fix-608 lost a whole sweep to exactly that). Every
 *  file here documents its own reasoning at length, so a grep for a rule keeps
 *  finding the prose that describes it. */
function code(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The migration's patch table, as (fn, seq, anchor, repl) tuples. Parsed rather
 *  than restated so a test cannot drift from the file it is about. */
function patches(): { fn: string; seq: number; anchor: string; repl: string }[] {
  const start = SQL.indexOf('    FROM (VALUES');
  const end = SQL.indexOf('    ) AS t(fn, seq, anchor, repl)');
  expect(start, 'the VALUES table is found').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = SQL.slice(start, end);
  const re =
    /\(\s*'(bp_[a-z_]+)'\s*,\s*(\d+)\s*,\s*E'((?:[^']|'')*)'\s*,\s*E'((?:[^']|'')*)'\s*\)/g;
  const out: { fn: string; seq: number; anchor: string; repl: string }[] = [];
  const unesc = (x: string) => x.replace(/''/g, "'").replace(/\\n/g, '\n');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({ fn: m[1], seq: Number(m[2]), anchor: unesc(m[3]), repl: unesc(m[4]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §A — the server rule, in every path §0 found
// ---------------------------------------------------------------------------
describe('fix-621 §A — every block path carries the guard', () => {
  it('★★★ all SEVEN functions §0 named are patched, and no others', () => {
    const byFn = new Map<string, number>();
    for (const p of patches()) byFn.set(p.fn, (byFn.get(p.fn) ?? 0) + 1);
    // The count is the number of permit writes each one makes. A body that grows
    // an eighth write without a guard is the regression this pins.
    expect(Object.fromEntries([...byFn].sort())).toEqual({
      // drag / resize: dd, target (BP), target (anchor fallback)
      bp_update_draw_schedule_with_dd_sync: 3,
      // Push Down: anchor dd + 2 target, pushed dd + 2 target
      bp_resolve_da_overlap: 6,
      // the DD-dates editor: the set path and the CLEAR path
      bp_set_bp_dd_dates: 2,
      // a lane move
      bp_move_draw_schedule_da: 3,
      // the gap compactor
      bp_shift_da_blocks_up: 3,
      // first placement
      bp_place_new_project_on_da: 2,
      // the engine: 2 declarations/selects + the BP guard + the loop + fix-585
      bp_recompute_target_submits: 5,
    });
  });

  it('★★★ every replacement that touches a permit write adds the predicate', () => {
    const writes = patches().filter((p) => /UPDATE\s+(public\.)?permits/.test(p.anchor));
    // 19 of the 24: the engine's five are declaration/select/guard edits.
    expect(writes).toHaveLength(19);
    for (const p of writes) {
      expect(
        p.repl,
        `${p.fn}/${p.seq} must guard its permit write`,
      ).toContain('NOT public.bp_permit_is_finished(approval_date, actual_issue)');
      // ★ And the anchor must NOT already carry it — otherwise the patch is a
      //   no-op dressed up as a fix.
      expect(p.anchor).not.toContain('bp_permit_is_finished');
    }
  });

  it('★★★ the engine guards the BUILDING PERMIT, which fix-585 did not', () => {
    // fix-585 added "done is done" to the `type <> 'Building Permit'` loop only.
    // These two patches are the BP's own paths — the common case: measured
    // 2026-10-03, 220 of 267 projects with a BP have a finished one.
    const eng = patches().filter((p) => p.fn === 'bp_recompute_target_submits');
    const guards = eng.filter((p) =>
      /NOT public\.bp_permit_is_finished\(v_bp_approval, v_bp_actual\)|bp_permit_is_finished\(v_permit\.approval_date, v_permit\.actual_issue\)/.test(
        p.repl,
      ),
    );
    expect(guards).toHaveLength(3); // the pre-loop block, the BP loop, fix-585's
    // ★ fix-585's RULE SURVIVES, restated through the shared predicate rather
    //   than deleted — the comment that records it is still there.
    const fix585 = eng.find((p) => p.anchor.includes('fix-585: done is done'));
    expect(fix585, 'fix-585s loop is still guarded').toBeTruthy();
    expect(fix585!.repl).toContain('fix-585: done is done');
    expect(fix585!.repl).toContain('bp_permit_is_finished');
  });

  it('★★ the predicate is IMMUTABLE, takes the two dates, and is not anon-callable', () => {
    const c = code(SQL);
    expect(c).toMatch(
      /CREATE OR REPLACE FUNCTION public\.bp_permit_is_finished\(\s*p_approval_date date,\s*p_actual_issue\s+date\s*\)/,
    );
    expect(c).toContain('IMMUTABLE');
    expect(c).toContain(
      'REVOKE ALL ON FUNCTION public.bp_permit_is_finished(date, date) FROM public, anon;',
    );
    expect(c).toContain(
      'GRANT EXECUTE ON FUNCTION public.bp_permit_is_finished(date, date) TO authenticated;',
    );
    // ★ `FROM anon` alone is the fix-157 hole: anon inherits the PUBLIC grant.
    expect(c).not.toMatch(/REVOKE ALL ON FUNCTION[^;]*FROM anon;/);
  });

  it('★★★ the migration changes NO DATA', () => {
    // Every statement is a function definition or a grant. The patch table's
    // string literals contain the word UPDATE, and the DO block EXECUTEs bodies
    // that contain UPDATEs — so the question has to be asked of the statements
    // that run on apply, which means outside the DO block and outside the
    // function it patches.
    const c = code(SQL);
    const doStart = c.indexOf('DO $patch$');
    const doEnd = c.indexOf('$patch$;');
    expect(doStart).toBeGreaterThan(-1);
    expect(doEnd).toBeGreaterThan(doStart);
    const topLevel = c.slice(0, doStart) + c.slice(doEnd + '$patch$;'.length);
    expect(
      topLevel.match(
        /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE|DROP TABLE|ALTER TABLE)\s+(public\.)?(permits|projects|draw_schedule|permit_cycles)\b/g,
      ),
    ).toBeNull();
  });

  it('★★ an anchor that no longer matches FAILS the apply instead of no-opping', () => {
    // The whole file rests on this: it never retypes a body, it patches the live
    // one. A `replace()` that silently matched nothing would ship a migration
    // that appears to succeed and changes nothing.
    const c = code(SQL);
    expect(c).toMatch(/v_hits\s*<>\s*1/);
    expect(c).toMatch(/RAISE EXCEPTION/);
    expect(c).toContain('pg_get_functiondef');
    // ★ CRLF normalised before matching — see the note in the file.
    expect(c).toContain("replace(v_def, chr(13), '')");
  });
});

// ---------------------------------------------------------------------------
// §A — the predicate itself
// ---------------------------------------------------------------------------
describe('fix-621 — isFinishedPermit, the TS twin', () => {
  it('either date is enough; neither is open', () => {
    expect(isFinishedPermit({ approval_date: '2026-05-01', actual_issue: null })).toBe(true);
    expect(isFinishedPermit({ approval_date: null, actual_issue: '2026-06-01' })).toBe(true);
    expect(isFinishedPermit({ approval_date: '2026-05-01', actual_issue: '2026-06-01' })).toBe(true);
    expect(isFinishedPermit({ approval_date: null, actual_issue: null })).toBe(false);
    expect(isFinishedPermit({})).toBe(false);
    expect(isFinishedPermit(null)).toBe(false);
    expect(isOpenPermit({ approval_date: null, actual_issue: null })).toBe(true);
  });

  it('★★★ it is NOT isPermitDone, and the two disagree BOTH ways', () => {
    // Measured on prod 2026-10-03: 63 permits are approved but not isPermitDone,
    // and 5 are isPermitDone but neither approved nor issued.
    const approvedOnly = { approval_date: '2026-05-01', actual_issue: null, status: 'Reviews In Process' };
    expect(isFinishedPermit(approvedOnly)).toBe(true);
    expect(isPermitDone(approvedOnly)).toBe(false); // ← the 63

    const withdrawn = { approval_date: null, actual_issue: null, status: 'Withdrawn' };
    expect(isFinishedPermit(withdrawn)).toBe(false); // ← the 5
    expect(isPermitDone(withdrawn)).toBe(true);
  });

  it('counts and totals across projects', () => {
    const rows = [
      { approval_date: '2026-01-01', actual_issue: null },
      { approval_date: null, actual_issue: null },
      { approval_date: null, actual_issue: '2026-02-02' },
    ];
    expect(countFinishedPermits(rows)).toBe(2);
    expect(countFinishedPermits([])).toBe(0);
    expect(countFinishedPermits(undefined)).toBe(0);
  });
});

describe('fix-621 — the one plain line', () => {
  const approved = { approval_date: '2026-01-01', actual_issue: null };
  const issued = { approval_date: null, actual_issue: '2026-02-02' };
  const open = { approval_date: null, actual_issue: null };

  it('the brief\'s sentence, word for word', () => {
    expect(finishedPermitsNote([approved, approved, open])).toBe(
      '2 approved permits keep their dates.',
    );
  });

  it('★★ says "issued" when they are issued — calling those approved is a small lie', () => {
    expect(finishedPermitsNote([issued, issued])).toBe('2 issued permits keep their dates.');
    expect(finishedPermitsNote([approved, issued])).toBe(
      '2 approved or issued permits keep their dates.',
    );
  });

  it('singular, and null when the rule does not apply', () => {
    expect(finishedPermitsNote([approved, open])).toBe(
      '1 approved permit keeps its dates.',
    );
    expect(finishedPermitsNote([open, open])).toBeNull();
    expect(finishedPermitsNote([])).toBeNull();
    expect(finishedPermitsNote(undefined)).toBeNull();
  });

  it('★★ a Push Down counts the anchor AND every project it displaces', () => {
    expect(finishedPermitsNoteAcross([[approved, open], [issued], [open]])).toBe(
      '2 approved or issued permits keep their dates.',
    );
    expect(finishedPermitsNoteAcross([[open], [open]])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §A — the optimistic cache mirrors the rule
// ---------------------------------------------------------------------------
describe('fix-621 §A — the optimistic patches skip finished permits', () => {
  // ★★ WHY A SOURCE ASSERTION. Both patches are closures inside a mutation's
  //    `onMutate` / `onSuccess`, reachable only by driving the whole hook with a
  //    mocked supabase and a QueryClient. What matters is that the skip is
  //    there at all: without it the row visibly changes and then snaps back when
  //    the refetch lands — a lie with a delay on it, which is worse than a flash
  //    of the truth. The behaviour it protects is the server's, and that is
  //    pinned above.
  it('★★★ both hooks that patch permits optimistically carry the skip', () => {
    for (const f of ['hooks/useUpdateDrawSchedule.ts', 'hooks/useSetBpDdDates.ts']) {
      const c = code(read(f));
      expect(c, `${f} imports the mirror`).toContain(
        "from '../lib/finishedPermits'",
      );
      expect(c, `${f} skips a finished permit`).toMatch(
        /if \(isFinishedPermit\(p\)\) return p;/,
      );
    }
  });

  it('★ and no OTHER hook patches permit dd dates without it', () => {
    // useResolveDaOverlap and useMoveDrawScheduleDa patch `draw_schedule` only —
    // the lane still moves, which is the point. If either ever starts patching
    // permits, this says so.
    for (const f of ['hooks/useResolveDaOverlap.ts', 'hooks/useMoveDrawScheduleDa.ts']) {
      const c = code(read(f));
      expect(c, `${f} must not patch permit dd dates`).not.toMatch(
        /dd_start:\s*(newDdStart|input\.|v_)/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §A — the confirm says it
// ---------------------------------------------------------------------------
describe('fix-621 §A — the Push Down prompt says what it will leave alone', () => {
  const base = {
    anchorAddress: '1234 Main St',
    conflictingAddresses: ['5678 Oak Ave'],
    conflictCount: 1,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    pending: false,
  };

  it('★★★ renders the line when it applies', () => {
    render(<OverlapPrompt {...base} finishedNote="2 approved permits keep their dates." />);
    expect(screen.getByTestId('overlap-prompt-finished-note').textContent).toBe(
      '2 approved permits keep their dates.',
    );
  });

  it('★★ and renders NOTHING when it does not', () => {
    // A line reading "0 permits keep their dates" on every ordinary move would
    // train people to stop reading it.
    render(<OverlapPrompt {...base} finishedNote={null} />);
    expect(screen.queryByTestId('overlap-prompt-finished-note')).toBeNull();
    render(<OverlapPrompt {...base} />);
    expect(screen.queryByTestId('overlap-prompt-finished-note')).toBeNull();
  });

  it('★★ the grid passes it, computed across the anchor AND the pushed blocks', () => {
    const c = code(read('components/DrawScheduleGrid.tsx'));
    expect(c).toContain('finishedNote={pendingOverlap.finishedNote}');
    // Both drop paths (resize preview and drag) capture it.
    expect(c.match(/finishedPermitsNoteAcross\(/g)?.length).toBe(2);
    expect(c).toMatch(/decision\.conflictingProjectIds\]\.map\(/);
  });

  it('★★★ the DD-dates editor says it too, where the anchor is usually finished', () => {
    const c = code(read('components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(c).toContain("from '../../lib/finishedPermits'");
    expect(c).toMatch(/const ddFinishedNote = useMemo\(\(\) => finishedPermitsNote\(permits\)/);
    expect(c).toContain('data-testid="pd-dd-finished-note"');
    expect(c).toContain('finishedNote={ddFinishedNote}');
  });
});

// ---------------------------------------------------------------------------
// §B — the wizard keeps a custom roof-deck pick
// ---------------------------------------------------------------------------
describe('fix-621 §B — the wizard keeps a custom roof-deck pick', () => {
  const OPTS = ['W/ PH', 'W/O PH', 'None', 'Rooftop terrace'];

  function row(over: Partial<UnitType> = {}): UnitType {
    return { label: 'Type A', width_ft: null, depth_ft: null, qty: 1, ...over } as UnitType;
  }

  it('★★★ picking a custom option keeps the LABEL instead of dropping it', () => {
    // fix-619 made this work on the project page and in the Library;
    // `roofDeckValueFor('Rooftop terrace')` returns both booleans null and the
    // label as written, and the wizard used to write only the booleans — so the
    // pick became all-nulls, "not recorded", with no error.
    const onChange = vi.fn();
    render(
      <UnitTypesEditor
        value={[row()]}
        onChange={onChange}
        roofDeckOptions={OPTS}
      />,
    );
    fireEvent.change(screen.getByTestId('unit-types-roof-deck-0'), {
      target: { value: 'Rooftop terrace' },
    });
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].roof_deck_label).toBe('Rooftop terrace');
    expect(next[0].roof_deck).toBeNull();
    expect(next[0].penthouse).toBeNull();
  });

  it('★★ one of the three decoded answers still stores as booleans, label cleared', () => {
    const onChange = vi.fn();
    render(
      <UnitTypesEditor
        value={[row({ roof_deck_label: 'Rooftop terrace' })]}
        onChange={onChange}
        roofDeckOptions={OPTS}
      />,
    );
    fireEvent.change(screen.getByTestId('unit-types-roof-deck-0'), {
      target: { value: 'W/ PH' },
    });
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].roof_deck).toBe(true);
    expect(next[0].penthouse).toBe(true);
    expect(next[0].roof_deck_label).toBeNull();
  });

  it('★★★ a stored custom label RENDERS — a blank select would claim it was empty', () => {
    render(
      <UnitTypesEditor
        value={[row({ roof_deck: null, penthouse: null, roof_deck_label: 'Rooftop terrace' })]}
        onChange={vi.fn()}
        roofDeckOptions={OPTS}
      />,
    );
    expect(
      (screen.getByTestId('unit-types-roof-deck-0') as HTMLSelectElement).value,
    ).toBe('Rooftop terrace');
  });

  it('★ a new row names the field, like the rest of the seed', () => {
    const onChange = vi.fn();
    render(<UnitTypesEditor value={[]} onChange={onChange} roofDeckOptions={OPTS} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].roof_deck_label).toBeNull();
  });

  it('★★ all THREE editors that can write the label now write it', () => {
    // fix-619's own test said "both editors" and named two. That was true of
    // fix-619's scope; the wizard is the third and is what §B adds.
    for (const f of [
      'components/ProjectDetail/ProjectDataEditors.tsx',
      'components/LibraryMatrix.tsx',
      'components/wizard/UnitTypesEditor.tsx',
    ]) {
      expect(code(read(f)), f).toMatch(/roof_deck_label: v\?\.label \?\? null/);
    }
  });
});
