import { supabase } from './supabase';
import { buildStamp } from './buildInfo';

// fix-87: single entry point for sending errors to the bp_log_error RPC.
//
// Fire-and-forget by design: callers (toasts, global window handlers, the
// error boundary, the QueryClient defaults) live on the UI hot path and
// must NOT await network. We also swallow any RPC failure: logging the
// logger's own failure would risk recursion (a failing log call producing
// another log call), and a network blip shouldn't break the app. In
// development we re-throw to the console so the dev workflow surfaces the
// log path being broken; in prod we stay silent.
//
// In test environments (vitest) we hand back the supabase rpc Promise so
// tests can await it and assert call shape; production callers fire-and-
// forget and ignore the return.

export type ErrorSource =
  | 'frontend_toast'
  | 'frontend_exception'
  | 'backend_rpc'
  | 'scraper';

export type ErrorLevel = 'error' | 'warning';

export interface LogErrorInput {
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  context?: Record<string, unknown>;
}

// fix-165: Postgres SQLSTATEs that represent USER-INPUT validation
// rejections, not system faults. fix-89's chronology chain in
// bp_upsert_permit_cycle_row RAISEs 22008 (datetime_field_overflow) when a
// user types an out-of-order date — nothing is saved, and they already see an
// inline toast + red cell. These must NOT be logged to Error Reports
// (Settings → Errors), where they read as system bugs and drown the real
// signal. Keep the set narrow: only codes a user can self-correct belong here.
export const USER_INPUT_SQLSTATES: ReadonlySet<string> = new Set(['22008']);

/** Extract a Postgres SQLSTATE from a supabase-js error
 *  (`{ message, code, details, hint }`). Returns undefined for errors that
 *  don't carry a string `code` (plain Errors, OCC conflicts, etc.). */
