import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  currentWeekMonday,
  finishedBlockRefusal,
  formatBlockWeeks,
  isStartedBlock,
  type LaneBlock,
} from '../lib/finishedBlocks';
import {
  BLOCK_OVERLAP_SQLSTATE,
  isBlockOverlapRefusal,
  shouldSkipBackendRpcLog,
} from '../lib/errorLogger';
import BlockOverlapPrompt from '../components/BlockOverlapPrompt';
import { useBlockOverlapStore } from '../stores/blockOverlapStore';

// ===========================================================================
// fix-620 (P-315) — finished blocks never move, and an overlap asks to be fixed
// ===========================================================================
//
// The SQL (migrations/fix_620_finished_blocks_never_move.sql) is the rule; CI
// has no database, so its behaviour was proved by a rolled-back prod probe
// (pg_temp copies on temp tables — see the PR), and here we hold
//   · the TS mirror the grid asks first, and
//   · the migration's text to the decisions that matter.

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8').split('\r\n').join('\n');
const SQL = read('migrations/fix_620_finished_blocks_never_move.sql');
/** SQL without `--` comments, so a comment can't satisfy an assertion. */
const SQL_CODE = SQL.replace(/--.*$/gm, '');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MONDAY = '2026-09-28';
const ADDR: Record<string, string> = {
  holly: '4409 S Holly St',
  clover: '1225 S Cloverdale St',
  up1: '100 Upcoming Ave',
  pairA: '1 Pair St',
  pairB: '2 Pair St',
};
const addressOf = (pid: string) => ADDR[pid];

// Marc's lane, shaped like prod on 10-02.
const LANE: LaneBlock[] = [
  { projectId: 'clover', startWeek: '2024-05-20', endWeek: '2024-05-27' },
  { projectId: 'holly', startWeek: '2024-06-24', endWeek: '2024-07-01' },
  { projectId: 'up1', startWeek: '2026-10-12', endWeek: '2026-10-26' },
];

const base = {
  laneBlocks: LANE,
  lane: 'Marc',
  monday: MONDAY,
  addressOf,
};

afterEach(() => useBlockOverlapStore.getState().dismiss());

// ---------------------------------------------------------------------------
describe('fix-620: what "started" means', () => {
  it('★★ the current week\'s Monday, from the viewer\'s local date', () => {
    expect(currentWeekMonday(new Date(2026, 9, 2, 15))).toBe('2026-09-28'); // Fri
    expect(currentWeekMonday(new Date(2026, 9, 4, 22))).toBe('2026-09-28'); // Sun night
    expect(currentWeekMonday(new Date(2026, 8, 28, 0, 5))).toBe('2026-09-28'); // Mon
  });
  it('★ a block that began before this Monday has started; this week\'s has not', () => {
    expect(isStartedBlock('2026-09-21', MONDAY)).toBe(true);
    expect(isStartedBlock('2026-09-28', MONDAY)).toBe(false);
  });
  it('★ weeks read like the SQL\'s to_char', () => {
    expect(formatBlockWeeks('2024-06-24', '2024-07-01')).toBe('Jun 24 – Jul 1, 2024');
    expect(formatBlockWeeks('2024-12-30', '2025-01-06')).toBe('Dec 30, 2024 – Jan 6, 2025');
  });
});

