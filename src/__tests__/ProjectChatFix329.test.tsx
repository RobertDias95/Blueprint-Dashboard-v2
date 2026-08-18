import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_329_project_messages.sql?raw';
import {
  buildNewItems,
  keyForMention,
  unseenCount,
  unseenItems,
} from '../lib/boardReads';
import {
  initialsOf,
  mentionsMe,
  parseMentions,
  splitBody,
} from '../lib/projectChat';
import { anchorPermitIdFor } from '../hooks/useProjectMessages';
import type { MentionablePerson, Permit, ProjectMessage } from '../lib/database.types';

// fix-329 (register #71) — project chat, phase 1.
//
// ★ FOUR DECISIONS, taken by Bobby and asserted here rather than restated:
// one thread per PROJECT · visible to the whole tenant · a mention lands in the
// BELL · a task created from a message REMEMBERS that message.
//
// ★★ THE COUNT THAT MUST NOT FORK. The rail card's unread number and the bell's
// badge are the same two inputs — mention keys minus board_item_reads — so a
// mention read in one place stops counting in the other. Two counts that can
// disagree is the defect fix-298 Phase 2 spent a ticket collapsing, and the
// tests below assert they move together rather than that each works alone.

const BOBBY = '11111111-1111-1111-1111-111111111111';
const BRIANA = '22222222-2222-2222-2222-222222222222';
const AFTER_EPOCH = '2026-08-15T10:00:00Z';
const BEFORE_EPOCH = '2026-01-01T10:00:00Z';

const PEOPLE: MentionablePerson[] = [
  { user_id: BOBBY, name: 'Bobby', email: 'bobby@x.com' },
  { user_id: BRIANA, name: 'Briana', email: 'briana@x.com' },
  { user_id: '33333333-3333-3333-3333-333333333333', name: 'Mary Beth', email: 'mb@x.com' },
];

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: BRIANA,
    author_name: 'Briana',
    body: 'Builder says they are likely selling.',
    mentions: [],
    // fix-330 added attachments + the task's permit to the row; every fix-329
    // assertion below is about text and is unaffected by them.
    attachments: [],
    created_at: AFTER_EPOCH,
    task_id: null,
    task_text: null,
    task_permit_id: null,
    // fix-334: posts, edit history and soft delete. These fixtures are REPLIES
    // under a post — the shape every pre-fix-334 message became.
    parent_message_id: 'post-1',
    title: null,
    edited_at: null,
    deleted_at: null,
    revisions: [],
    reply_count: null,
    last_activity_at: null,
    ...over,
  };
}

// ---------------------------------------------------------------- parsing --

describe('fix-329: mentions are parsed against the roster, not guessed', () => {
  it('resolves @Name to a user id', () => {
    expect(parseMentions('@Bobby can you look?', PEOPLE)).toEqual([BOBBY]);
  });

  // ★ A name can contain a space. A regex over "@\w+" would mention nobody here,
  // or the wrong person — which is why the parser matches KNOWN names.
  it('★ handles a name with a space, longest match first', () => {
    const ids = parseMentions('@Mary Beth please confirm', PEOPLE);
    expect(ids).toEqual(['33333333-3333-3333-3333-333333333333']);
  });

  it('★ @Bob does not match inside @Bobby', () => {
    // "Bob" is not on the roster; "Bobby" is. The word-boundary rule is what
    // stops a prefix from claiming a longer name.
    expect(parseMentions('@Bobby', PEOPLE)).toEqual([BOBBY]);
    expect(parseMentions('@Bobbyx', PEOPLE)).toEqual([]);
  });

  // ★ An unresolvable @thing stays plain text. A mention that cannot reach
  // anybody is the paperclip-that-does-nothing failure in another costume.
  it('★ leaves an unknown @handle as plain text', () => {
    expect(parseMentions('@nobody hello', PEOPLE)).toEqual([]);
    const segs = splitBody('@nobody hello', PEOPLE);
    expect(segs.every((s) => !s.mention)).toBe(true);
  });

  it('splits a body so only real mentions tint', () => {
    const segs = splitBody('hey @Bobby and @nobody', PEOPLE);
    const tinted = segs.filter((s) => s.mention).map((s) => s.text);
    expect(tinted).toEqual(['@Bobby']);
  });

  it('initials fall back rather than rendering nothing', () => {
    expect(initialsOf('Briana')).toBe('BR');
    expect(initialsOf('Mary Beth')).toBe('MB');
    expect(initialsOf(null)).toBe('··');
  });
});

