import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MyTaskNode } from '../lib/database.types';
import {
  makeTaskOwnership,
  TASK_OWNERSHIP_MEMBERS,
} from '../test/taskOwnership';

// fix-238: end-to-end proof that the shared ownership resolver maps an
// assigned_to ROLE placeholder to the person who fills that role on the task's
// project — the routing that was missing for Design Manager / Schematic Team.

const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const dmRowsRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: permitsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: dmRowsRef.current }),
}));

import { useTaskOwnership } from '../hooks/useTaskOwnership';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function task(over: Partial<MyTaskNode> & Pick<MyTaskNode, 'id'>): MyTaskNode {
  return {
    permit_id: 10,
    project_id: 'proj-1',
    project_address: '4040 E Via Estrella',
    permit_type: 'Building Permit',
    parent_task_id: null,
    discipline: 'arch',
    bucket: 'de',
    text: 'Window & Door Schedule Review',
    status: 'Open',
    start_date: null,
    target_date: null,
    done_at: null,
    sort_order: 0,
    primary_assignee: null,
    co_assignees: [],
    permit_da: 'Qisheng',
    ...over,
  } as MyTaskNode;
}

beforeEach(() => {
  // Permit 10 → DA Qisheng, ent lead Miles. Project proj-1 → DM Derry,
  // schematic Sam. DA→DM group maps Qisheng → Derry (the chip's DM source).
  permitsRef.current = [
    { id: 10, da: 'Qisheng', dm: null, ent_lead: 'Miles' },
  ];
  projectsRef.current = [
    { id: 'proj-1', design_manager: 'Derry', entitlement_lead: 'Miles', schematic_designer: ['Sam'] },
  ];
  dmRowsRef.current = [{ da_name: 'Qisheng', dm_name: 'Derry' }];
});

describe('useTaskOwnership (fix-238)', () => {
  it('routes a "Design Manager" task to the DM and (arch) still to the DA', () => {
    const { result } = renderHook(() => useTaskOwnership(), { wrapper });
    const t = task({ id: 't1', assigned_to: 'Design Manager' });
    expect(result.current.matches(t, 'Derry')).toBe(true);
    expect(result.current.matches(t, 'Qisheng')).toBe(true); // DA arch blanket
    expect(result.current.matches(t, 'Miles')).toBe(false);
  });

  it('routes a "Schematic Team" task to the schematic designer', () => {
    const { result } = renderHook(() => useTaskOwnership(), { wrapper });
    const t = task({ id: 't2', assigned_to: 'Schematic Team' });
    expect(result.current.matches(t, 'Sam')).toBe(true);
  });

  it('routes an entitlement task to the ent lead, not the DA (no arch blanket)', () => {
    const { result } = renderHook(() => useTaskOwnership(), { wrapper });
    const t = task({ id: 't3', discipline: 'ent', assigned_to: 'Entitlements' });
    expect(result.current.matches(t, 'Miles')).toBe(true);
    expect(result.current.matches(t, 'Qisheng')).toBe(false);
  });

  it('routes a co-assignee', () => {
    const { result } = renderHook(() => useTaskOwnership(), { wrapper });
    const t = task({ id: 't4', assigned_to: 'Design Associate', co_assignees: ['Priya'] });
    expect(result.current.matches(t, 'Priya')).toBe(true);
  });
});

// ===========================================================================
// ★★★ fix-459 §A4 (P-107) — THE GUARD, AND IT FAILS IN THE RIGHT PLACE
// ===========================================================================
//
// THE DEFECT: ten suites mocked this hook with a bare literal and NOT ONE
// declared all four members. Adding `isUnclaimed` in fix-458 therefore broke
// five unrelated suites at once — the alarm went off in strangers' code, on a
// change that was correct. fix-407 hit it, fix-449 documented it, fix-458 paid
// it again; each left a comment instead of a guard.
//
// ★★★ STEP 0c, MEASURED NOT ASSUMED: TypeScript CANNOT catch the raw literal.
// A probe factory returning `{ totallyBogusMember: 123 }` from
// `vi.mock('../hooks/useTaskOwnership', ...)` typechecks clean — vitest does not
// constrain a mock factory against the real module.
//
// So the net has two halves:
//   1. COMPILE TIME — `makeTaskOwnership`'s `base` is annotated `TaskOwnership`,
//      so a fifth member breaks src/test/taskOwnership.ts itself. That is the
//      loud failure, beside the fix.
//   2. RUNTIME — this test, because (1) is a claim a reader cannot verify by
//      looking. It compares the REAL hook's key set against the double's.
//
// ★★ THIS SUITE IS THE RIGHT HOME because it is the only one that renders the
//    REAL hook. Everywhere else the hook is mocked, so a comparison there would
//    be the double against itself.
describe('fix-459 §A4: the shared double cannot go stale', () => {
  it('★★★ the double exposes EXACTLY the real hook’s members', () => {
    const { result } = renderHook(() => useTaskOwnership(), { wrapper });
    const real = Object.keys(result.current).sort();
    const double = Object.keys(makeTaskOwnership()).sort();

    // ★ Add a member to the hook and forget src/test/taskOwnership, and this
    //   line fails BY NAME, here — not in five suites about bells and boards.
    expect(double).toEqual(real);

    // ★★ …and the declared list is a THIRD witness, so adding a member to both
    //    the hook and the double while forgetting the list still fails. It is
    //    spelled out rather than derived from the factory, which would make
    //    this assertion circular and prove nothing.
    expect(real).toEqual([...TASK_OWNERSHIP_MEMBERS]);
  });

  it('★★ every member of the real hook is callable on the double', () => {
    // Key equality alone would pass for a member whose value is `undefined` —
    // which is exactly the runtime failure the ten partial mocks produced.
    const double = makeTaskOwnership();
    for (const k of TASK_OWNERSHIP_MEMBERS) {
      expect(typeof double[k], `${k} is not callable on the double`).toBe(
        'function',
      );
    }
  });

  it('★★★ an override keeps the object COMPLETE (§A2)', () => {
    // The point of the factory: a suite states the one member it cares about
    // and inherits honest defaults for the rest.
    const only = makeTaskOwnership({ matches: () => false });
    expect(Object.keys(only).sort()).toEqual([...TASK_OWNERSHIP_MEMBERS]);
    expect(only.matches(task({ id: 'x' }), 'anyone')).toBe(false);
    // ★ The defaults are the INERT answer — nothing is added to any list.
    expect(only.ownsDirectly(task({ id: 'x' }), 'anyone')).toBe(false);
    expect(only.isCoAssigned(task({ id: 'x' }), 'anyone')).toBe(false);
    expect(only.isUnclaimed(task({ id: 'x' }))).toBe(false);
  });

  it('★★ the DEFAULT for `matches` is true — preserving the ten migrated suites', () => {
    // §A2: migrating a suite must not change what it asserts. Every one of the
    // ten mocks set `matches: () => true`, so that is the default. If this
    // flips to false, those suites silently start asserting something else.
    expect(makeTaskOwnership().matches(task({ id: 'x' }), 'anyone')).toBe(true);
  });
});
