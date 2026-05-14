import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import UnitTypesEditor from './UnitTypesEditor';
import {
  ALLEY_OPTIONS,
  PARKING_TYPE_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  type WizardState,
} from './wizardState';
import type { TeamMember, UnitType } from '../../lib/database.types';

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

export default function Step1ProjectInfo({ value, onChange }: Props) {
  const jurisQ = useJurisdictions();
  const teamQ = useTeamMembers();

  const jurisOptions = jurisQ.data ?? [];
  const teamAll = teamQ.all ?? [];

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
              Unit Count
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={value.units}
              onChange={(e) => set('units', e.target.value)}
              placeholder="e.g. 2"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-units"
            />
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
          onAdd={addTag}
          onRemove={removeTag}
        />
      </section>

      {/* Builder / Owner section — fix-22-final adds the v1 panel. */}
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
            <input
              type="text"
              value={value.builder_name}
              onChange={(e) => set('builder_name', e.target.value)}
              placeholder="Full name"
              autoComplete="off"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-builder-name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Company
            </span>
            <input
              type="text"
              value={value.builder_company}
              onChange={(e) => set('builder_company', e.target.value)}
              placeholder="Company name"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-builder-company"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Email
            </span>
            <input
              type="email"
              value={value.builder_email}
              onChange={(e) => set('builder_email', e.target.value)}
              placeholder="builder@email.com"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-builder-email"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-dim">
              Phone
            </span>
            <input
              type="text"
              value={value.builder_phone}
              onChange={(e) => set('builder_phone', e.target.value)}
              placeholder="(206) 555-0100"
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
              data-testid="wizard-builder-phone"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function ProjectTagsField({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
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
      <input
        type="text"
        placeholder="Add tag, press Enter"
        className="bg-bg border border-border rounded-md px-2 py-1 text-[11px] font-mono text-text placeholder:text-dim focus:outline-none focus:border-de w-full md:w-72"
        data-testid="wizard-tag-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const input = e.currentTarget;
            onAdd(input.value);
            input.value = '';
          }
        }}
      />
    </div>
  );
}
