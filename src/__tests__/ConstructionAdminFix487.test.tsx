import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import schemaSql from '../../migrations/fix_487_construction_admin.sql?raw';
import rosterSql from '../../migrations/fix_487_roster_person_details.sql?raw';
import PersonDetailsEditor from '../components/Settings/PersonDetailsEditor';
import {
  ROLE_FAMILY,
  ROLE_SENIORITY,
  ROLE_TITLE,
  ROLE_TITLE_PLURAL,
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  primaryRoles,
  rosterRoleTitle,
} from '../lib/roleLabels';
import { ADD_PERSON_ROLE_OPTIONS } from '../lib/addPerson';
import { TEAM_INTERNAL_ROWS } from '../lib/overviewCardLayout';
import { projectInternalTeam, projectTagNames, projectTeamNames } from '../lib/projectTeam';
import { foldPersonDetails, peopleMissingDetails } from '../lib/personDetails';
import { permitMatchesSelf, projectMatchesSelf } from '../lib/selfScope';
import { TEAM_ROLES } from '../../supabase/functions/admin-create-user/handler';
import type { Permit, Project, TeamMember, TeamRole } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-487 (P-144, P-120) — CONSTRUCTION ADMIN, AND THE ROSTER EDITOR
// ===========================================================================
//
// Bobby, 2026-09-02/03: *"We want to add one more internal position,
// construction admin. There's two people on that team, Steve and David Rice.
// Construction admin will always default to Steve, and as needed Steve would
// hand it off to David Rice… say there's a PPR — they get thrown onto it
// because they're more construction-based, post-permit-issuance."*
//
// And: *"Steve should be the default on every new **project**. He would only
// get assigned to a permit by himself, or ENT in general."*

/** ★ Every role string the app knows, in one place — the list the compiler
 *  cannot check for the ARRAYS (ROLE_SENIORITY) and cannot check at all for
 *  the hand-written ones (ADD_PERSON_ROLE_OPTIONS, the Edge Function). */
const ALL_ROLES: TeamRole[] = [
  'da', 'dm', 'ent', 'ent_lead', 'acq', 'acq_lead', 'schematic', 'director',
  'viewer', 'ca',
];

// ---------------------------------------------------------------------------
// §A · THE VOCABULARY — every place a role is enumerated
// ---------------------------------------------------------------------------

