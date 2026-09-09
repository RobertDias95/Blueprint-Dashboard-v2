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
): MutationErrorContext {
  const out: MutationErrorContext = {};
  if (mutationKey !== undefined) out.mutationKey = mutationKey;

  if (isRecord(meta) && typeof meta.write === 'string' && meta.write !== '') {
    out.write = meta.write;
  }

  const fields = fieldsOf(variables);
  if (fields.length > 0) out.fields = fields;
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
