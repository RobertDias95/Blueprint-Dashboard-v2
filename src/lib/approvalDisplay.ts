import type { ProjectedApprovalResult } from './projectedApproval';

// ===========================================================================
// ★★★ fix-506 §B/§I (P-139) — ONE ANSWER TO "WHEN IS THIS APPROVED?"
// ===========================================================================
//
// Bobby's v14 Dates card ends with **Est. approval**, and the brief is explicit
// about what it does next: *"Est. approval flips to 'Approved' with the real
// date once the city approves"* — *"same rule as Schedule Health col 6, one
// helper shared by both"*.
//
// ★★★ AND THAT SHARING IS THE POINT, NOT THE TIDINESS. Schedule Health has
//     printed this pair since Q9.5 (`isActual ? 'Actual' : 'Est. Approval'`).
//     A second surface computing "is this the real date or a projection?" for
//     itself is precisely the shape that lets two screens disagree about one
//     project — the trap fix-347 §3 named and fix-221 hit for real. §I pins the
//     two together with a test, and this is what makes that possible.
//
// ★★ IT TAKES THE RESULT, NOT THE INPUTS. Assembling a `ProjectedApprovalInput`
//    needs siblings, learned estimates, a cycle override, holds and type
//    defaults — ~60 lines that Schedule Health already does. A helper that
//    re-assembled them would be a second definition of the projection, which is
//    worse than a second definition of the label. So the caller brings the
//    result it already has and this decides only what to SHOW.
//
// ★ `computeProjectedApproval` already returns `isActual: true` when the permit
//   carries `approval_date` / `actual_issue` — that determination is not
//   re-made here, it is read.

/** The two words the two surfaces use for the same state. They differ on
 *  purpose: Schedule Health is a column of many permits and says "Actual"; the
 *  Dates card is one project's story and says "Approved", which is Bobby's own
 *  word for it in the v14 mock. ★ The DATE and the STATE are shared; only the
 *  noun is local, and it is declared here so neither surface invents a third. */
export const APPROVAL_LABEL = {
  scheduleHealth: { actual: 'Actual', projected: 'Est. Approval' },
  datesCard: { actual: 'Approved', projected: 'Est. approval' },
} as const;

export type ApprovalSurface = keyof typeof APPROVAL_LABEL;

export interface ApprovalDisplay {
  /** The date to print, or null when there is nothing to say. */
  date: string | null;
  /** True when the city has actually approved — the flip Bobby described. */
  isActual: boolean;
  /** The caption for this surface. */
  label: string;
}

/**
 * What a surface should print for a permit's approval.
 *
 * ★★ A NULL RESULT IS A REAL CASE, NOT A GUARD. A project with no Building
 *    Permit, or one whose projection cannot be walked, has nothing to say — the
 *    brief: *"No BP on the project → the three read `—` with the labels
 *    unchanged."* So the label survives a null date; only the value goes.
 */
export function approvalDisplay(
  result: ProjectedApprovalResult | null | undefined,
  surface: ApprovalSurface,
): ApprovalDisplay {
  const isActual = result?.isActual === true;
  const words = APPROVAL_LABEL[surface];
  return {
    date: result?.projection ?? null,
    isActual,
    label: isActual ? words.actual : words.projected,
  };
}
