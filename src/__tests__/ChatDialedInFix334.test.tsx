import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_334_chat_posts_edits.sql?raw';
import {
  groupIntoPosts,
  isDeleted,
  isEdited,
  originalBody,
  searchChat,
} from '../lib/projectChat';
import type { ProjectMessage } from '../lib/database.types';

// fix-334 — chat, dialled in. Posts, replies, admin-gated posting, search,
// edit/delete with the original kept, and a task composed in the same send.
//
// ★ Bobby: "let's make sure that the chat feature is dialed in before we go on
// to the next item." Five things landed together because three of them change
// the same table's shape or its grants.
//
// ★★ The database half is proved on PROD with a rolled-back cross-user probe —
// a non-admin's post REFUSED, a reply ALLOWED, another user's edit affecting 0
// rows, hard delete blocked, and `revisions` written by the trigger. Those
// results are recorded in the PR and in the migration; what is asserted HERE is
// the behaviour a person sees, plus the policy text that cannot be checked from
// jsdom.

const ADMIN = '11111111-1111-1111-1111-111111111111';
const EDITOR = '22222222-2222-2222-2222-222222222222';
const POST_ID = 'post-1';

// ---------------------------------------------------------------- fixtures --

function post(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: POST_ID,
    project_id: 'p-1',
    parent_message_id: null,
    title: 'Marketing plans',
    author_id: ADMIN,
    author_name: 'Bobby',
    body: 'Where are we on the marketing set?',
    mentions: [],
    attachments: [],
    created_at: '2026-08-15T09:00:00Z',
    edited_at: null,
    deleted_at: null,
    revisions: [],
    task_id: null,
    task_text: null,
    task_permit_id: null,
    reply_count: null,
    last_activity_at: null,
    ...over,
  };
}

function reply(over: Partial<ProjectMessage> & { id: string }): ProjectMessage {
  return {
    ...post(),
    parent_message_id: POST_ID,
    title: null,
    author_id: EDITOR,
    author_name: 'Briana',
    body: 'A reply',
    created_at: '2026-08-15T10:00:00Z',
    ...over,
  };
}

const mocks = vi.hoisted(() => ({
  messages: [] as ProjectMessage[],
  isAdmin: true,
  userId: '11111111-1111-1111-1111-111111111111' as string | null,
  posted: [] as Record<string, unknown>[],
  edited: [] as Record<string, unknown>[],
  deleted: [] as Record<string, unknown>[],
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: mocks.userId ? { id: mocks.userId, email: 'x@x.com' } : null,
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => mocks.isAdmin,
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({ data: mocks.messages, isLoading: false, error: null }),
    useMentionablePeople: () => ({
      data: [
        { user_id: ADMIN, name: 'Bobby', email: 'bobby@x.com' },
        { user_id: EDITOR, name: 'Briana', email: 'briana@x.com' },
      ],
      isLoading: false,
      error: null,
    }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
    usePostMessage: () => ({
      mutate: (
        input: Record<string, unknown>,
        opts?: { onSuccess?: (id: string | null) => void },
      ) => {
        mocks.posted.push(input);
        opts?.onSuccess?.('new-message-id');
      },
      isPending: false,
    }),
    useEditMessage: () => ({
      mutate: (input: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
        mocks.edited.push(input);
        opts?.onSuccess?.();
      },
      isPending: false,
    }),
    useDeleteMessage: () => ({
      mutate: (input: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
        mocks.deleted.push(input);
        opts?.onSuccess?.();
      },
      isPending: false,
    }),
    useCreateTaskFromMessage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [], isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));
vi.mock('../hooks/useChatAttachments', async (orig) => {
  const actual = await orig<typeof import('../hooks/useChatAttachments')>();
  return {
    ...actual,
    useSignedAttachmentUrl: () => ({ data: null, error: null, isLoading: false }),
  };
});

import ProjectChatModal from '../components/ProjectDetail/ProjectChatModal';
import type { Permit } from '../lib/database.types';

const PERMITS = [
  { id: 12, project_id: 'p-1', type: 'Building Permit', num: '7133442-CN', da: 'Cam', ent_lead: 'Miles' },
  { id: 21, project_id: 'p-1', type: 'Demolition', num: '7133443-DM', da: 'Cam', ent_lead: 'Miles' },
] as unknown as Permit[];

function renderModal(permits: Permit[] = PERMITS) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectChatModal projectId="p-1" permits={permits} onClose={vi.fn()} />,
    { wrapper },
  );
}

