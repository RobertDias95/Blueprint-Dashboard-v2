import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, ProjectMessage } from '../lib/database.types';

// ===========================================================================
// fix-362 - ARRIVING IS NOT LANDING. Open it and show it.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const chatMock = vi.hoisted(() => ({ messages: [] as ProjectMessage[] }));

// ★★ fix-334: every message is a REPLY UNDER A POST, so the preview's unit is a
// post — a title plus a reply count. The fixtures below are two posts, which is
// what the preview is for.
function post(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'post-1',
    project_id: 'p-346',
    author_id: 'u-1',
    author_name: 'Bobby',
    body: 'All questions here to ACQ',
    mentions: [],
    attachments: [],
    created_at: '2026-08-15T09:00:00Z',
    task_id: null,
    task_text: null,
    task_permit_id: null,
    parent_message_id: null,
    title: 'ACQ Questions',
    edited_at: null,
    deleted_at: null,
    revisions: [],
    reply_count: null,
    last_activity_at: null,
    ...over,
  } as unknown as ProjectMessage;
}
function reply(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return post({
    id: 'm-1',
    author_name: 'Briana',
    body: 'Builder says they are likely selling.',
    parent_message_id: 'post-1',
    title: null,
    created_at: '2026-08-15T10:00:00Z',
    ...over,
  });
}

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: vi.fn().mockResolvedValue({ overlapKind: null }), isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({ data: chatMock.messages, isLoading: false, error: null }),
    useMentionablePeople: () => ({ data: [], isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
  };
});
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [], isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-346',
    address: '224 2nd Ave N',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: 'Greg',
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: 'Miles',
    design_manager: 'Jade',
    go_date: '2026-06-05',
    units: null,
    product_types: [],
    project_tags: null,
    schematic_designer: ['Ana'],
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Project;
}

function bpFixture(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-346',
    type: 'Building Permit',
    num: '7133442-CN',
    da: 'Nicky',
    ent_lead: 'Miles',
    dd_start: null,
    dd_end: null,
    target_submit: null,
    target_submit_is_manual: false,
    created_at: NOW,
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderHeader(
  url = '/project/p-346',
  project = projectFixture(),
  permits = [bpFixture()],
) {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      {/* A COLD LOAD. MemoryRouter with an initialEntry is exactly what a
          person pasting the URL gets: nothing in memory, nothing carried over
          from a click, just the address. */}
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={bp} />,
    { wrapper },
  );
}


// ★★★ THE WHOLE POINT OF THIS FILE, restated where it is asserted.
//
// Bobby: "If I get a notification about something in the chat, if I then click
// that notification, does it take me to that chat, to that post?"
//
// ★★ A link to a page that CONTAINS the thing is what already existed, and is
// what he was complaining about. So nothing below asserts the message is
// present — it asserts the modal is OPEN and the message is MARKED.
//
// ★★★ AND EVERY ONE IS A COLD LOAD: the URL goes to a fresh MemoryRouter and
// nothing else happens. No click, no store, no router state object. §2's rule
// is "if you can't paste the URL and get the same result, it isn't done", and
// this is that rule made testable.

beforeEach(() => {
  chatMock.messages = [post(), reply()];
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
    user: { id: 'u-1' } as never,
  });
});

