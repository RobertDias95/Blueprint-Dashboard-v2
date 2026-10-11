import { useMemo } from 'react';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { isAssignableMember } from '../../lib/roster';
import { INTAKE_WARNING_RECIPIENTS_KEY } from '../../lib/intakeWarning';

// ===========================================================================
// ★★ fix-637 (P-180) — "Seattle intake warning goes to"
// ===========================================================================
//
// Bobby named the people (Miles and Brianna); the brief made it a Settings
// value rather than a hard-coded pair, so a change of desk is an edit here.
// Stored as ROSTER NAMES in app_config — the database resolves each one to a
// single login email (fix-634's `bp_notify_person_for_name`), and the pop-up
// matches the signed-in person by the same name.
//
// ★ A multi-select of PEOPLE, from the current roster only (fix-321 /
//   fix-343: `isAssignableMember`, so a former person or a viewer cannot be
//   added). Admin-gated in the database: app_config writes need
//   `is_tenant_admin`; `readOnly` only hides the controls.

export default function IntakeWarningRecipientsEditor({ readOnly }: { readOnly: boolean }) {
  const config = useAppConfig();
  const team = useTeamMembers();
  const setKey = useSetAppConfigKey();

  const chosen = useMemo(
    () => readAppConfigStringArray(config.map, INTAKE_WARNING_RECIPIENTS_KEY),
    [config.map],
  );

  /** One entry per person (the roster has a row per role). */
  const people = useMemo(() => {
    const byName = new Map<string, { name: string; hasEmail: boolean }>();
    for (const m of team.all) {
      if (!isAssignableMember(m)) continue;
      const name = (m.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const hasEmail = !!(m.email ?? '').trim();
      const hit = byName.get(key);
      if (hit) hit.hasEmail ||= hasEmail;
      else byName.set(key, { name, hasEmail });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [team.all]);

  const chosenKeys = new Set(chosen.map((n) => n.trim().toLowerCase()));
  const addable = people.filter((p) => !chosenKeys.has(p.name.toLowerCase()));
  const infoFor = (name: string) =>
    people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

  function save(next: string[]) {
    setKey.mutate({ key: INTAKE_WARNING_RECIPIENTS_KEY, value: next });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="settings-intake-warning">
      <div className="text-[10px] text-dim">
        Each business day these people get a pop-up and a 7 AM email listing Seattle
        intake slots within 7 business days (weekends skipped), until each one is
        accepted, moved or released. It is a work alert, so the mention/assignment
        email switches don’t turn it off — take a person off this list instead.
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="settings-intake-warning-chosen">
        {chosen.length === 0 && (
          <span className="text-[11px] text-co italic">
            Nobody — the warning goes to no one.
          </span>
        )}
        {chosen.map((name) => {
          const info = infoFor(name);
          const warn = !info
            ? 'Not on the current roster — will not be notified'
            : !info.hasEmail
              ? 'No email on the roster — will not get the email'
              : null;
          return (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-text"
              style={{ borderColor: warn ? 'var(--color-co-border)' : 'var(--color-border)' }}
              title={warn ?? undefined}
              data-testid={`settings-intake-warning-person-${name}`}
            >
              {name}
              {warn && <span aria-label={warn} className="text-co">⚠</span>}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => save(chosen.filter((n) => n !== name))}
                  className="text-dim hover:text-text leading-none"
                  aria-label={`Remove ${name}`}
                  data-testid={`settings-intake-warning-remove-${name}`}
                >
                  ✕
                </button>
              )}
            </span>
          );
        })}
      </div>

      {!readOnly && (
        <select
          value=""
          onChange={(e) => {
            const name = e.target.value;
            if (name) save([...chosen, name]);
          }}
          disabled={addable.length === 0 || setKey.isPending}
          className="w-full max-w-[280px] text-[11px] border rounded px-2 py-1 bg-surface disabled:opacity-60"
          style={{ borderColor: 'var(--color-border)' }}
          aria-label="Add a person to the Seattle intake warning"
          data-testid="settings-intake-warning-add"
        >
          <option value="">＋ Add a person…</option>
          {addable.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {p.hasEmail ? '' : ' (no email)'}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
