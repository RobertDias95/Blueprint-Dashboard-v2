import type { WizardPermit } from './wizardState';
import type { TeamMember } from '../../lib/database.types';

// fix-22 Step 3 sub-component — one row of per-permit overrides.
//
// ENT defaults to Step 1's `entitlement_lead` but can be overridden per
// permit (Bobby owns PAR/Pre-Sub + SDOT Tree + ECA Waiver — that's why
// Migration 3 keeps `ent_lead` on `permits` rather than demoting it to
// project-level). DA comes from the dm_da_groups view; "none" allowed.
//
// fix-25c: "ACQ Target Date" input now binds to expected_issue (the
// team's target ISSUE date — the column Schedule Health reads as
// "ACQ Target"). Pre-fix it bound to target_submit, which meant
// dates entered here never reached the display.

interface Props {
  permit: WizardPermit;
  /** ENT options drawn from team_members where role IN ('ent','ent_lead'). */
  entOptions: TeamMember[];
  /** Flat list of DA names from dm_da_groups (deduped). */
  daOptions: string[];
  onChange: (patch: Partial<WizardPermit>) => void;
}

export default function PermitAssignmentRow({
  permit,
  entOptions,
  daOptions,
  onChange,
}: Props) {
  return (
    <div
      className="border border-border rounded-md bg-bg/40 p-3 grid grid-cols-1 md:grid-cols-6 gap-2"
      data-testid={`wizard-perm-row-${permit.rowId}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-dim">
          Permit Type
        </span>
        <span
          className="text-xs font-display font-bold text-text px-2 py-1 rounded bg-s2 border border-border inline-block"
          data-testid={`wizard-perm-type-${permit.rowId}`}
        >
          {permit.type}
        </span>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-dim">ENT</span>
        <select
          value={permit.ent_lead}
          onChange={(e) => onChange({ ent_lead: e.target.value })}
          className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
          data-testid={`wizard-perm-ent-${permit.rowId}`}
        >
          <option value="">— none —</option>
          {entOptions.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name}
            </option>
          ))}
          {permit.ent_lead &&
            !entOptions.some((m) => m.name === permit.ent_lead) && (
              <option value={permit.ent_lead}>{permit.ent_lead}</option>
            )}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-dim">DA</span>
        <select
          value={permit.da}
          onChange={(e) => onChange({ da: e.target.value })}
          className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
          data-testid={`wizard-perm-da-${permit.rowId}`}
        >
          <option value="">— none —</option>
          {daOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-dim">
          ACQ Target Date
        </span>
        <input
          type="date"
          value={permit.expected_issue}
          onChange={(e) => onChange({ expected_issue: e.target.value })}
          className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
          data-testid={`wizard-perm-target-${permit.rowId}`}
        />
      </label>

      {/* fix-25-feat-h: planned submission date. Optional; BP rows are
          backfilled by bp_set_bp_dd_dates (dd_end + 14) when DD dates
          land, so wizard-time is the right place for non-BP types
          (IPR/ULS/Demo/PAR/SDOT) whose target_submit has no cascade. */}
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-dim">
          Target Submit
        </span>
        <input
          type="date"
          value={permit.target_submit}
          onChange={(e) => onChange({ target_submit: e.target.value })}
          className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
          data-testid={`wizard-perm-target-submit-${permit.rowId}`}
        />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-dim">
          Permit #
        </span>
        <input
          type="text"
          value={permit.num}
          onChange={(e) => onChange({ num: e.target.value })}
          placeholder="optional"
          className="bg-surface border border-border rounded-md px-2 py-1 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
          data-testid={`wizard-perm-num-${permit.rowId}`}
        />
      </label>
    </div>
  );
}
