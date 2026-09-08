import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  APPROVAL_LABEL,
  approvalDisplay,
} from '../lib/approvalDisplay';
import type { ProjectedApprovalResult } from '../lib/projectedApproval';

// ===========================================================================
// ★★★ fix-506 §B/§I (P-139) — "Est. approval" FLIPS TO "Approved"
// ===========================================================================
//
// The brief, on the v14 Dates card: *"Est. approval flips to 'Approved' with
// the real date once the city approves — same rule as Schedule Health col 6,
// one helper shared by both."* And §I: *"Estimated Approval and the Dates
// card's Est. approval / Approved must agree on every project (shared helper,
// §B); pin with one test."*
//
// ★★★ THE AGREEMENT IS THE TEST, NOT THE WORDING. Two surfaces computing "is
//     this the real date or a projection?" separately is the shape that lets
//     one screen say Approved while another still says Est. — fix-347 §3's
//     "second definition" trap, which fix-221 hit for real.

const result = (over: Partial<ProjectedApprovalResult> = {}): ProjectedApprovalResult =>
  ({ projection: '2026-10-14', isActual: false, isProjected: true, ...over }) as ProjectedApprovalResult;

describe('fix-506 §B: the flip', () => {
  it('★★★ a projected date reads "Est. approval" on the card, "Est. Approval" in the table', () => {
    const r = result();
    expect(approvalDisplay(r, 'datesCard')).toEqual({
      date: '2026-10-14',
      isActual: false,
      label: 'Est. approval',
    });
    expect(approvalDisplay(r, 'scheduleHealth').label).toBe('Est. Approval');
  });

  it('★★★ once the city approves it flips to Approved, with the REAL date', () => {
    // ★★ `computeProjectedApproval` already returns isActual=true when the
    //    permit carries approval_date / actual_issue, and `projection` is then
    //    that date. This helper READS that determination — it does not re-make
    //    it, which is what keeps the two surfaces in step.
    const r = result({ projection: '2026-09-30', isActual: true });
    expect(approvalDisplay(r, 'datesCard')).toEqual({
      date: '2026-09-30',
      isActual: true,
      label: 'Approved',
    });
    expect(approvalDisplay(r, 'scheduleHealth').label).toBe('Actual');
  });

  it('★★★ THE AGREEMENT: both surfaces read the same date and the same state', () => {
    // ★★★ §I's pin. The NOUN differs by surface on purpose; the DATE and the
    //     is-actual determination must never.
    for (const r of [
      result(),
      result({ isActual: true, projection: '2026-09-30' }),
      result({ projection: null, isProjected: false }),
    ]) {
      const card = approvalDisplay(r, 'datesCard');
      const table = approvalDisplay(r, 'scheduleHealth');
      expect(card.date).toBe(table.date);
      expect(card.isActual).toBe(table.isActual);
    }
  });

  it('★★★ no BP, or no walkable projection → "—" with the LABEL unchanged', () => {
    // The brief: *"No BP on the project → the three read `—` with the labels
    // unchanged."* So a null date must not take the caption with it.
    for (const r of [null, undefined, result({ projection: null })]) {
      const d = approvalDisplay(r, 'datesCard');
      expect(d.date).toBeNull();
      expect(d.isActual).toBe(false);
      expect(d.label).toBe('Est. approval');
    }
  });

  it('★★ the two vocabularies are DECLARED, so neither surface invents a third', () => {
    expect(APPROVAL_LABEL.scheduleHealth).toEqual({
      actual: 'Actual',
      projected: 'Est. Approval',
    });
    expect(APPROVAL_LABEL.datesCard).toEqual({
      actual: 'Approved',
      projected: 'Est. approval',
    });
  });
});

describe('fix-506 §I: Schedule Health reads the shared helper', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectDetail/ScheduleHealthTable.tsx'),
    'utf8',
  );

  it('★★★ col 6 no longer decides the word for itself', () => {
    // ★★ It read `{isActual ? 'Actual' : 'Est. Approval'}` inline — a second
    //    place that knew the rule. It reads `approval.label` now.
    expect(src).toContain("approvalDisplay(projectedResult, 'scheduleHealth')");
    expect(src).toContain('{approval.label}');
    expect(src).not.toContain("isActual ? 'Actual' : 'Est. Approval'");
  });

  it('★★ the header still says ACQ Target — the brief says leave it', () => {
    // fix-506's "Must not change" list, and fix-63's inline edit beneath it.
    expect(src).toContain('<Th>ACQ Target</Th>');
    expect(src).toContain('<AcqTargetCell');
  });

  it('★★ computeProjectedApproval itself is untouched', () => {
    // ★ Also on the must-not-change list. The helper takes the RESULT precisely
    //   so the maths stays in one place: re-assembling a ProjectedApprovalInput
    //   would be a second definition of the projection, which is worse than a
    //   second definition of a label.
    // ★ COMMENT-STRIPPED — the note explaining why the helper does not
    //   call computeProjectedApproval has to NAME it. The trap this repo has
    //   now met a dozen times.
    const lib = stripComments(
      readFileSync(resolve(process.cwd(), 'src/lib/approvalDisplay.ts'), 'utf8'),
    );
    expect(lib).not.toContain('computeProjectedApproval');
    expect(lib).not.toContain('ProjectedApprovalInput');
  });
});

/** ★ Strip comments before a source-grep: a note recording why something is
 *  ABSENT has to name the thing. */
function stripComments(src: string): string {
  // ★ Line-wise via a multiline regex rather than split/join, so this helper
  //   needs no newline literals of its own.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^([^'"`]*?)\/\/.*$/gm, '$1');
}