beforeEach(() => {
  mocks.messages = [post()];
  mocks.isAdmin = true;
  mocks.userId = ADMIN;
  mocks.posted = [];
  mocks.edited = [];
  mocks.deleted = [];
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

// ===========================================================================
// ★ 1. Posts, with replies inside them
// ===========================================================================

describe('fix-334 §1: posts, with replies inside them', () => {
  it('★ a post appears with its title, and replies nest under it', () => {
    mocks.messages = [
      post(),
      reply({ id: 'r-1', body: 'Uploaded them yesterday' }),
      reply({ id: 'r-2', body: 'Thanks', created_at: '2026-08-15T11:00:00Z' }),
    ];
    renderModal();
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent(
      'Marketing plans',
    );
    const replies = screen.getByTestId('project-chat-replies');
    expect(within(replies).getByText('Uploaded them yesterday')).toBeInTheDocument();
    expect(within(replies).getByText('Thanks')).toBeInTheDocument();
  });

  it('the post list shows a reply count and the newest activity', () => {
    mocks.messages = [post(), reply({ id: 'r-1' }), reply({ id: 'r-2' })];
    renderModal();
    expect(
      screen.getByTestId(`project-chat-post-replies-${POST_ID}`),
    ).toHaveTextContent('2 replies');
  });

  it('★ different posts keep different conversations apart', () => {
    mocks.messages = [
      post(),
      reply({ id: 'r-1', body: 'about marketing' }),
      post({ id: 'post-2', title: 'Survey', created_at: '2026-08-16T09:00:00Z' }),
      reply({
        id: 'r-2',
        parent_message_id: 'post-2',
        body: 'about the survey',
        created_at: '2026-08-16T10:00:00Z',
      }),
    ];
    renderModal();
    // Newest conversation is selected first.
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent('Survey');
    expect(screen.getByText('about the survey')).toBeInTheDocument();
    expect(screen.queryByText('about marketing')).toBeNull();
    // ...and the other one is one click away.
    fireEvent.click(screen.getByTestId(`project-chat-post-${POST_ID}`));
    expect(screen.getByText('about marketing')).toBeInTheDocument();
  });

  // ★★ THE PRE-EXISTING MESSAGES. Seven of them, across five projects, written
  // before posts existed. The migration adopted each into a "General" post; this
  // asserts the SHAPE that produced, against rows that predate the change.
  it('★★ a pre-fix-334 message is still reachable under its General post', () => {
    const legacy = reply({
      id: 'legacy-1',
      body: '@Brittani do we have marketing plans for this?',
      created_at: '2026-08-17T19:29:45Z',
    });
    mocks.messages = [
      post({ id: POST_ID, title: 'General', created_at: '2026-08-17T19:29:44Z' }),
      legacy,
    ];
    renderModal();
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent('General');
    expect(
      screen.getByTestId(`project-chat-message-${legacy.id}`),
    ).toHaveTextContent('do we have marketing plans');
  });

  // ★ AND THE GROUPER NEVER DROPS ONE. A reply whose post is missing from the
  // payload is collected rather than vanishing — silently vanishing is exactly
  // the data loss this ticket is guarding against.
  it('★ an orphaned reply is collected, not dropped', () => {
    const orphan = reply({ id: 'r-x', parent_message_id: 'nowhere' });
    const grouped = groupIntoPosts([post(), orphan]);
    expect(grouped).toHaveLength(2);
    expect(
      grouped.flatMap((g) => g.replies).some((r) => r.id === 'r-x'),
    ).toBe(true);
  });
});

// ===========================================================================
// ★★ 2. Only admins create posts. Everyone replies.
// ===========================================================================

describe('fix-334 §2: only admins create posts', () => {
  it('★ an admin sees the New post control', () => {
    mocks.isAdmin = true;
    renderModal();
    expect(screen.getByTestId('project-chat-new-post')).toBeInTheDocument();
  });

  it('★ a non-admin does NOT', () => {
    mocks.isAdmin = false;
    renderModal();
    expect(screen.queryByTestId('project-chat-new-post')).toBeNull();
  });

  // ★★ REPLYING IS NOT RESTRICTED. 23 of 29 people are editors; a chat only 6
  // can speak in is not a chat.
  it('★★ a non-admin CAN reply', async () => {
    mocks.isAdmin = false;
    mocks.userId = EDITOR;
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-input'), {
      target: { value: 'my reply' },
    });
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0]).toMatchObject({
      parentMessageId: POST_ID,
      body: 'my reply',
    });
  });

  it('an admin creating a post sends a title and no parent', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('project-chat-new-post'));
    fireEvent.change(screen.getByTestId('project-chat-new-post-title'), {
      target: { value: 'Corrections round 2' },
    });
    fireEvent.change(screen.getByTestId('project-chat-new-post-body'), {
      target: { value: 'City came back on the survey' },
    });
    fireEvent.click(screen.getByTestId('project-chat-new-post-submit'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0]).toMatchObject({
      title: 'Corrections round 2',
      parentMessageId: null,
    });
  });

  // ★★ THE WRITE IS GATED, NOT THE BUTTON. jsdom cannot run RLS, so what is
  // asserted here is the POLICY TEXT — and the live cross-user probe in the PR
  // is what proves it actually refuses. Both, because either alone is weak.
  it('★★ the RLS policy refuses a non-admin post at the database', () => {
    expect(migrationSql).toMatch(
      /parent_message_id IS NOT NULL\s*\n\s*OR public\.is_tenant_admin\(tenant_id\)/,
    );
    // ...and a reply is deliberately NOT gated.
    expect(migrationSql).toMatch(/A REPLY does not, and must not/);
  });
});

