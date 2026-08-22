import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermitWithCycles, Project } from '../lib/database.types';
// ★ The palette claim is checked against MY BOARD'S source rather than the
// stylesheet: vitest transforms CSS imports away, so `?raw` on index.css comes
// back empty and any assertion on it would pass vacuously. Reading the other
// surface is the better check anyway — the claim is not "this token exists", it
// is "the bell reuses the token that already means this here".
import myBoardSrc from '../pages/MyBoard.tsx?raw';

// fix-335 §9 — an unread notification has to LOOK unread.
//
// Bobby: "The new notifications aren't really standing out. We want a way that
// makes them look unread and read — whether it is a color fill over the
// notification etc."
//
// ★ HE IS DESCRIBING THIS PANEL. Every row in the bell — "Where you stand",
// "New", "Not shown" — was the same weight on the same white, so the only thing
// marking these particular rows as news was the 8px word "New" above them. The
// section heading was doing all the work, which is exactly what a heading
// cannot do at a glance.
//
// ★★ AND THE READ HALF IS THE HARDER HALF. `unseen` contains only unread items
// by construction, so acknowledging one made it VANISH under the cursor —
// neither a read state nor a confirmation. "Look unread and read" needs both on
// screen, so a row read while the panel is open now stays put, dimmed.

const state = vi.hoisted(() => ({
  permits: [] as PermitWithCycles[],
  projects: [] as Project[],
  tasks: [] as unknown[],
  acks: [] as unknown[],
  mentions: [] as unknown[],
  postRequests: [] as unknown[],
  reads: [] as string[],
  markRead: vi.fn(),
  resolveRequest: vi.fn(),
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: state.permits, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: [], isLoading: false }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: 'Gena', roles: [], scope: 'permit' },
    userId: 'gena-uuid',
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
  useMilestoneAcks: () => ({ data: state.acks }),
  useAckMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjectMessages', () => ({
  useMyMentions: () => ({ data: state.mentions, isLoading: false, error: null }),
}));
// ★ fix-354: the EIGHTH board source, mocked here for the same reason
// fix-339 mocked the seventh — these suites deliberately render without a
// QueryClient, and an unmocked query would reach for one.
vi.mock('../hooks/useAutoClosures', () => ({
  useAutoClosures: () => ({ data: [], isLoading: false, error: null }),
}));
// ★ fix-360 mocks the ninth, for the same reason: this suite renders without a
// QueryClient and an unmocked query would reach for one.
// ★ fix-363 mocks the tenth input: the notification's subtitle now names the
// person who assigned the task ("Briana assigned you a task"), which is one
// more query — and these suites render without a QueryClient by design.
vi.mock('../hooks/useTaskProvenance', () => ({
  useTaskAssigners: () => ({ data: [], isLoading: false, error: null }),
  useTaskProvenance: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useMyPostReactions', () => ({
  useMyPostReactions: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/usePostRequests', () => ({
  useMyPostRequests: () => ({ data: state.postRequests, isLoading: false, error: null }),
  useResolvePostRequest: () => ({ mutate: state.resolveRequest, isPending: false }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({ data: state.tasks, isLoading: false }),
  useUpsertTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
// ★ fix-348: BoardBell now injects fix-238's ownership resolver into its board
// input, so the dropdown's counts and My Board's sections agree about who a
// task belongs to. This suite renders the bell WITHOUT a QueryClientProvider by
// design, so the hook is mocked here rather than the suite being rewritten.
vi.mock('../hooks/useTaskOwnership', () => ({
  useTaskOwnership: () => ({ matches: () => true }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: state.reads }),
  useMarkBoardItemsRead: () => ({ mutate: state.markRead, isPending: false }),
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'gena-uuid' }, activeTenantId: 't1' }),
}));

import BoardBell from '../components/BoardBell';
import { keyForMention, keyForPostRequest } from '../lib/boardReads';

/** A chat mention — the simplest PERSONAL item to manufacture, and one that
 *  carries a real read row when acknowledged. */
function mention(id: string, body: string) {
  return {
    id,
    project_id: 'p-1',
    project_address: '3921 43rd Ave S',
    author_name: 'Trevor',
    body,
    created_at: '2026-08-18T10:00:00Z',
    mentions: ['gena-uuid'],
  };
}

/** An open post request — the SHARED item fix-339 introduced. */
function postRequest(id: string) {
  return {
    id,
    project_id: 'p-1',
    project_address: '3921 43rd Ave S',
    title: 'Corrections round 2',
    reason: 'City came back and it needs its own thread',
    status: 'open',
    requester_name: 'Trevor',
    resolver_name: null,
    created_post_id: null,
    created_at: '2026-08-18T10:00:00Z',
    resolved_at: null,
    is_recipient: true,
  };
}

