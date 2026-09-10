import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
// ★★★ fix-520 §A: ONE save model. Every project field on this modal commits
// when you leave it, through the path the site/lot/date/unit editors already
// used. The Permits tab is the one exception and says so on screen.
import { useProjectFieldCommit } from '../../hooks/useProjectFieldCommit';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import type { PermitWithCycles, Project } from '../../lib/database.types';
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

// ---------------------------------------------------------------------------
// ★★★ fix-520 §A (P-227) — THE COMMIT-ON-BLUR CONTROLS
// ---------------------------------------------------------------------------
//
// Every field below writes ONE column when you leave it, through
// `useProjectFieldCommit` — the same path Zone, the lots, the dates and the
// unit editors have used since fix-415. What they replace is `ctl.set*`, which
// put the value in a form that only the footer's Save button could flush.
//
// ★★ A TEXT BOX NEEDS A DRAFT AND A SELECT DOES NOT. Typing is a sequence of
//    invalid intermediate states — "5627 44th Ave S" on the way to "SW" — so a
//    text input holds a local draft and commits on blur or Enter. A `<select>`
//    has no intermediate state: choosing IS the commit. fix-73/98's dirty-flag
//    prop sync is what keeps an in-flight draft from being clobbered by the
//    cache refresh the previous field's commit just triggered.

/** A text/number box that commits on blur or Enter, and re-syncs from the
 *  server whenever it is not being typed in. */
function CommitInput({
  value,
  onCommit,
  type = 'text',
  disabled,
  testid,
}: {
  value: string;
  onCommit: (next: string) => void;
  type?: 'text' | 'number' | 'date' | 'email';
  disabled?: boolean;
  testid?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  // ★ fix-73/98: adopt the server's value ONLY while the box is clean. Without
  //   this, a sibling field's commit invalidates `projects` and the refresh
  //   overwrites what is being typed here — which is the same class of defect
  //   fix-519 §B fixed one level up, and per-field saves make it MORE likely
  //   rather than less, because there are now many more refreshes.
  if (!dirty && draft !== value) setDraft(value);

  function commit() {
    setDirty(false);
    if (draft === value) return;
    onCommit(draft);
  }

  return (
    <input
      type={type}
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        setDirty(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
          commit();
        } else if (e.key === 'Escape') {
          setDirty(false);
          setDraft(value);
        }
      }}
      className={inputCls}
      style={inputStyle}
      data-testid={testid}
      data-dirty={dirty ? 'true' : 'false'}
    />
  );
}

/**
 * ★★★ THE TWO FIELDS THE SITE TAB USED TO SHOW READ-ONLY under the caption
 * *"Address and Jurisdiction are part of Project Settings' single atomic save
 * and are read-only here."* That caption, and the button beneath it, are what
 * Bobby called counterintuitive. They are inputs now.
 *
 * ★★★ fix-520 §A: …and they SAVE LIKE EVERY OTHER FIELD ON THE MODAL. They
 *     rode the footer's Save button, which is how a person could type an
 *     address, change the Schematic Designer two tabs over and lose it.
 */
