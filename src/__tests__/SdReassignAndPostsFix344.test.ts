import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_344_sd_reassign_and_default_posts.sql?raw';
import {
  projectInternalTeam,
  projectTagNames,
  projectTeamNames,
} from '../lib/projectTeam';
import { PROJECT_TAG, SMART_TAGS, projectTagTarget } from '../lib/mentionTags';
import { resolvePrimaryAssignee } from '../lib/taskTeam';
import type { MentionablePerson, PermitWithCycles, Project, TeamMember } from '../lib/database.types';

/** The migration with its `--` prose stripped: what it DOES, not what it says
 *  about itself. The header explains that Seattle calls this a PAR and the
 *  Eastside a pre-sub, which is exactly the text the assertions below must not
 *  trip over. */
const SQL = MIGRATION.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');

// ===========================================================================
// fix-344 — reassign the SD, three default posts, and @project drops the SD
// ===========================================================================
//
// ★ Measured before building, so it is sized right: `schematic_designer` is an
// ARRAY that has NEVER held more than one name (0 projects with two, 34 with
// one, 119 with none), and SD-role people hold FOUR open tasks in total. The
// task-moving half is tiny today; the feature earns its keep going forward.

const ME = 'u-bobby';
const MILES = 'u-miles';
const DERRY = 'u-derry';
const ANA = 'u-ana';
const DAVE = 'u-dave';
const NICKY = 'u-nicky';

