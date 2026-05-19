import type {
  ScraperActivityAction,
  ScraperActivityChanges,
  ScraperActivityRow,
} from './database.types';

// fix-27: pure helper functions for the notification center. Each
// summarize* call is action-specific and renders a one-line caption
// derived from the row's `changes` payload. Unknown actions fall
// through to a generic caption — never crash on a future audit row.

export type ActivityCategory = 'change' | 'cycle' | 'skipped' | 'other';

export function categorizeAction(action: ScraperActivityAction): ActivityCategory {
  if (action === 'scrape_change_applied' || action === 'manual_admin_correction') {
    return 'change';
  }
  if (action === 'scrape_cycle_change_applied') return 'cycle';
  if (
    action === 'scrape_skipped_recent_manual_edit' ||
    action === 'scrape_cycle_skipped_recent_manual_edit' ||
    action === 'scrape_skipped'
  ) {
    return 'skipped';
  }
  return 'other';
}

/** Parse a cycle row_id of the form "<permit_id>:cycle:<idx>".
 *  Returns null for permit-level row_ids ("<permit_id>") or malformed
 *  strings. Cycle index is forced positive integer per the V2
 *  cycle_index>=1 invariant. */
export function parseCycleRowId(
  row_id: string | null | undefined,
): { permitId: number; cycleIndex: number } | null {
  if (!row_id) return null;
  const m = /^(\d+):cycle:(\d+)$/.exec(row_id);
  if (!m) return null;
  const permitId = Number(m[1]);
  const cycleIndex = Number(m[2]);
  if (
    !Number.isFinite(permitId) ||
    !Number.isFinite(cycleIndex) ||
    cycleIndex < 1
  ) {
    return null;
  }
  return { permitId, cycleIndex };
}

/** Truthy + presentable. Filters out empty strings, null, undefined. */
function isPresent(v: unknown): v is string | number | boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Build the one-line summary for a given activity row. Returns at
 *  least one phrase per row — callers can `.join(' · ')` or render
 *  each phrase on its own line as preferred. */
export function summarizeActivity(row: ScraperActivityRow): string[] {
  const c = row.changes ?? {};
  const phrases: string[] = [];

  switch (row.action) {
    case 'scrape_change_applied':
      phrases.push(...summarizePermitChange(c));
      break;
    case 'scrape_cycle_change_applied':
      phrases.push(...summarizeCycleChange(c, row.cycle_index));
      break;
    case 'scrape_skipped_recent_manual_edit':
      phrases.push(...summarizePermitSkip(c));
      break;
    case 'scrape_cycle_skipped_recent_manual_edit':
      phrases.push('Cycle skipped — parent permit edited within 24h');
      break;
    case 'scrape_cycle_disagreement':
      phrases.push(...summarizeCycleDisagreement(c, row.cycle_index));
      break;
    case 'scrape_skipped':
      phrases.push(`Skipped${isPresent(c.reason) ? ` — ${c.reason}` : ''}`);
      break;
    case 'manual_admin_correction':
      phrases.push(...summarizeManualCorrection(c));
      break;
    default:
      phrases.push(row.action);
  }

  // Defensive: never return an empty array. The bell will render
  // something even when a payload is missing the fields we expect.
  if (phrases.length === 0) phrases.push(row.action);
  return phrases;
}

