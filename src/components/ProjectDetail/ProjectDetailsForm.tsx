import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import ZoneSelect from '../shared/ZoneSelect';
import type { ProjectDetailsFormController } from '../../hooks/useProjectDetailsForm';
import type { PermitRow } from '../../lib/projectDetailsForm';

// ===========================================================================
// ★★★ fix-514 §A (P-191) — WHAT `ProjectSettingsModal` USED TO RENDER
// ===========================================================================
//
// Bobby, 2026-09-09: *"a lot of it says 'Open in Project Settings to make the
// update', and that is counterintuitive… all merged under one house into
// **Project Details**, and anything that was editable in the previous one needs
// to be editable here. So there's no more Project Settings."*
//
// ★★★ THE FIELDS ARE MOVED, NOT REBUILT. Every control below is the one the
//     deleted modal had — same `<select>`, same options list, same testid
//     prefix (`psm-`) so the assertions that already prove their behaviour keep
//     proving it. What changed is which container renders them and which tab
//     they sit on; a rewrite would have been a second write path for eighteen
//     fields at once, which is fix-415's defect class.
//
// ★★ THE `psm-` TESTIDS ARE KEPT ON PURPOSE. They read as a leftover from a
//    file that no longer exists, and renaming them would have been a
//    hundred-line diff whose only effect is to break every test that currently
//    guards the fields being moved. The prefix is a name, not a claim.
//
// ★ THIS FILE EXPORTS COMPONENTS AND NOTHING ELSE —
//   `react-refresh/only-export-components` is an ERROR in this repo. The form
//   state lives in `hooks/useProjectDetailsForm`, its types in
//   `lib/projectDetailsForm`.

const inputCls = 'w-full px-2 py-1 text-[12px] border rounded';
const inputStyle = {
  background: 'var(--color-surface)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
} as const;

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: ReactNode;
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
  optionLabels,
  placeholderLabel,
  testid,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** ★ fix-517 §E: an option whose VALUE is an id needs a readable face.
   *  Absent for every other select on this form, which shows its values. */
  optionLabels?: Record<string, string>;
  placeholderLabel: string;
  testid?: string;
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
            {optionLabels?.[o] ?? o}
          </option>
        ),
      )}
    </select>
  );
}

function TinyField({ label, children }: { label: string; children: ReactNode }) {
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

function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>;
}

/** ★ fix-448 §B4: one cached builder field, displayed. */
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

// ---------------------------------------------------------------------------
// Site data — Address and Jurisdiction
// ---------------------------------------------------------------------------

/**
 * ★★★ THE TWO FIELDS THE SITE TAB USED TO SHOW READ-ONLY under the caption
 * *"Address and Jurisdiction are part of Project Settings' single atomic save
 * and are read-only here."* That caption, and the button beneath it, are what
 * Bobby called counterintuitive. They are inputs now.
 */
export function SiteIdentityFields({ ctl }: { ctl: ProjectDetailsFormController }) {
  return (
    <FormGrid>
      <Field label="Project Address" full>
        <Input
          value={ctl.form.address}
          onChange={(v) => ctl.set('address', v)}
          testid="psm-address"
        />
      </Field>
      <Field label="Jurisdiction">
        <SelectInput
          value={ctl.form.juris}
          onChange={(v) => ctl.set('juris', v)}
          options={['', ...ctl.jurisdictionNames]}
          placeholderLabel="— none —"
          testid="psm-juris"
        />
      </Field>
    </FormGrid>
  );
}

// ---------------------------------------------------------------------------
// Dates — the GO date
// ---------------------------------------------------------------------------

/**
 * ★★★ THE GO DATE. `KeyDatesSection` printed it read-only with the title
 * *"GO date is set on the Project Settings page"* — a tooltip naming a page
 * that no longer exists. It is the third of the three candidates Target
 * Approval maxes over (fix-508 §D), so it is edited beside the other dates.
 */
export function GoDateField({ ctl }: { ctl: ProjectDetailsFormController }) {
  return (
    <FormGrid>
      <Field label="GO date">
        <Input
          type="date"
          value={ctl.form.projectFields.go_date}
          onChange={(v) => ctl.setProj('go_date', v)}
          testid="psm-go"
        />
      </Field>
    </FormGrid>
  );
}

// ---------------------------------------------------------------------------
// Units — the count and the product types
// ---------------------------------------------------------------------------

