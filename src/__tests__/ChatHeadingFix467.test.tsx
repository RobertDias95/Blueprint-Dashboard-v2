import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  Permit,
  Project,
  ProjectMessage,
  TeamMember,
} from '../lib/database.types';

// ===========================================================================
// ★★★ fix-467 §1 (P-111) — THE CHAT HEADING SAYS WHICH PROJECT YOU ARE IN
// ===========================================================================
//
// Bobby: *"can we add the project address in the chat heading — when i am
// responding to chats from notifications it would be useful — also including
// the team in there, so you can see who is in the chat."*
//
// ★★ WHY IT BITES, AND IT IS AN ARGUMENT ABOUT ENTRY POINTS. fix-362 built the
// notification deep-link, so this modal opens OVER whatever screen you were on,
// from a bell you clicked. **The one entry point where you arrive knowing
// nothing was the one that told you least**: a literal "Project chat" over a
// post count, with no way to tell which project you had landed in without
// closing the modal you had just been sent to.
//
// ★ The address and jurisdiction copy the Project Overview's own heading shape
//   rather than inventing one, so the two screens name a project the same way.

const BOBBY = '11111111-1111-1111-1111-111111111111';
const BRIANA = '22222222-2222-2222-2222-222222222222';
const MILES = '33333333-3333-3333-3333-333333333333';
const STAMP = '2026-08-15T10:00:00Z';

const mocks = vi.hoisted(() => ({
  messages: [] as unknown[],
  projects: [] as unknown[],
  members: [] as unknown[],
}));

vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({
      data: mocks.messages,
      isLoading: false,
      error: null,
    }),
    useMentionablePeople: () => ({ data: [], isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
    usePostMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateTaskFromMessage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: mocks.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual, // the real rosterFullName path (fix-343)
    useTeamMembers: () => ({
      all: mocks.members,
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
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));

import ProjectChatModal from '../components/ProjectDetail/ProjectChatModal';

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: BRIANA,
    author_name: 'Briana',
    body: 'Builder says they are likely selling.',
    mentions: [],
    attachments: [],
    created_at: STAMP,
    task_id: null,
    task_text: null,
    task_permit_id: null,
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

function member(name: string, first: string, last: string): TeamMember {
  return {
    id: `tm-${name}`,
    name,
    first_name: first,
    last_name: last,
    role: 'ent',
    active: true,
  } as unknown as TeamMember;
}

const PROJECT = {
  id: 'p-1',
  address: '3505 Densmore Ave N',
  juris: 'Seattle',
} as unknown as Project;

const PERMIT = {
  id: 10,
  project_id: 'p-1',
  type: 'Building Permit',
  num: '7133442-CN',
} as unknown as Permit;

function renderModal() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectChatModal projectId="p-1" permits={[PERMIT]} onClose={() => {}} />,
    { wrapper },
  );
}

beforeEach(() => {
  mocks.messages = [];
  mocks.projects = [PROJECT];
  mocks.members = [
    member('Briana', 'Briana', 'Cortez'),
    member('Miles', 'Miles', 'Okafor'),
    member('Bobby', 'Bobby', 'Dias'),
  ];
});

