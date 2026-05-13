import { useState, useEffect, useMemo } from 'react';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { useCreatePermit } from '../../hooks/useCreatePermit';
import { useDeletePermit } from '../../hooks/useDeletePermit';
import { useBuilders, useUpsertBuilder } from '../../hooks/useBuilders';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { usePermitsByProject } from '../../hooks/usePermitsByProject';
import { pushToast } from '../../stores/toastStore';
import type { PermitWithCycles, Project } from '../../lib/database.types';

// Q9.5.f-fix-17 C: full rebuild for v1 parity (index.html:773-850).
// Three sections:
//   1. PROJECT INFO — mixes project-level fields (address / juris / acq_lead /
//      archived / notes / builder_id) with BP-anchored site fields (go_date /
//      ent_lead / dm / da / units / zone / lot_w/d / parking / alley /
//      product_type). v1 stores those site fields on the Building Permit row,
//      so v2 does the same — the BP is the canonical anchor.
//   2. BUILDER / OWNER — edits the builders row that projects.builder_id
//      points to (or upserts a new one).
//   3. PERMITS — repeating block; edit / add / delete permits on the project.
//
// Deferred from v1: PROJECT TAGS (jsonb pill editor) and UNIT TYPES (jsonb
// repeating-row editor). Both need their own sub-components — surfaced as a
// gap to Bobby; the underlying jsonb columns survive untouched on save.

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

