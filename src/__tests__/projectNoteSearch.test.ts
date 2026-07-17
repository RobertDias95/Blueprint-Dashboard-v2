import { describe, it, expect } from 'vitest';
import { buildProjectRows, filterProjectRows } from '../lib/projectViewHelpers';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-notes-2: the Project List free-text search now also matches active-note
// bodies (fix-notes-1 moved notes off projects.notes into the notes table).

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '123 Main St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    project_tags: null,
    go_date: null,
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Project;
}

function permit(projectId: string): PermitWithCycles {
  return {
    id: 1,
    project_id: projectId,
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: 'BP-1',
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    actual_issue: null,
    approval_date: null,
    notes: null,
    permit_cycles: [],
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as PermitWithCycles;
}

const rows = () =>
  buildProjectRows(
    [project({ id: 'p1', address: '123 Main St' }), project({ id: 'p2', address: '999 Oak Ave' })],
    [permit('p1'), permit('p2')],
    [],
  );

const filters = (search: string) => ({
  search,
  stages: [],
  entLeads: [],
  das: [],
  jurises: [],
});

describe('filterProjectRows note search (fix-notes-2)', () => {
  it('finds a project by its active-note text via the note index', () => {
    const noteIndex = new Map<string, string>([
      ['p1', 'waiting on geotech report before resubmittal'],
    ]);
    const found = filterProjectRows(rows(), filters('geotech'), noteIndex);
    expect(found.map((r) => r.project.id)).toEqual(['p1']);
  });

  it('does not match note text when no note index is supplied', () => {
    // Without the index, "geotech" matches neither address nor tags → no rows.
    const found = filterProjectRows(rows(), filters('geotech'));
    expect(found).toHaveLength(0);
  });

  it('still matches by address regardless of the note index', () => {
    const found = filterProjectRows(rows(), filters('Oak'), new Map());
    expect(found.map((r) => r.project.id)).toEqual(['p2']);
  });

  it('a permit note attributed to the project is searchable (index concatenates both scopes)', () => {
    // The RPC returns one row per active note (project + permit), keyed to
    // project_id; the hook concatenates them. Simulate a permit note here.
    const noteIndex = new Map<string, string>([['p2', 'asbestos survey outstanding']]);
    const found = filterProjectRows(rows(), filters('asbestos'), noteIndex);
    expect(found.map((r) => r.project.id)).toEqual(['p2']);
  });
});
