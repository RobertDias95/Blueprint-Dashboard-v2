import { describe, it, expect } from 'vitest';
import {
  sortProjectRows,
  minTargetSubmit,
  type ProjectRow,
  type SortState,
} from '../lib/projectViewHelpers';

// fix-142: Projects list "Target Submit" sort. Per project, the sort key is
// min(target_submit) across ALL the project's permits where target_submit is
// non-null (every permit type, not just the BP). Projects with no permits OR
// all-null target_submit sort LAST in both directions; two such projects
// tie-break by address asc.

/** Minimal ProjectRow — sortProjectRows / minTargetSubmit only read
 *  project.id, project.address, and permits[].permit.target_submit. */
function row(id: string, address: string, targets: (string | null)[]): ProjectRow {
  return {
    project: { id, address } as ProjectRow['project'],
    permits: targets.map((t) => ({
      permit: { target_submit: t },
    })) as ProjectRow['permits'],
    bpAnchor: null,
    stages: new Set(),
    entLeads: new Set(),
    das: new Set(),
  } as ProjectRow;
}

const ASC: SortState = { col: 'target_submit', asc: true };
const DESC: SortState = { col: 'target_submit', asc: false };

const ids = (rows: ProjectRow[]) => rows.map((r) => r.project.id);

describe('minTargetSubmit', () => {
  it('returns the earliest non-null target_submit across all permit types', () => {
    expect(minTargetSubmit(row('A', 'A st', ['2026-08-01', '2026-09-15']))).toBe(
      '2026-08-01',
    );
  });
  it('ignores null permits and uses the only non-null (mixed case)', () => {
    expect(minTargetSubmit(row('E', 'E st', ['2026-07-20', null]))).toBe(
      '2026-07-20',
    );
  });
  it('returns null when every permit target_submit is null', () => {
    expect(minTargetSubmit(row('C', 'C st', [null, null]))).toBeNull();
  });
  it('returns null when the project has no permits', () => {
    expect(minTargetSubmit(row('D', 'D st', []))).toBeNull();
  });
});

describe('sortProjectRows — target_submit', () => {
  // A: min 2026-08-01 (multi-permit), B: 2026-07-15, C: all-null,
  // D: no permits, E: 2026-07-20 (mixed null/non-null).
  const fixture = () => [
    row('A', 'A st', ['2026-08-01', '2026-09-15']),
    row('B', 'B st', ['2026-07-15']),
    row('C', 'C st', [null, null]),
    row('D', 'D st', []),
    row('E', 'E st', ['2026-07-20', null]),
  ];

  it('soonest first: orders by min(target_submit), nulls (all-null + no-permits) last', () => {
    // case 1 (B < A on min), case 4 (E uses 2026-07-20), case 2 + 3 (C, D last).
    expect(ids(sortProjectRows(fixture(), ASC))).toEqual([
      'B', // 2026-07-15
      'E', // 2026-07-20
      'A', // 2026-08-01
      'C', // null  ─ tie-break by address asc
      'D', // null  ┘
    ]);
  });

  it('latest first: reverses the non-null sequence, nulls still last', () => {
    // case 5.
    expect(ids(sortProjectRows(fixture(), DESC))).toEqual([
      'A', // 2026-08-01
      'E', // 2026-07-20
      'B', // 2026-07-15
      'C', // null  ─ still last, address-asc tie-break unaffected by direction
      'D', // null  ┘
    ]);
  });

  it('does not mutate the input array', () => {
    const rows = fixture();
    const before = ids(rows);
    sortProjectRows(rows, ASC);
    expect(ids(rows)).toEqual(before);
  });
});
