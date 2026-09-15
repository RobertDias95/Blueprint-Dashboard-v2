import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  DISCIPLINES,
  DISCIPLINE_LABEL,
  DISCIPLINE_SHORT,
  disciplineLabel,
  disciplineShortLabel,
} from '../lib/disciplineLabels';
import { TEAM_LABEL, TEAM_OPTIONS, teamLabel, disciplineForTeam } from '../lib/taskTeam';
import { CANONICAL_PERMIT_OWNERS } from '../lib/permitOwnerOptions';
import { RIBBON_ENTRIES } from '../lib/ribbonNav';
import { PREVIOUS_ORIGINS, previousTarget } from '../lib/previousOrigin';
import { ROLE_TITLE, ROLE_TITLE_PLURAL } from '../lib/roleLabels';
import { WAITING_ON_OPTIONS } from '../lib/database.types';
import { BUILTIN_REPORT_CATALOG } from '../lib/builtinReports';

// ===========================================================================
// fix-554 — the words line up (P-262, first installment of P-009)
// ===========================================================================
//
// Bobby, 2026-09-14, asking for two renames in one sitting and saying why:
// *"this kind of goes back to a statement that I made a while ago of trying to
// make sure all the nomenclature in all these different spots kind of line
// up."*
//
// §A  ARCHITECTURE → DESIGN, for the design team.
// §B  PIPELINE → PROJECTS, for the landing page.
// §C  Display only. Stored values keep their spelling and get mapped at render.
//
// ---------------------------------------------------------------------------
// ★★★ THE TEST RULE IS fix-535 §A's, VERBATIM: *"assert against rendered
//     labels, not source text — a grep passes on a comment."*
// ---------------------------------------------------------------------------
//
// Every "the old word is gone" assertion below runs over MAP VALUES or over
// comment-stripped source, never over raw file text. This file is itself full
// of the words `Architecture` and `Pipeline` in prose, and so are a dozen
// modules that correctly keep them as stored tokens — a naive grep would fail
// on its own explanation (the gravestone trap, 21st recording in this repo).
//
// ★ PROD, MEASURED 2026-09-15, which is what makes the display/stored split a
//   fact rather than a preference:
//
//     permit_tasks.discipline = 'arch'            524 rows
//     permit_tasks.discipline = 'ent'           1,292 rows
//     permit_tasks.assigned_to = 'Architecture'    25 rows   ← a LIVE label
//     task_templates.default_team = 'Architecture'  0 rows
//     permits.permit_owner = 'Architecture'        26 rows
//     permits.architect (the consultant firm)      11 rows   ← NOT THIS TICKET
//     report_categories.name = 'Pipeline'           1 row, 2 reports
// ===========================================================================

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

/** ★ Comments stripped — JSX blocks included. See the header: this suite's
 *  subject is a REMOVED word, and every file it checks explains the removal in
 *  prose. A stripper that missed a comment form would make the note satisfy the
 *  assertion. */
const code = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// §A · ARCHITECTURE BECOMES DESIGN
// ---------------------------------------------------------------------------

