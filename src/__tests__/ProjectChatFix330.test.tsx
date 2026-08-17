import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_330_chat_complete.sql?raw';
import { buildNewItems } from '../lib/boardReads';
import {
  findMentionQuery,
  applyMention,
  mentionableAfterRoster,
  rankMentionCandidates,
  splitBody,
  unresolvedMentions,
} from '../lib/projectChat';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentPath,
  humanSize,
  rejectionReason,
  sanitizeFileName,
} from '../lib/chatAttachments';
import { permitChoiceLabel } from '../hooks/useProjectMessages';
import type {
  ChatAttachment,
} from '../lib/chatAttachments';
import type {
  MentionablePerson,
  Permit,
  ProjectMessage,
  TeamMember,
} from '../lib/database.types';

// fix-330 — project chat, finished. Every ★ here is a path a person takes.
//
// ★★ THE MEASUREMENT THAT CHANGED THE TICKET. fix-329's brief said `@Miles`
// worked and only `@mi` failed. It did not. On prod, profiles.name and
// full_name are NULL for all 29 logins and auth.users carries no name either,
// so bp_mentionable_people was returning EMAIL ADDRESSES as names — `@Miles`
// matched nobody, and a typeahead over that data would have offered Bobby a
// dropdown of email addresses. The server half of the fix is
// bp_profile_display_name (team_members.email — fix-176's mapping); this file
// tests the half people touch.
//
// ★ Rendered behaviour, not domain functions, wherever a person is involved.
// The pure helpers are asserted too, but only where they encode a rule (the
// ranking Bobby specified, the refusal reasons) rather than as a substitute for
// driving the UI.

const BOBBY = '11111111-1111-1111-1111-111111111111';
const BRIANA = '22222222-2222-2222-2222-222222222222';
const MILES = '33333333-3333-3333-3333-333333333333';
const DERRY = '44444444-4444-4444-4444-444444444444';
const DAVE = '55555555-5555-5555-5555-555555555555';
const EDMUND = '66666666-6666-6666-6666-666666666666';
const NIDHI = '77777777-7777-7777-7777-777777777777';
const AFTER_EPOCH = '2026-08-15T10:00:00Z';

const PEOPLE: MentionablePerson[] = [
  { user_id: BOBBY, name: 'Bobby', email: 'robertd@x.com' },
  { user_id: BRIANA, name: 'Briana', email: 'briana@x.com' },
  { user_id: MILES, name: 'Miles', email: 'miles@x.com' },
  { user_id: DERRY, name: 'Derry', email: 'derry@x.com' },
  { user_id: DAVE, name: 'Dave', email: 'dave@x.com' },
  { user_id: EDMUND, name: 'Edmund', email: 'edmund@x.com' },
];

/** ★ The person fix-321 exists for: on the roster, and gone. */
const NIDHI_PERSON: MentionablePerson = {
  user_id: NIDHI,
  name: 'Nidhi',
  email: 'nidhi@x.com',
};

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: `m-${over.name}-${over.role ?? 'da'}`,
    name: over.name ?? 'X',
    role: 'da',
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-01-01T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

// ---------------------------------------------------------------- ranking ---

describe('fix-330: the ranking Bobby specified', () => {
  // Bobby, verbatim: "if I type @MI it should pre-populate Miles, or @D shows
  // everyone that starts with a D or has a D."
  it('★ @mi puts Miles first', () => {
    const hits = rankMentionCandidates('mi', PEOPLE);
    expect(hits[0].name).toBe('Miles');
  });

  it('★ @d shows prefix matches AND substring matches, prefix first', () => {
    const names = rankMentionCandidates('d', PEOPLE).map((p) => p.name);
    // Dave and Derry START with D; Edmund merely HAS one. Both are offered —
    // "starts with a D or has a D" — and the prefix pair ranks above.
    expect(names.slice(0, 2).sort()).toEqual(['Dave', 'Derry']);
    expect(names).toContain('Edmund');
    expect(names.indexOf('Edmund')).toBeGreaterThan(names.indexOf('Derry'));
  });

  it('a bare @ offers everybody rather than an empty box', () => {
    expect(rankMentionCandidates('', PEOPLE)).toHaveLength(PEOPLE.length);
  });

  it('matches the email local part too, below the name matches', () => {
    // Nobody is called "robertd"; Bobby's login is. Typing what you know should
    // still find him.
    const names = rankMentionCandidates('robertd', PEOPLE).map((p) => p.name);
    expect(names).toEqual(['Bobby']);
  });

  it('an unmatchable query yields nothing (the list closes, it does not empty)', () => {
    expect(rankMentionCandidates('zzzz', PEOPLE)).toEqual([]);
  });
});

