import { describe, it, expect } from 'vitest';
import { intakeIsAccepted, intakeDisplay } from '../lib/targetApproval';
import { todayIso, formatUsDate } from '../lib/dateUtils';
import { SNAPSHOT_SECTIONS } from '../lib/weeklySnapshot';

import migrationSql from '../../migrations/fix_513_intake_accepted_predicate.sql?raw';
import targetApprovalSrc from '../lib/targetApproval.ts?raw';
import overviewSrc from '../components/ProjectDetail/ProjectOverviewBoxes.tsx?raw';
import myBoardSrc from '../lib/myBoard.ts?raw';
import permitDetailSrc from '../components/ProjectDetail/PermitDetailV2.tsx?raw';
import projectDataSrc from '../components/ProjectDetail/ProjectDataEditors.tsx?raw';
import detailsFormSrc from '../hooks/useProjectDetailsForm.ts?raw';
import detailsFormComponentSrc from '../components/ProjectDetail/ProjectDetailsForm.tsx?raw';

// ===========================================================================
// fix-513 (P-208 · P-182 · P-209 · P-207) — A DATE IS NOT A STATE
// ===========================================================================
//
// `permits.intake_date` is not "the date intake was accepted". It is *the
// intake date, whenever it falls* — the scraper and the DAs both write
// SCHEDULED intakes into it, months ahead. fix-508 shipped
// `!!permit?.intake_date` and centralised it deliberately, so every consumer
// was wrong on the same rows and one line reaches all of them.
//
// ★★★ RULED BY BOBBY 2026-09-09: **DATE ONLY.** Status does not corroborate it
//     — status vocabulary is jurisdiction-specific and drifts, the date is a
//     fact. Taken against a measured counterexample set of 19 rows (§A3), which
//     is a DATA problem; a status check here would hide them behind a predicate
//     instead of correcting them. **Do not re-open the ruling.**
//
// ★★★ THE VISIBLE POPULATION, VERIFIED ON PROD: 685 permits · 490 carry an
//     `intake_date` · 481 are past · **9 are in the future**, across 5 projects,
//     every one `status = Scheduled`. Those nine are the rows this ticket moves.

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const TODAY = '2026-09-09';

/** The nine future-intake permits, from prod. */
const FUTURE_NINE = [
  { addr: '233 31st Ave E', type: 'Building Permit', intake: '2027-01-26', target: '2026-09-21' },
  { addr: '233 31st Ave E', type: 'Demolition', intake: '2027-01-26', target: '2026-10-12' },
  { addr: '2601 E Galer St', type: 'Demolition', intake: '2026-12-01', target: '2026-08-14' },
  { addr: '4017 Corliss Ave N', type: 'Building Permit', intake: '2026-12-03', target: '2026-09-21' },
  { addr: '4017 Corliss Ave N', type: 'Demolition', intake: '2026-12-10', target: '2026-10-12' },
  { addr: '4137 54th Ave SW', type: 'Building Permit', intake: '2027-01-26', target: '2026-10-23' },
  { addr: '4137 54th Ave SW', type: 'Demolition', intake: '2027-01-26', target: '2026-11-13' },
  { addr: '554 N 75th St', type: 'Building Permit', intake: '2027-02-02', target: '2026-10-12' },
  { addr: '554 N 75th St', type: 'Demolition', intake: '2027-02-02', target: '2026-11-02' },
] as const;

// ---------------------------------------------------------------------------
// §A — the predicate
// ---------------------------------------------------------------------------