// ===========================================================================
// 3. Search within the conversation
// ===========================================================================

describe('fix-334 §3: search within the conversation', () => {
  function withThread() {
    mocks.messages = [
      post(),
      reply({ id: 'r-1', body: 'the arborist report is late' }),
      reply({ id: 'r-2', body: 'nothing to do with trees' }),
      post({ id: 'post-2', title: 'Survey', created_at: '2026-08-16T09:00:00Z' }),
    ];
  }

  it('★ finds a phrase in a reply', () => {
    withThread();
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-search'), {
      target: { value: 'arborist' },
    });
    const results = screen.getByTestId('project-chat-search-results');
    expect(within(results).getByTestId('project-chat-search-hit-r-1')).toHaveTextContent(
      'arborist report is late',
    );
    expect(within(results).queryByTestId('project-chat-search-hit-r-2')).toBeNull();
  });

  it('finds a post by its title', () => {
    withThread();
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-search'), {
      target: { value: 'Survey' },
    });
    expect(screen.getByTestId('project-chat-search-hit-post-2')).toBeInTheDocument();
  });

  // ★★ "AND THEN GO FROM THERE" IS THE REQUIREMENT — landing on the message,
  // not merely listing it. Selecting a hit opens its post AND focuses the row.
  it('★★ selecting a hit LANDS on that message', () => {
    withThread();
    renderModal();
    // Start on the other post, so the landing has somewhere to travel from.
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent('Survey');
    fireEvent.change(screen.getByTestId('project-chat-search'), {
      target: { value: 'arborist' },
    });
    fireEvent.click(screen.getByTestId('project-chat-search-hit-r-1'));
    // The post it lives in is now open…
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent(
      'Marketing plans',
    );
    // …and the message itself is the focused one.
    expect(
      screen.getByTestId('project-chat-message-r-1').dataset.focused,
    ).toBe('true');
    expect(
      screen.getByTestId('project-chat-message-r-2').dataset.focused,
    ).toBe('false');
  });

  it('says so when nothing matches, rather than showing an empty list', () => {
    withThread();
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-search'), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByTestId('project-chat-search-empty')).toBeInTheDocument();
  });

  // ★ A deleted message keeps its words but stops being findable — surfacing
  // them in search would undo the deletion for every practical purpose.
  it('★ a deleted message is not searchable', () => {
    const grouped = groupIntoPosts([
      post(),
      reply({ id: 'r-1', body: 'secret plan', deleted_at: '2026-08-16T00:00:00Z' }),
    ]);
    expect(searchChat(grouped, 'secret')).toEqual([]);
  });

  it('one letter is not a search', () => {
    const grouped = groupIntoPosts([post(), reply({ id: 'r-1', body: 'a' })]);
    expect(searchChat(grouped, 'a')).toEqual([]);
  });
});