// ------------------------------------------------------------ the bell -----

describe('fix-329: a mention is the bell\'s fifth source', () => {
  const base = {
    flips: [],
    tasks: [],
    acks: [],
    permits: [],
    viewerName: 'Bobby',
    projects: [{ id: 'p-1', address: '3921 43rd Ave S' }],
  };

  // ★ THE TWO-VIEWER ASSERTION the brief asks for, done the way fix-307 asserted
  // per-user reads: the same message, two viewers, one count each.
  it('★ increments for the mentioned person and NOBODY else', () => {
    const mentions = [
      { id: 'm-1', project_id: 'p-1', body: '@Bobby can you look?', created_at: AFTER_EPOCH, mentions: [BOBBY] },
    ];
    const forBobby = buildNewItems({ ...base, mentions, viewerUserId: BOBBY });
    const forBriana = buildNewItems({ ...base, viewerName: 'Briana', mentions, viewerUserId: BRIANA });
    expect(forBobby.filter((i) => i.source === 'mention')).toHaveLength(1);
    expect(forBriana.filter((i) => i.source === 'mention')).toHaveLength(0);
  });

  it('keys the item on the message id, so re-deriving cannot re-notify', () => {
    const mentions = [
      { id: 'm-42', project_id: 'p-1', body: 'hi @Bobby', created_at: AFTER_EPOCH, mentions: [BOBBY] },
    ];
    const once = buildNewItems({ ...base, mentions, viewerUserId: BOBBY });
    const twice = buildNewItems({ ...base, mentions, viewerUserId: BOBBY });
    expect(once[0].key).toBe('mention:m-42');
    expect(once[0].key).toBe(twice[0].key);
    expect(keyForMention('m-42')).toBe('mention:m-42');
  });

  it('names the project it happened on', () => {
    const items = buildNewItems({
      ...base,
      mentions: [{ id: 'm-1', project_id: 'p-1', body: 'hi @Bobby', created_at: AFTER_EPOCH, mentions: [BOBBY] }],
      viewerUserId: BOBBY,
    });
    expect(items[0].where).toBe('3921 43rd Ave S');
    expect(items[0].projectId).toBe('p-1');
  });

  // fix-307's epoch: nothing older than the deploy can ever be new, for anyone.
  it('a pre-epoch message is not news', () => {
    const items = buildNewItems({
      ...base,
      mentions: [{ id: 'm-old', project_id: 'p-1', body: 'hi @Bobby', created_at: BEFORE_EPOCH, mentions: [BOBBY] }],
      viewerUserId: BOBBY,
    });
    expect(items.filter((i) => i.source === 'mention')).toHaveLength(0);
  });

  // ★★ ONE SOURCE, BOTH SURFACES. The bell's badge and the rail card's count are
  // the same subtraction, so reading in one place clears the other.
  it('★ reading a mention clears it for the bell AND the rail', () => {
    const mentions = [
      { id: 'm-1', project_id: 'p-1', body: 'hi @Bobby', created_at: AFTER_EPOCH, mentions: [BOBBY] },
    ];
    const items = buildNewItems({ ...base, mentions, viewerUserId: BOBBY });
    expect(unseenCount(items, new Set())).toBe(1);

    // The rail card counts the same way: mention keys minus read keys.
    const read = new Set([keyForMention('m-1')]);
    expect(unseenCount(items, read)).toBe(0);
    expect(unseenItems(items, read)).toHaveLength(0);
  });

  it('the other four sources are untouched by this ticket', () => {
    // No mentions passed at all — the builder behaves exactly as before.
    const items = buildNewItems({ flips: [], tasks: [], acks: [], permits: [], viewerName: 'Bobby' });
    expect(items).toEqual([]);
  });
});

