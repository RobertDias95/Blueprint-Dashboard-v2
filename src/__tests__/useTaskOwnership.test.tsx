import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MyTaskNode } from '../lib/database.types';

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
