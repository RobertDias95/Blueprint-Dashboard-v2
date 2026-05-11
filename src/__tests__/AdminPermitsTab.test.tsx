import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q7.3.c: smoke tests for AdminPermitsTab + TaskTemplateEditor. Hooks
// mocked for synchronous render; mutate fns captured via vi.hoisted
// handles for assertion.

const T = 'test-tenant-uuid';
const NOW = '2026-05-11T12:00:00Z';

const mocks = vi.hoisted(() => ({
  upsertTpl: vi.fn(),
  deleteTpl: vi.fn(),
  upsertSub: vi.fn(),
  deleteSub: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const NOW = '2026-05-11T12:00:00Z';
  const templates = [
    {
      id: 't1', permit_type: 'Building Permit', jurisdiction: null, bucket: 'de',
      text: 'Survey', default_assignee: null, default_target_offset: null,
      cat: 'reports', sort_order: 0, updated_at: NOW,
      subtasks: [],
    },
    {
      id: 't2', permit_type: 'Building Permit', jurisdiction: null, bucket: 'de',
      text: 'Energy', default_assignee: 'Architecture', default_target_offset: 14,
      cat: 'forms', sort_order: 1, updated_at: NOW,
      subtasks: [
        { id: 's1', template_id: 't2', text: 'NEEA form', sort_order: 0, updated_at: NOW },
      ],
    },
    {
      id: 't3', permit_type: 'Building Permit', jurisdiction: 'Seattle', bucket: 'de',
      text: 'Seattle-specific drainage review', default_assignee: null,
      default_target_offset: null, cat: 'forms', sort_order: 0, updated_at: NOW,
      subtasks: [],
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
    data: [
      { name: 'Seattle', learn_window_days: 120, notes: null },
      { name: 'Bellevue', learn_window_days: 120, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertTaskTemplate', () => ({
  useUpsertTaskTemplate: () => ({ mutate: mocks.upsertTpl }),
}));
vi.mock('../hooks/useDeleteTaskTemplate', () => ({
  useDeleteTaskTemplate: () => ({ mutate: mocks.deleteTpl }),
}));
vi.mock('../hooks/useUpsertTaskTemplateSubtask', () => ({
  useUpsertTaskTemplateSubtask: () => ({ mutate: mocks.upsertSub }),
}));
vi.mock('../hooks/useDeleteTaskTemplateSubtask', () => ({
  useDeleteTaskTemplateSubtask: () => ({ mutate: mocks.deleteSub }),
}));

import AdminPermitsTab from '../components/Settings/AdminPermitsTab';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminPermitsTab />
    </QueryClientProvider>,
  );
}

describe('<AdminPermitsTab /> Q7.3.c', () => {
  it('renders the editor + 3 scope selectors + initial-scope templates', () => {
    renderIt();
    expect(screen.getByTestId('admin-permits-tab')).toBeInTheDocument();
    expect(screen.getByTestId('task-template-editor')).toBeInTheDocument();
    expect(screen.getByTestId('tte-type')).toBeInTheDocument();
    expect(screen.getByTestId('tte-juris')).toBeInTheDocument();
    expect(screen.getByTestId('tte-bucket')).toBeInTheDocument();
    // Default scope: Building Permit · Base · de → 2 templates (t1, t2)
    expect(screen.getByTestId('tte-row-t1')).toBeInTheDocument();
    expect(screen.getByTestId('tte-row-t2')).toBeInTheDocument();
    expect(screen.queryByTestId('tte-row-t3')).not.toBeInTheDocument();
  });

  it('switching juris to Seattle swaps in the per-juris template (t3)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('tte-juris'), {
      target: { value: 'Seattle' },
    });
    expect(screen.getByTestId('tte-row-t3')).toBeInTheDocument();
    expect(screen.queryByTestId('tte-row-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-row-t2')).not.toBeInTheDocument();
  });

  it('switching bucket to PM yields zero templates + empty-state message', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('tte-bucket'), {
      target: { value: 'pm' },
    });
    expect(screen.queryByTestId('tte-row-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-row-t2')).not.toBeInTheDocument();
    expect(screen.getByText(/No templates yet/i)).toBeInTheDocument();
  });

  it('adding a template fires bp_upsert_task_template_row insert with scope', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('tte-add'), {
      target: { value: 'Geotech' },
    });
    fireEvent.click(screen.getByTestId('tte-add-btn'));
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'insert',
      patch: {
        permit_type: 'Building Permit',
        jurisdiction: null,
        bucket: 'de',
        text: 'Geotech',
        sort_order: 2,
      },
    });
  });

  it('editing template text fires update with the new value on Enter', () => {
    renderIt();
    // Click the inline text → input swap → type → Enter
    fireEvent.click(screen.getByTestId('tte-text-t1'));
    const input = screen.getAllByTestId('tte-text-t1').pop() as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Survey + flagging' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { text: 'Survey + flagging' },
    });
  });

  it('Escape during edit cancels without firing', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('tte-text-t1'));
    const input = screen.getAllByTestId('tte-text-t1').pop() as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wontcommit' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mocks.upsertTpl).not.toHaveBeenCalled();
  });

  it('changing the offset commits as an integer', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('tte-offset-t1'));
    const input = screen.getAllByTestId('tte-offset-t1').pop() as HTMLInputElement;
    fireEvent.change(input, { target: { value: '21' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { default_target_offset: 21 },
    });
  });

  it('× on a template fires bp_delete_task_template_row', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('tte-remove-t1'));
    expect(mocks.deleteTpl).toHaveBeenCalledWith({
      id: 't1',
      updated_at: NOW,
    });
  });

  it('up arrow fires two upserts to swap sort_orders', () => {
    renderIt();
    // t2 is at index 1; clicking ▲ moves it to index 0.
    fireEvent.click(screen.getByTestId('tte-up-t2'));
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't2' }),
      patch: { sort_order: 0 },
    });
    expect(mocks.upsertTpl).toHaveBeenCalledWith({
      op: 'update',
      template: expect.objectContaining({ id: 't1' }),
      patch: { sort_order: 1 },
    });
  });

  it('up arrow on the top row is disabled (no fire)', () => {
    renderIt();
    const upBtn = screen.getByTestId('tte-up-t1') as HTMLButtonElement;
    expect(upBtn.disabled).toBe(true);
    fireEvent.click(upBtn);
    expect(mocks.upsertTpl).not.toHaveBeenCalled();
  });

  it('+ sub opens subtask input; Enter commits a new subtask', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('tte-add-sub-t1'));
    const input = screen.getByTestId('tte-sub-new-t1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New sub' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.upsertSub).toHaveBeenCalledWith({
      op: 'insert',
      patch: { template_id: 't1', text: 'New sub', sort_order: 0 },
    });
  });

  it('existing subtask renders + × fires delete', () => {
    renderIt();
    expect(screen.getByTestId('tte-sub-text-s1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tte-sub-remove-s1'));
    expect(mocks.deleteSub).toHaveBeenCalledWith({
      id: 's1',
      updated_at: NOW,
    });
  });

  it('non-admin role hides + sub / × / arrows / add-form (read-only)', () => {
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'editor' }],
    });
    renderIt();
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.queryByTestId('tte-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-remove-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-up-t2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-add-sub-t1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tte-sub-remove-s1')).not.toBeInTheDocument();
    // Clicking the inline text in read-only mode should NOT open the edit input.
    fireEvent.click(screen.getByTestId('tte-text-t1'));
    // Verify input variant didn't render (only span variant present).
    const matches = screen.getAllByTestId('tte-text-t1');
    expect(matches.every((el) => el.tagName !== 'INPUT')).toBe(true);
  });
});
