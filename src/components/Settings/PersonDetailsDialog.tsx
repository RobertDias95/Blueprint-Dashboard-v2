import { useId, useState } from 'react';
import { useSetPersonDetails } from '../../hooks/useSetPersonDetails';
import { ROLE_TITLE } from '../../lib/roleLabels';
import { PERSON_FIELD_INPUT, PersonFieldRow } from './personFields';
import type { RosterPerson } from '../../lib/personDetails';

// ===========================================================================
// ★★★ fix-487 §B (P-120) — EDIT A PERSON'S DETAILS
// ===========================================================================
//
// Bobby: *"have the ability to edit our team database so i can enter their last
// names too."*
//
// ---------------------------------------------------------------------------
// ★★★ WHAT THIS DIALOG CANNOT DO, AND WHY THAT IS THE FEATURE
// ---------------------------------------------------------------------------
// It cannot change `name` and it cannot change `role`.
//
//   · `name` IS THE JOIN KEY — ~1,850 references across 11 columns in 7 tables,
//     with no FK and no cascade. Renaming it here would silently orphan a
//     person from their own permits, tasks and draw-schedule blocks. Renaming
//     already has a path: `bp_rename_da` / `bp_rename_dm` for the two roles
//     that cascade, and AdminTeamTab's simple rename for the rest.
//   · `role` decides which pickers offer somebody. Changing it from a details
//     dialog would move their work as a side effect of fixing a surname.
//
// ★★ AND IT IS ENFORCED BY THE RPC'S SIGNATURE, NOT BY THIS FILE.
//    `bp_set_person_details(p_name, p_first_name, p_last_name, p_email)` has no
//    parameter that could carry either one, so a future edit to this component
//    cannot reintroduce the ability by accident. The suite asserts the write
//    path over the shipped source.
//
// ---------------------------------------------------------------------------
// ★★ THE SAVE TOUCHES EVERY ROW THE PERSON HAS, AND SAYS SO
// ---------------------------------------------------------------------------
// The roster is one row per (person, role); seven people carry two. These three
// fields are facts about the PERSON, so the RPC writes them by NAME across all
// of their rows — the same shape `bp_set_team_department` uses. The dialog
// prints the row count rather than leaving it to be discovered.
//
// ★ THE BACKDROP DOES NOTHING AND NEITHER DOES ESCAPE — fix-411 §1's rule, the
//   same as AddPersonDialog and the project wizard. Three typed fields are
//   exactly the kind of input a stray click must not throw away. The two exits
//   are × and Cancel.

interface Props {
  person: RosterPerson | null;
  onClose: () => void;
}

