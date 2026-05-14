import { useState, useEffect, useMemo } from 'react';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { useCreatePermit } from '../../hooks/useCreatePermit';
import { useDeletePermit } from '../../hooks/useDeletePermit';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { usePermitsByProject } from '../../hooks/usePermitsByProject';
import { pushToast } from '../../stores/toastStore';
import type { PermitWithCycles, Project } from '../../lib/database.types';

// fix-22 Migration 3 sweep: ProjectSettingsModal repointed so the 11
// physical fields + 4 builder fields read/write directly on projects.*
// instead of the BP permit anchor. Per-permit fields (ent_lead, dm, da,
// dual_da, architect, portal_url, num, struct_address) still flow
// through useUpdatePermit for the BP.
//
// Three sections:
//   1. PROJECT INFO — address / juris / acq_lead / archived / notes plus
//      the 11 moved-to-project fields (go_date, units, zone, lot_*,
//      parking_*, alley, product_type, entitlement_lead, design_manager).
//      ENT/DM defaults live on projects; per-permit overrides happen in
//      the Permits section.
//   2. BUILDER / OWNER — 4 freeform inputs writing directly to
//      projects.builder_name/_company/_email/_phone.
//   3. PERMITS — repeating block; edit / add / delete permits.
//
// Deferred from v1: PROJECT TAGS (jsonb pill editor) and UNIT TYPES
// (jsonb repeating-row editor). Both columns now ride on projects;
// editing happens in the Project Overview header until those components
// land here.

interface Props {
  project: Project;
  onClose: () => void;
}

const PARKING_OPTIONS = ['', 'None', 'Surface', 'Garage', 'Both'];
const ALLEY_OPTIONS = ['', 'Yes', 'No'];
const PRODUCT_TYPES = [
  '',
  'SFR',
  'SFR w/ Accessory Units',
  'Attached Units',
  'Cottages',
];

/** fix-22 Mig 3: project-level scalar fields that used to live on the BP
 *  permit (rebranded from "BpFields" to make their new home explicit).
 *  ent_lead + dm still live per-permit on the BP — kept in BpRoleFields
 *  below. */
interface ProjectScalarFields {
  go_date: string;
  units: string;
  zone: string;
  lot_width: string;
  lot_depth: string;
  parking_type: string;
  parking_stalls: string;
  alley: string;
  product_type: string;
  entitlement_lead: string;
  design_manager: string;
}

interface BpRoleFields {
  da: string;
}

interface BuilderFlatFields {
  builder_name: string;
  builder_company: string;
  builder_email: string;
  builder_phone: string;
}

interface PermitRow {
  id: number | null;
  isNew: boolean;
  isDeleted: boolean;
  type: string;
  ent_lead: string;
  da: string;
  portal_url: string;
  num: string;
  struct_address: string;
  updated_at?: string | null;
}

interface FormState {
  address: string;
  juris: string;
  acq_lead: string;
  notes: string;
  archived: boolean;
  /** fix-22 Mig 3: project-level scalar fields. */
  projectFields: ProjectScalarFields;
  /** fix-22 Mig 3: project-level builder/owner fields (flat columns). */
  builder: BuilderFlatFields;
  /** BP-anchored fields that stay per-permit. */
  bpRole: BpRoleFields;
  permits: PermitRow[];
}

function permitToRow(p: PermitWithCycles): PermitRow {
  return {
    id: p.id,
    isNew: false,
    isDeleted: false,
    type: p.type ?? '',
    ent_lead: p.ent_lead ?? '',
    da: p.da ?? '',
    portal_url: p.portal_url ?? '',
    num: p.num ?? '',
    struct_address: p.struct_address ?? '',
    updated_at: p.updated_at,
  };
}

function initForm(
  project: Project,
  permits: PermitWithCycles[],
): FormState {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  return {
    address: project.address ?? '',
    juris: project.juris ?? '',
    acq_lead: project.acq_lead ?? '',
    notes: project.notes ?? '',
    archived: !!project.archived,
    builder: {
      builder_name: project.builder_name ?? '',
      builder_company: project.builder_company ?? '',
      builder_email: project.builder_email ?? '',
      builder_phone: project.builder_phone ?? '',
    },
    projectFields: {
      go_date: project.go_date ?? '',
      units: project.units != null ? String(project.units) : '',
      zone: project.zone ?? '',
      lot_width: project.lot_width != null ? String(project.lot_width) : '',
      lot_depth: project.lot_depth != null ? String(project.lot_depth) : '',
      parking_type: project.parking_type ?? '',
      parking_stalls:
        project.parking_stalls != null ? String(project.parking_stalls) : '',
      alley: project.alley ?? '',
      product_type: project.product_type ?? '',
      entitlement_lead: project.entitlement_lead ?? '',
      design_manager: project.design_manager ?? '',
    },
    bpRole: {
      da: bp?.da ?? '',
    },
    permits: permits.map(permitToRow),
  };
}

