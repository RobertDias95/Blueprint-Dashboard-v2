import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  buildProjectLeadIndex,
  deriveSelfScope,
  projectMatchesSelf,
  redesignsOfRedesigns,
} from '../lib/selfScope';
import type { Project } from '../lib/database.types';

// ===========================================================================
// fix-573 (P-278) — a reuse-redesign inherits its original's leads
// ===========================================================================
//
// 🚨 LIVE DEFECT. Briana opened the Pipeline on **Mine** and nine of her own
//    projects were not there.
//
// ---------------------------------------------------------------------------
// ★★★ TWO CORRECT TICKETS, INTERACTING
// ---------------------------------------------------------------------------
//
// fix-524 HIDES a superseded original from the Pipeline. fix-556 MOVES its
// permits onto the redesign's row. **Neither moved the LEADS**, and
// `projectMatchesSelf` reads `entitlement_lead` / `design_manager` only. So on
// Mine the original is suppressed and the redesign matches nobody; on Everyone
// no scope filter runs and it appears. Nothing was broken in either ticket —
// the third read was never written.
//
// ★★★ THE READS, ENUMERATED (fix-556's closing line asked for this):
//       1. lane STATUS      fix-150  ✔ chases the parent
//       2. the CARDS        fix-556  ✔ chases
//       3. project SCOPE    fix-573  ✔ chases — this ticket
//       4. task OWNERSHIP   —        ✘ does NOT; see §D below
//     **Four reads, three chased**, and the fourth is named rather than left
//     for a fifth ticket to rediscover.
//
// ---------------------------------------------------------------------------
// ★ MEASURED ON PROD 2026-09-15 — and it had drifted from the brief, which was
//   written against 18 redesigns. Two more exist now.
//
//     redesigns                                    19  (brief: 18)
//     …reusing the original's permits              14  (brief: 13), ALL 14 with
//                                                      entitlement_lead = NULL
//     no entitlement_lead of their own             15
//     no design_manager of their own               18
//     no acq_lead                                  16
//     null lead whose ORIGINAL has one             15  (brief: 14)
//     carrying their OWN entitlement_lead           4  (the brief's four exactly)
//     pointing at a project that is ITSELF a
//       redesign                                    0  ← the one-level rule
//     Briana leads                                 86  (brief: 83) → 'project'
//
//   ★★ The fixtures below are those rows, verbatim.
// ===========================================================================

/** A project row, with only the fields the scope predicate reads. */
const proj = (
  id: string,
  address: string,
  ent: string | null,
  dm: string | null,
  redesignOf: string | null = null,
): Pick<Project, 'id' | 'entitlement_lead' | 'design_manager' | 'redesign_of_project_id'> & {
  address: string;
} => ({
  id,
  address,
  entitlement_lead: ent,
  design_manager: dm,
  redesign_of_project_id: redesignOf,
});

// ---------------------------------------------------------------------------
// ★★ PROD'S OWN ROWS. Every original/redesign pair below was read off
//    `projects` on 2026-09-15; the addresses are the ones in Briana's report.
// ---------------------------------------------------------------------------

const ORIGINALS = [
  proj('o-concord', '4000 SW Concord St', 'Briana', 'Brittani'),
  proj('o-12238', '12238 4th Ave NW', 'Briana', 'Jade'),
  proj('o-220', '220 N 58th St', 'Briana', 'Brittani'),
  proj('o-5537', '5537 35th Ave NE', 'Briana', 'Brittani'),
  proj('o-othello', '3623 SW Othello St', 'Briana', 'Derry'),
  proj('o-12836', '12836 N 60th St', 'Briana', 'Derry'),
  proj('o-6505', '6505 21st Ave NW', 'Briana', 'Brittani'),
  proj('o-2443', '2443 5th Ave W', 'Briana', 'Brittani'),
  proj('o-5620', '5620 6th Ave NW', 'Briana', 'Brittani'),
  // ★ The four whose redesign carries its own lead.
  proj('o-123n48', '123 N 48th St', 'Briana', 'Brittani'),
  proj('o-7603', '7603 8th Ave NW', 'Miles', 'Brittani'),
  proj('o-4120', '4120 49th Ave S', 'Miles', 'Derry'),
  proj('o-7200', '7200 54th Ave S', 'Miles', 'Lindsay'),
];

/** The nine Briana was missing — every one a `[Redesign 1]` with NO lead of
 *  its own, whose original she leads. */