export function sqlStateOf(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

/** True when the error is a known user-input validation rejection (see
 *  USER_INPUT_SQLSTATES). The caller should surface it inline (toast / red
 *  field) but skip logging it to error_reports. Conservative by design: an
 *  unrecognized code returns false so genuine system errors keep logging. */
export function isUserInputValidationError(e: unknown): boolean {
  const code = sqlStateOf(e);
  return code !== undefined && USER_INPUT_SQLSTATES.has(code);
}

// ★★ fix-620 (P-315) — AN OVERLAP WITH FINISHED WORK IS A REFUSAL, NOT A FAULT.
//    The draw-schedule trigger `bp_draw_schedule_no_overlap` raises SQLSTATE
//    P0620 with a plain sentence ("This overlaps 4409 S Holly St (Jun 24 –
//    Jul 1, 2024). Finished blocks don't move — …"). The screen shows it as a
//    prompt (components/BlockOverlapPrompt); Error Triage never hears of it.
//    ★ Matched on the CODE only — never on the wording (fix-357).
export const BLOCK_OVERLAP_SQLSTATE = 'P0620';

export function isBlockOverlapRefusal(e: unknown): boolean {
  return sqlStateOf(e) === BLOCK_OVERLAP_SQLSTATE;
}

// ===========================================================================
// ★★★ fix-619 §Z (P-312) — A DUPLICATE ADDRESS IS A REFUSAL, NOT A FAULT
// ===========================================================================
//
// TRIAGE #753, prod, 2026-10-01 14:34 PT: Shire renamed a new Cloverdale St
// project to an address another project held at that moment.
// `bp_update_project_with_permits` refused on `projects_address_unique_non_redesign`
// — correctly — and the refusal was filed to Triage at `error`, as a raw
// "duplicate key value violates unique constraint …".
//
// ⚖️ Bobby, 2026-10-01: **"Dismiss + quiet both."** The person reads a plain
//    sentence, and this refusal is NOT filed to Triage.
//
// ★★ NAMED, NOT A CODE. 23505 is every unique constraint in the database; most
//    of them guard invariants whose violation IS a bug. So the exemption is the
//    CONSTRAINT's name, the same way USER_INPUT_SQLSTATES names its one code —
//    and any OTHER unique violation still reports.

/** Unique constraints whose refusal is an expected, self-correctable answer,
 *  mapped to the sentence a person reads. */
export const EXPECTED_UNIQUE_REFUSALS: Readonly<Record<string, string>> = {
  projects_address_unique_non_redesign: 'Another project already has this address.',
};

/** The sentence for an expected unique refusal, or null when `e` is not one.
 *  Matches on the SQLSTATE (23505) or Postgres' own wording, AND a constraint
 *  name in the allow-list — never on the wording alone. */
export function expectedUniqueRefusal(e: unknown): string | null {
  const code = sqlStateOf(e);
  const m = messageOf(e);
  const isUnique =
    code === '23505' || /duplicate key value violates unique constraint/i.test(m);
  if (!isUnique) return null;
  const details =
    e && typeof e === 'object' && 'details' in e
      ? String((e as { details?: unknown }).details ?? '')
      : '';
  for (const [constraint, sentence] of Object.entries(EXPECTED_UNIQUE_REFUSALS)) {
    if (m.includes(constraint) || details.includes(constraint)) return sentence;
  }
  return null;
}

/** ★ The duplicate-address sentence, naming the address when the caller has
 *  it — the other project IS the one at that address, so this names it. */
export function duplicateAddressSentence(address: string | null | undefined): string {
  const a = (address ?? '').trim();
  return a
    ? `Another project already has the address "${a}".`
    : EXPECTED_UNIQUE_REFUSALS.projects_address_unique_non_redesign;
}

// ===========================================================================
// ★★ fix-341 §2 — a request that was CANCELLED is not a fault
// ===========================================================================
//
// `TypeError: Failed to fetch` on `['notes', <tenant>, 'search-index']`, twice,
// three days apart, both times stamped with a /project/… URL — a page that
// never runs that query. Its only consumer is ProjectList; the URL in the
// report is read at LOG time, after the user has navigated, which is what made
// the report describe a page the query had already left.
//
// ★ CLASSIFY BY CAUSE, NOT BY MESSAGE. Matching on "Failed to fetch" would
// silence a genuine outage — the same three words appear when the API is down.
// What separates the two is not the wording:
//
//   · an explicit abort (AbortError / React Query's CancelledError) is a
//     cancellation the app itself performed, and
//   · a query with NO OBSERVERS when it settles had nobody to fail in front
//     of: the screen that wanted it is gone, and whatever mounts next will
//     fetch again.
//
// Both are facts about the request, not about its text. An error on a query
// somebody is looking at still logs, whatever it says.

/** ★ An explicitly cancelled request: the DOM's AbortError, or React Query's
 *  CancelledError (thrown by `cancelQueries`, which several onMutate handlers
 *  call). Matched on the ERROR'S OWN IDENTITY — its name / constructor — never
 *  on its message. */
/**
 * ★★ fix-341 §2 — the whole logging decision for a QUERY failure, in one
 * testable place.
 *
 * It used to live inline in App.tsx's QueryCache.onError, where the only way to
 * exercise it was to boot the app. The rules are unchanged apart from this
 * ticket's two additions, and each is a fact about the request rather than
 * about its message:
 *
 *   · an auth-keyed query — a missing session is expected user flow (fix-314
 *     notes this currently matches nothing, and it is kept as a guard);
 *   · a user-input validation rejection — fix-165, SQLSTATE 22008;
 *   · the log RPC itself — the re-entry guard, belt and braces;
 *   · ★ a CANCELLED request — the app or the browser stopped it;
 *   · ★ a query with NO OBSERVERS — nothing rendered was waiting for it.
 *
 * ★ Everything else logs, including "Failed to fetch" on a query somebody is
 * looking at. That is the difference between classifying and silencing.
 */
export function shouldLogQueryFailure(
  err: unknown,
  key: unknown,
  observers: number,
): boolean {
  if (shouldSkipBackendRpcLog(err, key)) return false;
  if (isQuietNetworkQueryFailure(err, key)) return false;
  return observers > 0;
}

// ===========================================================================
// ★★★ fix-441 §C (P-014) — A MISSING THUMBNAIL IS NOT AN ERROR
// ===========================================================================
//
// Prod, 2026-08-26: one error-level report for 220 N 58th St whose storage
// object was present and healthy — a transient signing miss on a picture. It
// reached Error Triage at the same level as "permission denied for table
// permits", because it fell through every skip rule into fix-341's closing
// sentence: *"Everything else logs."*
//
// ★★★ CLASSIFIED BY THE QUERY KEY, WHICH IS A CAUSE — never by the message.
// That is fix-341 §2's rule and it is the whole reason this is a key list and
// not a regex over "Failed to fetch": those three words also appear when the
// API is down, and silencing them by wording would silence a real outage. What
// separates a thumbnail from a permit read is not how the failure is phrased,
// it is WHICH QUERY FAILED — and that is a fact about the request.
//
// ★★ WHY WARNING RATHER THAN SILENCE. The card already degrades to its own
// file-card empty state, so nobody is blocked and nobody is misled; but a
// thumbnail bucket that started failing for EVERY project is a real problem,
// and a level-0 silence would hide it. `error_reports.level` is
// 'error' | 'warning' and the triage page already renders both, so the fact
// survives at the severity it deserves.
//
// ★ THE LIST IS DECORATION ONLY, and the test that pins it says so: a query
//   qualifies when its failure costs the reader nothing they can see. Adding a
//   key here is a decision about severity, never a way to quieten a query that
//   is misbehaving.
export const DECORATION_QUERY_KEYS: ReadonlySet<string> = new Set([
  // The signed URL for a plan-of-record page-1 JPEG. Its absence is already a
  // legitimate state — the indexer may not have run — which is why the hook
  // sets `retry: false`.
  'plan_of_record_thumb',
]);

// ===========================================================================
// ★★★ fix-613 §Z (P-309) — A SIGNATURE THAT NEVER LEFT THE LAPTOP
// ===========================================================================
//
// TRIAGE #752, prod, 2026-10-01 10:49:11 PT, Brittani:
//
//   Failed to fetch — avatar_url (00000000-…/a62d67f4-….jpg)
//   {"kind":"query","operation":"avatar_url","record":"…"}
//
// ★★★ THE REQUEST NEVER COMPLETED. Not a 404, not a permission refusal — a
//     `TypeError: Failed to fetch`, which is the browser saying it could not get
//     the request onto the wire at all. The object was intact, the signature
//     would have worked, and she kept working: the circle drew her initials and
//     she never knew. **Fourth time, and only ever her connection.**
//
// ⚖️ Bobby ruled dismiss, and ruled the class quiet: a network blip on a
//    PICTURE is not something anybody will ever action.
//
// ---------------------------------------------------------------------------
// ★★ WHY THIS IS A KEY LIST AND NOT A MESSAGE REGEX — fix-341 §2's RULE AGAIN
// ---------------------------------------------------------------------------
// "Failed to fetch" also appears when the API is down. Silencing those three
// words by WORDING would silence a real outage; what separates a blip on an
// avatar from a blip on the permit list is WHICH QUERY FAILED, which is a fact
// about the request. So the exemption is (specific query key) × (network
// failure) — both halves required, neither sufficient.
//
// ★★★ AND IT IS NARROWER THAN THE DECORATION LIST ABOVE, DELIBERATELY. A
//     `plan_of_record_thumb` failure is downgraded to WARNING whatever caused
//     it. This one is silenced only for the cause nobody can act on; an
//     `Object not found` on the same query still reports at `error`, because
//     that one means a person's row points at a file that is not in the bucket
//     — a real defect wearing a transport costume (fix-592 §C's phrase).
export const NETWORK_QUIET_QUERY_KEYS: ReadonlySet<string> = new Set([
  // The signed URL for one avatar object. The circle falls back to initials, so
  // a failure costs the reader nothing — and a failure that never reached the
  // server costs them nothing to fix either.
  'avatar_url',
]);

/**
 * ★ Is this a network blip on a query whose blips nobody can action?
 *
 * ★★ THE NETWORK TEST IS INLINED rather than imported from `lib/saveFailure`.
 *    That module is imported by App's MutationCache and pulls in the
 *    save-failure store; `lib/errorLogger` is imported by almost everything,
 *    including modules that run before any store exists. Two small predicates
 *    beat a dependency edge in that direction — fix-415's lesson about a lib
 *    reaching sideways, applied before it could bite.
 */
export function isQuietNetworkQueryFailure(err: unknown, key: unknown): boolean {
  if (!NETWORK_QUIET_QUERY_KEYS.has(queryKeyRoot(key))) return false;
  return isBareNetworkFailure(err);
}

/**
 * A failure that never got a response at all.
 *
 * ★★★ A RESPONSE THAT ARRIVED IS NOT A NETWORK FAILURE, whatever it says. A
 *     Supabase storage error carries a `code` or a `status`; a `TypeError` from
 *     `fetch` carries neither. That is the whole discriminator, and it is what
 *     keeps "Object not found" reporting while "Failed to fetch" goes quiet.
 */
export function isBareNetworkFailure(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const o = err as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof o.code === 'string' && o.code !== '') return false;
    if (typeof o.status === 'number' && o.status > 0) return false;
    if (o.name === 'TypeError') return true;
  }
  if (err instanceof TypeError) return true;
  const text = messageOf(err).toLowerCase();
  return (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network request failed') ||
    text.includes('load failed')
  );
}

