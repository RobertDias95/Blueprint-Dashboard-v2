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

/** Internal re-entry guard. A failure in the log RPC itself must not
 *  cascade into another log call (default QueryClient onError would fire
 *  on the supabase.rpc rejection, which would call logError, which would
 *  fail again, …). We flip this for the duration of the call. */
let logging = false;

export function logError(input: LogErrorInput): Promise<void> {
  if (logging) return Promise.resolve();
  logging = true;

  const payload = {
    p_source: input.source,
    p_level: input.level,
    // Truncate ridiculously long messages so a giant stack trace can't
    // bloat the row. The full stack still lands in context.stack.
    p_message: clip(input.message, 2_000),
    p_context: input.context ?? {},
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