export function SiteIdentityFields({
  project,
  jurisdictionNames,
}: {
  project: Project;
  jurisdictionNames: string[];
}) {
  const { commit, occMissing } = useProjectFieldCommit(project);
  return (
    <FormGrid>
      <Field label="Project Address" full>
        <CommitInput
          value={project.address ?? ''}
          disabled={occMissing}
          onCommit={(v) => {
            // ★★★ fix-520 §A — THE ADDRESS'S GUARD LIVES ON THE ADDRESS NOW.
            //     The atomic save refused a blank one because an empty address
            //     would have gone in with the permits. With a per-field commit
            //     the refusal belongs here, where the person can see the box
            //     they emptied: a blank simply does not commit, and the value
            //     snaps back on the next render.
            if (!v.trim()) return;
            void commit('address', v.trim(), project.address, 'Address');
          }}
          testid="psm-address"
        />
      </Field>
      <Field label="Jurisdiction">
        <SelectInput
          value={project.juris ?? ''}
          onChange={(v) => void commit('juris', v || null, project.juris, 'Jurisdiction')}
          options={['', ...jurisdictionNames]}
          placeholderLabel="— none —"
          disabled={occMissing}
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
 *
 * ★★ fix-520 §A: a date input that commits per keystroke saves `2026-0` on the
 *    way to `2026-09-14`, which is why this is buffered — the rule
 *    `BufferedDateInput` exists for, applied here through `CommitInput`'s
 *    draft.
 */
export function GoDateField({ project }: { project: Project }) {
  const { commit, occMissing } = useProjectFieldCommit(project);
  return (
    <FormGrid>
      <Field label="GO date">
        <CommitInput
          type="date"
          value={project.go_date ?? ''}
          disabled={occMissing}
          onCommit={(v) => void commit('go_date', v || null, project.go_date, 'GO date')}
          testid="psm-go"
        />
      </Field>
    </FormGrid>
  );
}

// ---------------------------------------------------------------------------
// Units — the count and the product types
// ---------------------------------------------------------------------------

/**
 * ★★★ fix-520 §A — THE TWO FIELDS THAT MADE THE UNITS TAB'S CAPTION A LIE.
 *
 * That tab said *"Each field saves as you leave it — there is no Save
 * button"*, and these two rode the button. fix-519's audit read the caption
 * and filed the whole tab as blur-save, which is how a false caption survives
 * a ticket written to find false captions. **It is the tab Cam will live in.**
 */
export function UnitCountAndProductTypes({
  project,
  productTypeOptions,
}: {
  project: Project;
  productTypeOptions: string[];
}) {
  const { commit, occMissing } = useProjectFieldCommit(project);
  const chosen = project.product_types ?? [];
  return (
    <FormGrid>
      <Field label="Unit count">
        <CommitInput
          type="number"
          value={project.units == null ? '' : String(project.units)}
          disabled={occMissing}
          onCommit={(v) => {
            const n = v.trim() === '' ? null : Number(v);
            if (n !== null && !Number.isFinite(n)) return;
            void commit('units', n, project.units, 'Unit count');
          }}
          testid="psm-units"
        />
      </Field>
      <Field label="Types" full>
        {/* fix-91/fix-93: multi-select. Options come from
            app_config.productTypeOptions (Settings → Admin → Project Types);
            stored values no longer in the catalog still render as removable
            chips so pruning the option list never strands historical data.
            ★ fix-520 §A: adding or removing a chip IS the commit — there is
              nothing to leave, so there is no blur to wait for. */}
        <div className="flex flex-wrap items-center gap-1">
          <SelectInput
            value=""
            onChange={(v) => {
              if (!v) return;
              if (chosen.includes(v)) return;
              void commit('product_types', [...chosen, v], null, 'Types');
            }}
            options={['', ...productTypeOptions.filter((t) => !chosen.includes(t))]}
            placeholderLabel={
              productTypeOptions.length === 0
                ? 'No options — add them in Settings → Projects'
                : productTypeOptions.every((t) => chosen.includes(t))
                  ? 'All types added'
                  : '+ Add type'
            }
            disabled={occMissing}
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
                disabled={occMissing}
                onClick={() =>
                  void commit(
                    'product_types',
                    chosen.filter((x) => x !== t),
                    null,
                    'Types',
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
  project,
  bp,
  rosters,
  canReassignDa,
  onReassignSd,
  sdPending,
}: {
  project: Project;
  /** ★ fix-520 §A: the Building Permit, because ONE of these six roles is not
   *  a project column at all — see `BP Design Associate` below. */
  bp: PermitWithCycles | null;
  rosters: {
    acqNames: string[];
    entNames: string[];
    dmNames: string[];
    daNames: string[];
    caNames: string[];
    sdNames: string[];
  };
  canReassignDa: boolean;
  onReassignSd: (name: string | null) => void;
  sdPending: boolean;
}) {
  const { commit, occMissing } = useProjectFieldCommit(project);
  const updatePermit = useUpdatePermit();
  const currentSd = Array.isArray(project.schematic_designer)
    ? (project.schematic_designer.find((n) => !!n && n.trim() !== '') ?? '')
    : '';
  return (
    <FormGrid>
      <Field label="Acquisitions">
        {/* fix-23d: acq + acq_lead collapse to ONE selector. */}
        <SelectInput
          value={project.acq_lead ?? ''}
          onChange={(v) => void commit('acq_lead', v || null, project.acq_lead, 'Acquisitions')}
          options={['', ...rosters.acqNames]}
          placeholderLabel="— none —"
          disabled={occMissing}
          testid="psm-acq"
        />
      </Field>
      <Field label="Entitlement Lead">
        <SelectInput
          value={project.entitlement_lead ?? ''}
          onChange={(v) =>
            void commit('entitlement_lead', v || null, project.entitlement_lead, 'Entitlement Lead')
          }
          options={['', ...rosters.entNames]}
          placeholderLabel="— none —"
          disabled={occMissing}
          testid="psm-ent"
        />
      </Field>
      <Field label="Design Manager">
        <SelectInput
          value={project.design_manager ?? ''}
          onChange={(v) =>
            void commit('design_manager', v || null, project.design_manager, 'Design Manager')
          }
          options={['', ...rosters.dmNames]}
          placeholderLabel="— none —"
          disabled={occMissing}
          testid="psm-dm"
        />
      </Field>
      {/* ★★★ fix-520 §A — THE ONE ROLE ON THIS TAB THAT IS NOT A PROJECT
          COLUMN. `da` lives on the PERMITS row, so this control writes the
          Building Permit through `useUpdatePermit` — the per-field OCC path
          `PermitDetailV2` and `ScheduleEstimator` already use.
          ★★ That mismatch is why it needed the atomic save at all: the form's
             `bpRole.da` was mapped onto a permit upsert inside a project save.
             One field pretending to be a project field is what made a
             six-control tab need two write models. */}
      <Field label="BP Design Associate">
        <SelectInput
          value={bp?.da ?? ''}
          onChange={(v) => {
            if (!bp?.updated_at) return;
            if ((v || null) === (bp.da ?? null)) return;
            void updatePermit.mutateAsync({
              projectId: project.id,
              permitId: bp.id,
              expectedUpdatedAt: bp.updated_at,
              patch: { da: v || null },
              fieldLabel: 'BP Design Associate',
            });
          }}
          options={['', ...rosters.daNames]}
          placeholderLabel="— none —"
          disabled={!bp?.updated_at}
          testid="psm-da"
        />
      </Field>
      {/* ★★★ fix-487 (P-144): changing the Construction Admin CASCADES —
          `projects_cascade_lead` follows it down to the project's UNISSUED
          permits that still name the old person. An ISSUED permit keeps who
          took it through (D-2026-08-28).
          ★★ fix-520 §A: the cascade is a DB TRIGGER, so it fires on a
             single-column write exactly as it did inside the atomic RPC. What
             it no longer has to survive is the client RESTATING the outgoing
             lead in the same transaction, which is the ordering fix-377 and
             fix-382 had to engineer around. A per-field write has nothing to
             restate. */}
      <Field label="Construction Admin">
        <SelectInput
          value={project.construction_admin ?? ''}
          onChange={(v) =>
            void commit(
              'construction_admin',
              v || null,
              project.construction_admin,
              'Construction Admin',
            )
          }
          options={['', ...rosters.caNames]}
          placeholderLabel="— none —"
          disabled={occMissing}
          testid="psm-ca"
        />
      </Field>
      {/* ★★★ fix-344 §1 — IT CALLS THE REASSIGN RPC: one admin-gated
          transaction that moves the field, the open tasks and the co-assignee
          rows together. Folding a task move into a generic field patch would
          make an ordinary field write do something large and invisible.
          ★★★ fix-520 §A: THIS IS NO LONGER AN EXCEPTION TO THE SAVE MODEL. It
              always committed the moment you changed it; what made it an
              exception was that the five roles beside it did not. They do now,
              so the tab has one rule and this control simply does more work
              under it — which is why the hint below says what it moves rather
              than when it saves. */}
      <Field label="Schematic Designer">
        <SelectInput
          value={currentSd}
          onChange={(v) => {
            if (!canReassignDa) return;
            if ((v || null) === (currentSd || null)) return;
            onReassignSd(v || null);
          }}
          options={['', ...rosters.sdNames]}
          placeholderLabel="— none —"
          disabled={!canReassignDa || sdPending}
          testid="psm-sd"
        />
        <p className="text-[9.5px] text-dim mt-0.5" data-testid="psm-sd-hint">
          {canReassignDa
            ? 'Changing this also moves their open tasks on this project.'
            : 'Only a tenant admin can reassign the schematic designer.'}
        </p>
      </Field>
    </FormGrid>
  );
}

// ---------------------------------------------------------------------------
// Builder / Owner
// ---------------------------------------------------------------------------

export function BuilderOwnerFields({ project }: { project: Project }) {
  const { commit, occMissing } = useProjectFieldCommit(project);
  return (
    <div className="flex flex-col gap-3">
      {/* ★★★ fix-448 §B4: the five builder fields are a CACHE of a catalogue
          row shared by every project that builder is on, so they are read-only
          here and picked on the overview. The two below are PER-PROJECT free
          text — "the contact can differ deal-to-deal" — so there is no second
          truth to diverge from. */}
      <div className="text-[11px] space-y-1" data-testid="psm-builder-readonly">
        <ReadOnlyRow label="Builder Name" value={project.builder_name ?? ''} testid="psm-builder-name" />
        <ReadOnlyRow label="Company" value={project.builder_company ?? ''} testid="psm-builder-co" />
        <ReadOnlyRow label="Email" value={project.builder_email ?? ''} testid="psm-builder-email" />
        <ReadOnlyRow label="Phone" value={project.builder_phone ?? ''} testid="psm-builder-phone" />
        <ReadOnlyRow label="LLC Address" value={project.builder_address ?? ''} testid="psm-builder-address" />
        <div className="text-[10px] text-muted pt-1">
          Pick or change the builder on the project overview; edit their details
          in Settings → Lists &amp; Catalogs → Builders &amp; Owners.
        </div>
      </div>
      <FormGrid>
        <Field label="Point of Contact">
          <CommitInput
            value={project.poc_name ?? ''}
            disabled={occMissing}
            onCommit={(v) =>
              void commit('poc_name', v.trim() || null, project.poc_name, 'Point of Contact')
            }
            testid="psm-poc-name"
          />
        </Field>
        <Field label="Contact Email">
          <CommitInput
            type="email"
            value={project.poc_email ?? ''}
            disabled={occMissing}
            onCommit={(v) =>
              void commit('poc_email', v.trim() || null, project.poc_email, 'Contact Email')
            }
            testid="psm-poc-email"
          />
        </Field>
      </FormGrid>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project flags
// ---------------------------------------------------------------------------

export function ProjectFlagFields({ project }: { project: Project }) {
  const { commit, occMissing } = useProjectFieldCommit(project);
  return (
    <div className="flex flex-col gap-2">
      {/* ★ fix-520 §A: a checkbox has no intermediate state, so ticking IS the
          commit — the same rule the product-type chips follow. */}
      <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
        <input
          type="checkbox"
          checked={!!project.archived}
          disabled={occMissing}
          onChange={(e) =>
            void commit('archived', e.target.checked, project.archived, 'Archived')
          }
          data-testid="psm-archived"
        />
        <span>Archived (hide from active project lists)</span>
      </label>
      {/* ★★ fix-386 — correcting the wizard's "Backfill?" answer. It is
          editable because whether a project was backfilled is a FACT about how
          it was entered; it is QUIET because it must not become a lever for
          silencing milestones somebody would rather not look at.
          ★★★ AND `null` IS STILL "NOT RECORDED", not `false`. An unticked box
              on a project that predates the question stays unrecorded until
              somebody ticks it — which is why the commit is guarded on the
              CHECKED value rather than on the box's presence. */}
      <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
        <input
          type="checkbox"
          checked={project.is_backfill === true}
          disabled={occMissing}
          onChange={(e) =>
            void commit('is_backfill', e.target.checked, project.is_backfill, 'Backfilled project')
          }
          data-testid="psm-is-backfill"
        />
        <span>
          Backfilled project (entered with historical dates — its already-past
          milestones are history, not missed deadlines)
        </span>
      </label>
      {project.is_backfill == null && (
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

// ===========================================================================
// ★★★ fix-520 §A — `AtomicZoneField` IS DELETED
// ===========================================================================
//
// It was the zone picker for the atomic form, kept deliberately with a note
// saying it rendered nowhere: *"`bp_update_project_with_permits` still writes
// `zone` from this form's value, so a future tab that needs a draft-model zone
// has the control ready rather than inventing a third one."*
//
// ★★★ THAT SENTENCE IS NO LONGER TRUE. §A empties the atomic save's project
//     patch — it writes permits and nothing else — so this control would put a
//     value into a form field that goes nowhere and report success. **A
//     control kept for a write path that has been removed is worse than no
//     control**, because the next person finds it and wires it up.
//
// ★ Zone is edited by `SiteEditor`'s `ZoneSelect` on the Site data tab, which
//   commits on change through `useUpdateProject` — one editor, and fix-415
//   A5's canonical option list is on it.
