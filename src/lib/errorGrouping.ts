// fix-338 — a pure-TS MIRROR of how the database groups error reports.
//
// ★★ WHY A MIRROR EXISTS AT ALL. The grouping rules live in three plpgsql
// functions (bp_log_error, bp_list_error_groups, bp_new_error_count) and CI has
// no database, so the only things that could be asserted otherwise are the
// SQL's own text and a prod probe nobody can run in a pull request. This is the
// fix-153 pattern the project already uses for RPC logic: a pure mirror carries
// the RULE, a rolled-back prod probe carries the PROOF, and a text assertion
// ties the two together so the mirror cannot drift unnoticed.
//
// ★ NOTHING IN THE APP CALLS THIS. It is a specification, and it is written so
// that a change to the SQL which is not made here fails a test.

/**
 * The message normalisation, mirroring bp_log_error.
 *
 * ★ Digit runs and timestamps are replaced ON PURPOSE — an error carrying a
 * permit number or a clock reading would otherwise be a new group every time,
 * which hides frequency. That intent is what constrains the context slice
 * below: whatever goes into the fingerprint must be as bounded as this is.
 */
export function normalizeErrorMessage(message: string): string {
  let s = message.replace(/\d{4}-\d{2}-\d{2}[T0-9:.+Z-]*/g, '<ts>');
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/\b\d{2,}\b/g, '<num>');
  return s.trim();
}

/**
 * ★★ THE DISCRIMINATOR — the fix.
 *
 * The first element of `context.queryKey`, which is the query NAME, and nothing
 * else. Two failures with the same message on different queries are different
 * failures; before fix-338 they were one group, so resolving the one in front
 * of you silently resolved the one you had never seen.
 *
 * ★ ONLY THE FIRST ELEMENT. React Query keys in this app routinely carry the
 * tenant id and a project id — `['notes', tenantId, { projectId }]` — so hashing
 * the whole key would give every project its own group and turn the list into a
 * raw log. The first element is drawn from queryKeys.ts and is bounded by
 * construction.
 *
 * Returns null when there is nothing usable, and a null discriminator MUST leave
 * the fingerprint byte-identical to the pre-fix-338 one.
 */
export function errorDiscriminator(
  context: unknown,
): string | null {
  if (!context || typeof context !== 'object') return null;
  const key = (context as Record<string, unknown>).queryKey;
  if (!Array.isArray(key) || key.length === 0) return null;
  const head = key[0];
  if (typeof head !== 'string') return null;
  const trimmed = head.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * The string the database hashes.
 *
 * ★ THE PRE-HASH KEY, NOT THE MD5. md5 is injective for anything this cares
 * about — same input, same digest; different input, different digest — so
 * hashing here would add a dependency and test nothing the string does not
 * already decide. What matters is WHICH FACTS go into it, and that is exactly
 * what this returns.
 */
export function errorFingerprintKey(
  source: string,
  message: string,
  context?: unknown,
): string {
  const base = `${source}|${normalizeErrorMessage(message)}`;
  const d = errorDiscriminator(context);
  return d === null ? base : `${base}|${d}`;
}

// ---------------------------------------------------------------------------
// ★ The list's grouping, mirroring bp_list_error_groups
// ---------------------------------------------------------------------------

export interface ErrorOccurrence {
  /** bigserial. ★ The tie-break — see currentStatusOf. */
  id: number;
  fingerprint: string;
  status: 'new' | 'queued' | 'in_progress' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
}

export const OPEN_STATUSES = ['new', 'queued', 'in_progress'] as const;

/**
 * ★★ A GROUP'S CURRENT STATUS IS ITS LATEST OCCURRENCE'S — and the tie-break is
 * load-bearing.
 *
 * `now()` is constant inside a Postgres transaction, so occurrences written
 * together share a `created_at` to the microsecond. Ordering on that alone picks
 * among them arbitrarily; a rolled-back probe caught a just-recurred group
 * reporting itself resolved and disappearing from the Active list — the very bug
 * fix-338 exists to remove, reintroduced by the fix for it. `id` is monotonic
 * and never tied, and the later-inserted row is precisely what "current" means.
 */
export function currentStatusOf(
  occurrences: readonly ErrorOccurrence[],
): ErrorOccurrence['status'] | null {
  if (occurrences.length === 0) return null;
  const latest = [...occurrences].sort((a, b) => {
    const t = b.created_at.localeCompare(a.created_at);
    return t !== 0 ? t : b.id - a.id;
  })[0]!;
  return latest.status;
}

export interface ErrorGroupSummary {
  fingerprint: string;
  status: ErrorOccurrence['status'];
  /** ★ EVERY occurrence, not only those matching a status filter. */
  count: number;
  resolvedCount: number;
  /** ★ Closed at least once, and open again. */
  recurred: boolean;
}

/** Summarise one fingerprint's occurrences the way the RPC does. */
export function summariseGroup(
  occurrences: readonly ErrorOccurrence[],
): ErrorGroupSummary | null {
  const status = currentStatusOf(occurrences);
  if (status === null) return null;
  const resolvedCount = occurrences.filter((o) => o.resolved_at !== null).length;
  return {
    fingerprint: occurrences[0]!.fingerprint,
    status,
    count: occurrences.length,
    resolvedCount,
    recurred:
      resolvedCount > 0 &&
      (OPEN_STATUSES as readonly string[]).includes(status),
  };
}

/**
 * ★★ THE FILTER APPLIES TO THE GROUP, AFTER THE COUNTING.
 *
 * It used to sit in the WHERE, so one clause decided both which groups appeared
 * AND which occurrences were counted — two different questions. `COUNT(*)` then
 * meant "occurrences still open" while the page rendered it as "occurrences",
 * and a fingerprint with one resolved row and one new row read as
 * "New · 1 occurrence" with nothing saying it had been triaged already.
 *
 * ★ The filter keeps its meaning — a group whose current status is resolved
 * still does not appear in the Active list. What changed is that a shown group
 * reports the truth about itself.
 */
export function listErrorGroups(
  occurrences: readonly ErrorOccurrence[],
  statuses: readonly ErrorOccurrence['status'][],
): ErrorGroupSummary[] {
  const byFingerprint = new Map<string, ErrorOccurrence[]>();
  for (const o of occurrences) {
    const list = byFingerprint.get(o.fingerprint);
    if (list) list.push(o);
    else byFingerprint.set(o.fingerprint, [o]);
  }
  const out: ErrorGroupSummary[] = [];
  for (const group of byFingerprint.values()) {
    const summary = summariseGroup(group);
    if (summary && statuses.includes(summary.status)) out.push(summary);
  }
  return out;
}

/**
 * ★ Resolving a group touches every occurrence carrying that fingerprint —
 * which is correct, and which is exactly why the fingerprint had to stop
 * lumping unrelated failures together. Mirrors bp_update_error_group_status.
 */
export function resolveGroup(
  occurrences: readonly ErrorOccurrence[],
  fingerprint: string,
  at = '2026-08-18T00:00:00Z',
): ErrorOccurrence[] {
  return occurrences.map((o) =>
    o.fingerprint === fingerprint
      ? { ...o, status: 'resolved' as const, resolved_at: at }
      : o,
  );
}
