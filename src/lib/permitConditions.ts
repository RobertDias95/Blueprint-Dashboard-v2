// ===========================================================================
// ★★★ fix-438 — A STANDING CONDITION IS ONE SELF-CLEARING ROW
// ===========================================================================
//
// Ruling, Bobby 2026-08-29 (D-2026-08-29-a-standing-condition-is-one-self-
// clearing-row). A condition is not an error and not an event:
//
//     an EVENT      happened once and is true for ever      → audit_log
//     an ERROR      the Bridge did something wrong          → error_reports
//     a CONDITION   is true NOW and will stop being true    → permit_conditions
//
// ★★★ THE FAILURE THIS REPLACES, MEASURED 2026-08-29. `mbp_resubmittal`
// ("stuck in corrections, no upload") was written to error_reports on EVERY
// scraper run: 25 open rows describing THREE permits, one of them since
// 2026-08-19. A condition modelled as an event repeats for ever and can never
// be finished, which is P-069 — a warning that comes back after being
// resolved — and it is why there is no Resolve here. The row maintains itself:
// the scraper sends the full current set, and anything absent from it clears.
//
// ★★ AND WHY IT IS NOT MERELY "FILTER THE TRIAGE PANEL". The other 148 open
// scraper rows are transient fetch failures that DID retry (audit_log holds
// 1,422 scrape_workflow_fetch_recovered rows in the same window) — they name a
// permit each and are still nobody's work. So the dividing line is the KIND,
// not whether a permit is named: housekeeping never reaches a person, and a
// condition becomes one row addressed to the person who can act on it.

import type { PermitConditionDbRow } from './database.types';

/** ★ The kind is namespaced by the source that owns it — the database CHECKs
 *  it, and bp_sync_permit_conditions clears only its own prefix. */
export type ConditionKind = string;

/** ★ The row shape lives in database.types (hand-typed, with the table and the
 *  three RPC signatures beside it); this alias is what the rest of the app
 *  reads so a rename has one place to happen. */
export type PermitConditionRow = PermitConditionDbRow;

/**
 * ★★★ B2 — WHEN A CONDITION IS SHOWING.
 *
 * Open, and either never acknowledged or acknowledged against a DIFFERENT
 * material detail. Acknowledging hides it; the condition changing brings it
 * back; clearing removes it altogether.
 *
 * ★★★ THE HASH IS OVER THE MATERIAL DETAIL, NOT THE WHOLE OF IT, AND THAT
 * DECISION IS THE DIFFERENCE BETWEEN THIS AND P-069. The live resubmittal
 * detail carries `days_in_corrections`, which ticks EVERY DAY — permit 198 went
 * 14 → 30 over nine days — plus a `scraper_run_at` that changes every run.
 * Verified on prod against the real payloads:
 *
 *     md5(whole detail)      day 14 → 0b364980…   day 30 → 41e655b6…   CHANGES
 *     md5(material detail)   day 14 → 29aa2862…   day 30 → 29aa2862…   HOLDS
 *     …and cycle 2 → 3       29aa2862… → cb53af26…                     CHANGES
 *
 * So hashing the whole thing would re-surface an acknowledged condition every
 * single morning: the exact warning-that-comes-back this ruling closes, rebuilt
 * inside its own fix. `bp_condition_detail_hash` strips the time-varying keys;
 * a genuine change — a new cycle, a different disagreeing field — still
 * re-surfaces it, which is the whole point of acknowledging rather than
 * dismissing.
 */
export function isConditionShowing(c: PermitConditionRow): boolean {
  if (c.cleared_at) return false;
  if (!c.acknowledged_at) return true;
  return c.acknowledged_detail_hash !== c.detail_hash;
}