describe('fix-330: where the caret says a mention is being typed', () => {
  it('finds the @word the caret is inside', () => {
    expect(findMentionQuery('hey @mi', 7)).toEqual({ start: 4, query: 'mi' });
  });

  // ★ "Mary Beth" is a name. A picker that closed on the space could never
  // offer her.
  it('★ allows one space, so a two-word name is reachable', () => {
    expect(findMentionQuery('hi @Mary B', 10)?.query).toBe('Mary B');
    expect(findMentionQuery('hi @Mary Beth is on it', 22)).toBeNull();
  });

  // ★ An @ glued to a word is an email address, not a mention.
  it('★ ignores the @ inside an email address', () => {
    expect(findMentionQuery('mail dave@blueprint.com', 23)).toBeNull();
  });

  it('replaces the typed query with a resolved token and moves the caret past it', () => {
    const q = findMentionQuery('hey @mi', 7)!;
    expect(applyMention('hey @mi', q, 7, 'Miles')).toEqual({
      text: 'hey @Miles ',
      caret: 11,
    });
  });
});

describe('fix-330: an unresolved @word is reported, not silently dropped', () => {
  it('★ names the words that match nobody', () => {
    expect(unresolvedMentions('@mi can you look, @Miles?', PEOPLE)).toEqual(['@mi']);
  });

  it('★ and does not cry wolf over an email address', () => {
    expect(unresolvedMentions('send it to dave@blueprint.com', PEOPLE)).toEqual([]);
  });

  it('a fully resolved body reports nothing', () => {
    expect(unresolvedMentions('@Miles and @Briana', PEOPLE)).toEqual([]);
  });
});

describe('fix-330: fix-321 — the picker stops at the current roster', () => {
  const roster = [
    member({ name: 'Nidhi', email: 'nidhi@x.com', active: false, former: true }),
    member({ name: 'Miles', email: 'miles@x.com' }),
  ];

  it('★ someone the roster says has left is never offered', () => {
    const out = mentionableAfterRoster([...PEOPLE, NIDHI_PERSON], roster);
    expect(out.map((p) => p.name)).not.toContain('Nidhi');
    expect(out.map((p) => p.name)).toContain('Miles');
  });

  // ★ The half of fix-321 that is easy to get backwards. 7 of 29 production
  // logins have NO roster row; dropping them would make live people
  // unmentionable, which is a worse bug than the one being fixed.
  it('★ someone with NO roster row at all is still offered', () => {
    const out = mentionableAfterRoster([{ user_id: 'x', name: 'Keenan', email: 'keenan@x.com' }], roster);
    expect(out).toHaveLength(1);
  });

  // One live role is enough to still be here (roster.ts's rule).
  it('one current row outvotes a retired one', () => {
    const both = [
      member({ name: 'Derry', role: 'da', email: 'derry@x.com', active: false, former: true }),
      member({ name: 'Derry', role: 'dm', email: 'derry@x.com' }),
    ];
    expect(mentionableAfterRoster(PEOPLE, both).map((p) => p.name)).toContain('Derry');
  });
});

// -------------------------------------------------------------- the modal ---

