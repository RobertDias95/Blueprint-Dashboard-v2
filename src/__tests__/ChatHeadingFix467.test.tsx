import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
// ★ fix-468: the PROPERTY test computes its allow-list from THE definition
//   itself, so it cannot drift with the component.
import { projectInternalTeam, projectTeamNames } from '../lib/projectTeam';
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

// ★ fix-468: the BOBBY / MILES author ids fix-467 needed are gone with the
//   author cases. Only the message fixture still needs an author id at all,
//   and only so a message is well-formed — nothing in the header reads it.
const BRIANA = '22222222-2222-2222-2222-222222222222';
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

// ★★★ fix-475 (P-116) — THE CONSULTANTS CARD IS INERT HERE.
//
// It joined the Overview row (taking Builder/Owner's slot), so every test that
// renders `ProjectDetailHeader` now mounts it — and it READS: the consultant
// list, its round history, and the firm directory.
//
// ★★ WHY THAT MATTERED RATHER THAN JUST BEING NOISE: several of these suites
// share one supabase mock whose `.select()` SHIFTS A QUEUED RESPONSE. A new
// component issuing a read silently ate the response the test had queued for
// its own write, and the failure surfaced as "expected 1 to be 2" three files
// away from the cause. Mocked inert, exactly as `useBuilderSearch` and
// `useSetBpDdDates` already are in the files that have this shape.
vi.mock('../hooks/useProjectConsultants', () => ({
  useProjectConsultants: () => ({ data: [], isLoading: false }),
  useConsultantRounds: () => ({ data: [], isLoading: false }),
  useAddProjectConsultant: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantDate: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useSetConsultantFirm: () => ({ mutate: vi.fn(), isPending: false }),
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

function renderModal(permits: Permit[] = [PERMIT]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectChatModal projectId="p-1" permits={permits} onClose={() => {}} />,
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
// ★★★ fix-468 — THE INTERNAL TEAM, NOT THE POST AUTHORS
// ---------------------------------------------------------------------------
//
// Bobby, 2026-09-01: *"in the chat, we are adding the address and internal team
// to this chat."*
//
// ★★★ THE AUTHOR CASES THAT USED TO LIVE HERE ARE SUPERSEDED, NOT MISTAKEN.
// fix-467 built an author list because the brief in front of it recommended
// one; Bobby ruled afterwards, and his reason is the whole argument: **every
// message in the thread already shows its own author, with an avatar, on the
// row.** An author list in the header repeats what is on screen a few inches
// below it. The project team is the thing you cannot otherwise see from inside
// this modal — who to pull in, who is accountable, who has not spoken yet.
//
// ★ The ADDRESS cases above are UNTOUCHED. That half of fix-467 §1 was right,
//   and this ticket is only the delta.

/** A project with every internal role filled. Role values are `team_members.name`
 *  join keys, which is what the roster maps to a full name (fix-343). */
const TEAMED = {
  ...PROJECT,
  acq_lead: 'Taylor',
  entitlement_lead: 'Miles',
  schematic_designer: ['Derry'],
  design_manager: 'Lindsay',
} as unknown as Project;

/** The building permit carries ENT / DM / DA and OVERRIDES the project-level
 *  defaults — `projectInternalTeam`'s own precedence, unchanged here. */
const TEAM_PERMIT = {
  ...PERMIT,
  ent_lead: 'Miles',
  dm: 'Lindsay',
  da: 'Cam',
} as unknown as Permit;

const ROSTER = [
  member('Taylor', 'Taylor', 'Shaw'),
  member('Miles', 'Miles', 'Okafor'),
  member('Derry', 'Derry', 'Nakamura'),
  member('Lindsay', 'Lindsay', 'Reyes'),
  member('Cam', 'Cam', 'Whitfield'),
  member('Briana', 'Briana', 'Cortez'),
];

function teamAvatars() {
  return within(screen.getByTestId('project-chat-team')).getAllByTestId(
    'chat-avatar',
  );
}

describe('fix-468 — the header shows the internal team', () => {
  beforeEach(() => {
    mocks.projects = [TEAMED];
    mocks.members = ROSTER;
    // ★ Messages are present and authored by somebody who is NOT on the team,
    //   in every case below. If this header ever slipped back to reading
    //   authors, "Briana" would appear where a role should be.
    mocks.messages = [message({ author_name: 'Briana' })];
  });

  it('★★★ all five roles filled → five avatars, in TEAM_INTERNAL_ROWS order', () => {
    renderModal([TEAM_PERMIT]);
    const avatars = teamAvatars();
    expect(avatars).toHaveLength(5);
    // ACQ · ENT · SD · DM · DA — the order read from the layout table (fix-423),
    // not retyped in the component.
    expect(avatars.map((a) => a.textContent)).toEqual([
      'TS', // Taylor Shaw     — Acquisitions
      'MO', // Miles Okafor    — Entitlements
      'DN', // Derry Nakamura  — Schematic design
      'LR', // Lindsay Reyes   — Design Manager
      'CW', // Cam Whitfield   — Design Associate
    ]);
    // ★ Role AND full name in the title: the role is the half a circle of
    //   letters cannot carry.
    expect(avatars[3]!.getAttribute('title')).toBe('Design Manager · Lindsay Reyes');
  });

  it('★★★ an unfilled role leaves NO gap and NO placeholder', () => {
    // fix-347's rule: an unfilled role simply resolves to fewer people. This is
    // a read-only header, not the editing surface the Team card is, so there is
    // nothing here for a placeholder to invite you to do.
    mocks.projects = [{ ...TEAMED, schematic_designer: [] } as unknown as Project];
    renderModal([TEAM_PERMIT]);
    const avatars = teamAvatars();
    expect(avatars).toHaveLength(4);
    expect(avatars.map((a) => a.textContent)).toEqual(['TS', 'MO', 'LR', 'CW']);
    // ★ No empty circle smuggled in as a spacer — `initialsOf` renders '··' for
    //   a blank name, so this is the exact shape a placeholder would take.
    for (const a of avatars) expect(a.textContent).not.toBe('··');
  });

  it('★★★ no role filled → the row does not render at all', () => {
    // fix-406's rule, and the same one fix-467 applied to zero authors.
    mocks.projects = [
      {
        ...PROJECT,
        acq_lead: null,
        entitlement_lead: null,
        schematic_designer: [],
        design_manager: null,
      } as unknown as Project,
    ];
    renderModal([PERMIT]); // a permit carrying no ent_lead / dm / da
    expect(screen.queryByTestId('project-chat-team')).toBeNull();
    // ★ …and the heading is unaffected: the address still names the project.
    expect(screen.getByTestId('project-chat-title').textContent).toBe(
      '3505 Densmore Ave N',
    );
  });

  it('★★★ two schematic designers → TWO avatars, not one joined string', () => {
    // ★★ MEASURED ON PROD 2026-09-01 BEFORE WRITING THIS: `schematic_designer`
    //    is `text[]`; 202 projects carry one, **max array length 1**, and no
    //    element contains a comma. So the comma-joining the Team card does
    //    (ProjectDetailHeader — "a second designer silently dropped is the kind
    //    of half-truth this card keeps being fixed for") is a DISPLAY choice on
    //    a one-line row; the shared shape hands back an array. This header
    //    renders one avatar per ELEMENT and never splits a string — splitting
    //    would one day cut a name in half.
    //
    // ★ No project is in this state today. The column and the Team card both
    //   anticipate it, so the header must too, and this is the test that keeps
    //   that true before the first one appears.
    mocks.projects = [
      { ...TEAMED, schematic_designer: ['Derry', 'Briana'] } as unknown as Project,
    ];
    renderModal([TEAM_PERMIT]);
    // Six people, so five show and one goes to the overflow.
    expect(teamAvatars().map((a) => a.textContent)).toEqual([
      'TS',
      'MO',
      'DN',
      'BC', // the second designer — present, not dropped
      'LR',
    ]);
    expect(screen.getByTestId('project-chat-team-overflow').textContent).toBe('+1');
  });

  it('★★ one person in two roles renders ONCE, with both roles in the title', () => {
    // The roster is one row per person per role and a project can legitimately
    // name the same person twice — a DM who is also the DA is a real shape.
    // Two circles with the same letters would read as two people.
    renderModal([{ ...TEAM_PERMIT, da: 'Lindsay' } as unknown as Permit]);
    const avatars = teamAvatars();
    expect(avatars).toHaveLength(4);
    expect(avatars.map((a) => a.textContent)).toEqual(['TS', 'MO', 'DN', 'LR']);
    expect(avatars[3]!.getAttribute('title')).toBe(
      'Design Manager, Design Associate · Lindsay Reyes',
    );
  });

  it('★★ past five it collapses to +N, and the overflow names the rest', () => {
    // fix-467's instinct, kept: the overflow is not a dead count.
    mocks.projects = [
      { ...TEAMED, schematic_designer: ['Derry', 'Briana'] } as unknown as Project,
    ];
    renderModal([TEAM_PERMIT]);
    expect(teamAvatars()).toHaveLength(5);
    const more = screen.getByTestId('project-chat-team-overflow');
    expect(more.textContent).toBe('+1');
    expect(more.getAttribute('title')).toContain('Cam Whitfield');
    expect(more.getAttribute('title')).toContain('Design Associate');
  });

  it('★★★ PROPERTY: the row renders NOTHING that projectInternalTeam did not return', () => {
    // ★★★ THE ASSERTION THAT MAKES THIS TICKET STAY FIXED. It does not check
    //     five names — it checks that the rendered subtree cannot hold a name
    //     from ANY other source. That is what stops it drifting back into an
    //     author list, an `@` tag, or a hand-built lookup: all three would
    //     introduce a name this set does not contain.
    mocks.projects = [TEAMED];
    mocks.messages = [
      message({ id: 'm-1', author_name: 'Briana', body: '@project @Corrections' }),
      message({ id: 'm-2', author_name: 'Ainsley' }),
    ];
    renderModal([TEAM_PERMIT]);

    const onTeam = projectTeamNames(
      projectInternalTeam(TEAMED, TEAM_PERMIT as never),
    );
    const allowedFull = new Set(
      onTeam.map((n) => {
        const m = ROSTER.find(
          (r) => (r.name ?? '').toLowerCase() === n.toLowerCase(),
        )!;
        return `${m.first_name} ${m.last_name}`;
      }),
    );

    const row = screen.getByTestId('project-chat-team');
    for (const a of within(row).getAllByTestId('chat-avatar')) {
      // Every title ends "· <full name>", and that person must be on the team.
      const person = (a.getAttribute('title') ?? '').split(' · ').pop()!;
      expect(allowedFull.has(person), `${person} is not on the team`).toBe(true);
    }

    // ★ The authors of the two messages are NOT on this team and must not
    //   appear anywhere in the row — the exact regression this replaces.
    expect(row.outerHTML).not.toContain('Briana');
    expect(row.outerHTML).not.toContain('Ainsley');
    // ★ …and no tag ever reaches a row of faces (fix-467's property, kept).
    expect(row.textContent).not.toContain('@');
  });

  it('★★★ the component no longer reads author_name AT ALL', () => {
    // Stated as behaviour rather than as a grep: with NO messages in the thread
    // the team row is identical, which is only possible if messages play no
    // part in building it.
    renderModal([TEAM_PERMIT]);
    const withMessages = screen.getByTestId('project-chat-team').textContent;
    cleanup();
    mocks.messages = [];
    renderModal([TEAM_PERMIT]);
    expect(screen.getByTestId('project-chat-team').textContent).toBe(withMessages);
  });
});
