import type { ForecastItem } from '../../lib/myBoard';
import { HoldBadge } from '../shared/HoldBadge';

// ===========================================================================
// ★★★ fix-446 §A1 — A MILESTONE, AS A MY TASKS ROW
// ===========================================================================
//
// ★★ IT IS THE SAME CARD SHAPE AS A TASK, NOT A NEW LANGUAGE. Same border,
// same padding, same badge row along the bottom, same click-to-open. What
// differs is what it says and what ticking it does — and the MILESTONE tag
// says which kind of row you are looking at, in the tag slot fix-444 opened
// and fix-445's CO-ASSIGNED mark already shares.
//
// ★★★ THREE STATES, AND ONLY ONE HAS A CHECKBOX (myBoard's `relayStateFor`):
//   'mine'    → actionable: a checkbox, and ticking it does exactly what the
//               Board's tick does for this item ('ack' or 'handoff').
//   'waiting' → actionable === false: rendered greyed with NO CHECKBOX. You
//               see where it sits without being asked to do anything. This is
//               fix-298's rule and it is why the row is worth showing at all.
//   'absent'  → never reaches here.
//
// ★ NO STATUS CHIP AND NO THREE-WAY. Bobby's ruling 1: *"a milestone sits in
// NOT STARTED until acknowledged, then disappears from My Tasks. It is never
// 'In Progress' and never 'Resolved' here."* A status control would be
// offering two states that do not exist.

export default function MilestoneCard({
  item,
  coAssigned,
  onOpen,
  onTick,
  busy,
}: {
  item: ForecastItem;
  /** True when this row reaches the viewer only through the DM derivation. */
  coAssigned: boolean;
  onOpen: (item: ForecastItem) => void;
  onTick: (item: ForecastItem) => void;
  busy: boolean;
}) {
  const overdue = item.daysLate > 0;
  return (
    <div
      className="rounded border px-2 py-1.5 cursor-pointer"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-panel)',
        // ★ The 'waiting' state, said in the one way a glance can read.
        opacity: item.actionable ? 1 : 0.6,
      }}
      onClick={() => onOpen(item)}
      data-testid={`mytask-milestone-${item.key}`}
      data-actionable={item.actionable ? 'true' : 'false'}
    >
      <div className="flex items-start gap-2">
        {item.actionable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTick(item);
            }}
            disabled={busy}
            aria-label={`Complete: ${item.verb}`}
            className="mt-0.5 shrink-0 w-3.5 h-3.5 rounded-sm border"
            style={{
              borderColor: 'var(--color-muted)',
              background: 'transparent',
            }}
            data-testid={`mytask-milestone-${item.key}-tick`}
          />
        ) : (
          // ★ A fixed-width spacer, so a waiting row lines up with the
          //   actionable ones instead of sliding left and reading as a
          //   different kind of thing.
          <span aria-hidden className="mt-0.5 shrink-0 w-3.5 h-3.5" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className="text-[12px] leading-snug"
            style={{ color: 'var(--color-text)' }}
            data-testid={`mytask-milestone-${item.key}-text`}
          >
            {item.verb}
          </div>
          <div
            className="text-[10px] truncate"
            style={{ color: 'var(--color-muted)' }}
            data-testid={`mytask-milestone-${item.key}-where`}
          >
            {item.where}
          </div>
        </div>
        <span
          className="text-[10px] font-mono shrink-0"
          style={{
            color: overdue ? 'var(--color-danger)' : 'var(--color-muted)',
          }}
          data-testid={`mytask-milestone-${item.key}-due`}
        >
          {item.date}
        </span>
      </div>
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {/* ★★★ THE TAG, in fix-444's slot. One tag system: this sits beside
            BOT, auto-closed, hold, permit-type and CO-ASSIGNED rather than
            starting a second place a row can be annotated. */}
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
          style={{
            background: 'var(--color-s2)',
            color: 'var(--color-muted)',
          }}
          data-testid={`mytask-milestone-${item.key}-tag`}
        >
          MILESTONE
        </span>
        {/* ★★ fix-445's mark, on a milestone reached through the DM
            derivation — the same word for the same relationship, so a DM's one
            switch governs their DA's tasks and their DA's milestones alike. */}
        {coAssigned && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-bold"
            style={{
              background: 'var(--color-de-bg, var(--color-s2))',
              color: 'var(--color-de)',
            }}
            title="This milestone reaches you as the design manager for its DA."
            data-testid={`mytask-milestone-${item.key}-coassigned`}
          >
            CO-ASSIGNED
          </span>
        )}
        {/* ★ fix-409: only ever present when the viewer switched held work on. */}
        <HoldBadge
          hold={item.hold}
          compact
          testid={`mytask-milestone-${item.key}-hold`}
        />
        {item.permitLabel && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
            style={{
              background: 'var(--color-s2)',
              color: 'var(--color-text)',
            }}
            data-testid={`mytask-milestone-${item.key}-permit`}
          >
            {item.permitLabel}
          </span>
        )}
        {/* ★ fix-348: who holds it while it is not yours. Only ever set on a
            'waiting' row, which is exactly when "with" means something. */}
        {item.withWhom && (
          <span
            className="text-[9px]"
            style={{ color: 'var(--color-muted)' }}
            data-testid={`mytask-milestone-${item.key}-with`}
          >
            with {item.withWhom}
          </span>
        )}
      </div>
    </div>
  );
}