const mocks = vi.hoisted(() => ({
  messages: [] as ProjectMessage[],
  people: [] as MentionablePerson[],
  members: [] as TeamMember[],
  reads: [] as string[],
  posted: [] as {
    projectId: string;
    body: string;
    mentions: string[];
    files?: readonly File[];
  }[],
  created: [] as Record<string, unknown>[],
  signed: 'https://signed.example/x' as string | null,
  signedError: null as Error | null,
  // The literal, not the constant: vi.hoisted runs before module-scope consts.
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
      user: mocks.userId ? { id: mocks.userId, email: 'robertd@x.com' } : null,
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
      data: [FIX334_POST, ...mocks.messages],
      isLoading: false,
      error: null,
    }),
    useMentionablePeople: () => ({ data: mocks.people, isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
    usePostMessage: () => ({
      mutate: (
        input: {
          projectId: string;
          body: string;
          mentions: string[];
          files?: readonly File[];
        },
        opts?: { onSuccess?: () => void },
      ) => {
        mocks.posted.push(input);
        opts?.onSuccess?.();
      },
      isPending: false,
    }),
    useCreateTaskFromMessage: () => ({
      mutate: (input: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
        mocks.created.push(input);
        opts?.onSuccess?.();
      },
      isPending: false,
    }),
  };
});
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: mocks.reads, isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual, // the real activeMemberNamesOf
    useTeamMembers: () => ({
      all: mocks.members,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [] }),
}));
// ★ The bucket is private, so a rendered attachment is a signed URL. Mocked at
// the hook so the renderer can be driven through both outcomes — signed, and
// refused.
vi.mock('../hooks/useChatAttachments', async (orig) => {
  const actual = await orig<typeof import('../hooks/useChatAttachments')>();
  return {
    ...actual,
    useSignedAttachmentUrl: () => ({
      data: mocks.signedError ? undefined : mocks.signed,
      error: mocks.signedError,
      isLoading: false,
    }),
  };
});

import ProjectChatCard from '../components/ProjectDetail/ProjectChatSection';

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: BRIANA,
    author_name: 'Briana',
    body: 'Builder says they are likely selling.',
    mentions: [],
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

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 10,
    project_id: 'p-1',
    type: 'Building Permit',
    num: '7133442-CN',
    da: 'Cam',
    ent_lead: 'Miles',
    ...over,
  } as unknown as Permit;
}

const TWO_PERMITS = [
  permit({ id: 12, type: 'Building Permit', num: '7133442-CN' }),
  permit({ id: 21, type: 'Demolition', num: '7133443-DM' }),
];

function renderCard(permits: Permit[] = [permit()]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ProjectChatCard projectId="p-1" permits={permits} />, { wrapper });
}

function openModal(permits: Permit[] = [permit()]) {
  renderCard(permits);
  fireEvent.click(screen.getByTestId('project-chat-open'));
}

function type(text: string) {
  const input = screen.getByTestId('project-chat-input') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  return input;
}

function imageFile(name = 'snip.png', bytes = 2048, mime = 'image/png') {
  return new File([new Uint8Array(bytes)], name, { type: mime });
}

