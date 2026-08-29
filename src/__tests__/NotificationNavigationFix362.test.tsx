import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';
import type { PostReactionRow } from '../lib/postReactions';

// ===========================================================================
// fix-362 §5 — navigating marks THAT item read, and nothing else
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
// ★★ fix-438 mocks the TENTH board source, for the same reason as the eighth
// and the ninth above: this suite renders without a QueryClientProvider, so a
// real react-query hook throws "No QueryClient set" before anything is
// asserted. `useAcknowledgeCondition` is mocked with it because BoardBell
// calls it unconditionally to render the "I know" control.
vi.mock('../hooks/usePermitConditions', () => ({
  usePermitConditions: () => ({ data: [], isLoading: false, error: null }),
  useAcknowledgeCondition: () => ({ mutate: vi.fn(), isPending: false }),
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

import NotificationsPage from '../pages/Notifications';
import bellSource from '../components/BoardBell.tsx?raw';
import centreSource from '../pages/Notifications.tsx?raw';

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


// ===========================================================================
// ★★ fix-362 §5 — DOES CLICKING THROUGH MARK IT READ? Yes, and it is a
// DECISION, written down rather than assumed.
// ===========================================================================
//
// fix-307's rule is "seeing it is not doing it": reading a notification never
// ticks off the work, and that stands. But arriving at the thing is the
// strongest available evidence that you have seen the notification, and the
// stated goal is fewer manual check-offs.
//
// ★★ So: following a notification marks THAT item read. It does not complete a
// task, acknowledge a milestone, or resolve anything — and the tests below are
// what would fail if a later ticket blurred that line.

describe('fix-362 §5: following a notification marks it read', () => {
  it('★★ the link marks exactly that one key', () => {
    state.reactions = fourteen();
    renderCentre();
    const link = screen.getByTestId(/^notification-link-reaction:/);
    fireEvent.click(link);
    expect(state.markRead).toHaveBeenCalledTimes(1);
    expect(state.markRead.mock.calls[0][0]).toHaveLength(1);
    expect(state.markRead.mock.calls[0][0][0]).toMatch(/^reaction:msg-1:/);
  });

  it('★★★ …and marks NOTHING else — not the task, not the milestone', () => {
    // The mutation this fires writes to `board_item_reads` and nowhere else.
    // Asserted on the SOURCE rather than by counting mocks, because "it happens
    // not to call anything else today" is a weaker claim than "there is nothing
    // else it could call".
    expect(centreSource).not.toMatch(/useUpsertTask|useAckMilestone|useSetTask/);
    expect(bellSource).not.toMatch(/useUpsertTask|useAckMilestone|useSetTask/);
  });

  it('★ an ALREADY-READ item is not re-marked on the way through', () => {
    state.reactions = fourteen();
    state.reads = ['reaction:msg-1:2026-08-19T11:05:00Z'];
    renderCentre();
    const link = screen.getByTestId(/^notification-link-reaction:/);
    fireEvent.click(link);
    expect(state.markRead).not.toHaveBeenCalled();
  });

  it('★★ a SHARED item is NOT marked by going to look at it', () => {
    // fix-339's rule, and fix-362 must not quietly overturn it: a shared item
    // is OUTSTANDING FOR EVERYONE, so looking is not answering. It is resolved
    // by a different control with a different name.
    const code = centreSource
      .split(NEWLINE)
      .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l))
      .join(NEWLINE);
    expect(code).toMatch(/audience !== 'shared' && unread/);
  });
});

describe('fix-362: the bell and the centre send you to the same place', () => {
  it('★★ both build the link with the one shared function', () => {
    // Two copies of a routing rule is how the bell and the centre start
    // disagreeing about the same row — fix-329's failure, which fix-360 had to
    // hold again.
    expect(bellSource).toMatch(/targetHref\(i\)/);
    expect(centreSource).toMatch(/targetHref\(i\)/);
    // ★ And neither still carries the old inline expression.
    for (const src of [bellSource, centreSource]) {
      expect(src).not.toMatch(/\/project\/\$\{i\.projectId\}/);
    }
  });

  it('★★★ a reaction notification links to the post, from the centre', () => {
    state.reactions = fourteen();
    renderCentre();
    const link = screen.getByTestId(/^notification-link-reaction:/) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/project/p-1?msg=msg-1');
  });
});
