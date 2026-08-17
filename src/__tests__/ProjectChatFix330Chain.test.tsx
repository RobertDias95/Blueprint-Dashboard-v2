import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { buildNewItems, keyForTask } from '../lib/boardReads';
import { legShape } from '../lib/myBoard';
import { taskNeedsOwner } from '../lib/boardOwnership';
import type { Permit, PermitWithCycles, TeamMember } from '../lib/database.types';

// fix-330 — ★ THE CHAIN, PROVED RATHER THAN ASSUMED.
//
// Bobby named it:
//
//   create task → assigned to a chosen permit → appears in My Tasks
//                → appears on My Board under fix-308's ownership rules
//                → RENDERS BACK ON THAT PERMIT in Project Overview
//
// ★★ THE LAST HOP IS THE ONE THE BRIEF SAYS IS MOST LIKELY TO BE MISSING, and
// "it works because bp_upsert_permit_task was reused" is an assumption until
// something checks it. So this file does not mock the write path and then
// assert the mock: it stands up ONE IN-MEMORY DATABASE behind a mocked supabase
// client, drives the REAL chat composer into it through the REAL
// useCreateTaskFromMessage → useUpsertTask → bp_upsert_permit_task path, and
// then renders the REAL PermitDetailV2 and the REAL My Tasks off that same
// store. Nothing in the middle is stubbed, so a break anywhere along the chain
// fails here.
//
// (The prod half of the same proof — a rolled-back probe showing
// bp_list_permit_tasks and bp_list_tasks return the row — is in the PR body.)

// ---------------------------------------------------------------- the store --

interface TaskRow {
  id: string;
  permit_id: number;
  parent_task_id: string | null;
  discipline: 'arch' | 'ent';
  bucket: 'de' | 'pm';
  text: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  assigned_to: string | null;
  target_date: string | null;
  start_date: string | null;
  source_message_id: string | null;
  created_at: string;
}

const db = vi.hoisted(() => ({
  tasks: [] as TaskRow[],
  seq: 0,
  uploads: [] as { bucket: string; path: string; name: string }[],
  inserted: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
}));

const PROJECT = 'p-1';
const BP = 12;
const DEMO = 21;

/** A chainable stand-in that resolves to {data, error} however it is called, so
 *  the many other queries PermitDetailV2 and My Tasks fire are inert rather
 *  than exploding. */
function inertBuilder(result: unknown = []) {
  const box: Record<string, unknown> = {};
  const chain = new Proxy(box, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: result, error: null }).then(res);
      }
      return () => chain;
    },
  });
  return chain;
}