describe('fix-487 §A: the role vocabulary agrees with itself', () => {
  it('★★★ `ca` is in EVERY list a role has to be in', () => {
    // ★★★ THE WHOLE POINT OF THIS SUITE. `Record<TeamRole, …>` catches three of
    //     these at compile time; the rest are hand-written arrays that compile
    //     perfectly while the feature is half-built. The inventory is in the
    //     fix-487 PR body; this is its executable half.
    expect(ROLE_TITLE.ca).toBe('Construction Admin');
    expect(ROLE_TITLE_PLURAL.ca).toBe('Construction Admins');
    expect(ROLE_SENIORITY).toContain('ca');
    expect(Object.keys(ROLE_FAMILY)).toContain('ca');
    expect(ADD_PERSON_ROLE_OPTIONS.map((o) => o.value)).toContain('ca');
    expect(TEAM_ROLES).toContain('ca');
  });

  it('★★★ every list is TOTAL over TeamRole — no half-added role', () => {
    for (const r of ALL_ROLES) {
      expect(ROLE_TITLE[r], r).toBeTruthy();
      expect(ROLE_TITLE_PLURAL[r], r).toBeTruthy();
    }
    expect([...ROLE_SENIORITY].sort()).toEqual([...ALL_ROLES].sort());
    expect(Object.keys(ROLE_TITLE).sort()).toEqual([...ALL_ROLES].sort());
    expect([...TEAM_ROLES].sort()).toEqual([...ALL_ROLES].sort());
    expect(Object.keys(ROLE_FAMILY).sort()).toEqual([...ALL_ROLES].sort());
    expect(ADD_PERSON_ROLE_OPTIONS.map((o) => o.value).sort()).toEqual(
      [...ALL_ROLES].sort(),
    );
  });

  it('★★★ WITHOUT `ADD_PERSON_ROLE_OPTIONS` NOBODY COULD BE MADE A CA', () => {
    // ★★ Stated as its own claim because it is the one silent omission that
    //    would have made the whole ticket inert: the role would exist, the
    //    pickers would read it, and there would be no way to put a person in
    //    it. Nothing about that fails to compile.
    const ca = ADD_PERSON_ROLE_OPTIONS.find((o) => o.value === 'ca');
    expect(ca).toBeTruthy();
    expect(ca!.label).toBe('Construction Admin');
  });

  it('★★★ `ca` is its OWN family — a CA who is also a DM prints both', () => {
    // ★★ A family means "grades of one job, print only the senior" — `ent_lead`
    //    over `ent`. Filing `ca` under `dm` would silently drop one of Derry's
    //    two real jobs if she ever took the second role.
    expect(primaryRoles(['ca', 'dm']).sort()).toEqual(['ca', 'dm']);
    expect(rosterRoleTitle(['ca'])).toBe('Construction Admin');
    expect(rosterRoleTitle(['dm', 'ca'])).toContain('Construction Admin');
    expect(rosterRoleTitle(['dm', 'ca'])).toContain('Design Manager');
    // ★ …and `viewer` still yields to it, like every real role.
    expect(rosterRoleTitle(['viewer', 'ca'])).toBe('Construction Admin');
  });

  it('★★ the DEPARTMENT vocabulary grew in all of its places', () => {
    expect(DEPARTMENTS).toContain('construction_admin');
    expect(DEPARTMENT_LABEL.construction_admin).toBe('Construction Admin');
    // ★★★ fix-464's fifth place: the RPC validates independently of the CHECK,
    //     so widening one and not the other ships a picker offering an option
    //     the writer rejects.
    const cut = schemaSql.indexOf(
      'create or replace function public.bp_set_team_department',
    );
    expect(cut).toBeGreaterThan(-1);
    expect(schemaSql.slice(0, cut)).toContain(`'construction_admin'`);
    expect(schemaSql.slice(cut)).toContain(`'construction_admin'`);
  });
});

// ---------------------------------------------------------------------------
// §A · THE TEAM CARD'S SIXTH BLOCK
// ---------------------------------------------------------------------------

const PROJECT = {
  acq_lead: 'Cam',
  entitlement_lead: 'Bobby',
  design_manager: 'Derry',
  schematic_designer: ['Dave'],
  construction_admin: 'Steve',
} as unknown as Project;

describe('fix-487 §A: the project-level Construction Admin', () => {
  it('★★★ it is the SIXTH block, last, and it comes from the layout table', () => {
    expect(TEAM_INTERNAL_ROWS.map((r) => r.key)).toEqual([
      'acq', 'ent', 'sd', 'dm', 'da', 'ca',
    ]);
    expect(TEAM_INTERNAL_ROWS.at(-1)).toMatchObject({
      key: 'ca',
      label: 'CA',
      title: 'Construction Admin',
    });
  });

  it('★★★ the BP does NOT override the project\'s CA — unlike ENT / DM / DA', () => {
    // ★★★ THE ASYMMETRY, AND IT IS DELIBERATE. A permit-level ENT/DM/DA is the
    //     SAME job done by somebody else on that permit (the PAR/SDOT/ECA
    //     routing pattern), so the card shows the override. A permit-level `ca`
    //     is an EXTRA person pulled onto one permit — Bobby's PPR case — so
    //     letting it override would make one permit's exception rewrite the
    //     Team card for the whole project.
    const bp = { ent_lead: 'Miles', dm: 'Lindsay', da: 'Nicky', ca: 'David' };
    const team = projectInternalTeam(PROJECT, bp as never);
    expect(team.ent).toBe('Miles');
    expect(team.dm).toBe('Lindsay');
    expect(team.da).toBe('Nicky');
    expect(team.ca).toBe('Steve');
  });

  it('★★★ the CA is on the team but NOT on `@project`', () => {
    // ★★★ A JUDGEMENT CALL, FLAGGED FOR BOBBY RATHER THAN SLIPPED IN. His
    //     fix-344 ruling was *"everyone but the SD"*, made when the card had
    //     five rows and every name on it was somebody working that job.
    //     `construction_admin` defaults to Steve on ALL 211 projects, so
    //     including him would turn `@project` — a tag for the handful of people
    //     on this job — into a message to one person about every job in the
    //     company.
    const team = projectInternalTeam(PROJECT, null);
    expect(projectTeamNames(team)).toContain('Steve');
    expect(projectTagNames(team)).not.toContain('Steve');
    // ★ …and the tag still drops the SD and keeps the other three, unchanged.
    expect(projectTagNames(team)).toEqual(['Cam', 'Bobby', 'Derry']);
  });
});

