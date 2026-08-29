import { useEffect, useId, useRef, useState } from 'react';
import {
  TASK_STATUS_OPTIONS,
  isTaskCancelled,
  statusLabel,
  type TaskStatus,
  type TaskWriteStatus,
} from '../../lib/taskStatus';

// ===========================================================================
// ★★★ fix-434 §A (P-063) — the chip stops describing and starts doing
// ===========================================================================
//
// Bobby, 2026-08-26: *"being able to just mark something off as Resolved,
// Resolved, Resolved"* while working down a queue. The chip reading
// Not Started / In Progress was already on every row, in the right place, at
// the right size — it just was not a control. So it becomes one, in place: no
// dialog, no navigation, no panel to open and close, and the card underneath
// keeps its scroll position because nothing about the page moves.
//
// ★★★ IT OFFERS ALL THREE, WHICH IS WHY IT IS NOT JUST A SECOND CHECKBOX. The
// checkbox is forward-only and terminal at Resolved (fix-235, so a finished
// task cannot be un-finished by a stray click). The chip is the trio, so it is
// also the first way to move a task BACKWARD from the row itself — that used to
// require opening the detail pane, which is the "no dialog, no navigation" the
// brief rules out.
//
// ★★ CANCELLED IS NOT AN OPTION AND THE CHIP GOES INERT FOR IT. fix-262:
// 'Cancelled' is written only by bp_set_project_cancel's sweep and cleared only
// by bp_restore_project. A control that could write over it would strand
// prior_completion_status and break the restore, so a cancelled row renders the
// same chip as before — a label.
//
// ★★★ A3: KEYBOARD AND SCREEN READER, BECAUSE THIS IS A CONTROL SOMEBODY USES
// FIFTY TIMES IN A ROW. `aria-haspopup="listbox"` + `aria-expanded` on the
// trigger; a real `role="listbox"` with three `role="option"` children carrying
// `aria-selected`; the current option focused on open; Up/Down/Home/End move,
// Enter/Space choose, Escape closes and returns focus to the chip. Every
// keyboard event is stopped from reaching the card, whose root is itself a
// `role="button"` listening for Enter and Space — without that, choosing a
// status would also toggle the card's selection.

const OPTION_DOT: Record<TaskWriteStatus, string> = {
  Open: '○',
  'In Progress': '◐',
  Resolved: '●',
};

export interface TaskStatusChipProps {
  taskId: string;
  /** The status to DISPLAY — already through the optimistic overlay. */
  status: TaskStatus;
  /** Background token for the chip, so it keeps the row's existing vocabulary. */
  background: string;
  onSelect: (next: TaskWriteStatus) => void;
}

export default function TaskStatusChip({
  taskId,
  status,
  background,
  onSelect,
}: TaskStatusChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();
  const cancelled = isTaskCancelled(status);

  // ★ Close on a click anywhere else. Registered only while open, so the board
  //   carries no listener per row for the 99% of the time no chip is open.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // ★ Focus the CURRENT option when the list opens, so a keyboard user lands on
  //   where the task is rather than at the top of the list.
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      TASK_STATUS_OPTIONS.findIndex((o) => o.value === status),
    );
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    items?.[idx]?.focus();
  }, [open, status]);

  const label = status === 'Open' ? 'Not Started' : statusLabel(status);

  if (cancelled) {
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded font-bold"
        style={{ background, color: 'var(--color-text)' }}
        data-testid={`mytask-card-${taskId}-status`}
      >
        {label}
      </span>
    );
  }

  function choose(next: TaskWriteStatus) {
    setOpen(false);
    // ★ Focus goes back to the chip so the next Tab starts where it left off.
    //   On a board this is best-effort: a status change moves the row to a
    //   different sub-column, which remounts the card and takes the focus with
    //   it. Nothing here can prevent that, and the row moving is the feedback.
    triggerRef.current?.focus();
    // ★★ "Already on that status" is NOT filtered here. It cannot be: ten
    //    clicks in one React batch all see the same `status` prop, so this
    //    check would pass ten times. It lives in useSetTaskStatus, which reads
    //    the optimistic ref and therefore knows what the previous click in the
    //    same batch asked for.
    onSelect(next);
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (at + delta + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
      return;
    }
    // ★ Enter / Space are handled by the option BUTTONS themselves; stopping
    //   propagation here is what keeps them off the card root.
    e.stopPropagation();
  }

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      // ★ The card root is a role="button" with its own click and keydown
      //   handlers. Everything the chip does stays inside the chip.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      data-testid={`mytask-card-${taskId}-status-chip`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="text-[9px] px-1.5 py-0.5 rounded font-bold cursor-pointer"
        style={{ background, color: 'var(--color-text)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Status: ${label}. Change status`}
        title="Change status"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        data-testid={`mytask-card-${taskId}-status`}
        data-open={open ? 'true' : 'false'}
      >
        {label}
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Task status"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute left-0 top-full mt-1 z-20 rounded border py-0.5 min-w-[104px] shadow-lg"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
          data-testid={`mytask-card-${taskId}-status-menu`}
        >
          {TASK_STATUS_OPTIONS.map((opt) => {
            const selected = opt.value === status;
            return (
              <li key={opt.value} className="list-none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(opt.value)}
                  className="w-full text-left text-[10px] px-2 py-1 whitespace-nowrap hover:bg-s2"
                  style={{
                    color: 'var(--color-text)',
                    fontWeight: selected ? 700 : 400,
                  }}
                  data-testid={`mytask-card-${taskId}-status-option-${opt.value.replace(/\s+/g, '-')}`}
                >
                  <span aria-hidden="true" className="mr-1">
                    {OPTION_DOT[opt.value]}
                  </span>
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}