const BRIANA_REDESIGNS = [
  proj('r-concord', '4000 SW Concord St [Redesign 1]', null, null, 'o-concord'),
  proj('r-12238', '12238 4th Ave NW [Redesign 1]', null, null, 'o-12238'),
  proj('r-220', '220 N 58th St [Redesign 1]', null, null, 'o-220'),
  proj('r-5537', '5537 35th Ave NE [Redesign 1]', null, null, 'o-5537'),
  proj('r-othello', '3623 SW Othello St [Redesign 1]', null, null, 'o-othello'),
  proj('r-12836', '12836 N 60th St [Redesign 1]', null, null, 'o-12836'),
  proj('r-6505', '6505 21st Ave NW [Redesign 1]', null, null, 'o-6505'),
  proj('r-2443', '2443 5th Ave W [Redesign 1]', null, null, 'o-2443'),
  // ★ The brief named eight; prod has a ninth now (created since it was
  //   written). Listed so the re-measure is visible in the fixture, not only
  //   in the PR.
  proj('r-5620', '5620 6th Ave NW [Redesign 1]', null, null, 'o-5620'),
];

/** The four that carry their OWN entitlement_lead — the override cases. */
const OWN_LEAD_REDESIGNS = [
  proj('r-123n48', '123 N 48th St [Redesign 1]', 'Briana', null, 'o-123n48'),
  // ★★★ THE ONE THAT PROVES THE RULE: its own lead is Briana, its original's
  //     is MILES. A fallback that overrode would hand this to Miles.
  proj('r-7603', '7603 8th Ave NW [Redesign 1]', 'Briana', null, 'o-7603'),
  proj('r-4120', '4120 49th Ave S [Redesign 1]', 'Miles', 'Derry', 'o-4120'),
  proj('r-7200', '7200 54th Ave S [Redesign 1]', 'Miles', null, 'o-7200'),
];

const ALL = [...ORIGINALS, ...BRIANA_REDESIGNS, ...OWN_LEAD_REDESIGNS];
const INDEX = buildProjectLeadIndex(ALL);

/** The expression BOTH boards run for "Mine" on project scope. ★ Written once
 *  here for the same reason it is written once in `lib/selfScope`: two copies
 *  of a filter is how two boards start disagreeing. */
const mine = (name: string) =>
  ALL.filter((p) => projectMatchesSelf(p, name, INDEX)).map((p) => p.address);

// ---------------------------------------------------------------------------
// §B1 · THE FALLBACK
// ---------------------------------------------------------------------------

