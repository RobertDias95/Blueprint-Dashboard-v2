import {
  coAssigneeDisplayName,
  buildAssigneeOptions,
  type ResolutionContext,
} from '../lib/taskTeam';

// fix-224: the single shared co-assignee editor used by BOTH task views (My
// Tasks + the permit-detail task bar). Assignment lives in ONE place — the
// permit_task_assignees join table, written via bp_set_task_assignees (an
// atomic full-set replace) — so a person co-assigned in one view shows in the
// other and is never blank when the set is non-empty. Each chip renders the
// DISPLAY name (fix-222 role tokens resolved to the actual person for this
// project); add/remove operate on the raw stored entries.

export interface CoAssigneeEditorProps {
  /** Raw stored co-assignees (person names and/or `role:` tokens). */
  values: string[];
  /** Per-project context that resolves role tokens to people for display. */
  ctx: ResolutionContext;
  /** Roster names offered by the add picker (already deduped by the caller). */
  memberNames: string[];
  /** Replace the whole assignee set (maps to bp_set_task_assignees). */
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  /** fix-228: the task's resolved PRIMARY owner. A co-assignee that resolves to
   *  the same person is a display duplicate — its chip is hidden and it's kept
   *  out of the add picker (the stored set is untouched; de-dupe is visual). */
  primaryPerson?: string | null;
  /** Prefix for data-testids so both views stay addressable. */
  testIdPrefix: string;
}

export default function CoAssigneeEditor({
  values,
  ctx,
  memberNames,
  onChange,
  readOnly = false,
  primaryPerson = null,
  testIdPrefix,
}: CoAssigneeEditorProps) {
  // fix-228: hide a co-assignee that IS the primary owner (display-only; the
  // stored entry stays in the set so writes preserve it).
  const isPrimaryDup = (entry: string): boolean =>
    primaryPerson != null && coAssigneeDisplayName(entry, ctx) === primaryPerson;
  const visibleValues = values.filter((v) => !isPrimaryDup(v));
  // fix-231: the "+ Assign" picker offers bare roster names (no role-labeled
  // options), so route it through the SAME shared dedupe both editors use. With
  // no role options this only collapses any duplicate roster names (defensive);
  // the shared builder guarantees the two selects can never diverge.
  const { personOptions: available } = buildAssigneeOptions({
    roleOptions: [],
    personNames: memberNames.filter(
      (n) => !values.includes(n) && n !== primaryPerson,
    ),
  });

  function add(name: string) {
    const v = name.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
  }
  function remove(entry: string) {
    onChange(values.filter((v) => v !== entry));
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-testid={`${testIdPrefix}-co-assignees`}
    >
      {visibleValues.length === 0 && (
        <span
          className="text-[10px] italic"
          style={{ color: 'var(--color-dim)' }}
          data-testid={`${testIdPrefix}-co-assignees-empty`}
        >
          Unassigned
        </span>
      )}
      {visibleValues.map((entry) => {
        const display = coAssigneeDisplayName(entry, ctx);
        return (
          <span
            key={entry}
            className="px-1.5 py-0.5 rounded inline-flex items-center gap-1 text-[10px]"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
            data-testid={`${testIdPrefix}-co-assignee-${entry}`}
          >
            {display}
            {!readOnly && (
              <button
                type="button"
                onClick={() => remove(entry)}
                style={{
                  background: 'transparent',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--color-dim)',
                }}
                title={`Remove ${display}`}
                data-testid={`${testIdPrefix}-co-assignee-remove-${entry}`}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      {!readOnly && (
        <select
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.currentTarget.value = '';
          }}
          className="text-[10px] px-1 py-0.5 border rounded outline-none"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-muted)',
          }}
          data-testid={`${testIdPrefix}-co-assignee-add`}
          disabled={available.length === 0}
        >
          <option value="">+ Assign</option>
          {available.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