export default function ProjectSettingsModal({ project, onClose }: Props) {
  const permitsQ = usePermitsByProject(project.id);
  const jurisdictionsQ = useJurisdictions();
  const teamQ = useTeamMembers();

  const permits = useMemo(() => permitsQ.data ?? [], [permitsQ.data]);
  const bpPermit = useMemo(
    () => permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null,
    [permits],
  );

  const [form, setForm] = useState<FormState>(() => initForm(project, permits));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initForm(project, permits));
  }, [project.id, project.updated_at, permits]);

  const updateProject = useUpdateProject();
  const updatePermit = useUpdatePermit();
  const createPermit = useCreatePermit();
  const deletePermit = useDeletePermit();

  // fix-22-final: dedupe by name. Schema carries both legacy + lead role
  // variants for the same person (e.g. Bobby is both 'ent' and 'ent_lead').
  const team = teamQ.data ?? [];
  const dedupByName = (list: typeof team) => {
    const seen = new Set<string>();
    const out: typeof team = [];
    for (const m of list) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push(m);
    }
    return out;
  };
  const entMembers = dedupByName(
    team.filter((t) => (t.role === 'ent' || t.role === 'ent_lead') && t.active !== false),
  );
  const dmMembers = team.filter((t) => t.role === 'dm' && t.active !== false);
  const daMembers = team.filter((t) => t.role === 'da' && t.active !== false);
  const acqMembers = dedupByName(
    team.filter((t) => (t.role === 'acq' || t.role === 'acq_lead') && t.active !== false),
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setProj<K extends keyof ProjectScalarFields>(
    key: K,
    value: ProjectScalarFields[K],
  ) {
    setForm((f) => ({ ...f, projectFields: { ...f.projectFields, [key]: value } }));
  }
  function setBpRole<K extends keyof BpRoleFields>(key: K, value: BpRoleFields[K]) {
    setForm((f) => ({ ...f, bpRole: { ...f.bpRole, [key]: value } }));
  }
  function setBuilderField<K extends keyof BuilderFlatFields>(
    key: K,
    value: BuilderFlatFields[K],
  ) {
    setForm((f) => ({ ...f, builder: { ...f.builder, [key]: value } }));
  }
  function setPermitField(idx: number, patch: Partial<PermitRow>) {
    setForm((f) => ({
      ...f,
      permits: f.permits.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  }
  function addPermit() {
    setForm((f) => ({
      ...f,
      permits: [
        ...f.permits,
        {
          id: null,
          isNew: true,
          isDeleted: false,
          type: 'Building Permit',
          ent_lead: '',
          da: '',
          portal_url: '',
          num: '',
          struct_address: '',
        },
      ],
    }));
  }
  function removePermit(idx: number) {
    setForm((f) => ({
      ...f,
      permits: f.permits.map((p, i) =>
        i === idx
          ? p.isNew
            ? { ...p, isDeleted: true }
            : { ...p, isDeleted: true }
          : p,
      ),
    }));
  }

  function toNumOrNull(s: string): number | null {
    const v = s.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function handleSave() {
    if (!form.address.trim()) {
      pushToast('Address is required.', 'warn');
      return;
    }
    if (!project.updated_at) return;
    setSaving(true);
    try {
      // 1. Project update — fix-22 Mig 3 collapses the previous
      // project-update + builder-upsert + BP-anchored-site-update into a
      // single projects.* write. The 11 moved-to-project fields and the 4
      // builder fields all live here now.
      await updateProject.mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch: {
          address: form.address.trim(),
          juris: form.juris.trim() || null,
          acq_lead: form.acq_lead.trim() || null,
          notes: form.notes,
          archived: form.archived,
          go_date: form.projectFields.go_date || null,
          units: toNumOrNull(form.projectFields.units),
          zone: form.projectFields.zone.trim() || null,
          lot_width: toNumOrNull(form.projectFields.lot_width),
          lot_depth: toNumOrNull(form.projectFields.lot_depth),
          parking_type: form.projectFields.parking_type || null,
          parking_stalls: toNumOrNull(form.projectFields.parking_stalls),
          alley: form.projectFields.alley || null,
          product_type: form.projectFields.product_type || null,
          entitlement_lead: form.projectFields.entitlement_lead.trim() || null,
          design_manager: form.projectFields.design_manager.trim() || null,
          builder_name: form.builder.builder_name.trim() || null,
          builder_company: form.builder.builder_company.trim() || null,
          builder_email: form.builder.builder_email.trim() || null,
          builder_phone: form.builder.builder_phone.trim() || null,
        },
        fieldLabel: 'Project Settings',
      });

      // 2. BP-anchored per-permit fields (DA stays per-permit). Skip if no
      // BP or no change. ENT/DM are project-level defaults now; per-permit
      // overrides happen in the Permits section below.
      if (bpPermit && bpPermit.updated_at && form.bpRole.da !== (bpPermit.da ?? '')) {
        await updatePermit.mutateAsync({
          permitId: bpPermit.id,
          projectId: project.id,
          expectedUpdatedAt: bpPermit.updated_at,
          patch: {
            da: form.bpRole.da.trim() || null,
          },
          fieldLabel: 'Building Permit DA',
        });
      }

      // 4. Per-permit updates / creates / deletes.
      for (const row of form.permits) {
        if (row.isDeleted) {
          if (!row.isNew && row.id != null && row.updated_at) {
            await deletePermit.mutateAsync({
              permitId: row.id,
              projectId: project.id,
              expectedUpdatedAt: row.updated_at,
            });
          }
          continue;
        }
        if (row.isNew) {
          await createPermit.mutateAsync({
            projectId: project.id,
            type: row.type,
            patch: {
              ent_lead: row.ent_lead.trim() || null,
              da: row.da.trim() || null,
              portal_url: row.portal_url.trim() || null,
              num: row.num.trim() || null,
              struct_address: row.struct_address.trim() || null,
            },
          });
          continue;
        }
        if (row.id != null && row.updated_at) {
          // Skip the BP — its core site fields are already handled in step 3,
          // but the BP can also be in this list with its per-permit fields
          // (type/ent_lead/da/portal_url/num/struct_address). Patch those too.
          await updatePermit.mutateAsync({
            permitId: row.id,
            projectId: project.id,
            expectedUpdatedAt: row.updated_at,
            patch: {
              type: row.type,
              ent_lead: row.ent_lead.trim() || null,
              da: row.da.trim() || null,
              portal_url: row.portal_url.trim() || null,
              num: row.num.trim() || null,
              struct_address: row.struct_address.trim() || null,
            },
            fieldLabel: row.type || 'Permit',
          });
        }
      }

      pushToast('Project settings saved.', 'success');
      onClose();
    } catch {
      // individual hooks already toasted.
    } finally {
      setSaving(false);
    }
  }

  const jurisdictions = jurisdictionsQ.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      data-testid="project-settings-modal"
    >
      <div
        className="rounded-lg shadow-xl w-[720px] max-h-[90vh] overflow-hidden flex flex-col"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-4 py-2 border-b flex items-center justify-between"
          style={{
            background: 'var(--color-s2)',
            borderBottomColor: 'var(--color-border)',
          }}
        >
          <span className="text-[12px] font-extrabold uppercase tracking-wider text-text">
            Project Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
          <Section title="Project Info" color="var(--color-jv)">
            <Field label="Project Address" full>
              <Input value={form.address} onChange={(v) => set('address', v)} testid="psm-address" />
            </Field>
            <Field label="Jurisdiction">
              {/* fix-23d: native &lt;select&gt; (was &lt;input list&gt;+&lt;datalist&gt;)
                  — click on the caret now opens a real menu. The "none"
                  option lets users clear the jurisdiction without typing. */}
              <SelectInput
                value={form.juris}
                onChange={(v) => set('juris', v)}
                options={['', ...jurisdictions.map((j) => j.name)]}
                placeholderLabel="— none —"
                testid="psm-juris"
              />
            </Field>
            <Field label="GO Date">
              <Input
                type="date"
                value={form.projectFields.go_date}
                onChange={(v) => setProj('go_date', v)}
                testid="psm-go"
              />
            </Field>
            <Field label="Entitlement Lead">
              <SelectInput
                value={form.projectFields.entitlement_lead}
                onChange={(v) => setProj('entitlement_lead', v)}
                options={['', ...entMembers.map((m) => m.name)]}
                placeholderLabel="— none —"
                testid="psm-ent"
              />
            </Field>
            <Field label="Design Manager">
              <SelectInput
                value={form.projectFields.design_manager}
                onChange={(v) => setProj('design_manager', v)}
                options={['', ...dmMembers.map((m) => m.name)]}
                placeholderLabel="— none —"
                testid="psm-dm"
              />
            </Field>
            <Field label="Unit Count">
              <Input
                type="number"
                value={form.projectFields.units}
                onChange={(v) => setProj('units', v)}
                testid="psm-units"
              />
            </Field>
            <Field label="Zone">
              <Input
                value={form.projectFields.zone}
                onChange={(v) => setProj('zone', v)}
                testid="psm-zone"
              />
            </Field>
            <Field label="Lot Size (W × D, ft)">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={form.projectFields.lot_width}
                  onChange={(e) => setProj('lot_width', e.target.value)}
                  className={inputCls}
                  style={{ ...inputStyle, width: 70 }}
                  placeholder="W"
                  data-testid="psm-lotw"
                />
                <span style={{ color: 'var(--color-dim)' }}>×</span>
                <input
                  type="number"
                  value={form.projectFields.lot_depth}
                  onChange={(e) => setProj('lot_depth', e.target.value)}
                  className={inputCls}
                  style={{ ...inputStyle, width: 70 }}
                  placeholder="D"
                  data-testid="psm-lotd"
                />
              </div>
            </Field>
            <Field label="Parking Type">
              <SelectInput
                value={form.projectFields.parking_type}
                onChange={(v) => setProj('parking_type', v)}
                options={PARKING_OPTIONS}
                placeholderLabel="— unknown —"
                testid="psm-parking-type"
              />
            </Field>
            <Field label="Parking Stalls">
              <Input
                type="number"
                value={form.projectFields.parking_stalls}
                onChange={(v) => setProj('parking_stalls', v)}
                testid="psm-parking-stalls"
              />
            </Field>
            <Field label="Alley">
              <SelectInput
                value={form.projectFields.alley}
                onChange={(v) => setProj('alley', v)}
                options={ALLEY_OPTIONS}
                placeholderLabel="— unknown —"
                testid="psm-alley"
              />
            </Field>
            <Field label="BP Design Associate">
              <SelectInput
                value={form.bpRole.da}
                onChange={(v) => setBpRole('da', v)}
                options={['', ...daMembers.map((m) => m.name)]}
                placeholderLabel="— none —"
                testid="psm-da"
              />
            </Field>
            <Field label="Acquisitions">
              {/* fix-23d: acq + acq_lead collapse to ONE selector. Per Bobby
                  both role values represent the same person; the data layer
                  cleanup is queued as a fix-23 follow-up. */}
              <SelectInput
                value={form.acq_lead}
                onChange={(v) => set('acq_lead', v)}
                options={['', ...acqMembers.map((m) => m.name)]}
                placeholderLabel="— none —"
                testid="psm-acq"
              />
            </Field>
            <Field label="Product Type">
              <SelectInput
                value={form.projectFields.product_type}
                onChange={(v) => setProj('product_type', v)}
                options={PRODUCT_TYPES}
                placeholderLabel="— select type —"
                testid="psm-product-type"
              />
            </Field>
            <Field label="Notes" full>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
                style={inputStyle}
                data-testid="psm-notes"
              />
            </Field>
            <Field label="" full>
              <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.archived}
                  onChange={(e) => set('archived', e.target.checked)}
                  data-testid="psm-archived"
                />
                <span>Archived (hide from active project lists)</span>
              </label>
            </Field>
          </Section>

          <Section title="Builder / Owner" color="var(--color-co)">
            <Field label="Builder Name">
              <Input
                value={form.builder.builder_name}
                onChange={(v) => setBuilderField('builder_name', v)}
                testid="psm-builder-name"
              />
            </Field>
            <Field label="Company">
              <Input
                value={form.builder.builder_company}
                onChange={(v) => setBuilderField('builder_company', v)}
                testid="psm-builder-co"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.builder.builder_email}
                onChange={(v) => setBuilderField('builder_email', v)}
                testid="psm-builder-email"
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.builder.builder_phone}
                onChange={(v) => setBuilderField('builder_phone', v)}
                testid="psm-builder-phone"
              />
            </Field>
          </Section>

          <Section title="Permits" color="var(--color-de)">
            <div className="flex flex-col gap-2 w-full">
              {form.permits.filter((p) => !p.isDeleted).length === 0 && (
                <div className="text-[11px] text-dim italic">No permits yet.</div>
              )}
              {form.permits.map((row, idx) =>
                row.isDeleted ? null : (
                  <PermitSubsection
                    key={row.id ?? `new-${idx}`}
                    row={row}
                    daOptions={daMembers.map((m) => m.name)}
                    entOptions={entMembers.map((m) => m.name)}
                    onChange={(patch) => setPermitField(idx, patch)}
                    onRemove={() => removePermit(idx)}
                  />
                ),
              )}
              <button
                type="button"
                onClick={addPermit}
                className="w-full py-2 rounded border text-[11px] cursor-pointer"
                style={{
                  borderStyle: 'dashed',
                  borderColor: 'var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-dim)',
                }}
                data-testid="psm-add-permit"
              >
                + Add Permit Type
              </button>
            </div>
          </Section>
        </div>

        <footer
          className="px-4 py-2 border-t flex items-center justify-end gap-2"
          style={{
            background: 'var(--color-s2)',
            borderTopColor: 'var(--color-border)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-pm)',
              background: 'var(--color-pm)',
              color: 'white',
            }}
            data-testid="psm-save"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-2 py-1 text-[12px] border rounded';
