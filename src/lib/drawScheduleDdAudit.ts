// fix-208: pure-TS mirror of the holistic-DD enforcement + detector SQL
// (migrations/fix_208_holistic_dd_enforcement.sql). The logic lives in Postgres
// (bp_create_project_with_permits unify step + bp_draw_schedule_dd_mismatches);
// CI has no live DB, so this mirror is the regression guard — it reproduces the
// exact rules so a future SQL edit that drifts from these invariants is caught
// by the unit tests. Nothing in the app calls these at runtime.
//
// Holistic-DD rule (Bobby's standard): a project's draw-schedule block is ONE DD
// window for the whole project. The "primary"/anchor BP is the lowest-id
// non-sub Building Permit (type='Building Permit' AND parent_permit_id IS NULL).
// Every non-sub BP shares the primary's window; sub-permits never anchor or
// diverge it.

import { snapToMonday, addDays } from './dateUtils';

const BUILDING_PERMIT = 'Building Permit';

// fix-210: pure-TS mirror of the redesign-permit-DD derivation in
// bp_create_project_with_permits. A redesign sends its DD window only in
// p_redesign_dd_phase, so the new Building Permit must be given the SAME window
// that drives the draw-schedule block:
//   permit.dd_start = snap_to_monday_forward(phase.dd_start)  (= block.dd_start)
//   permit.dd_end   = phase.dd_end                            (= block.dd_end)
//   permit.target_submit fallback = dd_end + 21
// The dd_end change fires the permits AFTER trigger, so the target_submit engine
// (bp_recompute_target_submits) then overwrites the fallback with the canonical
// learned-offset value; the explicit +21 just guarantees it's never NULL.
export interface RedesignDdPhase {
  dd_start: string;
  dd_end: string;
}

export interface RedesignPermitDd {
  /** = block.dd_start = snap_to_monday_forward(phase.dd_start). */
  ddStart: string | null;
  /** = block.dd_end = the raw phase dd_end. */
  ddEnd: string | null;
  /** Fallback only — the target_submit engine recomputes the canonical value
   *  (dd_end + learned offset) once the dd_end write fires its trigger. */
  targetSubmitFallback: string | null;
}

/** The DD window a redesign create must write onto its Building Permit(s) so the
 *  permit and the draw-schedule block agree (and the Project Overview DD strip,
 *  which reads the PERMIT, is populated). */
export function redesignPermitDd(phase: RedesignDdPhase): RedesignPermitDd {
  const ddEnd = phase.dd_end || null;
  return {
    ddStart: snapToMonday(phase.dd_start, 'forward'),
    ddEnd,
    targetSubmitFallback: addDays(ddEnd, 21),
  };
}

export interface AuditPermit {
  id: number;
  type: string;
  /** Mirrors permits.parent_permit_id — non-null ⇒ a sub/child permit. */
  parentPermitId: number | null;
  ddStart: string | null;
  ddEnd: string | null;
}

/** A non-sub Building Permit — the only permits that anchor/carry project DD. */
function isNonSubBp(p: AuditPermit): boolean {
  return p.type === BUILDING_PERMIT && p.parentPermitId == null;
}

/** The primary/anchor BP = lowest-id non-sub Building Permit. Null when the
 *  project has none (mirrors the `prim` CTE's DISTINCT ON … ORDER BY id ASC). */
export function primaryBp(permits: readonly AuditPermit[]): AuditPermit | null {
  const bps = permits.filter(isNonSubBp).slice().sort((a, b) => a.id - b.id);
  return bps[0] ?? null;
}

/** Mirror of the create-path enforcement: snap every non-sub Building Permit to
 *  the primary BP's DD window. Sub-permits and non-BP permits are returned
 *  unchanged. No primary BP ⇒ the list is returned as-is. */
export function unifyBpDdWindow(permits: readonly AuditPermit[]): AuditPermit[] {
  const primary = primaryBp(permits);
  if (!primary) return permits.map((p) => ({ ...p }));
  return permits.map((p) =>
    isNonSubBp(p)
      ? { ...p, ddStart: primary.ddStart, ddEnd: primary.ddEnd }
      : { ...p },
  );
}

/** Monday of the ISO week containing `dateStr` ('YYYY-MM-DD'), as 'YYYY-MM-DD'.
 *  Mirrors Postgres `date_trunc('week', d)::date` (weeks start Monday). */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const sinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

export interface DrawBlock {
  projectId: string;
  address: string;
  da: string | null;
  startWeek: string | null;
  endWeek: string | null;
}

export interface DdMismatch {
  projectId: string;
  address: string;
  da: string | null;
  startWeek: string | null;
  endWeek: string | null;
  primaryDdStart: string | null;
  distinctDdStarts: number;
  bpCount: number;
  expectedStartWeek: string;
}

/** Mirror of bp_draw_schedule_dd_mismatches(): flag any project whose
 *  draw-schedule block start_week ≠ the Monday of its primary BP's dd_start, OR
 *  whose non-sub Building Permits carry more than one distinct dd_start. Only
 *  projects with a non-null primary dd_start are considered. */
export function findDrawScheduleDdMismatches(
  blocks: readonly DrawBlock[],
  permitsByProject: ReadonlyMap<string, AuditPermit[]>,
): DdMismatch[] {
  const out: DdMismatch[] = [];
  for (const b of blocks) {
    const permits = permitsByProject.get(b.projectId) ?? [];
    const nonSubBps = permits.filter(isNonSubBp);
    const primary = primaryBp(permits);
    const primaryDdStart = primary?.ddStart ?? null;
    if (primaryDdStart == null) continue; // prim.primary_dd_start IS NOT NULL
    const distinctDdStarts = new Set(
      nonSubBps.map((p) => p.ddStart).filter((s): s is string => s != null),
    ).size;
    const expectedStartWeek = mondayOf(primaryDdStart);
    // start_week IS DISTINCT FROM expected (null start_week ⇒ flagged), OR >1
    // distinct dd_start across the project's non-sub BPs.
    if (b.startWeek === expectedStartWeek && distinctDdStarts <= 1) continue;
    out.push({
      projectId: b.projectId,
      address: b.address,
      da: b.da,
      startWeek: b.startWeek,
      endWeek: b.endWeek,
      primaryDdStart,
      distinctDdStarts,
      bpCount: nonSubBps.length,
      expectedStartWeek,
    });
  }
  return out;
}
