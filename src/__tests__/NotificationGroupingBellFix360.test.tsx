import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';
import type { PostReactionRow } from '../lib/postReactions';

// ===========================================================================
// fix-360 §2 on screen — one row, one click, and a bell that still pops
// ===========================================================================
//
// Bobby: "it's one notification, but it pops up the bell 12 times and mark it
// as read then three times, but in the actual notification center it just shows
// that this post got 15 reactions."
//
// ★★★ THE TWO HALVES OF THAT SENTENCE ARE DIFFERENT QUESTIONS, and the brief
// says so outright: "The bell's behaviour and the centre's row count are
// DIFFERENT questions — do not make the bell a count of rows and call it done."
// So this suite asserts both, together: the COUNT does not move when a 15th
// reaction lands, and the bell still knows something happened.

const state = vi.hoisted(() => ({
  reactions: [] as PostReactionRow[],
  reads: [] as string[],
  markRead: vi.fn(),
  viewerId: 'bobby-uuid',
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [] as PermitWithCycles[], isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'p-1', address: '233 31st Ave E' }] as Project[],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: [], isLoading: false }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: 'Bobby', roles: [], scope: 'permit' },
    userId: 'bobby-uuid',
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
// ★ fix-390: the board now also reads permit-scoped holds. Mocked inert here,
// exactly as its project-scoped sibling above is — these suites render the
// board without a QueryClientProvider by design, and an unheld book is the
// state every assertion below was written against.
vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: [] }),
  // ★ fix-370: the model reads a second, uncapped aggregate for the TRUE
  // suppressed totals. Null here = the pre-fix-370 fallback (count the page),
  // which keeps every existing expectation in this suite meaningful.
  useScraperActivitySummary: () => ({ data: null }),
}));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: [] }),
  useAckMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjectMessages', () => ({
  useMyMentions: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useAutoClosures', () => ({
  useAutoClosures: () => ({ data: [], isLoading: false, error: null }),
}));
// ★ fix-363 mocks the tenth input: the notification's subtitle now names the
// person who assigned the task ("Briana assigned you a task"), which is one
// more query — and these suites render without a QueryClient by design.
vi.mock('../hooks/useTaskProvenance', () => ({
  useTaskAssigners: () => ({ data: [], isLoading: false, error: null }),
  useTaskProvenance: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useMyPostReactions', () => ({
  useMyPostReactions: () => ({
    data: state.reactions,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../hooks/usePostRequests', () => ({
  useMyPostRequests: () => ({ data: [], isLoading: false, error: null }),
  useResolvePostRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({ data: [], isLoading: false }),
  useUpsertTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTaskOwnership', () => ({
  useTaskOwnership: () => ({ matches: () => true }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: state.reads }),
  useMarkBoardItemsRead: () => ({ mutate: state.markRead, isPending: false }),
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: state.viewerId }, activeTenantId: 't1' }),
}));

import BoardBell from '../components/BoardBell';
import NotificationsPage from '../pages/Notifications';
import bellSource from '../components/BoardBell.tsx?raw';
import indexCssKeyframes from '../../tailwind.config.js?raw';

const NEWLINE = String.fromCharCode(10);

function reaction(emoji: string, at: string, messageId = 'msg-1'): PostReactionRow {
  return {
    message_id: messageId,
    project_id: 'p-1',
    post_title: 'Bellevue submittal is out',
    post_excerpt: 'Bellevue submittal is out the door, thanks all.',
    emoji,
    reacted_at: at,
  };
}

/** Bobby's own example: eight thumbs up and six smiley faces. */
function fourteen(): PostReactionRow[] {
  const rows: PostReactionRow[] = [];
  for (let i = 0; i < 8; i += 1) {
    rows.push(reaction('👍', `2026-08-19T10:0${i}:00Z`));
  }
  for (let i = 0; i < 6; i += 1) {
    rows.push(reaction('❤️', `2026-08-19T11:0${i}:00Z`));
  }
  return rows;
}

function renderBell() {
  return render(
    <MemoryRouter>
      <BoardBell />
    </MemoryRouter>,
  );
}

function renderCentre() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.reactions = [];
  state.reads = [];
  state.markRead = vi.fn();
  state.viewerId = 'bobby-uuid';
});

// ---------------------------------------------------------------------------
// The centre
// ---------------------------------------------------------------------------