function renderBell() {
  return render(
    <MemoryRouter>
      <BoardBell />
    </MemoryRouter>,
  );
}

function openBell() {
  renderBell();
  fireEvent.click(screen.getByTestId('board-bell-button'));
}

beforeEach(() => {
  state.mentions = [];
  state.postRequests = [];
  state.reads = [];
  state.markRead.mockReset();
  state.resolveRequest.mockReset();
});

// ===========================================================================
// The unread treatment
// ===========================================================================

describe('fix-335 §9: an unread item looks unread', () => {
  it('★ carries a fill, a rule and a marker — not just a heading above it', () => {
    state.mentions = [mention('m1', 'Can you look at this?')];
    openBell();
    const row = screen.getByTestId(`bell-new-${keyForMention('m1')}`);
    expect(row.dataset.unread).toBe('true');
    // The fill Bobby asked for...
    expect(row.className).toContain('bg-de-bg');
    // ...the accent rule at full strength, for where a pale tint does not
    // survive a projector...
    expect(row.getAttribute('style')).toContain('var(--color-de)');
    // ...and a marker, because a tint alone is invisible to anyone who cannot
    // separate pale blue from white.
    expect(screen.getByTestId(`bell-new-dot-${keyForMention('m1')}`)).toBeInTheDocument();
  });

  // ★★ THE PALETTE IS THE ONE THAT ALREADY MEANS THIS. fix-307 tints an unseen
  // row on My Board with `de-bg`; fix-329 tints a message that mentions you.
  // A new "unread" colour would have split one meaning across two palettes and
  // made neither reliable — the brief was explicit about it.
  it('★★ reuses --color-de, and introduces no new colour', () => {
    state.mentions = [mention('m1', 'Can you look at this?')];
    openBell();
    const style = screen.getByTestId(`bell-new-${keyForMention('m1')}`)
      .getAttribute('style') ?? '';
    // Tokens, never a literal — a hex here would be a colour nobody could
    // retune with the rest of the palette.
    expect(style).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(style).toContain('var(--color-de)');
    expect(screen.getByTestId(`bell-new-${keyForMention('m1')}`).className)
      .toContain('bg-de-bg');
    // ★★ And it is the SAME token My Board already uses for an unseen row
    // (fix-307 #39), which is what makes the two surfaces one vocabulary rather
    // than two people's guesses at "highlighted".
    expect(myBoardSrc).toContain("isNew ? 'bg-de-bg' : ''");
  });

  it('the empty state is unchanged — zero still means "seen everything new"', () => {
    openBell();
    expect(screen.getByTestId('board-bell-new-empty').textContent)
      .toMatch(/Nothing new/);
  });
});

// ===========================================================================
// ★★ …and a read one looks read
// ===========================================================================

describe('fix-335 §9: reading an item shows a read state', () => {
  // ★★ THE CONTRAST, ON SCREEN AT THE SAME TIME. Before this, acknowledging an
  // item deleted the row — so there was no "read" appearance to compare the
  // unread one against, and the click had no visible consequence at all.
  it('★★ the row stays put, dimmed, beside the ones still unread', () => {
    state.mentions = [mention('m1', 'first'), mention('m2', 'second')];
    openBell();
    const k1 = keyForMention('m1');
    const k2 = keyForMention('m2');
    expect(screen.getByTestId(`bell-new-${k1}`).dataset.unread).toBe('true');

    fireEvent.click(screen.getByTestId(`bell-new-read-${k1}`));

    // The read row is still there — and now reads differently.
    const read = screen.getByTestId(`bell-new-${k1}`);
    expect(read.dataset.unread).toBe('false');
    expect(read.className).not.toContain('bg-de-bg');
    expect(read.className).toContain('opacity-55');
    // The other one is untouched, so the two states sit side by side.
    expect(screen.getByTestId(`bell-new-${k2}`).dataset.unread).toBe('true');
  });

  it('★ the real read row is still written — this is presentation only', () => {
    state.mentions = [mention('m1', 'first')];
    openBell();
    fireEvent.click(screen.getByTestId(`bell-new-read-${keyForMention('m1')}`));
    expect(state.markRead).toHaveBeenCalledWith([keyForMention('m1')]);
  });

  it('"Mark all read" leaves them all visible, all read', () => {
    state.mentions = [mention('m1', 'first'), mention('m2', 'second')];
    openBell();
    fireEvent.click(screen.getByTestId('board-bell-mark-all-read'));
    for (const id of ['m1', 'm2']) {
      expect(screen.getByTestId(`bell-new-${keyForMention(id)}`).dataset.unread)
        .toBe('false');
    }
  });

  // ★ PANEL-LOCAL AND DELIBERATELY FORGETFUL. Yesterday's acknowledgements are
  // not news; the read row is a confirmation of the click you just made, not a
  // second feed. fix-307's board_item_reads stays the only record.
  it('★ a fresh open shows only what is genuinely new', () => {
    state.mentions = [mention('m1', 'first')];
    openBell();
    fireEvent.click(screen.getByTestId(`bell-new-read-${keyForMention('m1')}`));
    expect(screen.getByTestId(`bell-new-${keyForMention('m1')}`)).toBeInTheDocument();

    // Close, and reopen with the read row now recorded server-side.
    fireEvent.click(screen.getByTestId('board-bell-button'));
    state.reads = [keyForMention('m1')];
    fireEvent.click(screen.getByTestId('board-bell-button'));
    expect(screen.queryByTestId(`bell-new-${keyForMention('m1')}`)).toBeNull();
    expect(screen.getByTestId('board-bell-new-empty')).toBeInTheDocument();
  });
});

