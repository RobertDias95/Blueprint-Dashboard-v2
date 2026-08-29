import { useEffect, useId, useRef, useState } from 'react';

// ===========================================================================
// ★★★ fix-440 §A (P-061) — "Hold this permit" IS THE DROPDOWN OF REASONS
// ===========================================================================
//
// Bobby, 2026-08-26: *"'Reason…' sits far left and 'Hold this permit' far
// right — two boxes, one action."* The bar was `flex-wrap items-center`, so on
// a normal-width permit panel the reason `<select>` and the button it gates sat
// at opposite ends of the row with a date and a note between them. Two controls
// for one decision, and the one you press first is the one furthest from the
// one that does anything.
//
// ★★★ SO THE BUTTON BECOMES THE CHOOSER — AND THEN STOPS. Picking a reason does
// NOT place a hold. It opens a small popover under the button holding the start
// date and the optional note behind an explicit "Apply hold", because a hold is
// a status change on a real permit and a mis-click on a menu item must not
// make one. That is the whole reason this is two steps rather than one: the
// brief asks for one CONTROL, not one CLICK.
//
// ★★ ESCAPE CLOSES THE POPOVER, AND THAT IS ALLOWED HERE. fix-411 §1's rule —
// an overlay holding unsaved input does not close on Escape — is about dialogs
// somebody has been typing into for a while. This popover was opened a second
// ago, holds a date that defaults to today and one optional note, and its
// Escape returns you to the button you just pressed. Losing that is not the
// four-steps-of-a-wizard loss the rule exists to prevent. Said out loud so the
// next person does not "fix the inconsistency" in either direction.

export interface HoldReasonMenuProps {
  /** The words on the closed button: "Hold this permit". */
  label: string;
  reasons: readonly string[];
  /** Date the popover starts on — the caller owns it so the panel keeps its
   *  existing state and its existing reset-on-success. */
  start: string;
  onStartChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  /** Fired only by "Apply hold", never by picking a reason. */
  onApply: (reason: string) => void;
  pending: boolean;
  /** `permit-hold-set-<id>` / `hold-set-btn` — kept on the CONFIRM so the
   *  existing ids point at the thing that still does the thing. */
  confirmTestId: string;
  /** `permit-hold-reason-<id>` — on the chooser. */
  chooserTestId: string;
  /** Prefix for the popover's own ids. */
  testIdPrefix: string;
}

export default function HoldReasonMenu({
  label,
  reasons,
  start,
  onStartChange,
  note,
  onNoteChange,
  onApply,
  pending,
  confirmTestId,
  chooserTestId,
  testIdPrefix,
}: HoldReasonMenuProps) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  // ★ One listener, only while something is open, so a page of permit panels
  //   carries none of them at rest.
  useEffect(() => {
    if (!open && !chosen) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setChosen(null);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open, chosen]);

  // ★ Land on the first reason when the menu opens, so a keyboard user is
  //   already inside the list rather than at the top of the page.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]')[0]
      ?.focus();
  }, [open]);

  function closeAll() {
    setOpen(false);
    setChosen(null);
    triggerRef.current?.focus();
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + delta + items.length) % items.length]?.focus();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }

  return (
    <div className="relative inline-flex" ref={rootRef} data-testid={`${testIdPrefix}-root`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setChosen(null);
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setChosen(null);
            setOpen(true);
          }
        }}
        disabled={pending || reasons.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="text-[11px] font-bold text-white bg-de rounded px-2 py-0.5 border-none disabled:opacity-40"
        // ★★ THE CHOOSER KEEPS `permit-hold-reason-*`. It IS the reason
        //    control now, so the id that named the old <select> names the
        //    thing that replaced it — existing tests re-point rather than
        //    rewrite, which is what the brief asked for.
        data-testid={chooserTestId}
        data-open={open ? 'true' : 'false'}
      >
        {label} ▾
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute left-0 top-full mt-1 z-30 rounded border py-0.5 min-w-[180px] shadow-lg"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
          data-testid={`${testIdPrefix}-menu`}
        >
          {reasons.map((r) => (
            <li key={r} className="list-none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // ★★★ CHOOSING IS NOT HOLDING. This opens the confirm step
                  //     and writes nothing.
                  setChosen(r);
                  setOpen(false);
                }}
                className="w-full text-left text-[11px] px-2 py-1 whitespace-nowrap hover:bg-s2 text-text"
                data-testid={`${testIdPrefix}-option-${r.replace(/\s+/g, '-')}`}
              >
                {r}
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <div
          className="absolute left-0 top-full mt-1 z-30 rounded border p-2 shadow-lg flex flex-col gap-1.5 min-w-[240px]"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
          role="dialog"
          aria-label={`${label} — ${chosen}`}
          onKeyDown={(e) => {
            // ★ See the header note: Escape is allowed to close THIS, because
            //   it was opened a second ago and holds a defaulted date.
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeAll();
            }
          }}
          data-testid={`${testIdPrefix}-confirm`}
        >
          <div className="text-[11px] font-bold text-text" data-testid={`${testIdPrefix}-chosen`}>
            {chosen}
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-dim">
            From
            <input
              type="date"
              value={start}
              onChange={(e) => onStartChange(e.target.value)}
              className="px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none"
              data-testid={`${testIdPrefix}-start`}
              aria-label="Hold start"
            />
          </label>
          <input
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Note (optional)"
            className="px-1.5 py-0.5 text-[11px] border border-border rounded bg-bg text-text outline-none"
            data-testid={`${testIdPrefix}-note`}
            aria-label="Hold note"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onApply(chosen)}
              disabled={pending}
              className="text-[11px] font-bold text-white bg-de rounded px-2 py-0.5 border-none disabled:opacity-40"
              // ★★ AND THE CONFIRM KEEPS `permit-hold-set-*`, because it is
              //    still the only control that places a hold.
              data-testid={confirmTestId}
            >
              Apply hold
            </button>
            <button
              type="button"
              onClick={closeAll}
              className="text-[11px] text-dim hover:text-text bg-transparent border-none p-0"
              data-testid={`${testIdPrefix}-cancel`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
