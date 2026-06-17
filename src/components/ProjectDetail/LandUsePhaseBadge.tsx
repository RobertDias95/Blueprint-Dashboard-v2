import type { PermitWithCycles } from '../../lib/database.types';
import {
  deriveLandUsePhase,
  isLandUseLimboPhase,
  type LandUsePhase,
} from '../../lib/landUsePhase';

// fix-169: land-use phase badge. Renders the derived middle-phase for a Seattle
// land-use permit (*-LU: ULS/LBA/short-plat) — the "why hasn't this issued?"
// answer for records stuck in Design Review / publication / final review.
// Renders nothing for non-LU permits. The milestone columns are NULL until the
// scraper populates them (fix-78), so until then the badge shows the
// cycle-derived phase (Intake / In Review / Corrections).

/** Phase → CSS-var color family (matches the stage palette used elsewhere). */
const PHASE_COLOR: Record<LandUsePhase, 'pm' | 'co' | 'is'> = {
  intake: 'pm',
  in_review: 'pm',
  corrections: 'co',
  design_review: 'pm',
  in_publication: 'pm',
  decision_published: 'pm',
  final_review: 'pm',
  recorded: 'is',
};

export function LandUsePhaseBadge({
  permit,
  today,
}: {
  permit: PermitWithCycles;
  /** Test override; defaults to today. */
  today?: Date;
}) {
  const result = deriveLandUsePhase({
    permit,
    cycles: permit.permit_cycles ?? [],
    today,
  });
  if (!result) return null;
  // fix-178: surface the badge ONLY in the limbo phases the cycle/stage tracker
  // doesn't already cover (Design Review / Decision Published / In Publication).
  // In Review + Corrections are shown by the cycle layer; Final Review + Recorded
  // are terminal — badging them is duplicate noise.
  if (!isLandUseLimboPhase(result.phase)) return null;

  const c = PHASE_COLOR[result.phase];
  const text =
    result.phase === 'in_publication' && result.until
      ? `${result.label} until ${result.until}`
      : result.label;
  const title = result.date
    ? `Land-use phase: ${result.label} (${result.date})`
    : `Land-use phase: ${result.label}`;

  return (
    <span
      className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap"
      style={{
        background: `var(--color-${c}-bg)`,
        color: `var(--color-${c})`,
        borderColor: `var(--color-${c}-border)`,
      }}
      title={title}
      data-testid={`landuse-phase-badge-${permit.id}`}
      data-phase={result.phase}
    >
      ⚖ {text}
    </span>
  );
}
