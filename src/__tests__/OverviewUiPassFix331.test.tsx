import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import routerSrc from '../router.tsx?raw';
import {
  RIBBON_ENTRIES,
  allRibbonRoutes,
  ribbonExemptPaths,
  visibleChildren,
  visibleEntries,
  type RibbonGroup,
} from '../lib/ribbonNav';
import type { PermitWithCycles, Project, ProjectMessage } from '../lib/database.types';

// fix-331 — eight display corrections across Project Overview and the ribbon.
//
// ★ Every one is a thing Bobby looked at and could name. None has business
// logic; the value of the tests is that each change is pinned to the sentence
// that asked for it, so the next reorder or restyle knows what it is undoing.

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

// --------------------------------------------------------------- the header --

const chatMock = vi.hoisted(() => ({
  messages: [] as ProjectMessage[],
  /** fix-334: drop the injected General post, for the empty-state test. */
  suppressPost: false,
}));

// ★★ fix-334: every message is now a REPLY UNDER A POST. These suites predate
// posts, so the mocked read wraps their fixtures in the one post they all hang
// from — which is exactly the shape the migration gave the seven real messages
// that predated posts too. The assertions below are unchanged by it.
const FIX334_POST = {
  id: 'post-1',
  project_id: 'p-331',
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
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({
      data: chatMock.suppressPost ? chatMock.messages : [FIX334_POST, ...chatMock.messages],
      isLoading: false,
      error: null,
    }),
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

// The Plan of Record card is the tallest card in the row and the one whose
// height varies — it is what §1 is about, so it renders for real here with a
// row and a thumbnail.
const porMock = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  thumb: 'data:image/jpeg;base64,x' as string | null,
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: porMock.row, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: porMock.thumb, isLoading: false, error: null }),
}));

import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';

function projectFixture(over: Partial<Project> = {}): Project {
  return {
    id: 'p-331',
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
    project_id: 'p-331',
    type: 'Building Permit',
    num: '7133442-CN',
    da: 'Cam',
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

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-331',
    author_id: 'u-1',
    author_name: 'Briana',
    body: 'Builder says they are likely selling.',
    mentions: [],
    attachments: [],
    created_at: '2026-08-15T10:00:00Z',
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

beforeEach(() => {
  chatMock.messages = [];
  chatMock.suppressPost = false;
  porMock.row = {
    project_id: 'p-331',
    set_type: 'marketing',
    file_name: '10729 - Marketing - Internal.pdf',
    unc_path: '\\\\bpc-file\\Public2\\10729\\Marketing\\10729 - Marketing - Internal.pdf',
    modified_at: '2026-08-06T00:00:00Z',
    size_kb: 117,
    thumb_status: 'ok',
    thumb_path: 'p/1.jpg',
  };
  porMock.thumb = 'data:image/jpeg;base64,x';
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

// ---------------------------------------------------------------------------
// ★ §1 — the card row renders differently on every machine
// ---------------------------------------------------------------------------

describe('fix-331 §1: equal-height cards distribute their spare room', () => {
  // Bobby, comparing two people's screens on this exact project:
  //
  //   "On my computer there's very little vertical space between the bottom of
  //   Milestones and Intake Accepted — it's filled in… but on other users
  //   there's these massive openings."
  //
  // ★ jsdom HAS NO LAYOUT ENGINE, so "the gap is gone" cannot be measured here
  // and pretending otherwise would be the worse kind of green test. What IS
  // assertable is the MECHANISM that produces it, and that is what these check.
  // The rendered evidence at 1280×800 / 1440×900 / 1600×1000 is in the PR.

  it('★ the row still stretches — fix-309 is not being undone', () => {
    renderHeader();
    const grid = screen.getByTestId('project-overview-grid');
    expect(grid.style.alignItems).toBe('stretch');
    // Going back to a ragged row was the complaint fix-309 fixed.
    expect(grid.style.alignItems).not.toBe('start');
  });

  it('★ every card still fills its cell', () => {
    renderHeader();
    for (const card of screen.getAllByTestId('overview-card-banner')) {
      const section = card.closest('section') as HTMLElement;
      expect(section.style.height).toBe('100%');
    }
  });

  // ★★ THE FIX ITSELF. Slack is split BETWEEN the sections rather than banked
  // at the bottom of the card as one hole.
  it('★★ every section grows, so the spare height is shared out', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    const sections = Array.from(card.querySelectorAll('section'));
    expect(sections.length).toBeGreaterThanOrEqual(3);
    for (const s of sections) {
      expect((s as HTMLElement).style.flexGrow).toBe('1');
    }
  });

  // ★ Named in the brief: growing must never become shrinking. A card whose own
  // content is taller than the row keeps its content and scrolls.
  it('★ sections grow but never shrink', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    for (const s of Array.from(card.querySelectorAll('section'))) {
      expect((s as HTMLElement).style.flexShrink).toBe('0');
    }
  });

  // ★ Both anti-patterns the brief ruled out.
  it('★ nothing is centred and no single element swallows the gap', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    // Not centred: the card is a plain top-to-bottom column.
    expect(card.className).toContain('flex-col');
    expect(card.style.justifyContent ?? '').not.toBe('center');
    // No one section is singled out to absorb the rest — they all take the
    // SAME share, which is what "distributed" means.
    const grows = Array.from(card.querySelectorAll('section')).map(
      (s) => (s as HTMLElement).style.flexGrow,
    );
    expect(new Set(grows).size).toBe(1);
  });

  // ★ The reading rhythm has to survive the redistribution.
  it('★ the section order is unchanged: Key dates, DD window, Permit intake', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    const headings = Array.from(card.querySelectorAll('section'))
      .map((s) => s.querySelector('span')?.textContent?.trim())
      .filter((t) => t === 'Key dates' || t === 'DD window' || t === 'Permit intake');
    expect(headings).toEqual(['Key dates', 'DD window', 'Permit intake']);
  });

  it('the banner never absorbs the slack', () => {
    renderHeader();
    for (const banner of screen.getAllByTestId('overview-card-banner')) {
      expect(banner.className).toContain('flex-shrink-0');
    }
  });
});

