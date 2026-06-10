import { describe, it, expect } from 'vitest';
import { deriveLaneStatus } from '../lib/drawScheduleStatus';
import type { Permit, PermitCycle } from '../lib/database.types';

// fix-150: the Draw Schedule lane-status derivation chases to the parent
// project's BP for a reuse-redesign (which has no permits of its own), so its
// lane shows the same derived status as the parent instead of raw 'Scheduled'.

const TODAY = new Date(2026, 5, 10); // 2026-06-10, fixed for determinism

function bp(projectId: string, over: Partial<Permit> = {}): Permit {
  return {
    id: Math.floor(Math.random() * 1e9), // not used for these (cycles empty)
    project_id: projectId,
    type: 'Building Permit',
    approval_date: null,
    actual_issue: null,
    dd_start: null,
    dd_end: null,
    ...over,
  } as unknown as Permit;
}

function pbp(entries: Record<string, Permit[]>): Map<string, Permit[]> {
  return new Map(Object.entries(entries));
}
const NO_CYCLES = new Map<number, PermitCycle[]>();

function run(args: {
  project: {
    id: string;
    redesign_of_project_id?: string | null;
    redesign_reuses_original_permit?: boolean | null;
  };
  permitsByProjectId: Map<string, Permit[]>;
  currentStatus?: string | null;
  manualStatus?: boolean;
}) {
  return deriveLaneStatus({
    project: args.project,
    permitsByProjectId: args.permitsByProjectId,
    cyclesByPermit: NO_CYCLES,
    currentStatus: args.currentStatus ?? 'Scheduled',
    manualStatus: args.manualStatus ?? false,
    today: TODAY,
  });
}

describe('deriveLaneStatus — reuse-redesign parent inheritance', () => {
  it('parent lane derives Approved from its own BP approval_date', () => {
    const res = run({
      project: { id: 'parent' },
      permitsByProjectId: pbp({ parent: [bp('parent', { approval_date: '2026-06-01' })] }),
    });
    expect(res.status).toBe('Approved');
    expect(res.isAuto).toBe(true);
  });

  it('reuse-redesign lane (no own permits) inherits Approved from the parent BP', () => {
    const res = run({
      project: {
        id: 'redesign',
        redesign_of_project_id: 'parent',
        redesign_reuses_original_permit: true,
      },
      // redesign has NO permits; parent's BP is approved
      permitsByProjectId: pbp({ parent: [bp('parent', { approval_date: '2026-06-01' })] }),
    });
    expect(res.status).toBe('Approved');
  });

  it('reuse-redesign whose parent also has no BP falls back to its own status', () => {
    const res = run({
      project: {
        id: 'redesign',
        redesign_of_project_id: 'parent',
        redesign_reuses_original_permit: true,
      },
      permitsByProjectId: pbp({ parent: [] }), // parent has no BP either
      currentStatus: 'Scheduled',
    });
    expect(res.status).toBe('Scheduled');
  });

  it('redesign with its own permit (reuses=false) uses its own, never chases the parent', () => {
    const res = run({
      project: {
        id: 'redesign',
        redesign_of_project_id: 'parent',
        redesign_reuses_original_permit: false,
      },
      permitsByProjectId: pbp({
        // own BP is approved; parent BP is in corrections — must NOT be used
        redesign: [bp('redesign', { approval_date: '2026-06-01' })],
        parent: [bp('parent')],
      }),
    });
    expect(res.status).toBe('Approved');
  });

  it('non-redesign project with no permit does not chase — falls back to its status', () => {
    const res = run({
      project: { id: 'solo', redesign_of_project_id: null },
      permitsByProjectId: pbp({}),
      currentStatus: 'Scheduled',
    });
    expect(res.status).toBe('Scheduled');
  });

  it('reuse-redesign inherits the parent derivation even over the redesign lane\'s own non-manual status', () => {
    // redesign's stored status is a stale 'Scheduled'; parent BP is approved →
    // the permit-data branch wins (same as it would on the parent lane).
    const res = run({
      project: {
        id: 'redesign',
        redesign_of_project_id: 'parent',
        redesign_reuses_original_permit: true,
      },
      permitsByProjectId: pbp({ parent: [bp('parent', { actual_issue: '2026-06-05' })] }),
      currentStatus: 'Scheduled',
      manualStatus: false,
    });
    expect(res.status).toBe('Approved');
  });
});
