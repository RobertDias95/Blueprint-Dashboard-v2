import { describe, it, expect } from 'vitest';
import { groupByDisciplineThenFirm } from '../hooks/useWaitingOnTasks';
import type { WaitingOnTaskRow, WaitingOnDiscipline } from '../lib/database.types';

// fix-140: grouping math for the Waiting On view — discipline (alphabetical)
// -> firm (firm_name asc, null-firm group last; archived firms keep their own
// group). Pure function, no DB.

let seq = 0;
function makeRow(over: Partial<WaitingOnTaskRow> = {}): WaitingOnTaskRow {
  seq += 1;
  return {
    task_id: `task-${seq}`,
    task_text: `Task ${seq}`,
    bucket: 'de',
    waiting_on: 'Civil' as WaitingOnDiscipline,
    firm_id: null,
    firm_name: null,
    firm_active: null,
    project_id: 'proj-1',
    project_address: '500 Pike St',
    project_juris: 'Seattle',
    permit_id: 1,
    permit_type: 'Building Permit',
    assigned_to: 'Bobby',
    priority: false,
    start_date: null,
    due_date: null,
    target_date: null,
    completion_status: 'Open',
    done: false,
    done_at: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('groupByDisciplineThenFirm', () => {
  it('empty input → empty array', () => {
    expect(groupByDisciplineThenFirm([])).toEqual([]);
  });

  it('single discipline + single firm → 1 discipline, 1 firm, 1 task', () => {
    const rows = [
      makeRow({ waiting_on: 'Civil', firm_id: 'f1', firm_name: 'Prism', firm_active: true }),
    ];
    const groups = groupByDisciplineThenFirm(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].discipline).toBe('Civil');
    expect(groups[0].totalTasks).toBe(1);
    expect(groups[0].firms).toHaveLength(1);
    expect(groups[0].firms[0]).toMatchObject({
      firmId: 'f1',
      firmName: 'Prism',
      firmActive: true,
    });
    expect(groups[0].firms[0].tasks).toHaveLength(1);
  });

  it('disciplines are ordered alphabetically (Architect < Civil < Surveyor)', () => {
    const rows = [
      makeRow({ waiting_on: 'Surveyor' }),
      makeRow({ waiting_on: 'Architect' }),
      makeRow({ waiting_on: 'Civil' }),
    ];
    const groups = groupByDisciplineThenFirm(rows);
    expect(groups.map((g) => g.discipline)).toEqual([
      'Architect',
      'Civil',
      'Surveyor',
    ]);
  });

  it('within a discipline, firms sort by name asc with the null-firm group LAST', () => {
    const rows = [
      makeRow({ waiting_on: 'Civil', firm_id: null }), // no firm
      makeRow({ waiting_on: 'Civil', firm_id: 'fz', firm_name: 'Zeta', firm_active: true }),
      makeRow({ waiting_on: 'Civil', firm_id: 'fa', firm_name: 'Atwell', firm_active: true }),
    ];
    const [civil] = groupByDisciplineThenFirm(rows);
    expect(civil.firms.map((f) => f.firmName)).toEqual(['Atwell', 'Zeta', null]);
    expect(civil.firms[civil.firms.length - 1].firmId).toBeNull();
    expect(civil.totalTasks).toBe(3);
  });

  it('an archived firm keeps its own group (firmActive=false), not merged with null-firm', () => {
    const rows = [
      makeRow({ waiting_on: 'Civil', firm_id: 'fa', firm_name: 'Atwell', firm_active: false }),
      makeRow({ waiting_on: 'Civil', firm_id: null }),
    ];
    const [civil] = groupByDisciplineThenFirm(rows);
    expect(civil.firms).toHaveLength(2);
    const archived = civil.firms.find((f) => f.firmId === 'fa');
    const none = civil.firms.find((f) => f.firmId === null);
    expect(archived).toMatchObject({ firmName: 'Atwell', firmActive: false });
    expect(none).toMatchObject({ firmId: null, firmActive: true });
  });

  it('two distinct firm_ids stay separate even when tasks share a discipline', () => {
    const rows = [
      makeRow({ waiting_on: 'Civil', firm_id: 'fa', firm_name: 'Atwell', firm_active: true }),
      makeRow({ waiting_on: 'Civil', firm_id: 'fb', firm_name: 'Brava', firm_active: true }),
      makeRow({ waiting_on: 'Civil', firm_id: 'fa', firm_name: 'Atwell', firm_active: true }),
    ];
    const [civil] = groupByDisciplineThenFirm(rows);
    expect(civil.firms).toHaveLength(2);
    expect(civil.firms.find((f) => f.firmId === 'fa')?.tasks).toHaveLength(2);
    expect(civil.firms.find((f) => f.firmId === 'fb')?.tasks).toHaveLength(1);
  });
});