// ===========================================================================
// ★★ 4. Edit and delete, with the original kept
// ===========================================================================

describe('fix-334 §4: edit and delete keep the original', () => {
  it('★ editing shows the new text with the original still reachable', () => {
    mocks.messages = [
      post(),
      reply({
        id: 'r-1',
        author_id: ADMIN,
        body: 'the corrected text',
        edited_at: '2026-08-16T00:00:00Z',
        revisions: [
          { body: 'the original text', at: '2026-08-15T10:00:00Z', by: ADMIN, reason: 'edited' },
        ],
      }),
    ];
    renderModal();
    const row = screen.getByTestId('project-chat-message-r-1');
    expect(row).toHaveTextContent('the corrected text');
    // ★ It reads `edited`.
    expect(screen.getByTestId('project-chat-edited-r-1')).toHaveTextContent('edited');
    // ★ And the original is one click away, minimised — exactly as asked.
    expect(row).not.toHaveTextContent('the original text');
    fireEvent.click(screen.getByTestId('project-chat-show-original-r-1'));
    expect(screen.getByTestId('project-chat-original-r-1')).toHaveTextContent(
      'the original text',
    );
  });

  it('★ a deleted message reads `deleted` and keeps its original', () => {
    mocks.messages = [
      post(),
      reply({
        id: 'r-1',
        author_id: ADMIN,
        body: 'withdrawn',
        deleted_at: '2026-08-16T00:00:00Z',
        revisions: [
          { body: 'what I actually said', at: '2026-08-15T10:00:00Z', by: ADMIN, reason: 'deleted' },
        ],
      }),
    ];
    renderModal();
    expect(screen.getByTestId('project-chat-deleted-r-1')).toHaveTextContent('deleted');
    expect(screen.getByTestId('project-chat-message-r-1')).toHaveTextContent(
      'This message was deleted',
    );
    fireEvent.click(screen.getByTestId('project-chat-show-original-r-1'));
    expect(screen.getByTestId('project-chat-original-r-1')).toHaveTextContent(
      'what I actually said',
    );
  });

  // ★ ANY TASK CREATED FROM IT SURVIVES. The link-back still renders on a
  // deleted message, because the task is real work and outlives the words.
  it('★ a task created from a deleted message survives', () => {
    mocks.messages = [
      post(),
      reply({
        id: 'r-1',
        author_id: ADMIN,
        deleted_at: '2026-08-16T00:00:00Z',
        revisions: [{ body: 'chase it', at: '2026-08-15T10:00:00Z', by: ADMIN, reason: 'deleted' }],
        task_id: 't-1',
        task_text: 'Chase the survey',
        task_permit_id: 21,
      }),
    ];
    renderModal();
    expect(screen.getByTestId('project-chat-task-r-1')).toHaveTextContent(
      'Chase the survey',
    );
  });

  it('the author can edit their own, and the edit is sent', async () => {
    mocks.userId = ADMIN;
    mocks.messages = [post(), reply({ id: 'r-1', author_id: ADMIN, body: 'before' })];
    renderModal();
    fireEvent.click(screen.getByTestId('project-chat-edit-r-1'));
    fireEvent.change(screen.getByTestId('project-chat-edit-input-r-1'), {
      target: { value: 'after' },
    });
    fireEvent.click(screen.getByTestId('project-chat-edit-save-r-1'));
    await waitFor(() => expect(mocks.edited).toHaveLength(1));
    expect(mocks.edited[0]).toMatchObject({ messageId: 'r-1', body: 'after' });
  });

  it('deleting asks once, then sends', async () => {
    mocks.userId = ADMIN;
    mocks.messages = [post(), reply({ id: 'r-1', author_id: ADMIN })];
    renderModal();
    fireEvent.click(screen.getByTestId('project-chat-delete-r-1'));
    expect(mocks.deleted).toHaveLength(0);
    fireEvent.click(screen.getByTestId('project-chat-delete-confirm-r-1'));
    await waitFor(() => expect(mocks.deleted).toHaveLength(1));
    expect(mocks.deleted[0]).toMatchObject({ messageId: 'r-1' });
  });

  // ★★ ONLY THE AUTHOR. Admins create posts — that is structure; rewriting
  // somebody else's words is a different thing and nobody asked for it.
  it('★★ someone else\'s message offers no edit or delete', () => {
    mocks.userId = ADMIN;
    mocks.messages = [post(), reply({ id: 'r-1', author_id: EDITOR })];
    renderModal();
    expect(screen.queryByTestId('project-chat-edit-r-1')).toBeNull();
    expect(screen.queryByTestId('project-chat-delete-r-1')).toBeNull();
    // ...and my own still does, so the assertion is not vacuous.
    expect(screen.getByTestId('project-chat-edit-post-1')).toBeInTheDocument();
  });

  // ★★ AND THE DATABASE AGREES. jsdom cannot run RLS; the live cross-user probe
  // in the PR proves 0 rows affected. This pins the policy that produces it.
  it('★★ the UPDATE policy is constrained to the author, both ways', () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY project_messages_author_update[\s\S]*?USING \([\s\S]*?author_id = auth\.uid\(\)[\s\S]*?WITH CHECK \([\s\S]*?author_id = auth\.uid\(\)/,
    );
  });

  // ★★ NOTHING IS HARD DELETED — it would strand permit_tasks.source_message_id.
  it('★★ there is no DELETE grant and no DELETE policy', () => {
    expect(migrationSql).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public\.project_messages FROM authenticated;/,
    );
    expect(migrationSql).not.toMatch(/FOR DELETE/);
  });

  // ★★ THE COLUMN GRANT. RLS says which ROWS; this says which FIELDS — without
  // it an author editing their own message could rewrite project_id or
  // author_id and the row policy would allow it.
  it('★★ UPDATE is granted on three columns, not on the table', () => {
    expect(migrationSql).toMatch(
      /GRANT UPDATE \(body, mentions, deleted_at\)\s*\n\s*ON TABLE public\.project_messages TO authenticated;/,
    );
  });

  // ★★ THE HISTORY IS THE DATABASE'S. A client that could write `revisions`
  // could forge it, which is why the column is not grantable.
  it('★★ revisions are written by a trigger, not by the client', () => {
    expect(migrationSql).toMatch(/CREATE TRIGGER project_messages_revision_trg/);
    expect(migrationSql).toMatch(/NEW\.revisions := COALESCE\(OLD\.revisions/);
    expect(migrationSql).not.toMatch(/GRANT UPDATE \([^)]*revisions/);
  });

  it('the pure helpers read the row, not the intent', () => {
    expect(isEdited({ edited_at: '2026-01-01' })).toBe(true);
    expect(isEdited({ edited_at: null })).toBe(false);
    expect(isDeleted({ deleted_at: '2026-01-01' })).toBe(true);
    // ★ The FIRST revision is the original — an edit-then-delete leaves two and
    // the one worth surfacing is still what was written first.
    expect(
      originalBody({
        body: 'now',
        revisions: [
          { body: 'first', at: '', by: null, reason: 'edited' },
          { body: 'second', at: '', by: null, reason: 'deleted' },
        ],
      }),
    ).toBe('first');
    expect(originalBody({ body: 'now', revisions: [] })).toBeNull();
  });
});

