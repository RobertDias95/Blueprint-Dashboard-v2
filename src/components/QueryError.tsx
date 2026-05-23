import { getErrorMessage } from '../lib/getErrorMessage';

interface QueryErrorProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}

// Q2: Standard error block for failed queries. The title names the data
// that didn't load; the body shows the message; the retry button calls
// the consumer's refetch. Keeps every page's error UX consistent.
//
// fix-50: message extraction goes through getErrorMessage so Supabase/
// PostgREST plain-object errors ({ message, details, hint, ... }) show their
// real text instead of "[object Object]" (the old `String(error)` fallback,
// which only worked for Error instances).

export default function QueryError({
  title = 'Failed to load',
  error,
  onRetry,
}: QueryErrorProps) {
  const message = getErrorMessage(error);
  return (
    <div className="border border-co-border bg-co-bg/40 rounded-lg p-4 text-sm">
      <div className="font-display font-bold text-co mb-1">{title}</div>
      <div className="text-text/80 font-mono text-xs break-all">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 text-xs px-3 py-1 rounded-md border border-border bg-surface hover:bg-s2 text-text transition"
        >
          Retry
        </button>
      )}
    </div>
  );
}
