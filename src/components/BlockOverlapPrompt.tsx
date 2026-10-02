import { useEffect } from 'react';
import { useBlockOverlapStore } from '../stores/blockOverlapStore';

// fix-620 (P-315): "if something were to overlap, an error or prompt needs to
// appear to fix it" — Bobby, 2026-10-02. The block stays where it was (the
// server refused the whole write), and this says why and what to do.
//
// ★ Escape is a WINDOW listener: a keydown handler on a div nobody focused
//   never fires (fix-440).

export default function BlockOverlapPrompt() {
  const message = useBlockOverlapStore((s) => s.message);
  const dismiss = useBlockOverlapStore((s) => s.dismiss);

  useEffect(() => {
    if (message === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, dismiss]);

  if (message === null) return null;
  return (
    <div
      className="fixed inset-0 z-[9500] bg-black/50 flex items-center justify-center p-6"
      data-testid="block-overlap-prompt-backdrop"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="block-overlap-title"
        aria-describedby="block-overlap-body"
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        data-testid="block-overlap-prompt"
      >
        <div className="space-y-1">
          <div id="block-overlap-title" className="text-sm font-display font-bold text-text">
            This block can&rsquo;t go there
          </div>
          <div
            id="block-overlap-body"
            className="text-[12px] text-muted"
            data-testid="block-overlap-prompt-message"
          >
            {message}
          </div>
          <div className="text-[11px] text-dim">Nothing was changed.</div>
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            autoFocus
            onClick={dismiss}
            className="text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold hover:opacity-90 transition"
            data-testid="block-overlap-prompt-ok"
          >
            Choose other weeks
          </button>
        </div>
      </div>
    </div>
  );
}
