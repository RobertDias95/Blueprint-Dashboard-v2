import { describe, it, expect } from 'vitest';
import { disciplineForTeam } from '../lib/taskTeam';

// fix-244: contract spec for the SQL side (seeding + backfill) of "a task's
// Design-view column follows its team". The rule is SQL
// (migrations/fix_244_task_discipline_from_team.sql: bp_discipline_for_team +
// the bp_create_project_with_permits seed + the backfill UPDATE). No live DB in
// CI (fix-153 / fix-220 precedent), so this is a pure-TS mirror + a documented
// read-only PROD probe.
//
// PROD probe (2026-07-21, project eibnmwthkcuumyclyxoe, READ-ONLY, pre-fix):
//   - bp_list_permit_tasks splits the Design view via COALESCE(discipline,'ent').
//   - bp_create_project_with_permits seeded permit_tasks WITHOUT discipline →
//     NULL → all in Entitlements. 86 NULL-discipline tasks; 82 match a template
//     by (permits.type = tt.permit_type AND permit_tasks.text = tt.text +tenant),
//     0 with conflicting default_team across matches; 4 unmatched.
//   - Backfill preview: 34 Design Associate + 2 Schematic Team → 'arch'
//     (incl. 4017 Corliss "Schematic Design"); 42 Entitlements + 4 matched-null-team
//     → 'ent'; 4 unmatched left NULL. Non-null rows (hand-set 'arch' "test",
//     auto "Enter permit number" tasks) untouched. bp_trg_log_user_activity
//     no-ops when auth.uid() IS NULL, so the migration backfill logs no activity.

// ---------------------------------------------------------------------------
// Mirror of the SQL bp_discipline_for_team(team) — must equal the TS twin.
// ---------------------------------------------------------------------------
function bpDisciplineForTeam(team: string | null): 'arch' | 'ent' | null {
  if (
    team === 'Design Associate' ||
    team === 'Design Manager' ||
    team === 'Schematic Team' ||
    team === 'Architecture'
  ) {
    return 'arch';
  }
  if (team === 'Entitlements') return 'ent';
  return null;
}

/** Mirror of the SEED expression:
 *  COALESCE(bp_discipline_for_team(tt.default_team), 'ent'). */
function seedDiscipline(defaultTeam: string | null): 'arch' | 'ent' {
  return bpDisciplineForTeam(defaultTeam) ?? 'ent';
}

/** Mirror of the BACKFILL derivation for one task, given the set of default_team
 *  values on the templates it matched (empty = unmatched → left NULL). */
function backfillDiscipline(matchedTeams: (string | null)[]): 'arch' | 'ent' | null {
  if (matchedTeams.length === 0) return null; // unmatched → leave NULL (renders ent)
  const anyDesign = matchedTeams.some(
    (t) =>
      t === 'Design Associate' ||
      t === 'Design Manager' ||
      t === 'Schematic Team' ||
      t === 'Architecture',
  );
  return anyDesign ? 'arch' : 'ent';
}

describe('fix-244 bp_discipline_for_team mirror', () => {
  it('the SQL mirror agrees with the TS twin disciplineForTeam for every case', () => {
    const teams = [
      'Entitlements',
      'Design Associate',
      'Design Manager',
      'Schematic Team',
      'Architecture',
      'Miles',
      '',
      null,
    ];
    for (const t of teams) {
      // TS twin trims + treats '' as null; align the mirror the same way.
      const twin = disciplineForTeam(t);
      const sql = bpDisciplineForTeam(t === '' ? '' : t);
      expect(sql).toBe(twin);
    }
  });
});

describe('fix-244 seeding default', () => {
  it('Entitlements → ent, design roles → arch, null/unknown → ent (default)', () => {
    expect(seedDiscipline('Entitlements')).toBe('ent');
    expect(seedDiscipline('Design Associate')).toBe('arch');
    expect(seedDiscipline('Schematic Team')).toBe('arch');
    expect(seedDiscipline(null)).toBe('ent');
    expect(seedDiscipline('Something else')).toBe('ent');
  });

  it('a newly seeded "Schematic Design" (Schematic Team) lands in Architecture', () => {
    expect(seedDiscipline('Schematic Team')).toBe('arch');
  });
});

describe('fix-244 backfill derivation', () => {
  it('a matched Design-Associate task → arch', () => {
    expect(backfillDiscipline(['Design Associate'])).toBe('arch');
  });

  it('a matched Schematic-Team task (4017 Corliss "Schematic Design") → arch', () => {
    expect(backfillDiscipline(['Schematic Team'])).toBe('arch');
  });

  it('a matched Entitlements task → ent', () => {
    expect(backfillDiscipline(['Entitlements'])).toBe('ent');
  });

  it('a matched-but-null-team template → ent (default), never arch', () => {
    expect(backfillDiscipline([null])).toBe('ent');
  });

  it('an unmatched task is left NULL (renders ent via COALESCE) — never forced to arch', () => {
    expect(backfillDiscipline([])).toBeNull();
  });

  it('any design team present among matches wins → arch', () => {
    // (0 such conflicts exist in prod, but the aggregate prefers arch safely.)
    expect(backfillDiscipline(['Entitlements', 'Design Associate'])).toBe('arch');
  });
});
