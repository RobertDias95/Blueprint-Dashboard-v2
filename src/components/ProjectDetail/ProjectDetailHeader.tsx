import { useMemo, useState } from 'react';
import type {
  PermitWithCycles,
  Project,
  UnitType,
} from '../../lib/database.types';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useSetBpDdDates } from '../../hooks/useSetBpDdDates';
import { useAppConfig, readConsultantTypes } from '../../hooks/useAppConfig';

// Q9.5.e: 4-column header top strip per v1 §4.2.1. Left card holds an
// inner 3-column grid (DD Phase 0.75fr / Project 1.5fr / Team 1.75fr)
// inside a single bordered container with var(--color-s2) background.
// Right panel is a 240px fixed-width Builder/Owner card.
//
// fix-22 Migration 3 sweep: the 11 physical fields (zone/alley/lot/units/
// unit_types/parking/product_type/project_tags/go_date) plus the 4 new
// builder fields moved permits → projects. This file now reads them off
// the joined project and writes them via useUpdateProject. Per-permit
// fields that intentionally stayed on permits (ent_lead, dm, da, dual_da,
// architect, kickoff_date, dd_start, dd_end) still flow through
// useUpdatePermit on the BP anchor.

interface Props {
  project: Project;
  permits: PermitWithCycles[];
  /** When set, edits operate against this permit (the Building Permit
   *  by default). Mirrors v1's pattern of using the BP as the
   *  project-level anchor for permit-scoped fields. */
  bp: PermitWithCycles | null;
}

export default function ProjectDetailHeader({ project, permits, bp }: Props) {
  return (
    <div
      className="flex border-b border-border"
      data-testid="project-detail-header"
    >
      <div
        className="flex-1 px-4 pt-2 pb-2"
        style={{ background: 'var(--color-s2)' }}
      >
        <div
          className="grid border rounded-lg overflow-hidden bg-surface"
          style={{
            gridTemplateColumns: '0.75fr 1.5fr 1.75fr',
            borderColor: 'var(--color-border)',
          }}
        >
          <DDPhaseCell project={project} bp={bp} />
          <ProjectCell project={project} bp={bp} />
          <TeamCell project={project} bp={bp} permits={permits} />
        </div>
      </div>
      <BuilderOwnerCell project={project} />
    </div>
  );
}

// ============================================================
// DD Phase cell — GO date (read-only, project-level) + DD Start/End
// (editable, permit-level) + Duration
// ============================================================

function DDPhaseCell({
  project,
  bp,
}: {
  project: Project;
  bp: PermitWithCycles | null;
}) {
  if (!bp) {
    return (
      <CellShell title="DD Phase" rightBorder>
        <div className="text-[11px] text-dim">No building permit</div>
      </CellShell>
    );
  }
  return <DDPhaseEditor project={project} bp={bp} />;
}

