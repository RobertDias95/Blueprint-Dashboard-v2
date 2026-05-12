import { useState } from 'react';
import type { Permit, PermitWithCycles, Project } from '../../lib/database.types';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';

// Q9.5.e: 4-column header top strip per v1 §4.2.1. Left card holds an
// inner 3-column grid (DD Phase 0.75fr / Project 1.5fr / Team 1.75fr)
// inside a single bordered container with var(--color-s2) background.
// Right panel is a 240px fixed-width Builder/Owner card.
//
// v2 doesn't have a `builders` hook yet (table exists but isn't surfaced).
// Builder/Owner column ships as a read-only empty state for now; backlog
// item #67 covers the builders hook + edit flow. Bobby's spec accepts
// this honesty in §4.2.1.

interface Props {
  project: Project;
  permits: PermitWithCycles[];
  /** When set, edits operate against this permit (the Building Permit
   *  by default). Mirrors v1's pattern of using the BP as the
   *  project-level anchor. */
  bp: PermitWithCycles | null;
}

export default function ProjectDetailHeader({ project, permits, bp }: Props) {
  return (
    <div
      className="flex border-b border-border"
      data-testid="project-detail-header"
    >
      <div
        className="flex-1 px-4 pt-3.5 pb-3"
        style={{ background: 'var(--color-s2)' }}
      >
        <div
          className="grid border rounded-lg overflow-hidden bg-surface"
          style={{
            gridTemplateColumns: '0.75fr 1.5fr 1.75fr',
            borderColor: 'var(--color-border)',
          }}
        >
          <DDPhaseCell bp={bp} />
          <ProjectCell project={project} permits={permits} />
          <TeamCell bp={bp} permits={permits} />
        </div>
      </div>
      <BuilderOwnerCell />
    </div>
  );
}

// ============================================================
// DD Phase cell — GO date (read-only) + DD Start/End (editable) + Duration
// ============================================================

function DDPhaseCell({ bp }: { bp: PermitWithCycles | null }) {
  if (!bp) {
    return (
      <CellShell title="DD Phase" rightBorder>
        <div className="text-[11px] text-dim">No building permit</div>
      </CellShell>
    );
  }
  return <DDPhaseEditor bp={bp} />;
}

function DDPhaseEditor({ bp }: { bp: PermitWithCycles }) {
  // Local-controlled inputs to avoid one-save-per-keystroke. Fires
  // update on blur if the value changed.
  const updateMutation = useUpdatePermit();
  const occMissing = !bp.updated_at;
  const [startDraft, setStartDraft] = useState(bp.dd_start ?? '');
  const [endDraft, setEndDraft] = useState(bp.dd_end ?? '');
  const dur = computeDuration(startDraft || null, endDraft || null);
  // Q9.5.e-fix-1: GO date renders as "Nov 14, 2025" per v1
  // (index.html:3850). ISO format was Bobby's first smoke delta.
  const goDisplay = formatGoDate(bp.go_date);

  async function commitField<K extends keyof Permit>(
    field: K,
    next: string,
    original: string | null,
    label: string,
  ) {
    if (!bp.updated_at) return;
    const normalized = next || null;
    if (normalized === original) return;
    await updateMutation.mutateAsync({
      permitId: bp.id,
      projectId: bp.project_id,
      expectedUpdatedAt: bp.updated_at,
      patch: { [field]: normalized } as Partial<Permit>,
      fieldLabel: label,
    });
  }

  return (
    <CellShell title="DD Phase" rightBorder>
      <div className="flex flex-col gap-1.5">
        <PhaseRow
          label="GO Date"
          value={goDisplay}
          dashed
          title="GO date is set on the Project Settings page or the date strip below the permit"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-dim w-12 flex-shrink-0">Start</span>
          <input
            type="date"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={() => commitField('dd_start', startDraft, bp.dd_start, 'DD Start')}
            disabled={occMissing}
            className="text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid="pd-bp-dd_start"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-dim w-12 flex-shrink-0">End</span>
          <input
            type="date"
            value={endDraft}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={() => commitField('dd_end', endDraft, bp.dd_end, 'DD End')}
            disabled={occMissing}
            className="text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid="pd-bp-dd_end"
          />
        </div>
        {dur && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-dim w-12 flex-shrink-0">
              Duration
            </span>
            <span className="text-[11px] font-bold text-text">{dur}</span>
          </div>
        )}
      </div>
    </CellShell>
  );
}

// ============================================================
// Project cell — nested Proposal + Site sub-cards
// ============================================================

