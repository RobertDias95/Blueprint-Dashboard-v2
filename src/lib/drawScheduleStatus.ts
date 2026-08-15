import type { Permit, PermitCycle } from './database.types';
import {
  isTerminalIssuedStatus,
  isTerminalApprovedStatus,
} from './permitTerminalStatus';

// Q9.5.g: Auto-derive a draw_schedule block's status from the current BP
// permit data. Mirrors v1 dsAutoStatus at index.html:8404-8445. The
// precedence chain is data-driven for review/approval phases and falls
// back to date-driven for the DD phase. manual_status=true lets the
// popup-set status survive the DD-phase auto-override, but the three
// permit-data-driven branches (Corrections, Approved, Under Review)
// always win — those reflect ground-truth permit state and can't be
// suppressed by a stale manual choice.

export const DS_STATUS_LIST = [
  'Scheduled',
  'Schematic',
  'DD / Permit Set',
  'Pending Consultants',
  'Under Review',
  'Corrections',
  'Approved',
] as const;

export type DsStatus = (typeof DS_STATUS_LIST)[number];

// ---------------------------------------------------------------------------
// ★ fix-316: which of these seven a PERSON may choose.
// ---------------------------------------------------------------------------
//
// Miles set five draw blocks to "Approved" and came back to find them reading
// Under Review or Corrections. He filed it as the scraper overwriting his work.
// It had not — verified in prod, manual_status=true and status='Approved' were
// still saved on every row, and last_scraper_update_at was NULL on every permit
// involved. The board simply never displayed the saved value.
//
// The reason is right here in deriveBlockStatus: branches 1-3 (Corrections,
// Approved, Under Review) recompute from permit data on every render and win
// over any manual choice. Only branch 4 — the DD phase — respects one. So the
// picker offered seven options while four could ever be honoured, accepted the
// choice, saved it, and ignored it, with no warning and nothing to show
// afterwards. A control that takes input and discards it is worse than one
// that is not there, and this codebase has now shipped that shape five times.
//
// ★ AND IT IS WORSE THAN "NEVER HONOURED", which is what makes the behaviour
// look random rather than broken. Measured on prod: of the 8 blocks holding a
// manual Under Review / Corrections / Approved, 5 are inert — but 3 have no
// submitted cycle at all, so they fall through to branch 4 and their manual
// "Approved" IS being displayed today. So the three permit-driven statuses are
// honoured EXACTLY WHILE THE PERMIT HAS NOT BEEN SUBMITTED — the moment it is,
// the block silently flips. A lane reading "Approved" before anything was ever
// submitted is a false statement about the permit, and the flip is invisible.
//
// Bobby's model, which this makes true: "the draw schedule just emulates the
// primary permit status … all deriving from the primary building permit."
//
// Both sets are derived from DS_STATUS_LIST rather than retyped, so a status
// added there cannot quietly go missing from both.

/** The DD-phase statuses — the ones a person genuinely chooses, because
 *  nothing in the permit data can tell us which of them is true. */
export const DD_PHASE_STATUSES = DS_STATUS_LIST.slice(0, 4) as readonly DsStatus[];

/** ★ Derived facts about the Building Permit, NOT choices. deriveBlockStatus
 *  recomputes these on every render (branches 1-3), so offering them in a
 *  picker is offering something the board will overrule. */
export const PERMIT_DERIVED_STATUSES = DS_STATUS_LIST.slice(4) as readonly DsStatus[];

/** True when this status is recomputed from permit data and cannot be chosen. */
export function isPermitDerivedStatus(s: DsStatus): boolean {
  return PERMIT_DERIVED_STATUSES.includes(s);
}

/** The one line to show beside any draw-schedule status control. It answers
 *  what Miles was actually trying to do — the way to make a block read
 *  Approved is to give the permit an approval date. */
export const STATUS_PICKER_NOTE =
  'Under Review, Corrections and Approved follow the Building Permit automatically and cannot be set here. To make a block read Approved, set the permit’s approval date.';

export interface DsStatusColor {
  bg: string;
  border: string;
  text: string;
}

export interface DsStatusPresentation {
  /** The word the block's status pill shows. */
  label: string;
  /** The block's background / border / text colors. */
  colors: DsStatusColor;
}

