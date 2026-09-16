// ===========================================================================
// ★★★ fix-511 §C (P-198) — A REPORTED MUTATION MUST NAME WHAT IT WAS WRITING
// ===========================================================================
//
// PROD ROW 696, 2026-09-09 19:31:57, cameron@blueprintcap.com:
//
//   message  invalid input syntax for type integer: "1.015e+68"
//   context  { "url": "/project/bdeedc93-…", "kind": "mutation" }
//
// That is the whole row. **No RPC name, no table, no field.** Pinning it took
// four database queries — find the project, list its integer columns, work out
// which of them a value that shape could reach, then read the column types to
// confirm. Rows 694/695 in §B are the same shape and cost the same again.
//
// ★★★ AND THE REASON THE FIELD WAS MISSING IS NOT AN OVERSIGHT — IT IS THAT
// NOBODY EVER SET A `mutationKey`. App.tsx has sent `mutationKey` since fix-87.
// Every prod row shows `{url, kind}` and nothing else, because `mutationKey` is
// optional in React Query and not one of this app's ~90 mutation hooks declares
// one. A field that is always `undefined` reads exactly like a field that does
// not exist.
//
// ---------------------------------------------------------------------------
// ★★ SO THE NAME COMES FROM `meta`, WHICH IS ONE LINE PER HOOK AND NOT A KEY
// ---------------------------------------------------------------------------
//
// `mutationKey` is load-bearing elsewhere — `describeMutation` reads it for the
// save-failure banner and `shouldSkipBackendRpcLog` matches on it — so adding
// keys to 90 hooks to carry a name would change behaviour nobody asked to
// change. `meta` carries nothing else and is read by nobody else.
//
// ★★★ THE ALTERNATIVE, AND WHY IT WAS REFUSED: the name could be captured
// automatically by wrapping `supabase.rpc` in lib/supabase, which would cover
// every call site at once with no per-hook line. It was not done because every
// one of the ~200 suites that touch a mutation mocks that module, so the wrapper
// would be absent in precisely the tests meant to prove it. An opt-in line that
// is visible in the hook beats an automatic mechanism that is invisible and
// untestable. The hooks this ticket touched carry it; the next hook to appear in
// Error Reports gets a line.
//
// ---------------------------------------------------------------------------
// ★★★ FIELDS ARE KEYS, NEVER VALUES
// ---------------------------------------------------------------------------
// `patch` holds what somebody typed. `Object.keys(patch)` says WHICH column
// refused it, which is the whole diagnostic value, and carries no address, no
// name and no number into a table 29 people can read. `fieldLabel` is a UI
// caption the app itself chose ("Lot Size"), so it is safe by construction.

/** What a mutation declares about itself, in `useMutation({ meta })`. */
export interface MutationWriteMeta {
  /** What it writes, as a person would look it up: an RPC name
   *  (`bp_upsert_da_time_block_row`) or `table.verb` (`projects.update`). */
  write?: string;
}

export interface MutationErrorContext {
  /** Present only when the hook actually declares one. */
  mutationKey?: unknown;
  /** The RPC or table the failing mutation was writing. */
  write?: string;
  /** Which fields it was writing — COLUMN NAMES AND CAPTIONS ONLY. */
  fields?: string[];

  // ════════════════════════════════════════════════════════════════
  // ★★★ fix-579 (P-283) — BOTH SIDES OF A REFUSED OCC COMPARISON
  // ════════════════════════════════════════════════════════════════
  //
  // ★★ THESE OBEY THE SAME RULE AS `fields`, WHICH IS WHY THEY ARE ALLOWED
  //    HERE AT ALL: an ISO timestamp and a row id say WHICH row and WHEN. They
  //    carry no address, no name and no typed value. **Do not widen this into
  //    arbitrary row content** — that is the line `fields` exists to hold.

  /** The row the refused write was aimed at. */
  occRowId?: string | number;
  /** The token the client POSTED as `p_expected_updated_at`. */
  occExpected?: string;
  /**
   * The row's REAL `updated_at` at the moment of refusal.
   *
   * ★★★ ABSENT MEANS THE ROW WAS GONE. All three conflict paths re-read the
   *     row into `v_actual`, which is NULL when it no longer exists — so
   *     `occConflict: 'row-missing'` below is a DELETE, not an edit collision.
   */
  occActual?: string;
  /**
   * `actual − expected`, in milliseconds. **This is the number that answers
   * the question.**
   *
   *   sub-second   the row moved DURING the save
   *   minutes      the row moved while the editor sat open
   *   exactly 0    the two instants are identical and the comparison still
   *                refused — which would be a different bug entirely
   *   negative     the row's stamp went BACKWARDS, which should be impossible
   */
  occDeltaMs?: number;
  /** `now − expected`: how old the token the client was holding had become.
   *  ★ Honestly named — it is the age of the TOKEN, not of the open popup: a
   *    row nobody has touched for a week hands out a week-old token. */
  occTokenAgeMs?: number;
  /**
   * What kind of refusal this was, so a reader does not have to infer it from
   * which fields are present.
   *
   *   `stale-token`  the row exists and its stamp differs from the one posted
   *   `row-missing`  the row is gone — the refusal is a delete, not a conflict
   *   `same-instant` both stamps parse to the SAME instant and it refused
   *                  anyway; see `occDeltaMs`
   */
  occConflict?: 'stale-token' | 'row-missing' | 'same-instant';
}

