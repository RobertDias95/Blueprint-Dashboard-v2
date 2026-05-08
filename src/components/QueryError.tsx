interface QueryErrorProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}

// Q2: Standard error block for failed queries. The title names the data
// that didn't load; the body shows the message; the retry button calls
// the consumer's refetch. Keeps every page's error UX consistent.

export default function QueryError({
  title = 'Failed to load',
  error,
  onRetry,
}: QueryErrorProps) {
  const message = error instanceof Error ? error.message : String(error);
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