/** The first element of a query key, which is this codebase's cause tag. */
function queryKeyRoot(key: unknown): string {
  return Array.isArray(key) ? String(key[0] ?? '') : String(key ?? '');
}

/** ★ Is this a failure of something that only decorates the screen? */
export function isDecorationQuery(key: unknown): boolean {
  return DECORATION_QUERY_KEYS.has(queryKeyRoot(key));
}

/**
 * ★★★ fix-441 §C — THE LEVEL, or null for "do not log at all".
 *
 * One place that answers both questions a query failure raises, so a caller
 * cannot decide to log and then pick a severity on its own. `shouldLogQueryFailure`
 * below is kept and now delegates: it is still the honest answer to "does this
 * log?", and every existing caller and test keeps working unchanged.
 */
export function queryFailureLevel(
  err: unknown,
  key: unknown,
  observers: number,
): 'error' | 'warning' | null {
  if (shouldSkipBackendRpcLog(err, key)) return null;
  if (observers <= 0) return null;
  // ★★★ fix-613 §Z: a network blip on an avatar signature. Checked HERE, in
  //     the one place that answers "does this log and at what level", so the
  //     hook does not have to swallow its own errors to stay quiet — §Z.2's
  //     requirement, and the difference between classifying and hiding.
  if (isQuietNetworkQueryFailure(err, key)) return null;
  return isDecorationQuery(key) ? 'warning' : 'error';
}

