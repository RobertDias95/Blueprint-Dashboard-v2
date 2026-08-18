import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import chatSectionSrc from '../components/ProjectDetail/ProjectChatSection.tsx?raw';
import type { PermitWithCycles, Project, ProjectMessage } from '../lib/database.types';

// ===========================================================================
// fix-346 §1 — the chat preview MOVES DOWN. It is not deleted.
// ===========================================================================
//
// ★★★ An earlier draft of the brief said "delete the chat preview". It was
// corrected before the brief was run, and the correction is the requirement:
//
//   "We want to keep the chat where it's showing the last two most common
//    posts, but what we actually want to do is move that chat down below, above
//    the chat button, so that it goes internal, external, and then here's the
//    chat section, and then it shows your two most recent chats, and then the
//    chat button, which would then open up the chat."
//
// So the ORDER is the deliverable, and it is asserted as an ordered list rather
// than as four presence checks — "all four are there" would have passed before
// this ticket as happily as after it.
//
// ★ fix-345 §3's contract survives untouched: four sections, the last one
// pinned, all three cards' buttons measured from the same edge. That is
// asserted here as well as in MilestonesCard.test.tsx, because §1 is the ticket
// that could break it.

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

function renderHeader(project = projectFixture(), permits = [bpFixture()]) {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={permits} bp={bp} />,
    { wrapper },
  );
}

function teamSectionIds(): (string | undefined)[] {
  return Array.from(
    screen.getByTestId('project-overview-team').querySelectorAll(':scope > section'),
  ).map((s) => (s as HTMLElement).dataset.testid);
}

