import { useMemo, type ReactNode } from 'react';
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { useSetAppConfigKey } from '../../hooks/useSetAppConfigKey';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { isAssignableMember } from '../../lib/roster';

// ===========================================================================
// ★★ fix-646 — a Settings list of PEOPLE, stored as roster names in app_config
// ===========================================================================
//
// Extracted from fix-637's "Seattle intake warning goes to" so fix-646's
// "Resubmit-by warning goes to" is the same control, not a copy. Stored as
// ROSTER NAMES — the database resolves each one to a single login email
// (fix-634's `bp_notify_person_for_name`).
//
// ★ A multi-select of PEOPLE, from the current roster only (fix-321 /
//   fix-343: `isAssignableMember`, so a former person or a viewer cannot be
//   added). Admin-gated in the database: app_config writes need
//   `is_tenant_admin`; `readOnly` only hides the controls.

export default function RecipientNamesEditor({
  readOnly,
  configKey,
  testidPrefix,
  intro,
  addLabel,
}: {
  readOnly: boolean;
  /** The app_config key holding the JSON array of roster names. */
  configKey: string;
  /** Prefix for every data-testid (`<prefix>-chosen`, `<prefix>-add`, ...). */
  testidPrefix: string;
  /** The paragraph above the chips. */
  intro: ReactNode;
  /** aria-label of the add select. */
  addLabel: string;
}) {
  const config = useAppConfig();
  const team = useTeamMembers();
  const setKey = useSetAppConfigKey();

  const chosen = useMemo(
    () => readAppConfigStringArray(config.map, configKey),
    [config.map, configKey],
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
    setKey.mutate({ key: configKey, value: next });
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testidPrefix}>
      <div className="text-[10px] text-dim">{intro}</div>

      <div className="flex flex-wrap gap-1.5" data-testid={`${testidPrefix}-chosen`}>
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
              data-testid={`${testidPrefix}-person-${name}`}
            >
              {name}
              {warn && <span aria-label={warn} className="text-co">⚠</span>}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => save(chosen.filter((n) => n !== name))}
                  className="text-dim hover:text-text leading-none"
                  aria-label={`Remove ${name}`}
                  data-testid={`${testidPrefix}-remove-${name}`}
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
          aria-label={addLabel}
          data-testid={`${testidPrefix}-add`}
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