beforeEach(() => {
  mocks.messages = [];
  mocks.people = PEOPLE;
  mocks.members = [];
  mocks.reads = [];
  mocks.posted = [];
  mocks.created = [];
  mocks.signed = 'https://signed.example/x';
  mocks.signedError = null;
  mocks.userId = BOBBY;
  // jsdom has neither; the composer needs both for image previews.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fix-330: the @ picker, driven', () => {
  it('★ typing @ opens the picker', () => {
    openModal();
    type('@');
    expect(screen.getByTestId('mention-picker')).toBeInTheDocument();
  });

  it('★ @mi shows Miles, first', () => {
    openModal();
    type('@mi');
    const options = within(screen.getByTestId('mention-picker')).getAllByRole('option');
    expect(options[0].textContent).toContain('Miles');
  });

  it('★ @d shows everyone with a D, prefix matches first', () => {
    openModal();
    type('@d');
    const labels = within(screen.getByTestId('mention-picker'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(labels.filter((l) => l.includes('Dave'))).toHaveLength(1);
    expect(labels.filter((l) => l.includes('Derry'))).toHaveLength(1);
    expect(labels.filter((l) => l.includes('Edmund'))).toHaveLength(1);
    expect(labels.findIndex((l) => l.includes('Edmund'))).toBeGreaterThan(1);
  });

  it('★ the list closes when nothing matches, rather than showing an empty box', () => {
    openModal();
    type('@zzzz');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
  });

  it('★ arrows move the selection', () => {
    openModal();
    const input = type('@d');
    expect(screen.getByTestId(`mention-option-${DAVE}`).dataset.active).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByTestId(`mention-option-${DERRY}`).dataset.active).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByTestId(`mention-option-${DAVE}`).dataset.active).toBe('true');
  });

  it('★ Enter selects the highlighted name and inserts a resolved mention', () => {
    openModal();
    const input = type('hey @mi');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((screen.getByTestId('project-chat-input') as HTMLTextAreaElement).value).toBe(
      'hey @Miles ',
    );
    // Enter chose a name; it did NOT also send the message.
    expect(mocks.posted).toHaveLength(0);
  });

  it('★ clicking a name selects it', () => {
    openModal();
    type('@bri');
    fireEvent.mouseDown(screen.getByTestId(`mention-option-${BRIANA}`));
    expect((screen.getByTestId('project-chat-input') as HTMLTextAreaElement).value).toBe(
      '@Briana ',
    );
  });

  // ★ Escape closes the PICKER and stops there — it must not also close the
  // modal out from under a half-typed message.
  it('★ Escape closes the picker without closing the modal', () => {
    openModal();
    const input = type('@d');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(screen.getByTestId('project-chat-modal')).toBeInTheDocument();
  });

  it('★ a selected mention posts as a resolved user id', async () => {
    openModal();
    const input = type('ping @bri');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0].body).toBe('ping @Briana');
    expect(mocks.posted[0].mentions).toEqual([BRIANA]);
  });

  // ★★ THE TWO-VIEWER ASSERTION. The same posted message, two people, one
  // notification — through the real bell builder, not a restatement of it.
  it('★ a selected mention notifies that person and nobody else', async () => {
    openModal();
    const input = type('ping @bri');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));

    const asPosted = [
      {
        id: 'm-new',
        project_id: 'p-1',
        body: mocks.posted[0].body,
        created_at: AFTER_EPOCH,
        mentions: mocks.posted[0].mentions,
      },
    ];
    const base = { flips: [], tasks: [], acks: [], permits: [], projects: [] };
    const forBriana = buildNewItems({
      ...base,
      viewerName: 'Briana',
      viewerUserId: BRIANA,
      mentions: asPosted,
    });
    const forBobby = buildNewItems({
      ...base,
      viewerName: 'Bobby',
      viewerUserId: BOBBY,
      mentions: asPosted,
    });
    expect(forBriana.filter((i) => i.source === 'mention')).toHaveLength(1);
    expect(forBobby.filter((i) => i.source === 'mention')).toHaveLength(0);
  });

  // ★★ THE HONESTY RULE. `@mi` used to look like a mention and silently notify
  // nobody. It still posts — as plain text, which is truthful — but the composer
  // says so before Send and the rendered body does not tint it.
  it('★ an unresolved @word warns, is not styled as a mention, and notifies nobody', async () => {
    openModal();
    type('@mi look at this');
    expect(screen.getByTestId('project-chat-unresolved').textContent).toMatch(
      /@mi.*matches nobody/i,
    );
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0].mentions).toEqual([]);
    // And nothing in that body would render tinted.
    expect(splitBody('@mi look at this', PEOPLE).some((s) => s.mention)).toBe(false);
  });

  it('a fully resolved draft shows no warning', () => {
    openModal();
    type('@Miles please look');
    expect(screen.queryByTestId('project-chat-unresolved')).toBeNull();
  });

  it('★ former staff never appear in the picker', () => {
    mocks.people = [...PEOPLE, NIDHI_PERSON];
    mocks.members = [
      member({ name: 'Nidhi', email: 'nidhi@x.com', active: false, former: true }),
    ];
    openModal();
    type('@n');
    // Either the list closed (nobody matches) or Nidhi is absent from it.
    expect(screen.queryByTestId(`mention-option-${NIDHI}`)).toBeNull();
  });
});

// ------------------------------------------------- create task, chosen permit

