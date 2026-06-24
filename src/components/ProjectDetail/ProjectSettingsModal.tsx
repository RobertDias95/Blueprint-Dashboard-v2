import { useState, useEffect, useMemo } from 'react';
import {
  useUpdateProjectWithPermits,
  type PermitUpsertInput,
} from '../../hooks/useUpdateProjectWithPermits';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { usePermitsByProject } from '../../hooks/usePermitsByProject';
import {
  useAppConfig,
  readAppConfigStringArray,
} from '../../hooks/useAppConfig';
import {
  seedExpectedIssue,
  seedTargetSubmit,
} from '../../lib/permitSeedingDefaults';
import { pushToast } from '../../stores/toastStore';
import BuilderAutocompleteField from '../builder/BuilderAutocompleteField';
import ProjectExternalTeamPanel from './ProjectExternalTeamPanel';
import { ProjectHoldPanel } from './ProjectHold';
import type {
  Builder,
  PermitWithCycles,
  Project,
} from '../../lib/database.types';

// fix-22 Migration 3 sweep: ProjectSettingsModal repointed so the 11
// physical fields + 4 builder fields read/write directly on projects.*
// instead of the BP permit anchor. Per-permit fields (ent_lead, dm, da,
// dual_da, architect, portal_url, num, struct_address) still flow
// through useUpdatePermit for the BP.
//
// Three sections:
//   1. PROJECT INFO — address / juris / acq_lead / archived / notes plus
//      the 11 moved-to-project fields (go_date, units, zone, lot_*,
//      parking_*, alley, product_types, entitlement_lead, design_manager).
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
  /** fix-126: optional callback fired when the user clicks the
   *  "Spawn Redesign" button in the modal footer. Parent (ProjectDetail)
   *  is responsible for closing this modal AND opening the New Project
   *  wizard pre-seeded with redesign state. When omitted the button
   *  doesn't render — preserves the modal's pre-fix-126 shape. */
  onSpawnRedesign?: () => void;
}

const PARKING_OPTIONS = ['', 'None', 'Surface', 'Garage', 'Both'];
const ALLEY_OPTIONS = ['', 'Yes', 'No'];
// fix-93: Product Types options no longer hardcoded. The list is now
// catalog-managed via app_config.productTypeOptions (seeded by
// migrations/fix_91_product_types_array.sql, edited in
// Settings → Admin → Project Types). Step1ProjectInfo reads the same
// key for the wizard's chip picker; this modal mirrors that pattern so
// catalog additions show up in both places.

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
  /** fix-91: was a single text column, now an array (multi-select). */
  product_types: string[];
  entitlement_lead: string;
  design_manager: string;
  /** fix-175: per-project point-of-contact (NOT a builder catalog field). */
  poc_name: string;
  poc_email: string;
}

interface BpRoleFields {
  da: string;
}

interface BuilderFlatFields {
  builder_name: string;
  builder_company: string;
  builder_email: string;
  builder_phone: string;
  /** fix-175: owner LLC address — autofills on pick, saved to the builders
   *  catalog (and projects.builder_address cache) via the update RPC. */
  builder_address: string;
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
      builder_address: project.builder_address ?? '',
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
      product_types: Array.isArray(project.product_types)
        ? project.product_types
        : [],
      entitlement_lead: project.entitlement_lead ?? '',
      design_manager: project.design_manager ?? '',
      poc_name: project.poc_name ?? '',
      poc_email: project.poc_email ?? '',
    },
    bpRole: {
      da: bp?.da ?? '',
    },
    permits: permits.map(permitToRow),
  };
}