// ---------------------------------------------------------------------------
// §A · THE PERMIT-LEVEL CA, AND THE CASCADE
// ---------------------------------------------------------------------------

describe('fix-487 §A: permits.ca', () => {
  it('★★★ a permit-level CA sees their own permit; the PROJECT twin is NOT widened', () => {
    const permit = {
      ent_lead: null, dm: null, da: null, dual_da: null, ca: 'David',
    } as unknown as Permit;
    expect(permitMatchesSelf(permit, 'David')).toBe(true);
    expect(permitMatchesSelf(permit, 'Steve')).toBe(false);
    // ★ Clearing it takes the permit back out — set AND clear, both directions.
    expect(permitMatchesSelf({ ...permit, ca: null } as Permit, 'David')).toBe(false);

    // ★★★ `projectMatchesSelf` is deliberately NOT widened. Steve is on all 211
    //     projects by default, so a project scope built on `construction_admin`
    //     would be "everything" — which is not a scope, it is the absence of
    //     one. A CA's real work is the permits somebody hands them.
    expect(projectMatchesSelf(PROJECT, 'Steve')).toBe(false);
    expect(projectMatchesSelf(PROJECT, 'Bobby')).toBe(true);
  });

  it('★★★ the cascade watches the COLUMN, not just the function body', () => {
    // ★★★ THE TRAP THIS TICKET NEARLY SHIPPED. `projects_cascade_lead` was
    //     `AFTER UPDATE **OF entitlement_lead**` with a matching WHEN clause,
    //     so a construction_admin block added inside
    //     `bp_trg_project_lead_cascade` alone would have been DEAD CODE — never
    //     reached, never failing, never noticed. Both halves are asserted.
    expect(schemaSql).toMatch(
      /after update of entitlement_lead, construction_admin on public\.projects/,
    );
    expect(schemaSql).toMatch(
      /new\.construction_admin is distinct from old\.construction_admin/,
    );
    expect(schemaSql).toMatch(/SET ca = v_new/);
  });

  it('★★★ an ISSUED permit keeps who took it through', () => {
    // ★★★ D-2026-08-28, and it matters MORE for a CA than for anyone else: the
    //     whole job is post-permit-issuance work, so issued permits are exactly
    //     the ones somebody will read this off later. The guard is
    //     `actual_issue IS NULL`, on BOTH cascade blocks.
    const body = schemaSql.slice(
      schemaSql.indexOf('bp_trg_project_lead_cascade'),
    );
    const guards = body.match(/AND p\.actual_issue IS NULL/g) ?? [];
    expect(guards.length).toBe(2);
  });

  it('★★ the cascade moves nobody it was not asked to', () => {
    // ★ Both sides non-null (clearing does not clear the permits, and setting
    //   for the first time does not push down), and only where the permit still
    //   names the OLD person.
    expect(schemaSql).toMatch(
      /v_old IS NOT NULL AND v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old/,
    );
    expect(schemaSql).toMatch(/lower\(btrim\(COALESCE\(p\.ca, ''\)\)\) = lower\(v_old\)/);
  });
});

// ---------------------------------------------------------------------------
// §C · THE DATA
// ---------------------------------------------------------------------------