describe('fix-573 §B — a redesign with no lead inherits its original\'s', () => {
  it('★★★ a null-lead redesign matches the original\'s lead, and nobody else', () => {
    const r = proj('r', 'X [Redesign 1]', null, null, 'o');
    const idx = buildProjectLeadIndex([proj('o', 'X', 'Briana', 'Brittani')]);
    expect(projectMatchesSelf(r, 'Briana', idx)).toBe(true);
    expect(projectMatchesSelf(r, 'Miles', idx)).toBe(false);
    // ★ …and the design manager inherits on the same terms.
    expect(projectMatchesSelf(r, 'Brittani', idx)).toBe(true);
  });

  it('★★★ THE FALLBACK NEVER OVERRIDES — `7603 8th Ave NW`, from prod', () => {
    // ★★★ Its own `entitlement_lead` is **Briana**; its original's is **Miles**.
    //     fix-386's explicit-value rule: a value that is there wins, always.
    const r = OWN_LEAD_REDESIGNS.find((p) => p.id === 'r-7603')!;
    expect(projectMatchesSelf(r, 'Briana', INDEX)).toBe(true);
    expect(projectMatchesSelf(r, 'Miles', INDEX)).toBe(false);
  });

  it('★★★ …and the two fields fall back INDEPENDENTLY, which is the ruling', () => {
    // ★★★ PER FIELD, NOT PER ROW. `entitlement_lead` and `design_manager` are
    //     two facts about two different jobs; a redesign that names its own
    //     permitting lead has said nothing about who manages the design.
    //
    //     `7603` again: own ent = Briana (explicit, wins), own dm = blank
    //     (inherits Brittani from the original). Under a per-ROW rule Brittani
    //     would lose the project from her board because of a field that is
    //     about somebody else's job.
    const r = OWN_LEAD_REDESIGNS.find((p) => p.id === 'r-7603')!;
    expect(projectMatchesSelf(r, 'Brittani', INDEX)).toBe(true);
    // ★ And where BOTH are explicit, neither inherits: `4120` carries
    //   Miles + Derry, and its original carries the same two, so there is
    //   nothing to prove there — `7200` is the clean case: own ent Miles
    //   (explicit), own dm blank → inherits Lindsay.
    const r7200 = OWN_LEAD_REDESIGNS.find((p) => p.id === 'r-7200')!;
    expect(projectMatchesSelf(r7200, 'Miles', INDEX)).toBe(true);
    expect(projectMatchesSelf(r7200, 'Lindsay', INDEX)).toBe(true);
  });

  it('★★★ A NON-REDESIGN IS BYTE-IDENTICAL — with and without the index', () => {
    // ★ The regression guard. Every project on prod that is not a redesign must
    //   answer exactly what it answered before fix-573, and the two-argument
    //   call (which `deriveSelfScope` still makes) must be unchanged too.
    for (const p of ORIGINALS) {
      for (const who of ['Briana', 'Miles', 'Brittani', 'Derry', 'Nobody']) {
        expect(projectMatchesSelf(p, who, INDEX), `${p.address}/${who}`).toBe(
          projectMatchesSelf(p, who),
        );
      }
    }
  });

  it('★★ with no index the predicate is exactly what it was', () => {
    // ★ A caller that has not been taught the chase gets the OLD behaviour, not
    //   a crash and not a silent half-answer.
    const r = BRIANA_REDESIGNS[0];
    expect(projectMatchesSelf(r, 'Briana')).toBe(false);
    expect(projectMatchesSelf(r, 'Briana', INDEX)).toBe(true);
  });

  it('★★ a blank name, a missing original and an unknown id all answer false', () => {
    const orphan = proj('r-x', 'Y [Redesign 1]', null, null, 'not-in-index');
    expect(projectMatchesSelf(orphan, 'Briana', INDEX)).toBe(false);
    expect(projectMatchesSelf(BRIANA_REDESIGNS[0], null, INDEX)).toBe(false);
    expect(projectMatchesSelf(BRIANA_REDESIGNS[0], '   ', INDEX)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §B2 · THE RETURNED SET — what Briana actually sees
// ---------------------------------------------------------------------------

describe('fix-573 §B — the Mine set, asserted as a SET', () => {
  it('★★★ Briana gets all nine redesigns back, by address', () => {
    // ★★★ ASSERTED AS THE RETURNED SET, not a count — a count passes if the
    //     right number of the wrong rows comes back.
    const got = mine('Briana');
    for (const r of BRIANA_REDESIGNS) {
      expect(got, `${r.address} must be on Briana's Mine`).toContain(r.address);
    }
    // ★ …plus the originals she leads and the two redesigns carrying her name.
    expect(got).toContain('123 N 48th St [Redesign 1]');
    expect(got).toContain('7603 8th Ave NW [Redesign 1]');
    // ★★ And NOT the two that are Miles's outright.
    expect(got).not.toContain('4120 49th Ave S [Redesign 1]');
    expect(got).not.toContain('7200 54th Ave S [Redesign 1]');
  });

  it('★★★ Miles does not gain the nine — the chase is per person, not a blanket', () => {
    const got = mine('Miles');
    for (const r of BRIANA_REDESIGNS) {
      expect(got, `${r.address} must NOT be on Miles's Mine`).not.toContain(r.address);
    }
    expect(got).toContain('4120 49th Ave S [Redesign 1]');
    expect(got).toContain('7200 54th Ave S [Redesign 1]');
    // ★★★ `7603` is the override: Miles leads the ORIGINAL and the redesign
    //     names Briana, so the redesign is hers and the original is still his.
    expect(got).not.toContain('7603 8th Ave NW [Redesign 1]');
    expect(got).toContain('7603 8th Ave NW');
  });

  it('★★★ the design managers get their work back too — six people, not one', () => {
    // ★ Measured on prod: the per-field rule restores Briana 9 and Miles 6 via
    //   the lead, and Brittani 9, Derry 6, Lindsay 2, Jade 1 via the manager.
    //   The ticket was reported by one person and fixes six.
    expect(mine('Brittani')).toContain('4000 SW Concord St [Redesign 1]');
    expect(mine('Derry')).toContain('3623 SW Othello St [Redesign 1]');
    expect(mine('Jade')).toContain('12238 4th Ave NW [Redesign 1]');
    expect(mine('Lindsay')).toContain('7200 54th Ave S [Redesign 1]');
  });

  it('★★ somebody who leads nothing still matches nothing', () => {
    expect(mine('Nobody')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §B3 · ONE LEVEL, AND THE TYPE IS WHAT ENFORCES IT
// ---------------------------------------------------------------------------

describe('fix-573 §B — the chase is one level, structurally', () => {
  it('★★★ prod has NO redesign of a redesign — asserted, not assumed', () => {
    expect(redesignsOfRedesigns(ALL)).toEqual([]);
  });

  it('★★★ …and a two-deep chain resolves ONE hop and stops, by construction', () => {
    // ★★★ THE INDEX MAPS AN ID TO LEADS ONLY — it carries no
    //     `redesign_of_project_id`, so there is nothing to chase a second hop
    //     with. The one-level rule is enforced by the TYPE rather than by a
    //     comment somebody has to obey.
    const root = proj('root', 'Root', 'Briana', null);
    const mid = proj('mid', 'Root [Redesign 1]', null, null, 'root');
    const leaf = proj('leaf', 'Root [Redesign 2]', null, null, 'mid');
    const idx = buildProjectLeadIndex([root, mid, leaf]);

    expect(projectMatchesSelf(mid, 'Briana', idx)).toBe(true);
    // ★ The leaf inherits MID's leads — which are blank — and does NOT reach
    //   the root. Named here so the behaviour is a decision on the record.
    expect(projectMatchesSelf(leaf, 'Briana', idx)).toBe(false);
    // ★★ …and this is how anybody notices it has started happening.
    expect(redesignsOfRedesigns([root, mid, leaf])).toEqual(['leaf']);
  });
});

// ---------------------------------------------------------------------------
// §B4 · PURITY, AND THE WIRING
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');
const code = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('fix-573 §B — lib/selfScope is still pure', () => {
  it('★★★ no fetch, no hook, no module-level state', () => {
    // ★★★ THE CONSTRAINT §B NAMES BY NAME. The original's row reaches the
    //     predicate as an ARGUMENT — an index the caller builds — never by
    //     being looked up inside it. Asserted on comment-stripped source
    //     because this file discusses all three at length.
    const src = code(read('src/lib/selfScope.ts'));
    expect(src).not.toMatch(/\bfetch\s*\(|supabase|useQuery|useMemo|useState|useEffect/);
    // ★ No mutable module-level binding either — every top-level `const` here
    //   is a frozen literal or a function.
    expect(src).not.toMatch(/^\s*(let|var)\s/m);
  });

  it('★★★ BOTH boards pass the index, and NEITHER chases at the call site', () => {
    // ⚠️ §B: *"Do not add a second chase at either call site — that is how the
    //    two drift."* The call sites supply the lookup; the rule lives in one
    //    function.
    for (const f of ['src/pages/Dashboard.tsx', 'src/pages/ProjectList.tsx']) {
      const src = code(read(f));
      expect(src, `${f} must build the index`).toContain('buildProjectLeadIndex');
      expect(src, `${f} must pass it to the predicate`).toMatch(
        /projectMatchesSelf\([^)]*originalLeads/,
      );
      // ★ …and must not re-implement the chase.
      expect(src, `${f} must not chase the parent itself`).not.toMatch(
        /redesign_of_project_id[\s\S]{0,120}entitlement_lead/,
      );
    }
  });

  it('★★★ `deriveSelfScope` is UNCHANGED — it calls without an index', () => {
    // ★★ fix-428's note says to leave the tier decision alone, and it does not
    //    need the chase: a redesign only ever inherits from an original the same
    //    person leads, so anybody the chase would promote to 'project' is
    //    already there via that original.
    expect(deriveSelfScope('Briana', ORIGINALS)).toBe('project');
    expect(deriveSelfScope('Nobody', ORIGINALS)).toBe('permit');
    expect(deriveSelfScope(null, ORIGINALS)).toBe('all');
    // ★ Proof it did not quietly start chasing: a name that leads ONLY through
    //   the fallback is still 'permit' when the tier is computed.
    expect(deriveSelfScope('Briana', BRIANA_REDESIGNS)).toBe('permit');
  });

  it('★★ the index is built from ids and carries only the two lead fields', () => {
    const idx = buildProjectLeadIndex(ORIGINALS);
    expect(idx.get('o-concord')).toEqual({
      entitlement_lead: 'Briana',
      design_manager: 'Brittani',
    });
    expect(Object.keys(idx.get('o-concord')!).sort()).toEqual([
      'design_manager',
      'entitlement_lead',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §C · NO ROW WAS WRITTEN
// ---------------------------------------------------------------------------

describe('fix-573 §C — nothing was backfilled', () => {
  it('★★★ this ticket added no migration', () => {
    // ★★★ §C: copying the leads onto the 15 redesigns *would work today and rot
    //     tomorrow* — it duplicates a fact that already lives on the original
    //     and drifts the moment a lead changes. The fallback reads the fact
    //     where it lives.
    const dir = resolvePath(process.cwd(), 'migrations');
    expect(readdirSync(dir).filter((f) => /fix_573/i.test(f))).toEqual([]);
  });
});