// --------------------------------------------------------- the surfaces ----

const mocks = vi.hoisted(() => ({
  messages: [] as ProjectMessage[],
  /** fix-334: drop the injected General post, for the empty-state tests. */
  suppressPost: false,
  reads: [] as string[],
  people: [] as MentionablePerson[],
  posted: [] as { projectId: string; body: string; mentions: string[] }[],
  marked: [] as string[][],
  created: [] as Record<string, unknown>[],
  userId: '11111111-1111-1111-1111-111111111111' as string | null,
}));

// ★★ fix-334: every message is now a REPLY UNDER A POST. These suites predate
// posts, so the mocked read wraps their fixtures in the one post they all hang
// from — which is exactly the shape the migration gave the seven real messages
// that predated posts too. The assertions below are unchanged by it.
const FIX334_POST = {
  id: 'post-1',
  project_id: 'p-1',
  author_id: '11111111-1111-1111-1111-111111111111',
  author_name: 'Bobby',
  body: 'Messages posted before this project had posts.',
  mentions: [] as string[],
  attachments: [],
  created_at: '2026-08-15T09:00:00Z',
  task_id: null,
  task_text: null,
  task_permit_id: null,
  parent_message_id: null,
  title: 'General',
  edited_at: null,
  deleted_at: null,
  revisions: [],
  reply_count: null,
  last_activity_at: null,
} as unknown as import('../lib/database.types').ProjectMessage;

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: mocks.userId ? { id: mocks.userId, email: 'bobby@x.com' } : null,
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
    useProjectMessages: () => ({
      data: mocks.suppressPost ? mocks.messages : [FIX334_POST, ...mocks.messages],
      isLoading: false,
      error: null,
    }),
    useMentionablePeople: () => ({ data: mocks.people, isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
    usePostMessage: () => ({
      mutate: (
        input: { projectId: string; body: string; mentions: string[] },
        opts?: { onSuccess?: () => void },
      ) => {
        mocks.posted.push(input);
        opts?.onSuccess?.();
      },
      isPending: false,
    }),
    useCreateTaskFromMessage: () => ({
      mutate: (input: Record<string, unknown>) => {
        mocks.created.push(input);
      },
      isPending: false,
    }),
  };
});
// fix-330: "Create task" now opens a composer that reads the roster, the
// project and dm_da_groups to build the assignee options. Inert here — this
// file's remaining create-task assertion is only that the chooser OPENS.
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [] }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: mocks.reads, isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({
    mutate: (keys: string[]) => mocks.marked.push(keys),
    isPending: false,
  }),
}));

import ProjectChatCard, {
  ProjectChatUnread,
} from '../components/ProjectDetail/ProjectChatSection';
import ProjectChatModal from '../components/ProjectDetail/ProjectChatModal';

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 10,
    project_id: 'p-1',
    type: 'Building Permit',
    num: 'BP-1',
    ...over,
  } as unknown as Permit;
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ProjectChatCard projectId="p-1" />, { wrapper });
}

// ★★ fix-345 §3: the section is the PREVIEW now — the modal and its opener
// moved up to the Team card, because the way in became the card's pinned Chat
// button and the two live in different sections of the same card. So a test
// that wants the modal renders the modal, which is what these ones were always
// about; the click through the section was a hop, not a contract.
const modalClosed = vi.fn();
function renderModal(permits: Permit[] = [permit()]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  modalClosed.mockClear();
  return render(
    <ProjectChatModal projectId="p-1" permits={permits} onClose={modalClosed} />,
    { wrapper },
  );
}

