import { useState, useEffect, useMemo } from 'react';
import ZoneSelect from '../shared/ZoneSelect';
import { ALLEY_OPTIONS as WIZARD_ALLEY_OPTIONS } from '../wizard/wizardState';
import { roundLotForStorage } from '../../lib/lotDimensions';
import {
  useUpdateProjectWithPermits,
  type PermitUpsertInput,
} from '../../hooks/useUpdateProjectWithPermits';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { usePermitTypes } from '../../hooks/usePermitTypes';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useReassignProjectSd } from '../../hooks/useProjectSdHandoffs';
import { isCurrentMember } from '../../lib/roster';
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
import { ProjectHoldPanel } from './ProjectHold';
import type {
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
  /** ★ fix-331 §4: the page header folded three buttons into one, and these are
   *  the two that moved in here. Both are OPTIONAL and both are callbacks — the
   *  page still owns the single ReassignDaModal and DeleteProjectDialog
   *  instances, so this modal opens neither and duplicates neither. Omitting
   *  them renders the modal exactly as it was before this ticket. */
  onReassignDa?: () => void;
  /** fix-225: Reassign DA is admin-only. Non-admins see the row explaining why
   *  rather than a control that does nothing. */
  canReassignDa?: boolean;
  onDelete?: () => void;
}

// ★ fix-402: PARKING_OPTIONS removed with the fields it fed.
// ★★★ fix-449 §A (P-077) — ALLEY WAS ALREADY A LIST ON ALL THREE SURFACES.
//
// Measured on origin/main: the Overview SITE card uses the SAME `SiteSelectRow`
// with the SAME `['', 'Yes', 'No']` as fix-410's Regular Shape — the very
// control §A1 asked to copy — the wizard is a <select>, and this modal was one
// too. There was no free-text alley input anywhere, which is why prod is clean
// ("No" 116 · "Yes" 82 · NULL 4).
//
// ★★ WHAT WAS ACTUALLY WRONG WAS TWO COPIES OF THE LIST. This file declared
// its own `['', 'Yes', 'No']` while `wizardState` exported `['Yes', 'No']`.
// Two definitions of a two-value vocabulary is precisely the drift P-077 is
// about, so there is one now and the blank stays a rendering concern of each
// control rather than a member of the set.
const ALLEY_OPTIONS = ['', ...WIZARD_ALLEY_OPTIONS];
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

  alley: string;
  /** fix-91: was a single text column, now an array (multi-select). */
  product_types: string[];
  entitlement_lead: string;
  design_manager: string;
  /** ★ fix-487 (P-144): the project's Construction Admin. Steve on every
   *  project by default; this is where he hands one to David. */
  construction_admin: string;
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
  archived: boolean;
  /** ★★ fix-386: the wizard's "Backfill?" answer, correctable here. `null` is
   *  "not recorded" and is what every pre-fix-386 project carries — kept as a
   *  distinct third state so opening the modal on such a project and saving
   *  something else does NOT quietly assert "not a backfill". */
  is_backfill: boolean | null;
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
    archived: !!project.archived,
    is_backfill: project.is_backfill ?? null,
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

      alley: project.alley ?? '',
      product_types: Array.isArray(project.product_types)
        ? project.product_types
        : [],
      entitlement_lead: project.entitlement_lead ?? '',
      construction_admin: project.construction_admin ?? '',
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

/** ★ fix-448 §B4: one cached builder field in the modal, displayed. */
function ReadOnlyRow({
  label,
  value,
  testid,
}: {
  label: string;
  value: string;
  testid: string;
}) {
  const has = value.trim() !== '';
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted w-24 shrink-0">
        {label}
      </span>
      <span
        className="truncate"
        style={{ color: has ? 'var(--color-text)' : 'var(--color-dim)' }}
        data-testid={testid}
      >
        {has ? value : '—'}
      </span>
    </div>
  );
}

