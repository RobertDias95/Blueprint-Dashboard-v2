import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import type { ProjectMessage } from '../lib/database.types';
import { chatTaskStatus, monthDay, UNASSIGNED_LABEL } from '../lib/chatTaskStatus';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';

// ===========================================================================
// fix-603 (P-172) — a task made from a chat message shows what happened to it
// ===========================================================================
//
// Bobby: *"when someone creates a task here, what the status of it is (not
// started, in progress or completed with a date?)"*. The green row now says:
// status · owner · (overdue) due. The ROLE resolution is fix-238's — this suite
// drives the REAL useTaskOwnership over mocked permits/projects, so a role
// reaching the right name proves the resolver was reused, not re-written.

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u-1', email: 'robertd@blueprintcap.com' },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateTaskFromMessage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'p-1', design_manager: 'Derry', entitlement_lead: 'Miles', schematic_designer: [] }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [{ id: 7, da: 'Brittani', dm: null, ent_lead: null }],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ data: [], rows: [] }) }));

import ChatMessageRow from '../components/ProjectDetail/ChatMessageRow';

const NOW = new Date('2026-09-30T15:00:00');

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: 'u-1',
    author_name: 'Bobby',
    body: 'Please send the survey.',
    mentions: [],
    attachments: [],
    created_at: '2026-09-01T10:00:00Z',
    task_id: 'task-1',
    task_text: 'Send the survey',
    task_permit_id: 7,
    parent_message_id: 'post-1',
    title: null,
    edited_at: null,
    deleted_at: null,
    revisions: [],
    reply_count: null,
    last_activity_at: null,
    ...over,
  } as unknown as ProjectMessage;
}

/** The five fields as the migrated function returns them. */
const FIELDS = {
  task_status: 'Open',
  task_done: false,
  task_done_at: null,
  task_assigned_to: 'Bobby',
  task_due_date: null,
} satisfies Partial<ProjectMessage>;

function renderRow(msg: ProjectMessage) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ChatMessageRow message={msg} projectId="p-1" userId="u-1" people={[]} permits={[]} />,
    { wrapper },
  );
}

const statusText = () => screen.getByTestId('project-chat-task-status-m-1').textContent;
const ownerText = () => screen.getByTestId('project-chat-task-owner-m-1').textContent;

describe('fix-603 §B — the status word', () => {
  it('★★★ Open → Not started', () => {
    renderRow(message(FIELDS));
    expect(statusText()).toBe('Not started');
  });

  it('★★★ In Progress → In progress', () => {
    renderRow(message({ ...FIELDS, task_status: 'In Progress' }));
    expect(statusText()).toBe('In progress');
  });

  it('★★★ done → Completed 9/12, and it reads QUIET (dim, ✓ kept)', () => {
    renderRow(
      message({ ...FIELDS, task_status: 'Resolved', task_done: true, task_done_at: '2026-09-12T18:30:00' }),
    );
    expect(statusText()).toBe('Completed 9/12');
    const status = screen.getByTestId('project-chat-task-status-m-1');
    expect(status.className).toContain('text-dim');
    const row = screen.getByTestId('project-chat-task-m-1');
    expect(row.textContent).toContain('✓ Send the survey');
    expect(row.querySelector('.font-bold')!.className).toContain('text-dim');
  });

  it('★ an open task reads normal', () => {
    renderRow(message(FIELDS));
    expect(screen.getByTestId('project-chat-task-status-m-1').className).toContain('text-text');
    expect(screen.getByTestId('project-chat-task-m-1').querySelector('.font-bold')!.className).toContain('text-text');
  });
});

describe('fix-603 §B — who owns it', () => {
  it('★★★ a ROLE resolves to the person, through fix-238\'s resolver', () => {
    renderRow(message({ ...FIELDS, task_assigned_to: 'Design Manager' }));
    expect(ownerText()).toBe('Derry'); // project p-1's design_manager
  });

  it('★★ a Design Associate role resolves off the task\'s permit', () => {
    renderRow(message({ ...FIELDS, task_assigned_to: 'Design Associate' }));
    expect(ownerText()).toBe('Brittani'); // permit 7's da
  });

  it('★★ a person is shown as themselves', () => {
    renderRow(message({ ...FIELDS, task_assigned_to: 'Shire' }));
    expect(ownerText()).toBe('Shire');
  });

  it('★★★ blank → Unassigned (not the discipline default)', () => {
    renderRow(message({ ...FIELDS, task_assigned_to: null }));
    expect(ownerText()).toBe(UNASSIGNED_LABEL);
    renderRow(message({ ...FIELDS, id: 'm-2', task_assigned_to: '  ' } as Partial<ProjectMessage>));
    expect(screen.getByTestId('project-chat-task-owner-m-2').textContent).toBe('Unassigned');
  });
});