function person(user_id: string, name: string): MentionablePerson {
  return { user_id, name, email: `${name.toLowerCase()}@blueprintcap.com` };
}
const PEOPLE: MentionablePerson[] = [
  person(ME, 'Bobby'),
  person(MILES, 'Miles'),
  person(DERRY, 'Derry'),
  person(ANA, 'Ana'),
  person(DAVE, 'Dave'),
  person(NICKY, 'Nicky'),
];
function member(name: string, role = 'da'): TeamMember {
  return {
    id: `tm-${name}`,
    name,
    role,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-08-19T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
  } as unknown as TeamMember;
}
const MEMBERS = [
  member('Bobby', 'ent_lead'),
  member('Miles', 'ent'),
  member('Derry', 'dm'),
  member('Ana', 'schematic'),
  member('Dave', 'schematic'),
  member('Nicky', 'da'),
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
function bp(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
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
// ★★ §3 — @project drops the SD, and ONLY the tag changes
// ---------------------------------------------------------------------------

describe('fix-344 §3: @project is ACQ · ENT · DM · DA', () => {
  it('★★ resolves without the schematic designer', () => {
    const tag = projectTagTarget({
      project: project(),
      bp: bp(),
      people: PEOPLE,
      members: MEMBERS,
    });
    expect(tag.name).toBe(PROJECT_TAG);
    expect(tag.userIds).toEqual([MILES, DERRY, NICKY]);
    // ★ Ana IS the project's SD, and is deliberately not notified.
    expect(tag.userIds).not.toContain(ANA);
  });

  // ★★ THE DIVERGENCE, asserted from both sides: one definition, two consumers
  // with different needs. Removing `sd` from the shared shape would have taken
  // the schematic designer off the Team card to fix a mention list.
  it('★★ the shared team keeps the SD; only the tag list drops it', () => {
    const team = projectInternalTeam(project(), bp());
    expect(team.sd).toEqual(['Ana']);
    expect(projectTeamNames(team)).toEqual(['Miles', 'Ana', 'Derry', 'Nicky']);
    expect(projectTagNames(team)).toEqual(['Miles', 'Derry', 'Nicky']);
  });

  // ★ The Team card renders `internal.sd` and TeamRosterFix321 asserts that row
  // reads the project's schematic designer — that contract is untouched and
  // still passing. This is its pure half.
  it('★ a project with no SD is unaffected either way', () => {
    const team = projectInternalTeam(project({ schematic_designer: [] }), bp());
    expect(team.sd).toEqual([]);
    expect(projectTagNames(team)).toEqual(projectTeamNames(team));
  });

  // ★★ CLOSED DECISION: fix-347 proposed @design and Bobby declined — "don't
  // create the design tag, we can create it if needed."
  it('★★ there is still exactly ONE smart tag, and it is @project', () => {
    expect([...SMART_TAGS]).toEqual([PROJECT_TAG]);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §1 — the reassign
// ---------------------------------------------------------------------------
//
// ★ The RPC is exercised END TO END against production inside a rolled-back
// transaction (transcript in the PR): Ana → Dave moved 1 open task, left the
// resolved one on Ana, moved the co-assignee row, left the role-assigned task
// alone, and wrote one ledger row; then → nobody cleared the field and
// unassigned the task. What CI asserts is the SQL's shape and the decision
// that shape encodes.

describe('fix-344 §1: reassigning the schematic designer', () => {
  it('★ moves the old SD\'s OPEN tasks, scoped to this project', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.permit_tasks t[\s\S]*SET assigned_to = v_to/);
    expect(MIGRATION).toMatch(/AND p\.project_id = p_project_id/);
    expect(MIGRATION).toMatch(/AND t\.completion_status <> 'Resolved'/);
    expect(MIGRATION).toMatch(/AND t\.assigned_to = v_from/);
  });

  // ★★★ THE DECISION THE BRIEF ASKED FOR. A role-valued assignee names the
  // ROLE, and fix-238 resolves it to whoever holds that role ON THIS PROJECT at
  // READ time — so it already follows the new SD. Rewriting it to a person's
  // name would freeze a dynamic assignment into a static one.
  it('★★★ a "Schematic Team" task is NOT rewritten — it re-resolves instead', () => {
    // What RUNS only ever matches the PERSON's name — the role string appears
    // in the header note explaining this decision, and nowhere else.
    expect(SQL).not.toMatch(/Schematic Team/);
    // …and this is why that is right: the same stored value points at whoever
    // holds the role now.
    const ctx = (sd: string | null) => ({
      da: 'Nicky',
      entLead: 'Miles',
      dm: 'Derry',
      schematicDesigners: sd ? [sd] : [],
    });
    expect(resolvePrimaryAssignee('Schematic Team', ctx('Ana'), 'arch')).toBe('Ana');
    expect(resolvePrimaryAssignee('Schematic Team', ctx('Dave'), 'arch')).toBe('Dave');
    // ★ And with nobody in the role it falls back to the role's own label
    // rather than to a stale name — it never keeps pointing at Ana.
    expect(resolvePrimaryAssignee('Schematic Team', ctx(null), 'arch')).toBe(
      'Schematic Team',
    );
  });

  it('★ reassigning to NOBODY is a first-class case', () => {
    // The field is emptied rather than set to a name…
    expect(MIGRATION).toMatch(/WHEN v_to IS NULL THEN ARRAY\[\]::text\[\]/);
    // …the co-assignee rows are removed rather than re-pointed…
    expect(MIGRATION).toMatch(/IF v_to IS NULL THEN\s+DELETE FROM public\.permit_task_assignees/);
    // …and `to_sd` is nullable, so the ledger can record the move.
    expect(MIGRATION).toMatch(/to_sd\s+text,/);
  });

  it('★ resolved tasks keep the name that did the work', () => {
    const clauses = MIGRATION.match(/completion_status <> 'Resolved'/g) ?? [];
    // The task update, and each of the two co-assignee statements.
    expect(clauses.length).toBeGreaterThanOrEqual(3);
  });

  it('★★ the handoff is recorded, following fix-225', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.project_sd_handoffs/);
    expect(MIGRATION).toMatch(/INSERT INTO public\.project_sd_handoffs/);
    expect(MIGRATION).toMatch(/actor_uid/);
    // Admin-gated in the RPC AND in RLS — both layers, like fix-225.
    expect(MIGRATION).toMatch(/NOT public\.is_tenant_admin\(v_tenant\)/);
    expect(MIGRATION).toMatch(/CREATE POLICY project_sd_handoffs_admin_write/);
  });

  it('★ the column type is not changed, and the write stays one element', () => {
    expect(MIGRATION).not.toMatch(/ALTER TABLE public\.projects[\s\S]*schematic_designer/);
    expect(MIGRATION).toMatch(/ARRAY\[v_to\]/);
  });
});

// ---------------------------------------------------------------------------
// ★★ §2 — the three posts
// ---------------------------------------------------------------------------

describe('fix-344 §2: three posts on every new project', () => {
  it('★ exactly three, with the right titles, in order', () => {
    const seeds = [...MIGRATION.matchAll(/\((\d), '([^']+)',/g)].map((m) => [
      Number(m[1]),
      m[2],
    ]);
    expect(seeds).toEqual([
      [1, 'ACQ Questions'],
      [2, 'Design Phase'],
      [3, 'Preliminary Assessment'],
    ]);
    expect(MIGRATION).toMatch(/ORDER BY ord/);
  });

  // ★★★ Bobby chose the term that describes the DOCUMENT so neither side of
  // the lake has to translate: Seattle says PAR, the Eastside says pre-sub.
  it('★★★ the third post is never re-rendered per jurisdiction', () => {
    expect(SQL).toMatch(/Preliminary Assessment/);
    // ★ The header note explains that Seattle says PAR and the Eastside says
    // pre-sub — which is exactly why these assertions read what RUNS, not what
    // the file says about itself.
    expect(SQL).not.toMatch(/\bPAR\b/);
    expect(SQL).not.toMatch(/pre-sub/i);
    // No branch on jurisdiction anywhere in the executable half.
    expect(SQL).not.toMatch(/juris/i);
  });

  // ★★ NEW PROJECTS ONLY. 153 × 3 = 459 empty threads, and an empty post is
  // worse than no post — it makes the chat look abandoned.
  it('★★ nothing backfills an existing project', () => {
    // The only insert into project_messages is the per-row seed…
    const inserts = MIGRATION.match(/INSERT INTO public\.project_messages/g) ?? [];
    expect(inserts).toHaveLength(1);
    // …driven by an AFTER INSERT trigger, not by a sweep over the table.
    expect(MIGRATION).toMatch(/AFTER INSERT ON public\.projects/);
    expect(MIGRATION).not.toMatch(/FROM public\.projects\s+WHERE[\s\S]*bp_seed_project_posts/);
  });

  it('★ creating a project twice does not produce six posts', () => {
    expect(MIGRATION).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.project_messages m/);
    expect(MIGRATION).toMatch(/AND m\.title = v_seed\.title/);
    expect(MIGRATION).toMatch(/AND m\.parent_message_id IS NULL/);
  });

  it('★ they are ordinary posts — fix-334\'s rules apply unchanged', () => {
    // A post is a message with a title and no parent. Nothing here invents a
    // flag, a type column or a second table.
    expect(MIGRATION).toMatch(/title, body, parent_message_id/);
    expect(MIGRATION).toMatch(/v_seed\.title, v_seed\.body, NULL/);
    // The author is the person who created the project, so the thread has a
    // real byline rather than "Unknown".
    expect(MIGRATION).toMatch(/v_author uuid := auth\.uid\(\)/);
  });
});