function ProjectCell({
  project,
  permits,
}: {
  project: Project;
  permits: PermitWithCycles[];
}) {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0];
  const productType = bp?.product_type ?? '';
  const tags = Array.isArray(bp?.project_tags)
    ? (bp.project_tags as unknown[]).filter(
        (t): t is string => typeof t === 'string',
      )
    : [];

  return (
    <CellShell title="Project" rightBorder>
      <div
        className="grid border rounded-md overflow-hidden"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderColor: 'var(--color-border)',
        }}
      >
        {/* Proposal */}
        <div
          className="p-2 border-r"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            Proposal
          </div>
          <div className="flex flex-col gap-1">
            {bp?.units != null && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[9px] text-dim min-w-[36px]">Units</span>
                <span className="text-sm font-extrabold text-text">
                  {bp.units}
                </span>
              </div>
            )}
            {productType && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[9px] text-dim min-w-[36px]">Type</span>
                <span className="text-[10px] font-bold text-text">
                  {productType}
                </span>
              </div>
            )}
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-[9px] text-dim min-w-[36px]">Tags</span>
              <div className="flex flex-wrap gap-0.5">
                {tags.length === 0 ? (
                  <span className="text-[9px] text-dim italic">none</span>
                ) : (
                  tags.map((t) => (
                    <span
                      key={t}
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded border"
                      style={{
                        background: 'var(--color-de-bg)',
                        color: 'var(--color-de)',
                        borderColor: 'var(--color-de-border)',
                      }}
                    >
                      {t}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Site */}
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            Site
          </div>
          <div className="flex flex-col gap-1">
            <SiteRow label="Zone" value={project.juris ? '—' : '—'} />
            <SiteRow
              label="Lot"
              value={
                bp?.lot_width || bp?.lot_depth
                  ? `${bp?.lot_width ?? '—'} × ${bp?.lot_depth ?? '—'} ft`
                  : '—'
              }
            />
            <SiteRow label="Alley" value={bp?.alley ?? '—'} />
            <SiteRow label="Parking" value={bp?.parking_type ?? '—'} />
            <SiteRow label="Stalls" value={bp?.parking_stalls?.toString() ?? '—'} />
          </div>
        </div>
      </div>
    </CellShell>
  );
}

// ============================================================
// Team cell — nested Internal + External sub-cards
// ============================================================

function TeamCell({
  bp,
  permits,
}: {
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  const ent = bp?.ent_lead;
  const da = bp?.da ?? bp?.architect;
  const dm = bp?.dm;
  // Project-level ACQ: scan all permits — v2 doesn't have an acq_lead
  // column yet (task #63 backlog); show '—' for now.
  void permits;

  return (
    <CellShell title="Team">
      <div
        className="grid border rounded-md overflow-hidden"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderColor: 'var(--color-border)',
        }}
      >
        <div
          className="p-2 border-r"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1">
            Internal
          </div>
          <div className="flex flex-col gap-1">
            <TeamRow label="ENT" value={ent} />
            <TeamRow label="DA" value={da} />
            <TeamRow label="DM" value={dm} />
            <TeamRow label="ACQ" value="—" />
          </div>
        </div>
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            External
          </div>
          <div className="text-[10px] text-dim italic">
            Consultant assignments — backlog #67
          </div>
        </div>
      </div>
    </CellShell>
  );
}

// ============================================================
// Builder / Owner cell (read-only stub — see backlog)
// ============================================================

function BuilderOwnerCell() {
  return (
    <div
      className="flex-shrink-0 px-4 py-3.5 border-l flex flex-col"
      style={{
        width: 240,
        borderLeftColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid="pd-builder-cell"
    >
      <div className="text-[10px] font-extrabold text-text uppercase tracking-wider mb-2.5">
        Builder / Owner
      </div>
      <div className="text-[12px] text-dim italic">
        No builder / owner on file. Backlog #67 wires the builders hook.
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function CellShell({
  title,
  rightBorder,
  children,
}: {
  title: string;
  rightBorder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-2.5 ${rightBorder ? 'border-r' : ''}`}
      style={rightBorder ? { borderColor: 'var(--color-border)' } : undefined}
    >
      <div className="text-[10px] font-extrabold text-text uppercase tracking-wider text-center mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function PhaseRow({
  label,
  value,
  dashed,
  title,
}: {
  label: string;
  value: string;
  dashed?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 ${dashed ? 'pb-1 border-b border-dashed' : ''}`}
      style={dashed ? { borderColor: 'var(--color-border)' } : undefined}
    >
      <span className="text-[9px] text-dim w-12 flex-shrink-0">{label}</span>
      <span className="text-[11px] font-bold text-text" title={title}>
        {value}
      </span>
    </div>
  );
}

function SiteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <span className="text-[10px] font-semibold text-text">{value}</span>
    </div>
  );
}

function TeamRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] text-dim w-8 flex-shrink-0">{label}</span>
      <span
        className={`text-[10px] font-bold ${value && value !== '—' ? 'text-text' : 'text-dim'}`}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function computeDuration(start: string | null, end: string | null): string {
  // Q9.5.e-fix-1: v1 renders plain "Nd" (index.html:3851) — was
  // incorrectly converting to weeks for ≥7d. Match v1 verbatim.
  if (!start || !end) return '';
  const a = new Date(start + 'T12:00:00');
  const b = new Date(end + 'T12:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return '';
  return `${days}d`;
}

/** Format an ISO date as "MMM DD, YYYY" (e.g. "Nov 14, 2025") — matches
 * v1's `toLocaleDateString('en-US', {month:'short', day:'numeric',
 * year:'numeric'})` at index.html:3850. */
function formatGoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
