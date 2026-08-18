import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  PROJECT_TAG,
  customTagTarget,
  mentionTargets,
  projectTagTarget,
  resolveRosterNames,
  type MentionTag,
} from '../lib/mentionTags';
import { projectInternalTeam, projectTeamNames } from '../lib/projectTeam';
import {
  emptyMentionTargets,
  mentionRanges,
  parseMentions,
  splitBody,
  unresolvedMentions,
} from '../lib/projectChat';
import { buildNewItems } from '../lib/boardReads';
import { reactionAudience } from '../lib/reactionAudience';
import type {
  MentionablePerson,
  PermitWithCycles,
  Project,
  ProjectMessage,
  TeamMember,
} from '../lib/database.types';

// ===========================================================================
// fix-347 — reactions that show who has NOT seen it, and two kinds of tag
// ===========================================================================
//
// ★★★ THE PRINCIPLE (the brief's §0). Bobby has described the same idea from
// six directions now, and this is the seventh: "we can hover over that thumbs
// up and see… IF ANYONE MISSED THAT POST AND DIDN'T REACT."
//
// The reaction is a READ RECEIPT and the question asked of it is the NEGATIVE
// one. That needs an AUDIENCE, which is what the tags define — which is why all
// three features are one ticket rather than three.
//
// ★★ AND THE RULE THAT MAKES IT AUDITABLE (§4): a tag DISPLAYS as its name and
// STORES its people. Everything below is either that rule or a consequence of
// it.

const ME = 'u-bobby';
const MILES = 'u-miles';
const DERRY = 'u-derry';
const ANA = 'u-ana';
const NICKY = 'u-nicky';
const NIDHI = 'u-nidhi'; // departed

function person(user_id: string, name: string): MentionablePerson {
  return { user_id, name, email: `${name.toLowerCase()}@blueprintcap.com` };
}

const PEOPLE: MentionablePerson[] = [
  person(ME, 'Bobby'),
  person(MILES, 'Miles'),
  person(DERRY, 'Derry'),
  person(ANA, 'Ana'),
  person(NICKY, 'Nicky'),
  person(NIDHI, 'Nidhi'),
];

function member(name: string, over: Partial<TeamMember> = {}): TeamMember {
  return {
    id: `tm-${name}`,
    name,
    role: 'da',
    active: true,
    former: false,
    email: `${name.toLowerCase()}@blueprintcap.com`,
    notes: null,
    updated_at: '2026-08-19T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

const MEMBERS: TeamMember[] = [
  member('Bobby', { role: 'ent_lead' }),
  member('Miles', { role: 'ent' }),
  member('Derry', { role: 'dm' }),
  member('Ana', { role: 'schematic' }),
  member('Nicky'),
  // ★ Departed — fix-321's rule says a tag must never resolve to her.
  member('Nidhi', { active: false, former: true }),
];

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    address: '224 2nd Ave N',
    acq_lead: null,
    entitlement_lead: 'Miles',
    design_manager: 'Derry',
    schematic_designer: ['Ana'],
    ...over,
  } as Project;
}

function bpPermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 100,
    project_id: 'p-1',
    type: 'Building Permit',
    ent_lead: null,
    dm: null,
    da: 'Nicky',
    ...over,
  } as unknown as PermitWithCycles;
}

// ---------------------------------------------------------------------------
// ★★★ §3 — the smart tag
// ---------------------------------------------------------------------------

