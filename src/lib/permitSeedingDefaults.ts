// fix-Phase-B (2026-05-28): per-permit-type ACQ Target (expected_issue) +
// Target Submit (target_submit) seeding defaults for the new-project wizard.
//
// Bobby's locked table — anchors are the project GO date (projects.go_date)
// and the Building Permit's ACQ Target (the BP's expected_issue, entered by
// the user in the same wizard). The wizard pre-fills these so Bobby only
// overrides exceptions; manually-edited fields are never re-seeded.
//
//   Type                | expected_issue (ACQ)        | target_submit
//   --------------------|-----------------------------|------------------------
//   Building Permit     | user-entered (the anchor)   | engine-derived (—)
//   Demolition          | = BP ACQ                     | engine-derived (—)
//   IPR                 | = BP ACQ                     | engine-derived (—)
//   Grading / Clearing  | = BP ACQ                     | engine-derived (—)
//   ULS                 | = BP ACQ + 120 days          | engine-derived (—)
//   TRAO                | = BP ACQ                     | = GO + 3 days
//   PAR/Pre-Sub         | = GO + 30 days               | = GO + 3 days
//   SDOT Tree           | = GO + 30 days               | = GO + 3 days
//   (all others)        | not seeded                   | not seeded
//
// "engine-derived (—)" = this module does NOT seed target_submit for that
// type (Building Permit's target_submit is filled server-side from dd_end+14;
// Demolition/IPR/Grading/ULS have no GO-anchored submit rule). Only the rows
// with an explicit target_submit rule below get a seeded submit date.

export type SeedAnchor = 'bp_acq' | 'go_date';

export interface SeedAnchorRule {
  anchor: SeedAnchor;
  offset_days: number;
}

export interface SeedRule {
  expected_issue?: SeedAnchorRule;
  /** target_submit only ever anchors on the GO date in the MVP table. */
  target_submit?: { anchor: 'go_date'; offset_days: number };
}

/** Source of truth shared by the wizard UI + tests. Keyed by the exact
 *  `permits.type` string. Building Permit is intentionally ABSENT — its ACQ
 *  is the user-entered anchor and its target_submit is engine-derived, so it
 *  has no seed rule. */
export const SEEDING_RULES: Record<string, SeedRule> = {
  Demolition: { expected_issue: { anchor: 'bp_acq', offset_days: 0 } },
  IPR: { expected_issue: { anchor: 'bp_acq', offset_days: 0 } },
  'Grading / Clearing': { expected_issue: { anchor: 'bp_acq', offset_days: 0 } },
  ULS: { expected_issue: { anchor: 'bp_acq', offset_days: 120 } },
  TRAO: {
    expected_issue: { anchor: 'bp_acq', offset_days: 0 },
    target_submit: { anchor: 'go_date', offset_days: 3 },
  },
  'PAR/Pre-Sub': {
    expected_issue: { anchor: 'go_date', offset_days: 30 },
    target_submit: { anchor: 'go_date', offset_days: 3 },
  },
  'SDOT Tree': {
    expected_issue: { anchor: 'go_date', offset_days: 30 },
    target_submit: { anchor: 'go_date', offset_days: 3 },
  },
};

export interface SeedAnchors {
  /** projects.go_date (YYYY-MM-DD) or '' / undefined when unset. */
  goDate?: string | null;
  /** The Building Permit's expected_issue (YYYY-MM-DD) or '' when unset. */
  bpAcq?: string | null;
}

/** Add `days` to a YYYY-MM-DD date using UTC noon, so the result never drifts
 *  across a day boundary regardless of the runtime timezone. Returns null for
 *  an empty/malformed input. */
function addDaysUtc(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveAnchor(anchor: SeedAnchor, anchors: SeedAnchors): string | null {
  const v = anchor === 'bp_acq' ? anchors.bpAcq : anchors.goDate;
  return v && v.trim() !== '' ? v : null;
}

/** Seeded ACQ Target (expected_issue) for a permit type, or null when the
 *  type has no rule OR the required anchor isn't set yet. */
export function seedExpectedIssue(type: string, anchors: SeedAnchors): string | null {
  const rule = SEEDING_RULES[type]?.expected_issue;
  if (!rule) return null;
  const base = resolveAnchor(rule.anchor, anchors);
  if (base === null) return null;
  return addDaysUtc(base, rule.offset_days);
}

/** Seeded Target Submit (target_submit) for a permit type, or null when the
 *  type has no rule OR the GO date isn't set yet. */
export function seedTargetSubmit(type: string, anchors: SeedAnchors): string | null {
  const rule = SEEDING_RULES[type]?.target_submit;
  if (!rule) return null;
  const base = resolveAnchor(rule.anchor, anchors);
  if (base === null) return null;
  return addDaysUtc(base, rule.offset_days);
}