// ---------------------------------------------------------------------------
// ★ §2 — Design Plan of Record
// ---------------------------------------------------------------------------

describe('fix-331 §2: the DPoR card face is label, preview, enlarge, copy', () => {
  it('★ shows none of the filename, modified date, size or paste hint', () => {
    renderHeader();
    const card = screen.getByTestId('plan-of-record-card');
    expect(within(card).queryByTestId('plan-of-record-filename')).toBeNull();
    expect(within(card).queryByTestId('plan-of-record-meta')).toBeNull();
    expect(within(card).queryByTestId('plan-of-record-copy-hint')).toBeNull();
    const text = card.textContent ?? '';
    expect(text).not.toContain('10729 - Marketing - Internal.pdf');
    expect(text).not.toContain('117 KB');
    expect(text).not.toMatch(/Aug 06, 2026/);
    expect(text).not.toMatch(/paste into File Explorer/i);
  });

  it('★ keeps the label, the preview, Click to enlarge and Copy path', () => {
    renderHeader();
    const card = screen.getByTestId('plan-of-record-card');
    expect(within(card).getByTestId('plan-of-record-stage-marketing')).toBeInTheDocument();
    expect(within(card).getByTestId('plan-of-record-preview')).toBeInTheDocument();
    expect(card.textContent).toMatch(/Click to enlarge/i);
    expect(within(card).getByTestId('plan-of-record-copy')).toBeInTheDocument();
  });

  // ★ MOVED, NOT DELETED — the half that makes the removal above safe.
  it('★ the enlarged view carries the filename, the date and the size', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('plan-of-record-preview'));
    const box = screen.getByTestId('plan-of-record-lightbox');
    expect(box).toHaveTextContent('10729 - Marketing - Internal.pdf');
    expect(box).toHaveTextContent('Aug 06, 2026');
    expect(box).toHaveTextContent('117 KB');
  });

  // fix-289: browsers refuse to navigate https → UNC, silently. An Open button
  // would do nothing at all, which is worse than not offering it.
  it('★ still no Open button, on the card or in the enlarged view', () => {
    renderHeader();
    const card = screen.getByTestId('plan-of-record-card');
    for (const btn of within(card).getAllByRole('button')) {
      expect(btn.textContent ?? '').not.toMatch(/^\s*open\b/i);
    }
    fireEvent.click(screen.getByTestId('plan-of-record-preview'));
    const box = screen.getByTestId('plan-of-record-lightbox');
    for (const btn of within(box).getAllByRole('button')) {
      expect(btn.textContent ?? '').not.toMatch(/^\s*open\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// ★★ §3 — the chat is a section of Team
// ---------------------------------------------------------------------------

describe('fix-331 §3: the chat lives inside the Team card', () => {
  it('★ renders between Internal and External', () => {
    renderHeader();
    const team = screen.getByTestId('project-overview-team');
    const ids = Array.from(team.querySelectorAll('section'))
      .map((s) => (s as HTMLElement).dataset.testid)
      .filter(Boolean);
    expect(ids).toEqual([
      'project-overview-team-internal',
      'project-overview-team-chat',
      'project-overview-team-external',
    ]);
  });

  // ★★ THE ACTUAL COMPLAINT: "feels like it is part of the team card, not a
  // separate UI feature/function like it shows now."
  it('★★ draws NO nested card — no second border, no second background', () => {
    renderHeader();
    const chat = screen.getByTestId('project-overview-team-chat');
    // The section's own top rule comes from OverviewSection, exactly like
    // Internal and External. Nothing INSIDE it may draw a card.
    for (const el of Array.from(chat.querySelectorAll('*'))) {
      const cls = (el as HTMLElement).className;
      const className = typeof cls === 'string' ? cls : '';
      expect(className).not.toMatch(/\bborder\b(?!-)/);
      expect(className).not.toMatch(/\bbg-surface\b/);
      expect(className).not.toMatch(/\brounded-lg\b/);
    }
  });

  it('★ uses the same section treatment as Internal and External', () => {
    renderHeader();
    const team = screen.getByTestId('project-overview-team');
    const chat = screen.getByTestId('project-overview-team-chat');
    const internal = screen.getByTestId('project-overview-team-internal');
    // Same component, so the same classes draw the separator and padding.
    expect(chat.className).toBe(internal.className);
    expect(within(team).getByText('Chat')).toBeInTheDocument();
  });

  // ★ fix-334 changed the UNIT from messages to posts — fix-331's rule survives
  // ("one or two, then you have to open it"), the thing being counted does not.
  it('★ shows at most two posts, and the rest need the modal', () => {
    chatMock.messages = [
      message({ id: 'm-1', body: 'oldest' }),
      message({ id: 'm-2', body: 'second' }),
      message({ id: 'm-3', body: 'third' }),
      message({ id: 'm-4', body: 'newest' }),
    ];
    renderHeader();
    const mini = screen.getByTestId('project-chat-mini');
    expect(within(mini).getByText('General')).toBeInTheDocument();
    expect(within(mini).getByText('newest')).toBeInTheDocument();
    expect(within(mini).queryByText('oldest')).toBeNull();
  });

  it('opens the modal — unchanged by this ticket', () => {
    chatMock.messages = [message()];
    renderHeader();
    fireEvent.click(screen.getByTestId('project-chat-open'));
    expect(screen.getByTestId('project-chat-modal')).toBeInTheDocument();
  });

  // ★ fix-329's rule: one source for the count, so the rail and the bell cannot
  // disagree. The surface moved; the source did not.
  it('★ the unread pill still counts mentions of me minus board_item_reads', () => {
    const ME = 'u';
    chatMock.messages = [
      message({ id: 'm-1', body: '@Bobby look', mentions: [ME] }),
      message({ id: 'm-2', body: '@Briana look', mentions: ['someone-else'] }),
    ];
    renderHeader();
    expect(screen.getByTestId('project-chat-unread').textContent).toContain('1 new');
  });

  it('an empty thread says what to do rather than rendering a blank block', () => {
    // ★ fix-334: empty means NO POSTS now.
    chatMock.suppressPost = true;
    renderHeader();
    expect(screen.getByTestId('project-chat-empty')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ★ §4 / §5 / §6 / §7 / §8 — the source-level contracts
// ---------------------------------------------------------------------------

describe('fix-331 §4: one button, and Delete stays dangerous', () => {
  it('★ the page header offers Project Settings and nothing else', async () => {
    const src = (await import('../pages/ProjectDetail.tsx?raw')).default as string;
    expect(src).toContain('data-testid="project-settings-btn"');
    // The two that moved inside are gone from the header.
    expect(src).not.toContain('data-testid="project-reassign-da-btn"');
    expect(src).not.toContain('data-testid="project-delete-btn"');
  });

  it('★ and hands both to the settings modal as callbacks', async () => {
    const src = (await import('../pages/ProjectDetail.tsx?raw')).default as string;
    expect(src).toMatch(/onReassignDa=\{/);
    expect(src).toMatch(/onDelete=\{/);
    expect(src).toMatch(/canReassignDa=\{isAdmin\}/);
  });

  it('★★ Delete is red, in a Danger zone, and still confirms by typed address', async () => {
    const modal = (await import(
      '../components/ProjectDetail/ProjectSettingsModal.tsx?raw'
    )).default as string;
    expect(modal).toContain('data-testid="psm-danger-zone"');
    expect(modal).toContain('data-testid="psm-delete-project"');
    expect(modal).toContain('Danger zone');
    // Still reads destructive rather than becoming a quiet settings row.
    expect(modal).toContain("background: '#fee2e2'");

    // ★ The real guardrail is untouched: the dialog refuses until the project's
    // address is typed verbatim. Folding the entry point in did not soften it.
    const dialog = (await import(
      '../components/ProjectDetail/DeleteProjectDialog.tsx?raw'
    )).default as string;
    expect(dialog).toMatch(/Type the project address to confirm/i);
    expect(dialog).toMatch(/disabled=\{!matches/);
  });

  it('Reassign DA stays admin-only inside the panel', async () => {
    const modal = (await import(
      '../components/ProjectDetail/ProjectSettingsModal.tsx?raw'
    )).default as string;
    expect(modal).toMatch(/disabled=\{!canReassignDa\}/);
  });
});

describe('fix-331 §5: no "coming soon" survives anywhere', () => {
  // ★★ The literal string, hunted across the whole source tree rather than in
  // the one file it was last seen in — the same guard fix-330 added for
  // "coming later", now covering both.
  it('★ nothing in src/ renders "coming soon" or "coming later"', () => {
    const modules = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(modules)
      // The tests themselves may NAME the string they are hunting.
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => /coming soon|coming later/i.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('★ the top bar has no search slot left behind', async () => {
    const src = (await import('../components/Chrome.tsx?raw')).default as string;
    expect(src).not.toContain('data-testid="chrome-search"');
    expect(src).not.toContain('⌘K');
  });
});

describe('fix-331 §6: error triage is a ribbon entry, admin only', () => {
  it('★ it is in the ribbon, flagged admin-only, and carries its count', () => {
    const entry = RIBBON_ENTRIES.find(
      (e) => e.kind === 'link' && e.link.to === '/settings/errors',
    );
    expect(entry, 'error triage is missing from the ribbon').toBeTruthy();
    const link = entry!.kind === 'link' ? entry!.link : null;
    expect(link?.adminOnly).toBe(true);
    expect(link?.badge).toBe('errors');
  });

  it('★ a non-admin does not see it', () => {
    const routes = visibleEntries(false).flatMap((e) =>
      e.kind === 'link' ? [e.link.to] : e.kind === 'group' ? e.group.children.map((c) => c.to) : [],
    );
    expect(routes).not.toContain('/settings/errors');
    expect(
      visibleEntries(true).some(
        (e) => e.kind === 'link' && e.link.to === '/settings/errors',
      ),
    ).toBe(true);
  });

  // ★★ AND CANNOT REACH IT BY TYPING THE URL. A hidden link over an open door
  // is the shape fix-234 already ruled out.
  it('★★ the ROUTE is AdminRoute-wrapped, not just the control', () => {
    expect(routerSrc).toMatch(
      /path: 'settings\/errors', element: <AdminRoute><ErrorsPage \/><\/AdminRoute>/,
    );
  });

  it('★ the old top-bar bell component is deleted, not merely unmounted', async () => {
    const modules = import.meta.glob('../components/*.tsx', { eager: true });
    expect(Object.keys(modules).some((p) => p.includes('ErrorTriageBell'))).toBe(false);
  });

  // ★ It was exempt from the coverage guard on the grounds that the top bar
  // reached it. That bar is gone, so the exemption had to go with it — a path
  // may not be both a ribbon entry and an exemption.
  it('★ its coverage exemption is gone, because it is now an entry', () => {
    expect(ribbonExemptPaths()).not.toContain('/settings/errors');
    expect(allRibbonRoutes()).toContain('/settings/errors');
  });
});

describe('fix-331 §7: the top bar loses the avatar circle', () => {
  it('★ Chrome renders no initials and no initials helper', async () => {
    const src = (await import('../components/Chrome.tsx?raw')).default as string;
    expect(src).not.toMatch(/\{initials\(/);
    expect(src).not.toMatch(/function initials\(/);
  });

  it('keeps the name, the position and the bell', async () => {
    const src = (await import('../components/Chrome.tsx?raw')).default as string;
    expect(src).toContain('identity.name');
    expect(src).toContain('identity.roles[0]');
    expect(src).toContain('<BoardBell />');
  });
});

describe('fix-331 §8: the ribbon order', () => {
  function topLevel(): string[] {
    return RIBBON_ENTRIES.filter((e) => e.kind === 'link').map((e) =>
      e.kind === 'link' ? e.link.to : '',
    );
  }

  it('★ Pipeline, Draw Schedule, My Board — then Settings and error triage', () => {
    expect(topLevel()).toEqual([
      '/dashboard',
      '/draw-schedule',
      '/board',
      '/settings',
      '/settings/errors',
    ]);
  });

  it('★ Project View moved under Reports', () => {
    const reports = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'reports',
    );
    const kids = reports!.kind === 'group' ? reports!.group.children.map((c) => c.to) : [];
    expect(kids).toEqual(['/reports', '/projects', '/settings/reporting']);
    // ...and is no longer a top-level link, so it lives in exactly one place.
    expect(topLevel()).not.toContain('/projects');
  });

  it('Entitlements keeps Library; Draw Schedule was promoted out', () => {
    const ent = RIBBON_ENTRIES.find(
      (e) => e.kind === 'group' && e.group.id === 'entitlements',
    );
    const kids = ent!.kind === 'group' ? ent!.group.children.map((c) => c.to) : [];
    expect(kids).toEqual(['/library']);
  });

  // ★★ THE MEASUREMENT THAT FORCED PER-CHILD GATING. Reports is admin-only and
  // Project View is not; 23 of this tenant's 29 people are editors, so the
  // naive reading of §8 would have deleted a core screen for most of the team.
  it('★★ a non-admin still reaches Project View, and no report', () => {
    const nonAdmin = visibleEntries(false);
    const routes = nonAdmin.flatMap((e) =>
      e.kind === 'link' ? [e.link.to] : e.kind === 'group' ? e.group.children.map((c) => c.to) : [],
    );
    expect(routes).toContain('/projects');
    expect(routes.some((r) => r.startsWith('/reports'))).toBe(false);
    expect(routes).not.toContain('/settings/reporting');
  });

  it('★ a child inherits the group gate unless it opts out explicitly', () => {
    const group: RibbonGroup = {
      id: 'g',
      label: 'G',
      icon: '·',
      adminOnly: true,
      children: [
        { to: '/inherits', label: 'Inherits', icon: '·' },
        { to: '/optsout', label: 'Opts out', icon: '·', adminOnly: false },
      ],
    };
    expect(visibleChildren(group, false).map((c) => c.to)).toEqual(['/optsout']);
    expect(visibleChildren(group, true).map((c) => c.to)).toEqual([
      '/inherits',
      '/optsout',
    ]);
  });

  // ★ Everything stays reachable — the third reorder, and the guard fix-315
  // built for exactly this.
  it('★★ every route is still in the ribbon or explicitly exempt', () => {
    const declared = [
      ...new Set(
        [...routerSrc.matchAll(/path:\s*'([^']+)'/g)]
          .map((m) => m[1]!)
          .filter((p) => p !== '*' && p !== '/' && !p.includes(':'))
          .map((p) => (p.startsWith('/') ? p : `/${p}`)),
      ),
    ];
    const missing = declared.filter(
      (r) => !allRibbonRoutes().includes(r) && !ribbonExemptPaths().includes(r),
    );
    expect(missing, `unreachable by clicking: ${missing.join(', ')}`).toEqual([]);
  });

  // ★ fix-325 decided Waiting On is not a tab, and /waiting-on is a redirect.
  // The brief's sketch showed it back inside Entitlements; restoring it would
  // undo a shipped decision and put a redirect-only path in the ribbon.
  it('★ Waiting On is deliberately NOT restored to the ribbon', () => {
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
    expect(ribbonExemptPaths()).toContain('/waiting-on');
    expect(routerSrc).toContain('/board?view=waiting-on');
  });
});