describe('fix-487 §C: the default and the two people', () => {
  it('★★★ the default is ON THE COLUMN, so every insert path gets it', () => {
    // ★★★ WHY THIS BEATS A `COALESCE` IN THE CREATE RPC: there are five insert
    //     paths (wizard, redesign, reuse, backfill, hand SQL) and the RPC is
    //     one of them. A default in the schema covers all five and cannot be
    //     forgotten by the sixth.
    //
    // ★★ AND IT BACKFILLED 211 ROWS FOR FREE. `ADD COLUMN ... DEFAULT` is a
    //    catalog change in modern Postgres — measured after the run, ZERO
    //    projects had `updated_at` move, so no OCC token was invalidated and no
    //    activity row was written. A bulk UPDATE would have needed the
    //    trigger-suppression dance fix-410 and fix-425 both had to do.
    expect(schemaSql).toMatch(
      /add column if not exists construction_admin text default 'Steve'/,
    );
    // ★ The permit column has NO default, and that asymmetry is the ruling:
    //   *"He would only get assigned to a permit by himself, or ENT in general."*
    expect(schemaSql).toMatch(/add column if not exists ca text;/);
    const caCol = schemaSql.slice(schemaSql.indexOf('public.permits'));
    expect(caCol.slice(0, 120)).not.toContain('default');
  });

  it('★★★ the two roster rows ship with NO email, and the collision check runs', () => {
    // ★★★ THE BRIEF'S HARD RULE: *"Emails are not known… Never invent an
    //     address."* They are NULL, and Bobby fills them in the editor §B
    //     builds — which is why §B had to ship in the same ticket.
    expect(rosterSql).toMatch(/'Steve', 'Steve', 'Svetlik',\s*\n\s*'ca', true, false, null, 'construction_admin'/);
    expect(rosterSql).toMatch(/'David', 'David', 'Rice',\s*\n\s*'ca', true, false, null, 'construction_admin'/);

    // ★★ The collision check runs AT WRITE TIME, not only at measurement time —
    //    the brief said STOP and report if a Steve or David appeared, and a
    //    check made three hours before the insert is a check about the past.
    expect(rosterSql).toMatch(/where name in \('Steve', 'David'\)/);
    expect(rosterSql).toMatch(/stopping rather than merging/);
  });
});

// ---------------------------------------------------------------------------
// §B · THE ROSTER EDITOR
// ---------------------------------------------------------------------------

const ROSTER: TeamMember[] = [
  {
    id: '1', name: 'Ana', role: 'schematic', active: true, former: false,
    first_name: 'Ana', last_name: 'Buttrey', email: 'ana@blueprintcap.com',
    notes: null, updated_at: 'x', active_start_quarter: null, active_end_quarter: null,
  },
  {
    id: '2', name: 'Ana', role: 'da', active: true, former: false,
    first_name: 'Ana', last_name: 'Buttrey', email: 'ana@blueprintcap.com',
    notes: null, updated_at: 'x', active_start_quarter: null, active_end_quarter: null,
  },
  {
    id: '3', name: 'Steve', role: 'ca', active: true, former: false,
    first_name: 'Steve', last_name: 'Svetlik', email: null,
    notes: null, updated_at: 'x', active_start_quarter: null, active_end_quarter: null,
  },
];

