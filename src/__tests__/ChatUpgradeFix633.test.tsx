import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { chatStamp, CHAT_STAMP_WEEK_DAYS } from '../lib/projectChat';
import type { Permit, ProjectMessage } from '../lib/database.types';

// fix-633 (P-327) — Dave's chat upgrade: twelve items in the chat pop-up.
//
// ★ What jsdom CAN see is asserted here: the timestamp rule (§6), landing on
//   the newest message (§3), poster-only actions on the name line (§7, §8),
//   the alternating shade (§4), the sidebar's shape (§10, §11), the reaction
//   button (§12) and the reply box's top handle (§2, §9) driven by keyboard.
// ★ What it CANNOT see — the modal's size, the avatars' size, where things sit
//   on screen — was checked in a real browser build (see the PR).

const ADMIN = '11111111-1111-1111-1111-111111111111';
const EDITOR = '22222222-2222-2222-2222-222222222222';
const POST_ID = 'post-1';

// ---------------------------------------------------------------- fixtures --

function post(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: POST_ID,
    project_id: 'p-1',
    parent_message_id: null,
    title: 'Design Phase',
    author_id: ADMIN,
    author_name: 'Bobby',
    body: 'Design through intake.',
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
  const noop = () => ({ mutate: vi.fn(), isPending: false });
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
    usePostMessage: noop,
    useEditMessage: noop,
    useDeleteMessage: noop,
    useCreateTaskFromMessage: noop,
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

const PERMITS = [
  { id: 12, project_id: 'p-1', type: 'Building Permit', num: '7133442-CN', da: 'Cam', ent_lead: 'Miles' },
] as unknown as Permit[];

function renderModal(focusMessageId: string | null = null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectChatModal
      projectId="p-1"
      permits={PERMITS as never}
      focusMessageId={focusMessageId}
      onClose={vi.fn()}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  mocks.messages = [post()];
  mocks.isAdmin = true;
  mocks.userId = ADMIN;
});

// ===========================================================================
// §6 — under a week: weekday + time. A week or older: M/D/YYYY.
// ===========================================================================
//
// ★ Every date below is built from LOCAL fields, so the boundary is the same
//   in whatever zone the runner is in (CI has no TZ).

describe('fix-633 §6: the stamp turns into a date once a message is a week old', () => {
  const at = (y: number, m: number, d: number, h = 12, min = 0) =>
    new Date(y, m - 1, d, h, min).toISOString();

  it("★ Dave's own example: this Monday is a weekday, last Monday is 9/28/2026", () => {
    const sat = new Date(2026, 9, 10, 12, 0); // Sat 10 Oct 2026
    expect(chatStamp(at(2026, 10, 5, 15, 15), sat)).toMatch(/^Mon/);
    expect(chatStamp(at(2026, 10, 5, 15, 15), sat)).toMatch(/3:15/);
    expect(chatStamp(at(2026, 9, 28, 15, 15), sat)).toBe('9/28/2026');
  });

  it('★★ the boundary: 6 calendar days is a weekday, 7 is a date', () => {
    expect(CHAT_STAMP_WEEK_DAYS).toBe(7);
    const mon = new Date(2026, 9, 12, 9, 0); // Mon 12 Oct, 09:00
    // Tue 6 Oct, the last minute of it — 6 days back.
    expect(chatStamp(at(2026, 10, 6, 23, 59), mon)).toMatch(/^Tue/);
    // Mon 5 Oct, the first minute — 7 days back.
    expect(chatStamp(at(2026, 10, 5, 0, 1), mon)).toBe('10/5/2026');
  });

  it('★★ counted in calendar days, not hours: last Monday afternoon is NOT "Mon"', () => {
    // 6 days 17 hours ago. An hours rule would say "Mon 4:00 PM" — the same
    // word as today, a week apart.
    const mon = new Date(2026, 9, 12, 9, 0);
    expect(chatStamp(at(2026, 10, 5, 16, 0), mon)).toBe('10/5/2026');
  });

  it('today, and a stamp from the future (clock skew), read as recent', () => {
    const mon = new Date(2026, 9, 12, 9, 0);
    expect(chatStamp(at(2026, 10, 12, 8, 0), mon)).toMatch(/^Mon/);
    expect(chatStamp(at(2026, 10, 13, 8, 0), mon)).not.toContain('/');
  });

  it('a week across the DST change is still a week', () => {
    // US clocks fall back on Sun 1 Nov 2026; this week has a 25-hour day.
    const sat = new Date(2026, 10, 7, 10, 0);
    expect(chatStamp(at(2026, 10, 31, 23, 30), sat)).toBe('10/31/2026');
    expect(chatStamp(at(2026, 11, 1, 0, 30), sat)).toMatch(/^Sun/);
  });

  it('the date has no leading zeros and a four-digit year', () => {
    const later = new Date(2027, 0, 20, 12, 0);
    expect(chatStamp(at(2027, 1, 3), later)).toBe('1/3/2027');
  });
});