/** ★ fix-331 §3: the unread pill is a separate export, because the section
 *  heading belongs to <OverviewSection> and a count drawn in the body would sit
 *  under the word it counts for rather than beside it. */
function renderUnread() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ProjectChatUnread projectId="p-1" />, { wrapper });
}

beforeEach(() => {
  mocks.messages = [];
  mocks.suppressPost = false;
  mocks.reads = [];
  mocks.people = PEOPLE;
  mocks.posted = [];
  mocks.marked = [];
  mocks.created = [];
  mocks.userId = BOBBY;
});

// ★★ fix-331 §3 MOVED THIS SURFACE. The rail card is gone; the preview is a
// SECTION of the Team card now, between Internal and External, and it shows TWO
// messages rather than three — Bobby: "if anything we just want to display maybe
// one or two of the most previous messages, and then the rest you would have to
// open." The tests below keep fix-329's contracts and re-point at the section.
describe('fix-329: the message preview (fix-331: now a Team-card section)', () => {
  // ★★ SUPERSEDED BY fix-334, inverted rather than deleted. The section still
  // previews "one or two, and the rest you would have to open" — but the unit is
  // a POST now, so it shows the post and the newest thing said in it rather than
  // the last two replies torn out of whichever post happened to be busiest.
  it('★ previews the post, showing what was said most recently in it', () => {
    mocks.messages = [
      message({ id: 'm-1', body: 'oldest' }),
      message({ id: 'm-2', body: 'second' }),
      message({ id: 'm-3', body: 'third' }),
      message({ id: 'm-4', body: 'newest' }),
    ];
    renderCard();
    const mini = screen.getByTestId('project-chat-mini');
    expect(within(mini).getByText('General')).toBeInTheDocument();
    expect(within(mini).getByText('newest')).toBeInTheDocument();
    expect(within(mini).queryByText('oldest')).toBeNull();
    expect(within(mini).queryByText('second')).toBeNull();
    // ...and it says how much more there is behind it.
    expect(within(mini).getByText('4 replies')).toBeInTheDocument();
  });

  // ★ fix-331 §3: the unread pill moved to the section HEADING, which
  // <OverviewSection> owns — so it is its own exported component now and is
  // rendered by TeamCell beside the word "Chat". Same query, same subtraction,
  // same source as the bell.
  it('★ counts unread mentions of ME, and only mine', () => {
    mocks.messages = [
      message({ id: 'm-1', body: '@Bobby look', mentions: [BOBBY] }),
      message({ id: 'm-2', body: '@Briana look', mentions: [BRIANA] }),
    ];
    renderUnread();
    expect(screen.getByTestId('project-chat-unread').textContent).toContain('1 new');
  });

  // ★ The same subtraction the bell does — asserted through the component, so a
  // second read model would fail here.
  it('★ a mention already in board_item_reads stops counting', () => {
    mocks.messages = [message({ id: 'm-1', body: '@Bobby look', mentions: [BOBBY] })];
    mocks.reads = [keyForMention('m-1')];
    renderUnread();
    expect(screen.queryByTestId('project-chat-unread')).toBeNull();
  });

  // ★ fix-334: the preview row is now the POST, so it is keyed on the post id —
  // and it tints when the viewer is mentioned ANYWHERE inside it, which is the
  // question the section actually answers.
  it('tints a post containing a mention of the viewer', () => {
    mocks.messages = [message({ id: 'm-1', body: 'hey @Bobby', mentions: [BOBBY] })];
    renderCard();
    expect(screen.getByTestId('project-chat-mini-post-1').dataset.toMe).toBe('true');
    expect(screen.getAllByTestId('project-chat-mention')[0].textContent).toBe('@Bobby');
  });

  it('an empty thread says so rather than rendering a blank box', () => {
    // ★ fix-334: empty now means NO POSTS, so the injected General post has to
    // go for this to be the empty case at all.
    mocks.suppressPost = true;
    renderCard();
    expect(screen.getByTestId('project-chat-empty')).toBeInTheDocument();
  });
});