/** The shared skip rules, applied to queries and mutations alike. */
export function shouldSkipBackendRpcLog(err: unknown, key: unknown): boolean {
  const k = Array.isArray(key) ? String(key[0] ?? '') : String(key ?? '');
  if (k.startsWith('auth/')) return true;
  if (isUserInputValidationError(err)) return true;
  // ★ fix-620 (P-315): the draw schedule refusing an overlap with finished work.
  if (isBlockOverlapRefusal(err)) return true;
  // ★ fix-619 §Z (P-312): a NAMED expected refusal — see EXPECTED_UNIQUE_REFUSALS.
  if (expectedUniqueRefusal(err) !== null) return true;
  if (isCancelledRequest(err)) return true;
  const m = messageOf(err).toLowerCase();
  return m.includes('bp_log_error');
}

export function isCancelledRequest(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (e && typeof e === 'object') {
    const name = (e as { name?: unknown }).name;
    // React Query names its cancellation `CancelledError`; a fetch aborted via
    // AbortController surfaces as `AbortError` even where DOMException is not
    // the concrete class (jsdom, node-fetch, polyfills).
    if (name === 'CancelledError' || name === 'AbortError') return true;
    if ((e as { silent?: unknown }).silent === true && name === 'CancelledError') {
      return true;
    }
  }
  return false;
}

// ===========================================================================
// ★★★ fix-511 §A (P-197) — A DEVELOPMENT SESSION IS NOT A PRODUCTION ERROR
// ===========================================================================
//
// ★★★ MEASURED ON PROD, 2026-09-09: of the **32** rows `error_reports` took in
//     seven days, **19 were frontend exceptions and every one of them carried a
//     stack at `http://localhost:5178/src/…`** with Vite's HMR cache-bust
//     parameter. **Zero came from the deployed app.** Three named identifiers
//     from a branch that had not merged, so they could not have been production
//     errors even in principle. Seventeen were dismissed by hand in one sitting.
//
// ★★★ SO THE FIX IS NOT A FILTER ON THE PANEL, IT IS NOT SENDING. A developer's
//     exception is already in the developer's own console, one keystroke away,
//     with a live source map. Shipping it to a shared production table costs a
//     row, costs somebody's attention, and buys nothing — and it drowns the
//     rows that are real, which is what actually happened here.
//
// ★★ THE GATE LIVES IN `logError` AND NOWHERE ELSE. Every browser-side caller
//    — the QueryCache and MutationCache handlers, the error boundary, the
//    global window handlers, the toast store, the auth path — funnels through
//    this one function. A rule applied at the call sites is a rule the next
//    call site forgets.
//
// ★★★ AND `MODE` DECIDES, WITH THE ORIGIN AS THE TIE-BREAK — in that order,
//     for a reason that is easy to get backwards:
//
//       · `development`  Vite's dev server. Suppress.
//       · `production`   a real build. Send — UNLESS it is being served from a
//                        local origin, which is `npm run preview`: a production
//                        BUILD in a development SESSION. That is the case the
//                        mode alone cannot see, and it is why the brief offers
//                        the origin as an alternative signal.
//       · `test`         vitest. Sends, and that is deliberate rather than an
//                        oversight: `supabase` is mocked in every suite, so
//                        nothing leaves the process, and a dozen existing
//                        suites assert the call shape. Gating on
//                        `import.meta.env.DEV` — which vitest sets TRUE —
//                        would have silenced all of them.