const supabaseMock = vi.hoisted(() => {
  const listPermitTasks = (permitId: number) =>
    db.tasks
      .filter((t) => t.permit_id === permitId && t.parent_task_id === null)
      .map((t) => ({
        id: t.id,
        permit_id: t.permit_id,
        parent_task_id: null,
        discipline: t.discipline,
        bucket: t.bucket,
        text: t.text,
        status: t.status,
        start_date: t.start_date,
        target_date: t.target_date,
        due_date: null,
        done_at: null,
        sort_order: 0,
        assigned_to: t.assigned_to,
        waiting_on: null,
        priority: false,
        notes: null,
        is_auto_generated: false,
        auto_event: null,
        primary_assignee: t.discipline === 'arch' ? 'Cam' : 'Miles',
        co_assignees: [],
        subtasks: [],
      }));

  const listTasks = () =>
    db.tasks.map((t) => ({
      id: t.id,
      permit_id: t.permit_id,
      project_id: 'p-1',
      project_address: '3921 43rd Ave S',
      permit_type: t.permit_id === 12 ? 'Building Permit' : 'Demolition',
      permit_da: 'Cam',
      parent_task_id: null,
      discipline: t.discipline,
      bucket: t.bucket,
      text: t.text,
      status: t.status,
      start_date: t.start_date,
      target_date: t.target_date,
      due_date: null,
      done_at: null,
      sort_order: 0,
      assigned_to: t.assigned_to,
      co_assignees: [],
      waiting_on: null,
      priority: false,
      notes: null,
      created_at: t.created_at,
    }));

  return {
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      if (name === 'bp_upsert_permit_task') {
        db.seq += 1;
        const id = `t-${db.seq}`;
        db.tasks.push({
          id,
          permit_id: args.p_permit_id as number,
          parent_task_id: (args.p_parent_task_id as string) ?? null,
          discipline: args.p_discipline as 'arch' | 'ent',
          // p_bucket null defers to the DB trigger; this permit has not been
          // submitted, so the trigger lands it in D&E.
          bucket: ((args.p_bucket as 'de' | 'pm') ?? 'de'),
          text: args.p_text as string,
          status: (args.p_status as TaskRow['status']) ?? 'Open',
          assigned_to: (args.p_assigned_to as string) ?? null,
          target_date: (args.p_target_date as string) ?? null,
          start_date: (args.p_start_date as string) ?? null,
          source_message_id: null,
          created_at: '2026-08-16T12:00:00Z',
        });
        return Promise.resolve({ data: id, error: null });
      }
      if (name === 'bp_list_permit_tasks') {
        return Promise.resolve({
          data: listPermitTasks(args.p_permit_id as number),
          error: null,
        });
      }
      if (name === 'bp_list_tasks' || name === 'bp_my_tasks') {
        return Promise.resolve({ data: listTasks(), error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: (table: string) => {
      if (table === 'permit_tasks') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              const hit = db.tasks.find((t) => t.id === id);
              if (hit && 'source_message_id' in patch) {
                hit.source_message_id = patch.source_message_id as string;
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'project_messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            db.inserted.push(row);
            return Promise.resolve({ data: null, error: null });
          },
          select: () => inertBuilder([]),
        };
      }
      return inertBuilder([]);
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, file: File) => {
          db.uploads.push({ bucket, path, name: file.name });
          return Promise.resolve({ data: { path }, error: null });
        },
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: supabaseMock, supabaseUrl: 'http://x' }));

// ★ The viewer is Jade, and Jade is ON THE ROSTER — fix-176's login → roster
// mapping. That is what makes the My Tasks assertion below mean something: the
// page defaults to "My work", so a chat-born task assigned to Jade has to route
// to Jade's own list, not merely exist somewhere.
const authMock = vi.hoisted(() => ({
  userId: '99999999-9999-9999-9999-999999999999',
  email: 'jade@x.com',
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: authMock.userId, email: authMock.email },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));

const chatMock = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  people: [] as { user_id: string; name: string; email: string }[],
}));
// ★ Only the READ of the thread is stubbed — the write paths
// (useCreateTaskFromMessage, usePostMessage) stay real and go through the
// mocked supabase above. Stubbing the read is what lets a test place a message
// in the thread without an insert round trip.
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({ data: chatMock.messages, isLoading: false, error: null }),
    useMentionablePeople: () => ({ data: chatMock.people, isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
  };
});

const rosterMock = vi.hoisted(() => ({ members: [] as Record<string, unknown>[] }));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({
      all: rosterMock.members,
      activeDas: [],
      formerDas: [],
      dms: [],
      ents: [],
      acqs: [],
      schematics: [],
      activeMemberNames: actual.activeMemberNamesOf(
        rosterMock.members as unknown as TeamMember[],
      ),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [], isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'p-1', address: '3921 43rd Ave S', schematic_designer: [] }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [] }),
}));
vi.mock('../hooks/useProjectHolds', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useWaitingOnTasks', async (orig) => {
  const actual = await orig<typeof import('../hooks/useWaitingOnTasks')>();
  return {
    ...actual,
    useWaitingOnTasks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
// PermitDetailV2's cycle editor + estimator are irrelevant to the chain.
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

import ProjectChatCard from '../components/ProjectDetail/ProjectChatSection';
import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';
import MyTasks from '../pages/MyTasks';

const BOBBY = '11111111-1111-1111-1111-111111111111';

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: BP,
    project_id: PROJECT,
    type: 'Building Permit',
    num: '7133442-CN',
    da: 'Cam',
    ent_lead: 'Miles',
    ...over,
  } as unknown as Permit;
}

const PERMITS = [
  permit({ id: BP, type: 'Building Permit', num: '7133442-CN' }),
  permit({ id: DEMO, type: 'Demolition', num: '7133443-DM' }),
];

function permitWithCycles(id: number, type: string): PermitWithCycles {
  return {
    ...(permit({ id, type }) as unknown as Record<string, unknown>),
    stage: 'de',
    stage_override: null,
    status: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    dm: null,
    updated_at: '2026-05-14T12:00:00Z',
    permit_cycles: [],
  } as unknown as PermitWithCycles;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  db.tasks = [];
  db.seq = 0;
  db.uploads = [];
  db.inserted = [];
  chatMock.messages = [
    {
      id: 'm-7',
      project_id: PROJECT,
      author_id: BOBBY,
      author_name: 'Bobby',
      body: 'Chase the demo survey',
      mentions: [],
      attachments: [],
      created_at: '2026-08-16T11:00:00Z',
      task_id: null,
      task_text: null,
      task_permit_id: null,
    },
  ];
  chatMock.people = [{ user_id: BOBBY, name: 'Bobby', email: 'robertd@x.com' }];
  rosterMock.members = [
    { id: 'r1', name: 'Cam', role: 'da', active: true, former: false, email: 'cam@x.com' },
    { id: 'r2', name: 'Miles', role: 'ent', active: true, former: false, email: 'miles@x.com' },
    { id: 'r3', name: 'Jade', role: 'dm', active: true, former: false, email: 'jade@x.com' },
  ];
  window.localStorage.clear();
});

