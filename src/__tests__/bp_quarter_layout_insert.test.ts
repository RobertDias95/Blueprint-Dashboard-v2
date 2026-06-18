import { describe, it, expect } from 'vitest';

// fix-182d: contract spec for the collision-proof column-insert RPCs
// (migrations/fix_182d_quarter_layout_insert_rpcs.sql:
//   bp_append_quarter_layout_column = max(position)+1;
//   bp_insert_quarter_layout_column = clamp(P) -> shift tail +1 -> insert at P,
//   under SET CONSTRAINTS DEFERRED + a per-(tenant,quarter) advisory lock).
// No live DB in CI (fix-153 precedent) -> pure-TS mirror + rolled-back MCP probe.
//
// PROD probe (2026-06-18, simulated authenticated JWT, throwaway quarter
// '2099-Q9', whole transaction aborted by a final RAISE — zero rows persisted):
//
//   append_positions=0,1,2;                    -- three appends -> distinct seq
//   midinsert_pos=1; order=A@0,MID@1,B@2,OPEN@3; -- shift tail, no collision
//   clamp_pos=4;                               -- insert at 999 clamped to end
//   gate=blocked(42501);                       -- no-membership sub -> 42501
//
// The reported bug was the editor sending a CLIENT position (rows.length); two
// rapid adds picked the same value -> dup-key 23505. The mirrors below pin the
// server-side position math that replaced it.

/** Mirror of bp_append_quarter_layout_column's position = max(position)+1. */
function appendPosition(existing: number[]): number {
  return existing.length === 0 ? 0 : Math.max(...existing) + 1;
}

/** Mirror of bp_insert_quarter_layout_column: clamp P into [0,count], shift
 *  every row at/after P up by one, insert at P. Returns the new ordered
 *  positions list (as [label, position] pairs). */
function insertAt(
  rows: { label: string; position: number }[],
  atPosition: number,
  newLabel: string,
): { label: string; position: number }[] {
  const count = rows.length;
  const p = Math.min(Math.max(atPosition, 0), count);
  const shifted = rows.map((r) =>
    r.position >= p ? { ...r, position: r.position + 1 } : { ...r },
  );
  shifted.push({ label: newLabel, position: p });
  return shifted.sort((a, b) => a.position - b.position);
}

describe('fix-182d append position (server-computed)', () => {
  it('is 0 on an empty quarter', () => {
    expect(appendPosition([])).toBe(0);
  });

  it('is max+1 — rapid double-append yields distinct N, N+1 (no collision)', () => {
    let positions = [0, 1, 2];
    const a = appendPosition(positions);
    positions = [...positions, a];
    const b = appendPosition(positions);
    expect([a, b]).toEqual([3, 4]);
  });

  it('stays max+1 even with gaps left by deletes', () => {
    expect(appendPosition([0, 1, 4])).toBe(5);
  });
});

describe('fix-182d mid-insert (shift-then-insert, clamped)', () => {
  const rows = [
    { label: 'A', position: 0 },
    { label: 'B', position: 1 },
    { label: 'OPEN', position: 2 },
  ];

  it('inserts at P and shifts the tail up by one (matches the prod probe order)', () => {
    const out = insertAt(rows, 1, 'MID');
    expect(out.map((r) => `${r.label}@${r.position}`)).toEqual([
      'A@0', 'MID@1', 'B@2', 'OPEN@3',
    ]);
  });

  it('clamps a too-large position to the end (stale client P never errors)', () => {
    const out = insertAt(rows, 999, 'TAIL');
    expect(out[out.length - 1]).toEqual({ label: 'TAIL', position: 3 });
  });

  it('clamps a negative position to the front', () => {
    const out = insertAt(rows, -5, 'HEAD');
    expect(out[0]).toEqual({ label: 'HEAD', position: 0 });
  });

  it('produces a contiguous 0..n with no duplicate positions', () => {
    const out = insertAt(rows, 2, 'X');
    const positions = out.map((r) => r.position).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3]);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