describe('fix-513 §A — accepted means the intake date has ARRIVED', () => {
  it('★★★ a FUTURE intake_date is NOT accepted — the whole bug', () => {
    expect(intakeIsAccepted({ intake_date: '2027-01-26' }, TODAY)).toBe(false);
    expect(intakeIsAccepted({ intake_date: '2026-09-10' }, TODAY)).toBe(false);
  });

  it('★★★ a PAST one IS', () => {
    expect(intakeIsAccepted({ intake_date: '2026-08-25' }, TODAY)).toBe(true);
    expect(intakeIsAccepted({ intake_date: '2024-10-26' }, TODAY)).toBe(true);
  });

  it('★★ TODAY is accepted — the boundary is inclusive, and the SQL twin agrees', () => {
    // An intake happening this morning has happened. `<=`, not `<`, and the
    // migration's `p_intake_date <= p_today` is the same comparison.
    expect(intakeIsAccepted({ intake_date: TODAY }, TODAY)).toBe(true);
    expect(migrationSql).toContain('p_intake_date IS NOT NULL AND p_intake_date <= p_today');
  });

  it('★★ a NULL intake_date is not accepted, and neither is a null permit', () => {
    expect(intakeIsAccepted({ intake_date: null }, TODAY)).toBe(false);
    expect(intakeIsAccepted(null, TODAY)).toBe(false);
    expect(intakeIsAccepted(undefined, TODAY)).toBe(false);
  });

  it('★★★ all NINE prod rows flip, and the past ones do not', () => {
    for (const p of FUTURE_NINE) {
      expect(intakeIsAccepted({ intake_date: p.intake }, TODAY), `${p.addr} ${p.type}`).toBe(false);
    }
    // The 481 past-dated permits keep reading Accepted — this is not a
    // board-wide flip, it is nine rows.
    expect(intakeIsAccepted({ intake_date: '2026-09-08' }, TODAY)).toBe(true);
  });

  it('★★★ ONE CLOCK — the predicate takes today rather than reading its own', () => {
    // ★ §A: "a predicate that reads three different clocks in one render is the
    //   same defect in a new coat." The parameter is what makes that impossible.
    const c = code(targetApprovalSrc);
    expect(c).toContain("import { todayIso } from './dateUtils'");
    expect(c).toMatch(/intakeIsAccepted\([\s\S]*?today: string = todayIso\(\)/);
    expect(c).toMatch(/intakeDisplay\([\s\S]*?today: string = todayIso\(\)/);
    // …and the display hands its own `today` down rather than re-defaulting.
    expect(c).toContain('intakeIsAccepted(permit, today)');
  });

  it('★★ `todayIso` reads LOCAL parts, never toISOString', () => {
    // fix-433's rule: a UTC "today" goes silent on exactly the day it must
    // speak — 20:11 PT is 03:11Z the NEXT day.
    const evening = new Date(2026, 8, 9, 20, 11, 0);
    expect(todayIso(evening)).toBe('2026-09-09');
  });

  it('★★★ there is exactly ONE definition of the predicate in the codebase', () => {
    // The fix-512 pattern: agreement is structural, not re-earned per review.
    const defs = code(targetApprovalSrc).match(/export function intakeIsAccepted/g) ?? [];
    expect(defs).toHaveLength(1);
    // …and nothing else restates the rule with its own comparison.
    for (const [name, src] of [
      ['overview', overviewSrc],
      ['myBoard', myBoardSrc],
    ] as const) {
      expect(code(src), name).not.toContain('intake_date <=');
    }
  });
});

// ---------------------------------------------------------------------------
// §B — the label, and the date beside it
// ---------------------------------------------------------------------------

describe('fix-513 §B — Target intake, and the date changes with the label', () => {
  it('★★★ pre-accept renders `Target intake` and the TARGET SUBMIT', () => {
    const d = intakeDisplay(
      { intake_date: '2027-01-26', target_submit: '2026-10-23' },
      TODAY,
    );
    expect(d.label).toBe('Target intake');
    expect(d.date).toBe('2026-10-23');
    expect(d.isActual).toBe(false);
    // ★ `4137 54th Ave SW` — the row §B names. It showed the booked 2027 intake
    //   under an "Accepted" label; it now shows the team's target submit.
    expect(formatUsDate(d.date!)).toBe('10/23/2026');
  });

  it('★★★ post-accept renders `Accepted intake` and the INTAKE DATE, unchanged', () => {
    const d = intakeDisplay(
      { intake_date: '2026-08-25', target_submit: '2026-09-21' },
      TODAY,
    );
    expect(d.label).toBe('Accepted intake');
    expect(d.date).toBe('2026-08-25');
    expect(d.isActual).toBe(true);
    expect(formatUsDate(d.date!)).toBe('08/25/2026');
  });

  it('★★ the noun matches `Target Approval` two rows above it', () => {
    // Two rows that both name a target use the same word — and the column under
    // this one is literally called `target_submit`.
    expect(intakeDisplay({ intake_date: null, target_submit: '2026-10-23' }, TODAY).label)
      .toBe('Target intake');
    expect(code(overviewSrc)).toContain('label="Target Approval"');
  });

  it('★ nothing anywhere still says `Estimated intake`', () => {
    expect(code(targetApprovalSrc)).not.toContain('Estimated intake');
    expect(code(overviewSrc)).not.toContain('Estimated intake');
  });

  it('★★ with no target submit either, the row is an em dash rather than a guess', () => {
    const d = intakeDisplay({ intake_date: null, target_submit: null }, TODAY);
    expect(d.label).toBe('Target intake');
    expect(d.date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C — the Agenda
// ---------------------------------------------------------------------------

describe('fix-513 §C — an accepted intake is not an intake due in 14 days', () => {
  // ★★★ CONFIRMED BEFORE CHANGING IT, as §C required: bucket A windows on
  //     `target_submit`, not `intake_date`. Two independent confirmations —
  //     the live `pg_get_functiondef` (reproduced verbatim in the migration)
  //     and the section's OWN column header, below.
  it('★★★ the section is a TARGET-SUBMIT window wearing an intake label', () => {
    const a = SNAPSHOT_SECTIONS.find((s) => s.key === 'a')!;
    expect(a.title).toBe('Intake due in the next 14 days');
    expect(a.dateLabel).toBe('Target submit');
    expect(migrationSql).toContain('l.target_submit BETWEEN v_today AND v_today + 14');
  });

  it('⏸ the title is NOT renamed — Bobby ruled, so the mismatch survives on purpose', () => {
    // ⚠️ A future reader will see "Intake" over a "Target submit" column and
    //    want to fix it. It is deliberate and banked as its own problem.
    const a = SNAPSHOT_SECTIONS.find((s) => s.key === 'a')!;
    expect(a.title).toContain('Intake');
    expect(a.dateLabel).not.toContain('Intake');
  });

  it('★★★ the filter calls the shared predicate rather than restating the rule', () => {
    expect(migrationSql).toContain('AND NOT public.bp_intake_is_accepted(l.intake_date, v_today)');
    // ★ One definition per language, named the same — the
    //   isPermitInCorrections ⇄ bp_permit_in_corrections twin.
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.bp_intake_is_accepted');
  });

  it('★★★ TS ⇄ SQL lockstep over the cases that decide the eight prod rows', () => {
    // The SQL is `p_intake_date IS NOT NULL AND p_intake_date <= p_today`, which
    // is `intakeIsAccepted` exactly. Evaluated here over the real bucket-A rows
    // so the twin is checked against data, not against its own shape.
    const BUCKET_A = [
      { id: 270, intake: null, verdict: 'stays' },
      { id: 322, intake: '2026-06-16', verdict: 'drops' },
      { id: 10408, intake: null, verdict: 'stays' },
      { id: 10385, intake: null, verdict: 'stays' },
      { id: 10151, intake: '2026-07-06', verdict: 'drops' },
      { id: 10404, intake: '2027-01-26', verdict: 'stays' },
      { id: 10150, intake: '2026-08-25', verdict: 'drops' },
      { id: 10381, intake: '2026-12-03', verdict: 'stays' },
    ] as const;
    const drops = BUCKET_A.filter((r) => intakeIsAccepted({ intake_date: r.intake }, TODAY));
    expect(drops.map((r) => r.id).sort((a, b) => a - b)).toEqual([322, 10150, 10151]);
    for (const r of BUCKET_A) {
      expect(intakeIsAccepted({ intake_date: r.intake }, TODAY), String(r.id))
        .toBe(r.verdict === 'drops');
    }
  });

  it('★★ the two FUTURE-intake rows stay — §A and §C agree by construction', () => {
    // 10404 (2027-01-26) and 10381 (2026-12-03). If §A's ruling were "any
    // intake_date", both would vanish from the section as well.
    expect(intakeIsAccepted({ intake_date: '2027-01-26' }, TODAY)).toBe(false);
    expect(intakeIsAccepted({ intake_date: '2026-12-03' }, TODAY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §D — Est. approval is not a different colour
// ---------------------------------------------------------------------------

describe('fix-513 §D — the derived affordance is deleted, not repainted', () => {
  it('★★★ no grey-and-dashed style survives in the Dates card', () => {
    const c = code(overviewSrc);
    expect(c).not.toContain('1px dashed var(--color-border)');
    expect(c).not.toContain("color: 'var(--color-muted)'");
  });

  it('★★★ …on BOTH rows that carried it, not just the one Bobby named', () => {
    const c = code(overviewSrc);
    const approvalSpan = c.slice(c.indexOf('pd-date-approval-value'));
    expect(approvalSpan.slice(0, 200)).not.toContain('style=');
    const intakeSpan = c.slice(c.indexOf('pd-date-intake-value'));
    expect(intakeSpan.slice(0, 200)).not.toContain('style=');
  });

  it('★★ the distinction SURVIVES without the colour — label, title and data-actual', () => {
    // It was said three times and painted once; the paint is what went.
    const c = code(overviewSrc);
    expect(c).toContain('data-actual={approval.isActual');
    expect(c).toContain('data-actual={intake.isActual');
    expect(c).toContain('label={approval.label}');
    expect(c).toContain('label={intake.label}');
  });

  it('★ SWEEP: every remaining `text-dim` in the card is the not-recorded em dash', () => {
    // §D asks for the sweep result including "nothing else". Every surviving
    // dim span in this file wraps an em dash or the literal word "none".
    const c = code(overviewSrc);
    const dims = c.match(/<span className="text-dim[^"]*">([^<]*)</g) ?? [];
    expect(dims.length).toBeGreaterThan(5);
    for (const d of dims) {
      expect(d, d).toMatch(/—|none/);
    }
  });
});

// ---------------------------------------------------------------------------
// §E — one column, two authors
// ---------------------------------------------------------------------------

describe('fix-513 §E → fix-514 §G — expected_issue has exactly ONE writer', () => {
  // ★★★ THE INVARIANT'S NUMBER CHANGED; THE INVARIANT DID NOT.
  //
  // fix-513 §E was briefed to move `PermitDetailV2`'s ACQ editor into Project
  // Data and REFUSED, under §E's own escape clause, because Project Data's
  // `AcqDateRow` addressed `bp.id` and nothing else while **153 non-Building-
  // Permit permits across 105 projects carry a different ACQ date by design**
  // (`permitSeedingDefaults` seeds a ULS at `bp_acq + 120`). Moving it would
  // have stranded all 153. So the count was pinned at TWO with the reason
  // written at both controls.
  //
  // ★★★ fix-514 §G BUILT WHAT THE REFUSAL ASKED FOR: Project Details' Permits
  //     tab edits ACQ ROW BY ROW, in the same atomic write as that row's type,
  //     ENT and DA. Both old writers then went — `PermitDetailV2`'s box AND
  //     `AcqDateRow`, which was a second writer of the same column once the
  //     Permits tab could reach the Building Permit too.
  //
  // ★★ §G was explicit that this test *"must go to one, not be deleted.
  //    Changing an invariant's number is the fix; removing the invariant is
  //    not."* A third writer still fails here, which was always the point.

  it('★★★ exactly ONE writer, and it is the atomic project form', () => {
    const writers: string[] = [];
    for (const [name, src] of [
      ['PermitDetailV2', permitDetailSrc],
      ['ProjectDataEditors', projectDataSrc],
      ['ProjectOverviewBoxes', overviewSrc],
      ['myBoard', myBoardSrc],
      ['useProjectDetailsForm', detailsFormSrc],
    ] as const) {
      // ★ A WRITE is a commit/upsert CARRYING the column, not a read of it.
      //   `ProjectOverviewBoxes` and `myBoard` both mention `expected_issue`
      //   and neither writes it, which is what this distinction is for.
      const writesIt =
        src.includes("commit('expected_issue'") ||
        src.includes('expected_issue: next') ||
        src.includes('expected_issue: row.expected_issue');
      if (writesIt) writers.push(name);
    }
    expect(writers.sort()).toEqual(['useProjectDetailsForm']);
  });

  it('★★★ and it addresses permits ROW BY ROW, which is what the 153 needed', () => {
    // ★ The BP-only shape — `permitUpserts: [{ id: bp.id }]` — is what could
    //   not reach them. `ProjectDataEditors` still has one, for
    //   `target_submit`, and that is CORRECT: target submit IS a
    //   Building-Permit anchor (fix-36's engine owns the rest). What must not
    //   survive there is an `expected_issue` write.
    expect(projectDataSrc).not.toContain('expected_issue: next');
    expect(projectDataSrc).not.toContain("commit('expected_issue'");
    // …and the form loops over every row instead.
    expect(detailsFormSrc).toContain('for (const row of form.permits)');
    expect(detailsFormSrc).toContain('for (const row of form.permits)');
    expect(detailsFormSrc).toContain('expected_issue: row.expected_issue.trim() || null');
  });

  it('★★ the per-permit control exists and is reachable', () => {
    expect(detailsFormComponentSrc).toContain('ACQ target date');
    expect(detailsFormComponentSrc).toContain('onChange({ expected_issue: v })');
  });
});