function summarizePermitChange(c: ScraperActivityChanges): string[] {
  const applied = (c.applied as Record<string, unknown>) ?? {};
  const db = (c.db as Record<string, unknown>) ?? {};
  const out: string[] = [];

  if (isPresent(applied.status)) {
    const before = fmtVal(db.status ?? '—');
    out.push(`Status: ${before} → ${fmtVal(applied.status)}`);
  }
  if (isPresent(applied.corr_rounds)) {
    out.push(
      `Correction rounds: ${fmtVal(db.corr_rounds ?? 0)} → ${fmtVal(applied.corr_rounds)}`,
    );
  }
  if (isPresent(applied.approval_date)) {
    out.push(`Approved ${fmtVal(applied.approval_date)}`);
  }
  if (isPresent(applied.actual_issue)) {
    out.push(`Issued ${fmtVal(applied.actual_issue)}`);
  }
  if (isPresent(applied.intake_date)) {
    out.push(`Intake date set ${fmtVal(applied.intake_date)}`);
  }
  // extras.latest_reviewer is the only nested key we surface.
  const extras = applied.extras as Record<string, unknown> | undefined;
  if (extras && isPresent(extras.latest_reviewer)) {
    out.push(`Reviewer: ${fmtVal(extras.latest_reviewer)}`);
  }

  if (out.length === 0) {
    // Fallback: show the applied keys so a future field still surfaces.
    const keys = Object.keys(applied).filter((k) => isPresent(applied[k]));
    if (keys.length > 0) out.push(`Updated: ${keys.join(', ')}`);
  }
  return out;
}

function summarizeCycleChange(
  c: ScraperActivityChanges,
  cycleIndex: number | null,
): string[] {
  const applied = (c.applied as Record<string, unknown>) ?? {};
  const ci = cycleIndex ?? '?';
  const out: string[] = [];
  for (const [k, v] of Object.entries(applied)) {
    if (!isPresent(v)) continue;
    out.push(`Cycle ${ci} ${k}: ${fmtVal(v)}`);
  }
  return out;
}

function summarizePermitSkip(c: ScraperActivityChanges): string[] {
  const observed = (c.observed as Record<string, unknown>) ?? {};
  const db = (c.db as Record<string, unknown>) ?? {};
  // Find a meaningful diverging field if possible.
  for (const k of ['status', 'approval_date', 'actual_issue', 'corr_rounds']) {
    if (isPresent(observed[k]) && observed[k] !== db[k]) {
      return [
        `Skipped — portal says ${fmtVal(observed[k])}, db has ${fmtVal(db[k] ?? '—')} (manual edit within 24h)`,
      ];
    }
  }
  return ['Skipped — manual edit within 24h'];
}

function summarizeCycleDisagreement(
  c: ScraperActivityChanges,
  cycleIndex: number | null,
): string[] {
  const dis = c.disagreement ?? {};
  const ci = cycleIndex ?? '?';
  const out: string[] = [];
  for (const [field, pair] of Object.entries(dis)) {
    if (!pair) continue;
    out.push(
      `Cycle ${ci} ${field}: db=${fmtVal(pair.db)} vs portal=${fmtVal(pair.observed)}`,
    );
  }
  if (out.length === 0) out.push(`Cycle ${ci} disagreement (no field detail)`);
  return out;
}

function summarizeManualCorrection(c: ScraperActivityChanges): string[] {
  const before = (c.before as Record<string, unknown>) ?? {};
  const after = (c.after as Record<string, unknown>) ?? {};
  const out: string[] = [];
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (b === a) continue;
    out.push(`${k}: ${fmtVal(b)} → ${fmtVal(a)} (manual)`);
  }
  if (out.length === 0 && isPresent(c.reason)) {
    out.push(`Manual correction — ${c.reason}`);
  }
  if (out.length === 0) out.push('Manual correction');
  return out;
}

/** Format a "time since" relative string. Uses minute / hour / day
 *  granularity capped at 30 days; older falls back to absolute date. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const deltaSec = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (deltaSec < 60) return 'just now';
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day <= 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  return iso.slice(0, 10);
}

/** Group rows by run timestamp (5-minute clustering). Mirrors the
 *  Cowork artifact's "Today 9:40 AM · N events" header pattern. */
export interface ActivityGroup {
  /** Earliest created_at in the cluster. ISO string. */
  anchor: string;
  rows: ScraperActivityRow[];
}

const CLUSTER_WINDOW_MS = 5 * 60 * 1000;