describe('fix-330: creating a task chooses its permit', () => {
  beforeEach(() => {
    mocks.messages = [message({ id: 'm-7', body: 'chase the survey' })];
  });

  it('★ the chooser shows number AND type, so two permits are distinguishable', () => {
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    const select = screen.getByTestId('chat-task-m-7-permit') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['7133442-CN · Building Permit', '7133443-DM · Demolition']);
  });

  it('defaults to the anchor — the lowest-id Building Permit', () => {
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    expect((screen.getByTestId('chat-task-m-7-permit') as HTMLSelectElement).value).toBe(
      '12',
    );
  });

  // ★★ THE ASSERTION THE BRIEF ASKS FOR BY NAME: two permits, choose the
  // SECOND, and the task lands on THAT one.
  it('★ choosing the second permit puts the task on THAT permit', () => {
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    fireEvent.change(screen.getByTestId('chat-task-m-7-permit'), {
      target: { value: '21' },
    });
    fireEvent.click(screen.getByTestId('chat-task-create-m-7'));
    expect(mocks.created).toHaveLength(1);
    expect(mocks.created[0].permitId).toBe(21);
    expect(mocks.created[0].messageId).toBe('m-7');
  });

  it('★ the assignee and due date are the person\'s to set', () => {
    // 'Jade' is a bare roster person no role option resolves to, so fix-231's
    // de-dupe keeps her as a "Specific person" option. (Miles would be dropped:
    // this permit's ent_lead is Miles, so "Entitlements · Miles" already covers
    // him.)
    mocks.members = [member({ name: 'Cam' }), member({ name: 'Jade', role: 'dm' })];
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    fireEvent.change(screen.getByTestId('chat-task-m-7-primary-select'), {
      target: { value: 'Jade' },
    });
    // TaskDateField renders a muted "—" until it is clicked (fix-229).
    fireEvent.click(screen.getByTestId('chat-task-m-7-due-empty'));
    const date = screen.getByTestId('chat-task-m-7-due');
    fireEvent.change(date, { target: { value: '2026-09-01' } });
    fireEvent.blur(date);
    fireEvent.click(screen.getByTestId('chat-task-create-m-7'));
    expect(mocks.created[0]).toMatchObject({
      assignedTo: 'Jade',
      targetDate: '2026-09-01',
    });
  });

  // fix-244: the Design-view column follows the TEAM, and a chat-born task is
  // no exception.
  it('★ the discipline follows the chosen team (fix-244)', () => {
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    fireEvent.change(screen.getByTestId('chat-task-m-7-primary-select'), {
      target: { value: 'Schematic Team' },
    });
    fireEvent.click(screen.getByTestId('chat-task-create-m-7'));
    expect(mocks.created[0].discipline).toBe('arch');
  });

  it('the text is pre-filled from the message and editable', () => {
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    const text = screen.getByTestId('chat-task-m-7-text') as HTMLInputElement;
    expect(text.value).toBe('chase the survey');
    fireEvent.change(text, { target: { value: 'Chase the survey with the city' } });
    fireEvent.click(screen.getByTestId('chat-task-create-m-7'));
    expect(mocks.created[0].text).toBe('Chase the survey with the city');
  });

  it('Cancel writes nothing', () => {
    openModal(TWO_PERMITS);
    fireEvent.click(screen.getByTestId('project-chat-create-task-m-7'));
    fireEvent.click(screen.getByTestId('chat-task-cancel-m-7'));
    expect(screen.queryByTestId('chat-task-composer-m-7')).toBeNull();
    expect(mocks.created).toHaveLength(0);
  });

  it('a project with no permits explains why it cannot be used (fix-329, kept)', () => {
    openModal([]);
    const btn = screen.getByTestId('project-chat-create-task-m-7') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/no permit/i);
  });

  // ★ The last hop, made visible: the thread names the permit the task landed
  // on and links to it, instead of asserting that it went somewhere.
  it('★ the link-back names the permit the task landed on', () => {
    mocks.messages = [
      message({
        id: 'm-9',
        task_id: 't-1',
        task_text: 'Chase the survey',
        task_permit_id: 21,
      }),
    ];
    openModal(TWO_PERMITS);
    const link = screen.getByTestId('project-chat-task-permit-m-9');
    expect(link.textContent).toBe('7133443-DM · Demolition');
    expect(link.getAttribute('href')).toBe('/project/p-1?permit=21');
  });

  it('labels a permit with no number yet without a dangling separator', () => {
    expect(permitChoiceLabel({ num: null, type: 'ULS' })).toBe('ULS (no number yet)');
    expect(permitChoiceLabel({ num: ' ', type: null })).toBe('Permit (no number yet)');
  });
});

// ------------------------------------------------------------- attachments --

