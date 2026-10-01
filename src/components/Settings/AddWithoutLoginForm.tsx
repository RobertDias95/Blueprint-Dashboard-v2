import { useId, useState } from 'react';
import { useUpsertTeamMember } from '../../hooks/useUpsertTeamMember';
import { useSetPersonDetails } from '../../hooks/useSetPersonDetails';
import { ROLE_TITLE } from '../../lib/roleLabels';
import { PERSON_FIELD_INPUT as INPUT, PersonFieldRow as Row } from './personFields';
import {
  PEOPLE_ROLE_FILTERS,
  addWithoutLoginRefusals,
  type AddWithoutLoginInput,
} from '../../lib/peopleTable';
import type { TeamRole } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-613 §A — ADDING SOMEBODY WHO HAS NO LOGIN (census gap 34)
// ===========================================================================
//
// ---------------------------------------------------------------------------
// ★★★ WHAT THE PILL "Add…" BOXES DID, AND WHY THIS REPLACES THEM
// ---------------------------------------------------------------------------
// Each of the nine roster lists had an "Add…" input. It sent `{ name, role }`
// and nothing else, so the new row arrived with no first name, no last name and
// no email.
//
// ★★★ AND AN EMAIL IS NOT COSMETIC: `resolveRosterIdentity` matches a signed-in
//     address against `team_members.email` to work out who somebody is. A row
//     made by those boxes could never be matched to its own person — which is
//     how Ana ended up with a `schematic` row carrying her details and a `da`
//     row carrying none, resolving as schematic-only and losing her DA scope to
//     her own self-scope, My Tasks and her name plate (fix-487 found it).
//
// ★★ So this asks for the three things that make a row usable and leaves
//    optional only the one that genuinely may not exist yet. `Add a person`
//    beside it still creates a LOGIN; this is the path for a name that needs to
//    be creditable before, or without, one.
//
// ★ Two writes, in order, because the roster has two shapes of write:
//     1. `bp_upsert_team_member_row` inserts the (name, role) row
//     2. `bp_set_person_details` fills first / last / email BY NAME
//   The second is what the pill boxes never did. It runs on success of the
//   first, so a refused insert does not leave details attached to no row.

export default function AddWithoutLoginForm({
  onDone,
}: {
  onDone: () => void;
}) {
  const formId = useId();
  const upsert = useUpsertTeamMember();
  const details = useSetPersonDetails();
  const [form, setForm] = useState<AddWithoutLoginInput>({
    name: '',
    first_name: '',
    last_name: '',
    role: '',
    email: '',
  });

  const refusals = addWithoutLoginRefusals(form);
  const ready = refusals.length === 0;
  const busy = upsert.isPending || details.isPending;

  function set<K extends keyof AddWithoutLoginInput>(
    key: K,
    value: AddWithoutLoginInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const name = form.name.trim();
    upsert.mutate(
      { op: 'insert', patch: { name, role: form.role as TeamRole } },
      {
        onSuccess: () => {
          details.mutate(
            {
              name,
              first_name: form.first_name.trim(),
              last_name: form.last_name.trim(),
              email: form.email?.trim() ?? '',
            },
            { onSuccess: () => onDone() },
          );
        },
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 pt-3 border-t border-border space-y-3"
      data-testid="add-without-login-form"
    >
      {/* ★ The hint is the whole reason this path is separate: it says what the
          person will and will not be able to do, so nobody reaches for it
          expecting a login. */}
      <p className="text-[11px] text-muted m-0">
        A roster row only — they can be credited with work and picked as an
        assignee, and they cannot sign in. Add their login later with{' '}
        <strong>+ Add a person</strong>.
      </p>

      <Row
        label="Goes by"
        htmlFor={`${formId}-name`}
        hint="How work is credited. The app matches on this name, so pick the one people use."
      >
        <input
          id={`${formId}-name`}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className={INPUT}
          placeholder="Bobby"
          data-testid="awl-name"
        />
      </Row>

      <div className="grid grid-cols-2 gap-3">
        <Row label="First name" htmlFor={`${formId}-first`}>
          <input
            id={`${formId}-first`}
            value={form.first_name}
            onChange={(e) => set('first_name', e.target.value)}
            className={INPUT}
            data-testid="awl-first"
          />
        </Row>
        <Row label="Last name" htmlFor={`${formId}-last`}>
          <input
            id={`${formId}-last`}
            value={form.last_name}
            onChange={(e) => set('last_name', e.target.value)}
            className={INPUT}
            data-testid="awl-last"
          />
        </Row>
      </div>

      <Row label="Role" htmlFor={`${formId}-role`}>
        <select
          id={`${formId}-role`}
          value={form.role}
          onChange={(e) => set('role', e.target.value as TeamRole | '')}
          className={INPUT}
          data-testid="awl-role"
        >
          <option value="">Pick a role…</option>
          {PEOPLE_ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {ROLE_TITLE[r] ?? r}
            </option>
          ))}
        </select>
      </Row>

      <Row
        label="Email"
        htmlFor={`${formId}-email`}
        // ★★ OPTIONAL, AND THE HINT SAYS WHAT IT COSTS. Steve and David shipped
        //    with NULL emails because nobody knew them; this path exists for
        //    exactly that case, so it cannot require one — but somebody adding a
        //    row should know what the blank means.
        hint="Optional. Without it, a login cannot be matched to this person later."
      >
        <input
          id={`${formId}-email`}
          type="email"
          value={form.email ?? ''}
          onChange={(e) => set('email', e.target.value)}
          className={INPUT}
          placeholder="person@blueprintcap.com"
          data-testid="awl-email"
        />
      </Row>

      {(upsert.error || details.error) && (
        <p
          className="text-[11px] m-0"
          style={{ color: 'var(--color-co)' }}
          data-testid="awl-error"
        >
          {(upsert.error ?? details.error)?.message}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="text-[12px] px-3 py-1.5 rounded border border-border text-muted hover:text-text"
          data-testid="awl-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!ready || busy}
          className="text-[12px] px-3 py-1.5 rounded border border-de text-de font-semibold disabled:opacity-40"
          data-testid="awl-save"
        >
          {busy ? 'Adding…' : 'Add to the roster'}
        </button>
      </div>
    </form>
  );
}