// ---------------------------------------------------------------------------
describe('fix-620 §B: an overlap with finished work is refused, by name', () => {
  it('★★★ a BACKFILLED past block over a past block → the sentence naming it', () => {
    expect(
      finishedBlockRefusal({
        ...base,
        projectId: 'new',
        startWeek: '2024-06-24',
        endWeek: '2024-07-01',
        oldLane: null,
        oldStartWeek: null,
        oldEndWeek: null,
      }),
    ).toBe(
      "This overlaps 4409 S Holly St (Jun 24 – Jul 1, 2024). Finished blocks don't move — choose other weeks or another lane.",
    );
  });

  it('★★★ a DRAG into a started block → refused (both named, in week order)', () => {
    expect(
      finishedBlockRefusal({
        ...base,
        projectId: 'up1',
        startWeek: '2024-05-13',
        endWeek: '2024-07-08',
        oldLane: 'Marc',
        oldStartWeek: '2026-10-12',
        oldEndWeek: '2026-10-26',
      }),
    ).toBe(
      "This overlaps 1225 S Cloverdale St (May 20 – May 27, 2024) and 4409 S Holly St (Jun 24 – Jul 1, 2024). Finished blocks don't move — choose other weeks or another lane.",
    );
  });

  it('★★★ a RESIZE that grows into a started block → refused', () => {
    expect(
      finishedBlockRefusal({
        ...base,
        projectId: 'clover',
        startWeek: '2024-05-20',
        endWeek: '2024-06-24',
        oldLane: 'Marc',
        oldStartWeek: '2024-05-20',
        oldEndWeek: '2024-05-27',
      }),
    ).toMatch(/^This overlaps 4409 S Holly St \(Jun 24 – Jul 1, 2024\)\./);
  });

  it('★★★ upcoming over upcoming is NOT refused — Push Down still clears it', () => {
    expect(
      finishedBlockRefusal({
        ...base,
        projectId: 'new',
        startWeek: '2026-10-05',
        endWeek: '2026-10-19',
        oldLane: null,
        oldStartWeek: null,
        oldEndWeek: null,
      }),
    ).toBeNull();
  });

  it('★★★ an edit to an ALREADY-overlapping pair that does not grow it is allowed', () => {
    const lane: LaneBlock[] = [
      { projectId: 'pairA', startWeek: '2026-06-01', endWeek: '2026-06-15' },
      { projectId: 'pairB', startWeek: '2026-06-15', endWeek: '2026-06-29' },
    ];
    const edit = (endWeek: string) =>
      finishedBlockRefusal({
        ...base,
        laneBlocks: lane,
        projectId: 'pairA',
        startWeek: '2026-06-01',
        endWeek,
        oldLane: 'Marc',
        oldStartWeek: '2026-06-01',
        oldEndWeek: '2026-06-15',
      });
    expect(edit('2026-06-15')).toBeNull(); // unchanged (a status / notes save)
    expect(edit('2026-06-08')).toBeNull(); // shrinks away
    expect(edit('2026-06-22')).toMatch(/^This overlaps 2 Pair St/); // grows → refused
  });

  it('★ the same weeks in ANOTHER lane count as new, not as the old overlap', () => {
    expect(
      finishedBlockRefusal({
        ...base,
        projectId: 'holly2',
        startWeek: '2024-06-24',
        endWeek: '2024-06-24',
        oldLane: 'Qisheng',
        oldStartWeek: '2024-06-24',
        oldEndWeek: '2024-06-24',
      }),
    ).toMatch(/^This overlaps 4409 S Holly St/);
  });

  it('★ more than three: the first three by week, then "and N more"', () => {
    const lane: LaneBlock[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      projectId: id,
      startWeek: `2024-0${i + 1}-01`,
      endWeek: `2024-0${i + 1}-08`,
    }));
    const msg = finishedBlockRefusal({
      ...base,
      laneBlocks: lane,
      addressOf: (pid) => `${pid.toUpperCase()} St`,
      projectId: 'new',
      startWeek: '2024-01-01',
      endWeek: '2024-06-01',
      oldLane: null,
      oldStartWeek: null,
      oldEndWeek: null,
    });
    expect(msg).toMatch(/^This overlaps A St \(.*\), B St \(.*\), C St \(.*\) and 2 more\./);
  });
});

// ---------------------------------------------------------------------------
describe('fix-620 §A: the server never moves a started block', () => {
  const resolveBody = SQL_CODE.slice(
    SQL_CODE.indexOf('CREATE OR REPLACE FUNCTION public.bp_resolve_da_overlap('),
    SQL_CODE.indexOf('$function$;', SQL_CODE.indexOf('CREATE OR REPLACE FUNCTION public.bp_resolve_da_overlap(')),
  );

  it('★★★ Push Down skips every block that started before this Monday', () => {
    expect(resolveBody).toMatch(
      /FOR v_block IN[\s\S]*?LOOP\s*IF bp_week_key_to_date\(v_block\.start_week\) < v_monday THEN\s*CONTINUE;/,
    );
  });

  it('★★ a still-running started block is an OBSTACLE the push jumps past', () => {
    expect(resolveBody).toMatch(/FROM public\.draw_schedule ds3[\s\S]*?bp_week_key_to_date\(ds3\.start_week\) <\s*v_monday/);
  });

  it('★★★ NP behaviour unchanged: the fix-24a NP jump is still in the loop', () => {
    expect(resolveBody).toMatch(/FROM public\.da_time_blocks tb\s*WHERE tb\.da_name = p_target_da/);
    // …and no other mover is touched.
    expect(SQL_CODE).not.toMatch(/FUNCTION public\.bp_shift_da_blocks_up/);
    expect(SQL_CODE).not.toMatch(/FUNCTION public\.bp_place_new_project_on_da/);
  });

  it('★★ Push Down refuses BEFORE it writes when the target lands on finished work', () => {
    const refuse = resolveBody.indexOf('RAISE EXCEPTION USING ERRCODE = \'P0620\'');
    const firstWrite = resolveBody.indexOf('UPDATE public.draw_schedule');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(firstWrite);
  });

  it('★★ every path obeys: a DEFERRED constraint trigger, judged on the final row', () => {
    expect(SQL_CODE).toMatch(
      /CREATE CONSTRAINT TRIGGER bp_draw_schedule_no_overlap\s+AFTER INSERT OR UPDATE OF da_assigned, start_week, end_week ON public\.draw_schedule\s+DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(SQL_CODE).toMatch(/RAISE EXCEPTION USING ERRCODE = 'P0620', MESSAGE = v_msg/);
  });

  it('★★ the SQL and the mirror say the same sentence', () => {
    expect(SQL_CODE).toContain(
      "'. Finished blocks don''t move — choose other weeks or another lane.'",
    );
    expect(read('src/lib/finishedBlocks.ts')).toContain(
      "Finished blocks don't move — choose other weeks or another lane.",
    );
  });

  it('★ no anon EXECUTE, and the migration writes no rows', () => {
    expect(SQL_CODE).toMatch(/REVOKE ALL ON FUNCTION public\.bp_draw_overlap_refusal\([^)]*\) FROM PUBLIC, anon;/);
    expect(SQL_CODE).toMatch(/REVOKE ALL ON FUNCTION public\.bp_draw_current_monday\(\) FROM PUBLIC, anon;/);
    // Every UPDATE/INSERT/DELETE is inside a function body.
    const outside = SQL_CODE.split(/\$function\$[\s\S]*?\$function\$/).join('');
    expect(outside).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/m);
  });
});