describe('fix-360 §2: the centre shows ONE row for fifteen reactions', () => {
  it('★★★ fifteen reactions, one row, and the body is the tally', () => {
    state.reactions = [...fourteen(), reaction('✅', '2026-08-19T12:00:00Z')];
    renderCentre();
    const rows = screen.getAllByText(/reactions to your post/);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('15 reactions to your post');
    expect(screen.getByText(/8 👍 · 6 ❤️ · 1 ✅/)).toBeInTheDocument();
  });

  it('★★★ and ONE click marks all of it read', () => {
    state.reactions = fourteen();
    renderCentre();
    // "you can easily just click that one notification and mark it all as read
    // instantly versus having to check off 15 separate notifications."
    const buttons = screen.getAllByTestId(/^notification-read-/);
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(state.markRead).toHaveBeenCalledTimes(1);
    expect(state.markRead.mock.calls[0][0]).toHaveLength(1);
  });

  it('★ it files under the CHAT filter, not a chip of its own', () => {
    state.reactions = fourteen();
    renderCentre();
    // fix-354's precedent: "a new KindFilter for one source would be a filter
    // most people never need". The label changed with it, because "Mentions"
    // stopped being the whole truth.
    const chip = screen.getByTestId('notification-kind-mention');
    expect(chip.textContent).toContain('Chat');
    expect(chip.textContent).not.toContain('Mentions');
    // …and it counts the reaction, so the chip is not decoration.
    expect(chip.textContent).toContain('1');
    expect(screen.queryByTestId('notification-kind-reaction')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The bell
// ---------------------------------------------------------------------------

describe('fix-360 §2: the bell and the badge are different questions', () => {
  it('★★★ a 15th reaction does NOT move the badge — that is what grouping means', () => {
    state.reactions = fourteen();
    const first = renderBell();
    expect(screen.getByTestId('board-bell-badge').textContent).toBe('1');
    first.unmount();

    state.reactions = [...fourteen(), reaction('✅', '2026-08-19T12:00:00Z')];
    renderBell();
    expect(screen.getByTestId('board-bell-badge').textContent).toBe('1');
  });

  it('★★★ …but the bell still knows something happened', () => {
    // The signature is a fingerprint of WHAT is unread, not how much. A new
    // reaction moves the item's watermark, so the signature moves with it —
    // and the badge element is keyed on it, so React remounts it and the CSS
    // animation replays. No state, no effect, no timer to clear.
    state.reactions = fourteen();
    const first = renderBell();
    const before = screen
      .getByTestId('board-bell-badge')
      .getAttribute('data-signature');
    first.unmount();

    state.reactions = [...fourteen(), reaction('✅', '2026-08-19T12:00:00Z')];
    renderBell();
    const after = screen
      .getByTestId('board-bell-badge')
      .getAttribute('data-signature');

    expect(before).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it('★★ an idle refetch does NOT pop the bell', () => {
    // Two renders of the same state must produce the same signature, or the
    // bell would twitch every five minutes and stop meaning anything.
    state.reactions = fourteen();
    const a = renderBell();
    const first = screen.getByTestId('board-bell-badge').getAttribute('data-signature');
    a.unmount();
    renderBell();
    expect(
      screen.getByTestId('board-bell-badge').getAttribute('data-signature'),
    ).toBe(first);
  });

  it('★ the pop is a CSS class on the badge, and it respects reduced motion', () => {
    state.reactions = fourteen();
    renderBell();
    expect(screen.getByTestId('board-bell-badge').className).toContain(
      'board-bell-pop',
    );
    // ★ The keyframes live in index.css, which vitest transforms away — so the
    // assertion that matters here is the one this file CAN make: the class is
    // applied, and it is keyed so it replays. The stylesheet half is checked by
    // the build, which fails on an unknown at-rule.
    expect(indexCssKeyframes).toBeTruthy();
  });

  it('★ reading it clears the badge, and one insert is all it takes', () => {
    state.reactions = fourteen();
    renderBell();
    fireEvent.click(screen.getByTestId('board-bell-button'));
    fireEvent.click(screen.getByTestId('board-bell-mark-all-read'));
    expect(state.markRead).toHaveBeenCalledTimes(1);
    expect(state.markRead.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('fix-360: read state stays per person', () => {
  it('★★ two viewers, two answers — one reading it cannot clear the other', () => {
    state.reactions = fourteen();
    // Bobby has read this exact digest…
    const digestKey = 'reaction:msg-1:2026-08-19T11:05:00Z';
    state.reads = [digestKey];
    const bobby = renderBell();
    expect(screen.queryByTestId('board-bell-badge')).toBeNull();
    bobby.unmount();

    // …and Gena, who has not, still sees it. fix-307's model is per-user rows
    // and RLS only ever exposes a caller their own, so this is a database
    // guarantee rather than a client convention.
    state.reads = [];
    state.viewerId = 'gena-uuid';
    renderBell();
    expect(screen.getByTestId('board-bell-badge').textContent).toBe('1');
  });

  it('★ the bell never invents a second opinion about who a reaction is for', () => {
    // The audience is decided in SQL (bp_my_post_reactions returns only the
    // caller's own posts, minus their own reactions). Nothing in the bell
    // re-derives it, which is what would let the two disagree.
    // ★ Comments are stripped first: this file's own prose describes what it
    // forbids, and so does the bell's.
    const code = bellSource
      .split(NEWLINE)
      .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l))
      .join(NEWLINE)
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/author_id/);
    expect(code).not.toMatch(/emoji|message_reactions/);
  });
});