interface BpFields {
  go_date: string;
  ent_lead: string;
  dm: string;
  da: string;
  units: string;
  zone: string;
  lot_width: string;
  lot_depth: string;
  parking_type: string;
  parking_stalls: string;
  alley: string;
  product_type: string;
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

interface BuilderFields {
  name: string;
  company: string;
  email: string;
  phone: string;
}

interface FormState {
  address: string;
  juris: string;
  acq_lead: string;
  notes: string;
  archived: boolean;
  builder_id: string;
  builder: BuilderFields;
  bp: BpFields;
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
  builderRow: { name?: string | null; company?: string | null; email?: string | null; phone?: string | null } | null,
): FormState {
  const bp = permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  return {
    address: project.address ?? '',
    juris: project.juris ?? '',
    acq_lead: project.acq_lead ?? '',
    notes: project.notes ?? '',
    archived: !!project.archived,
    builder_id: project.builder_id ?? '',
    builder: {
      name: builderRow?.name ?? '',
      company: builderRow?.company ?? '',
      email: builderRow?.email ?? '',
      phone: builderRow?.phone ?? '',
    },
    bp: {
      go_date: bp?.go_date ?? '',
      ent_lead: bp?.ent_lead ?? '',
      dm: bp?.dm ?? '',
      da: bp?.da ?? '',
      units: bp?.units != null ? String(bp.units) : '',
      zone: bp?.zone ?? '',
      lot_width: bp?.lot_width != null ? String(bp.lot_width) : '',
      lot_depth: bp?.lot_depth != null ? String(bp.lot_depth) : '',
      parking_type: bp?.parking_type ?? '',
      parking_stalls: bp?.parking_stalls != null ? String(bp.parking_stalls) : '',
      alley: bp?.alley ?? '',
      product_type: bp?.product_type ?? '',
    },
    permits: permits.map(permitToRow),
  };
}

export default function ProjectSettingsModal({ project, onClose }: Props) {
  const permitsQ = usePermitsByProject(project.id);
  const buildersQ = useBuilders();
  const jurisdictionsQ = useJurisdictions();
  const teamQ = useTeamMembers();

  const permits = useMemo(() => permitsQ.data ?? [], [permitsQ.data]);
  const bpPermit = useMemo(
    () => permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null,
    [permits],
  );
  const builderRow = useMemo(
    () => (buildersQ.data ?? []).find((b) => b.id === project.builder_id) ?? null,
    [buildersQ.data, project.builder_id],
  );

  const [form, setForm] = useState<FormState>(() =>
    initForm(project, permits, builderRow),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initForm(project, permits, builderRow));
  }, [project.id, project.updated_at, permits, builderRow]);

  const updateProject = useUpdateProject();
  const updatePermit = useUpdatePermit();
  const createPermit = useCreatePermit();
  const deletePermit = useDeletePermit();
  const upsertBuilder = useUpsertBuilder();

  const team = teamQ.data ?? [];
  const entMembers = team.filter((t) => t.role === 'ent' && t.active !== false);
  const dmMembers = team.filter((t) => t.role === 'dm' && t.active !== false);
  const daMembers = team.filter((t) => t.role === 'da' && t.active !== false);
  const acqMembers = team.filter((t) => t.role === 'acq' && t.active !== false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setBp<K extends keyof BpFields>(key: K, value: BpFields[K]) {
    setForm((f) => ({ ...f, bp: { ...f.bp, [key]: value } }));
  }
  function setBuilderField<K extends keyof BuilderFields>(key: K, value: BuilderFields[K]) {
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
      // 1. Builder upsert (do this first so we have an id for projects.builder_id).
      let builderId = form.builder_id || null;
      const hasBuilderEdit =
        form.builder.name.trim() ||
        form.builder.company.trim() ||
        form.builder.email.trim() ||
        form.builder.phone.trim();
      if (hasBuilderEdit) {
        const saved = await upsertBuilder.mutateAsync({
          id: builderId ?? undefined,
          name: form.builder.name.trim() || form.builder.company.trim() || 'Builder',
          company: form.builder.company.trim() || null,
          email: form.builder.email.trim() || null,
          phone: form.builder.phone.trim() || null,
        });
        builderId = saved.id;
      }

      // 2. Project update.
      await updateProject.mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch: {
          address: form.address.trim(),
          juris: form.juris.trim() || null,
          acq_lead: form.acq_lead.trim() || null,
          notes: form.notes,
          archived: form.archived,
          builder_id: builderId,
        },
        fieldLabel: 'Project Settings',
      });

      // 3. BP-anchored site fields (only if a BP exists and the values changed).
      if (bpPermit && bpPermit.updated_at) {
        await updatePermit.mutateAsync({
          permitId: bpPermit.id,
          projectId: project.id,
          expectedUpdatedAt: bpPermit.updated_at,
          patch: {
            go_date: form.bp.go_date || null,
            ent_lead: form.bp.ent_lead.trim() || null,
            dm: form.bp.dm.trim() || null,
            da: form.bp.da.trim() || null,
            units: toNumOrNull(form.bp.units),
            zone: form.bp.zone.trim() || null,
            lot_width: toNumOrNull(form.bp.lot_width),
            lot_depth: toNumOrNull(form.bp.lot_depth),
            parking_type: form.bp.parking_type || null,
            parking_stalls: toNumOrNull(form.bp.parking_stalls),
            alley: form.bp.alley || null,
            product_type: form.bp.product_type || null,
          },
          fieldLabel: 'Building Permit',
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
        className="rounded-lg shadow-xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col"
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
              <DatalistInput
                value={form.juris}
                onChange={(v) => set('juris', v)}
                listId="psm-juris-options"
                options={jurisdictions.map((j) => j.name)}
                testid="psm-juris"
              />
            </Field>
            <Field label="GO Date">
              <Input type="date" value={form.bp.go_date} onChange={(v) => setBp('go_date', v)} testid="psm-go" />
            </Field>
            <Field label="Entitlement Lead">
              <DatalistInput
                value={form.bp.ent_lead}
                onChange={(v) => setBp('ent_lead', v)}
                listId="psm-ent-options"
                options={entMembers.map((m) => m.name)}
                testid="psm-ent"
              />
            </Field>
            <Field label="Design Manager">
              <DatalistInput
                value={form.bp.dm}
                onChange={(v) => setBp('dm', v)}
                listId="psm-dm-options"
                options={dmMembers.map((m) => m.name)}
                testid="psm-dm"
              />
            </Field>
            <Field label="Unit Count">
              <Input type="number" value={form.bp.units} onChange={(v) => setBp('units', v)} testid="psm-units" />
            </Field>
            <Field label="Zone">
              <Input value={form.bp.zone} onChange={(v) => setBp('zone', v)} testid="psm-zone" />
            </Field>
            <Field label="Lot Size (W × D, ft)">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={form.bp.lot_width}
                  onChange={(e) => setBp('lot_width', e.target.value)}
                  className={inputCls}
                  style={{ ...inputStyle, width: 70 }}
                  placeholder="W"
                  data-testid="psm-lotw"
                />
                <span style={{ color: 'var(--color-dim)' }}>×</span>
                <input
                  type="number"
                  value={form.bp.lot_depth}
                  onChange={(e) => setBp('lot_depth', e.target.value)}
                  className={inputCls}
                  style={{ ...inputStyle, width: 70 }}
                  placeholder="D"
                  data-testid="psm-lotd"
                />
              </div>
            </Field>
            <Field label="Parking Type">
              <SelectInput
                value={form.bp.parking_type}
                onChange={(v) => setBp('parking_type', v)}
                options={PARKING_OPTIONS}
                placeholderLabel="— unknown —"
                testid="psm-parking-type"
              />
            </Field>
            <Field label="Parking Stalls">
              <Input type="number" value={form.bp.parking_stalls} onChange={(v) => setBp('parking_stalls', v)} testid="psm-parking-stalls" />
            </Field>
            <Field label="Alley">
              <SelectInput
                value={form.bp.alley}
                onChange={(v) => setBp('alley', v)}
                options={ALLEY_OPTIONS}
                placeholderLabel="— unknown —"
                testid="psm-alley"
              />
            </Field>
            <Field label="Design Associate">
              <DatalistInput
                value={form.bp.da}
                onChange={(v) => setBp('da', v)}
                listId="psm-da-options"
                options={daMembers.map((m) => m.name)}
                testid="psm-da"
              />
            </Field>
            <Field label="Acquisition Lead">
              <DatalistInput
                value={form.acq_lead}
                onChange={(v) => set('acq_lead', v)}
                listId="psm-acq-options"
                options={acqMembers.map((m) => m.name)}
                testid="psm-acq"
              />
            </Field>
            <Field label="Product Type">
              <SelectInput
                value={form.bp.product_type}
                onChange={(v) => setBp('product_type', v)}
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
              <Input value={form.builder.name} onChange={(v) => setBuilderField('name', v)} testid="psm-builder-name" />
            </Field>
            <Field label="Company">
              <Input value={form.builder.company} onChange={(v) => setBuilderField('company', v)} testid="psm-builder-co" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.builder.email} onChange={(v) => setBuilderField('email', v)} testid="psm-builder-email" />
            </Field>
            <Field label="Phone">
              <Input value={form.builder.phone} onChange={(v) => setBuilderField('phone', v)} testid="psm-builder-phone" />
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

function DatalistInput({
  value,
  onChange,
  listId,
  options,
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  listId: string;
  options: string[];
  testid?: string;
}) {
  return (
    <>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        style={inputStyle}
        data-testid={testid}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
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
  return (
    <div
      className="rounded border p-2 flex flex-col gap-2"
      style={{
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
      }}
      data-testid={`psm-permit-row-${row.id ?? 'new'}`}
    >
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <Field label="Permit Type">
          <Input value={row.type} onChange={(v) => onChange({ type: v })} />
        </Field>
        <div className="flex gap-1">
          <Field label="ENT">
            <DatalistInput
              value={row.ent_lead}
              onChange={(v) => onChange({ ent_lead: v })}
              listId={`psm-permit-ent-${row.id ?? 'new'}`}
              options={entOptions}
            />
          </Field>
          <Field label="DA">
            <DatalistInput
              value={row.da}
              onChange={(v) => onChange({ da: v })}
              listId={`psm-permit-da-${row.id ?? 'new'}`}
              options={daOptions}
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="self-end px-2 py-1 text-[12px] rounded border"
          style={{
            borderColor: '#7f1d1d',
            color: '#f87171',
            background: 'transparent',
          }}
          title="Remove permit"
        >
          ✕
        </button>
      </div>
      <Field label="Permit Portal URL" full>
        <Input value={row.portal_url} onChange={(v) => onChange({ portal_url: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Permit Number">
          <Input value={row.num} onChange={(v) => onChange({ num: v })} />
        </Field>
        <Field label="Structure Address">
          <Input value={row.struct_address} onChange={(v) => onChange({ struct_address: v })} />
        </Field>
      </div>
    </div>
  );
}
