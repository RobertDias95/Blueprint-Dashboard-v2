import { Link } from 'react-router-dom';
import type { Permit, Project, Stage } from '../lib/database.types';
import type { UrgencyLevel } from '../lib/urgencyHelpers';

interface PermitCardProps {
  permit: Permit;
  project: Project | undefined;
  stage: Stage;
  /** The date that drives the column-relevant strip (target submit, city target, etc.). */
  keyDate: string | null;
  keyDateLabel: string;
  /** Q9.5.c: urgency level for this permit at this stage. Drives the
   *  card's bg tint + 3px left-border. 'ok' renders neutral surface. */
  urgency?: UrgencyLevel;
}

const STAGE_BADGE_CLASS: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

// Q9.5.c: urgency styling per v1 (.addr-group.urg-* at index.html:179-181).
// Literal hex values: alert tones distinct from the stage palette.
const URGENCY_STYLES: Record<
  UrgencyLevel,
  { borderLeftColor: string; background: string }
> = {
  red: { borderLeftColor: '#dc2626', background: '#fee2e2' },
  yellow: { borderLeftColor: '#eab308', background: '#fef9c3' },
  ok: { borderLeftColor: 'transparent', background: 'var(--color-surface)' },
};

// Q2: One card per permit on the dashboard matrix. Read-only — clicking
// navigates to the project detail page.
// Q9.5.c: urgency-tinted left-border + bg per v1 §4.6.b predicate output.

export default function PermitCard({
  permit,
  project,
  stage,
  keyDate,
  keyDateLabel,
  urgency = 'ok',
}: PermitCardProps) {
  const address = project?.address ?? permit.struct_address ?? '—';
  const lead = permit.ent_lead || permit.permit_owner || '';
  const team = [permit.da, permit.dual_da, permit.dm].filter(Boolean).join(' · ');
  const urgencyStyle = URGENCY_STYLES[urgency];

  return (
    <Link
      to={`/project/${permit.project_id}`}
      className="block border border-y border-r border-border rounded-lg p-3 hover:border-de hover:shadow-sm transition"
      style={{
        background: urgencyStyle.background,
        borderLeft: `3px solid ${urgencyStyle.borderLeftColor}`,
      }}
      data-testid="permit-card"
      data-permit-id={permit.id}
      data-urgency={urgency}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-display font-bold text-text truncate">
            {address}
          </div>
          <div className="text-[10px] text-muted truncate font-mono">
            {project?.juris ?? '—'} · {permit.type ?? '—'}
            {permit.num ? ` · ${permit.num}` : ''}
          </div>
        </div>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold tracking-wide uppercase ${STAGE_BADGE_CLASS[stage]}`}
        >
          {STAGE_LABEL[stage]}
        </span>
      </div>

      {(team || lead) && (
        <div className="mt-2 text-[10px] text-muted truncate">
          {lead && <span className="text-arch font-semibold">{lead}</span>}
          {lead && team && ' · '}
          {team}
        </div>
      )}

      {keyDate && (
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <span className="text-dim uppercase tracking-wide">{keyDateLabel}</span>
          <span className="font-mono text-text">{keyDate}</span>
        </div>
      )}
    </Link>
  );
}
