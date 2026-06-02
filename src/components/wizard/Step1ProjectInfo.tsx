import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import UnitTypesEditor from './UnitTypesEditor';
import BuilderAutocompleteField from '../builder/BuilderAutocompleteField';
import {
  ALLEY_OPTIONS,
  PARKING_TYPE_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  unitsIsValid,
  type WizardState,
} from './wizardState';
import type {
  Builder,
  TeamMember,
  UnitType,
} from '../../lib/database.types';

// fix-22 Step 1 — Project Info. Mirrors v1's wizard step 1 layout
// (Blueprint-Dashboard-/index.html lines 1376-1424): two sections in
// one panel — PROJECT INFO and BUILDER / OWNER.
//
// team_members carry both legacy + lead role variants for the same
// person (e.g. Bobby is in as both 'ent' and 'ent_lead'). The dropdowns
// dedupe by name so each person appears once. Listed as fix-23 cleanup
// (collapse to one role-label per person on the schema side).
//
// Treats lot_width / lot_depth of 0 as "missing" per spec known risk #8
// — the input shows empty when the underlying value is 0 so the user is
// prompted to enter the real value next time.

interface Props {
  value: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** fix-88: when true, render required-field errors even if the user
   *  hasn't blurred the field yet. Parent flips this after a submit
   *  attempt fails on a step-1 field so the visual lines up with the
   *  banner that just appeared at the top of the wizard. */
  showFieldErrors?: boolean;
}


const ENT_ROLES = new Set(['ent', 'ent_lead']);
const ACQ_ROLES = new Set(['acq', 'acq_lead']);
const DM_ROLES = new Set(['dm']);

/** Filter active team_members by role set, then dedupe by name so the
 *  legacy/lead role drift in the schema doesn't double-list anyone. */
function activeMembersByRoles(
  all: TeamMember[],
  roles: Set<string>,
): TeamMember[] {
  const seen = new Set<string>();
  const out: TeamMember[] = [];
  for (const m of all) {
    if (!roles.has(m.role)) continue;
    if (m.active === false) continue;
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    out.push(m);
  }
  return out;
}