describe('fix-330: attachments and snips', () => {
  // ★★ THE PLACEHOLDER THIS TICKET EXISTS TO ERASE.
  it('★ the attach control is live and says nothing about "coming later"', () => {
    openModal();
    const attach = screen.getByTestId('project-chat-attach') as HTMLButtonElement;
    expect(attach).not.toBeDisabled();
    expect(attach.textContent).not.toMatch(/coming later/i);
    expect(screen.getByTestId('project-chat-file-input')).toBeInTheDocument();
  });

  it('★ the limits are stated before anything is picked', () => {
    openModal();
    expect(
      screen.getByTestId('project-chat-attach').getAttribute('title'),
    ).toMatch(/5 files.*25 MB/i);
  });

  // ★ A snip is Ctrl+V, and that is how Bobby said he will use this.
  it('★ pasting an image attaches it', () => {
    openModal();
    const input = screen.getByTestId('project-chat-input');
    fireEvent.paste(input, { clipboardData: { files: [imageFile()] } });
    expect(screen.getByTestId('project-chat-pending-snip.png')).toBeInTheDocument();
  });

  it('★ a pasted snip rides out with the message', async () => {
    openModal();
    fireEvent.paste(screen.getByTestId('project-chat-input'), {
      clipboardData: { files: [imageFile()] },
    });
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0].files?.map((f) => f.name)).toEqual(['snip.png']);
  });

  // ★ A snip with no words is a message. The DB CHECK agrees.
  it('★ an attachment-only message can be sent', async () => {
    openModal();
    expect(screen.getByTestId('project-chat-send')).toBeDisabled();
    fireEvent.paste(screen.getByTestId('project-chat-input'), {
      clipboardData: { files: [imageFile()] },
    });
    expect(screen.getByTestId('project-chat-send')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('project-chat-send'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.posted[0].body).toBe('');
  });

  it('the file picker attaches too', () => {
    openModal();
    fireEvent.change(screen.getByTestId('project-chat-file-input'), {
      target: { files: [imageFile('plans.pdf', 4096, 'application/pdf')] },
    });
    expect(screen.getByTestId('project-chat-pending-plans.pdf')).toBeInTheDocument();
  });

  it('a pending attachment can be removed before sending', async () => {
    openModal();
    fireEvent.paste(screen.getByTestId('project-chat-input'), {
      clipboardData: { files: [imageFile()] },
    });
    fireEvent.click(screen.getByTestId('project-chat-pending-remove-snip.png'));
    expect(screen.queryByTestId('project-chat-pending-snip.png')).toBeNull();
  });

  // ★★ A REJECTED FILE SAYS WHY — naming the file and the limit it broke.
  it('★ an oversized file is refused with the reason shown', () => {
    openModal();
    const huge = new File(['x'], 'plans.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });
    fireEvent.change(screen.getByTestId('project-chat-file-input'), {
      target: { files: [huge] },
    });
    const msg = screen.getByTestId('project-chat-attach-rejected').textContent ?? '';
    expect(msg).toContain('plans.pdf');
    expect(msg).toMatch(/25\.0 MB/);
    expect(screen.queryByTestId('project-chat-pending-plans.pdf')).toBeNull();
  });

  it('★ a wrong-type file is refused with the reason shown', () => {
    openModal();
    fireEvent.change(screen.getByTestId('project-chat-file-input'), {
      target: { files: [new File(['x'], 'evil.exe', { type: 'application/x-msdownload' })] },
    });
    const msg = screen.getByTestId('project-chat-attach-rejected').textContent ?? '';
    expect(msg).toContain('evil.exe');
    expect(msg).toMatch(/image, PDF, text, CSV, Word or Excel/i);
  });

  it(`★ more than ${MAX_ATTACHMENTS_PER_MESSAGE} files is refused with the reason shown`, () => {
    openModal();
    const six = Array.from({ length: 6 }, (_, i) => imageFile(`s${i}.png`));
    fireEvent.change(screen.getByTestId('project-chat-file-input'), {
      target: { files: six },
    });
    expect(screen.getByTestId('project-chat-attach-rejected').textContent).toMatch(
      /Up to 5 files/i,
    );
    expect(screen.getAllByTestId(/^project-chat-pending-s/)).toHaveLength(5);
  });

  // ★ Rendered in the modal…
  it('★ an image attachment renders as a thumbnail in the modal', () => {
    mocks.messages = [
      message({
        id: 'm-att',
        attachments: [
          { path: 'p-1/u1/snip.png', name: 'snip.png', mime: 'image/png', size: 2048 },
        ],
      }),
    ];
    openModal();
    const card = screen.getByTestId('chat-attachment-p-1/u1/snip.png');
    expect(card.dataset.kind).toBe('image');
    expect(card.getAttribute('href')).toBe('https://signed.example/x');
    expect(within(card).getByRole('img').getAttribute('src')).toBe(
      'https://signed.example/x',
    );
  });

  it('a non-image renders as a named file, not a broken image', () => {
    mocks.messages = [
      message({
        id: 'm-att',
        attachments: [
          { path: 'p-1/u1/plans.pdf', name: 'plans.pdf', mime: 'application/pdf', size: 11 * 1024 * 1024 },
        ],
      }),
    ];
    openModal();
    const card = screen.getByTestId('chat-attachment-p-1/u1/plans.pdf');
    expect(card.dataset.kind).toBe('file');
    expect(card.textContent).toContain('plans.pdf');
    expect(card.textContent).toContain('11.0 MB');
    expect(within(card).queryByRole('img')).toBeNull();
  });

  // ★ …and in the rail.
  it('★ an attachment shows on the rail card too', () => {
    mocks.messages = [
      message({
        id: 'm-att',
        body: '',
        attachments: [
          { path: 'p-1/u1/snip.png', name: 'snip.png', mime: 'image/png', size: 2048 },
        ],
      }),
    ];
    renderCard();
    expect(
      within(screen.getByTestId('project-chat-mini')).getByTestId(
        'chat-attachment-compact-p-1/u1/snip.png',
      ).textContent,
    ).toContain('snip.png');
  });

  // A signature that could not be minted says so rather than rendering a dead
  // thumbnail, which would read as a corrupt file.
  it('an attachment that cannot be signed says so', () => {
    mocks.signedError = new Error('nope');
    mocks.messages = [
      message({
        id: 'm-att',
        attachments: [
          { path: 'p-1/u1/snip.png', name: 'snip.png', mime: 'image/png', size: 2048 },
        ],
      }),
    ];
    openModal();
    expect(
      screen.getByTestId('chat-attachment-pending-p-1/u1/snip.png').textContent,
    ).toMatch(/could not open/i);
  });
});