export function UnitCountAndProductTypes({
  ctl,
}: {
  ctl: ProjectDetailsFormController;
}) {
  const { product_types: chosen } = ctl.form.projectFields;
  return (
    <FormGrid>
      <Field label="Unit count">
        <Input
          type="number"
          value={ctl.form.projectFields.units}
          onChange={(v) => ctl.setProj('units', v)}
          testid="psm-units"
        />
      </Field>
      <Field label="Product types" full>
        {/* fix-91/fix-93: multi-select. Options come from
            app_config.productTypeOptions (Settings → Admin → Project Types);
            stored values no longer in the catalog still render as removable
            chips so pruning the option list never strands historical data. */}
        <div className="flex flex-wrap items-center gap-1">
          <SelectInput
            value=""
            onChange={(v) => {
              if (!v) return;
              if (chosen.includes(v)) return;
              ctl.setProj('product_types', [...chosen, v]);
            }}
            options={['', ...ctl.productTypeOptions.filter((t) => !chosen.includes(t))]}
            placeholderLabel={
              ctl.productTypeOptions.length === 0
                ? 'No options — add them in Settings → Projects'
                : ctl.productTypeOptions.every((t) => chosen.includes(t))
                  ? 'All types added'
                  : '+ Add type'
            }
            testid="psm-product-types-select"
          />
          {chosen.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-bg border border-border"
              data-testid={`psm-product-type-chip-${t}`}
            >
              {t}
              <button
                type="button"
                onClick={() =>
                  ctl.setProj(
                    'product_types',
                    chosen.filter((x) => x !== t),
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
    </FormGrid>
  );
}

// ---------------------------------------------------------------------------
// Internal team
// ---------------------------------------------------------------------------

export function InternalTeamFields({
  ctl,
  canReassignDa,
  onReassignSd,
  sdPending,
}: {
  ctl: ProjectDetailsFormController;
  canReassignDa: boolean;
  onReassignSd: (name: string | null) => void;
  sdPending: boolean;
}) {
  return (
    <FormGrid>
      <Field label="Acquisitions">
        {/* fix-23d: acq + acq_lead collapse to ONE selector. */}
        <SelectInput
          value={ctl.form.acq_lead}
          onChange={(v) => ctl.set('acq_lead', v)}
          options={['', ...ctl.acqNames]}
          placeholderLabel="— none —"
          testid="psm-acq"
        />
      </Field>
      <Field label="Entitlement Lead">
        <SelectInput
          value={ctl.form.projectFields.entitlement_lead}
          onChange={(v) => ctl.setProj('entitlement_lead', v)}
          options={['', ...ctl.entNames]}
          placeholderLabel="— none —"
          testid="psm-ent"
        />
      </Field>
      <Field label="Design Manager">
        <SelectInput
          value={ctl.form.projectFields.design_manager}
          onChange={(v) => ctl.setProj('design_manager', v)}
          options={['', ...ctl.dmNames]}
          placeholderLabel="— none —"
          testid="psm-dm"
        />
      </Field>
      <Field label="BP Design Associate">
        <SelectInput
          value={ctl.form.bpRole.da}
          onChange={(v) => ctl.setBpRole('da', v)}
          options={['', ...ctl.daNames]}
          placeholderLabel="— none —"
          testid="psm-da"
        />
      </Field>
      {/* ★★★ fix-487 (P-144): changing the Construction Admin CASCADES —
          `projects_cascade_lead` follows it down to the project's UNISSUED
          permits that still name the old person. An ISSUED permit keeps who
          took it through (D-2026-08-28). */}
      <Field label="Construction Admin">
        <SelectInput
          value={ctl.form.projectFields.construction_admin}
          onChange={(v) => ctl.setProj('construction_admin', v)}
          options={['', ...ctl.caNames]}
          placeholderLabel="— none —"
          testid="psm-ca"
        />
      </Field>
      {/* ★★★ fix-344 §1 — IT IS NOT PART OF THE SAVE. Changing it calls the
          reassign RPC immediately: one admin-gated transaction that moves the
          field, the open tasks and the co-assignee rows together. Folding a
          task move into a generic field patch would make an ordinary Save do
          something large and invisible. */}
      <Field label="Schematic Designer">
        <SelectInput
          value={ctl.currentSd}
          onChange={(v) => {
            if (!canReassignDa) return;
            if ((v || null) === (ctl.currentSd || null)) return;
            onReassignSd(v || null);
          }}
          options={['', ...ctl.sdNames]}
          placeholderLabel="— none —"
          disabled={!canReassignDa || sdPending}
          testid="psm-sd"
        />
        <p className="text-[9.5px] text-dim mt-0.5" data-testid="psm-sd-hint">
          {canReassignDa
            ? 'Changing this also moves their open tasks on this project — and saves immediately.'
            : 'Only a tenant admin can reassign the schematic designer.'}
        </p>
      </Field>
    </FormGrid>
  );
}

// ---------------------------------------------------------------------------
// Builder / Owner
// ---------------------------------------------------------------------------

export function BuilderOwnerFields({ ctl }: { ctl: ProjectDetailsFormController }) {
  return (
    <div className="flex flex-col gap-3">
      {/* ★★★ fix-448 §B4: the five builder fields are a CACHE of a catalogue
          row shared by every project that builder is on, so they are read-only
          here and picked on the overview. The two below are PER-PROJECT free
          text — "the contact can differ deal-to-deal" — so there is no second
          truth to diverge from. */}
      <div className="text-[11px] space-y-1" data-testid="psm-builder-readonly">
        <ReadOnlyRow label="Builder Name" value={ctl.form.builder.builder_name} testid="psm-builder-name" />
        <ReadOnlyRow label="Company" value={ctl.form.builder.builder_company} testid="psm-builder-co" />
        <ReadOnlyRow label="Email" value={ctl.form.builder.builder_email} testid="psm-builder-email" />
        <ReadOnlyRow label="Phone" value={ctl.form.builder.builder_phone} testid="psm-builder-phone" />
        <ReadOnlyRow label="LLC Address" value={ctl.form.builder.builder_address} testid="psm-builder-address" />
        <div className="text-[10px] text-muted pt-1">
          Pick or change the builder on the project overview; edit their details
          in Settings → Lists &amp; Catalogs → Builders &amp; Owners.
        </div>
      </div>
      <FormGrid>
        <Field label="Point of Contact">
          <Input
            value={ctl.form.projectFields.poc_name}
            onChange={(v) => ctl.setProj('poc_name', v)}
            testid="psm-poc-name"
          />
        </Field>
        <Field label="Contact Email">
          <Input
            type="email"
            value={ctl.form.projectFields.poc_email}
            onChange={(v) => ctl.setProj('poc_email', v)}
            testid="psm-poc-email"
          />
        </Field>
      </FormGrid>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions — the two flags
// ---------------------------------------------------------------------------

export function ProjectFlagFields({ ctl }: { ctl: ProjectDetailsFormController }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
        <input
          type="checkbox"
          checked={ctl.form.archived}
          onChange={(e) => ctl.set('archived', e.target.checked)}
          data-testid="psm-archived"
        />
        <span>Archived (hide from active project lists)</span>
      </label>
      {/* ★★ fix-386 — correcting the wizard's "Backfill?" answer. It is
          editable because whether a project was backfilled is a FACT about how
          it was entered; it is QUIET because it must not become a lever for
          silencing milestones somebody would rather not look at. */}
      <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
        <input
          type="checkbox"
          checked={ctl.form.is_backfill === true}
          onChange={(e) => ctl.set('is_backfill', e.target.checked)}
          data-testid="psm-is-backfill"
        />
        <span>
          Backfilled project (entered with historical dates — its already-past
          milestones are history, not missed deadlines)
        </span>
      </label>
      {ctl.form.is_backfill === null && (
        <div className="text-[10px] text-dim italic mt-0.5">
          Not recorded — this project predates the question. Leaving it unticked
          keeps it that way.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permits — the ninth tab
// ---------------------------------------------------------------------------

function PermitRowCard({
  row,
  daOptions,
  entOptions,
  typeOptions,
  parentOptions,
  onChange,
  onRemove,
}: {
  row: PermitRow;
  daOptions: string[];
  entOptions: string[];
  typeOptions: string[];
  /** ★ fix-517 §E: this project's other saved, non-sub permits. */
  parentOptions: { value: string; label: string }[];
  onChange: (patch: Partial<PermitRow>) => void;
  onRemove: () => void;
}) {
  const parentLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of parentOptions) m[o.value] = o.label;
    return m;
  }, [parentOptions]);
  // fix-25-feat-d: a row carrying a legacy / custom type not in the catalog
  // surfaces it as the first option so the user can keep it or replace it.
  const typeOptionsWithLegacy = useMemo(() => {
    if (row.type && !typeOptions.includes(row.type)) return ['', row.type, ...typeOptions];
    return ['', ...typeOptions];
  }, [typeOptions, row.type]);

  return (
    <div
      className="rounded border p-3 flex flex-col gap-2 relative"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      data-testid={`psm-permit-row-${row.id ?? 'new'}`}
    >
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 h-[20px] w-[20px] text-[12px] rounded border flex items-center justify-center"
        style={{ borderColor: '#7f1d1d', color: '#f87171', background: 'transparent' }}
        title="Remove permit"
      >
        ✕
      </button>

      <div className="grid gap-2 items-end pr-7" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
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

      <div className="grid gap-2 items-end" style={{ gridTemplateColumns: '1fr 2fr 1.5fr' }}>
        {/* fix-36: no per-permit "Target Submit" — it is engine-owned
            (bp_recompute_target_submits) and this form must not write it. */}
        <TinyField label="Permit # (from city)">
          <Input value={row.num} onChange={(v) => onChange({ num: v })} />
        </TinyField>
        <TinyField label="Permit Portal URL">
          <Input value={row.portal_url} onChange={(v) => onChange({ portal_url: v })} />
        </TinyField>
        <TinyField label="Structure Address">
          <Input
            value={row.struct_address}
            onChange={(v) => onChange({ struct_address: v })}
          />
        </TinyField>
      </div>

      {/* ★★★ fix-514 §G (P-221) — THE ACQ DATE, ON THE ROW IT BELONGS TO.
          This is the field fix-513 §E could not move, because Project Data
          could only ever address the Building Permit. 153 non-BP permits on
          105 projects carry a different one, by design — a ULS is seeded at
          `bp_acq + 120` days — and they had exactly one editor in the app.
          Now they have this, and `PermitDetailV2`'s box is gone. */}
      <div className="grid gap-2 items-end" style={{ gridTemplateColumns: '1fr 2fr' }}>
        <TinyField label="ACQ target date">
          <Input
            type="date"
            value={row.expected_issue}
            onChange={(v) => onChange({ expected_issue: v })}
            testid={`psm-permit-acq-${row.id ?? 'new'}`}
          />
        </TinyField>
        <div className="text-[9.5px] text-dim self-center">
          One of the three dates Target Approval takes the latest of — with the
          closing date and the GO date plus six months. Clearing it falls back
          to those.
        </div>
      </div>

      {/* ★★★ fix-517 §E — `Sub-permit of`, THE FIELD THAT CAME WITH THE
          DELETED QUICK EDIT MODAL.

          fix-194: a permit with `parent_permit_id` set is a placeholder
          REVIEWED UNDER its parent — it has no review stage of its own and is
          excluded from Schedule Health, corrections counts, reviewer rollups,
          on-track % and volume attribution. **3 of 685 prod permits are
          sub-permits.** Cheap, and §E is explicit that it must not be dropped
          silently: without an editor a mis-linked placeholder would be
          permanently uncounted with no way back.

          ★★ THE CANDIDATE LIST IS fix-194's, UNCHANGED: this project's OTHER
             saved permits that are not themselves sub-permits — no self-link,
             no two-level chains, and (because this form only ever holds one
             project's rows) no cross-project parent, which the rest of the app
             does not model.

          ★ ONLY ON A SAVED ROW. A permit that has not been written yet has no
            id for anything to point at, and cannot be a parent either. */}
      {!row.isNew && row.id != null && (
        <div className="grid gap-2 items-end" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <TinyField label="Sub-permit of">
            <SelectInput
              value={row.parent_permit_id}
              onChange={(v) => onChange({ parent_permit_id: v })}
              options={['', ...parentOptions.map((o) => o.value)]}
              optionLabels={parentLabels}
              placeholderLabel="— not a sub-permit —"
              testid={`psm-permit-parent-${row.id}`}
            />
          </TinyField>
          <div className="text-[9.5px] text-dim self-center">
            A sub-permit is reviewed under its parent, so it carries no review
            stage of its own and is left out of Schedule Health and every count.
          </div>
        </div>
      )}
    </div>
  );
}

export function PermitsFormSection({
  ctl,
  focusPermitId,
}: {
  ctl: ProjectDetailsFormController;
  /**
   * ★★★ fix-517 §E — THE PERMIT THE ROW'S ✎ WAS CLICKED ON.
   *
   * The PERMITS table's edit affordance opens this tab through
   * `?data=permits&focus=<id>`, and the point of naming a permit in the URL is
   * that the tab lands ON it. A project with nine permits opens on a form
   * nine cards long, and "it's in there somewhere" is not the same control
   * `QuickEditPermitModal` was.
   */
  focusPermitId?: number | null;
}) {
  const live = ctl.form.permits.filter((p) => !p.isDeleted);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // ★ Runs after commit, so the ref is populated. `block: 'center'` rather
    //   than 'start' because the tab body scrolls inside the modal and a row
    //   pinned to the top edge reads as clipped.
    if (focusPermitId != null) {
      focusRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [focusPermitId]);

  /**
   * ★★★ fix-517 §E — fix-194's CANDIDATE RULE, UNCHANGED.
   *
   * `QuickEditPermitModal` offered *"the project's OTHER permits, minus
   * itself and minus anything that is already a sub-permit"* — no self-link
   * and no two-level chains. Same rule here, read off the FORM rather than
   * the server, so a type edited in one card is reflected in another card's
   * selector before either is saved.
   */
  const parentOptionsFor = useCallback(
    (row: PermitRow) =>
      ctl.form.permits
        .filter(
          (p) =>
            !p.isDeleted &&
            !p.isNew &&
            p.id != null &&
            p.id !== row.id &&
            !p.parent_permit_id.trim(),
        )
        .map((p) => ({
          value: String(p.id),
          label: p.num.trim() ? `${p.type} · ${p.num.trim()}` : `${p.type} · no number yet`,
        })),
    [ctl.form.permits],
  );

  return (
    <div className="flex flex-col gap-2 w-full">
      {live.length === 0 && (
        <div className="text-[11px] text-dim italic">No permits yet.</div>
      )}
      {ctl.form.permits.map((row, idx) =>
        row.isDeleted ? null : (
          <div
            key={row.id ?? `new-${idx}`}
            ref={row.id != null && row.id === focusPermitId ? focusRef : undefined}
            className={
              row.id != null && row.id === focusPermitId ? 'rounded' : undefined
            }
            style={
              row.id != null && row.id === focusPermitId
                ? { boxShadow: '0 0 0 2px var(--color-de)' }
                : undefined
            }
            data-focused={
              row.id != null && row.id === focusPermitId ? 'true' : undefined
            }
            data-testid={`psm-permit-card-${row.id ?? `new-${idx}`}`}
          >
            <PermitRowCard
              row={row}
              daOptions={ctl.daNames}
              entOptions={ctl.entNames}
              typeOptions={ctl.permitTypeNames}
              parentOptions={parentOptionsFor(row)}
              onChange={(patch) => ctl.setPermitField(idx, patch)}
              onRemove={() => ctl.removePermit(idx)}
            />
          </div>
        ),
      )}
      <button
        type="button"
        onClick={ctl.addPermit}
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
  );
}

// ---------------------------------------------------------------------------
// Site data — zone / lot / alley live in ProjectDataEditors' per-field editors,
// but the ATOMIC form still carries them, so this is the one place that says
// which model owns which field.
// ---------------------------------------------------------------------------

/**
 * ★ The zone picker for the atomic form. Rendered nowhere today — Site data's
 * per-field `SiteEditor` owns zone, and two editors for one column is exactly
 * what fix-415 spent a ticket removing. It exists so the shape of the atomic
 * payload stays legible next to the fields it still sends.
 *
 * ★★ NOT DEAD CODE BY ACCIDENT: `bp_update_project_with_permits` still writes
 *    `zone` from this form's value, so a future tab that needs a draft-model
 *    zone has the control ready rather than inventing a third one.
 */
export function AtomicZoneField({ ctl }: { ctl: ProjectDetailsFormController }) {
  return (
    <Field label="Zone">
      <ZoneSelect
        value={ctl.form.projectFields.zone || null}
        onChange={(v) => ctl.setProj('zone', v ?? '')}
        testid="psm-zone"
        className={inputCls}
        style={inputStyle}
      />
    </Field>
  );
}
