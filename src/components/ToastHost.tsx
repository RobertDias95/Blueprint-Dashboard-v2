import { useToastStore, type ToastKind } from '../stores/toastStore';

// Q3: Toast renderer. Mounted once at app root (App.tsx). Reads from the
// Zustand store; visual style ported from v1's .bp-toast palette
// (index.html line 9963-9974).

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
          className={`pointer-events-auto min-w-[240px] max-w-[380px] text-left text-[13px] font-medium leading-snug px-3.5 py-2.5 rounded-lg border shadow-md transition hover:opacity-90 ${
            KIND_CLASS[toast.kind]
          }`}
          data-testid={`toast-${toast.kind}`}
        >
          <div className="text-[10px] uppercase tracking-wide font-display font-bold opacity-70">
            {KIND_LABEL[toast.kind]}
          </div>
          <div className="mt-0.5">{toast.message}</div>
        </button>
      ))}
    </div>
  );
}