// -------------------------------------------------------- the rules, pinned --

describe('fix-330: the attachment rules', () => {
  it('refuses for one reason at a time, and says which', () => {
    expect(rejectionReason({ name: 'a.png', type: 'image/png', size: 10 }, 0)).toBeNull();
    expect(
      rejectionReason({ name: 'a.png', type: 'image/png', size: 10 }, MAX_ATTACHMENTS_PER_MESSAGE),
    ).toMatch(/Up to 5 files/);
    expect(rejectionReason({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }, 0))
      .toMatch(/a\.exe/);
    expect(
      rejectionReason({ name: 'a.png', type: 'image/png', size: MAX_ATTACHMENT_BYTES + 1 }, 0),
    ).toMatch(/25\.0 MB/);
    expect(rejectionReason({ name: 'a.png', type: 'image/png', size: 0 }, 0)).toMatch(/empty/);
  });

  // ★★ THE PATH IS THE PERMISSION. A filename containing a slash would
  // re-parent the object out of the project folder the storage policy reads the
  // tenant from.
  it('★ a hostile filename cannot escape the project folder', () => {
    expect(sanitizeFileName('../../etc/passwd')).not.toContain('/');
    const path = attachmentPath('p-1', 'u-1', '../../etc/passwd');
    expect(path.split('/')[0]).toBe('p-1');
    expect(path.split('/')).toHaveLength(3);
  });

  it('keeps a normal filename readable', () => {
    expect(sanitizeFileName('12836 - Marketing Plans.pdf')).toBe(
      '12836-Marketing-Plans.pdf',
    );
  });

  it('sizes read the way people say them', () => {
    expect(humanSize(900)).toBe('900 B');
    expect(humanSize(2048)).toBe('2 KB');
    expect(humanSize(11 * 1024 * 1024)).toBe('11.0 MB');
  });
});

// ------------------------------------------------------- schema contracts ---