describe('fix-554 §A — no LABEL says Architecture for the design team', () => {
  it('★★★ every discipline and team label, asserted as VALUES', () => {
    // ⚠️ These are the maps every bucket header, pill and picker renders from,
    //    so asserting the values is asserting what a person reads.
    for (const v of Object.values(DISCIPLINE_LABEL)) expect(v).not.toMatch(/architect/i);
    for (const v of Object.values(DISCIPLINE_SHORT)) expect(v).not.toMatch(/arch/i);
    for (const v of Object.values(TEAM_LABEL)) expect(v).not.toMatch(/architect/i);
    for (const v of Object.values(ROLE_TITLE)) expect(v).not.toMatch(/architect/i);
    for (const v of Object.values(ROLE_TITLE_PLURAL)) expect(v).not.toMatch(/architect/i);
  });

  it('★★★ and they say the new word', () => {
    expect(DISCIPLINE_LABEL.arch).toBe('Design');
    expect(DISCIPLINE_LABEL.ent).toBe('Permitting');
    expect(teamLabel('Architecture')).toBe('Design');
  });

  it('★★★ the ABBREVIATION counts too — fix-535 §A\'s rule, applied again', () => {
    // ★ *"'Ent' and 'Ents' count where a person sees them."* The per-task
    //   discipline select said `Arch` in a 10px box, which is the tightest
    //   place on the screen and therefore the one read most.
    expect(DISCIPLINE_SHORT.arch).toBe('DSGN');
    expect(DISCIPLINE_SHORT.ent).toBe('PERM');
    expect(disciplineShortLabel('arch')).toBe('DSGN');
  });

  it('★★★ THE KEY UNDER EVERY RENAMED LABEL IS UNTOUCHED', () => {
    // ★★★ 1,816 permit_tasks rows and a SQL twin (`bp_discipline_for_team`)
    //     depend on these two strings. §C: *"Renaming data to fix a label is
    //     how a scraper starts filing rows nobody reads."*
    expect([...DISCIPLINES]).toEqual(['ent', 'arch']);
    expect(Object.keys(DISCIPLINE_LABEL).sort()).toEqual(['arch', 'ent']);
    // …and the legacy TEAM token is still a key, still matched, still routed.
    expect(Object.keys(TEAM_LABEL)).toContain('Architecture');
    expect(disciplineForTeam('Architecture')).toBe('arch');
    // ★ The three live team options are untouched — this ticket renamed the
    //   RETIRED one's label only.
    expect([...TEAM_OPTIONS]).toEqual([
      'Entitlements',
      'Design Associate',
      'Schematic Team',
    ]);
  });

  it('★★★ ONE map, and ALL FOUR renderers of a discipline call it', () => {
    // ★★★ THE DEFECT §A ACTUALLY FIXED. Before this ticket the same stored key
    //     printed as `Architecture` (bucket header), `Arch` (per-task select),
    //     `Architecture` (task detail pill) and `Design & Engineering` (team
    //     composer) — three spellings on four surfaces. Renaming three literals
    //     would have left three literals free to disagree again.
    for (const f of [
      'src/components/ProjectDetail/PermitDetailV2.tsx',
      'src/components/TaskDetailEditor.tsx',
      'src/components/MyTasks/TeamTaskComposer.tsx',
    ]) {
      expect(code(read(f)), f).toMatch(/DISCIPLINE_LABEL|DISCIPLINE_SHORT|disciplineLabel/);
    }
  });

  it('★★★ …and none of them still prints a literal for it', () => {
    // ★ The other direction: a map nobody calls is scenery. Asserted on
    //   comment-stripped source, because all three files explain the change.
    for (const f of [
      'src/components/ProjectDetail/PermitDetailV2.tsx',
      'src/components/TaskDetailEditor.tsx',
      'src/components/MyTasks/TeamTaskComposer.tsx',
    ]) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/'Architecture'|"Architecture"|>Architecture</);
      expect(src, f).not.toMatch(/>Arch</);
      expect(src, f).not.toMatch(/Design &amp; Engineering|>Design & Engineering</);
    }
  });

  it('★★★ `permits.architect` IS A DIFFERENT THING AND IS UNTOUCHED', () => {
    // ★★★ ⚠️ The consultant FIRM on a permit — 11 rows on prod — not the design
    //     team. The Corrections report filters by it, the CSV export falls back
    //     to it and the wizard collects it. Renaming any of that would have
    //     been a rename of the wrong noun.
    const corrections = read('src/lib/correctionsReport.ts');
    expect(corrections).toContain('architect: string | null;');
    expect(corrections).toContain('correctionArchitectLabel');
    expect(code(read('src/pages/CorrectionsReport.tsx'))).toContain('Architect');
    expect(code(read('src/lib/csvExport.ts'))).toContain('p.architect');
    // ★ And the consultant DISCIPLINE of the same name, on `waiting_on`.
    expect([...WAITING_ON_OPTIONS]).toContain('Architect');
  });

  it('★★ `permits.permit_owner` keeps its vocabulary — fix-535\'s ruling, again', () => {
    // ★ 26 permits carry `Architecture` here. The Settings registry screen's
    //   job is to show the vocabulary a COLUMN ACTUALLY HOLDS, so translating
    //   it there would make an admin read one word and store another — on the
    //   one screen whose whole purpose is to say what is stored. fix-535 left
    //   `Entitlements` in this list for exactly the same reason.
    expect([...CANONICAL_PERMIT_OWNERS]).toEqual([
      'Entitlements',
      'Architecture',
      'Split',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §B · PIPELINE BECOMES PROJECTS
// ---------------------------------------------------------------------------

function ribbonLabels(): string[] {
  const out: string[] = [];
  const walk = (entries: readonly unknown[]) => {
    for (const e of entries as ReadonlyArray<Record<string, unknown>>) {
      const link = e.link as { label?: string } | undefined;
      if (link?.label) out.push(link.label);
      const group = e.group as { label?: string; items?: unknown[] } | undefined;
      if (group?.label) out.push(group.label);
      if (Array.isArray(group?.items)) {
        for (const i of group.items as ReadonlyArray<Record<string, unknown>>) {
          if (typeof i.label === 'string') out.push(i.label);
        }
      }
      if (typeof e.label === 'string') out.push(e.label);
    }
  };
  walk(RIBBON_ENTRIES);
  return out;
}

describe('fix-554 §B — no user-facing word says Pipeline for the landing page', () => {
  it('★★★ the ribbon calls it Projects, and points at the unchanged route', () => {
    const entry = RIBBON_ENTRIES.find(
      (e) => e.kind === 'link' && e.link.to === '/dashboard',
    );
    expect(entry).toBeTruthy();
    expect(entry!.kind === 'link' && entry!.link.label).toBe('Projects');
    // ★★★ THE ROUTE DECISION, PINNED. §C: *"Routes: rename only if the rename
    //     is total AND a redirect ships with it."* It is not total and there is
    //     no redirect, because there is nothing to redirect — the path has been
    //     `/dashboard` since before it was ever called Pipeline (fix-313 #63
    //     renamed the label off `Dashboard` and left the path alone). This is
    //     the second label on one path and no bookmark has ever moved.
    expect(entry!.kind === 'link' && entry!.link.to).toBe('/dashboard');
  });

  it('★★★ no ribbon label says Pipeline at all', () => {
    for (const l of ribbonLabels()) expect(l).not.toMatch(/pipeline/i);
    expect(ribbonLabels()).toContain('Projects');
  });

  it('★★★ the "← Pipeline" back button now reads "← Projects"', () => {
    // The permit view's top-left button, and every other Previous that came
    // from the landing page.
    expect(previousTarget({ from: PREVIOUS_ORIGINS.pipeline }).label).toBe('← Projects');
    expect(previousTarget({ from: PREVIOUS_ORIGINS.pipeline }).to).toBe('/dashboard');
    expect(previousTarget({ from: '/dashboard?q=x' }).label).toBe('← Projects');
  });

  it('★★★ the page heading says it too', () => {
    // ★ Asserted on comment-stripped source because the file quotes fix-313's
    //   ruling — including the old word — directly above the heading.
    const src = code(read('src/pages/Dashboard.tsx'));
    // ★★★ WHITESPACE-TOLERANT, AND fix-574 IS WHY. This read
    //     `toContain('Projects\n      </h1>')` and passed on a worktree checked
    //     out with LF endings — then failed on the next one, which git gave
    //     CRLF. **A literal anchor encodes somebody's line endings as if they
    //     were syntax** (fix-537's `E"…"` lesson, in a test rather than a
    //     migration). The claim is about the heading, not about its indentation.
    expect(src.replace(/\s+/g, ' ')).toContain('Projects </h1>');
    expect(src).not.toMatch(/>\s*Pipeline\s*</);
  });

  it('★★★ THE ORIGIN KEY AND THE TESTIDS ARE DELIBERATELY UNCHANGED', () => {
    // ★★ §C: *"query keys, component names keep their current spelling."*
    //    `PREVIOUS_ORIGINS.pipeline` is a ROUTER-STATE value written into
    //    history entries that already exist in people's sessions; `pipeline-page`
    //    and `pipeline-title` are test selectors. Neither is a word anybody
    //    reads, and churning them would touch a dozen suites to say nothing new.
    expect(PREVIOUS_ORIGINS.pipeline).toBe('/dashboard');
    expect(read('src/pages/Dashboard.tsx')).toContain('data-testid="pipeline-title"');
    expect(read('src/lib/surfaceFilterPrefs.ts')).toContain("'pipeline.filters'");
    expect(read('src/lib/pipelinePrefs.ts')).toContain("'pipeline.collapsed'");
  });

  it('★★★ the REPORT CATEGORY called "Pipeline" is a stored row and stays', () => {
    // ★★★ ⚠️ `builtinReports[].category` is a LOOKUP KEY against
    //     `report_categories.name`, resolved per tenant at seed time — prod has
    //     one such row with **2 reports** attached. Renaming the constant would
    //     orphan both reports from their category (the lookup would miss) and
    //     renaming the row is a data change this ticket forbids.
    //
    // ★★ AND IT IS ALREADY FIXABLE WITHOUT US: the category is tenant-owned and
    //    renameable by an admin in the Reporting hub, which is the right place
    //    for a word the tenant owns. Recorded in §D so Bobby can decide.
    // ★ The catalog holds `null` for reports with no shelf entry — filtered,
    //   not asserted around, so a future null cannot make this vacuous.
    const cats = Object.values(BUILTIN_REPORT_CATALOG)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => r.category);
    expect(cats.length).toBeGreaterThan(0);
    expect(cats).toContain('Pipeline');
  });

  it('★★ the "upcoming pipeline" in the vendor email is a DIFFERENT WORD', () => {
    // ★ It means work that is coming, not the landing page. A rename that swept
    //   it up would have changed a sentence about schedules into a broken
    //   reference to a screen. Left, deliberately.
    expect(read('src/lib/vendorReportEmail.ts')).toContain("heading: 'Upcoming pipeline'");
  });
});

// ---------------------------------------------------------------------------
// §C · NO STORED VALUE MOVED
// ---------------------------------------------------------------------------

describe('fix-554 §C — display only: every stored value is byte-identical', () => {
  it('★★★ the discipline keys, the team keys and the owner vocabulary', () => {
    // ★★★ THE WHOLE TICKET IN ONE ASSERTION. If any of these changed, a
    //     migration was needed and this ticket had none.
    expect([...DISCIPLINES]).toEqual(['ent', 'arch']);
    expect([...TEAM_OPTIONS]).toEqual([
      'Entitlements',
      'Design Associate',
      'Schematic Team',
    ]);
    expect(Object.keys(TEAM_LABEL).sort()).toEqual([
      'Architecture',
      'Design Associate',
      'Design Manager',
      'Entitlements',
      'Schematic Team',
    ]);
    expect([...CANONICAL_PERMIT_OWNERS]).toEqual([
      'Entitlements',
      'Architecture',
      'Split',
    ]);
  });

  it('★★★ every route still resolves, and none of them moved', () => {
    // ★ §C: *"A route half-renamed is a broken bookmark for the whole team."*
    //   No path changed, so there is no redirect to assert — asserted as the
    //   absence it is, against the two entries this ticket touched.
    const paths = RIBBON_ENTRIES.filter((e) => e.kind === 'link').map(
      (e) => (e as { link: { to: string } }).link.to,
    );
    expect(paths).toContain('/dashboard');
    expect(paths).not.toContain('/pipeline');
    expect(paths).not.toContain('/projects');
    // ★ And the Previous helper still resolves the same path to a page name —
    //   a label with no route behind it is fix-408's own failure mode.
    expect(previousTarget({ from: '/dashboard' }).to).toBe('/dashboard');
  });

  it('★★ the comparisons on the word still compare the WORD, not the label', () => {
    // ★★★ The seam §C warns about: anything that MATCHES on the string rather
    //     than displaying it. `myTasksHelpers` skips the two internal team
    //     tokens when listing external consultants; `taskTeam` routes the
    //     legacy token to the design column. Both read the TOKEN.
    expect(code(read('src/lib/myTasksHelpers.ts'))).toContain("v === 'Architecture'");
    expect(code(read('src/lib/taskTeam.ts'))).toContain("case 'Architecture':");
    expect(disciplineForTeam('Architecture')).toBe('arch');
    expect(disciplineForTeam('Entitlements')).toBe('ent');
  });

  it('★★ an unknown or absent discipline renders as nothing, never a guess', () => {
    // ★ `permit_tasks.discipline` is nullable on un-backfilled rows; a
    //   placeholder word there would assert a lane nobody chose.
    expect(disciplineLabel(null)).toBe('');
    expect(disciplineLabel(undefined)).toBe('');
    expect(disciplineLabel('  ')).toBe('');
    // ★ …and an unrecognised key returns ITSELF rather than blanking, the same
    //   rule `teamLabel` follows for a person's name.
    expect(disciplineLabel('struct')).toBe('struct');
  });
});
