import { describe, it, expect } from 'vitest';
import { buildWaitingOnCsv } from '../lib/waitingOnCsv';
import type { WaitingOnTaskRow, WaitingOnDiscipline } from '../lib/database.types';

// fix-140: CSV format for the Waiting On export. buildWaitingOnCsv is the
// pure text builder (the file's export* wrappers add the DOM download).

let seq = 0;
function makeRow(over: Partial<WaitingOnTaskRow> = {}): WaitingOnTaskRow {
  seq += 1;
  return {
    task_id: `task-${seq}`,
    task_text: 'Submit civil set',
    bucket: 'de',
    waiting_on: 'Civil' as WaitingOnDiscipline,
    firm_id: 'f1',
    firm_name: 'Prism',
    firm_active: true,
    project_id: 'proj-1',
    project_address: '500 Pike St',
    project_juris: 'Seattle',
    permit_id: 1,
    permit_type: 'Building Permit',
    assigned_to: 'Bobby',
    priority: true,
    start_date: '2026-01-01',
    due_date: '2026-02-01',
    target_date: '2026-03-01',
    completion_status: 'Open',
    done: false,
    done_at: null,
    notes: 'all good',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...over,
  };
}

const HEADER =
  '"Discipline","Firm Name","Firm Status","Project Address","Jurisdiction",' +
  '"Permit Type","Task","Assigned To","Priority","Start Date","Due Date",' +
  '"Target Date","Status","Created","Updated","Notes"';

describe('buildWaitingOnCsv', () => {
  it('emits the exact header row', () => {
    const csv = buildWaitingOnCsv([]);
    expect(csv).toBe(HEADER);
  });

  it('single row: discipline + firm + task land in the right columns', () => {
    const csv = buildWaitingOnCsv([makeRow()]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '"Civil","Prism","Active","500 Pike St","Seattle","Building Permit",' +
        '"Submit civil set","Bobby","Yes","2026-01-01","2026-02-01",' +
        '"2026-03-01","Open","2026-01-01T00:00:00Z","2026-01-02T00:00:00Z","all good"',
    );
  });

  it('null firm → empty Firm Name + Firm Status columns', () => {
    const csv = buildWaitingOnCsv([
      makeRow({ firm_id: null, firm_name: null, firm_active: null }),
    ]);
    const cells = csv.split('\n')[1].split(',');
    expect(cells[1]).toBe('""'); // Firm Name
    expect(cells[2]).toBe('""'); // Firm Status
  });

  it('archived firm → Firm Status = "Archived"', () => {
    const csv = buildWaitingOnCsv([makeRow({ firm_active: false })]);
    const cells = csv.split('\n')[1].split(',');
    expect(cells[2]).toBe('"Archived"');
  });

  it('priority false → "No"', () => {
    const csv = buildWaitingOnCsv([makeRow({ priority: false })]);
    const cells = csv.split('\n')[1].split(',');
    expect(cells[8]).toBe('"No"');
  });

  it('escapes commas, quotes, and newlines in notes per CSV spec', () => {
    const csv = buildWaitingOnCsv([
      makeRow({ notes: 'a, b "quoted"\nsecond line' }),
    ]);
    // The whole cell is wrapped in quotes; embedded quotes are doubled; the
    // comma + newline stay inside the quoted cell.
    expect(csv).toContain('"a, b ""quoted""\nsecond line"');
  });
});