describe('fix-330: the schema decisions, pinned', () => {
  // ★★ THE LIMIT THE BROWSER ENFORCES AND THE LIMIT THE BUCKET ENFORCES MUST BE
  // THE SAME LIMIT. A client check the bucket does not back is a lie; a bucket
  // limit the client does not know produces a 413 with no explanation.
  it('★ the size limit in TS matches the bucket', () => {
    expect(migrationSql).toContain(String(MAX_ATTACHMENT_BYTES));
  });

  it('★ every allowed type in TS is allowed by the bucket, and vice versa', () => {
    const block = migrationSql.slice(
      migrationSql.indexOf("INSERT INTO storage.buckets"),
      migrationSql.indexOf('ON CONFLICT (id) DO UPDATE'),
    );
    const inSql = [...block.matchAll(/'([a-z]+\/[a-zA-Z0-9.+-]+)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...ALLOWED_ATTACHMENT_TYPES].sort());
  });

  it('★ the per-message cap is a CHECK constraint, not only a UI rule', () => {
    expect(migrationSql).toMatch(
      new RegExp(`jsonb_array_length\\(attachments\\) <= ${MAX_ATTACHMENTS_PER_MESSAGE}`),
    );
  });

  // ★ The bucket is private. A public one would make an attachment the one
  // thing in this product readable by a stranger holding a URL.
  it('★ the bucket is private', () => {
    expect(migrationSql).toMatch(/'chat-attachments',\s*\n\s*false,/);
  });

  // ★★ THE ORPHAN STORY, enforced rather than described: no UPDATE or DELETE
  // policy on storage.objects for `authenticated`.
  it('★ authenticated can read and insert attachments, and nothing else', () => {
    expect(migrationSql).toMatch(/CREATE POLICY chat_attachments_tenant_read[\s\S]*?FOR SELECT TO authenticated/);
    expect(migrationSql).toMatch(/CREATE POLICY chat_attachments_tenant_insert[\s\S]*?FOR INSERT TO authenticated/);
    expect(migrationSql).not.toMatch(/FOR UPDATE TO authenticated/);
    expect(migrationSql).not.toMatch(/FOR DELETE TO authenticated/);
  });

  // ★ The tenant boundary is the FIRST PATH SEGMENT — the same test
  // plan-thumbnails already uses, not a second scheme.
  it('★ storage RLS keys the tenant off the project folder', () => {
    expect(migrationSql).toMatch(/split_part\(objects\.name, '\/', 1\)/);
    expect(migrationSql).toMatch(/p\.tenant_id = ANY \(public\.auth_tenant_ids\(\)\)/);
  });

  // ★ A snip with no words is a message; empty AND attachment-less still is not.
  it('★ the body CHECK admits an attachment-only message', () => {
    expect(migrationSql).toMatch(
      /CHECK \(length\(btrim\(body\)\) > 0 OR jsonb_array_length\(attachments\) > 0\)/,
    );
  });

  // fix-329's contract, re-asserted because a column was added to the table.
  it('★ project_messages is still append-only', () => {
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT ON TABLE public\.project_messages TO authenticated, service_role;/,
    );
    expect(migrationSql).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON public\.project_messages FROM authenticated;/,
    );
  });

  // ★ The root cause. The picker's names come from the roster, not from
  // profiles — and fix-321's rule is applied server-side too.
  it('★ mentionable names resolve through team_members.email', () => {
    expect(migrationSql).toMatch(/bp_profile_display_name/);
    expect(migrationSql).toMatch(/lower\(TRIM\(tm\.email\)\) = lower\(TRIM\(pr\.email\)\)/);
    expect(migrationSql).toMatch(/r\.active IS NOT FALSE/);
    expect(migrationSql).toMatch(/r\.former IS NOT TRUE/);
  });

  // ★ No second channel — fix-329's contract, still true.
  it('★ still one realtime channel', async () => {
    const realtime = (await import('../hooks/useRealtimeInvalidation.ts?raw')).default as string;
    expect(realtime.match(/supabase\.channel\(/g) ?? []).toHaveLength(1);
  });
});

// ------------------------------------------------ the placeholder is gone ---

describe('fix-330: no placeholder survives', () => {
  // ★★ The literal string this ticket exists to remove, hunted across the whole
  // source tree rather than in the one file it was last seen in.
  it('★ nothing in src/ renders "coming later"', async () => {
    const modules = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(modules)
      // The tests themselves may NAME the string they are hunting.
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => /coming later/i.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('★ and no disabled attach control is left anywhere', () => {
    openModal();
    const attach = screen.getByTestId('project-chat-attach');
    expect(attach.getAttribute('aria-disabled')).not.toBe('true');
    expect(attach).not.toBeDisabled();
  });
});

// Keeps the ChatAttachment shape honest against what the renderer reads.
describe('fix-330: the stored attachment shape', () => {
  it('is what the renderer expects', () => {
    const a: ChatAttachment = {
      path: 'p-1/u/x.png',
      name: 'x.png',
      mime: 'image/png',
      size: 1,
    };
    expect(Object.keys(a).sort()).toEqual(['mime', 'name', 'path', 'size']);
  });
});
