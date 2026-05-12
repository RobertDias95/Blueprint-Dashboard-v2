import { useMemo, useState } from 'react';
import type { Permit, PermitWithCycles, Project } from '../../lib/database.types';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useAppConfig, readConsultantTypes } from '../../hooks/useAppConfig';
import { useBuilders, useUpsertBuilder } from '../../hooks/useBuilders';

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
          <ProjectCell project={project} bp={bp} />
          <TeamCell bp={bp} permits={permits} project={project} />
        </div>
      </div>
      <BuilderOwnerCell project={project} />
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
  bp,
}: {
  project: Project;
  bp: PermitWithCycles | null;
}) {
  void project;
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
            {/* Q9.5.e-fix-2: Unit Dimensions section ports v1's
                renderUnitTypesInline (index.html:5842-5874). Editable inline,
                writes JSONB unit_types on the BP. */}
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-[9px] text-dim min-w-[36px] pt-0.5">
                Units
              </span>
              <div className="flex-1 min-w-0">
                {bp ? (
                  <UnitDimensions bp={bp} />
                ) : (
                  <span className="text-[9px] text-dim italic">—</span>
                )}
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

        {/* Site — Q9.5.e-fix-2: editable inputs wired to useUpdatePermit on
            the BP. Each control commits on blur/change matching the DD Phase
            pattern. */}
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            Site
          </div>
          {bp ? (
            <SiteEditor bp={bp} />
          ) : (
            <div className="text-[10px] text-dim italic">No building permit</div>
          )}
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
  project,
}: {
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
  project: Project;
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
// Builder / Owner cell (read-only stub — see backlog)
// ============================================================

// Q9.5.e-fix-3: Builder/Owner cell — autocomplete from `builders` table via
// HTML `<datalist>`, falling back to "Create new" on commit. Selecting an
// existing builder sets projects.builder_id (FK); selecting/clearing all
// fields clears builder_id back to null.
function BuilderOwnerCell({ project }: { project: Project }) {
  const buildersQ = useBuilders();
  const updateProject = useUpdateProject();
  const upsertBuilder = useUpsertBuilder();

  const current =
    project.builder_id
      ? buildersQ.data?.find((b) => b.id === project.builder_id) ?? null
      : null;

  const occMissing = !project.updated_at;
  const datalistId = `builders-list-${project.id}`;

  // Local drafts — commit on blur. When `current` changes (via picker or
  // external sync), re-seed from props on next render via key prop on
  // BuilderForm.
  return (
    <div
      className="flex-shrink-0 px-4 py-3.5 border-l flex flex-col gap-2"
      style={{
        width: 240,
        borderLeftColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid="pd-builder-cell"
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-extrabold text-text uppercase tracking-wider">
          Builder / Owner
        </div>
        {current && (
          <button
            type="button"
            onClick={() =>
              project.updated_at &&
              void updateProject.mutateAsync({
                projectId: project.id,
                expectedUpdatedAt: project.updated_at,
                patch: { builder_id: null },
                fieldLabel: 'Builder',
              })
            }
            disabled={occMissing || updateProject.isPending}
            className="text-[9px] text-dim hover:text-co underline disabled:opacity-50"
            data-testid="pd-builder-clear"
            title="Detach builder from this project"
          >
            clear
          </button>
        )}
      </div>
      <datalist id={datalistId}>
        {(buildersQ.data ?? []).map((b) => (
          <option key={b.id} value={b.name}>
            {b.company || b.email || b.phone || ''}
          </option>
        ))}
      </datalist>
      <BuilderForm
        key={current?.id ?? 'empty'}
        current={current}
        builders={buildersQ.data ?? []}
        disabled={occMissing}
        datalistId={datalistId}
        onPickExisting={async (builderId) => {
          if (!project.updated_at) return;
          await updateProject.mutateAsync({
            projectId: project.id,
            expectedUpdatedAt: project.updated_at,
            patch: { builder_id: builderId },
            fieldLabel: 'Builder',
          });
        }}
        onCreateOrUpdate={async (form) => {
          if (!project.updated_at) return;
          // If no name, nothing to do.
          if (!form.name.trim()) return;
          // If editing an existing builder linked to this project, update
          // that row. Otherwise, create a new builder and FK it in.
          if (current && form.name.trim() === current.name) {
            await upsertBuilder.mutateAsync({
              id: current.id,
              name: form.name.trim(),
              company: form.company.trim() || null,
              email: form.email.trim() || null,
              phone: form.phone.trim() || null,
            });
            return;
          }
          const created = await upsertBuilder.mutateAsync({
            name: form.name.trim(),
            company: form.company.trim() || null,
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
          });
          await updateProject.mutateAsync({
            projectId: project.id,
            expectedUpdatedAt: project.updated_at,
            patch: { builder_id: created.id },
            fieldLabel: 'Builder',
          });
        }}
      />
    </div>
  );
}

function BuilderForm({
  current,
  builders,
  disabled,
  datalistId,
  onPickExisting,
  onCreateOrUpdate,
}: {
  current: { id: string; name: string; company: string | null; email: string | null; phone: string | null } | null;
  builders: { id: string; name: string; company: string | null; email: string | null; phone: string | null }[];
  disabled: boolean;
  datalistId: string;
  onPickExisting: (builderId: string) => Promise<void>;
  onCreateOrUpdate: (form: {
    name: string;
    company: string;
    email: string;
    phone: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(current?.name ?? '');
  const [company, setCompany] = useState(current?.company ?? '');
  const [email, setEmail] = useState(current?.email ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');

  function onNameBlur() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Exact name match against existing builders → pick existing
    const match = builders.find(
      (b) => b.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (match && match.id !== current?.id) {
      // Pre-fill the form from the matched builder for visual feedback
      setName(match.name);
      setCompany(match.company ?? '');
      setEmail(match.email ?? '');
      setPhone(match.phone ?? '');
      void onPickExisting(match.id);
      return;
    }
    // No match — commit will land via field-level blur (company/email/phone)
    void onCreateOrUpdate({ name: trimmed, company, email, phone });
  }

  function fieldBlur() {
    if (!name.trim()) return;
    void onCreateOrUpdate({ name: name.trim(), company, email, phone });
  }

  const labelStyle =
    'text-[8px] font-bold text-dim uppercase tracking-wide';
  const inputClass =
    'text-[12px] font-bold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 disabled:opacity-50';
  const inputStyle = { borderBottomColor: 'var(--color-border)' };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className={labelStyle}>Owner</span>
        <input
          type="text"
          value={name}
          list={datalistId}
          placeholder="Full name"
          onChange={(e) => setName(e.target.value)}
          onBlur={onNameBlur}
          disabled={disabled}
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
          onBlur={fieldBlur}
          disabled={disabled}
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
          onBlur={fieldBlur}
          disabled={disabled}
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
          onBlur={fieldBlur}
          disabled={disabled}
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

// ============================================================
// Q9.5.e-fix-2: editable Site fields (Zone / Lot / Alley / Parking / Stalls)
// All writes go through useUpdatePermit on the BP. Commit on blur for text
// inputs, on change for selects — matches the DD Phase commit pattern.
// ============================================================

function SiteEditor({ bp }: { bp: PermitWithCycles }) {
  const updateMutation = useUpdatePermit();
  const occMissing = !bp.updated_at;

  async function commit<K extends keyof Permit>(
    field: K,
    next: Permit[K],
    original: Permit[K],
    label: string,
  ) {
    if (!bp.updated_at) return;
    if (next === original) return;
    await updateMutation.mutateAsync({
      permitId: bp.id,
      projectId: bp.project_id,
      expectedUpdatedAt: bp.updated_at,
      patch: { [field]: next } as Partial<Permit>,
      fieldLabel: label,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <SiteTextRow
        label="Zone"
        value={bp.zone}
        placeholder="e.g. RSL"
        disabled={occMissing}
        onCommit={(v) => commit('zone', v || null, bp.zone, 'Zone')}
      />
      <SiteLotRow bp={bp} disabled={occMissing} onCommit={commit} />
      <SiteSelectRow
        label="Alley"
        value={bp.alley ?? ''}
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => commit('alley', v || null, bp.alley ?? null, 'Alley')}
      />
      <SiteSelectRow
        label="Parking"
        value={bp.parking_type ?? ''}
        options={['', 'None', 'Surface', 'Garage', 'Both']}
        disabled={occMissing}
        onCommit={(v) =>
          commit('parking_type', v || null, bp.parking_type, 'Parking Type')
        }
      />
      <SiteNumberRow
        label="Stalls"
        value={bp.parking_stalls}
        disabled={occMissing}
        onCommit={(v) =>
          commit('parking_stalls', v, bp.parking_stalls, 'Parking Stalls')
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
  bp,
  disabled,
  onCommit,
}: {
  bp: PermitWithCycles;
  disabled: boolean;
  onCommit: <K extends keyof Permit>(
    field: K,
    next: Permit[K],
    original: Permit[K],
    label: string,
  ) => Promise<void>;
}) {
  const [wDraft, setWDraft] = useState<string>(
    bp.lot_width != null ? String(bp.lot_width) : '',
  );
  const [dDraft, setDDraft] = useState<string>(
    bp.lot_depth != null ? String(bp.lot_depth) : '',
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
          onCommit('lot_width', parse(wDraft), bp.lot_width ?? null, 'Lot Width')
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
          onCommit('lot_depth', parse(dDraft), bp.lot_depth ?? null, 'Lot Depth')
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
// Q9.5.e-fix-2: Unit Dimensions editor — port of v1's renderUnitTypesInline
// (index.html:5842-5874). unit_types lives as JSONB on the BP.
//
// Two render modes:
//   - Compact (≤1 entry, no label): one W×D pair with "+ different sizes"
//     to expand into typed entries.
//   - Expanded: list of {label, w, d, qty} rows with add/remove.
// All writes flush the full array via useUpdatePermit. Local drafts let the
// user type without one-RPC-per-keystroke; commit happens on blur.
// ============================================================

interface UnitType {
  label: string;
  w: number;
  d: number;
  qty: number;
}

function parseUnitTypes(raw: unknown): UnitType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
    .map((u) => ({
      label: typeof u.label === 'string' ? u.label : '',
      w: typeof u.w === 'number' ? u.w : 0,
      d: typeof u.d === 'number' ? u.d : 0,
      qty: typeof u.qty === 'number' && u.qty > 0 ? u.qty : 1,
    }));
}

function UnitDimensions({ bp }: { bp: PermitWithCycles }) {
  const updateMutation = useUpdatePermit();
  const occMissing = !bp.updated_at;
  const types = parseUnitTypes(bp.unit_types);

  async function writeTypes(next: UnitType[]) {
    if (!bp.updated_at) return;
    await updateMutation.mutateAsync({
      permitId: bp.id,
      projectId: bp.project_id,
      expectedUpdatedAt: bp.updated_at,
      patch: { unit_types: next as unknown as Permit['unit_types'] },
      fieldLabel: 'Unit Dimensions',
    });
  }

  // Compact mode: empty or single unnamed entry
  const isCompact =
    types.length <= 1 && (types.length === 0 || !types[0]?.label);
  if (isCompact) {
    return (
      <UnitDimensionsCompact
        bp={bp}
        current={types[0]}
        disabled={occMissing}
        onSet={(field, val) => {
          const base = types[0] ?? { label: '', w: 0, d: 0, qty: 1 };
          const next: UnitType = { ...base, [field]: val };
          void writeTypes([next]);
        }}
        onExpand={() => {
          const seed: UnitType[] =
            types.length === 0
              ? [
                  { label: 'Type A', w: 0, d: 0, qty: 1 },
                  { label: 'Type B', w: 0, d: 0, qty: 1 },
                ]
              : [
                  { ...types[0], label: types[0].label || 'Type A' },
                  { label: 'Type B', w: 0, d: 0, qty: 1 },
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
        const next = [...types, { label: '', w: 0, d: 0, qty: 1 }];
        void writeTypes(next);
      }}
    />
  );
}

function UnitDimensionsCompact({
  bp,
  current,
  disabled,
  onSet,
  onExpand,
}: {
  bp: PermitWithCycles;
  current: UnitType | undefined;
  disabled: boolean;
  onSet: (field: 'w' | 'd', val: number) => void;
  onExpand: () => void;
}) {
  void bp;
  const [w, setW] = useState<string>(current?.w ? String(current.w) : '');
  const [d, setD] = useState<string>(current?.d ? String(current.d) : '');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={w}
          placeholder="W"
          onChange={(e) => setW(e.target.value)}
          onBlur={() => onSet('w', Number(w) || 0)}
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
          onBlur={() => onSet('d', Number(d) || 0)}
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
  onUpdate: (idx: number, field: keyof UnitType, val: string | number) => void;
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
  onChange: (field: keyof UnitType, val: string | number) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [w, setW] = useState(row.w ? String(row.w) : '');
  const [d, setD] = useState(row.d ? String(row.d) : '');
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
        onBlur={() => onChange('w', Number(w) || 0)}
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
        onBlur={() => onChange('d', Number(d) || 0)}
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