const inputStyle = {
  background: 'var(--color-surface)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
} as const;

function Section({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: 'var(--color-s2)' }}
    >
      <div
        className="text-[10px] font-bold uppercase tracking-wider mb-2"
        style={{ color }}
      >
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      {label ? (
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--color-dim)' }}
        >
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = 'text',
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  testid?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
      style={inputStyle}
      data-testid={testid}
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
  placeholderLabel,
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholderLabel: string;
  testid?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
      style={inputStyle}
      data-testid={testid}
    >
      {options.map((o) =>
        o === '' ? (
          <option key="__empty" value="">
            {placeholderLabel}
          </option>
        ) : (
          <option key={o} value={o}>
            {o}
          </option>
        ),
      )}
    </select>
  );
}

function PermitSubsection({
  row,
  daOptions,
  entOptions,
  onChange,
  onRemove,
}: {
  row: PermitRow;
  daOptions: string[];
  entOptions: string[];
  onChange: (patch: Partial<PermitRow>) => void;
  onRemove: () => void;
}) {
  // fix-23d: V1 cohesive layout — ONE outer card per permit, three internal
  // rows. Replaces the prior 7-column single-row grid that wrapped weirdly
  // at modal width and gave the visual impression of three glued widgets.
  //
  //   ┌─ Permit ───────────────────── X ─┐
  //   │  Type   ENT   DA                │
  //   │  Permit Portal URL              │
  //   │  Permit #   Structure Address   │
  //   └─────────────────────────────────┘
  //
  // ENT + DA become real <select>s (was <input list>+<datalist>). Type
  // stays a free input because the per-permit type values aren't strictly
  // constrained to the catalog at this surface.
  return (
    <div
      className="rounded border p-3 flex flex-col gap-2 relative"
      style={{
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
      }}
      data-testid={`psm-permit-row-${row.id ?? 'new'}`}
    >
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 h-[20px] w-[20px] text-[12px] rounded border flex items-center justify-center"
        style={{
          borderColor: '#7f1d1d',
          color: '#f87171',
          background: 'transparent',
        }}
        title="Remove permit"
      >
        ✕
      </button>

      <div
        className="grid gap-2 items-end pr-7"
        style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
      >
        <TinyField label="Type">
          <Input value={row.type} onChange={(v) => onChange({ type: v })} />
        </TinyField>
        <TinyField label="ENT">
          <SelectInput
            value={row.ent_lead}
            onChange={(v) => onChange({ ent_lead: v })}
            options={['', ...entOptions]}
            placeholderLabel="— none —"
          />
        </TinyField>
        <TinyField label="DA">
          <SelectInput
            value={row.da}
            onChange={(v) => onChange({ da: v })}
            options={['', ...daOptions]}
            placeholderLabel="— none —"
          />
        </TinyField>
      </div>

      <TinyField label="Permit Portal URL">
        <Input
          value={row.portal_url}
          onChange={(v) => onChange({ portal_url: v })}
        />
      </TinyField>

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        <TinyField label="Permit # (from city)">
          <Input value={row.num} onChange={(v) => onChange({ num: v })} />
        </TinyField>
        <TinyField label="Structure Address">
          <Input
            value={row.struct_address}
            onChange={(v) => onChange({ struct_address: v })}
          />
        </TinyField>
      </div>
    </div>
  );
}

function TinyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className="text-[8px] font-bold uppercase tracking-wide truncate"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