describe('fix-362 §2: a mention lands ON the message', () => {
  it('★★★ ?msg=<reply> opens the chat and marks that reply', async () => {
    // A reply, not a post — the case the old behaviour was worst at, because a
    // reply lives inside a thread you first have to pick out of a list.
    renderHeader('/project/p-346?msg=m-1');
    const modal = await screen.findByTestId('project-chat-modal');
    expect(modal).toBeInTheDocument();

    // ★ IDENTIFIED IN THE DOM, not merely present. `data-focused` is
    // ChatMessageRow's own marker (the focus ring plus the scroll).
    const focused = modal.querySelectorAll('[data-focused="true"]');
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toContain('Builder says they are likely selling');
  });

  it('★★ ?msg=<post> opens that post and marks the post itself', () => {
    renderHeader('/project/p-346?msg=post-1');
    const modal = screen.getByTestId('project-chat-modal');
    const focused = modal.querySelectorAll('[data-focused="true"]');
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toContain('All questions here to ACQ');
  });

  it('★★ one parameter does both — the reply resolves to its own thread', () => {
    // Which post a reply belongs to is a fact of the row. A URL carrying both
    // could contradict itself, and would have to be BUILT by whoever writes the
    // link rather than READ by whoever follows it.
    renderHeader('/project/p-346?msg=m-1');
    const thread = screen.getByTestId('project-chat-thread');
    expect(thread.textContent).toContain('ACQ Questions');
    expect(thread.textContent).toContain('Builder says they are likely selling');
  });

  it('★ ?chat=1 opens the conversation with nothing marked', () => {
    // The destination for the sources whose thing IS the conversation.
    renderHeader('/project/p-346?chat=1');
    const modal = screen.getByTestId('project-chat-modal');
    expect(modal.querySelectorAll('[data-focused="true"]')).toHaveLength(0);
    expect(screen.queryByTestId('project-chat-missing-target')).toBeNull();
  });

  it('★ no parameter, no modal — the card is unchanged for everyone else', () => {
    renderHeader('/project/p-346');
    expect(screen.queryByTestId('project-chat-modal')).toBeNull();
  });
});

describe('fix-362 §3: a dead target degrades, and never breaks', () => {
  it('★★★ the 1301 6th Ave N shape: the thread is gone, so say so', () => {
    // ★ NOT HYPOTHETICAL. A chat thread was hard-deleted from production on
    // 2026-08-19 — a post and six replies, at Bobby's request — so every
    // notification that pointed into it now points at nothing. This is the
    // exact shape: a real project, a real chat, and a message id that no longer
    // resolves to a row.
    expect(() =>
      renderHeader('/project/p-346?msg=00000000-0000-0000-0000-000000000000'),
    ).not.toThrow();

    // Lands on the nearest thing that DOES exist…
    expect(screen.getByTestId('project-chat-modal')).toBeInTheDocument();
    expect(screen.getByTestId('project-chat-thread')).toBeInTheDocument();
    // …and says plainly that the item is gone.
    expect(screen.getByTestId('project-chat-missing-target').textContent).toContain(
      'That message has been deleted',
    );
    // ★ No 404, no blank modal, no spinner: the working conversation is under
    // the notice, and nothing is marked.
    expect(
      screen.getByTestId('project-chat-modal').querySelectorAll('[data-focused="true"]'),
    ).toHaveLength(0);
  });

  it('★★ a project whose chat is EMPTY still opens and still explains', () => {
    chatMock.messages = [];
    expect(() =>
      renderHeader('/project/p-346?msg=00000000-0000-0000-0000-000000000000'),
    ).not.toThrow();
    expect(screen.getByTestId('project-chat-missing-target')).toBeInTheDocument();
    // ★ Nothing to show, said as "nothing to show" — not as a spinner and not
    // as a blank pane.
    expect(screen.getAllByTestId('project-chat-empty').length).toBeGreaterThan(0);
  });

  it('★ a live target says nothing about deletion', () => {
    renderHeader('/project/p-346?msg=m-1');
    expect(screen.queryByTestId('project-chat-missing-target')).toBeNull();
  });
});

describe('fix-362: closing puts the URL back', () => {
  it('★★ the modal shuts and the parameter goes with it', () => {
    renderHeader('/project/p-346?msg=m-1');
    expect(screen.getByTestId('project-chat-modal')).toBeInTheDocument();
    // Escape is the modal's own close, shared with every other overlay.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('project-chat-modal')).toBeNull();
    // ★ Otherwise the URL still says "open at this message" while the modal is
    // shut, and the next click on the Chat button would be swallowed by the
    // applied-value guard or land on a stale message.
  });

  it('★★ …and the Chat button still opens it afterwards', () => {
    renderHeader('/project/p-346?msg=m-1');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('project-chat-open'));
    expect(screen.getByTestId('project-chat-modal')).toBeInTheDocument();
  });
});