// ===========================================================================
// §3 — opening a post lands on the newest message; the list order is untouched
// ===========================================================================

describe('fix-633 §3: opening a post lands on the newest message', () => {
  // jsdom has no layout: give every element a height and record scrollTop.
  const tops = new WeakMap<Element, number>();
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 900,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0;
      },
      set(this: Element, v: number) {
        tops.set(this, v);
      },
    });
  });
  afterAll(() => {
    // Back to the Element.prototype accessors.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTop;
  });

  const lifecycle = () => [
    // ACQ is the OLDEST activity; Design Phase moved last.
    post({ id: 'acq', title: 'ACQ Questions', created_at: '2026-08-01T09:00:00Z' }),
    post(),
    reply({ id: 'r-1', body: 'first' }),
    reply({ id: 'r-2', body: 'newest', created_at: '2026-08-15T11:00:00Z' }),
  ];

  it('★ the opened thread is scrolled to its bottom — the newest reply', () => {
    mocks.messages = lifecycle();
    renderModal();
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent('Design Phase');
    expect(screen.getByTestId('project-chat-thread').scrollTop).toBe(900);
  });

  it('★ and opening another post lands that one on its newest too', () => {
    mocks.messages = lifecycle();
    renderModal();
    fireEvent.click(screen.getByTestId('project-chat-post-acq'));
    expect(screen.getByTestId('project-chat-post-title')).toHaveTextContent('ACQ Questions');
    expect(screen.getByTestId('project-chat-thread').scrollTop).toBe(900);
  });

  it('★★★ the sidebar ORDER is still lifecycle (P-145) — only the scroll changed', () => {
    mocks.messages = lifecycle();
    renderModal();
    const rows = within(screen.getByTestId('project-chat-post-list'))
      .getAllByRole('button')
      .map((b) => b.dataset.testid);
    expect(rows.slice(0, 2)).toEqual(['project-chat-post-acq', `project-chat-post-${POST_ID}`]);
  });

  it('★ a message named by a deep link wins over the newest', () => {
    mocks.messages = lifecycle();
    renderModal('r-1');
    expect(screen.getByTestId('project-chat-message-r-1').dataset.focused).toBe('true');
    expect(screen.getByTestId('project-chat-thread').scrollTop).toBe(0);
  });
});

// ===========================================================================
// §7 + §8 — the poster's buttons, on the name line; nobody else gets any
// ===========================================================================