/**
 * ★★ THE KEY, and it carries `first_seen_at` on purpose (B4).
 *
 * A condition that cleared and came back is a NEW piece of news — it went away
 * and returned, and the person's earlier "I know" was about the previous
 * episode. `bp_sync_permit_conditions` stamps a fresh `first_seen_at` on
 * re-open and drops the acknowledgement, so the key changes with it and the
 * item arrives unread. A condition that merely persists keeps one key for its
 * whole life, so it cannot re-notify by existing.
 */
export function keyForCondition(id: string, firstSeenAt: string): string {
  return `cond:${id}:${firstSeenAt}`;
}

/**
 * ★★ The id back out of the key, for the Acknowledge button.
 *
 * ★ Split on the FIRST two colons only. The id is a uuid and carries none, but
 *   `first_seen_at` is an ISO timestamp and is full of them — `key.split(':')[1]`
 *   is right and `key.split(':').pop()` would return the seconds. Returns '' for
 *   anything that is not a condition key, so a caller cannot silently
 *   acknowledge the wrong row.
 */
export function conditionIdFromKey(key: string): string {
  const parts = key.split(':');
  if (parts[0] !== 'cond' || parts.length < 3) return '';
  return parts[1] ?? '';
}

interface ConditionCopy {
  title: string;
  /** Built from `detail`; null when the payload says nothing worth adding. */
  subtitle: (detail: Record<string, unknown> | null) => string | null;
}

function num(detail: Record<string, unknown> | null, key: string): number | null {
  const v = detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(detail: Record<string, unknown> | null, key: string): string | null {
  const v = detail?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// ★★ THE WORDS A PERSON MEETS, keyed by the stored kind — the same separation
// fix-343 drew for roles: the stored value is a join key, the label is a fact
// about the screen. A kind with no entry here still surfaces (see
// conditionCopy's fallback) rather than being silently dropped, because a
// condition nobody named is still a condition somebody has to act on.
const CONDITION_COPY: Record<string, ConditionCopy> = {
  'scraper:mbp_resubmittal': {
    title: 'In corrections with no resubmittal',
    subtitle: (d) => {
      const days = num(d, 'days_in_corrections');
      const since = str(d, 'corr_issued');
      // ★ The DAY COUNT belongs in the sentence even though it is stripped
      //   from the hash. Those are different jobs: the hash decides whether to
      //   interrupt somebody again, the sentence tells them how bad it is now.
      const head =
        days == null
          ? 'Corrections are outstanding and nothing has been uploaded.'
          : `${days} days in corrections with nothing uploaded.`;
      return since ? `${head} Corrections issued ${since}.` : head;
    },
  },
  'scraper:cycle_disagreement': {
    // ★ fix-439 routes audit_log's `scrape_cycle_disagreement` here — 40 rows
    //   over 10 permits, dormant since 2026-05-19, and the same
    //   condition-written-as-event shape. Named now so the kind arrives with
    //   words already attached rather than as a raw string.
    title: 'The city disagrees with a stored date',
    subtitle: (d) => {
      const field = str(d, 'field');
      const observed = str(d, 'observed');
      const stored = str(d, 'db');
      if (field && observed && stored) {
        return `${field}: the city says ${observed}, the Bridge holds ${stored}.`;
      }
      return field ? `${field} does not match the city's record.` : null;
    },
  },
};

/** ★ A kind nobody has written copy for still reaches its ENT lead. The
 *  fallback humanises the stored key rather than hiding the row — an unnamed
 *  condition is a missing label, not a missing problem. */
export function conditionCopy(c: PermitConditionRow): {
  title: string;
  subtitle: string | null;
} {
  const entry = CONDITION_COPY[c.kind];
  if (entry) return { title: entry.title, subtitle: entry.subtitle(c.detail) };
  const bare = c.kind.split(':').slice(1).join(':') || c.kind;
  return {
    title: bare.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase()),
    subtitle: null,
  };
}

/** The kinds this build knows how to word. Exported so a test can prove the
 *  copy map and the migration's documented kinds have not drifted apart. */
export const KNOWN_CONDITION_KINDS = Object.keys(CONDITION_COPY);
