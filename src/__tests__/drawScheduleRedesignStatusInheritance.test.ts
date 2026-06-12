import { describe, it, expect } from 'vitest';
import {
  deriveLaneStatus,
  STATUS_PRESENTATION,
} from '../lib/drawScheduleStatus';
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

describe('own-permit (non-BP) approval → label + shade agree (fix-160)', () => {
  it('verbatim 7603 redesign shape: reuses=false, own PPR approved, stale headline → Approved (was Scheduled/white)', () => {
    const res = run({
      project: {
        id: 'redesign',
        redesign_of_project_id: 'parent',
        redesign_reuses_original_permit: false,
      },
      // The redesign's ONLY permit is a PPR (not a BP) whose headline status is
      // still 'Pre-Submittal — GO' (scraper guard window) but with approval_date
      // + actual_issue set — verbatim prod shape for 20497c78 / permit 10266.
      permitsByProjectId: pbp({
        redesign: [
          bp('redesign', {
            type: 'PPR',
            status: 'Pre-Submittal — GO',
            approval_date: '2026-05-11',
            actual_issue: '2026-05-22',
          }),
        ],
      }),
      currentStatus: 'Scheduled', // stale stored lane status
      manualStatus: false,
    });
    // Before fix-160: deriveBlockStatus saw no Building Permit → 'Scheduled' (white)
    // while the block already showed the approval date. Now it derives off the PPR.
    expect(res.status).toBe('Approved');
    // text AND shade come from the SAME record:
    const pres = STATUS_PRESENTATION[res.status];
    expect(pres.label).toBe('Approved');
    expect(pres.colors.bg).toBe('#5abf75'); // green, not #ffffff white
  });

  it('parent 7603 (real BP with approval + issue dates) → Approved + green (consistent — no mismatch there)', () => {
    const res = run({
      project: { id: 'parent' },
      permitsByProjectId: pbp({
        parent: [bp('parent', { approval_date: '2026-04-03', actual_issue: '2026-04-06' })],
      }),
    });
    expect(res.status).toBe('Approved');
    expect(STATUS_PRESENTATION[res.status].colors.bg).toBe('#5abf75');
  });

  it('a BP-less project with NO approval data still derives Scheduled/white (no false green)', () => {
    const res = run({
      project: { id: 'solo', redesign_of_project_id: null },
      permitsByProjectId: pbp({ solo: [bp('solo', { type: 'PPR' })] }),
      currentStatus: 'Scheduled',
    });
    expect(res.status).toBe('Scheduled');
    expect(STATUS_PRESENTATION[res.status].colors.bg).toBe('#ffffff');
  });
});