/** ★ A patch with 40 keys is a bulk save; the first dozen identify it as well
 *  as all of them would, and the cap keeps one row from carrying a schema. */
const MAX_FIELDS = 12;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Build the extra context a failing mutation contributes to its error report.
 *
 * ★ Every part is optional and absent rather than null when unknown — an
 *   `undefined` key is dropped by `JSON.stringify` on the way into `p_context`,
 *   so a hook that declares nothing produces exactly the row it produces today.
 */
export function mutationErrorContext(
  mutationKey: unknown,
  meta: unknown,
  variables: unknown,
  /** ★ fix-579: optional and last, so every existing three-argument caller is
   *  unchanged and a hook that raises no detail reports exactly what it does
   *  today. */
  error?: unknown,
): MutationErrorContext {
  const out: MutationErrorContext = {};
  if (mutationKey !== undefined) out.mutationKey = mutationKey;

  if (isRecord(meta) && typeof meta.write === 'string' && meta.write !== '') {
    out.write = meta.write;
  }

  const fields = fieldsOf(variables);
  if (fields.length > 0) out.fields = fields;

  Object.assign(out, occDetailOf(error));
  return out;
}

/**
 * Pull the two sides of a refused OCC comparison off the error, if it carries
 * them.
 *
 * ★★ DUCK-TYPED RATHER THAN `instanceof`. This module is imported by App's
 *    MutationCache, which sees errors from every hook in the app; requiring the
 *    class would couple the reporter to `lib/occ` and would silently contribute
 *    nothing if a bundling quirk ever produced two copies of it. A shape check
 *    cannot fail that way.
 */
function occDetailOf(error: unknown): Partial<MutationErrorContext> {
  if (!isRecord(error)) return {};
  const detail = (error as { detail?: unknown }).detail;
  if (!isRecord(detail)) return {};

  const out: Partial<MutationErrorContext> = {};
  const { rowId, expected, actual } = detail as {
    rowId?: unknown;
    expected?: unknown;
    actual?: unknown;
  };

  if (typeof rowId === 'string' || typeof rowId === 'number') out.occRowId = rowId;
  if (typeof expected === 'string') out.occExpected = expected;
  if (typeof actual === 'string') out.occActual = actual;

  // ★ `expected` absent means this was an INSERT path, which posts null — there
  //   is no comparison to describe, so nothing is contributed.
  if (out.occExpected === undefined) return out;

  if (out.occActual === undefined) {
    // ★★★ THE ROW IS GONE. Named rather than left as a missing field, because
    //     "the stamp differed" and "there was no row" are different incidents
    //     that have been wearing one message.
    out.occConflict = 'row-missing';
    return out;
  }

  const e = Date.parse(out.occExpected);
  const a = Date.parse(out.occActual);
  if (Number.isFinite(e) && Number.isFinite(a)) {
    out.occDeltaMs = a - e;
    out.occTokenAgeMs = Date.now() - e;
    // ★★★ IDENTICAL INSTANTS THAT STILL REFUSED. The stamps round-trip through
    //     JSON as text and are compared as `timestamptz` in the RPC, so a
    //     precision or formatting difference could refuse a write whose two
    //     sides mean the same moment. That would be a DIFFERENT bug from the
    //     one being hunted, and this is how it would announce itself rather
    //     than hiding inside a delta of zero.
    out.occConflict = out.occDeltaMs === 0 ? 'same-instant' : 'stale-token';
  } else {
    out.occConflict = 'stale-token';
  }
  return out;
}

/** ★★ Two shapes, because this app has two: a `patch` object (the OCC row
 *  editors) and a `fieldLabel` caption (the inline commit helpers, which
 *  already pass one so the toast can name the field). Anything else
 *  contributes nothing rather than guessing. */
function fieldsOf(variables: unknown): string[] {
  if (!isRecord(variables)) return [];
  const out: string[] = [];
  const label = variables.fieldLabel;
  if (typeof label === 'string' && label !== '') out.push(label);
  if (isRecord(variables.patch)) {
    for (const k of Object.keys(variables.patch)) {
      if (!out.includes(k)) out.push(k);
    }
  }
  return out.slice(0, MAX_FIELDS);
}