describe('fix-633 §7 + §8: only the poster has action buttons, on the name line', () => {
  beforeEach(() => {
    mocks.messages = [
      post(), // by Bobby
      reply({ id: 'mine', body: 'my reply' }), // by Briana
    ];
    mocks.userId = EDITOR;
    mocks.isAdmin = false;
  });

  it("★★ someone else's message has NO action buttons — not even Create task", () => {
    renderModal();
    expect(screen.queryByTestId(`project-chat-actions-${POST_ID}`)).toBeNull();
    expect(screen.queryByTestId(`project-chat-create-task-${POST_ID}`)).toBeNull();
    expect(screen.queryByTestId(`project-chat-edit-${POST_ID}`)).toBeNull();
    expect(screen.queryByTestId(`project-chat-delete-${POST_ID}`)).toBeNull();
  });

  it('★ your own message has all three', () => {
    renderModal();
    const actions = screen.getByTestId('project-chat-actions-mine');
    expect(within(actions).getByTestId('project-chat-create-task-mine')).toBeInTheDocument();
    expect(within(actions).getByTestId('project-chat-edit-mine')).toBeInTheDocument();
    expect(within(actions).getByTestId('project-chat-delete-mine')).toBeInTheDocument();
  });

  it('★ they sit on the name/time line, above the message body', () => {
    renderModal();
    const actions = screen.getByTestId('project-chat-actions-mine');
    const nameLine = actions.parentElement!;
    expect(nameLine).toHaveTextContent('Briana');
    expect(nameLine).not.toHaveTextContent('my reply');
    const body = screen.getByText('my reply');
    expect(
      nameLine.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('"Add a task" under the reply box is still there for everyone', () => {
    renderModal();
    expect(screen.getByTestId('project-chat-toggle-task')).toBeInTheDocument();
  });
});

// ===========================================================================
// §4 — alternating shade
// ===========================================================================

describe('fix-633 §4: every other reply is shaded', () => {
  it('replies alternate unshaded / shaded', () => {
    mocks.messages = [
      post(),
      reply({ id: 'a', created_at: '2026-08-15T10:00:00Z' }),
      reply({ id: 'b', created_at: '2026-08-15T10:01:00Z' }),
      reply({ id: 'c', created_at: '2026-08-15T10:02:00Z' }),
    ];
    renderModal();
    const shade = (id: string) => screen.getByTestId(`project-chat-message-${id}`).dataset.shaded;
    expect([shade('a'), shade('b'), shade('c')]).toEqual(['false', 'true', 'false']);
    expect(screen.getByTestId('project-chat-message-b').style.background).toContain('--color-s2');
  });

  it('★★ fix-638 §B (P-334): every message is bordered — the post, white rows and shaded rows', () => {
    mocks.messages = [
      post(),
      reply({ id: 'a', created_at: '2026-08-15T10:00:00Z' }),
      reply({ id: 'b', created_at: '2026-08-15T10:01:00Z' }),
    ];
    renderModal();
    const rows = screen.getAllByTestId(/^project-chat-message-/);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.className).toContain('border');
      expect(row.className).toContain('border-border');
      expect(row.style.borderRadius).toBe('8px');
    }
    // the shading still alternates on top of the border
    expect(screen.getByTestId('project-chat-message-a').dataset.shaded).toBe('false');
    expect(screen.getByTestId('project-chat-message-b').dataset.shaded).toBe('true');
  });
});

// ===========================================================================
// §10 + §11 — the sidebar
// ===========================================================================

describe('fix-633 §10 + §11: the sidebar', () => {
  beforeEach(() => {
    mocks.messages = [
      post({ id: 'acq', title: 'ACQ Questions', created_at: '2026-08-01T09:00:00Z' }),
      post(),
      reply({ id: 'r-1' }),
      reply({ id: 'r-2' }),
    ];
  });

  it('★ §10: the "author · N replies · time" line is gone; a count sits beside the title', () => {
    renderModal();
    const row = screen.getByTestId(`project-chat-post-${POST_ID}`);
    expect(row).not.toHaveTextContent(/repl(y|ies)/);
    expect(row).not.toHaveTextContent('Bobby');
    expect(row.textContent).toBe('Design Phase3');
    expect(screen.getByTestId(`project-chat-post-count-${POST_ID}`)).toHaveTextContent('3');
    expect(screen.getByTestId('project-chat-post-count-acq')).toHaveTextContent('1');
  });

  it('§11: a "Posts" heading, + New post after the last post, search at the foot', () => {
    renderModal();
    expect(screen.getByTestId('project-chat-posts-heading')).toHaveTextContent('Posts');
    const list = screen.getByTestId('project-chat-post-list');
    const newPost = within(list).getByTestId('project-chat-new-post');
    const lastRow = screen.getByTestId(`project-chat-post-${POST_ID}`);
    expect(
      lastRow.compareDocumentPosition(newPost) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const aside = screen.getByTestId('project-chat-posts');
    const dock = screen.getByTestId('project-chat-search-dock');
    expect(aside.lastElementChild).toBe(dock);
    expect(within(dock).getByTestId('project-chat-search')).toBeInTheDocument();
  });

  it('§11: a non-admin gets "Request a post" in the same place', () => {
    mocks.isAdmin = false;
    renderModal();
    const list = screen.getByTestId('project-chat-post-list');
    expect(within(list).getByTestId('project-chat-request-post')).toBeInTheDocument();
  });

  it('the heading says "Search results" while searching', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('project-chat-search'), {
      target: { value: 'design' },
    });
    expect(screen.getByTestId('project-chat-posts-heading')).toHaveTextContent('Search results');
  });
});

// ===========================================================================
// §12 — the reaction button is just the emoji
// ===========================================================================

describe('fix-633 §12: the reaction button shows just the emoji', () => {
  it('no "+" on it, and it still says what it does', () => {
    renderModal();
    const btn = screen.getByTestId(`chat-react-open-${POST_ID}`);
    expect(btn.textContent).toBe('☺');
    expect(btn.getAttribute('aria-label')).toBe('Add a reaction');
  });
});

// ===========================================================================
// §2 + §9 — the reply box starts taller and is sized from its top edge
// ===========================================================================

describe('fix-633 §2 + §9: the reply box', () => {
  it('★ starts about five lines tall, with no browser corner handle', () => {
    renderModal();
    const box = screen.getByTestId('project-chat-input') as HTMLTextAreaElement;
    expect(box.style.height).toBe('112px');
    expect(box.style.resize).toBe('none');
  });

  it('★ the handle is on the TOP edge, and "up" makes it taller, within limits', () => {
    renderModal();
    const handle = screen.getByTestId('project-chat-input-resize-top');
    const box = screen.getByTestId('project-chat-input') as HTMLTextAreaElement;
    // The handle comes before the textarea — the top edge.
    expect(
      handle.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(box.style.height).toBe('128px');
    for (let i = 0; i < 40; i++) fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(box.style.height).toBe('360px'); // max
    for (let i = 0; i < 40; i++) fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(box.style.height).toBe('58px'); // min
  });

  it('the edit box keeps the browser handle (only the reply box moved)', () => {
    mocks.messages = [post()];
    renderModal();
    fireEvent.click(screen.getByTestId(`project-chat-edit-${POST_ID}`));
    const edit = screen.getByTestId(`project-chat-edit-input-${POST_ID}`) as HTMLTextAreaElement;
    expect(edit.style.resize).toBe('vertical');
    expect(screen.queryByTestId(`project-chat-edit-input-${POST_ID}-resize-top`)).toBeNull();
  });
});
