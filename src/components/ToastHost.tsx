import { useToastStore, type ToastKind } from '../stores/toastStore';

// Q3 / fix-86: Toast renderer. Mounted once at app root (App.tsx). Reads from
// the Zustand store; visual style ported from v1's .bp-toast palette.
//
// fix-86: click anywhere on the toast dismisses it; hover pauses the
// auto-dismiss timer (resumes on mouse-leave); explicit × button gives the
// click-to-dismiss behavior a clear affordance.

const KIND_CLASS: Record<ToastKind, string> = {
  info: 'bg-de-bg/40 text-de border-de-border',
  success: 'bg-pm-bg/40 text-pm border-pm-border',
  warn: 'bg-co-bg/40 text-co border-co-border',
  error: 'bg-co-bg/60 text-co border-co-border',
};

const KIND_LABEL: Record<ToastKind, string> = {
  info: 'Info',
  success: 'Saved',
  warn: 'Warning',
  error: 'Error',
};

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);

  return (
    <div
      id="toast-host"
      className="fixed top-4 right-4 z-[99999] flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          onMouseEnter={() => pause(toast.id)}
          onMouseLeave={() => resume(toast.id)}
          className={`pointer-events-auto min-w-[240px] max-w-[380px] text-left text-[13px] font-medium leading-snug px-3.5 py-2.5 pr-8 rounded-lg border shadow-md transition hover:opacity-90 relative ${
            KIND_CLASS[toast.kind]
          }`}
          data-testid={`toast-${toast.kind}`}
        >
          <div className="text-[10px] uppercase tracking-wide font-display font-bold opacity-70">
            {KIND_LABEL[toast.kind]}
          </div>
          <div className="mt-0.5">{toast.message}</div>
          {/* fix-86: explicit × affordance so users know the whole toast is
              clickable. The click bubbles to the outer button → dismiss(id).
              Rendering as a <span> not a nested <button> because nesting
              interactive elements is invalid HTML. */}
          <span
            className="absolute top-1.5 right-2 text-[14px] leading-none opacity-50 hover:opacity-100"
            aria-hidden="true"
            data-testid={`toast-close-${toast.id}`}
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
