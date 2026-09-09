import { supabase } from './supabase';

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
  return isDecorationQuery(key) ? 'warning' : 'error';
}

/** The shared skip rules, applied to queries and mutations alike. */
export function shouldSkipBackendRpcLog(err: unknown, key: unknown): boolean {
  const k = Array.isArray(key) ? String(key[0] ?? '') : String(key ?? '');
  if (k.startsWith('auth/')) return true;
  if (isUserInputValidationError(err)) return true;
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