export default function ProjectSettingsModal({
  project,
  onClose,
  onSpawnRedesign,
  onReassignDa,
  canReassignDa = false,
  onDelete,
}: Props) {
  const permitsQ = usePermitsByProject(project.id);
  const jurisdictionsQ = useJurisdictions();
  const teamQ = useTeamMembers();
  const reassignSd = useReassignProjectSd();
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
    team.filter((t) => (t.role === 'ent' || t.role === 'ent_lead') && isCurrentMember(t)),
  );
  const dmMembers = team.filter((t) => t.role === 'dm' && isCurrentMember(t));
  // ★ fix-321 #79: assignment pickers offer the CURRENT roster only. The
  // person already stored on the project keeps rendering either way — see the
  // "stored value not in the list" branch each picker already has.
  const daMembers = team.filter((t) => t.role === 'da' && isCurrentMember(t));
  const acqMembers = dedupByName(
    team.filter((t) => (t.role === 'acq' || t.role === 'acq_lead') && isCurrentMember(t)),
  );
  // ★ fix-344 §1: the schematic designer, and the RPC that moves them. The
  // array has only ever held one name (measured), so the picker shows the
  // first — see the field's note.
  const currentSd = Array.isArray(project.schematic_designer)
    ? (project.schematic_designer.find((n) => !!n && n.trim() !== '') ?? '')
    : '';
  // ★ fix-344 §1: the schematic roster, same current-roster rule as the rest.
  const sdMembers = dedupByName(
    team.filter((t) => t.role === 'schematic' && isCurrentMember(t)),
  );
  // ★ fix-487 (P-144): the Construction Admin roster — two people today, Steve
  //   and David. Same current-roster rule as every picker above it.
  const caMembers = dedupByName(
    team.filter((t) => t.role === 'ca' && isCurrentMember(t)),
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
  // ★★★ fix-448 §B4: `setBuilderField` and `fillFromBuilder` are GONE with the
  //     five inputs they served. `fillFromBuilder` is the one worth naming: it
  //     copied a picked builder's five fields into the form and never wrote
  //     `builder_id`, so a pick here produced text with no link — or worse,
  //     text contradicting the link the project already had. Removed rather
  //     than fixed, because the Overview cell is now the one place that picks.
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
        // fix-notes-1: projects.notes is no longer written — the unified
        // notes log (NotesPanel on the overview) is the source of truth.
        // Omitting the key leaves the legacy column untouched.
        archived: form.archived,
        // ★★ fix-386: only sent when there IS an answer. The RPC's patch is
        // key-presence based, so omitting it leaves the column untouched —
        // which is how a "not recorded" null survives an unrelated save.
        ...(form.is_backfill === null ? {} : { is_backfill: form.is_backfill }),
        go_date: form.projectFields.go_date || null,
        units: toNumOrNull(form.projectFields.units),
        zone: form.projectFields.zone.trim() || null,
        // ★ fix-415 B2: rounded on SUBMIT — this modal has no per-field
        //   commit, so the submit IS the commit.
        lot_width: roundLotForStorage(toNumOrNull(form.projectFields.lot_width)),
        lot_depth: roundLotForStorage(toNumOrNull(form.projectFields.lot_depth)),

        alley: form.projectFields.alley || null,
        product_types: form.projectFields.product_types,
        entitlement_lead: form.projectFields.entitlement_lead.trim() || null,
        // ★★ fix-487: `bp_update_project_with_permits` whitelists this key
        //    server-side (the migration patched the function by anchor). The
        //    client patch is untyped, so the RPC's own list is the real gate —
        //    a key it does not know is dropped SILENTLY.
        construction_admin:
          form.projectFields.construction_admin.trim() || null,
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
      // ★★★ fix-440 (P-057) — THE BACKDROP DOES NOTHING, AND NEITHER DOES
      // ESCAPE. Bobby's narrowed ruling, 2026-08-29: of sixteen overlays,
      // only the ones that HOLD UNSAVED INPUT stop closing on an outside
      // click. This one holds a whole draft form behind an explicit Save, so
      // a stray click threw all of it away with no undo and no confirmation.
      // Same decision, same reason, as fix-411 §1 on Add New Project and
      // fix-436's AddPersonDialog. A VIEWER — the plan-of-record lightbox —
      // deliberately keeps click-anywhere-to-close: "this is just stale text".
      // The exits are the × and Cancel, both explicit.
      //
      // ★ Escape was ALREADY inert here — this modal never had a keydown
      //   handler, checked rather than assumed. It stays that way, and the note
      //   is here so nobody "fixes the inconsistency" with QuickEditPermitModal
      //   by adding one.
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
            {/* ★★★ fix-487 (P-144) — THE PROJECT'S CONSTRUCTION ADMIN.
                Bobby: *"Construction admin will always default to Steve, and as
                needed Steve would hand it off to David Rice."* This field IS
                the hand-off, and it is the only place the project-level value
                is editable.

                ★★ CHANGING IT CASCADES. `projects_cascade_lead` follows a
                changed construction_admin down to the project's UNISSUED
                permits that still name the old person — the same rule fix-377
                built for the entitlement lead, and for the same reason. An
                ISSUED permit keeps who took it through
                (D-2026-08-28), which matters more for a CA than for anyone
                else because the job is post-permit-issuance work. */}
            <Field label="Construction Admin">
              <SelectInput
                value={form.projectFields.construction_admin}
                onChange={(v) => setProj('construction_admin', v)}
                options={['', ...caMembers.map((m) => m.name)]}
                placeholderLabel="— none —"
                testid="psm-ca"
              />
            </Field>
            {/* ★★★ fix-344 §1 — THE SCHEMATIC DESIGNER, AND THE MOVE.
                Bobby: "If we added the SD there and then we changed the project
                from one person to another… then it could take all of his tasks
                for that project and move it over."

                ★ SINGLE-SELECT. The column is an array and stays one (changing
                the type was explicitly out of scope), but it has never held more
                than one name — 0 projects with two, 34 with one, 119 with none —
                so a multi-select would be a control for a case that does not
                exist, and the tasks-follow-the-person rule has no answer when
                "the person" is two people.

                ★★ IT IS NOT PART OF THE SAVE. Changing it calls the reassign RPC
                immediately — one admin-gated transaction that moves the field,
                the open tasks and the co-assignee rows together, and records the
                handoff. Folding a task move into a generic field patch would
                make an ordinary Save do something large and invisible. */}
            <Field label="Schematic Designer">
              <SelectInput
                value={currentSd}
                onChange={(v) => {
                  if (!canReassignDa) return;
                  if ((v || null) === (currentSd || null)) return;
                  reassignSd.mutate({ projectId: project.id, toSd: v || null });
                }}
                options={['', ...sdMembers.map((m) => m.name)]}
                placeholderLabel="— none —"
                disabled={!canReassignDa || reassignSd.isPending}
                testid="psm-sd"
              />
              <p className="text-[9.5px] text-dim mt-0.5" data-testid="psm-sd-hint">
                {canReassignDa
                  ? 'Changing this also moves their open tasks on this project — and saves immediately.'
                  : 'Only a tenant admin can reassign the schematic designer.'}
              </p>
            </Field>
            <Field label="Unit Count">
              <Input
                type="number"
                value={form.projectFields.units}
                onChange={(v) => setProj('units', v)}
                testid="psm-units"
              />
            </Field>
            {/* ★ fix-415 A3: dropdown, not free text. This surface writes
                through bp_update_project_with_permits, whose SET list DOES
                carry `zone` — unlike the SITE card, which writes the table
                directly. Two paths, one control. */}
            <Field label="Zone">
              <ZoneSelect
                value={form.projectFields.zone}
                onChange={(v) => setProj('zone', v)}
                testid="psm-zone"
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-de"
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
            {/* ★★ fix-402: the two site-level parking fields are gone —
                parking is a per-UNIT property now (Unit Dimensions on Project
                Overview, or the Library's unit table). The columns are archived
                and cleared; editing them here would write to a dead field. */}
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
            {/* ★★ fix-386 — correcting the wizard's "Backfill?" answer.
                ★ WHY IT IS EDITABLE AT ALL: whether a project was backfilled is
                a FACT about how it was entered, and the person who ticked (or
                forgot to tick) the box is exactly who would need to fix it —
                the same class of edit as a typo'd address. It saves through the
                atomic bp_update_project_with_permits path with everything else,
                so it inherits fix-382's OCC rather than being a side channel.
                ★ WHY IT IS QUIET: it must not become a lever for silencing
                milestones somebody would rather not look at, so it sits in
                Settings with the consequence written beside it, nowhere near
                the board. */}
            <Field label="" full>
              <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_backfill === true}
                  onChange={(e) => set('is_backfill', e.target.checked)}
                  data-testid="psm-is-backfill"
                />
                <span>
                  Backfilled project (entered with historical dates — its
                  already-past milestones are history, not missed deadlines)
                </span>
              </label>
              {form.is_backfill === null && (
                <div className="text-[10px] text-dim italic mt-0.5">
                  Not recorded — this project predates the question. Leaving it
                  unticked keeps it that way.
                </div>
              )}
            </Field>
          </Section>

          {/* fix-167: On Hold — check to put the project on hold (reason +
              optional note + backdatable start), uncheck to lift (end date).
              Independent of the atomic project save below — writes go straight
              through the hold RPCs. Phase 1: data + display only, no math. */}
          <Section title="On Hold" color="var(--color-co)">
            <ProjectHoldPanel projectId={project.id} />
          </Section>

          {/* ★★★ fix-448 §B4 — THIS EDITOR IS GONE, AND IT WAS THE WORSE ONE.
              ============================================================
              fix-23f made these five fields a builder autocomplete: typing any
              of them surfaced catalogue rows and picking one filled all five
              siblings.

              ★★★ BUT `fillFromBuilder` HERE NEVER WROTE `builder_id`. Measured
              on origin/main: the string `builder_id` does not appear anywhere
              in this file. So picking a builder in this modal copied the five
              cache columns and DROPPED THE LINK — and if the project already
              had one, it left that link pointing at a different builder than
              the text now named. This modal did not merely permit P-082's
              divergence, it manufactured it in one click.

              ★★ SO IT DISPLAYS, AND POINTS AT THE TWO PLACES THAT WRITE.
              Bobby's ruling is that the Overview cell is the pick-only way to
              CHANGE which builder a project has, and the Settings registry is
              the one way to change that builder's DETAILS. A third editor is
              how they come apart again.

              ★ The five `form.builder.*` values are still SENT on save,
              unchanged, so the save payload and its OCC behaviour are exactly
              what they were — nothing here can edit them any more, which is
              the whole point. */}
          <Section title="Builder / Owner" color="var(--color-co)">
            <div
              className="text-[11px] space-y-1"
              data-testid="psm-builder-readonly"
            >
              <ReadOnlyRow label="Builder Name" value={form.builder.builder_name} testid="psm-builder-name" />
              <ReadOnlyRow label="Company" value={form.builder.builder_company} testid="psm-builder-co" />
              <ReadOnlyRow label="Email" value={form.builder.builder_email} testid="psm-builder-email" />
              <ReadOnlyRow label="Phone" value={form.builder.builder_phone} testid="psm-builder-phone" />
              <ReadOnlyRow label="LLC Address" value={form.builder.builder_address} testid="psm-builder-address" />
              <div className="text-[10px] text-muted pt-1">
                Pick or change the builder on the project overview; edit their
                details in Settings → Lists &amp; Catalogs → Builders &amp; Owners.
              </div>
            </div>
            {/* ★★★ fix-175's POINT OF CONTACT STAYS EDITABLE, and the
                distinction is the whole reason §B4 is safe. The five builder
                fields above are a CACHE of a catalogue row shared by every
                project that builder is on. These two are PER-PROJECT free text
                — "the contact can differ deal-to-deal" — so there is no second
                truth to diverge from and nothing to route to the registry. */}
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

          {/* ★★★ fix-479 §D (P-132) — THE `External Team` SECTION IS GONE.
              Ruled by Bobby 2026-09-02: the Consultants card is the ONLY place
              a consultant firm is picked. Two editors for one value is how the
              two disagreed; the second one is removed rather than kept in sync.

              ★ `projects.external_team` is NOT abandoned — a firm change in
                Consultants writes it through server-side, inside
                `bp_add_project_consultant` / `bp_set_consultant_firm`, so My
                Tasks → Waiting and the vendor forecast keep resolving the right
                firm. See migrations/fix_479_consultant_firm_write_through.sql.

              ★ `ProjectExternalTeamPanel` went with it — this was its only call
                site. `ExternalFirmSelect`, `useExternalTeamShowRules` and
                `lib/externalTeam` all stay: they are the blob's shared
                vocabulary and the Settings → External Team DIRECTORY editor
                (a different screen, still live) reads from the same place. */}

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

          {/* ★★ fix-331 §4: the two buttons that came out of the page header.
              LAST in the modal, in their own red-bordered section, and outside
              the save flow — nothing about editing a project routes past this.

              ★ Delete is FARTHER from a slip than it was, not nearer. It was a
              single click in the header, immediately beside Settings; it is now
              two deliberate steps and then DeleteProjectDialog, which still
              refuses until the project's address is typed verbatim. The entry
              point moved; the guardrail did not move with it. */}
          {(onReassignDa || onDelete) && (
            <div
              className="rounded-lg p-3"
              style={{
                background: 'var(--color-s2)',
                border: '1px solid #fca5a5',
              }}
              data-testid="psm-danger-zone"
            >
              <div
                className="text-[10px] font-bold uppercase tracking-wider mb-2"
                style={{ color: '#991b1b' }}
              >
                Danger zone
              </div>
              <div className="flex flex-col gap-2.5">
                {onReassignDa && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onReassignDa}
                      disabled={!canReassignDa}
                      className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded border disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                      style={{
                        borderColor: 'var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-text)',
                      }}
                      data-testid="psm-reassign-da"
                      title={
                        canReassignDa
                          ? 'Move ownership to a different DA (the board stays put)'
                          : 'Only a tenant admin can reassign the DA'
                      }
                    >
                      ⇄ Reassign DA
                    </button>
                    <span className="text-[10.5px] text-dim leading-snug">
                      {canReassignDa
                        ? 'Hands the project to another Design Associate. The draw-schedule block stays where it is.'
                        : 'Only a tenant admin can reassign the DA.'}
                    </span>
                  </div>
                )}
                {onDelete && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onDelete}
                      className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide rounded flex-shrink-0"
                      style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                      }}
                      data-testid="psm-delete-project"
                    >
                      🗑 Delete project
                    </button>
                    <span className="text-[10.5px] text-dim leading-snug">
                      Removes the project, its permits, cycles and tasks. You
                      will be asked to type the address to confirm.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
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
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholderLabel: string;
  testid?: string;
  /** ★ fix-344: the SD picker is admin-only, so it can be shown-but-inert. */
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
      style={inputStyle}
      disabled={disabled}
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