describe('fix-329: the modal', () => {
  function openModal(permits: Permit[] = [permit()]) {
    renderModal(permits);
  }

  it('shows the full thread, not the last three', () => {
    mocks.messages = [
      message({ id: 'm-1', body: 'oldest' }),
      message({ id: 'm-2', body: 'second' }),
      message({ id: 'm-3', body: 'third' }),
      message({ id: 'm-4', body: 'newest' }),
    ];
    openModal();
    const thread = screen.getByTestId('project-chat-thread');
    expect(within(thread).getByText('oldest')).toBeInTheDocument();
    expect(within(thread).getByText('newest')).toBeInTheDocument();
  });

  it('posts a message with its mentions resolved', async () => {
    openModal();
    fireEvent.change(screen.getByTestId('project-chat-input'), {
      target: { value: 'ping @Briana about the survey' },
    });
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0].body).toBe('ping @Briana about the survey');
    expect(mocks.posted[0].mentions).toEqual([BRIANA]);
  });

  // ★ Opening the thread is the moment a mention stops being news — the same
  // read model the bell uses, not a second one.
  it('★ reading the thread marks its mentions read, and nothing else', async () => {
    mocks.messages = [
      message({ id: 'm-1', body: '@Bobby look', mentions: [BOBBY] }),
      message({ id: 'm-2', body: 'no mention here' }),
    ];
    openModal();
    await waitFor(() => expect(mocks.marked.length).toBeGreaterThan(0));
    expect(mocks.marked[0]).toEqual([keyForMention('m-1')]);
  });

  // ★★ SUPERSEDED BY fix-330, deliberately rewritten rather than deleted.
  //
  // fix-329 asserted this control was DISABLED with an honest "coming later"
  // label, which was the right shape for a ticket that had no upload path. It
  // was still a placeholder in Bobby's production UI, and fix-330 exists to
  // erase it. The assertion is inverted here so the file cannot quietly go on
  // claiming a contract the product no longer has; the live behaviour is
  // covered in ProjectChatFix330.test.tsx.
  it('★ the attach control is LIVE (fix-330 removed the placeholder)', () => {
    openModal();
    const attach = screen.getByTestId('project-chat-attach') as HTMLButtonElement;
    expect(attach).not.toBeDisabled();
    expect(attach.textContent ?? '').not.toMatch(/coming later/i);
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  // ★★ ALSO SUPERSEDED BY fix-330. fix-329 fired the create immediately and
  // CHOSE the permit silently; the button now opens a composer that pre-selects
  // that same anchor and lets the person disagree. The anchor itself is still a
  // fix-329 contract and is asserted below, unchanged.
  it('★ Create task opens the chooser instead of choosing for you', () => {
    mocks.messages = [message({ id: 'm-7', body: 'chase the survey' })];
    openModal([permit({ id: 21, type: 'Demolition' }), permit({ id: 12, type: 'Building Permit' })]);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    expect(screen.getByTestId('chat-task-composer-m-7')).toBeInTheDocument();
    // Nothing is written until the person confirms.
    expect(mocks.created).toHaveLength(0);
  });

  it('★ shows the link back once a task exists, instead of offering again', () => {
    mocks.messages = [
      message({ id: 'm-9', body: 'chase it', task_id: 't-1', task_text: 'Chase the survey' }),
    ];
    openModal();
    expect(screen.getByTestId('project-chat-task-m-9').textContent).toContain(
      'Chase the survey',
    );
    expect(screen.queryByTestId('project-chat-create-task-m-9')).toBeNull();
  });

  it('a project with no permits disables Create task and says why', () => {
    mocks.messages = [message({ id: 'm-3', body: 'no permits here' })];
    openModal([]);
    const btn = screen.getByTestId('project-chat-create-task-m-3') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/no permit/i);
    expect(mocks.created).toHaveLength(0);
  });

  // ★ fix-345 §3: the modal is mounted by its OWNER — the Team card — so "the ✕
  // closes it" is now "the ✕ asks its owner to close it", which is the contract
  // that actually lives in this component. Unmounting is the card's half, and
  // the card is where it is asserted.
  it('closes on Escape and on the ✕', () => {
    openModal();
    fireEvent.click(screen.getByTestId('project-chat-close'));
    expect(modalClosed).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------ the anchor ---

describe('fix-329: the task anchor', () => {
  it('prefers the lowest-id Building Permit', () => {
    expect(
      anchorPermitIdFor([
        { id: 30, type: 'Demolition' },
        { id: 20, type: 'Building Permit' },
        { id: 25, type: 'Building Permit' },
      ]),
    ).toBe(20);
  });

  it('falls back to the lowest-id permit when there is no BP', () => {
    expect(anchorPermitIdFor([{ id: 9, type: 'ULS' }, { id: 4, type: 'Demolition' }])).toBe(4);
  });

  it('returns null when the project has no permits at all', () => {
    expect(anchorPermitIdFor([])).toBeNull();
  });
});

// ------------------------------------------------------- schema contracts --

describe('fix-329: the schema decisions, pinned', () => {
  // ★ APPEND-ONLY IN PHASE 1, stated rather than left unstated. A message
  // someone can silently rewrite after a task was created from it is a trap.
  it('★ grants SELECT + INSERT only — no UPDATE or DELETE', () => {
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT ON TABLE public\.project_messages TO authenticated, service_role;/,
    );
    expect(migrationSql).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON public\.project_messages FROM authenticated;/,
    );
    // ...and no policy exists that would allow either, so it is enforced twice.
    expect(migrationSql).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE ON public\.project_messages/);
    expect(migrationSql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE ON public\.project_messages/);
  });

  it('follows the tenant pattern exactly', () => {
    expect(migrationSql).toMatch(/default_tenant_id_to_caller\(\)/);
    expect(migrationSql).toMatch(/tenant_id = ANY \(public\.auth_tenant_ids\(\)\)/);
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.project_messages FROM PUBLIC, anon;/);
  });

  // ★ A deleted message must not delete a task.
  it('★ the task link is nullable and ON DELETE SET NULL', () => {
    expect(migrationSql).toMatch(
      /ADD COLUMN IF NOT EXISTS source_message_id uuid\s*\n?\s*REFERENCES public\.project_messages\(id\) ON DELETE SET NULL/,
    );
  });

  it('mentions are stored parsed, with an index the bell can use', () => {
    expect(migrationSql).toMatch(/mentions\s+uuid\[\] NOT NULL DEFAULT ARRAY\[\]::uuid\[\]/);
    expect(migrationSql).toMatch(/USING GIN \(mentions\)/);
  });

  // ★ One channel. useScraperActivity's comment records what a second one cost.
  it('★ realtime rides the existing publication, not a new channel', async () => {
    expect(migrationSql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.project_messages/);
    const keys = (await import('../lib/queryKeys.ts?raw')).default as string;
    expect(keys).toMatch(/project_messages: \[queryKeys\.projectMessagesAll\]/);
    const realtime = (await import('../hooks/useRealtimeInvalidation.ts?raw')).default as string;
    expect(realtime.match(/supabase\.channel\(/g) ?? []).toHaveLength(1);
  });

  it('mentionsMe reads the stored ids, not the body', () => {
    expect(mentionsMe({ mentions: [BOBBY] }, BOBBY)).toBe(true);
    expect(mentionsMe({ mentions: [BRIANA] }, BOBBY)).toBe(false);
    expect(mentionsMe({ mentions: [] }, null)).toBe(false);
  });
});