describe('fix-487 §B: the roster editor (P-120)', () => {
  it('★★★ it folds ROLE ROWS into PEOPLE — Ana appears once', () => {
    // ★★ The roster is one row per (person, role) and seven people carry two.
    //    A panel that rendered rows would show Ana twice with two surname
    //    boxes, and the obvious next thing is that they disagree — fix-461's
    //    reasoning for `department`, applied to the fields fix-343 added.
    const people = foldPersonDetails(ROSTER);
    expect(people.map((p) => p.name)).toEqual(['Ana', 'Steve']);
    const ana = people[0]!;
    expect(ana.rows).toBe(2);
    expect(ana.roles).toEqual(['da', 'schematic']);
    expect(ana.split).toEqual([]);
  });

  it('★★★ a DISAGREEMENT is reported, never averaged', () => {
    // ★★★ THE STATE PROD WAS ACTUALLY IN. Ana's `da` row had no name and no
    //     address because AdminTeamTab's "add to this list" sends only
    //     `{name, role}` — and `resolveRosterIdentity` matches on EMAIL, so her
    //     Design Associate role was invisible to her own self-scope. The
    //     migration healed it and an INHERIT trigger stops it recurring; this
    //     asserts the reader refuses to guess if it happens anyway.
    const split = foldPersonDetails([
      ROSTER[0]!,
      { ...ROSTER[1]!, last_name: 'Butrey' },
    ]);
    expect(split[0]!.split).toEqual(['last_name']);
    expect(split[0]!.last_name).toBeNull();
    expect(split[0]!.first_name).toBe('Ana');
  });

  it('★★★ a missing EMAIL is a gap, not a cosmetic blank', () => {
    // ★★ A missing surname is cosmetic. A missing address means
    //    `resolveRosterIdentity` cannot match that person to their login at
    //    all — they sign in and the Bridge shows them no work of their own.
    //    Steve ships without one on purpose, so he is the first row Bobby sees.
    const gap = peopleMissingDetails(foldPersonDetails(ROSTER));
    expect(gap.map((p) => p.name)).toEqual(['Steve']);
  });

  it('★★★ the write path CANNOT change `name` or `role`', () => {
    // ★★★ ENFORCED BY THE RPC'S SIGNATURE, not by the dialog — so a future edit
    //     to the component cannot reintroduce it by accident. `name` is the
    //     join key across ~1,850 references with no FK and no cascade;
    //     renaming it here would orphan a person from their own permits.
    expect(rosterSql).toMatch(
      /create or replace function public\.bp_set_person_details\(\s*\n\s*p_name\s+text,\s*\n\s*p_first_name text,\s*\n\s*p_last_name\s+text,\s*\n\s*p_email\s+text\s*\n\)/,
    );
    const fn = rosterSql.slice(
      rosterSql.indexOf('create or replace function public.bp_set_person_details'),
    );
    const body = fn.slice(0, fn.indexOf('$function$;', 10));
    // The UPDATE sets exactly three columns and matches ON the name.
    expect(body).toMatch(/set first_name = v_first,\s*\n\s*last_name\s+= v_last,\s*\n\s*email\s+= v_email/);
    expect(body).not.toMatch(/set[\s\S]{0,200}\brole\s*=/);
    expect(body).toMatch(/and m\.name = v_name/);

    // ★ And the hook sends only those, by the same rule.
    const hook = stripComments(
      readFileSync(resolve(process.cwd(), 'src/hooks/useSetPersonDetails.ts'), 'utf8'),
    );
    expect(hook).toContain('p_first_name');
    expect(hook).not.toContain('p_role');
    // ★ `p_name` is sent, and it is the IDENTITY of the row being edited, never
    //   a new value: the RPC matches `m.name = v_name` and never assigns it.
    expect(hook).toContain('p_name: name');
  });

  it('★★★ it writes by NAME, so every row of a two-row person moves', () => {
    expect(rosterSql).toMatch(/update public\.team_members m[\s\S]{0,400}and m\.name = v_name/);
    // ★ …and a new role row INHERITS, which is what stops the split returning.
    expect(rosterSql).toMatch(/before insert on public\.team_members/);
    expect(rosterSql).toMatch(/after update of first_name, last_name, email/);
  });

  it('★★★ RENDERED: every person once, with an Edit button and the gap named', () => {
    renderPanel(<PersonDetailsEditor members={ROSTER} readOnly={false} />);
    expect(screen.getAllByTestId(/^person-details-row-/)).toHaveLength(2);
    expect(screen.getByTestId('person-details-edit-Ana')).toBeInTheDocument();
    expect(screen.getByTestId('person-details-gap').textContent).toContain(
      '1 person is missing',
    );
  });

  it('★★ read-only hides the way in, rather than disabling it', () => {
    // ★ Same rule as the rest of this tab (fix-436): a control that cannot work
    //   is ABSENT. The database refuses a non-admin through RLS either way.
    renderPanel(<PersonDetailsEditor members={ROSTER} readOnly />);
    expect(screen.queryByTestId('person-details-edit-Ana')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MUST NOT CHANGE
// ---------------------------------------------------------------------------

describe('fix-487: what this ticket must not have touched', () => {
  it('★★★ `team_members.name` is still nobody\'s to write from a details editor', () => {
    // ★ A blanket check over the whole feature, not just the RPC: no file this
    //   ticket added may contain a `name:` write into a roster patch.
    for (const rel of [
      'src/hooks/useSetPersonDetails.ts',
      'src/components/Settings/PersonDetailsDialog.tsx',
      'src/components/Settings/PersonDetailsEditor.tsx',
      'src/lib/personDetails.ts',
    ]) {
      const body = stripComments(
        readFileSync(resolve(process.cwd(), rel), 'utf8'),
      );
      expect(body, rel).not.toMatch(/\brole:\s*['"]/);
    }
  });

  it('★★★ the other five roles behave exactly as they did', () => {
    // ★ The seniority order of the original nine is UNCHANGED — `ca` was
    //   appended, not inserted among them, so no existing person's title moved.
    const withoutCa = ROLE_SENIORITY.filter((r) => r !== 'ca');
    expect(withoutCa).toEqual([
      'director', 'ent_lead', 'acq_lead', 'dm', 'schematic', 'ent', 'acq', 'da',
      'viewer',
    ]);
    expect(rosterRoleTitle(['ent', 'ent_lead'])).toBe('Entitlements Manager');
    expect(rosterRoleTitle(['dm', 'schematic'])).toBe(
      'Design Manager · Schematic Design',
    );
  });

  it('★★★ the department vocabulary still lives in exactly ONE module', () => {
    // ★★★ THE STRING COLLISION THIS TEST WAS ORIGINALLY WRITTEN WITHOUT.
    //     `'construction_admin'` is BOTH the new department key AND the new
    //     `projects` column name, so a plain "no file may contain this string"
    //     grep flags `ProjectSettingsModal`, which uses it as a patch key and is
    //     entirely correct to. The two are unrelated vocabularies that happen to
    //     spell the same — the same shape as fix-486's `Condo`, which is a
    //     product type and a permit type.
    //
    // ★★ SO THE CLAIM IS THE ONE THAT ACTUALLY MATTERS: the department LISTS
    //    are declared once. A second `DEPARTMENT_LABEL` or `DEPARTMENTS` is
    //    what would let Settings and the app disagree; a column key that spells
    //    the same never can.
    const declaring: string[] = [];
    for (const file of sourceFiles()) {
      const body = stripComments(readFileSync(file, 'utf8'));
      if (/export const DEPARTMENTS\b|export const DEPARTMENT_LABEL\b/.test(body)) {
        declaring.push(file);
      }
    }
    expect(declaring).toEqual([resolve(process.cwd(), 'src/lib/roleLabels.ts')]);
  });

  it('★★ …and the column that shares its spelling is a COLUMN, not a department', () => {
    // ★ Named so the collision is on the record rather than rediscovered. The
    //   patch key below is `projects.construction_admin`; it is never compared
    //   against `Department` and never reaches `bp_set_team_department`.
    const modal = stripComments(
      readFileSync(
        resolve(process.cwd(), 'src/components/ProjectDetail/ProjectSettingsModal.tsx'),
        'utf8',
      ),
    );
    expect(modal).toContain('construction_admin:');
    expect(modal).not.toContain('bp_set_team_department');
    expect(modal).not.toContain('Department');
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** ★ The panel takes its roster as a PROP (no fetch), but the dialog it owns
 *  holds a mutation — so a QueryClient is needed even though nothing here
 *  loads. Half of the fix-442 rule, not all of it. */
function renderPanel(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function sourceFiles(): string[] {
  const root = resolve(process.cwd(), 'src');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === '__tests__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  expect(out.length).toBeGreaterThan(100);
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}
