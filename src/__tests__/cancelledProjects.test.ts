import { describe, it, expect } from 'vitest';
import {
  isTaskLive,
  isTaskCancelled,
  nextCheckboxStatus,
  checkboxVisual,
  statusLabel,
  writableStatus,
  applyDoneTrigger,
  TASK_STATUS_OPTIONS,
  type TaskStatus,
} from '../lib/taskStatus';
import {
  activeHold,
  activeHoldOnly,
  activeCancel,
  activeHoldProjectIds,
  cancelledProjectIds,
  cancelByProjectId,
  activeHoldByProjectId,
  holdsByProjectId,
} from '../hooks/useProjectHolds';
import { holdKind, type ProjectHold } from '../lib/database.types';
import {
  attributePersonVolume,
  type PersonAttribution,
} from '../lib/volumeAttribution';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-262: CANCELLED projects — "the step after hold, but before delete".
//
// This file pins the PURE layer: the kind discriminator, the task-status
// vocabulary, and the volume qualifier. The SQL sweep/restore behaviour (which
// tasks move, which are left alone, exact restore, idempotence) is pinned by
// the mirror in cancelledProjectsSweep.test.ts and was additionally proven
// against prod inside a rolled-back transaction — see the PR body.

function hold(over: Partial<ProjectHold> = {}): ProjectHold {
  return {
    id: 'h1',
    tenant_id: 't1',
    project_id: 'p1',
    reason: 'MHA',
    note: null,
    hold_start: '2026-01-01',
    hold_end: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('fix-262 holdKind — the discriminator', () => {
  it("defaults a row with no kind to 'hold' (pre-fix-262 rows and fixtures)", () => {
    expect(holdKind(hold())).toBe('hold');
    expect(holdKind({ kind: undefined })).toBe('hold');
    expect(holdKind(null)).toBe('hold');
  });

  it("reads an explicit kind", () => {
    expect(holdKind(hold({ kind: 'hold' }))).toBe('hold');
    expect(holdKind(hold({ kind: 'cancelled' }))).toBe('cancelled');
  });
});

describe('fix-262 hold/cancel selectors — a project is never both', () => {
  const held = hold({ project_id: 'held', kind: 'hold' });
  const cancelled = hold({ id: 'h2', project_id: 'gone', kind: 'cancelled' });
  const closed = hold({
    id: 'h3',
    project_id: 'past',
    kind: 'cancelled',
    hold_end: '2026-02-01',
  });
  const all = [held, cancelled, closed];

  it('activeHold returns the open row of EITHER kind', () => {
    expect(activeHold([held])?.id).toBe('h1');
    expect(activeHold([cancelled])?.id).toBe('h2');
    expect(activeHold([closed])).toBeNull();
  });

  it('activeHoldOnly / activeCancel discriminate', () => {
    expect(activeHoldOnly([held])?.id).toBe('h1');
    expect(activeHoldOnly([cancelled])).toBeNull();
    expect(activeCancel([cancelled])?.id).toBe('h2');
    expect(activeCancel([held])).toBeNull();
  });

  it('activeHoldProjectIds is hold-ONLY — a cancelled project is not "on hold"', () => {
    const ids = activeHoldProjectIds(all);
    expect(ids.has('held')).toBe(true);
    expect(ids.has('gone')).toBe(false);
    expect(ids.has('past')).toBe(false);
  });

  it('cancelledProjectIds is cancel-ONLY, open rows only', () => {
    const ids = cancelledProjectIds(all);
    expect(ids.has('gone')).toBe(true);
    expect(ids.has('held')).toBe(false);
    expect(ids.has('past')).toBe(false); // closed cancel = brought back
  });

  it('the badge maps never collide', () => {
    expect(activeHoldByProjectId(all).has('gone')).toBe(false);
    expect(cancelByProjectId(all).has('held')).toBe(false);
    expect(cancelByProjectId(all).get('gone')?.reason).toBe('MHA');
  });

  it('holdsByProjectId still indexes BOTH kinds — the fix-171 clock math reads all of them', () => {
    const m = holdsByProjectId(all);
    expect(m.get('held')).toHaveLength(1);
    expect(m.get('gone')).toHaveLength(1);
    expect(m.get('past')).toHaveLength(1);
  });
});

describe('fix-262 task status vocabulary', () => {
  it("isTaskLive excludes BOTH Resolved and Cancelled", () => {
    expect(isTaskLive('Open')).toBe(true);
    expect(isTaskLive('In Progress')).toBe(true);
    expect(isTaskLive('Resolved')).toBe(false);
    expect(isTaskLive('Cancelled')).toBe(false);
    expect(isTaskLive(null)).toBe(true); // null defaults to Open
  });

  it('isTaskCancelled is exact', () => {
    expect(isTaskCancelled('Cancelled')).toBe(true);
    expect(isTaskCancelled('Resolved')).toBe(false);
    expect(isTaskCancelled(null)).toBe(false);
  });

  it('the checkbox cannot move a cancelled task', () => {
    expect(nextCheckboxStatus('Cancelled')).toBeNull();
    // unchanged for the human statuses
    expect(nextCheckboxStatus('Open')).toBe('In Progress');
    expect(nextCheckboxStatus('In Progress')).toBe('Resolved');
    expect(nextCheckboxStatus('Resolved')).toBeNull();
  });

  it('a cancelled task has its own visual — never empty (open) or checked (done)', () => {
    expect(checkboxVisual('Cancelled')).toBe('cancelled');
    expect(checkboxVisual('Open')).toBe('empty');
    expect(checkboxVisual('In Progress')).toBe('partial');
    expect(checkboxVisual('Resolved')).toBe('checked');
  });

  it("'Cancelled' is NOT offered in the status dropdown", () => {
    expect(TASK_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'Open',
      'In Progress',
      'Resolved',
    ]);
    expect(statusLabel('Cancelled')).toBe('Cancelled');
  });

  it('writableStatus keeps Cancelled out of every human write path', () => {
    expect(writableStatus('Cancelled')).toBe('Open');
    (['Open', 'In Progress', 'Resolved'] as TaskStatus[]).forEach((s) => {
      expect(writableStatus(s)).toBe(s);
    });
  });

  it('THE TRAP: the done trigger clears done_at for Cancelled, which is why the sweep must never touch a Resolved task', () => {
    // A Resolved task swept to Cancelled would lose its completion record...
    expect(
      applyDoneTrigger({
        prevStatus: 'Resolved',
        nextStatus: 'Cancelled',
        prevDoneAt: '2026-05-01T00:00:00Z',
        now: '2026-07-31T00:00:00Z',
      }),
    ).toEqual({ done: false, done_at: null });
    // ...whereas an Open task has nothing to lose, which is the whole reason
    // bp_set_project_cancel restricts its sweep to Open / In Progress.
    expect(
      applyDoneTrigger({
        prevStatus: 'Open',
        nextStatus: 'Cancelled',
        prevDoneAt: null,
        now: '2026-07-31T00:00:00Z',
      }),
    ).toEqual({ done: false, done_at: null });
  });
});

// ── VOLUME: the qualifier must not move a single existing number ────────────

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    address: '1 Main St',
    juris: 'Seattle',
    archived: false,
    notes: null,
    units: 4,
    num_lots: 2,
    ...over,
  } as Project;
}

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    da: 'Nicky',
    dm: null,
    ent_lead: null,
    dual_da: null,
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

