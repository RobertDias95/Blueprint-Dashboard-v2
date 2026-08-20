import { useQueryClient } from '@tanstack/react-query';
import { useSaveFailureStore } from '../stores/saveFailureStore';
import {
  RETRY_DESCRIPTION,
  RETRY_LABEL,
  failureDetail,
  failureHeadline,
} from '../lib/saveFailure';

// ===========================================================================
// ★★★ fix-372 §6 — what a person sees when a save dies on the wire
// ===========================================================================
//
// Before this, nothing. `TypeError: Failed to fetch` went to Error Reports and
// the screen carried on showing the edit as though it had been saved.
//
// ★★★ IT IS UNMISSABLE AND IT DOES NOT FADE. Top of the viewport, full width,
// the error palette, and it stays until somebody dismisses it — see
// stores/saveFailureStore for why a toast was the wrong shape.

export default function SaveFailureBanner() {
  const failure = useSaveFailureStore((s) => s.failure);
  const dismiss = useSaveFailureStore((s) => s.dismiss);
  const queryClient = useQueryClient();

  if (!failure) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 bg-er-bg border-b border-er-border text-[11px] text-text"
      role="alert"
      data-testid="save-failure-banner"
    >
      <span className="font-extrabold text-er" data-testid="save-failure-headline">
        {failureHeadline(failure)}
      </span>
      <span className="text-muted" data-testid="save-failure-detail">
        {failureDetail(failure)}
      </span>

      {/* ★★★ NOT A RESEND. A retry of a request that may already have succeeded
          can write the change twice, and most mutations here are not
          idempotent. This re-reads instead, and the title says so — the person
          looks at what the server holds and redoes it only if it is missing. */}
      <button
        type="button"
        title={RETRY_DESCRIPTION}
        onClick={() => {
          void queryClient.refetchQueries({ type: 'active' });
          dismiss();
        }}
        className="ml-auto font-bold px-2.5 py-1 rounded-md border border-er text-er bg-surface hover:bg-er-bg transition"
        data-testid="save-failure-recheck"
      >
        {RETRY_LABEL}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="font-bold px-2 py-1 rounded-md border border-border text-muted bg-surface hover:bg-s2 transition"
        data-testid="save-failure-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
