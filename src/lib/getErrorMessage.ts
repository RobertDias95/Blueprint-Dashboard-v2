// fix-50: normalize an unknown thrown value into a human-readable string for
// display. Supabase/PostgREST errors are PLAIN OBJECTS (not Error instances)
// — shaped like { message, details, hint, code } — so a naive `String(err)`
// renders the useless "[object Object]" into the UI (seen on /activity when
// the bp_fetch_scraper_activity RPC errors).
//
// Read the common message-bearing fields in priority order and GUARANTEE we
// never return "[object Object]". Use this anywhere a caught error is shown.
export function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err.trim() || 'Unknown error';
  // Error instances first — most specific, carries the cleanest message.
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // PostgrestError uses message/details/hint; OAuth-style errors use
    // error_description; some wrappers nest under `error`.
    for (const key of [
      'message',
      'error_description',
      'details',
      'hint',
      'error',
    ] as const) {
      const v = e[key];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
  }
  // Last resort: stringify, but never surface "[object Object]".
  const s = String(err);
  return s && s !== '[object Object]' ? s : 'Unknown error';
}
