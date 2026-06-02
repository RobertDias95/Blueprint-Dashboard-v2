// fix-97: client-side validation for the cycle date editor. Mirrors
// bp_upsert_permit_cycle_row's fix-89 chronology rule + adds a year-range
// guard for native date inputs (which accept any year, including 0020).
//
// The server check stays as the source of truth — this is UX so the user
// learns the same vocabulary before the round-trip instead of after.

/** Acceptable year range for any cycle date field. Bobby's earliest
 *  backfill data starts in 2025; the latest planning targets fit well
 *  within 5 years. Wider than necessary to keep room for late-year
 *  imports, narrow enough to catch keystrokes like 0020 / 0002 that
 *  the native date input would otherwise silently accept. */
export const CYCLE_MIN_DATE = '2020-01-01';
export const CYCLE_MAX_DATE = '2030-12-31';
const MIN_YEAR = 2020;
const MAX_YEAR = 2030;

/** The chain fields, in chronological order. matches fix-89's pair-wise
 *  checks in bp_upsert_permit_cycle_row. city_target is intentionally
 *  excluded — the city's scheduled review date doesn't have a fixed
 *  ordering against submitted (fix-24c). */
export type CycleChainField =
  | 'submitted'
  | 'intake_accepted'
  | 'corr_issued'
  | 'resubmitted';

/** All editable cycle date field names, including city_target. Used by
 *  callers to gate year-range checks across every cycle <input>. */
export type CycleDateField = CycleChainField | 'city_target';

/** ISO YYYY-MM-DD or empty/null. */
export type DateInput = string | null | undefined;

/** Returns an error message when the value's year is outside
 *  [MIN_YEAR, MAX_YEAR], or null when the value is empty / in range.
 *  Accepts the same partial-input grace as bp_upsert_permit_cycle_row:
 *  an empty string is "not entered yet" and skips the check. */
export function validateYearRange(value: DateInput): string | null {
  if (!value) return null;
  // Strict YYYY-MM-DD shape — anything else (mid-typing, partial paste)
  // is left for the date input's own native parsing to clean up.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return `Year must be between ${MIN_YEAR} and ${MAX_YEAR}`;
  }
  return null;
}

interface ChainRow {
  submitted?: DateInput;
  intake_accepted?: DateInput;
  corr_issued?: DateInput;
  resubmitted?: DateInput;
}

/** The chain errors map: each field that participates in the chain gets a
 *  string when it violates the chronology rule, or null/undefined when
 *  fine. Mirrors the server's fix-89 pair-wise checks so the inline
 *  message matches the toast the user would have seen post-round-trip. */
export type ChainErrors = Partial<Record<CycleChainField, string>>;

/** Compute pair-wise chronology errors for a proposed cycle row. NULL
 *  fields short-circuit any pair they participate in — partial data is
 *  legitimate during backfill or piecemeal entry. The message format
 *  mirrors bp_upsert_permit_cycle_row's RAISE EXCEPTION so the user
 *  learns the same vocabulary on both sides of the wire. */
export function validateCycleChain(row: ChainRow): ChainErrors {
  const sub = norm(row.submitted);
  const intake = norm(row.intake_accepted);
  const corr = norm(row.corr_issued);
  const res = norm(row.resubmitted);
  const errors: ChainErrors = {};

  if (sub && intake && intake < sub) {
    errors.intake_accepted =
      `intake_accepted (${intake}) cannot precede submitted (${sub})`;
  }
  if (intake && corr && corr < intake) {
    errors.corr_issued =
      `corr_issued (${corr}) cannot precede intake_accepted (${intake})`;
  }
  if (sub && corr && corr < sub) {
    // The intake-vs-corr pair above takes priority when intake is
    // populated; only surface this when intake is blank so we don't
    // double-flag a single field with two messages.
    if (!intake) {
      errors.corr_issued =
        `corr_issued (${corr}) cannot precede submitted (${sub})`;
    }
  }
  if (res) {
    if (sub && res < sub) {
      errors.resubmitted =
        `resubmitted (${res}) cannot precede submitted (${sub})`;
    } else if (intake && res < intake) {
      errors.resubmitted =
        `resubmitted (${res}) cannot precede intake_accepted (${intake})`;
    } else if (corr && res < corr) {
      errors.resubmitted =
        `resubmitted (${res}) cannot precede corr_issued (${corr})`;
    }
  }
  return errors;
}

/** Returns a non-empty ISO string, or null. Treats both null and ''
 *  as "not entered" — matches the server's NULLIF(value,'') guard. */
function norm(v: DateInput): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}