// ---------------------------------------------------------------------------
describe('fix-620: the refusal is a prompt, not a Triage entry', () => {
  const refusal = {
    code: BLOCK_OVERLAP_SQLSTATE,
    message: "This overlaps 4409 S Holly St (Jun 24 – Jul 1, 2024). Finished blocks don't move — choose other weeks or another lane.",
  };
  it('★★★ P0620 is recognised and NOT filed to Triage', () => {
    expect(isBlockOverlapRefusal(refusal)).toBe(true);
    expect(shouldSkipBackendRpcLog(refusal, ['draw_schedule'])).toBe(true);
  });
  it('★★★ …while any other failure still reports', () => {
    const other = { code: 'P0001', message: 'Push-down exploded' };
    expect(isBlockOverlapRefusal(other)).toBe(false);
    expect(shouldSkipBackendRpcLog(other, ['draw_schedule'])).toBe(false);
    // ★ matched on the CODE, never the wording (fix-357)
    expect(isBlockOverlapRefusal({ message: refusal.message })).toBe(false);
  });

  it('★★ the prompt shows the sentence and closes by button or Escape', () => {
    render(<BlockOverlapPrompt />);
    expect(screen.queryByTestId('block-overlap-prompt')).toBeNull();
    act(() => useBlockOverlapStore.getState().show(refusal.message));
    expect(screen.getByTestId('block-overlap-prompt-message')).toHaveTextContent(refusal.message);
    fireEvent.click(screen.getByTestId('block-overlap-prompt-ok'));
    expect(screen.queryByTestId('block-overlap-prompt')).toBeNull();
    act(() => useBlockOverlapStore.getState().show(refusal.message));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('block-overlap-prompt')).toBeNull();
  });

  it('★★ App routes the refusal to the prompt before the save-failure banner', () => {
    const app = code(read('src/App.tsx'));
    const guard = app.indexOf('if (isBlockOverlapRefusal(err))');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(app.indexOf('useSaveFailureStore.getState().report('));
    expect(app).toContain('<BlockOverlapPrompt />');
  });

  it('★ no draw-schedule hook toasts the refusal a second time', () => {
    for (const hook of [
      'useResolveDaOverlap',
      'useUpdateDrawSchedule',
      'useMoveDrawScheduleDa',
      'useSetBpDdDates',
      'useUpdateDsRow',
      'useCreateProjectWithPermits',
      'useUpdateRedesignDdPhase',
      'usePlaceNewProjectOnDa',
      'useShiftDaBlocksUp',
    ]) {
      expect(code(read(`src/hooks/${hook}.ts`)), hook).toMatch(/if \(isBlockOverlapRefusal\(\w+\)\) return;/);
    }
  });

  it('★★ the grid asks the mirror BEFORE offering Push Down — drop and resize', () => {
    const grid = code(read('src/components/DrawScheduleGrid.tsx'));
    const calls = [...grid.matchAll(/finishedBlockRefusal\(/g)].map((m) => m.index ?? 0);
    expect(calls).toHaveLength(2);
    for (const at of calls) {
      const next = grid.indexOf('decideDrop(', at);
      expect(next).toBeGreaterThan(at);
    }
    expect(code(read('src/components/ProjectDetail/ProjectDataEditors.tsx'))).toMatch(
      /finishedBlockRefusal\([\s\S]*?setPendingOverlap\(\{/,
    );
  });
});
