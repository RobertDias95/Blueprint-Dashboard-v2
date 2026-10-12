// ===========================================================================
// ★★★ fix-646 (P-066 + P-011) — THE SMART "RESUBMIT BY" DATE
// ===========================================================================
//
// ⚖️ Bobby 10-11: "turning around cycle 1 corrections, we give 10 business
//    days, after that, every other cycle we try to turn around within 5
//    business days, but volume of corrections also plays a part … amount of
//    corrections + cycle". He approved this table:
//
//      round   items on the letter            business days
//      CR1     ≤10 / 11–25 / 26–50 / 51+      10 / 15 / 20 / 25
//      CR2+    ≤10 / 11–25 / 26+              5 / 8 / 10
//      any     letter not indexed yet (0)     the base (10 / 5)
//
//    Counted from the day AFTER corr_issued, weekends skipped, no holidays.
//
// ★★★ THE DATABASE IS THE RULE. `bp_resubmit_rounds_for` (migrations/
//     fix_646_smart_resubmit_by.sql) computes every open round's date; the
//     screens read it through `bp_resubmit_rounds()` and the 7 AM warning and
//     the Weekly Update read the same function. This module is the TS MIRROR
//     (no live DB in CI), pinned to the SQL by ResubmitByFix646.test.ts, plus
//     the words every screen uses.

import { businessDaysBetween } from './intakeWarning';

/** app_config key: the fixed people every Resubmit-by warning also reaches. */
export const RESUBMIT_WARNING_RECIPIENTS_KEY = 'resubmitWarningRecipients';

/** The tiers, as data, so the label and the formula cannot drift. `max` is
 *  the inclusive item ceiling of the tier (null = no ceiling). */
export const RESUBMIT_TIERS: Readonly<{
  first: readonly { max: number | null; days: number }[];
  later: readonly { max: number | null; days: number }[];
}> = {
  first: [
    { max: 10, days: 10 },
    { max: 25, days: 15 },
    { max: 50, days: 20 },
    { max: null, days: 25 },
  ],
  later: [
    { max: 10, days: 5 },
    { max: 25, days: 8 },
    { max: null, days: 10 },
  ],
};

/** ★★★ Twin of `bp_resubmit_business_days`. Null for cycle 0 / no cycle. */
export function resubmitBusinessDays(cycleIndex: number | null, items: number | null): number | null {
  if (cycleIndex == null || cycleIndex < 1) return null;
  const n = Math.max(0, items ?? 0);
  const tiers = cycleIndex === 1 ? RESUBMIT_TIERS.first : RESUBMIT_TIERS.later;
  for (const t of tiers) if (t.max == null || n <= t.max) return t.days;
  return tiers[tiers.length - 1]!.days;
}

function utcDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ★★ Twin of `bp_add_business_days`: the n-th weekday AFTER `from`. */
export function addBusinessDays(from: string, n: number): string {
  if (n <= 0) return from.slice(0, 10);
  const d = utcDay(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return isoOf(d);
}

/** The Resubmit-by date for a round, or null without corr_issued. */
export function resubmitByDate(
  corrIssued: string | null,
  cycleIndex: number | null,
  items: number | null,
): string | null {
  if (!corrIssued) return null;
  const days = resubmitBusinessDays(cycleIndex, items);
  return days == null ? null : addBusinessDays(corrIssued, days);
}

/** Business days past the date (0 when not past). Past = ≥ 1. */
export function businessDaysPast(resubmitBy: string, today: string): number {
  return Math.max(0, businessDaysBetween(resubmitBy, today));
}

/** One open round, as `bp_resubmit_rounds()` returns it. */
export interface ResubmitRound {
  tenant_id: string;
  permit_id: number;
  project_id: string | null;
  address: string | null;
  num: string | null;
  type: string | null;
  status: string | null;
  cycle_index: number;
  corr_issued: string;
  items: number;
  business_days: number;
  resubmit_by: string;
  days_past: number;
  is_past: boolean;
  parked: boolean;
  ent_lead: string | null;
  dm: string | null;
  da: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 22" from `2026-10-22`. No locale, no zone: the key is the date. */
export function monDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

/** "Resubmit by Oct 22". */
export function resubmitByLabel(r: Pick<ResubmitRound, 'resubmit_by'>): string {
  return `Resubmit by ${monDay(r.resubmit_by)}`;
}

/** "3 days past" (business days), or null when not past. */
export function pastLabel(r: Pick<ResubmitRound, 'days_past' | 'is_past'>): string | null {
  if (!r.is_past || r.days_past < 1) return null;
  return `${r.days_past} day${r.days_past === 1 ? '' : 's'} past`;
}

/** The tooltip: "CR1 · 14 items → 15 business days". */
export function resubmitBasis(
  r: Pick<ResubmitRound, 'cycle_index' | 'items' | 'business_days'>,
): string {
  const what = r.items > 0
    ? `${r.items} item${r.items === 1 ? '' : 's'}`
    : 'letter not indexed yet';
  return `CR${r.cycle_index} · ${what} → ${r.business_days} business days`;
}

/** The full tooltip, with the counting rule spelled out. */
export function resubmitTooltip(r: ResubmitRound): string {
  const lines = [
    resubmitBasis(r),
    `Counted from the day after corrections were issued (${monDay(r.corr_issued)}), weekends skipped.`,
  ];
  if (r.items === 0) lines.push('The date can move later once the letter is indexed.');
  if (r.is_past) lines.push(`${pastLabel(r)} (business days).`);
  if (r.parked) lines.push('Project or permit is on hold — no warning emails.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// ★★★ MIRRORS OF THE SQL, for tests (no live DB in CI) — pinned clause by
//     clause to migrations/fix_646_smart_resubmit_by.sql.
// ---------------------------------------------------------------------------

/** The permit fields the open-round rule reads. */
export interface OpenRoundPermit {
  actual_issue: string | null;
  approval_date: string | null;
  status: string | null;
  project_archived?: boolean | null;
}

/** The cycle fields the open-round rule reads. */
export interface OpenRoundCycle {
  cycle_index: number;
  corr_issued: string | null;
  resubmitted: string | null;
}

/**
 * ★★★ Mirror of `bp_resubmit_rounds_for`'s open-round WHERE: the LATEST cycle
 * ≥ 1, corr_issued set, resubmitted null; the permit not issued (actual_issue
 * AND approval_date null — fix-221), not withdrawn/cancelled; project live.
 * Returns that cycle, or null.
 */
export function openRoundOf(
  permit: OpenRoundPermit,
  cycles: readonly OpenRoundCycle[],
): OpenRoundCycle | null {
  if (permit.project_archived) return null;
  if (permit.actual_issue != null || permit.approval_date != null) return null;
  const status = (permit.status ?? '').toLowerCase();
  if (status.includes('withdraw') || status.includes('cancel')) return null;
  const review = cycles.filter((c) => c.cycle_index >= 1);
  if (review.length === 0) return null;
  const latest = review.reduce((a, b) => (b.cycle_index > a.cycle_index ? b : a));
  if (!latest.corr_issued || latest.resubmitted) return null;
  return latest;
}

/** One round as the warning sees it. */
export interface WarnRound {
  permit_id: number;
  cycle_index: number;
  resubmit_by: string;
  is_past: boolean;
  parked: boolean;
  ent_lead: string | null;
  dm: string | null;
}

/** One ledger row: the round, and the date it was announced for. */
export interface WarnLedgerRow {
  permit_id: number;
  cycle_index: number;
  resubmit_by: string;
  warned_on: string;
}

export interface WarnPerson {
  userId: string;
  email: string;
}

export interface DigestPlan {
  /** Email → the rounds in that person's digest (empty map = nothing sent). */
  digests: Map<string, { userId: string; rounds: WarnRound[] }>;
  /** The rounds written to the ledger this run. */
  ledgered: WarnRound[];
  /** True when the ledger was empty before this run (the launch digest). */
  launch: boolean;
}

/**
 * ★★★ Mirror of `bp_resubmit_warning_enqueue` for ONE tenant on ONE day:
 *   · today's digest already went (a ledger row warned today) → nothing
 *   · NEW = past, not parked, and not ledgered — or ledgered for an EARLIER
 *     date (the letter got indexed, the date moved later, and passed again)
 *   · recipients per round = resolve(ENT) ∪ resolve(DM) ∪ resolve(list),
 *     deduped by email; an opted-out person is not queued
 *   · every NEW round is ledgered, whether or not anyone was queued
 */
export function planResubmitDigests(input: {
  rounds: readonly WarnRound[];
  ledger: readonly WarnLedgerRow[];
  listNames: readonly string[];
  resolve: (name: string) => WarnPerson | null;
  optedOut: ReadonlySet<string>;
  today: string;
}): DigestPlan {
  const { rounds, ledger, listNames, resolve, optedOut, today } = input;
  const digests: DigestPlan['digests'] = new Map();
  if (ledger.some((w) => w.warned_on === today)) {
    return { digests, ledgered: [], launch: false };
  }
  const launch = ledger.length === 0;
  const key = (p: number, c: number) => `${p}:${c}`;
  const warned = new Map(ledger.map((w) => [key(w.permit_id, w.cycle_index), w]));
  const fresh = rounds.filter((r) => {
    if (!r.is_past || r.parked) return false;
    const w = warned.get(key(r.permit_id, r.cycle_index));
    return !w || w.resubmit_by < r.resubmit_by;
  });
  for (const r of fresh) {
    const people = new Map<string, WarnPerson>();
    for (const name of [r.ent_lead, r.dm, ...listNames]) {
      const n = (name ?? '').trim();
      if (!n) continue;
      const p = resolve(n);
      if (!p || !p.email.trim()) continue;
      const email = p.email.trim().toLowerCase();
      if (!people.has(email)) people.set(email, { userId: p.userId, email });
    }
    for (const p of people.values()) {
      if (optedOut.has(p.userId)) continue;
      const d = digests.get(p.email);
      if (d) d.rounds.push(r);
      else digests.set(p.email, { userId: p.userId, rounds: [r] });
    }
  }
  return { digests, ledgered: fresh, launch };
}
