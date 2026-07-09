import { describe, it, expect } from 'vitest';

// fix-225: contract spec for bp_reassign_project_da / bp_undo_project_da_reassign.
// The logic is SQL (migrations/fix_225_project_da_handoff.sql). No live DB in CI
// (the fix-220 precedent), so this is a pure-TS mirror of the RPC semantics + a
// documented read-only PROD probe of the pieces it depends on.
//
// PROD probe (2026-07-09, project eibnmwthkcuumyclyxoe, READ-ONLY):
//   - the DA→board coupling is trigger bp_trg_sync_draw_schedule_da (AFTER UPDATE
//     OF da ON permits WHEN new.type='Building Permit') → bp_sync_draw_schedule_da,
//     which pushes permits.da → draw_schedule.da_assigned. fix-225 adds a
//     txn-local skip flag (app.bp_skip_da_sync='on') so a pure reassign does NOT
//     move the board block.
//   - "the project's DA" = permits.da (no projects.da column); the board block is
//     draw_schedule.da_assigned (one row per project).
//   - OPEN task = completion_status <> 'Resolved' (statuses: Open/In Progress/Resolved).
//   - assignees are the DA's NAME string in permit_task_assignees (fix-224).
//   - is_tenant_admin / service_role gate (fix-220 pattern).

// ---------------------------------------------------------------------------
// Admin gate mirror (service_role OR tenant admin).
// ---------------------------------------------------------------------------
function canReassign(caller: {
  authRole: 'service_role' | 'authenticated';
  isTenantAdmin: boolean;
}): boolean {
  return caller.authRole === 'service_role' || caller.isTenantAdmin;
}

// ---------------------------------------------------------------------------
// State + reassign/undo mirror of the SQL.
// ---------------------------------------------------------------------------
type Status = 'Open' | 'In Progress' | 'Resolved';
interface Task {
  id: string;
  status: Status;
  assignees: string[];
}
interface Handoff {
  id: string;
  from_da: string | null;
  to_da: string;
}
interface State {
  permits: { id: number; da: string | null }[];
  boardDaAssigned: string | null; // draw_schedule.da_assigned
  tasks: Task[];
  handoffs: Handoff[];
}

const isOpen = (t: Task) => t.status !== 'Resolved';

/** Mirror of bp_reassign_project_da. from_da = the board block's DA. */
function reassign(state: State, toDa: string, handoffId = 'h1'): State {
  const fromDa = state.boardDaAssigned;
  const next: State = structuredClone(state);
  // handoff row
  next.handoffs.push({ id: handoffId, from_da: fromDa, to_da: toDa });
  // ownership: all permits.da -> toDa. Board (boardDaAssigned) is NOT touched.
  next.permits = next.permits.map((p) => ({ ...p, da: toDa }));
  // OPEN tasks: from_da -> toDa (dedupe); done tasks untouched.
  if (fromDa && fromDa !== toDa) {
    next.tasks = next.tasks.map((t) =>
      isOpen(t)
        ? {
            ...t,
            assignees: [
              ...new Set(t.assignees.map((a) => (a === fromDa ? toDa : a))),
            ],
          }
        : t,
    );
  }
  return next;
}

/** Mirror of bp_undo_project_da_reassign. */
function undo(state: State, handoffId: string): State {
  const h = state.handoffs.find((x) => x.id === handoffId);
  if (!h) return state;
  const next: State = structuredClone(state);
  // restore permits on to_da back to from_da (board frozen).
  next.permits = next.permits.map((p) =>
    p.da === h.to_da ? { ...p, da: h.from_da } : p,
  );
  if (h.from_da && h.from_da !== h.to_da) {
    next.tasks = next.tasks.map((t) =>
      isOpen(t)
        ? {
            ...t,
            assignees: [
              ...new Set(t.assignees.map((a) => (a === h.to_da ? h.from_da! : a))),
            ],
          }
        : t,
    );
  }
  next.handoffs = next.handoffs.filter((x) => x.id !== handoffId);
  return next;
}

function fixture(): State {
  return {
    permits: [
      { id: 1, da: 'Trevor' }, // BP
      { id: 2, da: 'Trevor' }, // Demo
    ],
    boardDaAssigned: 'Trevor',
    tasks: [
      { id: 'open-1', status: 'Open', assignees: ['Trevor'] },
      { id: 'prog-1', status: 'In Progress', assignees: ['Trevor', 'Bo'] },
      { id: 'done-1', status: 'Resolved', assignees: ['Trevor'] }, // history
    ],
    handoffs: [],
  };
}

describe('fix-225 admin gate', () => {
  it('tenant admin + service_role may reassign; a non-admin cannot', () => {
    expect(canReassign({ authRole: 'authenticated', isTenantAdmin: true })).toBe(true);
    expect(canReassign({ authRole: 'service_role', isTenantAdmin: false })).toBe(true);
    expect(canReassign({ authRole: 'authenticated', isTenantAdmin: false })).toBe(false);
  });
});

describe('fix-225 bp_reassign_project_da (ownership only)', () => {
  it('moves permits.da + OPEN task assignees to the new DA; leaves the board frozen; writes a handoff', () => {
    const after = reassign(fixture(), 'Nicky');
    // ownership: every permit now on Nicky
    expect(after.permits.every((p) => p.da === 'Nicky')).toBe(true);
    // board block stays under the ORIGINAL DA (no move, no push-down)
    expect(after.boardDaAssigned).toBe('Trevor');
    // OPEN tasks re-pointed Trevor -> Nicky
    expect(after.tasks.find((t) => t.id === 'open-1')!.assignees).toEqual(['Nicky']);
    expect(after.tasks.find((t) => t.id === 'prog-1')!.assignees).toEqual(['Nicky', 'Bo']);
    // handoff row written
    expect(after.handoffs).toHaveLength(1);
    expect(after.handoffs[0]).toMatchObject({ from_da: 'Trevor', to_da: 'Nicky' });
  });

  it('DONE (Resolved) tasks keep the old DA as history', () => {
    const after = reassign(fixture(), 'Nicky');
    expect(after.tasks.find((t) => t.id === 'done-1')!.assignees).toEqual(['Trevor']);
  });
});

describe('fix-225 bp_undo_project_da_reassign', () => {
  it('restores the prior owner + open assignees and deletes the handoff', () => {
    const after = reassign(fixture(), 'Nicky');
    const back = undo(after, after.handoffs[0].id);
    expect(back.permits.every((p) => p.da === 'Trevor')).toBe(true);
    expect(back.tasks.find((t) => t.id === 'open-1')!.assignees).toEqual(['Trevor']);
    expect(back.tasks.find((t) => t.id === 'prog-1')!.assignees).toEqual(['Trevor', 'Bo']);
    expect(back.handoffs).toHaveLength(0);
    // board never moved either way
    expect(back.boardDaAssigned).toBe('Trevor');
  });
});