function DDPhaseEditor({ project, bp }: { project: Project; bp: PermitWithCycles }) {
  // Local-controlled inputs to avoid one-save-per-keystroke. Fires
  // update on blur if the value changed.
  //
  // fix-23a: dd_start/dd_end commits route through useSetBpDdDates so the
  // RPC can cascade target_submit (+14d) across sibling permits AND
  // mirror the dates onto draw_schedule.start_week/end_week. Direct
  // useUpdatePermit writes here left those downstream rows stale —
  // smoke-confirmed against "test 678" (project 094e7d54-…) which now
  // propagates clean.
  const setBpDdDates = useSetBpDdDates();
  const occMissing = !bp.updated_at;
  const [startDraft, setStartDraft] = useState(bp.dd_start ?? '');
  const [endDraft, setEndDraft] = useState(bp.dd_end ?? '');
  const dur = computeDuration(startDraft || null, endDraft || null);
  // fix-22 Mig 3: GO date is project-level now.
  const goDisplay = formatGoDate(project.go_date);

  /** Commit DD dates. The RPC accepts (a) both filled, (b) both null
   *  (clear), but rejects partial-null. We mirror that gate here: when
   *  exactly one input is empty, treat it as mid-state and skip. The
   *  user is mid-typing; the next blur with both filled (or both
   *  cleared) actually fires. */
  async function commitDd() {
    if (!bp.updated_at) return;
    const startNorm = startDraft.trim() || null;
    const endNorm = endDraft.trim() || null;
    // Mid-state: one filled, one empty. Hold off until the user
    // finishes editing.
    if ((startNorm === null) !== (endNorm === null)) return;
    // No-op when nothing changed.
    if (startNorm === (bp.dd_start ?? null) && endNorm === (bp.dd_end ?? null)) {
      return;
    }
    try {
      await setBpDdDates.mutateAsync({
        projectId: bp.project_id,
        ddStart: startNorm,
        ddEnd: endNorm,
        expectedUpdatedAt: bp.updated_at,
      });
    } catch {
      // Toasts surfaced inside the hook; swallow here so the input
      // blur doesn't crash the page on OCC / RPC failure.
    }
  }

  return (
    <CellShell title="DD Phase" rightBorder>
      <div className="flex flex-col gap-1.5">
        <PhaseRow
          label="GO Date"
          value={goDisplay}
          dashed
          title="GO date is set on the Project Settings page"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-dim w-12 flex-shrink-0">Start</span>
          <input
            type="date"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={() => void commitDd()}
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
            onBlur={() => void commitDd()}
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
// Project cell — Proposal (units/type/unit_types/tags) + Site (zone/
// lot/alley/parking). All values read from projects.*, all writes via
// useUpdateProject post-Mig 3.
// ============================================================

function ProjectCell({
  project,
  bp,
}: {
  project: Project;
  bp: PermitWithCycles | null;
}) {
  void bp;
  const productType = project.product_type ?? '';
  const tags = Array.isArray(project.project_tags)
    ? (project.project_tags as string[])
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
            {project.units != null && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[9px] text-dim min-w-[36px]">Units</span>
                <span className="text-sm font-extrabold text-text">
                  {project.units}
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
            {/* Unit Dimensions section. fix-22 Mig 3: unit_types lives on
                projects now, writes via useUpdateProject. */}
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-[9px] text-dim min-w-[36px] pt-0.5">
                Units
              </span>
              <div className="flex-1 min-w-0">
                <UnitDimensions project={project} />
              </div>
            </div>
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

        {/* Site — fix-22 Mig 3: zone/alley/lot/parking moved to projects;
            writes via useUpdateProject. */}
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            Site
          </div>
          <SiteEditor project={project} />
        </div>
      </div>
    </CellShell>
  );
}

// ============================================================
// Team cell — Internal (ENT/DA/DM/ACQ) + External
// ============================================================

function TeamCell({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  // fix-22 Mig 3: project-level entitlement_lead is the default; bp.ent_lead
  // overrides per-permit (Bobby's PAR/SDOT/ECA pattern). Display the BP
  // override when present, else fall back to project-level default.
  const ent = bp?.ent_lead ?? project.entitlement_lead ?? null;
  const da = bp?.da ?? null;
  const dm = bp?.dm ?? project.design_manager ?? null;
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
            <TeamRow label="ACQ" value={project.acq_lead ?? '—'} />
          </div>
        </div>
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            External
          </div>
          <ExternalTeamEditor project={project} />
        </div>
      </div>
    </CellShell>
  );
}

// Q9.5.e-fix-3: External team editor — 3 selects (Civil / Surveyor /
// Structural) sourced from app_config.consultantTypes. Each select writes
// the full external_team JSON back to projects via useUpdateProject (OCC).
function ExternalTeamEditor({ project }: { project: Project }) {
  const cfgQ = useAppConfig();
  const updateMutation = useUpdateProject();
  const consultants = useMemo(
    () => readConsultantTypes(cfgQ.map),
    [cfgQ.map],
  );
  const external =
    project.external_team && typeof project.external_team === 'object'
      ? (project.external_team as Record<string, string>)
      : {};
  const occMissing = !project.updated_at;

  if (consultants.length === 0) {
    return (
      <div className="text-[10px] text-dim italic">
        No consultant types configured. Settings → Consultants.
      </div>
    );
  }

  async function setFirm(consultantType: string, firm: string) {
    if (!project.updated_at) return;
    const next: Record<string, string> = { ...external };
    if (firm) next[consultantType] = firm;
    else delete next[consultantType];
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { external_team: next },
      fieldLabel: `${consultantType} consultant`,
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {consultants.map((ct) => {
        const val = external[ct.type] ?? '';
        return (
          <div key={ct.type} className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-dim uppercase tracking-wide">
              {ct.type}
            </span>
            <select
              value={val}
              onChange={(e) => void setFirm(ct.type, e.target.value)}
              disabled={occMissing || updateMutation.isPending}
              className={`text-[10px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer disabled:opacity-50 ${
                val ? 'font-bold text-text' : 'font-normal text-dim'
              }`}
              style={{ borderBottomColor: 'var(--color-border)' }}
              data-testid={`pd-ext-${ct.type.toLowerCase()}`}
            >
              <option value="">unassigned</option>
              {ct.firms.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Builder / Owner cell — fix-22 Mig 6+7: 4 freeform inputs writing
// directly to projects.builder_name/_company/_email/_phone. Replaces the
// previous builders-table FK flow (still available via useBuilders for
// future cross-project rolodex use, but the Project Overview surface
// now treats the four columns as the canonical store, matching the
// wizard's Step 1 panel layout).
// ============================================================

function BuilderOwnerCell({ project }: { project: Project }) {
  const updateProject = useUpdateProject();
  const occMissing = !project.updated_at;

  const [name, setName] = useState(project.builder_name ?? '');
  const [company, setCompany] = useState(project.builder_company ?? '');
  const [email, setEmail] = useState(project.builder_email ?? '');
  const [phone, setPhone] = useState(project.builder_phone ?? '');

  async function commit<K extends keyof Project>(
    field: K,
    next: string,
    original: string | null | undefined,
    label: string,
  ) {
    if (!project.updated_at) return;
    const trimmed = next.trim();
    const normalized: string | null = trimmed === '' ? null : trimmed;
    if (normalized === (original ?? null)) return;
    await updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { [field]: normalized } as Partial<Project>,
      fieldLabel: label,
    });
  }

  const labelStyle =
    'text-[8px] font-bold text-dim uppercase tracking-wide';
  const inputClass =
    'text-[12px] font-bold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 disabled:opacity-50';
  const inputStyle = { borderBottomColor: 'var(--color-border)' };

  return (
    <div
      className="flex-shrink-0 px-4 py-2 border-l flex flex-col gap-1.5"
      style={{
        width: 240,
        borderLeftColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid="pd-builder-cell"
    >
      <div className="text-[10px] font-extrabold text-text uppercase tracking-wider">
        Builder / Owner
      </div>
      <div>
        <span className={labelStyle}>Owner</span>
        <input
          type="text"
          value={name}
          placeholder="Full name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit('builder_name', name, project.builder_name, 'Builder Name')}
          disabled={occMissing}
          className={inputClass}
          style={inputStyle}
          data-testid="pd-builder-name"
        />
      </div>
      <div>
        <span className={labelStyle}>Business</span>
        <input
          type="text"
          value={company}
          placeholder="Company"
          onChange={(e) => setCompany(e.target.value)}
          onBlur={() => commit('builder_company', company, project.builder_company, 'Builder Company')}
          disabled={occMissing}
          className={inputClass}
          style={inputStyle}
          data-testid="pd-builder-company"
        />
      </div>
      <div>
        <span className={labelStyle}>Email</span>
        <input
          type="email"
          value={email}
          placeholder="builder@email.com"
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => commit('builder_email', email, project.builder_email, 'Builder Email')}
          disabled={occMissing}
          className={`${inputClass} font-semibold`}
          style={{ ...inputStyle, color: 'var(--color-de)' }}
          data-testid="pd-builder-email"
        />
      </div>
      <div>
        <span className={labelStyle}>Cell</span>
        <input
          type="tel"
          value={phone}
          placeholder="(206) 555-0100"
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => commit('builder_phone', phone, project.builder_phone, 'Builder Phone')}
          disabled={occMissing}
          className={inputClass}
          style={inputStyle}
          data-testid="pd-builder-phone"
        />
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
  if (!start || !end) return '';
  const a = new Date(start + 'T12:00:00');
  const b = new Date(end + 'T12:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return '';
  return `${days}d`;
}

/** Format an ISO date as "MMM DD, YYYY" — matches v1's
 * `toLocaleDateString('en-US', {month:'short', day:'numeric',
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

// ============================================================
// fix-22 Mig 3: Site editor — writes zone / lot / alley / parking_type /
// parking_stalls to projects via useUpdateProject. Previously wrote to
// permits via useUpdatePermit on the BP.
// ============================================================

function SiteEditor({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;

  async function commit<K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) {
    if (!project.updated_at) return;
    if (next === (original ?? null)) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { [field]: next } as Partial<Project>,
      fieldLabel: label,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <SiteTextRow
        label="Zone"
        value={project.zone}
        placeholder="e.g. RSL"
        disabled={occMissing}
        onCommit={(v) => commit('zone', v || null, project.zone, 'Zone')}
      />
      <SiteLotRow project={project} disabled={occMissing} onCommit={commit} />
      <SiteSelectRow
        label="Alley"
        value={project.alley ?? ''}
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => commit('alley', v || null, project.alley, 'Alley')}
      />
      <SiteSelectRow
        label="Parking"
        value={project.parking_type ?? ''}
        options={['', 'None', 'Surface', 'Garage', 'Both']}
        disabled={occMissing}
        onCommit={(v) =>
          commit('parking_type', v || null, project.parking_type, 'Parking Type')
        }
      />
      <SiteNumberRow
        label="Stalls"
        value={project.parking_stalls ?? null}
        disabled={occMissing}
        onCommit={(v) =>
          commit('parking_stalls', v, project.parking_stalls, 'Parking Stalls')
        }
      />
    </div>
  );
}

function SiteTextRow({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft.trim())}
        disabled={disabled}
        className="flex-1 min-w-0 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      />
    </div>
  );
}

function SiteSelectRow({
  label,
  value,
  options,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        disabled={disabled}
        className="flex-1 min-w-0 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === '' ? '—' : opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function SiteNumberRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          const n = trimmed === '' ? null : Number(trimmed);
          onCommit(Number.isFinite(n as number) ? (n as number | null) : null);
        }}
        disabled={disabled}
        className="flex-1 min-w-0 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      />
    </div>
  );
}

function SiteLotRow({
  project,
  disabled,
  onCommit,
}: {
  project: Project;
  disabled: boolean;
  onCommit: <K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) => Promise<void>;
}) {
  const [wDraft, setWDraft] = useState<string>(
    project.lot_width != null ? String(project.lot_width) : '',
  );
  const [dDraft, setDDraft] = useState<string>(
    project.lot_depth != null ? String(project.lot_depth) : '',
  );
  const parse = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">Lot</span>
      <input
        type="number"
        min={0}
        value={wDraft}
        placeholder="W"
        onChange={(e) => setWDraft(e.target.value)}
        onBlur={() =>
          onCommit('lot_width', parse(wDraft), project.lot_width, 'Lot Width')
        }
        disabled={disabled}
        className="w-10 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-w"
      />
      <span className="text-[9px] text-dim">×</span>
      <input
        type="number"
        min={0}
        value={dDraft}
        placeholder="D"
        onChange={(e) => setDDraft(e.target.value)}
        onBlur={() =>
          onCommit('lot_depth', parse(dDraft), project.lot_depth, 'Lot Depth')
        }
        disabled={disabled}
        className="w-10 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-d"
      />
      <span className="text-[9px] text-dim">ft</span>
    </div>
  );
}

// ============================================================
// fix-22 Mig 3: Unit Dimensions editor — unit_types moved permits →
// projects. Writes via useUpdateProject.
// ============================================================

function parseUnitTypes(raw: unknown): UnitType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
    .map((u) => ({
      label: typeof u.label === 'string' ? u.label : '',
      // Support both v1's {w,d} shape and the new {width_ft,depth_ft} shape
      // the wizard writes. Keep the canonical UnitType shape going out.
      width_ft:
        typeof u.width_ft === 'number'
          ? u.width_ft
          : typeof u.w === 'number'
            ? u.w
            : null,
      depth_ft:
        typeof u.depth_ft === 'number'
          ? u.depth_ft
          : typeof u.d === 'number'
            ? u.d
            : null,
      qty: typeof u.qty === 'number' && u.qty > 0 ? u.qty : 1,
    }));
}

function UnitDimensions({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const types = parseUnitTypes(project.unit_types);

  async function writeTypes(next: UnitType[]) {
    if (!project.updated_at) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { unit_types: next },
      fieldLabel: 'Unit Dimensions',
    });
  }

  // Compact mode: empty or single unnamed entry
  const isCompact =
    types.length <= 1 && (types.length === 0 || !types[0]?.label);
  if (isCompact) {
    return (
      <UnitDimensionsCompact
        current={types[0]}
        disabled={occMissing}
        onSet={(field, val) => {
          const base = types[0] ?? { label: '', width_ft: null, depth_ft: null, qty: 1 };
          const next: UnitType = { ...base, [field]: val };
          void writeTypes([next]);
        }}
        onExpand={() => {
          const seed: UnitType[] =
            types.length === 0
              ? [
                  { label: 'Type A', width_ft: null, depth_ft: null, qty: 1 },
                  { label: 'Type B', width_ft: null, depth_ft: null, qty: 1 },
                ]
              : [
                  { ...types[0], label: types[0].label || 'Type A' },
                  { label: 'Type B', width_ft: null, depth_ft: null, qty: 1 },
                ];
          void writeTypes(seed);
        }}
      />
    );
  }

  return (
    <UnitDimensionsExpanded
      types={types}
      disabled={occMissing}
      onUpdate={(idx, field, val) => {
        const next = types.map((t, i) =>
          i === idx ? { ...t, [field]: val } : t,
        );
        void writeTypes(next);
      }}
      onRemove={(idx) => {
        const next = types.filter((_, i) => i !== idx);
        void writeTypes(next);
      }}
      onAdd={() => {
        const next = [
          ...types,
          { label: '', width_ft: null, depth_ft: null, qty: 1 },
        ];
        void writeTypes(next);
      }}
    />
  );
}

function UnitDimensionsCompact({
  current,
  disabled,
  onSet,
  onExpand,
}: {
  current: UnitType | undefined;
  disabled: boolean;
  onSet: (field: 'width_ft' | 'depth_ft', val: number) => void;
  onExpand: () => void;
}) {
  const [w, setW] = useState<string>(
    current?.width_ft != null ? String(current.width_ft) : '',
  );
  const [d, setD] = useState<string>(
    current?.depth_ft != null ? String(current.depth_ft) : '',
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={w}
          placeholder="W"
          onChange={(e) => setW(e.target.value)}
          onBlur={() => onSet('width_ft', Number(w) || 0)}
          disabled={disabled}
          className="w-9 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-units-compact-w"
        />
        <span className="text-[9px] text-dim">×</span>
        <input
          type="number"
          min={0}
          value={d}
          placeholder="D"
          onChange={(e) => setD(e.target.value)}
          onBlur={() => onSet('depth_ft', Number(d) || 0)}
          disabled={disabled}
          className="w-9 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-units-compact-d"
        />
        <span className="text-[9px] text-dim">ft</span>
      </div>
      <button
        type="button"
        onClick={onExpand}
        disabled={disabled}
        className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start cursor-pointer disabled:opacity-50"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="pd-units-expand"
      >
        + different sizes
      </button>
    </div>
  );
}

function UnitDimensionsExpanded({
  types,
  disabled,
  onUpdate,
  onRemove,
  onAdd,
}: {
  types: UnitType[];
  disabled: boolean;
  onUpdate: (
    idx: number,
    field: keyof UnitType,
    val: string | number | null,
  ) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex gap-1 text-[8px] text-dim pb-0.5">
        <span style={{ width: 44 }}>Label</span>
        <span className="text-center" style={{ width: 26 }}>W</span>
        <span style={{ width: 10 }} />
        <span className="text-center" style={{ width: 26 }}>D</span>
        <span style={{ width: 8 }} />
        <span className="text-center" style={{ width: 20 }}>Qty</span>
      </div>
      {types.map((ut, i) => (
        <UnitRow
          key={i}
          row={ut}
          disabled={disabled}
          onChange={(field, val) => onUpdate(i, field, val)}
          onRemove={() => onRemove(i)}
        />
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start mt-0.5 cursor-pointer disabled:opacity-50"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="pd-units-add"
      >
        + Add type
      </button>
    </div>
  );
}

function UnitRow({
  row,
  disabled,
  onChange,
  onRemove,
}: {
  row: UnitType;
  disabled: boolean;
  onChange: (field: keyof UnitType, val: string | number | null) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [w, setW] = useState(row.width_ft != null ? String(row.width_ft) : '');
  const [d, setD] = useState(row.depth_ft != null ? String(row.depth_ft) : '');
  const [qty, setQty] = useState(String(row.qty || 1));
  const cellStyle = { borderBottomColor: 'var(--color-border)' } as const;
  const cellClass =
    'text-[9px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50';
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={label}
        placeholder="Label"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onChange('label', label)}
        disabled={disabled}
        style={{ ...cellStyle, width: 44 }}
        className={`${cellClass} text-left`}
      />
      <input
        type="number"
        min={0}
        value={w}
        placeholder="W"
        onChange={(e) => setW(e.target.value)}
        onBlur={() => onChange('width_ft', w === '' ? null : Number(w) || 0)}
        disabled={disabled}
        style={{ ...cellStyle, width: 26 }}
        className={cellClass}
      />
      <span className="text-[8px] text-dim">×</span>
      <input
        type="number"
        min={0}
        value={d}
        placeholder="D"
        onChange={(e) => setD(e.target.value)}
        onBlur={() => onChange('depth_ft', d === '' ? null : Number(d) || 0)}
        disabled={disabled}
        style={{ ...cellStyle, width: 26 }}
        className={cellClass}
      />
      <span className="text-[8px] text-dim">×</span>
      <input
        type="number"
        min={1}
        value={qty}
        placeholder="qty"
        onChange={(e) => setQty(e.target.value)}
        onBlur={() => onChange('qty', Number(qty) || 1)}
        disabled={disabled}
        style={{ ...cellStyle, width: 20 }}
        className={cellClass}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="bg-transparent border-0 text-dim cursor-pointer text-[12px] leading-none px-0.5 disabled:opacity-50"
        title="Remove type"
      >
        ×
      </button>
    </div>
  );
}
