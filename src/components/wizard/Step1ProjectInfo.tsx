import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import {
  daHasRoutingFor,
  useDaTeamRouting,
} from '../../hooks/useDaTeamRouting';
import UnitTypesEditor from './UnitTypesEditor';
import BuilderAutocompleteField from '../builder/BuilderAutocompleteField';
import { memberLabel, isNonActiveMember } from '../../lib/teamMemberLabel';
import { quarterToDateRange, snapToMonday } from '../../lib/dateUtils';
import { useNextAvailableDaSlot } from '../../hooks/useNextAvailableDaSlot';
import {
  ALLEY_OPTIONS,
  PARKING_TYPE_OPTIONS,
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


const ACQ_ROLES = new Set(['acq', 'acq_lead']);
// fix-144: default DD duration for the redesign auto-place suggestion — matches
// bp_create_project_with_permits' c_default_duration_days so the suggested slot
// lines up with what the server would place.
const REDESIGN_DD_DURATION_DAYS = 26;

/** Filter team_members by role set, then dedupe by name so the legacy/lead
 *  role drift in the schema doesn't double-list anyone. fix-143: when
 *  includeInactive is true (backfill mode) the active-only filter is dropped so
 *  inactive + former members can be assigned to historical projects. */
function membersByRoles(
  all: TeamMember[],
  roles: Set<string>,
  includeInactive: boolean,
): TeamMember[] {
  const seen = new Set<string>();
  const out: TeamMember[] = [];
  for (const m of all) {
    if (!roles.has(m.role)) continue;
    if (!includeInactive && m.active === false) continue;
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
  // fix-91: settings-managed product type catalog. Same shape as
  // projectTagOptions; AdminProjectsTab edits this key.
  const productTypeOptions = useMemo(
    () => readAppConfigStringArray(appConfig.map, 'productTypeOptions'),
    [appConfig.map],
  );

  // fix-143: when backfill mode is on the role pickers open to inactive +
  // former staff so a historical project can be assigned to them.
  const backfillMode = value.backfill_mode;
  const acqs = useMemo(
    () => membersByRoles(teamAll, ACQ_ROLES, backfillMode),
    [teamAll, backfillMode],
  );
  // fix-96-c: project-level Lead DA picker. Mirrors Step 3's per-permit
  // DA picker: same DA roster, same juris-aware routing filter (unrouted DAs
  // render disabled). Optional — keep the wizard friction-free for projects
  // that haven't been assigned a DA yet.
  // fix-143: in backfill mode include inactive/former DAs and drop the routing
  // gate (historical DAs usually have no da_team_routing rows; the point of
  // backfill is to assign to them anyway).
  const routingQ = useDaTeamRouting();
  const routingRows = routingQ.data ?? [];
  const daMembers = useMemo(() => {
    const seen = new Set<string>();
    const out: TeamMember[] = [];
    for (const m of teamAll) {
      if (m.role !== 'da') continue;
      if (!backfillMode && m.active === false) continue;
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push(m);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [teamAll, backfillMode]);
  const routedDaSet = useMemo(() => {
    const set = new Set<string>();
    for (const m of daMembers) {
      if (daHasRoutingFor(m.name, value.juris || null, routingRows)) {
        set.add(m.name);
      }
    }
    return set;
  }, [daMembers, routingRows, value.juris]);

  // fix-143: tenure warning. When backfill mode is on and a lead DA with a
  // tenure window is picked, warn (don't block) if either entered DD date falls
  // outside that window. quarterToDateRange turns 'YYYY-Qn' into ISO bounds.
  const leadDaMember = useMemo(
    () =>
      teamAll.find((m) => m.role === 'da' && m.name === value.lead_da) ?? null,
    [teamAll, value.lead_da],
  );
  const tenureWarning = useMemo(() => {
    if (!backfillMode || !leadDaMember || !value.lead_da) return null;
    const startQ = leadDaMember.active_start_quarter;
    const endQ = leadDaMember.active_end_quarter;
    const startRange = quarterToDateRange(startQ);
    const endRange = quarterToDateRange(endQ);
    if (!startRange && !endRange) return null;
    const outside = (d: string): boolean => {
      if (!d) return false;
      if (startRange && d < startRange.start) return true;
      if (endRange && d > endRange.end) return true;
      return false;
    };
    if (!outside(value.backfill_dd_start) && !outside(value.backfill_dd_end)) {
      return null;
    }
    const window =
      startQ && endQ
        ? `${startQ}–${endQ}`
        : startQ
          ? `${startQ} onward`
          : `ended ${endQ}`;
    return { name: leadDaMember.name, window };
  }, [
    backfillMode,
    leadDaMember,
    value.lead_da,
    value.backfill_dd_start,
    value.backfill_dd_end,
  ]);

  // fix-144: redesign DD phase. When a redesign reuses the original permit the
  // wizard must create a draw_schedule lane for the redesign project (the
  // reuses-permit flow skips permit + lane creation otherwise). Auto-place mode
  // suggests the next open slot on the picked DA's lane; manual mode — and
  // backfill mode, which forces manual — lets the user type the dates.
  // fix-158: the Redesign DD Phase section (DA + dates + auto/manual placement)
  // drives the draw_schedule lane for EVERY redesign — the reuses branch (no
  // permits) and the own-permits branch alike. Pre-fix-158 it only rendered for
  // reuses=yes, so an own-permits redesign got no DA picker and no lane.
  const redesignAutoPlace =
    !!value.redesign_of_project_id &&
    !!value.redesign_dd_da &&
    !value.redesign_dd_manual_dates &&
    !backfillMode;
  const redesignSlotQ = useNextAvailableDaSlot(
    value.redesign_dd_da,
    REDESIGN_DD_DURATION_DAYS,
    redesignAutoPlace,
  );
  // Sync the suggested slot into wizard state so submit sends it (the inputs
  // render read-only in auto mode). Guarded so it only writes on a real change.
  useEffect(() => {
    if (!redesignAutoPlace) return;
    const slot = redesignSlotQ.data;
    if (!slot) return;
    const start = snapToMonday(slot.slotStart, 'forward'); // defensive re-snap
    const end = slot.slotEnd; // already Friday post-fix-141
    const patch: Partial<WizardState> = {};
    if (start && start !== value.redesign_dd_start) patch.redesign_dd_start = start;
    if (end && end !== value.redesign_dd_end) patch.redesign_dd_end = end;
    if (Object.keys(patch).length > 0) onChange(patch);
  }, [
    redesignAutoPlace,
    redesignSlotQ.data,
    value.redesign_dd_start,
    value.redesign_dd_end,
    onChange,
  ]);

  // fix-152: in redesign mode the GO Date means "trigger date" (when this
  // redesign entity became a GO). Default it to today ONCE when redesign mode
  // is active and no date is set yet — never re-write, so a user edit (or the
  // seed) is never clobbered. (eslint-disable: intentionally fires only on the
  // isRedesign transition, not on every go_date keystroke.)
  useEffect(() => {
    if (value.redesign_of_project_id && value.go_date === '') {
      onChange({ go_date: new Date().toISOString().slice(0, 10) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.redesign_of_project_id]);

  // fix-144: tenure warning for the redesign DD DA — mirrors the backfill one.
  const redesignDdDaMember = useMemo(
    () =>
      teamAll.find((m) => m.role === 'da' && m.name === value.redesign_dd_da) ??
      null,
    [teamAll, value.redesign_dd_da],
  );
  const redesignDdTenureWarning = useMemo(() => {
    if (!backfillMode || !redesignDdDaMember || !value.redesign_dd_da) return null;
    const startQ = redesignDdDaMember.active_start_quarter;
    const endQ = redesignDdDaMember.active_end_quarter;
    const startRange = quarterToDateRange(startQ);
    const endRange = quarterToDateRange(endQ);
    if (!startRange && !endRange) return null;
    const outside = (d: string): boolean => {
      if (!d) return false;
      if (startRange && d < startRange.start) return true;
      if (endRange && d > endRange.end) return true;
      return false;
    };
    if (
      !outside(value.redesign_dd_start) &&
      !outside(value.redesign_dd_end)
    ) {
      return null;
    }
    const window =
      startQ && endQ
        ? `${startQ}–${endQ}`
        : startQ
          ? `${startQ} onward`
          : `ended ${endQ}`;
    return { name: redesignDdDaMember.name, window };
  }, [
    backfillMode,
    redesignDdDaMember,
    value.redesign_dd_da,
    value.redesign_dd_start,
    value.redesign_dd_end,
  ]);

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
      // fix-175: carry the entity address across — POC is per-project, so
      // picking a builder never touches poc_name/poc_email.
      builder_address: b.address ?? '',
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
  // fix-91: identical pattern to project_tags. Stored values not in the
  // option list still render so admins curating the option catalog can't
  // accidentally wipe historical project type assignments.
  function addProductType(t: string) {
    const v = t.trim();
    if (!v) return;
    if (value.product_types.includes(v)) return;
    set('product_types', [...value.product_types, v]);
  }
  function removeProductType(t: string) {
    set(
      'product_types',
      value.product_types.filter((x) => x !== t),
    );
  }

  // fix-126: redesign mode is gated on redesign_of_project_id being non-empty.
  // The wizard is opened that way from ProjectDetail's "Spawn Redesign"
  // button (which uses makeRedesignWizardState to seed the form).
  const isRedesign = !!value.redesign_of_project_id;

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

      {/* fix-126: redesign header. Shows "Redesigning [original address] →"
          at the top of Step 1 so the user has a clear visual cue that
          they're not creating a fresh project. */}
      {isRedesign && (
        <div
          className="text-[12px] font-bold px-3 py-2 rounded-md border"
          style={{
            background: 'var(--color-co-bg)',
            borderColor: 'var(--color-co-border)',
            color: 'var(--color-co)',
          }}
          data-testid="wizard-redesign-header"
        >
          Redesigning{' '}
          <span data-testid="wizard-redesign-header-original">
            {value.redesign_of_project_address || '(unknown original)'}
          </span>{' '}
          →
        </div>
      )}

      {/* fix-143: Backfill historical project toggle. Top of Step 1 so it's
          the first decision — flipping it opens the role pickers to inactive +
          former staff and swaps auto-placement for manual DD dates. */}
      <label
        className="flex items-start gap-2 px-3 py-2 rounded-md border border-border bg-bg/40 cursor-pointer"
        data-testid="wizard-backfill-mode-toggle-label"
      >
        <input
          type="checkbox"
          checked={value.backfill_mode}
          onChange={(e) => set('backfill_mode', e.target.checked)}
          className="mt-0.5"
          data-testid="wizard-backfill-mode-toggle"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[12px] font-semibold text-text">
            Backfill historical project
          </span>
          <span className="text-[10px] text-dim">
            Allows assigning to inactive team members and manual DD dates.
          </span>
        </span>
      </label>

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

        {/* fix-91: Entitlement Lead + Design Manager removed from Step 1.
            They're derived on Step 3 from the BP's DA pick (ent_lead via
            bp_ent_lead_for_da; DM via dm_da_groups). Acquisition Lead is
            kept because it isn't derivable.
            fix-96-c: Lead DA added as a project-level role — the BP's
            DA is now set here and shown read-only on Step 3. Other
            permits' DAs stay per-permit on Step 3. */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
              {acqs.map((m) => {
                const nonActive = isNonActiveMember(m);
                return (
                  <option
                    key={m.id}
                    value={m.name}
                    data-testid={
                      nonActive
                        ? `wizard-role-acq_lead-option-inactive-${m.id}`
                        : undefined
                    }
                  >
                    {backfillMode ? memberLabel(m) : m.name}
                  </option>
                );
              })}
            </select>
          </label>
          {/* fix-152: project-level Lead DA hidden in redesign mode — the
              Redesign DD Phase DA (fix-144) is the only DA that matters for a
              reuses-permit redesign, so this picker is duplicative noise. */}
          {!isRedesign && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Lead Design Associate
            </span>
            <select
              value={value.lead_da}
              onChange={(e) => set('lead_da', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-lead-da"
            >
              <option value="">— unassigned —</option>
              {daMembers.map((m) => {
                // fix-143: backfill mode lists inactive/former DAs and skips
                // the routing gate (they rarely have routing rows).
                const disabled = !backfillMode && !routedDaSet.has(m.name);
                const base = backfillMode ? memberLabel(m) : m.name;
                const nonActive = isNonActiveMember(m);
                return (
                  <option
                    key={m.id}
                    value={m.name}
                    disabled={disabled}
                    data-testid={
                      nonActive
                        ? `wizard-role-da-option-inactive-${m.id}`
                        : `wizard-lead-da-opt-${m.name}`
                    }
                    data-routing-disabled={disabled ? 'true' : 'false'}
                  >
                    {disabled ? `${base} (not routed)` : base}
                  </option>
                );
              })}
              {/* Preserve a stored value that's somehow not on the
                  DA roster (e.g. former DA editing an older project —
                  mirrors the ENT row's same self-heal). */}
              {value.lead_da &&
                !daMembers.some((m) => m.name === value.lead_da) && (
                  <option value={value.lead_da}>{value.lead_da}</option>
                )}
            </select>
          </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              {/* fix-152: GO Date = the redesign's trigger date in redesign
                  mode (stored in the same projects.go_date column). */}
              {isRedesign ? 'Redesign GO Date' : 'Go Date'}
            </span>
            <input
              type="date"
              value={value.go_date}
              onChange={(e) => set('go_date', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de"
              data-testid="wizard-go-date"
            />
          </label>
          {/* fix-152: ACQ Target hidden in redesign mode (the redesign's ACQ
              Target is unset; not re-confirmed from parent). */}
          {!isRedesign && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              ACQ Target (BP expected issue)
            </span>
            <input
              type="date"
              value={value.acq_target}
              onChange={(e) => set('acq_target', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de"
              data-testid="wizard-acq-target"
            />
          </label>
          )}
        </div>

        {/* fix-143: manual DD dates — backfill mode only. Auto-placement is
            bypassed because the BP carries explicit dd_start/dd_end (snapped to
            Monday/Friday on submit, matching fix-141). Required once a lead DA
            is picked (validated on submit in NewProjectWizard).
            fix-191: hidden on the redesign path — the original permit already
            had these dates, and the Redesign DD Phase section below is the
            single source for a redesign's DD window. Backfill mode can still be
            toggled on a redesign (to open the role pickers to former staff)
            without resurfacing these redundant top-level inputs. */}
        {backfillMode && !isRedesign && (
          <div
            className="space-y-2"
            data-testid="wizard-backfill-dd-section"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-dim">
                  DD Start (backfill)
                </span>
                <input
                  type="date"
                  value={value.backfill_dd_start}
                  onChange={(e) => set('backfill_dd_start', e.target.value)}
                  className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de"
                  data-testid="wizard-backfill-dd-start"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-dim">
                  DD End (backfill)
                </span>
                <input
                  type="date"
                  value={value.backfill_dd_end}
                  onChange={(e) => set('backfill_dd_end', e.target.value)}
                  className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de"
                  data-testid="wizard-backfill-dd-end"
                />
              </label>
            </div>
            {tenureWarning && (
              <div
                className="text-[11px] px-3 py-2 rounded-md border"
                style={{
                  background: 'var(--color-co-bg)',
                  borderColor: 'var(--color-co-border)',
                  color: 'var(--color-co)',
                }}
                data-testid="wizard-backfill-tenure-warning"
              >
                ⚠ This date falls outside{' '}
                <span className="font-semibold">{tenureWarning.name}</span>'s
                tenure ({tenureWarning.window}). Continue if intended.
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          {/* fix-152: Zone inherited from parent in redesign mode — hidden. */}
          {!isRedesign && (
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
          )}
          <ProductTypesField
            types={value.product_types}
            options={productTypeOptions}
            onAdd={addProductType}
            onRemove={removeProductType}
          />
        </div>

        {/* fix-122: three new project-level physical/closing fields.
            Lives in its own row directly above lot_width/lot_depth so it
            sits beside the other "shape of the site" inputs without
            forcing a re-flow of the existing units/zone/product-types
            grid. Number of Lots is a 1-20 dropdown (Bobby's spec — users
            who need more can edit on Project Overview). Corner Lot is
            tri-state (blank/yes/no) so we don't silently default
            historical projects to "no" on the wire. Closing Date is
            display-only; no math, no cascade.
            fix-152: this whole row (lots / corner / closing) is inherited from
            the parent in redesign mode — hidden. */}
        {!isRedesign && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Number of Lots
            </span>
            <select
              value={value.num_lots}
              onChange={(e) => set('num_lots', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-num-lots"
            >
              <option value="">—</option>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Corner Lot
            </span>
            <select
              value={value.is_corner_lot}
              onChange={(e) => set('is_corner_lot', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-is-corner-lot"
            >
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Closing Date
            </span>
            <input
              type="date"
              value={value.closing_date}
              onChange={(e) => set('closing_date', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de"
              data-testid="wizard-closing-date"
            />
          </label>
        </div>
        )}

        {/* fix-191: a redesign's scope can differ from the original, so keep
            Number of Lots editable on the redesign path (seeded from the
            parent in makeRedesignWizardState). The sibling site-shape fields
            (corner / closing / lot dims / parking) stay inherited-and-hidden;
            only lots + units are user-tunable per Bobby's spec. */}
        {isRedesign && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Number of Lots
            </span>
            <select
              value={value.num_lots}
              onChange={(e) => set('num_lots', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
              data-testid="wizard-num-lots"
            >
              <option value="">—</option>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        )}

        {/* fix-152: lot dimensions + parking are inherited from the parent in
            redesign mode — hidden. */}
        {!isRedesign && (
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
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* fix-152: Alley inherited from parent in redesign mode — hidden.
              Notes stays (a redesign legitimately has its own notes). */}
          {!isRedesign && (
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
          )}
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

        {/* fix-152: Project Tags inherited from parent in redesign mode. */}
        {!isRedesign && (
          <ProjectTagsField
            tags={value.project_tags}
            options={projectTagOptions}
            onAdd={addTag}
            onRemove={removeTag}
          />
        )}
      </section>

      {/* fix-126: Redesign Details — only renders when the wizard is
          opened from a "Spawn Redesign" entry point. Trigger source
          (8-value controlled vocab), reuse-permits tri-state, and
          free-form notes. Reuse=Yes hides Step 3's permit rows in
          favor of a "this redesign reuses the original's permits"
          banner and sends an empty permits array on submit. */}
      {isRedesign && (
        <section
          className="bg-s2/60 rounded-lg p-4 space-y-3"
          data-testid="wizard-section-redesign"
        >
          <div className="text-[10px] uppercase tracking-[0.08em] text-co font-display font-bold">
            Redesign Details
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                Trigger Source <span className="text-co">*</span>
              </span>
              <select
                value={value.redesign_trigger}
                onChange={(e) => set('redesign_trigger', e.target.value)}
                className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
                data-testid="wizard-redesign-trigger"
              >
                <option value="">— pick a trigger —</option>
                <option value="builder">Builder</option>
                <option value="ceo">CEO</option>
                <option value="acquisitions">Acquisitions</option>
                <option value="design_mgmt">Design Mgmt</option>
                <option value="design_associate">Design Associate</option>
                <option value="city_correction">City Correction</option>
                <option value="market">Market</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                Reuses Original Permit
              </span>
              <select
                value={value.redesign_reuses_original_permit}
                onChange={(e) =>
                  set('redesign_reuses_original_permit', e.target.value)
                }
                className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
                data-testid="wizard-redesign-reuses"
              >
                <option value="">—</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Notes
            </span>
            <textarea
              value={value.redesign_notes}
              onChange={(e) => set('redesign_notes', e.target.value)}
              placeholder="What changed and why?"
              rows={2}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-redesign-notes"
            />
          </label>
        </section>
      )}

      {/* fix-144/fix-158: Redesign DD Phase — renders for EVERY redesign. The
          DA + DD window build the redesign project's Draw Schedule lane. The
          reuses branch creates no permits, so this is its ONLY path onto the
          schedule; the own-permits branch (fix-158) also places its lane from
          here, since the BP-based auto/manual path misses non-BP permits and
          redesigns no longer carry a project-level Lead DA (fix-152). */}
      {isRedesign && (
        <section
          className="bg-s2/60 rounded-lg p-4 space-y-3"
          data-testid="wizard-section-redesign-dd"
        >
          <div className="text-[10px] uppercase tracking-[0.08em] text-co font-display font-bold">
            Redesign DD Phase
          </div>
          <div className="text-[10px] text-dim -mt-1">
            Set the DA and DD window for this redesign so it lands on the Draw
            Schedule.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                DA <span className="text-co">*</span>
              </span>
              <select
                value={value.redesign_dd_da}
                onChange={(e) => set('redesign_dd_da', e.target.value)}
                className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
                data-testid="wizard-redesign-dd-da"
              >
                <option value="">— pick a DA —</option>
                {daMembers.map((m) => {
                  const nonActive = isNonActiveMember(m);
                  return (
                    <option
                      key={m.id}
                      value={m.name}
                      data-testid={
                        nonActive
                          ? `wizard-role-da-option-inactive-${m.id}`
                          : undefined
                      }
                    >
                      {backfillMode ? memberLabel(m) : m.name}
                    </option>
                  );
                })}
              </select>
            </label>
            {/* Manual-dates toggle — hidden in backfill mode (manual forced). */}
            {!backfillMode && (
              <label className="flex items-end gap-2 pb-1.5">
                <input
                  type="checkbox"
                  checked={value.redesign_dd_manual_dates}
                  onChange={(e) =>
                    set('redesign_dd_manual_dates', e.target.checked)
                  }
                  data-testid="wizard-redesign-dd-manual-toggle"
                />
                <span className="text-[11px] text-dim">Use manual dates</span>
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                DD Start <span className="text-co">*</span>
              </span>
              <input
                type="date"
                value={value.redesign_dd_start}
                onChange={(e) => set('redesign_dd_start', e.target.value)}
                readOnly={redesignAutoPlace}
                className={`bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de ${
                  redesignAutoPlace ? 'opacity-70' : ''
                }`}
                data-testid="wizard-redesign-dd-start"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-dim">
                DD End <span className="text-co">*</span>
              </span>
              <input
                type="date"
                value={value.redesign_dd_end}
                onChange={(e) => set('redesign_dd_end', e.target.value)}
                readOnly={redesignAutoPlace}
                className={`bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-de ${
                  redesignAutoPlace ? 'opacity-70' : ''
                }`}
                data-testid="wizard-redesign-dd-end"
              />
            </label>
          </div>
          {redesignAutoPlace && (
            <div
              className="text-[10px] text-dim"
              data-testid="wizard-redesign-dd-autoplace-hint"
            >
              Auto-placed at {value.redesign_dd_da}'s next open slot. Toggle
              “Use manual dates” to override.
            </div>
          )}
          {redesignDdTenureWarning && (
            <div
              className="text-[11px] px-3 py-2 rounded-md border"
              style={{
                background: 'var(--color-co-bg)',
                borderColor: 'var(--color-co-border)',
                color: 'var(--color-co)',
              }}
              data-testid="wizard-redesign-dd-tenure-warning"
            >
              ⚠ This date falls outside{' '}
              <span className="font-semibold">
                {redesignDdTenureWarning.name}
              </span>
              's tenure ({redesignDdTenureWarning.window}). Continue if intended.
            </div>
          )}
        </section>
      )}

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
          {/* fix-175: owner LLC address — autofills on pick, saved to the
              builder catalog. Full-width row under the 4-up contact grid. */}
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              LLC Address
            </span>
            <BuilderAutocompleteField
              field="address"
              label="LLC Address"
              value={value.builder_address}
              onChange={(v) => set('builder_address', v)}
              onSelectBuilder={fillFromBuilder}
              placeholder="Owner / LLC mailing address"
              inputClassName="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              testid="wizard-builder-address"
            />
          </label>
        </div>
        {/* fix-175: per-project point-of-contact. NOT a builder catalog
            field — the contact can differ deal-to-deal, so it's plain
            project-level input (no autocomplete). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Point of Contact
            </span>
            <input
              type="text"
              value={value.poc_name}
              onChange={(e) => set('poc_name', e.target.value)}
              placeholder="Contact name"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              data-testid="wizard-poc-name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Contact Email
            </span>
            <input
              type="email"
              value={value.poc_email}
              onChange={(e) => set('poc_email', e.target.value)}
              placeholder="contact@email.com"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de w-full"
              data-testid="wizard-poc-email"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function ProductTypesField({
  types,
  options,
  onAdd,
  onRemove,
}: {
  types: string[];
  options: string[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  // fix-91: settings-managed multi-select. Same shape + mechanics as
  // ProjectTagsField. Stored values not in `options` still render as
  // removable chips so a tenant admin pruning the option catalog
  // doesn't strand historical data.
  const available = options.filter((o) => !types.includes(o));
  return (
    <label
      className="flex flex-col gap-1"
      data-testid="wizard-product-types"
    >
      <span className="text-[10px] uppercase tracking-wide text-dim">
        Product Types
      </span>
      <div className="flex flex-wrap gap-1 mb-1 min-h-[20px]">
        {types.length === 0 ? (
          <span className="text-[11px] text-dim italic">none</span>
        ) : (
          types.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg border border-border text-[11px]"
              data-testid={`wizard-product-type-${t}`}
            >
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                className="text-dim hover:text-text leading-none"
                title="Remove product type"
                data-testid={`wizard-product-type-remove-${t}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onAdd(v);
          e.currentTarget.value = '';
        }}
        disabled={available.length === 0}
        className="bg-bg border border-border rounded-md px-2 py-1 text-[11px] font-mono text-text focus:outline-none focus:border-de disabled:opacity-60"
        data-testid="wizard-product-type-select"
      >
        <option value="">
          {options.length === 0
            ? 'No options — add them in Settings → Projects'
            : available.length === 0
              ? 'All types added'
              : '+ Add type'}
        </option>
        {available.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
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