// ===========================================================================
// ★★★ fix-339's SHARED items read correctly under the new treatment
// ===========================================================================

describe('fix-335 §9: a shared request is unread without being markable', () => {
  // ★ It gets the SAME fill, because "this is waiting on you" is the same fact
  // either way. What differs is what CLEARS it.
  it('is tinted like any other unread item', () => {
    state.postRequests = [postRequest('req-1')];
    openBell();
    const row = screen.getByTestId(`bell-new-${keyForPostRequest('req-1')}`);
    expect(row.dataset.unread).toBe('true');
    expect(row.className).toContain('bg-de-bg');
  });

  // ★★★ AND THE TREATMENT MUST NOT IMPLY IT CAN BE MARKED READ. A shared item
  // has no per-user read state at all — it is derived while the request is
  // open and gone the instant it is resolved — so a personal ✓ beside it would
  // be a control that lies.
  it('★★★ offers "Got it", never the personal ✓', () => {
    state.postRequests = [postRequest('req-1')];
    openBell();
    const key = keyForPostRequest('req-1');
    expect(screen.queryByTestId(`bell-new-read-${key}`)).toBeNull();
    const resolve = screen.getByTestId(`bell-new-resolve-${key}`);
    expect(resolve.textContent).toBe('Got it');
    expect(resolve.getAttribute('title')).toMatch(/clears it for everyone/i);
  });

  it('★★ declares which kind it is, so the two are never conflated', () => {
    state.mentions = [mention('m1', 'first')];
    state.postRequests = [postRequest('req-1')];
    openBell();
    expect(
      screen.getByTestId(`bell-new-${keyForMention('m1')}`).dataset.unreadKind,
    ).toBe('personal');
    expect(
      screen.getByTestId(`bell-new-${keyForPostRequest('req-1')}`).dataset.unreadKind,
    ).toBe('shared');
  });

  it('the dot says the difference on hover too', () => {
    state.postRequests = [postRequest('req-1')];
    openBell();
    expect(
      screen.getByTestId(`bell-new-dot-${keyForPostRequest('req-1')}`)
        .getAttribute('title'),
    ).toMatch(/waiting on anyone/i);
  });

  // ★★ AND IT CAN NEVER ACQUIRE THE READ APPEARANCE. Nothing writes a read row
  // for it, so it is either outstanding and shown unread, or resolved and gone.
  // "Mark all read" must not sweep it up on its way past — fix-339's rule,
  // re-asserted here because §9 is the change that could have broken it.
  it('★★ "mark all read" does not dim a shared request', () => {
    state.mentions = [mention('m1', 'first')];
    state.postRequests = [postRequest('req-1')];
    openBell();
    fireEvent.click(screen.getByTestId('board-bell-mark-all-read'));

    // The personal one went read; the shared one did not move.
    expect(state.markRead).toHaveBeenCalledWith([keyForMention('m1')]);
    expect(
      screen.getByTestId(`bell-new-${keyForPostRequest('req-1')}`).dataset.unread,
    ).toBe('true');
    expect(
      screen.getByTestId(`bell-new-${keyForPostRequest('req-1')}`).className,
    ).toContain('bg-de-bg');
  });

  it('acting on it resolves the request rather than writing a read row', () => {
    state.postRequests = [postRequest('req-1')];
    openBell();
    fireEvent.click(
      screen.getByTestId(`bell-new-resolve-${keyForPostRequest('req-1')}`),
    );
    expect(state.resolveRequest).toHaveBeenCalledWith({
      id: 'req-1',
      status: 'acknowledged',
    });
    expect(state.markRead).not.toHaveBeenCalled();
  });
});
