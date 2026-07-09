import {
  PRIMARY_TEAM_OPTIONS,
  primarySelectValue,
  resolvePrimaryAssignee,
  resolvePrimaryTeamPerson,
  type PrimaryResolutionContext,
} from '../lib/taskTeam';

// fix-228: the single shared PRIMARY-owner editor used by BOTH live task views
// (the permit-detail task bar + My Tasks). The primary is stored in
// permit_tasks.assigned_to and can be a team key (Design Associate — the DEFAULT
// → the DA, Entitlements → ent_lead, Schematic Team → schematic designer),
// Design Manager (→ the DM for this DA via dm_da_groups), or a specific person.
// It resolves to a person for DISPLAY through the fix-222 taxonomy (taskTeam) so
// the two views agree. Distinct from the co-assignees (CoAssigneeEditor) — this
// is the labeled OWNER; those are additional helpers.
//
// fix-229: the resolved person is shown ONCE. In edit mode ONLY the <select>
// renders — its selected option already reads "<role> · <person>" (e.g.
// "Design Associate · Nidhi"), so the old duplicate resolved-person chip is
// gone. The chip renders only in readOnly mode (where there is no select).

export interface PrimaryAssigneeEditorProps {
  /** The task's stored assigned_to ('' / null = default → the discipline's team). */
  value: string | null | undefined;
  /** fix-230: the task's column/discipline ('ent'/'arch') — drives the UNSET
   *  default (ent → Entitlements/ent_lead, else → Design Associate/DA). */
  discipline?: string | null;
  /** Per-project context resolving team/role keys to people. */
  ctx: PrimaryResolutionContext;
  /** Roster names offered as "specific person" options (deduped by the caller). */
  memberNames: string[];
  /** Persist the new assigned_to (team key / role / person). */
  onChange: (next: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  /** Prefix for data-testids: chip `<prefix>-primary`, select `<prefix>-primary-select`. */
  testIdPrefix: string;
}

export default function PrimaryAssigneeEditor({
  value,
  discipline,
  ctx,
  memberNames,
  onChange,
  readOnly = false,
  disabled = false,
  testIdPrefix,
}: PrimaryAssigneeEditorProps) {
  const display = resolvePrimaryAssignee(value, ctx, discipline);
  const selected = primarySelectValue(value, discipline);

  // Offer every roster name as a "specific person"; include the current person
  // value even if it's off-roster so the select can reflect it.
  const persons = [...memberNames];
  if (
    !(PRIMARY_TEAM_OPTIONS as readonly string[]).includes(selected) &&
    !persons.includes(selected)
  ) {
    persons.unshift(selected);
  }

  const teamOptionLabel = (key: (typeof PRIMARY_TEAM_OPTIONS)[number]): string => {
    const person = resolvePrimaryTeamPerson(key, ctx);
    return person ? `${key} · ${person}` : key;
  };

  // fix-229: readOnly → just the resolved-person chip (no select to carry it).
  if (readOnly) {
    return (
      <span
        className="px-1.5 py-0.5 rounded font-bold text-[10px]"
        style={{ background: 'var(--color-s2)', color: 'var(--color-text)' }}
        title="Primary owner"
        data-testid={`${testIdPrefix}-primary`}
      >
        {display ?? 'Unassigned'}
      </span>
    );
  }

  // fix-229: edit mode → ONLY the select. Its selected option shows the
  // resolved "<role> · <person>", so the person is never rendered twice.
  return (
    <select
      value={selected}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="text-[10px] px-1 py-0.5 border rounded outline-none max-w-[180px]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
      title="Primary owner — click to change"
      aria-label="Primary owner"
      data-testid={`${testIdPrefix}-primary-select`}
    >
      <optgroup label="Team / role">
        {PRIMARY_TEAM_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {teamOptionLabel(k)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Specific person">
        {persons.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
