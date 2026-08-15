import { useCallback, useRef, useState } from 'react';
import MyBoard from './MyBoard';
import MyTasks from './MyTasks';
import { useAuthStore } from '../stores/authStore';
import {
  DEFAULT_SPLIT_PCT,
  MAX_SPLIT_PCT,
  MIN_SPLIT_PCT,
  clampSplit,
  loadBoardSplit,
  saveBoardSplit,
} from '../lib/boardSplitPrefs';

// fix-318 (register #62) — My Board and My Tasks, one screen.
//
// ★ THIS FIXES A REGRESSION I SHIPPED. Bobby asked for the two to be merged:
//
//   "We want the My Task and My Board to be integrated into one view. So maybe
//    like the top half is vertically fixed for My Board, and then the bottom
//    half is fixed vertically and horizontally for My Task."
//
// fix-313's brief said "redirect /my-tasks -> /board" and never specified the
// merge, so the removal shipped without the replacement and the grouped task
// list — subtasks under parents (fix-294), the buckets, the filters — simply
// vanished. "I don't see my tasks anywhere."
//
// My Board scatters individual tasks through the dated forecast and can open
// TaskDetailEditor, but that is NOT the same screen: it answers "what is due
// when", not "what do I have".
//
// ★ NOTHING WAS REBUILT. MyTasks.tsx was intact the whole time — fix-313 left
// it deliberately. This mounts it.
//
// ─── the layout contract (fix-313, still governing) ────────────────────────
// The PAGE never scrolls; the panels do. Two stacked regions, each owning its
// own overflow:
//   top    — My Board, scrolls VERTICALLY
//   bottom — My Tasks, scrolls BOTH AXES ("fixed vertically and horizontally"),
//            which is what lets the task columns keep their width without
//            stretching the page sideways.
//
// ─── why the divider ──────────────────────────────────────────────────────
// ★ Measured, not eyeballed — see boardSplitPrefs.ts for the numbers. At
// 1440x900 both halves DO fit in the 796px available, but only just, and an
// even split starves My Tasks while leaving My Board slack. So the default is
// asymmetric and the divider is draggable and remembered per user, which is
// the option the brief offered for exactly this case.

export default function PersonalBoard() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // Read in the lazy initialiser and write in the handler — no effects. Same
  // reasoning as fix-313's Ribbon: an effect that setStates on mount is the
  // React Compiler's set-state-in-effect, and it renders one frame at the
  // wrong size before correcting itself.
  const [splitPct, setSplitPct] = useState(
    () => loadBoardSplit(userId) ?? DEFAULT_SPLIT_PCT,
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const commit = useCallback(
    (pct: number) => {
      const next = clampSplit(pct);
      setSplitPct(next);
      saveBoardSplit(userId, next);
    },
    [userId],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const shell = shellRef.current;
      if (!shell) return;
      setDragging(true);
      const rect = shell.getBoundingClientRect();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        if (rect.height <= 0) return;
        commit(((ev.clientY - rect.top) / rect.height) * 100);
      };
      const up = () => {
        setDragging(false);
        target.releasePointerCapture?.(e.pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    },
    [commit],
  );

  // Keyboard: the divider is a real separator, so it moves with the arrows.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        commit(splitPct - 2);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        commit(splitPct + 2);
      }
    },
    [commit, splitPct],
  );

  return (
    <div
      ref={shellRef}
      className="h-full flex flex-col"
      style={{ overflow: 'hidden' }}
      data-testid="personal-board"
    >
      {/* ── TOP: My Board. Scrolls vertically, never horizontally. ── */}
      <section
        data-testid="personal-board-top"
        aria-label="My Board"
        className="min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ flex: `0 0 ${splitPct}%` }}
      >
        <MyBoard />
      </section>

      {/* ── the divider ── */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize My Board and My Tasks"
        aria-valuenow={splitPct}
        aria-valuemin={MIN_SPLIT_PCT}
        aria-valuemax={MAX_SPLIT_PCT}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        data-testid="personal-board-divider"
        className="flex-none flex items-center justify-center cursor-row-resize select-none"
        style={{
          height: 9,
          background: dragging ? 'var(--color-s2)' : 'transparent',
        }}
        title="Drag to resize — remembered for next time"
      >
        <div
          style={{
            height: 3,
            width: 46,
            borderRadius: 2,
            background: 'var(--color-border)',
          }}
        />
      </div>

      {/* ── BOTTOM: My Tasks. ★ Scrolls BOTH axes — Bobby's "fixed vertically
           and horizontally". The task columns keep their width in here rather
           than widening the page. ──

           ★ fix-325 #5: this mounts the FULL MyTasks shell, not just MineTasks.
           The shell's one extra is the Mine / Waiting On switcher, and fix-318
           deliberately left it out because fix-315 had just given Waiting On its
           own route and ribbon entry — mounting it then would have been a second
           home for one screen. Bobby has since asked for exactly that fold, and
           the ribbon entry is gone, so the switcher is now the ONLY way in and
           the duplication argument no longer applies. ── */}
      <section
        data-testid="personal-board-bottom"
        aria-label="My Tasks"
        className="flex-1 min-h-0 overflow-auto border-t border-border"
      >
        <MyTasks />
      </section>
    </div>
  );
}