export function groupActivityByRun(rows: ScraperActivityRow[]): ActivityGroup[] {
  if (rows.length === 0) return [];
  // rows arrive newest-first; walk in order, append to the current
  // cluster while within the 5-min window of its anchor.
  const groups: ActivityGroup[] = [];
  for (const row of rows) {
    const t = new Date(row.created_at).getTime();
    const last = groups[groups.length - 1];
    if (
      last &&
      Math.abs(t - new Date(last.anchor).getTime()) <= CLUSTER_WINDOW_MS
    ) {
      last.rows.push(row);
      // The anchor is the earliest (newest-first input → minimum so far).
      if (new Date(row.created_at).getTime() < new Date(last.anchor).getTime()) {
        last.anchor = row.created_at;
      }
    } else {
      groups.push({ anchor: row.created_at, rows: [row] });
    }
  }
  return groups;
}

/** Count rows with created_at > lastSeenAt. lastSeenAt may be null
 *  (never marked read → all rows unread).
 *
 *  fix-28: superseded by countUnreadByIds (per-row read state). Kept
 *  for the fix-27 test that pinned this behavior + as a clean
 *  rollback path. */
export function countUnread(
  rows: ScraperActivityRow[],
  lastSeenAt: string | null,
): number {
  if (!lastSeenAt) return rows.length;
  const cutoff = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(cutoff)) return rows.length;
  return rows.reduce(
    (n, r) => (new Date(r.created_at).getTime() > cutoff ? n + 1 : n),
    0,
  );
}

// ============================================================
// fix-28: project grouping + search + ent filter + per-row read state
// ============================================================

/** Group activity rows by project address. Address is the user-facing
 *  identifier — multiple permits at the same address roll up under
 *  one card. Rows with null/empty address bucket under "Unknown address"
 *  so they don't disappear from the page. Map insertion order
 *  preserves the input order (rows arrive newest-first → bucket
 *  ordering reflects most-recent activity per project). */
export const UNKNOWN_ADDRESS_LABEL = 'Unknown address';

export function groupActivityByProject(
  rows: ScraperActivityRow[],
): Map<string, ScraperActivityRow[]> {
  const out = new Map<string, ScraperActivityRow[]>();
  for (const row of rows) {
    const key =
      row.address && row.address.trim() !== ''
        ? row.address.trim()
        : UNKNOWN_ADDRESS_LABEL;
    const bucket = out.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      out.set(key, [row]);
    }
  }
  return out;
}

/** Case-insensitive substring match across address / permit_num /
 *  permit_type / juris / summary lines. Empty query matches every
 *  row. Whitespace in the query becomes an AND tokenization — every
 *  token must hit one of the searchable fields. Matches the
 *  Reports search idiom ("space or comma = AND"). */
export function matchesSearch(
  row: ScraperActivityRow,
  query: string,
  summary: string[],
): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (q === '') return true;
  const haystack = [
    row.address ?? '',
    row.permit_num ?? '',
    row.permit_type ?? '',
    row.juris ?? '',
    row.ent_lead ?? '',
    ...summary,
  ]
    .join(' ')
    .toLowerCase();
  const tokens = q.split(/[\s,]+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}

/** Multi-select ent filter. A null `selectedEnts` (or one matching
 *  the full options list) is the "all selected" no-op. Rows where
 *  ent_lead is null are visible only when "all selected" — keeping
 *  defensive null rows from disappearing when Bobby filters by his
 *  own name. Comparison is case-insensitive. */
export function matchesEntFilter(
  row: ScraperActivityRow,
  selectedEnts: Set<string> | null,
  allEnts: string[],
): boolean {
  if (!selectedEnts) return true;
  if (selectedEnts.size === 0) return false;
  if (selectedEnts.size >= allEnts.length) {
    // "All selected" — pass everything including null ent_lead rows.
    return true;
  }
  if (!row.ent_lead) return false;
  const lead = row.ent_lead.toLowerCase();
  for (const sel of selectedEnts) {
    if (sel.toLowerCase() === lead) return true;
  }
  return false;
}

/** Count rows whose id is NOT in the readIds set. Replaces fix-27's
 *  timestamp-based unread count. */
export function countUnreadByIds(
  rows: ScraperActivityRow[],
  readIds: Set<number>,
): number {
  if (readIds.size === 0) return rows.length;
  let n = 0;
  for (const r of rows) if (!readIds.has(r.id)) n += 1;
  return n;
}
