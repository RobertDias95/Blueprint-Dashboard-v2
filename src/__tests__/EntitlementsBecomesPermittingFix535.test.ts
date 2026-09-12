import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  ROLE_TITLE,
  ROLE_TITLE_PLURAL,
} from '../lib/roleLabels';
import {
  TEAM_LABEL,
  TEAM_OPTIONS,
  defaultPrimaryTeamKey,
  disciplineForTeam,
  resolveTeamAssignee,
  teamLabel,
} from '../lib/taskTeam';
import { CANONICAL_PERMIT_OWNERS } from '../lib/permitOwnerOptions';
import { TEAM_INTERNAL_ROWS } from '../lib/overviewCardLayout';
import { PROJECT_DETAILS_SEARCH } from '../lib/projectDetailsForm';
import { externalConsultantOptions } from '../lib/myTasksHelpers';
import type { PermitTask } from '../lib/database.types';

// ===========================================================================
// fix-535 (P-190) — "Entitlements" becomes "Permitting"
// ===========================================================================
//
// ★★★ THE COLLISION IS RULED, NOT A FINDING. "Permitting" already names a
//     STAGE — the Pipeline's second lane, the Library's stage chip, P-184's
//     rail group — so the Team card now reads PERMITTING · Miles above a
//     permits list whose "Permitting" group means something else.
//     **Bobby ruled: rename anyway**, because people read it from context and
//     it is the word the team says out loud →
//     [[D-2026-09-09-target-approval-por-names-and-the-permitting-collision]]
//     §3. Not disambiguated, not qualified, not filed as a bug. A test below
//     renders both meanings in one fixture so the double reading is pinned as
//     INTENTIONAL rather than surviving by accident.

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

describe('fix-535 §A — no LABEL says Entitlement any more', () => {
  it('★★★ every role title and department label, asserted as VALUES', () => {
    // ⚠️ §A's test rule: *"assert against rendered labels, not source text — a
    //    grep passes on a comment."* These are the maps every name plate,
    //    heading and picker renders from, so asserting the values is asserting
    //    what a person reads.
    for (const v of Object.values(ROLE_TITLE)) expect(v).not.toMatch(/entitle/i);
    for (const v of Object.values(ROLE_TITLE_PLURAL)) expect(v).not.toMatch(/entitle/i);
    for (const v of Object.values(DEPARTMENT_LABEL)) expect(v).not.toMatch(/entitle/i);
  });

  it('★★★ and they say the new word', () => {
    expect(ROLE_TITLE.ent).toBe('Permitting');
    expect(ROLE_TITLE.ent_lead).toBe('Permitting Manager');
    expect(ROLE_TITLE_PLURAL.ent).toBe('Permitting Leads');
    expect(DEPARTMENT_LABEL.design_entitlements).toBe('Design & Permitting');
  });

  it('★★★ the ABBREVIATION counts too', () => {
    // ★ §A: *"'Ent' and 'Ents' abbreviations count where a person sees them
    //   (chips, narrow headers, the rail). Check for truncated forms before
    //   declaring the sweep complete."*
    const ent = TEAM_INTERNAL_ROWS.find((r) => r.key === 'ent');
    expect(ent?.label).toBe('PERM');
    expect(ent?.title).toBe('Permitting');
    for (const r of TEAM_INTERNAL_ROWS) {
      expect(r.label).not.toMatch(/^ENTS?$/i);
      expect(r.title).not.toMatch(/entitle/i);
    }
  });

  it('★★★ the key under every renamed label is untouched', () => {
    // ★★ §B: *"A stored value or column rename is a migration with a blast
    //    radius, and nothing about the word the team reads requires it."*
    expect(Object.keys(ROLE_TITLE)).toContain('ent_lead');
    expect(Object.keys(ROLE_TITLE)).toContain('ent');
    expect(DEPARTMENTS).toContain('design_entitlements');
    expect(Object.keys(DEPARTMENT_LABEL)).toContain('design_entitlements');
    expect(TEAM_INTERNAL_ROWS.map((r) => r.key)).toContain('ent');
  });
});

// ---------------------------------------------------------------------------
// §B / §C — the stored token that also happened to be the label
// ---------------------------------------------------------------------------