describe('fix-603 §B — past due', () => {
  it('★★★ an open task past its due date shows the date in the warning colour', () => {
    renderRow(message({ ...FIELDS, task_due_date: '2020-01-05' }));
    const due = screen.getByTestId('project-chat-task-due-m-1');
    expect(due.textContent).toBe('due 1/5');
    expect(due.getAttribute('style')).toContain('var(--color-co)');
  });

  it('★★ a future due date, or a done task, shows no warning', () => {
    renderRow(message({ ...FIELDS, task_due_date: '2099-01-05' }));
    expect(screen.queryByTestId('project-chat-task-due-m-1')).toBeNull();
    const v = chatTaskStatus(
      { task_id: 't', task_status: 'Resolved', task_done: true, task_done_at: null, task_assigned_to: null, task_due_date: '2020-01-01' },
      NOW,
    );
    expect(v!.overdueDue).toBeNull();
  });

  it('★ "today" is the LOCAL calendar day — due today is not past due', () => {
    const v = chatTaskStatus(
      { task_id: 't', task_status: 'Open', task_done: false, task_done_at: null, task_assigned_to: null, task_due_date: '2026-09-30' },
      new Date('2026-09-30T23:30:00'),
    );
    expect(v!.overdueDue).toBeNull();
  });
});

describe('fix-603 §B4 — null-safe before the migration', () => {
  it('★★★ fields absent → the row is exactly today\'s', () => {
    renderRow(message()); // no task_status/… keys at all
    const row = screen.getByTestId('project-chat-task-m-1');
    expect(row.textContent).toBe('✓ Send the survey · created from this message');
    expect(screen.queryByTestId('project-chat-task-status-m-1')).toBeNull();
    expect(screen.queryByTestId('project-chat-task-owner-m-1')).toBeNull();
    expect(row.querySelector('.font-bold')!.className).toBe('font-bold text-text');
  });

  it('★ the pure view is null without the fields, and without a task', () => {
    const base = { task_id: 'x' } as ProjectMessage;
    expect(chatTaskStatus(base, NOW)).toBeNull();
    expect(chatTaskStatus({ ...base, ...FIELDS, task_id: null }, NOW)).toBeNull();
    expect(monthDay('2026-09-12')).toBe('9/12');
    expect(monthDay(null)).toBeNull();
  });
});

describe('fix-603 §B5 — live', () => {
  it('★★★ a task change anywhere refreshes the chat thread (realtime)', () => {
    expect(REALTIME_TABLES.permit_tasks).toContainEqual(queryKeys.projectMessagesAll);
  });

  it('★★ …and the local task writes invalidate it too', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
    const tree = read('src/hooks/useTaskTree.ts');
    expect(tree.match(/queryKey: queryKeys\.projectMessagesAll/g)?.length).toBeGreaterThanOrEqual(2);
    const reconcile = read('src/lib/taskReconcile.ts');
    expect(reconcile.match(/queryKey: queryKeys\.projectMessagesAll/g)?.length).toBe(2);
  });
});

describe('fix-603 §A — the migration', () => {
  const RAW = readFileSync(resolve(process.cwd(), 'migrations/fix_603_chat_task_status.sql'), 'utf8');
  const SQL = RAW.split('\n').map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l)).join('\n');

  it('★★★ DROP + CREATE, in ONE transaction, DROP first', () => {
    expect(SQL.trim().startsWith('BEGIN;')).toBe(true);
    expect(SQL.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(SQL.match(/\bBEGIN;/g)).toHaveLength(1);
    const drop = SQL.indexOf('DROP FUNCTION public.bp_list_project_messages(uuid);');
    const create = SQL.indexOf('CREATE FUNCTION public.bp_list_project_messages(p_project_id uuid)');
    expect(drop).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(drop);
  });

  it('★★★ the grants are restated exactly, and anon gets nothing', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.bp_list_project_messages(uuid) FROM PUBLIC, anon;');
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.bp_list_project_messages(uuid) TO authenticated, service_role;',
    );
    expect(SQL).not.toMatch(/GRANT[^;]*\banon\b/i);
    expect(SQL).toMatch(/has_function_privilege\('anon'/);
  });

  it('★★ the five columns come AFTER the old eighteen, and the rest is unchanged', () => {
    const ret = SQL.match(/RETURNS TABLE\(([^)]*)\)/)![1]!;
    const cols = ret.split(',').map((c) => c.trim().split(/\s+/)[0]);
    expect(cols.slice(0, 18)).toEqual([
      'id', 'project_id', 'parent_message_id', 'title', 'author_id', 'author_name', 'body',
      'mentions', 'attachments', 'created_at', 'edited_at', 'deleted_at', 'revisions',
      'task_id', 'task_text', 'task_permit_id', 'reply_count', 'last_activity_at',
    ]);
    expect(cols.slice(18)).toEqual([
      'task_status', 'task_done', 'task_done_at', 'task_assigned_to', 'task_due_date',
    ]);
    expect(SQL).toMatch(/STABLE SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(SQL).toContain('AND m.tenant_id = ANY (public.auth_tenant_ids())');
    expect(SQL).toContain('ORDER BY m.created_at ASC, m.id ASC;');
  });

  it('★★ it checks for dependents before dropping, and stops if any exist', () => {
    const guard = SQL.indexOf('FROM pg_depend');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(SQL.indexOf('DROP FUNCTION'));
    expect(SQL).toContain('STOP');
  });

  it('★ it writes no data', () => {
    expect(SQL).not.toMatch(/\b(update|insert\s+into|delete\s+from)\s+(public\.)?\w+/i);
  });
});