function totals(b: PersonAttribution) {
  return {
    original: b.originalProjectIds.size,
    redesign: b.redesignProjectIds.size,
    leadOriginalPermits: b.leadOriginalPermits.length,
    leadRedesignPermits: b.leadRedesignPermits.length,
    delegates: b.delegatePermitIds.size,
  };
}

describe('fix-262 volume — cancelled is a QUALIFIER, never a deduction', () => {
  const projects = [
    project({ id: 'p1', units: 4, num_lots: 2 }),
    project({ id: 'p2', address: '2 Main St', units: 6, num_lots: 3 }),
  ];
  const permits = [
    permit({ id: 1, project_id: 'p1', da: 'Nicky' }),
    permit({ id: 2, project_id: 'p2', da: 'Nicky' }),
  ];

  it('every existing count is BYTE-IDENTICAL with and without the cancelled set', () => {
    const before = attributePersonVolume(permits, projects, { role: 'da' });
    const after = attributePersonVolume(permits, projects, {
      role: 'da',
      cancelledProjects: new Set(['p2']),
    });
    expect(totals(after.get('Nicky')!)).toEqual(totals(before.get('Nicky')!));
    // the cancelled project is still fully credited — both project ids present
    expect([...after.get('Nicky')!.originalProjectIds].sort()).toEqual(['p1', 'p2']);
  });

  it('the cancelled set is reported separately', () => {
    const buckets = attributePersonVolume(permits, projects, {
      role: 'da',
      cancelledProjects: new Set(['p2']),
    });
    const b = buckets.get('Nicky')!;
    expect(b.originalProjectIds.size).toBe(2);
    expect(b.cancelledProjectIds.size).toBe(1);
    expect(b.cancelledProjectIds.has('p2')).toBe(true);
    // "2 projects, 1 cancelled"
  });

  it('no cancelled set → empty qualifier (pre-fix-262 behaviour)', () => {
    const buckets = attributePersonVolume(permits, projects, { role: 'da' });
    expect(buckets.get('Nicky')!.cancelledProjectIds.size).toBe(0);
  });

  it('a cancelled id that nobody leads credits nobody', () => {
    const buckets = attributePersonVolume(permits, projects, {
      role: 'da',
      cancelledProjects: new Set(['p-unknown']),
    });
    expect(buckets.get('Nicky')!.cancelledProjectIds.size).toBe(0);
  });

  it('delegates get NO cancelled tag — they carry a permit count, not projects', () => {
    const withDelegate = [
      permit({ id: 1, project_id: 'p1', da: 'Nicky', dual_da: 'Marc' }),
    ];
    const buckets = attributePersonVolume(withDelegate, [projects[0]], {
      role: 'da',
      cancelledProjects: new Set(['p1']),
    });
    expect(buckets.get('Nicky')!.cancelledProjectIds.has('p1')).toBe(true);
    expect(buckets.get('Marc')!.cancelledProjectIds.size).toBe(0);
    expect(buckets.get('Marc')!.delegatePermitIds.size).toBe(1);
  });

  it('a redesign can be cancelled independently of its original', () => {
    const redesign = project({
      id: 'r1',
      address: '1 Main St [Redesign 1]',
      redesign_of_project_id: 'p1',
      units: 5,
      num_lots: 2,
    });
    const buckets = attributePersonVolume(
      [...permits, permit({ id: 3, project_id: 'r1', da: 'Nicky' })],
      [...projects, redesign],
      { role: 'da', cancelledProjects: new Set(['r1']) },
    );
    const b = buckets.get('Nicky')!;
    expect(b.originalProjectIds.size).toBe(2); // untouched
    expect(b.redesignProjectIds.size).toBe(1); // still credited
    expect([...b.cancelledProjectIds]).toEqual(['r1']);
  });

  it('a co-credited DA (fix-226 handoff) carries the same cancelled qualifier', () => {
    const coCredit = new Map([['p1', new Set(['DA-A', 'Nicky'])]]);
    const buckets = attributePersonVolume([permits[0]], [projects[0]], {
      role: 'da',
      coCreditDaByProject: coCredit,
      cancelledProjects: new Set(['p1']),
    });
    expect(buckets.get('Nicky')!.cancelledProjectIds.has('p1')).toBe(true);
    expect(buckets.get('DA-A')!.cancelledProjectIds.has('p1')).toBe(true);
    // and both still carry the full volume
    expect(buckets.get('DA-A')!.originalProjectIds.has('p1')).toBe(true);
  });
});
