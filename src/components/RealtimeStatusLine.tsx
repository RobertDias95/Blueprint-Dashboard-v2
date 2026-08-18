import {
  isRealtimeDegraded,
  realtimeStatusLabel,
  useRealtimeStore,
} from '../stores/realtimeStore';

// ★★ fix-336 §1 — "the socket dropping does not leave the bell silently frozen".
//
// One line, two places (the bell's footer and the notification centre's
// header), one source: the status `useRealtimeInvalidation` writes when the
// channel reports back. It is deliberately quiet when everything works — a dot
// and the word "Live" — and explicit when it does not, because the failure this
// ticket exists to remove is a feed that looks alive and is not.
//
// ★ IT DESCRIBES THE FALLBACK RATHER THAN JUST THE FAULT. "Offline" alone
// invites a refresh; "Offline — refreshing every 60s" says the screen will
// still catch up, which is true (see REALTIME_FALLBACK_MS).

export function RealtimeStatusLine({ testId }: { testId: string }) {
  const status = useRealtimeStore((s) => s.status);
  const degraded = isRealtimeDegraded(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[9.5px]"
      style={{ color: degraded ? 'var(--color-co)' : 'var(--color-dim)' }}
      data-testid={testId}
      data-degraded={degraded ? 'true' : 'false'}
      data-status={status}
      title={
        degraded
          ? 'The live connection is down. The screen still refreshes on a timer and when you come back to the tab.'
          : 'Connected — changes arrive as they happen'
      }
    >
      <span
        className="rounded-full flex-none"
        style={{
          width: 5,
          height: 5,
          background: degraded ? 'var(--color-co)' : 'var(--color-de)',
        }}
        aria-hidden
      />
      {realtimeStatusLabel(status)}
    </span>
  );
}