// ===========================================================================
// ★ 5. Task composition in the same send
// ===========================================================================

describe('fix-334 §5: one Send makes the message and the task', () => {
  it('★ the task fields are off by default and revealed by a toggle', () => {
    renderModal();
    expect(screen.queryByTestId('project-chat-send-task')).toBeNull();
    fireEvent.click(screen.getByTestId('project-chat-toggle-task'));
    expect(screen.getByTestId('project-chat-send-task')).toBeInTheDocument();
  });

  // ★★ ONE SEND, BOTH THINGS — and the permit is chosen, not guessed (fix-330).
  it('★★ one Send carries the message AND the task, on the chosen permit', async () => {
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-input'), {
      target: { value: 'chasing this now' },
    });
    fireEvent.click(screen.getByTestId('project-chat-toggle-task'));
    fireEvent.change(screen.getByTestId('project-chat-send-task-text'), {
      target: { value: 'Chase the survey' },
    });
    fireEvent.change(screen.getByTestId('project-chat-send-task-permit'), {
      target: { value: '21' },
    });
    fireEvent.click(screen.getByTestId('project-chat-send'));

    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0]).toMatchObject({
      body: 'chasing this now',
      parentMessageId: POST_ID,
    });
    expect(mocks.posted[0].task).toMatchObject({
      permitId: 21,
      text: 'Chase the survey',
      discipline: 'ent',
    });
  });

  it('defaults the permit to fix-330\'s anchor — the lowest-id Building Permit', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('project-chat-toggle-task'));
    expect(
      (screen.getByTestId('project-chat-send-task-permit') as HTMLSelectElement).value,
    ).toBe('12');
  });

  // ★ Send is held until the task is complete — a half-filled task riding along
  // silently would be worse than refusing.
  it('★ Send waits for the task to be usable', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-input'), {
      target: { value: 'hello' },
    });
    expect(screen.getByTestId('project-chat-send')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('project-chat-toggle-task'));
    // Task text is empty, so the pair is not ready.
    expect(screen.getByTestId('project-chat-send')).toBeDisabled();
    fireEvent.change(screen.getByTestId('project-chat-send-task-text'), {
      target: { value: 'do the thing' },
    });
    expect(screen.getByTestId('project-chat-send')).not.toBeDisabled();
  });

  it('a project with no permits cannot add a task, and says why', () => {
    renderModal([]);
    const toggle = screen.getByTestId('project-chat-toggle-task') as HTMLButtonElement;
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('title')).toMatch(/no permit/i);
  });

  // ★ NOT A SECOND FORM. Both composers render the same <ChatTaskFields>.
  it('★ the post-hoc composer and the send composer share one form', async () => {
    const shared = (await import('../components/ProjectDetail/ChatTaskFields.tsx?raw'))
      .default as string;
    const composer = (await import('../components/ProjectDetail/ChatTaskComposer.tsx?raw'))
      .default as string;
    const modal = (await import('../components/ProjectDetail/ProjectChatModal.tsx?raw'))
      .default as string;
    expect(composer).toContain('ChatTaskFields');
    expect(modal).toContain('ChatTaskFields');
    // The permit chooser exists once, in the shared file.
    expect(shared).toContain('Permit for this task');
    expect(composer).not.toContain('Permit for this task');
    expect(modal).not.toContain('Permit for this task');
  });
});

