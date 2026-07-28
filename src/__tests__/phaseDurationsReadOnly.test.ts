import { describe, it, expect } from 'vitest';
// Vite `?raw` rather than node:fs — this project has no @types/node in the app
// tsconfig, and Render runs a stricter `tsc -b` than vitest does.
import MIGRATION from '../../migrations/fix_253_phase_duration_model.sql?raw';

// fix-253: this migration MUST NOT change any target_submit value. Rewiring the
// engine is fix-254, gated on review of the numbers.
//
// There is no live DB in CI, so the guarantee is enforced statically over the
// migration text: the file may create read-only functions and nothing else. A
// future edit that sneaks a write, touches the engine functions, or adds a
// trigger fails here rather than silently moving 400 dates on prod.
//
// The live check was done on prod at apply time: both functions are STABLE with
// zero write statements, and exercising them repeatedly changed 0 rows.

/** Strip SQL line comments so prose about UPDATE/engine functions doesn't trip
 *  the scanners below — only executable text is inspected. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

const SQL = executableSql(MIGRATION);

describe('fix-253 migration is read-only', () => {
  it('contains no write statement against permits', () => {
    expect(SQL).not.toMatch(/\bupdate\s+(public\.)?permits\b/i);
    expect(SQL).not.toMatch(/\binsert\s+into\s+(public\.)?permits\b/i);
    expect(SQL).not.toMatch(/\bdelete\s+from\s+(public\.)?permits\b/i);
  });

  it('contains no write statement against permit_cycles', () => {
    expect(SQL).not.toMatch(/\bupdate\s+(public\.)?permit_cycles\b/i);
    expect(SQL).not.toMatch(/\binsert\s+into\s+(public\.)?permit_cycles\b/i);
    expect(SQL).not.toMatch(/\bdelete\s+from\s+(public\.)?permit_cycles\b/i);
  });

  it('does not redefine any target_submit engine function', () => {
    for (const fn of [
      'bp_recompute_target_submits',
      'bp_learn_target_submit_days',
      'bp_learn_days',
      'bp_target_submit_offset',
      'bp_replace_permit_cycles',
    ]) {
      expect(SQL).not.toMatch(
        new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${fn}\\b`, 'i'),
      );
      expect(SQL).not.toMatch(new RegExp(`drop\\s+function[^;]*${fn}\\b`, 'i'));
    }
  });

  it('creates, alters or drops no trigger', () => {
    expect(SQL).not.toMatch(/\bcreate\s+(or\s+replace\s+)?trigger\b/i);
    expect(SQL).not.toMatch(/\bdrop\s+trigger\b/i);
    expect(SQL).not.toMatch(/\balter\s+table[^;]*\btrigger\b/i);
  });

  it('leaves fix-249\'s bp_target_submit_benchmark alone (this is additive)', () => {
    expect(SQL).not.toMatch(/drop\s+function[^;]*bp_target_submit_benchmark/i);
    expect(SQL).not.toMatch(
      /create\s+(or\s+replace\s+)?function\s+(public\.)?bp_target_submit_benchmark\b/i,
    );
  });

  it('alters no table (no schema change at all)', () => {
    expect(SQL).not.toMatch(/\balter\s+table\b/i);
  });

  it('defines both new functions as STABLE and SECURITY INVOKER', () => {
    const bodies = SQL.split(/create\s+or\s+replace\s+function/i).slice(1);
    const named = bodies.filter((b) => /bp_phase_duration/i.test(b));
    expect(named).toHaveLength(2);
    for (const b of named) {
      expect(b).toMatch(/\bSTABLE\b/i);
      expect(b).toMatch(/SECURITY\s+INVOKER/i);
      // Tenant guard, matching the other read RPCs.
      expect(b).toMatch(/auth_tenant_ids\(\)/);
    }
  });

  it('only creates the two intended functions', () => {
    const created = [...SQL.matchAll(
      /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)/gi,
    )].map((m) => m[1]);
    expect(new Set(created)).toEqual(
      new Set(['bp_phase_durations', 'bp_phase_duration_grid']),
    );
  });
});
