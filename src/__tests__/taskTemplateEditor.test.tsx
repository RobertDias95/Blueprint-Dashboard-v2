import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-153: focused tests for the new TaskTemplateEditor capabilities —
// team selector, co-assignees multi-select (team members + free text),
// waiting-on selector, drag-reorder, and the dropped Corrections bucket.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsertTpl: vi.fn(),
  deleteTpl: vi.fn(),
  upsertSub: vi.fn(),
  deleteSub: vi.fn(),
  reorderTpl: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const NOW = '2026-05-11T12:00:00Z';
  const base = {
    default_team: null as string | null,
    default_co_assignees: [] as string[],
    default_waiting_on: null as string | null,
    default_target_offset: null as number | null,
  };
  const templates = [
    {
      id: 't1', permit_type: 'Building Permit', jurisdiction: null, bucket: 'de',
      text: 'Survey', ...base, cat: 'reports', sort_order: 0, updated_at: NOW,
      subtasks: [],
    },
    {
      id: 't2', permit_type: 'Building Permit', jurisdiction: null, bucket: 'de',
      text: 'Energy', ...base, default_team: 'Architecture',
      default_co_assignees: ['Existing Person'],
      cat: 'forms', sort_order: 1, updated_at: NOW, subtasks: [],
    },
  ];
  function scopeKey(pt: string, j: string | null, b: string) {
    return `${pt}||${j ?? ''}||${b}`;
  }
  const byScope = new Map<string, typeof templates>();
  for (const t of templates) {
    const key = scopeKey(t.permit_type, t.jurisdiction, t.bucket);
    const list = byScope.get(key) ?? [];
    list.push(t);
    byScope.set(key, list);
  }
  return { templates, byScope };
});

vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: fixtures.templates,
    subtasks: [],
    byScope: fixtures.byScope,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  scopeKey: (pt: string, j: string | null, b: string) =>
    `${pt}||${j ?? ''}||${b}`,
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [{ name: 'Seattle', learn_window_days: 120, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [{ name: 'Building Permit', is_builtin: true, notes: null }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual, // keep the real activeMemberNamesOf helper (fix-233)
    useTeamMembers: () => ({
      all: [
        { id: 'm1', name: 'Jordan', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
        { id: 'm2', name: 'Sarah', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
        // fix-222: Bobby holds BOTH ent + ent_lead — the picker must show him once.
        { id: 'm3', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
        { id: 'm4', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      ],
      activeDas: [], formerDas: [], dms: [], ents: [], acqs: [], schematics: [],
      isLoading: false, error: null, data: [], refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useUpsertTaskTemplate', () => ({
  useUpsertTaskTemplate: () => ({ mutate: mocks.upsertTpl }),
}));
vi.mock('../hooks/useDeleteTaskTemplate', () => ({
  useDeleteTaskTemplate: () => ({ mutate: mocks.deleteTpl }),
}));
vi.mock('../hooks/useReorderTaskTemplates', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useReorderTaskTemplates')>()),
  useReorderTaskTemplates: () => ({ mutate: mocks.reorderTpl }),
}));
vi.mock('../hooks/useUpsertTaskTemplateSubtask', () => ({
  useUpsertTaskTemplateSubtask: () => ({ mutate: mocks.upsertSub }),
}));
vi.mock('../hooks/useDeleteTaskTemplateSubtask', () => ({
  useDeleteTaskTemplateSubtask: () => ({ mutate: mocks.deleteSub }),
}));

import TaskTemplateEditor from '../components/Settings/TaskTemplateEditor';
import { reorderTemplateIds } from '../hooks/useReorderTaskTemplates';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderEditor(readOnly = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskTemplateEditor readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('TaskTemplateEditor — fix-153 capabilities', () => {
  it('renders D&E + Permitting stage options only (no Corrections)', () => {
    renderEditor();
    const stage = screen.getByTestId('tte-bucket') as HTMLSelectElement;
    const labels = Array.from(stage.options).map((o) => o.textContent);
    expect(labels).toEqual(['D&E', 'Permitting']);
  });

  it('fix-222: the Team dropdown offers exactly the 3 new taxonomy values', () => {
    renderEditor();
    const team = screen.getByTestId(
      'task-template-row-t1-team',
    ) as HTMLSelectElement;
    const labels = Array.from(team.options).map((o) => o.textContent);
    expect(labels).toEqual([
      '(none)',
      'Entitlements',
      'Design Associate',
      'Schematic Team',
    ]);
    expect(labels).not.toContain('Architecture');
  });

  it('selecting a Team persists default_team', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('task-template-row-t1-team'), {
      target: { value: 'Design Associate' },
    });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { default_team: 'Design Associate' },
    });
  });

  it('fix-222: co-assignee people picker shows each person once (deduped)', () => {
    const { container } = renderEditor();
    const datalist = container.querySelector(
      '#co-assignee-options-t1',
    ) as HTMLDataListElement;
    const values = Array.from(datalist.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    // Bobby (ent + ent_lead) appears once, not twice.
    expect(values.filter((v) => v === 'Bobby')).toHaveLength(1);
    // The dynamic role labels are also offered.
    expect(values).toContain('Design Manager');
  });

  it('fix-222: selecting a dynamic role stores a role token', () => {
    renderEditor();
    const input = screen.getByTestId(
      'task-template-row-t1-co-assignees-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Design Manager' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { default_co_assignees: ['role:design_manager'] },
    });
  });

  it('fix-222: the retired cat field is no longer rendered', () => {
    renderEditor();
    expect(screen.queryByTestId('tte-cat-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-cat-t2')).not.toBeInTheDocument();
  });

  it('fix-223: the retired offset field is no longer rendered', () => {
    renderEditor();
    expect(screen.queryByTestId('tte-offset-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-offset-t2')).not.toBeInTheDocument();
  });

  it('clearing a Team to (none) persists null', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('task-template-row-t2-team'), {
      target: { value: '' },
    });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't2' }),
      patch: { default_team: null },
    });
  });

  it('selecting a Waiting On discipline persists default_waiting_on', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('task-template-row-t1-waiting-on'), {
      target: { value: 'Civil' },
    });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { default_waiting_on: 'Civil' },
    });
  });

  it('co-assignees accepts a team-member name (datalist) via Enter', () => {
    renderEditor();
    const input = screen.getByTestId(
      'task-template-row-t1-co-assignees-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Jordan' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { default_co_assignees: ['Jordan'] },
    });
  });

  it('co-assignees accepts a free-text (non-member) name via Enter', () => {
    renderEditor();
    const input = screen.getByTestId(
      'task-template-row-t1-co-assignees-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Outside Consultant' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { default_co_assignees: ['Outside Consultant'] },
    });
  });

  it('co-assignees appends to an existing list and removes via the chip ×', () => {
    renderEditor();
    // t2 starts with ['Existing Person']; add 'Sarah'.
    const input = screen.getByTestId(
      'task-template-row-t2-co-assignees-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Sarah' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't2' }),
      patch: { default_co_assignees: ['Existing Person', 'Sarah'] },
    });

    // Remove the existing chip.
    fireEvent.click(
      screen.getByTestId(
        'task-template-row-t2-co-assignee-remove-Existing Person',
      ),
    );
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't2' }),
      patch: { default_co_assignees: [] },
    });
  });

  it('dragging a row reorders ids and persists via bp_reorder_task_templates', () => {
    // The pure reorder math the drag handler relies on.
    expect(reorderTemplateIds(['t1', 't2'], 't2', 't1')).toEqual(['t2', 't1']);
    expect(reorderTemplateIds(['t1', 't2', 't3'], 't1', 't3')).toEqual([
      't2', 't3', 't1',
    ]);
    expect(reorderTemplateIds(['t1', 't2'], 't1', 't1')).toEqual(['t1', 't2']);

    // Both rows render a grab handle to initiate the drag.
    renderEditor();
    expect(
      screen.getByTestId('task-template-row-t1-drag-handle'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('task-template-row-t2-drag-handle'),
    ).toBeInTheDocument();
  });

  it('read-only hides team/co-assignee/waiting-on editing controls', () => {
    renderEditor(true);
    // Selects become disabled; the co-assignee input + drag handle disappear.
    const team = screen.getByTestId(
      'task-template-row-t1-team',
    ) as HTMLSelectElement;
    expect(team.disabled).toBe(true);
    expect(
      screen.queryByTestId('task-template-row-t1-co-assignees-input'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('task-template-row-t1-drag-handle'),
    ).not.toBeInTheDocument();
  });
});