// fix-160: STATUS_PRESENTATION is the SINGLE source binding each derived status
// to BOTH its label and its block colors. Bobby's rule: a block's text and its
// shade MUST come from one derived status — any divergence (label says Approved,
// block paints white) is a bug class. Keying both off this one record makes that
// structurally impossible: DsStatus is a closed union, so adding a status to
// DS_STATUS_LIST forces a {label, colors} entry here (no parallel label/color
// maps to forget). Colors mirror v1 DS_STATUS_COLORS (index.html:7307-7316); v1's
// 'Submitted' alias is dropped — the deriver never emits it.
export const STATUS_PRESENTATION: Record<DsStatus, DsStatusPresentation> = {
  Scheduled: { label: 'Scheduled', colors: { bg: '#ffffff', border: '#cacaca', text: '#1a2540' } },
  Schematic: { label: 'Schematic', colors: { bg: '#5a84c0', border: '#3d6aad', text: '#1a2540' } },
  'DD / Permit Set': { label: 'DD / Permit Set', colors: { bg: '#5d6aac', border: '#4a5499', text: '#ffffff' } },
  'Pending Consultants': { label: 'Pending Consultants', colors: { bg: '#02267e', border: '#011a5c', text: '#ffffff' } },
  'Under Review': { label: 'Under Review', colors: { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' } },
  Corrections: { label: 'Corrections', colors: { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' } },
  Approved: { label: 'Approved', colors: { bg: '#5abf75', border: '#3aa55e', text: '#ffffff' } },
};

// ---------------------------------------------------------------------------
// fix-263: PARK presentation — the OVERLAY treatment for a parked project.
// ---------------------------------------------------------------------------
// A park (project_holds.kind: 'hold' | 'cancelled') is NOT a DsStatus. It is an
// orthogonal axis that sits on top of whatever phase the lane derived, so it
// deliberately lives in its own record rather than being bolted into
// STATUS_PRESENTATION — adding it there would imply a project can be "in the
// Cancelled phase", which is exactly the confusion fix-263 is fixing.
//
// Unlike STATUS_PRESENTATION (literal v1-parity hexes) these resolve through CSS
// variables. That is deliberate and NOT an inconsistency: the same paint has to
// reach the shared HoldBadge, which cannot import draw-schedule tokens. One
// definition in index.css, three consumers (block, badge, legend).
//
// fix-262 shipped the cancelled block with the default 'Scheduled' treatment —
// white fill plus a grey "Scheduled" pill — so a cancelled project read as
// PENDING, the opposite of terminal. The pill is a PHASE chip; a cancelled
// project has no live phase, which is why `showPhasePill` is false for it and
// true for a hold (a held project is still ACTIVE and its phase still means
// something).
export interface DsParkPresentation {
  /** CSS `background` value — a flat colour for hold, a hatch for cancelled. */
  background: string;
  border: string;
  /** Title / primary text colour. */
  text: string;
  /** Secondary line (reason, date) colour. */
  subtext: string;
  /** Does the derived-phase pill still make sense in this state? */
  showPhasePill: boolean;
  /** Is the address struck through? */
  strikeAddress: boolean;
  /** Legend label. */
  label: string;
}

export type DsParkKind = 'hold' | 'cancelled';

export const DS_PARK_PRESENTATION: Record<DsParkKind, DsParkPresentation> = {
  hold: {
    background: 'var(--color-hold-bg)',
    border: 'var(--color-hold-border)',
    text: 'var(--color-hold-text)',
    subtext: 'var(--color-hold-subtext)',
    // A held project is still ACTIVE — its phase is still meaningful.
    showPhasePill: true,
    strikeAddress: false,
    label: 'On hold',
  },
  cancelled: {
    background: 'var(--hatch-cancelled)',
    border: 'var(--color-cancelled-border)',
    text: 'var(--color-cancelled-text)',
    subtext: 'var(--color-cancelled-text)',
    // No live phase — see the note above.
    showPhasePill: false,
    strikeAddress: true,
    label: 'Cancelled',
  },
};

// Colors view of the canonical record. Kept (derived, never a separate literal)
// for the grid color lookup + the popup swatches so existing imports are stable.
export const DS_STATUS_COLORS: Record<DsStatus, DsStatusColor> = Object.fromEntries(
  DS_STATUS_LIST.map((s) => [s, STATUS_PRESENTATION[s].colors]),
) as Record<DsStatus, DsStatusColor>;

export interface DeriveStatusInput {
  /** All permits at this project (filter by project_id upstream). */
  permits: Permit[];
  cyclesByPermit: Map<number, PermitCycle[]>;
  /** The status currently stored on the draw_schedule row. */
  currentStatus: string | null;
  /** True when the popup last set the status (suppresses DD-phase auto-derive). */
  manualStatus: boolean;
  /** Override for deterministic tests. Defaults to today @ local midnight. */
  today?: Date;
}

export interface DeriveStatusResult {
  status: DsStatus;
  /** True when the result came from a derive branch; false when the manual
   *  status was respected as-is. Drives whether the popup labels the block
   *  as auto vs manual. */
  isAuto: boolean;
}

/** Truncate a Date to local midnight. */
function toMidnight(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return m;
}

/** Parse a 'YYYY-MM-DD' permit date column as local-noon (avoids tz drift
 *  by anchoring to midday in the user's tz). Returns null when input is
 *  null / unparseable. */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    12,
    0,
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function isStatus(v: string | null): v is DsStatus {
  return DS_STATUS_LIST.includes(v as DsStatus);
}

/** fix-177: a permit the city has finished with — physically issued
 *  (actual_issue) OR a terminal-positive portal status (reusing the canonical
 *  fix-31c/d sets: Issued / Conceptually Approved / Approved / Completed /
 *  Closed / Ready for Issuance). Once a permit is done, a dangling open-
 *  corrections cycle (corr_issued with no resubmitted — common when the final
 *  cycle is never formally closed at issuance) is stale: the lane must read
 *  done, not "Corrections". approval_date alone is intentionally NOT "done"
 *  here — an approved-but-not-issued permit that re-enters corrections should
 *  still surface as Corrections (Branch 2 below still maps approval_date →
 *  Approved once no open corrections remain). */
function permitIsDone(p: Permit): boolean {
  return (
    !!p.actual_issue ||
    isTerminalIssuedStatus(p.status) ||
    isTerminalApprovedStatus(p.status)
  );
}

export function deriveBlockStatus(input: DeriveStatusInput): DeriveStatusResult {
  const today = toMidnight(input.today ?? new Date());
  const bps = input.permits.filter((p) => p.type === 'Building Permit');
  // fix-160: derive off the Building Permits when any exist; otherwise off ALL
  // the project's permits. A reuse=false redesign whose only permit is a PPR (or
  // any BP-less project) used to fall straight to 'Scheduled' → its block painted
  // white even when the PPR is approved and the block already shows the approval
  // date. Now the same permit-data branches run on that PPR, so an approved
  // PPR-only project derives 'Approved' (green) — text and shade agree.
  const src = bps.length > 0 ? bps : input.permits;

  // No permits at all → can't derive. Fall through to manual / Scheduled.
  if (src.length === 0) {
    if (input.manualStatus && isStatus(input.currentStatus)) {
      return { status: input.currentStatus, isAuto: false };
    }
    return { status: 'Scheduled', isAuto: true };
  }

  // Branch 1: any NON-terminal permit has an open corrections cycle (corr_issued
  // set, resubmitted unset). Wins even over manualStatus. fix-177: a permit the
  // city has already finished (Issued / Demo Completed / terminal-positive
  // status) is excluded — its dangling last cycle is moot and must not paint the
  // lane "Corrections" (e.g. 1917 3rd Ave W: BP Issued 2026-01-29 with a never-
  // closed corr cycle from 2026-01-20).
  const anyCorrections = src.some((p) => {
    if (permitIsDone(p)) return false;
    const cycles = input.cyclesByPermit.get(p.id) ?? [];
    return cycles.some((c) => !!c.corr_issued && !c.resubmitted);
  });
  if (anyCorrections) return { status: 'Corrections', isAuto: true };

  // Branch 2: every permit is approved/issued. Always wins. fix-177: a terminal-
  // positive portal status counts as done even with no recorded approval/issue
  // date (e.g. SDOT "Conceptually Approved"), so it reads Approved instead of
  // falling through to Under Review — same precedence effectiveStage uses.
  const allApproved = src.every(
    (p) => !!p.approval_date || permitIsDone(p),
  );
  if (allApproved) return { status: 'Approved', isAuto: true };

  // Branch 3: any permit has at least one submitted cycle. Always wins.
  const anySubmitted = src.some((p) => {
    const cycles = input.cyclesByPermit.get(p.id) ?? [];
    return cycles.some((c) => !!c.submitted);
  });
  if (anySubmitted) return { status: 'Under Review', isAuto: true };

  // Past this point we're in the DD phase. If the user manually picked a
  // status, respect it (only the three branches above can override a
  // manual choice).
  if (input.manualStatus && isStatus(input.currentStatus)) {
    return { status: input.currentStatus, isAuto: false };
  }

  // Branch 4: derive DD-phase status from dates against today.
  const bp = src[0];
  const ddEnd = parseDate(bp.dd_end);
  if (ddEnd && ddEnd < today) {
    return { status: 'Pending Consultants', isAuto: true };
  }
  const ddStart = parseDate(bp.dd_start);
  if (ddStart) {
    if (today.getTime() >= ddStart.getTime()) {
      return { status: 'DD / Permit Set', isAuto: true };
    }
    const schematicStart = new Date(ddStart.getTime() - 28 * 24 * 60 * 60 * 1000);
    if (today.getTime() >= schematicStart.getTime()) {
      return { status: 'Schematic', isAuto: true };
    }
  }
  return { status: 'Scheduled', isAuto: true };
}

/** fix-150: lane-status derivation for the Draw Schedule grid, with a one-hop
 *  parent chase for reuse-redesigns.
 *
 *  A redesign created with redesign_reuses_original_permit=true (fix-126) has
 *  NO permits of its own, so deriveBlockStatus would fall back to the raw
 *  'Scheduled' default — while the parent's lane, deriving off the shared
 *  permit's approval_date / cycles, shows e.g. "Approved" (the 12836 N 60th St
 *  mismatch Bobby flagged). When the lane's project has no BP AND is a
 *  reuse-redesign with a parent that DOES have a BP, we derive off the PARENT's
 *  permits + cycles instead — but keep the redesign lane's OWN currentStatus +
 *  manualStatus. That means the redesign derives identically to how the parent
 *  lane derives (the three permit-data branches still always win; a manual lane
 *  status is respected the same way it is on the parent). Read-time only — no
 *  writes, no cascade. One hop: a redesign-of-a-redesign chases to its
 *  immediate parent only.
 *
 *  Falls through to the project's own permits (i.e. plain deriveBlockStatus)
 *  for: non-redesigns, redesigns that have their own permit (reuses=false), and
 *  redesigns whose parent also has no BP. */
export interface DeriveLaneStatusInput {
  project: {
    id: string;
    redesign_of_project_id?: string | null;
    redesign_reuses_original_permit?: boolean | null;
  };
  permitsByProjectId: Map<string, Permit[]>;
  cyclesByPermit: Map<number, PermitCycle[]>;
  currentStatus: string | null;
  manualStatus: boolean;
  today?: Date;
}

function hasBuildingPermit(permits: Permit[]): boolean {
  return permits.some((p) => p.type === 'Building Permit');
}

export function deriveLaneStatus(
  input: DeriveLaneStatusInput,
): DeriveStatusResult {
  const own = input.permitsByProjectId.get(input.project.id) ?? [];
  let permits = own;
  if (
    !hasBuildingPermit(own) &&
    input.project.redesign_reuses_original_permit === true &&
    input.project.redesign_of_project_id
  ) {
    const parent =
      input.permitsByProjectId.get(input.project.redesign_of_project_id) ?? [];
    // Only inherit when the parent actually has a BP to derive from; otherwise
    // keep the redesign's own (empty) set → falls back to its own status.
    if (hasBuildingPermit(parent)) permits = parent;
  }
  return deriveBlockStatus({
    permits,
    cyclesByPermit: input.cyclesByPermit,
    currentStatus: input.currentStatus,
    manualStatus: input.manualStatus,
    today: input.today,
  });
}