/** Where this page is running, as the reporter sees it. */
export interface ReportingEnvironment {
  /** `import.meta.env.MODE` — `development` / `production` / `test`. */
  mode: string;
  /** The page origin, or null outside a browser. */
  origin: string | null;
  /** Whether a report raised here should be sent at all. */
  isDevelopment: boolean;
}

/** ★ Hosts that mean "somebody's own machine". `.local` is Bonjour, which is
 *  how a dev server gets reached from a phone on the same network. */
function isLocalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.local)(:\d+)?$/i.test(
    origin,
  );
}

/**
 * ★★ Resolved on every call rather than once at module load, so a test can
 *    drive it and so a report raised before the page has an origin still gets
 *    an honest answer.
 */
export function reportingEnvironment(
  mode: string = import.meta.env.MODE,
  origin: string | null = typeof window !== 'undefined'
    ? (window.location?.origin ?? null)
    : null,
): ReportingEnvironment {
  const isDevelopment =
    mode === 'development' || (mode === 'production' && isLocalOrigin(origin));
  return { mode, origin, isDevelopment };
}

/** Internal re-entry guard. A failure in the log RPC itself must not
 *  cascade into another log call (default QueryClient onError would fire
 *  on the supabase.rpc rejection, which would call logError, which would
 *  fail again, …). We flip this for the duration of the call. */
let logging = false;

export function logError(input: LogErrorInput): Promise<void> {
  if (logging) return Promise.resolve();

  // ★★★ fix-511 §A — THE GATE. See the note above for the measurement.
  const env = reportingEnvironment();
  if (env.isDevelopment) {
    // ★ Say so in the console the developer is already looking at, so the
    //   suppression is never mistaken for the reporter being broken — which is
    //   the failure mode of a silent drop, and the reason fix-314 found zero
    //   auth rows and assumed a filter.
    console.warn(
      `[errorLogger] not sent (${env.mode}${env.origin ? ` · ${env.origin}` : ''}): ${input.message}`,
      input.context ?? {},
    );
    return Promise.resolve();
  }

  logging = true;

  const payload = {
    p_source: input.source,
    p_level: input.level,
    // Truncate ridiculously long messages so a giant stack trace can't
    // bloat the row. The full stack still lands in context.stack.
    p_message: clip(input.message, 2_000),
    // ★★ fix-511 §A: STAMP the environment on everything that IS sent. The
    //    brief asks for the stamp as well as the gate, and the two answer
    //    different questions — the gate stops dev noise arriving, the stamp
    //    lets a future reader tell where a row came from WITHOUT inferring it
    //    from a stack. Worth having because `backend_rpc` rows carry only a
    //    relative pathname, so the 19 rows above could not have been
    //    classified this way retroactively at all.
    p_context: {
      ...(input.context ?? {}),
      environment: env.mode,
      origin: env.origin ?? undefined,
      // ★★★ fix-587 §1b: WHICH BUILD THIS BROWSER IS RUNNING.
      //
      //     P-287 was two people on one screen seeing 332 and 65. The server
      //     returned identical rows to both and every filter stage was correct;
      //     what differed was that one of them was on a bundle three weeks old
      //     — established by COUNTING CONTROLS IN A SCREENSHOT, because no row
      //     in this table could say it.
      //
      // ★★ The same argument fix-511 makes for `environment` one line up: the
      //    stamp answers a question a stack trace cannot, and it cannot be
      //    recovered retroactively. Every row from here carries it, so "is that
      //    person stale?" becomes a SQL query instead of a ticket.
      build: buildStamp(),
    },
  };

  // Defensive: in vitest fixtures that mock `supabase` without providing
  // an `rpc` field, calling rpc would throw synchronously and bypass
  // .catch. Wrap the call so a missing rpc (test-only condition) and
  // an actual RPC error both flow through the same swallow path.
  let pending: Promise<unknown>;
  try {
    if (typeof supabase?.rpc !== 'function') {
      pending = Promise.resolve();
    } else {
      pending = Promise.resolve(supabase.rpc('bp_log_error', payload));
    }
  } catch (syncErr) {
    pending = Promise.reject(syncErr);
  }

  return pending
    .then(() => undefined)
    .catch((err: unknown) => {
      if (import.meta.env.DEV) {
        console.warn('[errorLogger] bp_log_error failed', err);
      }
    })
    .finally(() => {
      logging = false;
    });
}

function clip(s: string, max: number): string {
  if (typeof s !== 'string') return String(s);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/** Helper for callers that already have an Error/unknown. Keeps the
 *  message-extraction logic in one place. */
export function messageOf(e: unknown): string {
  if (e == null) return 'unknown error';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || e.toString();
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