describe('fix-535 §C — `Entitlements` is a stored TOKEN, and it stays', () => {
  it('★★★ the token survives; only the label moved', () => {
    // ★★★ THE SEAM §C WARNS ABOUT, and the biggest one here: this string was
    //     doing two jobs. Measured on prod 2026-09-12 —
    //     `task_templates.default_team = 'Entitlements'` **57 rows**,
    //     `permit_tasks.assigned_to = 'Entitlements'` **103 rows** — and
    //     `taskTeam`'s own header says the CASE inside
    //     `bp_create_project_with_permits` and `bp_discipline_for_team` mirror
    //     these functions and are KEPT IN LOCKSTEP. Renaming the literal would
    //     have been a data migration plus two SQL edits.
    expect(TEAM_OPTIONS).toContain('Entitlements');
    expect(teamLabel('Entitlements')).toBe('Permitting');
  });

  it('★★★ every MATCH on the word still matches the token', () => {
    // ★ §C: *"a display rename that silently changes a match is how a filter
    //   quietly returns nothing."*
    expect(disciplineForTeam('Entitlements')).toBe('ent');
    expect(disciplineForTeam('Permitting')).toBeNull();
    expect(defaultPrimaryTeamKey('ent')).toBe('Entitlements');
    expect(
      resolveTeamAssignee('Entitlements', {
        entLead: 'Miles',
        da: 'Marc',
        schematicDesigners: [],
      }),
    ).toBe('Miles');
  });

  it('★★★ the external-consultant filter is unchanged — it reads the token', () => {
    // ★★★ THE FILTER THAT WOULD HAVE QUIETLY BROKEN. `externalConsultantOptions`
    //     excludes the internal team tokens from a list of consultant firms. Had
    //     the literal been renamed, every one of the 103 `Entitlements` tasks
    //     would have started appearing as an external consultant firm.
    const tasks = [
      { assigned_to: 'Entitlements' },
      { assigned_to: 'Architecture' },
      { assigned_to: 'Bush Roed & Hitchings' },
    ] as unknown as PermitTask[];
    expect(externalConsultantOptions(tasks)).toEqual(['Bush Roed & Hitchings']);
  });

  it('★★ a person’s name passes through `teamLabel` untouched', () => {
    // ★ The column also holds specific people. An unknown token returns ITSELF
    //   rather than a blank — a picker that showed "" for Miles would look
    //   broken rather than legacy.
    expect(teamLabel('Miles')).toBe('Miles');
    expect(teamLabel('Architecture')).toBe('Architecture');
    expect(teamLabel(null)).toBe('');
    expect(teamLabel('  ')).toBe('');
  });

  it('★★★ ONE map, and both renderers of a team token call it', () => {
    // ⚠️ §B: *"One mapping, one place… if three components each translate the
    //    department separately, that is the defect to fix while you are here."*
    //    A component that prints a `TeamKey` directly is now a bug that reads as
    //    correct, because the token is a perfectly good English word.
    for (const f of [
      'src/components/Settings/TaskTemplateEditor.tsx',
      'src/components/PrimaryAssigneeEditor.tsx',
    ]) {
      expect(read(f)).toContain('teamLabel');
    }
    expect(Object.keys(TEAM_LABEL)).toContain('Entitlements');
  });

  it('★★ `permits.permit_owner` keeps its vocabulary', () => {
    // ★ A second stored token carrying the word — **68 permits** on prod, and
    //   not in §B's table either. The registry screen's job is to show the
    //   vocabulary a column actually holds, so translating it there would make
    //   an admin read "Permitting" on the one screen whose purpose is to say
    //   what is stored.
    expect(CANONICAL_PERMIT_OWNERS).toContain('Entitlements');
  });
});

// ---------------------------------------------------------------------------
// The ruled collision
// ---------------------------------------------------------------------------

describe('fix-535 §0 — both meanings of "Permitting" render, and that is the ruling', () => {
  it('★★★ the ROLE and the STAGE both say it, in one assertion', () => {
    // ★★★ The Team card reads PERMITTING · Miles directly above a permits list
    //     whose "Permitting" group is a STAGE. Bobby ruled rename anyway:
    //     people read it from context and it is the word the team uses out
    //     loud. **Neither is altered to disambiguate the other**, and this is
    //     the test that says so on purpose.
    const role = ROLE_TITLE.ent;
    const stageHeader = read('src/pages/Dashboard.tsx');
    expect(role).toBe('Permitting');
    expect(stageHeader).toContain("title=\"Permitting\"");
    // ★ Each keeps its own key, which is what makes the collision harmless in
    //   the data even while it is deliberate on the screen.
    expect(TEAM_INTERNAL_ROWS.find((r) => r.title === 'Permitting')?.key).toBe('ent');
  });
});

// ---------------------------------------------------------------------------
// §C — the search seam
// ---------------------------------------------------------------------------

describe('fix-535 §C — the field search grew, it did not swap', () => {
  it('★★★ the old word still finds the renamed field', () => {
    // ★★★ These terms are what a person TYPES. Dropping "entitlement" would
    //     make the word everybody has said for years stop finding the row that
    //     was just renamed — a rename that punishes the people it is for.
    const row = PROJECT_DETAILS_SEARCH.find((f) => f.label === 'Permitting lead');
    expect(row).toBeTruthy();
    expect(row!.terms).toContain('entitlement');
    expect(row!.terms).toContain('permitting');
    expect(row!.terms).toContain('ent');
  });

  it('★★ no field label says Entitlement any more', () => {
    for (const f of PROJECT_DETAILS_SEARCH) {
      expect(f.label).not.toMatch(/entitle/i);
    }
  });
});