// ---------------------------------------------------------------------------
// The heading
// ---------------------------------------------------------------------------
describe('fix-467 §1 — the heading', () => {
  it('★★★ renders the project ADDRESS, with the jurisdiction beneath it', () => {
    mocks.messages = [message()];
    renderModal();
    expect(screen.getByTestId('project-chat-title').textContent).toBe(
      '3505 Densmore Ave N',
    );
    // ★ The Project Overview's shape: address, then jurisdiction. Same words,
    //   same order, so the two screens name a project identically.
    expect(screen.getByTestId('project-chat-subtitle').textContent).toContain(
      'Seattle',
    );
  });

  it('★★ the post/message count is MOVED, not dropped', () => {
    // §1 said "keep the existing count — move it, don't drop it". It is the
    // only thing the header used to say that was actually about this chat.
    mocks.messages = [message(), message({ id: 'm-2' })];
    renderModal();
    const sub = screen.getByTestId('project-chat-subtitle').textContent ?? '';
    expect(sub).toContain('2 messages');
    expect(sub).toMatch(/\d+ post/);
  });

  it('★★★ falls back to "Project chat" while the project is still loading', () => {
    // `useProjects` has not resolved yet, so `project` is null. A heading that
    // flashes BLANK is worse than one that is briefly generic — and this is the
    // string the header has always shown, so the fallback is not a new state.
    mocks.projects = [];
    mocks.messages = [message()];
    renderModal();
    expect(screen.getByTestId('project-chat-title').textContent).toBe(
      'Project chat',
    );
    // ★ …and no orphan jurisdiction separator when there is no project.
    expect(screen.getByTestId('project-chat-subtitle').textContent).not.toContain(
      '—',
    );
  });

  it('★ a project with no jurisdiction recorded still renders a heading', () => {
    mocks.projects = [{ ...PROJECT, juris: null } as unknown as Project];
    mocks.messages = [message()];
    renderModal();
    expect(screen.getByTestId('project-chat-title').textContent).toBe(
      '3505 Densmore Ave N',
    );
    // The Overview's own em-dash placeholder, not a blank.
    expect(screen.getByTestId('project-chat-subtitle').textContent).toContain('—');
  });
});

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------
describe('fix-467 §1 — who is in the chat', () => {
  it('★★★ the participants are the DISTINCT AUTHORS of the posts and replies', () => {
    // ★★ THE DEFINITION, AND WHY IT IS THIS ONE: it is exactly who will see a
    //    reply. Three messages, two authors, one of them twice → two avatars.
    mocks.messages = [
      message({ id: 'm-1', author_id: BRIANA, author_name: 'Briana' }),
      message({ id: 'm-2', author_id: MILES, author_name: 'Miles' }),
      message({ id: 'm-3', author_id: BRIANA, author_name: 'Briana' }),
    ];
    renderModal();
    const box = screen.getByTestId('project-chat-participants');
    const avatars = within(box).getAllByTestId('chat-avatar');
    expect(avatars).toHaveLength(2);
    // ★ Initials via the fix-343 pair — rosterFullName then initialsOf — so
    //   "Briana" (the join key) becomes "Briana Cortez" becomes BC.
    expect(avatars.map((a) => a.textContent)).toEqual(['BC', 'MO']);
    // ★ Full name on hover: the circle is the only identity here, unlike a
    //   message row where the name is printed beside it.
    expect(avatars[0]!.getAttribute('title')).toBe('Briana Cortez');
  });

  it('★★ a project with NO posts renders nothing — not an empty row', () => {
    // fix-406's rule: absent beats present-and-empty.
    mocks.messages = [];
    renderModal();
    expect(screen.queryByTestId('project-chat-participants')).toBeNull();
  });

  it('★★ past five it collapses to +N, and the overflow names them on hover', () => {
    const names = ['Briana', 'Miles', 'Bobby', 'Cam', 'Derry', 'Ainsley', 'Trevor'];
    mocks.messages = names.map((n, i) =>
      message({ id: `m-${i}`, author_id: `a-${i}`, author_name: n }),
    );
    renderModal();
    const box = screen.getByTestId('project-chat-participants');
    expect(within(box).getAllByTestId('chat-avatar')).toHaveLength(5);
    const more = screen.getByTestId('project-chat-participants-overflow');
    expect(more.textContent).toBe('+2');
    // ★ Not a dead "+2": the list is complete even when it does not fit.
    expect(more.getAttribute('title')).toContain('Ainsley');
    expect(more.getAttribute('title')).toContain('Trevor');
  });

  it('★★★ PROPERTY: the participant list never contains an @ tag', () => {
    // ★★★ THE ASSERTION THAT PINS THE DEFINITION. `@project` and `@Corrections`
    //     are TAGS (fix-347), not people — a mention-derived list would put a
    //     word in a row of faces, and it would name somebody who has never
    //     opened the thread. Driven with messages that MENTION heavily and are
    //     authored by exactly one person: the answer must still be one avatar.
    mocks.messages = [
      message({
        id: 'm-1',
        author_id: BOBBY,
        author_name: 'Bobby',
        body: '@project @Corrections @Miles please look',
        mentions: [MILES, 'project', 'Corrections'],
      }),
    ];
    renderModal();
    const box = screen.getByTestId('project-chat-participants');
    const avatars = within(box).getAllByTestId('chat-avatar');
    expect(avatars).toHaveLength(1);
    expect(avatars[0]!.getAttribute('title')).toBe('Bobby Dias');
    // The property, stated over what actually rendered.
    expect(box.textContent).not.toContain('@');
    for (const tag of ['project', 'Corrections']) {
      expect(box.getAttribute('title') ?? '').not.toContain(tag);
    }
  });

  it('★ a message with no author names nobody', () => {
    mocks.messages = [
      message({ id: 'm-1', author_name: null }),
      message({ id: 'm-2', author_name: '  ' }),
      message({ id: 'm-3', author_name: 'Miles' }),
    ];
    renderModal();
    const avatars = within(
      screen.getByTestId('project-chat-participants'),
    ).getAllByTestId('chat-avatar');
    expect(avatars).toHaveLength(1);
    expect(avatars[0]!.textContent).toBe('MO');
  });
});