beforeEach(() => {
  chatMock.messages = [post(), reply()];
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// ---------------------------------------------------------------------------
// ★★ The order
// ---------------------------------------------------------------------------

describe('fix-346 §1: the Team card reads Internal, External, Chat, button', () => {
  it('★★ the ORDER is asserted, not merely that all four are present', () => {
    renderHeader();
    expect(teamSectionIds()).toEqual([
      'project-overview-team-internal',
      'project-overview-team-external',
      'project-overview-team-chat',
      'pd-chat-section',
    ]);
  });

  it('★★ the preview sits BELOW External and DIRECTLY ABOVE the button', () => {
    renderHeader();
    const ids = teamSectionIds();
    const external = ids.indexOf('project-overview-team-external');
    const chat = ids.indexOf('project-overview-team-chat');
    const button = ids.indexOf('pd-chat-section');
    expect(chat).toBeGreaterThan(external);
    expect(button).toBe(chat + 1);
  });

  // ★★★ THE PREVIEW IS NOT DELETED. An earlier draft of the brief said to
  // delete it; this is the assertion that would have failed.
  it('★★★ the preview still renders, with its posts and reply counts', () => {
    chatMock.messages = [
      post(),
      reply(),
      post({ id: 'post-2', title: 'Survey', body: 'Survey ordered', created_at: '2026-08-16T09:00:00Z' }),
    ];
    renderHeader();
    const mini = screen.getByTestId('project-chat-mini');
    expect(within(mini).getByText('ACQ Questions')).toBeInTheDocument();
    expect(within(mini).getByText('Survey')).toBeInTheDocument();
    // ★ A post's reply count is the other half of "a topic list": one reply on
    // the ACQ post, none on Survey.
    expect(within(mini).getByText('1 reply')).toBeInTheDocument();
    expect(within(mini).getByText('0 replies')).toBeInTheDocument();
  });

  // ★ fix-331's rule survives the move: one or two, and the rest need the modal.
  it('★ still at most two posts', () => {
    chatMock.messages = [
      post({ id: 'post-1', title: 'Oldest', created_at: '2026-08-10T09:00:00Z' }),
      post({ id: 'post-2', title: 'Middle', created_at: '2026-08-11T09:00:00Z' }),
      post({ id: 'post-3', title: 'Newest', created_at: '2026-08-12T09:00:00Z' }),
    ];
    renderHeader();
    const mini = screen.getByTestId('project-chat-mini');
    expect(within(mini).queryByText('Oldest')).toBeNull();
    expect(mini.querySelectorAll('[data-testid^="project-chat-mini-post"]')).toHaveLength(2);
  });

  // ★ fix-331 §3's actual win — the chat is a SECTION of Team, not a widget
  // parked inside one. Moving it must not turn it back into a card.
  it('★ still draws no nested card, and still uses the same section treatment', () => {
    renderHeader();
    const chat = screen.getByTestId('project-overview-team-chat');
    const external = screen.getByTestId('project-overview-team-external');
    expect(chat.className).toBe(external.className);
    for (const el of Array.from(chat.querySelectorAll('*'))) {
      const cls = (el as HTMLElement).className;
      const className = typeof cls === 'string' ? cls : '';
      expect(className).not.toMatch(/\bborder\b(?!-)/);
      expect(className).not.toMatch(/\bbg-surface\b/);
      expect(className).not.toMatch(/\brounded-lg\b/);
    }
  });

  // ★ ProjectChatSection STAYS — the brief says so explicitly.
  it('★ the component was not deleted', () => {
    expect(chatSectionSrc).toContain('export default function ProjectChatSection');
  });
});

// ---------------------------------------------------------------------------
// ★★ §1b — no avatar in the preview rows
// ---------------------------------------------------------------------------
//
// Bobby: "I don't like the BO next to the post thread. I think just show recent
// threads and their replies, no need for the naming item."
//
// ★ The preview lists THREADS. On a post with replies the circle showed
// whoever wrote the LATEST message, which reads as ownership of the thread
// rather than authorship of one line in it.

describe('fix-346 §1b: the preview rows have no author avatar', () => {
  it('★ absence is asserted, not inferred', () => {
    renderHeader();
    const mini = screen.getByTestId('project-chat-mini');
    expect(within(mini).queryAllByTestId('chat-avatar')).toHaveLength(0);
    // And nothing else drew initials by hand in its place.
    expect(mini.textContent).not.toMatch(/\bBO\b|\bBR\b/);
    expect(chatSectionSrc).not.toMatch(/<Avatar/);
  });

  it('★ a row is still a title, a reply count and the latest line', () => {
    renderHeader();
    const row = screen.getByTestId('project-chat-mini-post-1');
    expect(within(row).getByText('ACQ Questions')).toBeInTheDocument();
    expect(within(row).getByText('1 reply')).toBeInTheDocument();
    expect(row.textContent).toContain('Builder says they are likely selling.');
  });

  // ★★ SCOPE IS THE PREVIEW ONLY. Inside the modal, "who said this" is the
  // point, and the avatars stay.
  it('★★ avatars still render inside the modal', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('project-chat-open'));
    const modal = screen.getByTestId('project-chat-modal');
    expect(within(modal).getAllByTestId('chat-avatar').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ★ The unread indicator — exactly one claimant
// ---------------------------------------------------------------------------
//
// ★ THE BUTTON CARRIES IT, which is where fix-345 §3 put it and where it stays:
// a count on the control you are about to press is information, a count beside
// a heading is decoration. The preview keeps its MENTION TINT — a per-row
// marker of "this thread mentions you", not a second count of the same fact —
// which the brief explicitly asked to preserve.

describe('fix-346 §1: one claimant for the unread count', () => {
  it('★ exactly one, and it is inside the button', () => {
    chatMock.messages = [post({ id: 'post-1', body: '@Bobby look', mentions: ['u'] })];
    renderHeader();
    const badges = screen.getAllByTestId('project-chat-unread');
    expect(badges).toHaveLength(1);
    expect(screen.getByTestId('project-chat-open').contains(badges[0])).toBe(true);
    expect(screen.getByTestId('project-chat-mini').contains(badges[0])).toBe(false);
  });

  // ★★ AND IT STILL READS THE BELL'S SOURCE — `mention:{message_id}` keys minus
  // board_item_reads, the same two inputs the badge uses. fix-298 Phase 2 spent
  // a ticket collapsing two counts that could disagree; moving a section does
  // not get to re-open it.
  it('★★ it is the bell\'s subtraction: a read mention stops counting', async () => {
    chatMock.messages = [post({ id: 'post-1', body: '@Bobby look', mentions: ['u'] })];
    const reads = await import('../hooks/useBoardReads');
    vi.spyOn(reads, 'useBoardReads').mockReturnValue({
      data: ['mention:post-1'],
      isLoading: false,
      error: null,
    } as never);
    renderHeader();
    expect(screen.queryByTestId('project-chat-unread')).toBeNull();
    vi.restoreAllMocks();
  });

  it('★ the preview keeps its mention tint — a marker, not a second count', () => {
    chatMock.messages = [post({ id: 'post-1', body: '@Bobby look', mentions: ['u'] })];
    renderHeader();
    expect(screen.getByTestId('project-chat-mini-post-1').dataset.toMe).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// ★ fix-345 §3 still holds
// ---------------------------------------------------------------------------

describe('fix-346 §1: fix-345 §3 survives the move', () => {
  it('★ the Team card still ends with a pinned action taking no spare height', () => {
    renderHeader();
    const ids = teamSectionIds();
    expect(ids[ids.length - 1]).toBe('pd-chat-section');
    const pinned = screen.getByTestId('pd-chat-section');
    expect(pinned.dataset.pinBottom).toBe('true');
    expect(pinned.style.flexGrow).toBe('0');
    expect(pinned.style.marginTop).toBe('auto');
  });

  // ★★ The section count is still FOUR, which is the number fix-345 §3's
  // reasoning turns on — a pinned section is pinned whatever is above it, but
  // the distribution above it is what the brief asked to re-verify.
  it('★★ four sections, three of which share the spare height', () => {
    renderHeader();
    expect(teamSectionIds()).toHaveLength(4);
    const distributed = (
      Array.from(
        screen.getByTestId('project-overview-team').querySelectorAll(':scope > section'),
      ) as HTMLElement[]
    ).filter((s) => s.dataset.pinBottom !== 'true');
    expect(distributed).toHaveLength(3);
    for (const s of distributed) expect(s.style.flexGrow).toBe('1');
  });

  it('★ all three cards still end with their action, on the same geometry', () => {
    renderHeader();
    for (const [cardId, sectionId, buttonId] of [
      ['pd-milestones-card', 'pd-draw-schedule-section', 'pd-draw-schedule-link'],
      ['pd-project-card', 'pd-connect-section', 'pd-connect-button'],
      ['project-overview-team', 'pd-chat-section', 'project-chat-open'],
    ] as const) {
      const sections = Array.from(
        screen.getByTestId(cardId).querySelectorAll(':scope > section'),
      );
      expect(
        (sections[sections.length - 1] as HTMLElement).dataset.testid,
        cardId,
      ).toBe(sectionId);
      const cls = screen.getByTestId(buttonId).className;
      expect(cls, buttonId).toContain('h-[26px]');
      expect(cls, buttonId).toContain('w-full');
    }
  });

  it('★ still exactly one way into the modal', () => {
    renderHeader();
    expect(screen.getAllByTestId('project-chat-open')).toHaveLength(1);
    expect(screen.getByTestId('project-chat-mini').querySelector('button')).toBeNull();
  });
});