export default function PersonDetailsDialog({ person, onClose }: Props) {
  const formId = useId();
  const save = useSetPersonDetails();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');

  // ★★★ RE-SEEDING IS AN IN-RENDER ADJUST-ON-CHANGE, NOT AN EFFECT.
  //
  // The first version of this was `useEffect(() => setFirst(...), [person?.name])`
  // and **lint rejected it outright**: *"Calling setState synchronously within
  // an effect can trigger cascading renders."* Only lint catches this — `tsc`
  // and the whole suite were green — which is the third time this repo has
  // recorded that (fix-350 twice, fix-403, fix-426).
  //
  // ★★ This is React's own "adjusting state when a prop changes" shape, and the
  //    one `ProjectDetailHeader` already uses for `?permit=` / `?chat=`
  //    (fix-217/218): set during render, React re-runs the component
  //    immediately with no committed intermediate state and no cascade.
  //
  // ★ KEYED ON THE NAME, not on the object. A roster refetch produces a NEW
  //   `person` object with identical values, and re-seeding on identity would
  //   wipe what somebody was halfway through typing.
  const [seeded, setSeeded] = useState<string | null>(null);
  if (person && person.name !== seeded) {
    setSeeded(person.name);
    setFirst(person.first_name ?? '');
    setLast(person.last_name ?? '');
    setEmail(person.email ?? '');
  }
  // ★ …and clearing it on close is what makes re-opening the SAME person
  //   re-seed rather than show a stale draft.
  if (!person && seeded !== null) setSeeded(null);

  if (!person) return null;

  const dirty =
    first.trim() !== (person.first_name ?? '') ||
    last.trim() !== (person.last_name ?? '') ||
    email.trim() !== (person.email ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!person) return;
    save.mutate(
      {
        name: person.name,
        first_name: first,
        last_name: last,
        email,
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-16 pb-12 px-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-title`}
      data-testid="person-details-dialog"
      // ★★★ NO onClick — see the header note (fix-411 §1).
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-[480px]">
        <header className="px-5 pt-4 pb-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2
              id={`${formId}-title`}
              className="text-sm font-display font-extrabold text-text m-0"
            >
              {person.name}
            </h2>
            <p className="text-[11px] text-dim m-0 mt-0.5">
              {person.roles.map((r) => ROLE_TITLE[r] ?? r).join(' · ') ||
                'No role'}
              {person.rows > 1 && ` · ${person.rows} roster rows`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text text-lg leading-none px-1"
            aria-label="Close"
            data-testid="person-details-close"
          >
            ×
          </button>
        </header>

        <form
          onSubmit={submit}
          className="px-5 py-4 space-y-3"
          data-testid="person-details-form"
        >
          {/* ★★ THE JOIN KEY IS SHOWN AND NOT EDITABLE. Hiding it would leave
              somebody wondering where "Fisk" is; a disabled box says "this is
              the name the app matches on, and it is not changed here". */}
          <PersonFieldRow
            label="Roster name"
            htmlFor={`${formId}-name`}
            hint="How work is attributed. Renamed from the role list above, not here."
          >
            <input
              id={`${formId}-name`}
              value={person.name}
              readOnly
              disabled
              className={`${PERSON_FIELD_INPUT} opacity-60 cursor-not-allowed`}
              data-testid="person-details-name"
            />
          </PersonFieldRow>

          <div className="grid grid-cols-2 gap-3">
            <PersonFieldRow label="First name" htmlFor={`${formId}-first`}>
              <input
                id={`${formId}-first`}
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                className={PERSON_FIELD_INPUT}
                data-testid="person-details-first"
              />
            </PersonFieldRow>
            <PersonFieldRow label="Last name" htmlFor={`${formId}-last`}>
              <input
                id={`${formId}-last`}
                value={last}
                onChange={(e) => setLast(e.target.value)}
                className={PERSON_FIELD_INPUT}
                data-testid="person-details-last"
              />
            </PersonFieldRow>
          </div>

          <PersonFieldRow
            label="Email"
            htmlFor={`${formId}-email`}
            // ★★★ NOT COSMETIC. `resolveRosterIdentity` matches the signed-in
            //     address against this column; a person with none signs in and
            //     the Bridge cannot tell who they are.
            hint="How their login is matched to this roster row."
          >
            <input
              id={`${formId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={PERSON_FIELD_INPUT}
              placeholder="person@blueprintcap.com"
              data-testid="person-details-email"
            />
          </PersonFieldRow>

          {person.split.length > 0 && (
            <p
              className="text-[11px] m-0"
              style={{ color: 'var(--color-co)' }}
              data-testid="person-details-split"
            >
              This person's roster rows disagree about{' '}
              {person.split.join(', ')}. Saving sets all {person.rows} rows to
              what is above.
            </p>
          )}

          {save.error && (
            <p
              className="text-[11px] m-0"
              style={{ color: 'var(--color-co)' }}
              data-testid="person-details-error"
            >
              {save.error.message}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded border border-border text-muted hover:text-text"
              data-testid="person-details-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!dirty || save.isPending}
              className="text-[12px] px-3 py-1.5 rounded border border-de text-de font-semibold disabled:opacity-40"
              data-testid="person-details-save"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