describe('fix-347 §3: @project is a NAME plus a QUERY', () => {
  // ★★ fix-344 §3 NARROWED THE TAG, and only the tag: "For the @project, we
  // generally don't need the SD mentioned. So everyone but the SD!" The card
  // still shows five rows; the tag notifies four of them.
  it('★★ reads the Team card computation — one definition, two consumers', () => {
    const team = projectInternalTeam(project(), bpPermit());
    // The card's five rows: ACQ · ENT · SD · DM · DA — Ana (SD) included.
    expect(projectTeamNames(team)).toEqual(['Miles', 'Ana', 'Derry', 'Nicky']);
    const tag = projectTagTarget({
      project: project(),
      bp: bpPermit(),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(tag.name).toBe(PROJECT_TAG);
    // …and the tag is those people minus the SD (fix-344 §3).
    expect(tag.userIds).toEqual([MILES, DERRY, NICKY]);
  });

  // ★★ THE WHOLE POINT of a smart tag: the same token, a different audience.
  it('★★★ the same @project on two projects notifies two different sets', () => {
    const a = projectTagTarget({
      project: project(),
      bp: bpPermit(),
      people: PEOPLE,
      members: MEMBERS,
    });
    const b = projectTagTarget({
      project: project({
        id: 'p-2',
        entitlement_lead: 'Bobby',
        design_manager: null,
        schematic_designer: [],
      }),
      bp: bpPermit({ da: 'Miles' }),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(a.userIds).toEqual([MILES, DERRY, NICKY]);
    expect(b.userIds).toEqual([ME, MILES]);
    expect(a.userIds).not.toEqual(b.userIds);
  });

  // ★ "A smart tag on a project with an unfilled role simply resolves to fewer
  // people. It must not error."
  it('★ an unfilled role yields fewer people, not an error', () => {
    const tag = projectTagTarget({
      project: project({ design_manager: null, schematic_designer: [] }),
      bp: bpPermit({ da: null }),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(tag.userIds).toEqual([MILES]);
  });

  it('★ a project with nobody on it resolves to nobody, and says so', () => {
    const tag = projectTagTarget({
      project: project({
        entitlement_lead: null,
        design_manager: null,
        schematic_designer: [],
      }),
      bp: bpPermit({ da: null }),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(tag.userIds).toEqual([]);
    expect(tag.hint).toMatch(/nobody/i);
  });

  // ★ fix-321's rule, in a tag.
  it('★★ former staff are never resolved into a tag', () => {
    const tag = projectTagTarget({
      project: project({ design_manager: 'Nidhi' }),
      bp: bpPermit({ da: null }),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(tag.userIds).not.toContain(NIDHI);
    expect(resolveRosterNames(['Nidhi'], PEOPLE, MEMBERS)).toEqual([]);
    // …and somebody the roster has never heard of is UNKNOWN, not departed:
    // they simply have no login to resolve to.
    expect(resolveRosterNames(['Stranger'], PEOPLE, MEMBERS)).toEqual([]);
  });

  it('★ the per-permit ENT override is part of the definition, as on the card', () => {
    const tag = projectTagTarget({
      project: project(),
      bp: bpPermit({ ent_lead: 'Bobby' }),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(tag.userIds).toContain(ME);
    expect(tag.userIds).not.toContain(MILES);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §4 — display the tag, store the people
// ---------------------------------------------------------------------------

describe('fix-347 §4: a tag displays its name and stores its people', () => {
  const projectTag = () =>
    projectTagTarget({
      project: project(),
      bp: bpPermit(),
      people: PEOPLE,
      members: MEMBERS,
    });
  const LEADERSHIP: MentionTag = {
    id: 'tag-1',
    name: 'Leadership',
    member_ids: [ME, DERRY],
  };
  const targets = () =>
    mentionTargets({ people: PEOPLE, tags: [LEADERSHIP], projectTag: projectTag() });

  it('★★★ BOTH kinds write RESOLVED IDS into mentions', () => {
    expect(parseMentions('heads up @project', targets()).sort()).toEqual(
      // ★ fix-344 §3: ACQ · ENT · DM · DA — Ana (SD) is on the card, not here.
      [MILES, DERRY, NICKY].sort(),
    );
    expect(parseMentions('@Leadership please look', targets()).sort()).toEqual(
      [ME, DERRY].sort(),
    );
    // …and a person still resolves to exactly themselves.
    expect(parseMentions('@Miles?', targets())).toEqual([MILES]);
  });

  it('★ the TEXT keeps the tag — "@project" reads better than five names', () => {
    const segs = splitBody('ping @project now', targets());
    const mention = segs.find((s) => s.mention)!;
    expect(mention.text).toBe('@project');
    expect(mention.kind).toBe('smart');
    expect(mention.userIds).toEqual([MILES, DERRY, NICKY]);
  });

  // ★★★ THE AUDITABILITY RULE, which is what makes an editable tag safe.
  it('★★★ editing a tag AFTER a message was sent does not change who it notified', () => {
    const sentWith = parseMentions('@Leadership look', targets());
    expect(sentWith.sort()).toEqual([ME, DERRY].sort());

    // The admin edits the tag: Derry out, Ana and Nicky in.
    const edited: MentionTag = {
      ...LEADERSHIP,
      member_ids: [ME, ANA, NICKY],
    };
    const laterTargets = mentionTargets({
      people: PEOPLE,
      tags: [edited],
      projectTag: projectTag(),
    });
    // A NEW message reaches the new set…
    expect(parseMentions('@Leadership look', laterTargets).sort()).toEqual(
      [ME, ANA, NICKY].sort(),
    );
    // ★ …and the OLD message is untouched: what it stored is what it reached.
    // Nothing in this codebase re-resolves a sent message's mentions — the
    // column is the record.
    expect(sentWith.sort()).toEqual([ME, DERRY].sort());
  });

  it('★★ the stored ids are what the bell notifies — end to end through fix-307', () => {
    const ids = parseMentions('@project standup at 3', targets());
    const message = {
      id: 'm-1',
      project_id: 'p-1',
      body: '@project standup at 3',
      created_at: '2026-08-19T10:00:00Z',
      mentions: ids,
    };
    // Each resolved person gets exactly one bell item…
    for (const uid of ids) {
      const items = buildNewItems({
        flips: [],
        tasks: [],
        acks: [],
        permits: [],
        viewerName: 'Anyone',
        mentions: [message],
        viewerUserId: uid,
        projects: [{ id: 'p-1', address: '224 2nd Ave N' }],
      });
      expect(items.filter((i) => i.source === 'mention')).toHaveLength(1);
    }
    // …and somebody the tag did not resolve to gets none.
    const outsider = buildNewItems({
      flips: [],
      tasks: [],
      acks: [],
      permits: [],
      viewerName: 'Anyone',
      mentions: [message],
      viewerUserId: NIDHI,
      projects: [],
    });
    expect(outsider).toHaveLength(0);
  });

  it('★ a tag that resolves to NOBODY is reported before the message is sent', () => {
    const empty = mentionTargets({
      people: PEOPLE,
      tags: [{ id: 't', name: 'Ghosts', member_ids: [] }],
      projectTag: projectTagTarget({
        project: project({
          entitlement_lead: null,
          design_manager: null,
          schematic_designer: [],
        }),
        bp: bpPermit({ da: null }),
        people: PEOPLE,
        members: MEMBERS,
      }),
    });
    expect(emptyMentionTargets('@Ghosts hello', empty)).toEqual(['Ghosts']);
    expect(emptyMentionTargets('@project hello', empty)).toEqual([PROJECT_TAG]);
    // ★ And it is NOT the same complaint as fix-330's: "@Ghosts" DID match a
    // tag, so it is not an unresolved word — the two warnings say different
    // things because they have different fixes.
    expect(unresolvedMentions('@Ghosts hello', empty)).toEqual([]);
    expect(unresolvedMentions('@nobodyatall hi', empty)).toEqual(['@nobodyatall']);
  });

  it('★ a longer tag name is not eaten by a shorter one, either way round', () => {
    const t = mentionTargets({
      people: PEOPLE,
      tags: [
        { id: 'a', name: 'Leads', member_ids: [ME] },
        { id: 'b', name: 'LeadsPlus', member_ids: [MILES, DERRY] },
      ],
      projectTag: null,
    });
    expect(parseMentions('@LeadsPlus go', t).sort()).toEqual([MILES, DERRY].sort());
    expect(parseMentions('@Leads go', t)).toEqual([ME]);
  });

  it('★ the offer list keeps people as PEOPLE and tags as tags', () => {
    const t = mentionTargets({
      people: PEOPLE,
      tags: [LEADERSHIP],
      projectTag: projectTag(),
    });
    // ★ The smart tag leads, then the custom tags, then the people — and the
    // people keep their own shape (user_id + email), which is what the picker
    // needs to key a row and to tell two Matts apart. Flattening them into
    // targets here is what made every option look like a tag.
    expect((t[0] as { kind?: string }).kind).toBe('smart');
    expect((t[1] as { kind?: string }).kind).toBe('tag');
    expect(t.slice(2).every((x) => 'user_id' in x)).toBe(true);
    expect(customTagTarget(LEADERSHIP).hint).toBe('2 people');
  });
});

// ---------------------------------------------------------------------------
// ★★ §2 — the custom tags, and who owns them
// ---------------------------------------------------------------------------

describe('fix-347 §2: a custom tag is a name plus a membership list', () => {
  it('★ it notifies exactly its members — no more, no fewer', () => {
    const t = mentionTargets({
      people: PEOPLE,
      tags: [{ id: 'x', name: 'Survey', member_ids: [ANA, NICKY] }],
      projectTag: null,
    });
    expect(parseMentions('@Survey can you look', t).sort()).toEqual(
      [ANA, NICKY].sort(),
    );
  });

  it('★ an empty tag notifies nobody, and is flagged rather than sent quietly', () => {
    const t = mentionTargets({
      people: PEOPLE,
      tags: [{ id: 'x', name: 'Empty', member_ids: [] }],
      projectTag: null,
    });
    expect(parseMentions('@Empty hello', t)).toEqual([]);
    expect(emptyMentionTargets('@Empty hello', t)).toEqual(['Empty']);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §1 — reactions, and the negative view
// ---------------------------------------------------------------------------

describe('fix-347 §1: the audience a "not reacted" view diffs against', () => {
  it('★★★ a TAGGED post is diffed against exactly who it notified', () => {
    const a = reactionAudience({
      mentions: [MILES, DERRY, ANA],
      projectTeamIds: [ME],
    })!;
    expect(a.userIds).toEqual([MILES, DERRY, ANA]);
    expect(a.label).toMatch(/tagged/i);
  });

  // ★ THE CHOICE, stated rather than invented silently: an untagged post is
  // diffed against the project's team, and the UI says which set it used.
  it('★★ an UNTAGGED post falls back to the project team, and labels it', () => {
    const a = reactionAudience({ mentions: [], projectTeamIds: [MILES, DERRY] })!;
    expect(a.userIds).toEqual([MILES, DERRY]);
    expect(a.label).toMatch(/project/i);
  });

  it('★ with neither, there is no audience — and no fake 0 of 0', () => {
    expect(reactionAudience({ mentions: [], projectTeamIds: [] })).toBeNull();
    expect(reactionAudience({ mentions: null, projectTeamIds: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rendered half
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: unknown }[],
  reactions: [] as unknown[],
  people: [] as unknown[],
  tags: [] as unknown[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      db.rpcCalls.push({ name, args });
      if (name === 'bp_list_message_reactions') {
        return Promise.resolve({ data: db.reactions, error: null });
      }
      if (name === 'bp_mentionable_people') {
        return Promise.resolve({ data: db.people, error: null });
      }
      if (name === 'bp_list_mention_tags') {
        return Promise.resolve({ data: db.tags, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
  supabaseUrl: 'http://test.local',
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: ME, email: 'robertd@blueprintcap.com' },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateTaskFromMessage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: MEMBERS, isLoading: false, error: null, refetch: vi.fn() }),
  };
});

import ChatMessageRow from '../components/ProjectDetail/ChatMessageRow';

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: MILES,
    author_name: 'Miles',
    body: 'Plans are out for review @project',
    mentions: [MILES, DERRY, ANA, NICKY],
    attachments: [],
    created_at: '2026-08-19T10:00:00Z',
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

function reaction(user_id: string, name: string, emoji = '👍') {
  return { message_id: 'm-1', emoji, user_id, user_name: name };
}

function renderRow(over: Partial<ProjectMessage> = {}, reactions = db.reactions) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ChatMessageRow
      message={message(over)}
      projectId="p-1"
      userId={ME}
      people={PEOPLE}
      reactions={reactions as never}
      projectTeamIds={[MILES, ANA, DERRY, NICKY]}
      permits={[]}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  db.rpcCalls.length = 0;
  db.reactions = [];
  db.people = PEOPLE;
  db.tags = [];
});

describe('fix-347 §1: the reaction bar, rendered', () => {
  it('★ counts without interaction, and names on hover', () => {
    db.reactions = [reaction(MILES, 'Miles'), reaction(DERRY, 'Derry')];
    renderRow();
    const chip = screen.getByTestId('chat-reaction-m-1-👍');
    expect(chip.textContent).toContain('2');
    // ★ The names are the hover — Bobby asked for both, in that order.
    expect(chip.getAttribute('title')).toContain('Miles');
    expect(chip.getAttribute('title')).toContain('Derry');
    expect(chip.dataset.names).toBe('Miles, Derry');
  });

  it('★ reacting toggles: the same click adds, then removes', async () => {
    renderRow();
    fireEvent.click(screen.getByTestId('chat-react-open-m-1'));
    fireEvent.click(screen.getByTestId('chat-react-pick-m-1-👍'));
    await waitFor(() =>
      expect(
        db.rpcCalls.filter((c) => c.name === 'bp_toggle_message_reaction'),
      ).toHaveLength(1),
    );
    expect(db.rpcCalls.at(-1)!.args).toEqual({
      p_message_id: 'm-1',
      p_emoji: '👍',
    });

    // Mine, shown as mine — clicking the chip sends the same toggle again.
    db.reactions = [reaction(ME, 'Bobby')];
    renderRow();
    const chip = screen.getByTestId('chat-reaction-m-1-👍');
    expect(chip.dataset.mine).toBe('true');
    fireEvent.click(chip);
    await waitFor(() =>
      expect(
        db.rpcCalls.filter((c) => c.name === 'bp_toggle_message_reaction'),
      ).toHaveLength(2),
    );
  });

  // ★★★ THE FEATURE. Bobby: "…and see if anyone missed that post."
  it('★★★ names who was expected and has NOT reacted', () => {
    db.reactions = [reaction(MILES, 'Miles'), reaction(ANA, 'Ana', '❤️')];
    renderRow();
    const line = screen.getByTestId('chat-reactions-not-yet-m-1');
    // The post tagged Miles, Derry, Ana and Nicky; two have answered.
    expect(line.dataset.notYet).toBe('Derry, Nicky');
    expect(screen.getByTestId('chat-reactions-audience-m-1').dataset.expected).toBe('4');
    expect(
      screen.getByTestId('chat-reactions-audience-m-1').dataset.audience,
    ).toMatch(/tagged/i);
    // ★ ANY emoji counts as seen — Ana's ❤️ is an acknowledgement too.
    expect(line.dataset.notYet).not.toContain('Ana');
  });

  it('★★ an untagged post diffs against the project team, and says so', () => {
    db.reactions = [reaction(MILES, 'Miles')];
    renderRow({ mentions: [] });
    expect(
      screen.getByTestId('chat-reactions-audience-m-1').dataset.audience,
    ).toMatch(/project/i);
    expect(screen.getByTestId('chat-reactions-not-yet-m-1').dataset.notYet).toBe(
      'Ana, Derry, Nicky',
    );
  });

  // ★★ "Do not let a reaction notify anyone."
  it('★★★ reacting notifies nobody and creates no board item', async () => {
    renderRow();
    fireEvent.click(screen.getByTestId('chat-react-open-m-1'));
    fireEvent.click(screen.getByTestId('chat-react-pick-m-1-✅'));
    await waitFor(() =>
      expect(
        db.rpcCalls.some((c) => c.name === 'bp_toggle_message_reaction'),
      ).toBe(true),
    );
    // ★ The ONLY write is the toggle. Nothing posts a message, edits mentions,
    // or writes a board read.
    const writes = db.rpcCalls.filter((c) => c.name !== 'bp_list_message_reactions');
    expect(writes.map((c) => c.name)).toEqual(['bp_toggle_message_reaction']);

    // ★★ And the model that feeds the bell has no reaction source at all: a
    // reaction cannot become a board item because nothing derives one from it.
    const items = buildNewItems({
      flips: [],
      tasks: [],
      acks: [],
      permits: [],
      viewerName: 'Miles',
      mentions: [],
      viewerUserId: MILES,
      projects: [],
    });
    expect(items).toHaveLength(0);
  });

  it('★ a message with no reactions shows no audience line — nothing to say yet', () => {
    renderRow();
    expect(screen.queryByTestId('chat-reactions-audience-m-1')).toBeNull();
    expect(screen.getByTestId('chat-react-open-m-1')).toBeInTheDocument();
  });

  it('★ a deleted message is not asking to be acknowledged', () => {
    renderRow({ deleted_at: '2026-08-19T11:00:00Z' });
    expect(screen.queryByTestId('chat-reactions-m-1')).toBeNull();
  });

  it('★ the tag renders as a mention in the body, not as five names', () => {
    const targets = mentionTargets({
      people: PEOPLE,
      tags: [],
      projectTag: projectTagTarget({
        project: project(),
        bp: bpPermit(),
        people: PEOPLE,
        members: MEMBERS,
      }),
    });
    const ranges = mentionRanges('Plans are out for review @project', targets);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].name).toBe(PROJECT_TAG);
    expect(ranges[0].userIds).toHaveLength(3);
    const row = renderRow();
    expect(
      within(row.container).getByTestId('project-chat-message-m-1').textContent,
    ).toContain('@project');
  });
});


// ---------------------------------------------------------------------------
// ★★ §2 — the editor, and the gate
// ---------------------------------------------------------------------------

import MentionTagsEditor from '../components/Settings/MentionTagsEditor';

function renderTags(readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MentionTagsEditor readOnly={readOnly} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('fix-347 §2: creating and editing a custom tag', () => {
  it('★ a tag is created with a name and an arbitrary set of people', async () => {
    renderTags();
    await waitFor(() =>
      expect(screen.getByTestId('mention-tag-new')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mention-tag-new'));
    fireEvent.change(screen.getByTestId('mention-tag-name'), {
      target: { value: 'Leadership' },
    });
    fireEvent.click(screen.getByTestId(`mention-tag-member-${DERRY}`));
    fireEvent.click(screen.getByTestId(`mention-tag-member-${ANA}`));
    fireEvent.click(screen.getByTestId('mention-tag-save'));

    await waitFor(() =>
      expect(
        db.rpcCalls.some((c) => c.name === 'bp_upsert_mention_tag'),
      ).toBe(true),
    );
    const call = db.rpcCalls.find((c) => c.name === 'bp_upsert_mention_tag')!;
    // ★ "a different combination of anyone in the tool" — no role, no project,
    // just the people picked.
    expect(call.args).toEqual({
      p_id: null,
      p_name: 'Leadership',
      p_member_ids: [DERRY, ANA],
    });
  });

  it('★ an existing tag is edited in place, membership replaced whole', async () => {
    db.tags = [{ id: 'tag-1', name: 'Leadership', member_ids: [DERRY] }];
    renderTags();
    await waitFor(() =>
      expect(screen.getByTestId('mention-tag-edit-Leadership')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mention-tag-edit-Leadership'));
    // Derry out, Nicky in.
    fireEvent.click(screen.getByTestId(`mention-tag-member-${DERRY}`));
    fireEvent.click(screen.getByTestId(`mention-tag-member-${NICKY}`));
    fireEvent.click(screen.getByTestId('mention-tag-save'));

    await waitFor(() =>
      expect(
        db.rpcCalls.some((c) => c.name === 'bp_upsert_mention_tag'),
      ).toBe(true),
    );
    expect(db.rpcCalls.find((c) => c.name === 'bp_upsert_mention_tag')!.args).toEqual({
      p_id: 'tag-1',
      p_name: 'Leadership',
      p_member_ids: [NICKY],
    });
  });

  // ★★ ADMIN-OWNED. The real gate is the database's — the RPCs raise 42501 and
  // the tables carry no write policy — and this is the half that keeps a
  // non-admin from being offered a button that would fail.
  it('★★ a non-admin sees the tags and none of the controls', async () => {
    db.tags = [{ id: 'tag-1', name: 'Leadership', member_ids: [DERRY] }];
    renderTags(true);
    await waitFor(() =>
      expect(screen.getByTestId('mention-tag-Leadership')).toBeInTheDocument(),
    );
    // Visible — knowing @Leadership exists is what stops five manual @s…
    expect(screen.getByTestId('mention-tag-Leadership').textContent).toContain(
      'Derry',
    );
    // …and not editable.
    expect(screen.queryByTestId('mention-tag-new')).toBeNull();
    expect(screen.queryByTestId('mention-tag-edit-Leadership')).toBeNull();
    expect(screen.queryByTestId('mention-tag-delete-Leadership')).toBeNull();
  });

  it('★ the smart tag is listed and is NOT editable — it is a query, not a list', async () => {
    renderTags();
    await waitFor(() =>
      expect(screen.getByTestId('mention-tag-smart')).toBeInTheDocument(),
    );
    const smart = screen.getByTestId('mention-tag-smart');
    expect(smart.textContent).toContain('@project');
    expect(within(smart).queryByTestId('mention-tag-form')).toBeNull();
  });

  it('★ a departed login is never offered as a member', async () => {
    renderTags();
    await waitFor(() =>
      expect(screen.getByTestId('mention-tag-new')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mention-tag-new'));
    expect(screen.getByTestId(`mention-tag-member-${DERRY}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`mention-tag-member-${NIDHI}`)).toBeNull();
  });
});