export default function Step1ProjectInfo({
  value,
  onChange,
  showFieldErrors = false,
}: Props) {
  // fix-88: track first blur on Units so the red error visual only kicks
  // in after the user has interacted with the field (don't yell on a
  // fresh form mid-typing). showFieldErrors overrides this for the
  // post-submit-attempt case.
  const [unitsBlurred, setUnitsBlurred] = useState(false);
  const unitsBad =
    (unitsBlurred || showFieldErrors) && !unitsIsValid(value.units);
  const jurisQ = useJurisdictions();
  const teamQ = useTeamMembers();
  const appConfig = useAppConfig();

  const jurisOptions = jurisQ.data ?? [];
  const teamAll = teamQ.all ?? [];
  // fix-75: Project Tags now picks from the tenant-managed projectTagOptions
  // app_config key (same source AdminProjectsTab edits). Free-form entry is
  // gone; existing stored values not in the option list still render as
  // removable chips so a tenant adding/removing options doesn't blow away
  // historical data.
  const projectTagOptions = useMemo(
    () => readAppConfigStringArray(appConfig.map, 'projectTagOptions'),
    [appConfig.map],
  );

  const ents = useMemo(
    () => activeMembersByRoles(teamAll, ENT_ROLES),
    [teamAll],
  );
  const acqs = useMemo(
    () => activeMembersByRoles(teamAll, ACQ_ROLES),
    [teamAll],
  );
  const dms = useMemo(
    () => activeMembersByRoles(teamAll, DM_ROLES),
    [teamAll],
  );

  function set<K extends keyof WizardState>(k: K, v: WizardState[K]) {
    onChange({ [k]: v } as Partial<WizardState>);
  }

  // Treat 0 as missing for legacy numerics so the user re-enters real values.
  function numStr(v: string): string {
    return v === '0' || v === '0.00' ? '' : v;
  }

  /** fix-23f: shared "user picked an existing builder" handler. Each of
   *  the four BuilderAutocompleteFields wires this to onSelectBuilder so
   *  picking any suggestion fills all four sibling fields in one shot. */
  function fillFromBuilder(b: Builder) {
    onChange({
      builder_name: b.name ?? '',
      builder_company: b.company ?? '',
      builder_email: b.email ?? '',
      builder_phone: b.phone ?? '',
    });
  }

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (value.project_tags.includes(t)) return;
    set('project_tags', [...value.project_tags, t]);
  }
  function removeTag(tag: string) {
    set(
      'project_tags',
      value.project_tags.filter((x) => x !== tag),
    );
  }

  return (
    <div className="space-y-4" data-testid="wizard-step-1">
      {jurisOptions.length === 0 && !jurisQ.isLoading && (
        <div className="text-[12px] text-co bg-co-bg/40 border border-co-border rounded-md px-3 py-2">
          No jurisdictions in the catalog yet.{' '}
          <Link to="/settings" className="underline font-semibold">
            Add one in Settings → Projects
          </Link>
          .
        </div>
      )}

      {/* Project Info section — v1 parity (BG s2 panel, jv-coloured label) */}
      <section
        className="bg-s2/60 rounded-lg p-4 space-y-3"
        data-testid="wizard-section-project-info"
      >
        <div className="text-[10px] uppercase tracking-[0.08em] text-jv font-display font-bold">
          Project Info
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Project Address <span className="text-co">*</span>
            </span>
            <input
              type="text"
              value={value.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="123 Maple St, Seattle WA"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-address"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Jurisdiction <span className="text-co">*</span>
            </span>
            <select
              value={value.juris}
              onChange={(e) => set('juris', e.target.value)}
              disabled={jurisQ.isLoading}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-juris"
            >
              <option value="">— Select —</option>
              {jurisOptions.map((j) => (
                <option key={j.name} value={j.name}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Entitlement Lead <span className="text-co">*</span>
            </span>
            <select
              value={value.entitlement_lead}
              onChange={(e) => set('entitlement_lead', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-entitlement-lead"
            >
              <option value="">— unassigned —</option>
              {ents.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Design Manager
            </span>
            <select
              value={value.design_manager}
              onChange={(e) => set('design_manager', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-design-manager"
            >
              <option value="">— unassigned —</option>
              {dms.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Acquisition Lead
            </span>
            <select
              value={value.acq_lead}
              onChange={(e) => set('acq_lead', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-acq-lead"
            >
              <option value="">— unassigned —</option>
              {acqs.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Go Date
            </span>
            <input
              type="date"
              value={value.go_date}
              onChange={(e) => set('go_date', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de"
              data-testid="wizard-go-date"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Unit Count <span className="text-co">*</span>
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={value.units}
              onChange={(e) => set('units', e.target.value)}
              onBlur={() => setUnitsBlurred(true)}
              placeholder="e.g. 2"
              aria-invalid={unitsBad || undefined}
              className={`bg-bg border rounded-md px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim focus:outline-none ${
                unitsBad
                  ? 'border-co focus:border-co'
                  : 'border-border focus:border-de'
              }`}
              data-testid="wizard-units"
              data-units-error={unitsBad ? 'true' : 'false'}
            />
            {unitsBad && (
              <span
                className="text-[10px] text-co"
                data-testid="wizard-units-error"
              >
                Units count is required (must be greater than 0)
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Zone
            </span>
            <input
              type="text"
              value={value.zone}
              onChange={(e) => set('zone', e.target.value)}
              placeholder="e.g. RSL, LR2, MR"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-zone"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Product Type
            </span>
            <select
              value={value.product_type}
              onChange={(e) => set('product_type', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-product-type"
            >
              <option value="">— select type —</option>
              {PRODUCT_TYPE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Lot Width (ft)
            </span>
            <input
              type="number"
              step="0.5"
              value={numStr(value.lot_width)}
              onChange={(e) => set('lot_width', e.target.value)}
              placeholder="W"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-lot-width"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Lot Depth (ft)
            </span>
            <input
              type="number"
              step="0.5"
              value={numStr(value.lot_depth)}
              onChange={(e) => set('lot_depth', e.target.value)}
              placeholder="D"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-lot-depth"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Parking Type
            </span>
            <select
              value={value.parking_type}
              onChange={(e) => set('parking_type', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-parking-type"
            >
              <option value="">— unknown —</option>
              {PARKING_TYPE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Parking Stalls
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={value.parking_stalls}
              onChange={(e) => set('parking_stalls', e.target.value)}
              placeholder="e.g. 4"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-parking-stalls"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Alley
            </span>
            <select
              value={value.alley}
              onChange={(e) => set('alley', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-alley"
            >
              <option value="">— unknown —</option>
              {ALLEY_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Notes (optional)
            </span>
            <textarea
              value={value.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de resize-none"
              data-testid="wizard-notes"
            />
          </label>
        </div>

        <UnitTypesEditor
          value={value.unit_types}
          onChange={(next: UnitType[]) => set('unit_types', next)}
        />

        <ProjectTagsField
          tags={value.project_tags}
          options={projectTagOptions}
          onAdd={addTag}
          onRemove={removeTag}
        />
      </section>

      {/* Builder / Owner section — fix-22-final adds the v1 panel.
          fix-23f wires the 4 fields to BuilderAutocompleteField so a
          partial match in ANY of name/company/email/phone surfaces
          existing builders; picking one fills all four siblings. */}
      <section
        className="bg-s2/60 rounded-lg p-4 space-y-3"
        data-testid="wizard-section-builder"
      >
        <div className="text-[10px] uppercase tracking-[0.08em] text-co font-display font-bold">
          Builder / Owner
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Builder Name
            </span>
            <BuilderAutocompleteField
              field="name"
              label="Builder Name"
              value={value.builder_name}
              onChange={(v) => set('builder_name', v)}
              onSelectBuilder={fillFromBuilder}
              placeholder="Full name"
              inputClassName="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              testid="wizard-builder-name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Company
            </span>
            <BuilderAutocompleteField
              field="company"
              label="Company"
              value={value.builder_company}
              onChange={(v) => set('builder_company', v)}
              onSelectBuilder={fillFromBuilder}
              placeholder="Company name"
              inputClassName="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              testid="wizard-builder-company"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Email
            </span>
            <BuilderAutocompleteField
              field="email"
              label="Email"
              value={value.builder_email}
              onChange={(v) => set('builder_email', v)}
              onSelectBuilder={fillFromBuilder}
              placeholder="builder@email.com"
              inputClassName="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              testid="wizard-builder-email"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Phone
            </span>
            <BuilderAutocompleteField
              field="phone"
              label="Phone"
              value={value.builder_phone}
              onChange={(v) => set('builder_phone', v)}
              onSelectBuilder={fillFromBuilder}
              placeholder="(206) 555-0100"
              inputClassName="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              testid="wizard-builder-phone"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function ProjectTagsField({
  tags,
  options,
  onAdd,
  onRemove,
}: {
  tags: string[];
  options: string[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  // fix-75: pick from the tenant-managed projectTagOptions (Settings →
  // Projects). Already-applied tags are filtered out of the dropdown so the
  // user can't add a duplicate. Stored values not in `options` still render
  // above as removable chips — that lets admins curate the option list
  // without nuking historical project tags.
  const available = options.filter((o) => !tags.includes(o));
  return (
    <div data-testid="wizard-project-tags">
      <div className="text-[10px] uppercase tracking-wide text-dim mb-1.5">
        Project Tags
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {tags.length === 0 ? (
          <span className="text-[11px] text-dim italic">No tags yet.</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg border border-border text-[11px]"
              data-testid={`wizard-tag-${t}`}
            >
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                className="text-dim hover:text-text leading-none"
                title="Remove tag"
                data-testid={`wizard-tag-remove-${t}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <select
        // Reset to the placeholder option after each pick so the user can
        // add another tag without re-opening the dropdown twice.
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onAdd(v);
          e.currentTarget.value = '';
        }}
        disabled={available.length === 0}
        className="bg-bg border border-border rounded-md px-2 py-1 text-[11px] font-mono text-text focus:outline-none focus:border-de w-full md:w-72 disabled:opacity-60"
        data-testid="wizard-tag-select"
      >
        <option value="">
          {options.length === 0
            ? 'No tag options — add them in Settings → Projects'
            : available.length === 0
              ? 'All tags added'
              : '+ Add tag'}
        </option>
        {available.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
