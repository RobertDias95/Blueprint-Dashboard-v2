import OriginLink from '../OriginLink';
import type { AddressMatch, MatchVerdict } from '../../lib/addressMatch';

// fix-333 — the banner the Othello duplicate would have hit.
//
// ★★ IT WARNS. IT NEVER BLOCKS. Genuine neighbours are routine — production
// holds `5947` and `5951 32nd Ave SW`, `4222` and `4228 Latona Ave NE`, and a
// dozen more pairs of real, distinct lots. A check that fights people over those
// gets clicked through without reading, which is how the next duplicate gets
// created anyway. Everything here is informational; the wizard's Next and Create
// buttons are untouched.
//
// ★ THE LINK OPENS IN A NEW TAB. Somebody who realises "that's already here"
// needs to go and look at it, and their half-filled wizard has to survive that.
// `target="_blank"` rather than a router navigation for exactly that reason —
// navigating in place would throw away four steps of typing.

export interface DuplicateAddressWarningProps {
  verdict: MatchVerdict;
  matches: readonly AddressMatch[];
  /** ★ True when the address index could not see every project. The banner then
   *  refuses to imply the address is clear — see useProjectAddressIndex. */
  truncated?: boolean;
  /** Set once the person has said "yes, create it anyway". */
  acknowledged: boolean;
  onAcknowledge: () => void;
}

/** Palette per verdict. A duplicate is the loud one; a nearby address is a
 *  murmur; an expected redesign is neither — it is a confirmation. */
const TONE: Record<
  Exclude<MatchVerdict, 'clear'>,
  { bg: string; border: string; fg: string; label: string }
> = {
  duplicate: {
    bg: 'var(--color-co-bg)',
    border: 'var(--color-co-border)',
    fg: 'var(--color-co)',
    label: 'This address may already exist',
  },
  'expected-redesign': {
    bg: 'var(--color-de-bg)',
    border: 'var(--color-de-border)',
    fg: 'var(--color-de)',
    label: 'Redesign of an existing project',
  },
  nearby: {
    bg: 'var(--color-s2)',
    border: 'var(--color-border)',
    fg: 'var(--color-muted)',
    label: 'A similar address is already in the tool',
  },
};

export default function DuplicateAddressWarning({
  verdict,
  matches,
  truncated = false,
  acknowledged,
  onAcknowledge,
}: DuplicateAddressWarningProps) {
  // ★ A truncated index must never render as silence. If the check could not
  // see everything, that is worth a line even when it found nothing.
  if (verdict === 'clear' && !truncated) return null;

  if (verdict === 'clear') {
    return (
      <div
        className="text-[11.5px] rounded-md border px-3 py-2"
        style={{
          background: 'var(--color-s2)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
        data-testid="wizard-duplicate-truncated"
      >
        The duplicate check could not read every project, so this address has
        not been fully checked. Search Project View before creating it.
      </div>
    );
  }

  const tone = TONE[verdict];
  const sameLot = matches.filter((m) => m.kind === 'same-lot');
  const nearby = matches.filter((m) => m.kind === 'nearby');

  return (
    <div
      className="rounded-md border px-3 py-2.5 flex flex-col gap-2"
      style={{ background: tone.bg, borderColor: tone.border }}
      role="status"
      data-testid="wizard-duplicate-warning"
      data-verdict={verdict}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11.5px] font-bold"
          style={{ color: tone.fg }}
          data-testid="wizard-duplicate-headline"
        >
          {tone.label}
        </span>
        <span className="text-[10.5px] text-dim">
          {verdict === 'expected-redesign'
            ? 'This is expected — a redesign shares its parent’s address.'
            : verdict === 'duplicate'
              ? 'Check it is not the same lot spelled differently.'
              : 'Different lot, similar address — check before creating.'}
        </span>
      </div>

      {/* ★ Ranked: same lot first, because "the same lot spelled differently"
          and "a similar address nearby" are different claims and must not read
          as one list. */}
      {sameLot.length > 0 && (
        <MatchGroup
          title={
            verdict === 'expected-redesign'
              ? 'Its existing family'
              : 'Same lot, spelled differently'
          }
          matches={sameLot}
          testId="wizard-duplicate-same-lot"
        />
      )}
      {nearby.length > 0 && (
        <MatchGroup
          title="Similar address nearby"
          matches={nearby}
          testId="wizard-duplicate-nearby"
        />
      )}

      {truncated && (
        <div className="text-[10px] text-dim" data-testid="wizard-duplicate-truncated">
          …and the check could not read every project, so there may be more.
        </div>
      )}

      {/* ★ ONE deliberate confirmation, inline — not a second modal. The brief
          is explicit, and a modal on top of a modal is how somebody ends up
          dismissing both without reading either.

          ★ Shown only for a real duplicate. An expected redesign has nothing to
          acknowledge, and a nearby address is a hint, not a challenge. */}
      {verdict === 'duplicate' &&
        (acknowledged ? (
          <div
            className="text-[10.5px] font-semibold"
            style={{ color: tone.fg }}
            data-testid="wizard-duplicate-acknowledged"
          >
            ✓ Acknowledged — this is a different project. You can carry on.
          </div>
        ) : (
          <button
            type="button"
            onClick={onAcknowledge}
            className="self-start text-[10.5px] font-bold px-2.5 py-1 rounded border bg-surface hover:bg-s2 transition"
            style={{ borderColor: tone.border, color: tone.fg }}
            data-testid="wizard-duplicate-acknowledge"
          >
            This is a different project — carry on
          </button>
        ))}
    </div>
  );
}

function MatchGroup({
  title,
  matches,
  testId,
}: {
  title: string;
  matches: readonly AddressMatch[];
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-dim">
        {title}
      </div>
      {matches.map((m) => (
        <MatchRow key={m.project.id} match={m} />
      ))}
    </div>
  );
}

function MatchRow({ match }: { match: AddressMatch }) {
  const { project } = match;
  // ★ Enough to RECOGNISE it: the address as stored, the GO date, and the
  // permit numbers. The Othello copy carried three identical permit numbers —
  // 3043214-LU, 7100542-CN, 7100543-DM — which is unmissable once shown.
  const nums = project.permitNums ?? [];
  return (
    <div
      className="flex items-center gap-2 flex-wrap rounded border bg-surface px-2 py-1.5"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid={`wizard-duplicate-match-${project.id}`}
    >
      <span className="text-[11.5px] font-bold text-text">
        {project.address}
      </span>
      {project.archived && (
        <span
          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: 'var(--color-s2)', color: 'var(--color-dim)' }}
          data-testid={`wizard-duplicate-archived-${project.id}`}
        >
          Archived
        </span>
      )}
      <span className="text-[10.5px] text-dim">
        GO {project.go_date ?? '—'}
      </span>
      {nums.length > 0 && (
        <span
          className="text-[10px] font-mono text-muted"
          data-testid={`wizard-duplicate-permits-${project.id}`}
        >
          {nums.join(' · ')}
        </span>
      )}
      {/* ★ New tab, so the half-typed wizard survives the trip. */}
      <OriginLink
        to={`/project/${project.id}`}
        target="_blank"
        rel="noreferrer"
        className="ml-auto text-[10.5px] font-bold text-de hover:underline"
        data-testid={`wizard-duplicate-open-${project.id}`}
      >
        Open in a new tab →
      </OriginLink>
    </div>
  );
}
