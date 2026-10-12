import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PermitTask, TaskTemplate, WaitingOnTaskRow } from '../lib/database.types';
import { groupByDisciplineThenFirm } from '../hooks/useWaitingOnTasks';
import { labelSelectOptions, QL_LABEL_OFF_LIST_MARKER } from '../lib/quarterLayoutHelpers';
import { rosterRoleTitle } from '../lib/roleLabels';
import { resolveRosterIdentity } from '../lib/selfScope';

// ===========================================================================
// fix-652 (P-318) — the five small Settings leftovers (census 11, 12, 31, 33, 35)
// ===========================================================================
// 11 and 33's render + save tests live beside their editors'
// (ExternalTeamDirectoryEditor.test.tsx, QuarterLayoutEditor.test.tsx).

describe('fix-652 · 12 — waiting_on is a string', () => {
  it('★★ City and an admin-added value are valid without a cast', () => {
    // ★ A TYPECHECK test: under the old union these assignments did not
    //   compile (`City` and `Acoustics` are not in WAITING_ON_OPTIONS).
    const task: Pick<PermitTask, 'waiting_on'> = { waiting_on: 'City' };
    const tpl: Pick<TaskTemplate, 'default_waiting_on'> = { default_waiting_on: 'Acoustics' };
    const row: Pick<WaitingOnTaskRow, 'waiting_on'> = { waiting_on: 'Acoustics' };
    expect([task.waiting_on, tpl.default_waiting_on, row.waiting_on]).toEqual([
      'City',
      'Acoustics',
      'Acoustics',
    ]);
  });

  it('groups keep the stored value as-is', () => {
    const base = {
      task_text: 't', bucket: 'de', firm_id: null, firm_name: null, firm_active: null,
      project_id: 'p', project_address: null, project_juris: null, permit_id: 1,
      done_at: null, sort_order: 0,
    };
    const groups = groupByDisciplineThenFirm([
      { ...base, task_id: 'a', waiting_on: 'City' },
      { ...base, task_id: 'b', waiting_on: 'Acoustics' },
    ] as unknown as WaitingOnTaskRow[]);
    expect(groups.map((g) => g.discipline)).toEqual(['Acoustics', 'City']);
  });
});

describe('fix-652 · 31 — the two dead quarter-layout hooks are gone', () => {
  const SRC = resolve(process.cwd(), 'src');
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  }

  it('★★ the files are deleted', () => {
    expect(existsSync(join(SRC, 'hooks/useUpsertQuarterLayoutRow.ts'))).toBe(false);
    expect(existsSync(join(SRC, 'hooks/useDeleteQuarterLayoutRow.ts'))).toBe(false);
  });

  it('★★ nothing in src names them (the grep guard)', () => {
    const names = ['useUpsert' + 'QuarterLayoutRow', 'useDelete' + 'QuarterLayoutRow'];
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100); // the walk found the tree
    const hits = files.filter((p) => {
      if (p.endsWith('SettingsSmallFiveFix652.test.ts')) return false; // this guard
      const text = readFileSync(p, 'utf8');
      return names.some((n) => text.includes(n));
    });
    expect(hits).toEqual([]);
  }, 60_000);
});

describe('fix-652 · 33 — a layout label select keeps an off-list value', () => {
  it('appends this row’s own off-list value, marked', () => {
    expect(labelSelectOptions(['Brittani', 'Jade'], 'North Region')).toEqual([
      { value: 'Brittani', label: 'Brittani' },
      { value: 'Jade', label: 'Jade' },
      { value: 'North Region', label: `North Region${QL_LABEL_OFF_LIST_MARKER}` },
    ]);
  });

  it('adds nothing for a listed or blank value', () => {
    expect(labelSelectOptions(['Jade'], 'Jade')).toHaveLength(1);
    expect(labelSelectOptions(['Jade'], null)).toHaveLength(1);
    expect(labelSelectOptions(['Jade'], '  ')).toHaveLength(1);
  });
});

describe('fix-652 · 35 — a viewer’s title is their department', () => {
  it('★★★ the department wins over the note', () => {
    expect(rosterRoleTitle(['viewer'], 'CEO', 'executive')).toBe('Executive');
    expect(rosterRoleTitle(['viewer'], 'IT', 'it_investor_relations')).toBe(
      'IT & Investor Relations',
    );
  });

  it('★★ a blank department falls back to the note, then to null', () => {
    expect(rosterRoleTitle(['viewer'], 'Underwriting', null)).toBe('Underwriting');
    expect(rosterRoleTitle(['viewer'], 'Underwriting')).toBe('Underwriting');
    expect(rosterRoleTitle(['viewer'], '  ', null)).toBeNull();
  });

  it('★ a real role is unaffected by the department', () => {
    expect(rosterRoleTitle(['ent', 'viewer'], 'Policy', 'policy')).toBe(
      rosterRoleTitle(['ent']),
    );
  });

  it('★★ the identity carries the department from any of the person’s rows', () => {
    const id = resolveRosterIdentity(
      'darin@example.com',
      [
        { name: 'Darin', email: 'darin@example.com', role: 'viewer', notes: 'CEO', department: null },
        { name: 'Darin', email: 'Darin@example.com ', role: 'viewer', notes: null, department: 'executive' },
      ],
      [],
    );
    expect(id.department).toBe('executive');
    expect(rosterRoleTitle(id.roles, id.notes, id.department)).toBe('Executive');
  });
});
