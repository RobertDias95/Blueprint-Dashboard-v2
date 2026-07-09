import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  PermitWithCycles,
  TaskNode,
  TeamMember,
} from '../lib/database.types';

// fix-149 / fix-190d: inline Waiting On chip on the permit-detail task editor.
// Mirrors the My Tasks Waiting On field (same WAITING_ON_OPTIONS vocab, same
// useUpsertTask 3-state wiring) and resolves the firm from projects.external_team
// (the store the editor writes) — the single source My Tasks → Waiting also reads.

const upsertMutate = vi.hoisted(() => vi.fn());
const treeRef = vi.hoisted(() => ({ current: [] as TaskNode[] }));
const teamRef = vi.hoisted(() => ({ current: [] as Partial<TeamMember>[] }));
// fix-190d: project.external_team blob (discipline -> firm name) for the resolver.
const blobRef = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpsertPermitCycle', () => ({
  useUpsertPermitCycle: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDeletePermitCycle', () => ({
  useDeletePermitCycle: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePermitTasks', () => ({
  usePermitTasks: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../components/ProjectDetail/ScheduleEstimator', () => ({
  default: () => <div data-testid="stub-schedule-estimator" />,
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: teamRef.current,
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  usePermitTaskTree: () => ({
    data: treeRef.current,
    isLoading: false, error: null, refetch: vi.fn(),
  }),
  useUpsertTask: () => ({ mutate: upsertMutate, isPending: false }),
  useDeleteTask: () => ({ mutate: vi.fn(), isPending: false }),
  useSetTaskAssignees: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjectExternalTeamBlob', () => ({
  useProjectExternalTeamBlob: () => ({
    blob: blobRef.current,
    resolve: (d: string | null | undefined) => {
      const firm = d ? blobRef.current[d] : undefined;
      return typeof firm === 'string' && firm.trim() !== '' ? firm : null;
    },
  }),
}));

import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';

function makePermit(): PermitWithCycles {
  return {
    id: 10009, project_id: 'p-test', type: 'Building Permit', stage: 'de',
    stage_override: null, status: null, num: null, da: 'Ainsley', dm: null,
    ent_lead: 'Edmund', dual_da: null, target_submit: null, dd_start: null,
    dd_end: null, expected_issue: null, actual_issue: null, approval_date: null,
    intake_date: null, notes: null, cycle_model: null, view_cycle: null,
    kickoff_date: null, corr_rounds: null, permit_owner: null, architect: null,
    nickname: null, struct_address: null, portal_url: null,
    updated_at: '2026-05-14T12:00:00Z', permit_cycles: [],
  } as unknown as PermitWithCycles;
}

function makeTask(over: Partial<TaskNode> & Pick<TaskNode, 'id'>): TaskNode {
  return {
    permit_id: 10009, parent_task_id: null, discipline: 'ent', bucket: 'de',
    text: 'Submit application', status: 'Open', start_date: null,
    target_date: null, done_at: null, sort_order: 0, primary_assignee: 'Edmund',
    co_assignees: [], subtasks: [], waiting_on: null,
    ...over,
  } as TaskNode;
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<PermitDetailV2 permit={makePermit()} />, { wrapper });
}

beforeEach(() => {
  upsertMutate.mockReset();
  teamRef.current = [{ name: 'Ainsley' }, { name: 'Edmund' }];
  blobRef.current = {};
  treeRef.current = [makeTask({ id: 'task-1' })];
});

describe('Permit detail task — Waiting On chip (fix-149)', () => {
  it('renders the "+ Waiting On" affordance on a task with waiting_on null', () => {
    renderIt();
    const sel = screen.getByTestId('task-waiting-on-task-1') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect(screen.getByTestId('task-waiting-on-task-1-option-Civil')).toBeTruthy();
  });

  it('picking a discipline fires useUpsertTask with waitingOn set', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('task-waiting-on-task-1'), {
      target: { value: 'Civil' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      waitingOn: 'Civil',
    });
  });

  it('shows "→ Emerald" firm suffix from the project external_team blob when set', () => {
    // fix-190d: resolves from projects.external_team (the store the editor writes).
    // fix-229: the control is a single select (value=discipline) + a muted firm
    // suffix span, not a chip.
    blobRef.current = { Surveyor: 'Emerald' };
    treeRef.current = [makeTask({ id: 'task-1', waiting_on: 'Surveyor' })];
    renderIt();
    expect((screen.getByTestId('task-waiting-on-task-1') as HTMLSelectElement).value).toBe('Surveyor');
    expect(screen.getByTestId('task-waiting-on-task-1-firm').textContent).toContain('Emerald');
  });

  it('shows no firm suffix when no External Team firm is assigned', () => {
    blobRef.current = {}; // nothing assigned
    treeRef.current = [makeTask({ id: 'task-1', waiting_on: 'Civil' })];
    renderIt();
    expect((screen.getByTestId('task-waiting-on-task-1') as HTMLSelectElement).value).toBe('Civil');
    expect(screen.queryByTestId('task-waiting-on-task-1-firm')).toBeNull();
  });

  it('selecting "—" clears via useUpsertTask with clearWaitingOn=true', () => {
    treeRef.current = [makeTask({ id: 'task-1', waiting_on: 'Civil' })];
    renderIt();
    fireEvent.change(screen.getByTestId('task-waiting-on-task-1'), {
      target: { value: '' },
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'task-1',
      waitingOn: null,
      clearWaitingOn: true,
    });
  });

  it('unset → the SAME select (value="", "—" + options), no firm suffix', () => {
    // fix-229: whether set or empty, Waiting-On is one select — never a chip on
    // one row and a dropdown on another. The SET case (select value=discipline +
    // firm suffix) is covered by the "→ Emerald firm suffix" test above.
    renderIt();
    const unset = screen.getByTestId('task-waiting-on-task-1') as HTMLSelectElement;
    expect(unset.tagName).toBe('SELECT');
    expect(unset.value).toBe('');
    expect(screen.getByTestId('task-waiting-on-task-1-option-Structural')).toBeTruthy();
    expect(screen.queryByTestId('task-waiting-on-task-1-firm')).toBeNull();
  });
});