export default function ProjectSettingsModal({
  project,
  onClose,
  onSpawnRedesign,
}: Props) {
  const permitsQ = usePermitsByProject(project.id);
  const jurisdictionsQ = useJurisdictions();
  const teamQ = useTeamMembers();
  // fix-25-feat-d: catalog source for the per-permit Type dropdown
  const permitTypesQ = usePermitTypes();
  // fix-93: settings-managed Product Types catalog (parity with the
  // wizard's Step1ProjectInfo). Same key the Library filter + Admin
  // editor consume; values stored on a project but no longer in the
  // catalog still render below as removable chips so admins curating
  // the option list never strand historical data.
  const appConfigQ = useAppConfig();
  const productTypeOptions = useMemo(
    () => readAppConfigStringArray(appConfigQ.map, 'productTypeOptions'),
    [appConfigQ.map],
  );

  const permits = useMemo(() => permitsQ.data ?? [], [permitsQ.data]);
  const bpPermit = useMemo(
    () => permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null,
    [permits],
  );

  const [form, setForm] = useState<FormState>(() => initForm(project, permits));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Project/permits-prop sync: rebuild form drafts on upstream changes.
    // fix-36: never rebuild mid-save — the atomic save's own invalidation +
    // the engine cascade's realtime invalidation must not churn the form (and
    // its OCC tokens) while handleSave is in flight. Belt-and-suspenders even
    // though the single-RPC save removes the multi-write window.
    if (saving) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(initForm(project, permits));
  }, [project.id, project.updated_at, permits, saving]);

  const updateProjectWithPermits = useUpdateProjectWithPermits();

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
  /** fix-23f: shared "user picked an existing builder" handler. Fills
   *  all four sibling fields in one setForm so React batches them into
   *  a single render. */
  function fillFromBuilder(b: Builder) {
    setForm((f) => ({
      ...f,
      builder: {
        builder_name: b.name ?? '',
        builder_company: b.company ?? '',
        builder_email: b.email ?? '',
        builder_phone: b.phone ?? '',
        // fix-175: carry the entity address across (POC stays per-project).
        builder_address: b.address ?? '',
      },
    }));
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
      // fix-36: ONE atomic RPC for the whole save (project + every permit
      // upsert/delete) with per-row OCC checks inside a single transaction.
      // Replaces the old sequential updateProject + per-permit loop that
      // reused modal-open tokens across N round-trips and lost the OCC race
      // to the engine cascade's realtime invalidation.
      const projectPatch = {
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
        product_types: form.projectFields.product_types,
        entitlement_lead: form.projectFields.entitlement_lead.trim() || null,
        design_manager: form.projectFields.design_manager.trim() || null,
        builder_name: form.builder.builder_name.trim() || null,
        builder_company: form.builder.builder_company.trim() || null,
        builder_email: form.builder.builder_email.trim() || null,
        builder_phone: form.builder.builder_phone.trim() || null,
        // fix-175: owner LLC address (-> builders catalog upsert + project
        // cache) + per-project point-of-contact.
        builder_address: form.builder.builder_address.trim() || null,
        poc_name: form.projectFields.poc_name.trim() || null,
        poc_email: form.projectFields.poc_email.trim() || null,
      };

      // The dedicated "BP Design Associate" field (form.bpRole.da) is folded
      // into the BP's permit upsert (the separate step-2 write is gone). When
      // that field was edited it wins; otherwise the BP row's own da is used.
      const bpDaEdited =
        !!bpPermit && form.bpRole.da !== (bpPermit.da ?? '');

      // fix-71: Phase B auto-seed for permits ADDED to an existing project.
      // The New Project wizard pre-fills ACQ Target (expected_issue) + Target
      // Submit per type via permitSeedingDefaults; the add-permit path used to
      // land both NULL. Reuse the SAME rules (single source of truth) so a
      // permit added here seeds identically. Anchors: the project's GO date +
      // the real Building Permit's ACQ (its expected_issue). Only NEW rows are
      // seeded — existing permits' values are never touched here.
      const seedAnchors = {
        goDate: form.projectFields.go_date || null,
        bpAcq:
          permits.find((p) => p.type === 'Building Permit')?.expected_issue ??
          null,
      };

      const permitUpserts: PermitUpsertInput[] = [];
      const permitDeletes: number[] = [];
      for (const row of form.permits) {
        if (row.isDeleted) {
          if (!row.isNew && row.id != null) permitDeletes.push(row.id);
          continue;
        }
        const isBp = bpPermit != null && row.id === bpPermit.id;
        const da = isBp && bpDaEdited ? form.bpRole.da : row.da;
        // target_submit is engine-owned for EXISTING rows — never sent below.
        const fields = {
          type: row.type,
          ent_lead: row.ent_lead.trim() || null,
          da: da.trim() || null,
          portal_url: row.portal_url.trim() || null,
          num: row.num.trim() || null,
          struct_address: row.struct_address.trim() || null,
        };
        if (row.isNew) {
          // Seed only when the type has a rule AND its anchor is set; types
          // without a rule (incl. Building Permit) stay engine-owned/NULL.
          const seededExpected = seedExpectedIssue(row.type, seedAnchors);
          const seededSubmit = seedTargetSubmit(row.type, seedAnchors);
          permitUpserts.push({
            ...fields,
            ...(seededExpected !== null
              ? { expected_issue: seededExpected }
              : {}),
            ...(seededSubmit !== null ? { target_submit: seededSubmit } : {}),
          });
        } else if (row.id != null && row.updated_at) {
          permitUpserts.push({
            id: row.id,
            expected_updated_at: row.updated_at,
            ...fields,
          });
        }
      }

      const result = await updateProjectWithPermits.mutateAsync({
        projectId: project.id,
        projectExpectedUpdatedAt: project.updated_at,
        projectPatch,
        permitUpserts,
        permitDeletes,
      });

      if (result.conflict) {
        // The whole edit rolled back atomically — nothing partial landed.
        pushToast(
          'This project was modified elsewhere — reload and retry.',
          'warn',
        );
        return; // keep the modal open
      }

      pushToast('Project settings saved.', 'success');
      onClose();
    } catch {
      // useUpdateProjectWithPermits already toasted real errors.
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
            <Field label="Product Types">
              {/* fix-91/fix-93: multi-select. Pick adds a chip; chip ×
                  removes. Options come from app_config.productTypeOptions
                  (Settings → Admin → Project Types); stored values no
                  longer in the catalog still render below so pruning
                  the option list doesn't strand historical data. */}
              <div className="flex flex-wrap items-center gap-1">
                <SelectInput
                  value=""
                  onChange={(v) => {
                    if (!v) return;
                    if (form.projectFields.product_types.includes(v)) return;
                    setProj('product_types', [
                      ...form.projectFields.product_types,
                      v,
                    ]);
                  }}
                  options={[
                    '',
                    ...productTypeOptions.filter(
                      (t) => !form.projectFields.product_types.includes(t),
                    ),
                  ]}
                  placeholderLabel={
                    productTypeOptions.length === 0
                      ? 'No options — add them in Settings → Projects'
                      : productTypeOptions.every((t) =>
                            form.projectFields.product_types.includes(t),
                          )
                        ? 'All types added'
                        : '+ Add type'
                  }
                  testid="psm-product-types-select"
                />
                {form.projectFields.product_types.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-bg border border-border"
                    data-testid={`psm-product-type-chip-${t}`}
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() =>
                        setProj(
                          'product_types',
                          form.projectFields.product_types.filter(
                            (x) => x !== t,
                          ),
                        )
                      }
                      className="text-dim hover:text-text leading-none"
                      title={`Remove ${t}`}
                      data-testid={`psm-product-type-remove-${t}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
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

          {/* fix-167: On Hold — check to put the project on hold (reason +
              optional note + backdatable start), uncheck to lift (end date).
              Independent of the atomic project save below — writes go straight
              through the hold RPCs. Phase 1: data + display only, no math. */}
          <Section title="On Hold" color="var(--color-co)">
            <ProjectHoldPanel projectId={project.id} />
          </Section>

          {/* fix-23f: the 4 plain Builder Inputs are now
              BuilderAutocompleteField — typing any of name/company/email/
              phone surfaces existing builders and picking one fills all
              four siblings in one shot. */}
          <Section title="Builder / Owner" color="var(--color-co)">
            <Field label="Builder Name">
              <BuilderAutocompleteField
                field="name"
                label="Builder Name"
                value={form.builder.builder_name}
                onChange={(v) => setBuilderField('builder_name', v)}
                onSelectBuilder={fillFromBuilder}
                inputClassName={inputCls}
                inputStyle={inputStyle}
                testid="psm-builder-name"
              />
            </Field>
            <Field label="Company">
              <BuilderAutocompleteField
                field="company"
                label="Company"
                value={form.builder.builder_company}
                onChange={(v) => setBuilderField('builder_company', v)}
                onSelectBuilder={fillFromBuilder}
                inputClassName={inputCls}
                inputStyle={inputStyle}
                testid="psm-builder-co"
              />
            </Field>
            <Field label="Email">
              <BuilderAutocompleteField
                field="email"
                label="Email"
                value={form.builder.builder_email}
                onChange={(v) => setBuilderField('builder_email', v)}
                onSelectBuilder={fillFromBuilder}
                inputClassName={inputCls}
                inputStyle={inputStyle}
                testid="psm-builder-email"
              />
            </Field>
            <Field label="Phone">
              <BuilderAutocompleteField
                field="phone"
                label="Phone"
                value={form.builder.builder_phone}
                onChange={(v) => setBuilderField('builder_phone', v)}
                onSelectBuilder={fillFromBuilder}
                inputClassName={inputCls}
                inputStyle={inputStyle}
                testid="psm-builder-phone"
              />
            </Field>
            {/* fix-175: owner LLC address — autofills on pick, saved to the
                builders catalog via the update RPC. */}
            <Field label="LLC Address">
              <BuilderAutocompleteField
                field="address"
                label="LLC Address"
                value={form.builder.builder_address}
                onChange={(v) => setBuilderField('builder_address', v)}
                onSelectBuilder={fillFromBuilder}
                inputClassName={inputCls}
                inputStyle={inputStyle}
                testid="psm-builder-address"
              />
            </Field>
            {/* fix-175: per-project point-of-contact. NOT a builder catalog
                field (no autocomplete) — the contact can differ deal-to-deal. */}
            <Field label="Point of Contact">
              <input
                type="text"
                value={form.projectFields.poc_name}
                onChange={(e) => setProj('poc_name', e.target.value)}
                className={inputCls}
                style={inputStyle}
                data-testid="psm-poc-name"
              />
            </Field>
            <Field label="Contact Email">
              <input
                type="email"
                value={form.projectFields.poc_email}
                onChange={(e) => setProj('poc_email', e.target.value)}
                className={inputCls}
                style={inputStyle}
                data-testid="psm-poc-email"
              />
            </Field>
          </Section>

          {/* fix-139 / fix-195: External Team — consultant firms per discipline.
              Reads/writes the projects.external_team blob (the single source —
              fix-197 dropped the old normalized table), independent of the
              atomic project save below. */}
          <Section title="External Team" color="var(--color-pm)">
            <ProjectExternalTeamPanel projectId={project.id} />
          </Section>

          <Section title="Permits" color="var(--color-de)">
            {/* fix-25-feat-e-redo: Section's body is a grid-cols-2 layout;
                without col-span-2 the permits container gets confined to
                half the modal width (the other half stays empty). Each
                permit card should fill the full content area. */}
            <div className="flex flex-col gap-2 w-full col-span-2">
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
                    typeOptions={(permitTypesQ.data ?? []).map((t) => t.name)}
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
          {/* fix-126: Spawn Redesign entry. Left-aligned so it doesn't
              compete visually with Save/Cancel. Renders only when the
              parent passes onSpawnRedesign — keeps the modal's
              pre-fix-126 footer unchanged for any caller that hasn't
              wired the redesign flow yet. */}
          {onSpawnRedesign && (
            <button
              type="button"
              onClick={onSpawnRedesign}
              className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border mr-auto"
              style={{
                borderColor: 'var(--color-co-border)',
                background: 'var(--color-co-bg)',
                color: 'var(--color-co)',
              }}
              data-testid="psm-spawn-redesign"
              title="Open the wizard with this project's site facts prefilled as a redesign"
            >
              + Spawn Redesign
            </button>
          )}
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
  typeOptions,
  onChange,
  onRemove,
}: {
  row: PermitRow;
  daOptions: string[];
  entOptions: string[];
  typeOptions: string[];
  onChange: (patch: Partial<PermitRow>) => void;
  onRemove: () => void;
}) {
  // fix-25-feat-d: Type is now a dropdown sourced from permit_types
  // (catalog). If this row carries a legacy / custom type value not in
  // the catalog, surface it as the first option so the user can keep
  // it or pick a canonical replacement.
  const typeOptionsWithLegacy = useMemo(() => {
    if (row.type && !typeOptions.includes(row.type)) {
      return ['', row.type, ...typeOptions];
    }
    return ['', ...typeOptions];
  }, [typeOptions, row.type]);
  // fix-23d: V1 cohesive layout — ONE outer card per permit. fix-25-feat-e:
  // collapsed the prior 3-row internal stack into 2 rows now that the
  // modal is 960px wide. Portal URL gets 2× the column weight on row 2
  // because that's the only field whose content is routinely long.
  //
  //   ┌─ Permit ─────────────────────────────────────── X ─┐
  //   │  Type      ENT      DA                            │
  //   │  Permit #   Permit Portal URL    Structure Addr   │
  //   └────────────────────────────────────────────────────┘
  //
  // ENT + DA stay <select>s (fix-23d). Type stays a free input because
  // per-permit type values aren't strictly catalog-constrained here.
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
          <SelectInput
            value={row.type}
            onChange={(v) => onChange({ type: v })}
            options={typeOptionsWithLegacy}
            placeholderLabel="— select —"
          />
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

      <div
        className="grid gap-2 items-end"
        style={{ gridTemplateColumns: '1fr 2fr 1.5fr' }}
      >
        {/* fix-36: the per-permit "Target Submit" input was removed — it's
            engine-owned (bp_recompute_target_submits) and the modal must not
            write it. Manual overrides live on the Schedule Estimator. */}
        <TinyField label="Permit # (from city)">
          <Input value={row.num} onChange={(v) => onChange({ num: v })} />
        </TinyField>
        <TinyField label="Permit Portal URL">
          <Input
            value={row.portal_url}
            onChange={(v) => onChange({ portal_url: v })}
          />
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