/** Drive the REAL chat composer: open the modal, open the chooser, pick a
 *  permit, create. Returns once the write path has landed in the store. */
async function createTaskOnPermit(permitId: number, assignee?: string) {
  render(<ProjectChatCard projectId={PROJECT} permits={PERMITS} />, { wrapper });
  fireEvent.click(screen.getByTestId('project-chat-open'));
  fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
  fireEvent.change(screen.getByTestId('chat-task-permit-m-7'), {
    target: { value: String(permitId) },
  });
  if (assignee) {
    fireEvent.change(screen.getByTestId('chat-task-m-7-primary-select'), {
      target: { value: assignee },
    });
  }
  fireEvent.click(screen.getByTestId('chat-task-create-m-7'));
  await waitFor(() => expect(db.tasks).toHaveLength(1));
}

describe('fix-330: the chain, end to end on one store', () => {
  it('★ the chat write path is bp_upsert_permit_task, on the CHOSEN permit', async () => {
    await createTaskOnPermit(DEMO);
    expect(db.tasks[0]).toMatchObject({
      permit_id: DEMO,
      text: 'Chase the demo survey',
      status: 'Open',
    });
  });

  it('★ and it remembers the message it came from', async () => {
    await createTaskOnPermit(DEMO);
    await waitFor(() => expect(db.tasks[0].source_message_id).toBe('m-7'));
  });

  // ★★ THE HOP THE BRIEF SAYS IS MOST LIKELY MISSING. Not asserted from the
  // mock's arguments — rendered, by the real permit task panel, off the store
  // the chat wrote to.
  it('★★ the task RENDERS BACK on that permit in Project Overview', async () => {
    await createTaskOnPermit(DEMO);
    const id = db.tasks[0].id;
    render(<PermitDetailV2 permit={permitWithCycles(DEMO, 'Demolition')} />, { wrapper });
    const panel = await screen.findByTestId('pd-v2-tasks-panel');
    // The row is the permit bar's own task row — same testid the fix-70 editor
    // suite asserts on — and its text sits in the editable field.
    const row = await within(panel).findByTestId(`task-row-${id}`);
    expect(row).toBeInTheDocument();
    expect(
      (within(panel).getByTestId(`task-text-${id}`) as HTMLInputElement).value,
    ).toBe('Chase the demo survey');
  });

  // ★ …and NOT on the permit that was not chosen. Without this the test above
  // would pass for a task that landed anywhere.
  it('★ and NOT on the permit that was not chosen', async () => {
    await createTaskOnPermit(DEMO);
    const id = db.tasks[0].id;
    render(<PermitDetailV2 permit={permitWithCycles(BP, 'Building Permit')} />, { wrapper });
    const panel = await screen.findByTestId('pd-v2-tasks-panel');
    await waitFor(() =>
      expect(within(panel).queryByTestId(`task-row-${id}`)).toBeNull(),
    );
  });

  // ★ Not "it exists somewhere on the board" — it reaches the person it was
  // handed to. My Tasks defaults to "My work" for a rostered login (fix-176),
  // and the viewer here is Jade.
  it('★ the task appears in My Tasks, on the assignee\'s own list', async () => {
    await createTaskOnPermit(DEMO, 'Jade');
    const id = db.tasks[0].id;
    render(<MyTasks />, { wrapper });
    // By card id, not by text: the chat modal that created it is still mounted
    // in this test and renders the same sentence.
    await waitFor(() =>
      expect(screen.getByTestId(`mytask-card-${id}-text`).textContent).toBe(
        'Chase the demo survey',
      ),
    );
    // The default scope really is "My work" — otherwise this would only be
    // asserting that the row exists at all.
    expect(
      screen.getByTestId('mytasks-scope-mine').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  // ★ My Board: a chat-born task is news to the person it was assigned to, and
  // to nobody else — through the real builder, keyed the way every other task
  // is keyed.
  it('★ the task is news on My Board for its assignee only', async () => {
    await createTaskOnPermit(DEMO, 'Jade');
    const boardTasks = [
      {
        id: db.tasks[0].id,
        assigned_to: 'Jade',
        co_assignees: [],
        text: db.tasks[0].text,
        created_at: db.tasks[0].created_at,
        permit_id: DEMO,
        project_id: PROJECT,
        project_address: '3921 43rd Ave S',
        permit_type: 'Demolition',
        discipline: db.tasks[0].discipline,
      },
    ];
    const base = { flips: [], acks: [], permits: [], projects: [] };
    const forJade = buildNewItems({ ...base, tasks: boardTasks, viewerName: 'Jade' } as never);
    const forCam = buildNewItems({ ...base, tasks: boardTasks, viewerName: 'Cam' } as never);
    expect(forJade.map((i) => i.key)).toContain(keyForTask(db.tasks[0].id));
    expect(forCam).toHaveLength(0);
  });

  // ★ fix-308's rules apply to a chat-born task unchanged: ENT is the default
  // owner, and design owns a leg only once design work actually exists.
  it('★ fix-308: an ENT chat task leaves the leg one-leg', async () => {
    await createTaskOnPermit(DEMO);
    expect(db.tasks[0].discipline).toBe('ent');
    expect(legShape({ da: 'Cam' }, [{ discipline: 'ent' }])).toBe('one-leg');
  });

  it('★ fix-308: a design-team chat task is what creates the design leg', async () => {
    await createTaskOnPermit(DEMO, 'Schematic Team');
    expect(db.tasks[0].discipline).toBe('arch');
    expect(legShape({ da: 'Cam' }, [{ discipline: 'arch' }])).toBe('two-leg');
  });

  // ★ "An unassigned task blocks nobody" — fix-308's third rule, and a chat
  // task created without an owner is no exception.
  it('★ fix-308: a chat task created with no owner blocks nobody', async () => {
    await createTaskOnPermit(DEMO);
    expect(db.tasks[0].assigned_to).toBeNull();
    expect(taskNeedsOwner({ assigned_to: null, co_assignees: [] })).toBe(true);
  });
});

describe('fix-330: attachments travel the real write path', () => {
  it('★ a pasted snip is uploaded, then the message is inserted with it', async () => {
    render(<ProjectChatCard projectId={PROJECT} permits={PERMITS} />, { wrapper });
    fireEvent.click(screen.getByTestId('project-chat-open'));
    fireEvent.paste(screen.getByTestId('project-chat-input'), {
      clipboardData: {
        files: [new File([new Uint8Array(16)], 'snip.png', { type: 'image/png' })],
      },
    });
    fireEvent.change(screen.getByTestId('project-chat-input'), {
      target: { value: 'see this' },
    });
    fireEvent.click(screen.getByTestId('project-chat-send'));

    await waitFor(() => expect(db.inserted).toHaveLength(1));
    expect(db.uploads).toHaveLength(1);
    expect(db.uploads[0].bucket).toBe('chat-attachments');
    // ★ THE PATH IS THE PERMISSION: the first segment is the project id, which
    // is what the storage policy reads the tenant from.
    expect(db.uploads[0].path.split('/')[0]).toBe(PROJECT);
    expect(db.uploads[0].path.endsWith('/snip.png')).toBe(true);

    const row = db.inserted[0] as { body: string; attachments: unknown[] };
    expect(row.body).toBe('see this');
    expect(row.attachments).toEqual([
      {
        path: db.uploads[0].path,
        name: 'snip.png',
        mime: 'image/png',
        size: 16,
      },
    ]);
  });

  // ★ ONE FAILURE SURFACE. The upload runs inside the same mutation as the
  // insert, so an ordering that could post a message without its snip does not
  // exist to get wrong.
  it('★ the upload happens before the insert, in one mutation', async () => {
    const order: string[] = [];
    const realUpload = supabaseMock.storage.from;
    supabaseMock.storage.from = (bucket: string) => {
      const inner = realUpload(bucket);
      return {
        ...inner,
        upload: (p: string, f: File) => {
          order.push('upload');
          return inner.upload(p, f);
        },
      };
    };
    const realFrom = supabaseMock.from;
    supabaseMock.from = (table: string) => {
      if (table === 'project_messages') {
        const inner = realFrom(table) as { insert: (r: Record<string, unknown>) => unknown };
        return {
          ...inner,
          insert: (r: Record<string, unknown>) => {
            order.push('insert');
            return inner.insert(r);
          },
        };
      }
      return realFrom(table);
    };

    render(<ProjectChatCard projectId={PROJECT} permits={PERMITS} />, { wrapper });
    fireEvent.click(screen.getByTestId('project-chat-open'));
    fireEvent.paste(screen.getByTestId('project-chat-input'), {
      clipboardData: {
        files: [new File([new Uint8Array(4)], 'snip.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(order).toEqual(['upload', 'insert']));

    supabaseMock.storage.from = realUpload;
    supabaseMock.from = realFrom;
  });
});
