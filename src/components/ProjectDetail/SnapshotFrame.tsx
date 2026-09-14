import { useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { displayAddress } from '../../lib/displayAddress';
import { RETIRED_PALETTE } from '../../lib/retiredState';
// ★★★ fix-568 — THE RULE LIVES IN `lib/`, THE COMPONENT RENDERS IT.
//
//     Split because `react-refresh/only-export-components` is an ERROR in this
//     repo, not a warning — and it is right: the measured opacity, the contrast
//     numbers, the interactive selector and the navigate-or-not predicate are
//     facts about the RULE, testable without mounting anything. The component
//     is the only export here.
import {
  SNAPSHOT_MUTE_OPACITY,
  snapshotClickNavigates,
} from '../../lib/snapshotFrame';

/**
 * The greyed, clickable frame around a superseded original's four cards.
 *
 * ★ Renders its children untouched when `successor` is null, so a normal
 *   project and a redesign are **pixel-unchanged** — asserted, because a
 *   regression here would be invisible on the 18 projects it is about.
 */
export default function SnapshotFrame({
  successor,
  children,
}: {
  /** The project that superseded this one, or null when nothing did. */
  successor: { id: string; address: string } | null;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!successor) return;
      const sel =
        typeof window !== 'undefined' && window.getSelection
          ? window.getSelection()?.toString() ?? ''
          : '';
      if (!snapshotClickNavigates(e.target as Element, sel)) return;
      navigate(`/project/${successor.id}`);
    },
    [navigate, successor],
  );

  if (!successor) return <>{children}</>;

  const p = RETIRED_PALETTE.redesigned;
  return (
    <div
      onClick={onClick}
      className="relative cursor-pointer"
      style={{
        opacity: SNAPSHOT_MUTE_OPACITY,
        // ★★★ The remap that keeps captions legible — see the arithmetic above.
        //     Without it `--color-muted` composites to 2.70:1 while the primary
        //     text passes, which is worse than failing visibly.
        ['--color-muted' as string]: 'var(--color-text)',
        ['--color-dim' as string]: 'var(--color-text)',
      }}
      data-testid="snapshot-frame"
    >
      {/* ★★★ §B — THE MARKER THAT REPLACES BOTH CHIPS. Bobby: *"redesign version
          from corner to corner, top left down to the bottom right."*
          ★★ IT IS NOT THE ONLY WAY TO TELL — the grey is the primary signal and
             this confirms it, which is why it is `pointer-events-none` and sits
             behind nothing: it explains the appearance rather than carrying the
             fact on its own. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-start justify-center pt-2 z-10"
        aria-hidden
      >
        <span
          className="text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full border"
          style={{
            background: 'var(--color-surface)',
            color: p.text,
            borderColor: p.border,
          }}
          data-testid="snapshot-marker"
        >
          Earlier version · current is {displayAddress(successor.address)}
        </span>
      </div>
      {children}
    </div>
  );
}
