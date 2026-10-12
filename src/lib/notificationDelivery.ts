import { targetHref, type NewItemTarget } from './notificationTargets';

// ===========================================================================
// ★★★ fix-650 §D — the "Notification delivery" report, client side
// ===========================================================================
//
// The numbers come from `bp_notification_delivery_report` (admin only); this
// file only shapes and words them. One row per person over the last 30 days:
// notified · reached the bell · median time to bell · read · median time to
// read · gaps (the items Error triage was told about).
//
// ★★ THE WINDOW STARTS AT THE FIRST RECEIPT, until 30 days have passed. Before
//    the first receipt no bell could write one, so older items would read as
//    "never reached the bell" when the truth is "nothing was listening". The
//    page says when the window starts.

export interface DeliveryGapItem {
  id: number;
  flagged_at: string;
  status: string;
  item_key: string | null;
  kind: string | null;
  created_at: string | null;
  address: string | null;
  project_id: string | null;
  permit_id: string | null;
  message: string;
}

export interface DeliveryReportRow {
  user_id: string;
  person: string;
  notified: number;
  reached_bell: number;
  median_bell_min: number | null;
  read: number;
  median_read_min: number | null;
  gaps: number;
  gap_items: DeliveryGapItem[];
  last_active_at: string | null;
}

export interface DeliveryReport {
  from: string | null;
  days: number;
  /** When the first bell receipt was written — null until anybody's bell has. */
  delivery_epoch: string | null;
  rows: DeliveryReportRow[];
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ★ Defensive: the RPC is jsonb, so every field is checked rather than cast. */
export function mapDeliveryReport(raw: unknown): DeliveryReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : [];
  return {
    from: typeof r.from === 'string' ? r.from : null,
    days: num(r.days) || 30,
    delivery_epoch: typeof r.delivery_epoch === 'string' ? r.delivery_epoch : null,
    rows: rows.map((x) => ({
      user_id: String(x.user_id ?? ''),
      person: String(x.person ?? 'Unknown'),
      notified: num(x.notified),
      reached_bell: num(x.reached_bell),
      median_bell_min: numOrNull(x.median_bell_min),
      read: num(x.read),
      median_read_min: numOrNull(x.median_read_min),
      gaps: num(x.gaps),
      gap_items: Array.isArray(x.gap_items) ? (x.gap_items as DeliveryGapItem[]) : [],
      last_active_at: typeof x.last_active_at === 'string' ? x.last_active_at : null,
    })),
  };
}

/** "4 min", "2.5 h", "3 d" — or an em dash when there is nothing to median. */
export function formatMinutes(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '—';
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

/** "12 of 14 (86%)" — or just "0" when nothing was sent. */
export function ofTotal(part: number, total: number): string {
  if (total <= 0) return String(part);
  return `${part} of ${total} (${Math.round((part / total) * 100)}%)`;
}

/** Totals across the people, for the header line. */
export function reportTotals(rows: ReadonlyArray<DeliveryReportRow>) {
  return rows.reduce(
    (a, r) => ({
      notified: a.notified + r.notified,
      reached_bell: a.reached_bell + r.reached_bell,
      read: a.read + r.read,
      gaps: a.gaps + r.gaps,
    }),
    { notified: 0, reached_bell: 0, read: 0, gaps: 0 },
  );
}

/** ★ Where a gap item opens: the message for a mention, the permit for a
 *  permit task, the board for a team task. Null when the key is unreadable. */
export function gapItemHref(item: DeliveryGapItem): string | null {
  const key = item.item_key ?? '';
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (!id || key.indexOf(':') < 0) return null;
  let target: NewItemTarget | undefined;
  if (kind === 'mention' && item.project_id) {
    target = { kind: 'message', projectId: item.project_id, messageId: id };
  } else if (kind === 'task' && item.permit_id) {
    const permitId = Number(item.permit_id);
    if (Number.isFinite(permitId)) {
      target = { kind: 'permit', projectId: item.project_id, permitId };
    }
  } else if (kind === 'task') {
    target = { kind: 'task', taskId: id };
  }
  if (!target) return null;
  return targetHref({ target, permitId: null, projectId: item.project_id });
}

// ---------------------------------------------------------------------------
// ★★ THE GAP RULE — a TS MIRROR of bp_notification_delivery_gaps_for
// ---------------------------------------------------------------------------
//
// There is no live database in CI, so the rule is mirrored here and pinned to
// the migration's text by the fix-650 test (the fix-153 pattern). Change one,
// change both.

/** The SQL's thresholds, by name. */
export const GAP_MIN_AGE_MS = 60 * 60 * 1000; // created ≥ 1 hour ago
export const GAP_ACTIVE_AFTER_MS = 5 * 60 * 1000; // active after created + 5 min
export const GAP_SETTLE_MS = 2 * 60 * 1000; // a run that began ≥ 2 min ago

export interface GapCandidate {
  user_id: string;
  item_key: string;
  created_at: string;
}

export interface PresenceRun {
  last_active_at: string;
  active_since: string;
}

/** Is this candidate a gap right now? */
export function isDeliveryGap(
  c: GapCandidate,
  presence: PresenceRun | undefined,
  hasRead: boolean,
  hasBellReceipt: boolean,
  now: number,
): boolean {
  if (hasRead || hasBellReceipt || !presence) return false;
  const created = Date.parse(c.created_at);
  const last = Date.parse(presence.last_active_at);
  const since = Date.parse(presence.active_since);
  if ([created, last, since].some((t) => Number.isNaN(t))) return false;
  if (created > now - GAP_MIN_AGE_MS) return false;
  if (last < created + GAP_ACTIVE_AFTER_MS) return false;
  if (since > now - GAP_SETTLE_MS) return false;
  return true;
}

/** The fingerprint one gap files under — one per person + item. */
export function gapFingerprint(userId: string, itemKey: string): string {
  return `notification_delivery:${userId}:${itemKey}`;
}

/** ★ The check's write: gaps whose fingerprint has never been filed, deduped. */
export function newTriageFingerprints(
  gaps: ReadonlyArray<Pick<GapCandidate, 'user_id' | 'item_key'>>,
  existing: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set(existing);
  for (const g of gaps) {
    const fp = gapFingerprint(g.user_id, g.item_key);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(fp);
  }
  return out;
}