// ===========================================================================
// Prior contracts, and the standing rules
// ===========================================================================

describe('fix-334: what must not have moved', () => {
  it('★ the message and its task still go through ONE mutation', async () => {
    const hooks = (await import('../hooks/useProjectMessages.ts?raw')).default as string;
    // The task rides inside usePostMessage rather than a second call after it.
    expect(hooks).toMatch(/if \(task\) \{/);
    expect(hooks).toContain('bp_upsert_permit_task');
  });

  it('★ still one realtime channel', async () => {
    const realtime = (await import('../hooks/useRealtimeInvalidation.ts?raw'))
      .default as string;
    expect(realtime.match(/supabase\.channel\(/g) ?? []).toHaveLength(1);
  });

  it('★ a deleted message stops pinging the bell', async () => {
    const hooks = (await import('../hooks/useProjectMessages.ts?raw')).default as string;
    expect(hooks).toMatch(/\.is\('deleted_at', null\)/);
  });

  // ★ The standing rule, and the one exception the brief itself asked for.
  it('★ the migration adopts pre-existing messages rather than deleting them', () => {
    expect(migrationSql).toMatch(/Adopt the pre-existing messages/);
    expect(migrationSql).toMatch(/'General'/);
    // Only parent_message_id is written on an existing row.
    expect(migrationSql).toMatch(/SET parent_message_id = v_post/);
    expect(migrationSql).not.toMatch(/DELETE FROM public\.project_messages/);
  });

  it('★ two levels only, enforced by the database', () => {
    expect(migrationSql).toMatch(/replies nest one level only/);
    expect(migrationSql).toMatch(/CREATE TRIGGER project_messages_shape_trg/);
  });

  it('★ nothing renders "coming soon" or "coming later"', () => {
    const modules = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(modules)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => /coming soon|coming later/i.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
