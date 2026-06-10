import type { Permit, PermitCycle } from './database.types';

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

export interface DsStatusColor {
  bg: string;
  border: string;
  text: string;
}

// Mirrors v1 DS_STATUS_COLORS at index.html:7307-7316. v1 also has
// 'Submitted' as an alias of 'Under Review'; we collapse to a single
// status because the v1 deriver never emits 'Submitted' anyway.
export const DS_STATUS_COLORS: Record<DsStatus, DsStatusColor> = {
  Scheduled: { bg: '#ffffff', border: '#cacaca', text: '#1a2540' },
  Schematic: { bg: '#5a84c0', border: '#3d6aad', text: '#1a2540' },
  'DD / Permit Set': { bg: '#5d6aac', border: '#4a5499', text: '#ffffff' },
  'Pending Consultants': { bg: '#02267e', border: '#011a5c', text: '#ffffff' },
  'Under Review': { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' },
  Corrections: { bg: '#5cb8b2', border: '#3a9e98', text: '#1a2540' },
  Approved: { bg: '#5abf75', border: '#3aa55e', text: '#ffffff' },
};

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

export function deriveBlockStatus(input: DeriveStatusInput): DeriveStatusResult {
  const today = toMidnight(input.today ?? new Date());
  const bps = input.permits.filter((p) => p.type === 'Building Permit');

  // No BPs → can't derive from permit data. Fall through to manual / Scheduled.
  if (bps.length === 0) {
    if (input.manualStatus && isStatus(input.currentStatus)) {
      return { status: input.currentStatus, isAuto: false };
    }
    return { status: 'Scheduled', isAuto: true };
  }

  // Branch 1: any BP has an open corrections cycle (corr_issued set,
  // resubmitted unset). Always wins, even over manualStatus.
  const anyCorrections = bps.some((bp) => {
    const cycles = input.cyclesByPermit.get(bp.id) ?? [];
    return cycles.some((c) => !!c.corr_issued && !c.resubmitted);
  });
  if (anyCorrections) return { status: 'Corrections', isAuto: true };

  // Branch 2: every BP has either approval_date or actual_issue. Always wins.
  const allApproved = bps.every(
    (bp) => !!bp.approval_date || !!bp.actual_issue,
  );
  if (allApproved) return { status: 'Approved', isAuto: true };

  // Branch 3: any BP has at least one submitted cycle. Always wins.
  const anySubmitted = bps.some((bp) => {
    const cycles = input.cyclesByPermit.get(bp.id) ?? [];
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
  const bp = bps[0];
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
