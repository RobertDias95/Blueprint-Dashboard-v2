import { useId, useState } from 'react';
import { useSetPersonDetails } from '../../hooks/useSetPersonDetails';
import { useSetTeamDepartment } from '../../hooks/useSetTeamDepartment';
import { useSetAgendaMember } from '../../hooks/useAgendaMember';
import { useUpsertTeamMember } from '../../hooks/useUpsertTeamMember';
import { departmentLabel } from '../../lib/roleLabels';
import { useDepartments } from '../../hooks/useDepartments';
import { PEOPLE_ROLE_FILTERS, retirePatch } from '../../lib/peopleTable';
import { isCurrentMember } from '../../lib/roster';
import type { Department, TeamRole } from '../../lib/database.types';
import { useProfileIdForRosterName } from '../../hooks/useAvatars';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import AvatarControl from './AvatarControl';
import { ROLE_TITLE } from '../../lib/roleLabels';
import { PERSON_FIELD_INPUT, PersonFieldRow } from './personFields';
import type { RosterPerson } from '../../lib/personDetails';
import { useDirtySurface } from '../../hooks/useDirtySurface';
import { useChangeSignInEmail, useRosterNameHasLogin } from '../../hooks/useSignInEmail';

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
// It cannot change `name`.
//
// ⚖️ Bobby, 2026-10-01: *"think of it as a nickname — my email is robert, but i
//    go by bobby."* So `team_members.name` is the person's **"Goes by"** name,
//    and it is the TEXT JOIN KEY on ~2,209 assignments across 11 columns in 7
//    tables, with no FK and no cascade. Renaming it here would silently orphan a
//    person from their own permits, tasks and draw-schedule blocks.
//
// ★★★ AND THE RENAME PATH THAT USED TO EXIST IS GONE, NOT MOVED. fix-613
//     deleted `useRenameDA` / `useRenameDM`: they renamed the roster row and
//     some of the references, and MISSED projects, routing and the draw
//     schedule — so the "cascade" they advertised split one person into two.
//     There is now no rename from Settings at all, which is the honest state
//     until something cascades all 11 columns.
//
// ★★ ROLE *IS* EDITABLE NOW — fix-613 §A, and it is a deliberate reversal of
//    this dialog's original rule. Bobby asked for one table where a person's
//    roles are chips you add to and take away from; the nine pill lists were
//    where that happened before, and they are gone. Taking a role away RETIRES
//    that row — never a hard delete — so the person stays readable on the work
//    they are credited with.
//
// ★★ AND THE NAME RULE IS ENFORCED BY THE RPC'S SIGNATURE, NOT BY THIS FILE.
//    `bp_set_person_details(p_name, p_first_name, p_last_name, p_email)` takes
//    the name as the LOOKUP and has no parameter that could change it, so a
//    future edit to this component cannot reintroduce the ability by accident.
//    The suite asserts the write path over the shipped source.
//
// ★ EVERY FIELD SAVES THROUGH THE RPC THAT ALREADY SAVED IT — §A's rule, so
//   this dialog adds no new write path:
//     first/last/email → bp_set_person_details   (by name, all rows)
//     department       → bp_set_team_department  (by name, all rows)
//     agenda           → bp_set_team_agenda_member (by name, all rows)
//     roles            → bp_upsert_team_member_row (one row at a time)
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
  /** ★ Accepts the richer `PeopleTableRow` too — it extends `RosterPerson`, and
   *  the extra fields are what the department / agenda / role controls read. */
  person: (RosterPerson & PersonExtras) | null;
  onClose: () => void;
}

/** The fields the Everyone table folds in beside `RosterPerson`. All optional,
 *  so every existing caller passing a bare `RosterPerson` still compiles. */
export interface PersonExtras {
  department?: Department | null;
  agenda?: boolean;
  members?: Array<{
    id: string;
    role: TeamRole;
    active: boolean | null;
    former: boolean | null;
    updated_at: string;
    name: string;
  }>;
}

export default function PersonDetailsDialog({ person, onClose }: Props) {
  const formId = useId();
  const save = useSetPersonDetails();
  const setDept = useSetTeamDepartment();
  // ★ fix-670: the department list is a table now.
  const departments = useDepartments();
  const setAgenda = useSetAgendaMember();
  const upsertRow = useUpsertTeamMember();
  // ★★★ fix-505 §B: a roster row is not a login. `profiles` is read-own-only,
  //     so the client cannot look one up — `bp_profile_id_for_roster_name`
  //     answers it, and NULL is the real, common state (42 roster people, 37
  //     logins on prod 2026-09-08).
  const isAdmin = useIsTenantAdmin();
  const profileIdQ = useProfileIdForRosterName(person?.name ?? null);
  const hasLoginQ = useRosterNameHasLogin(person?.name ?? null);
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
  // ★★ fix-595: three typed fields that survive a blur. **Compared against what
  //    loaded, not merely "the dialog is open"** — `seeded !== null` would have
  //    been true for an untouched dialog somebody left on screen, which would
  //    block the reload for a person who typed nothing. Over-conservative is the
  //    right default for an unknown surface, not for one whose clean state is
  //    right here.
  useDirtySurface(
    'person-details',
    seeded !== null &&
      (first !== (person?.first_name ?? '') ||
        last !== (person?.last_name ?? '') ||
        // ★ fix-659: a sign-in email is not editable here, so not a draft.
        (hasLoginQ.data === false && email !== (person?.email ?? ''))),
  );
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

  // ★★★ fix-659 (census 42): for somebody with a login the email is their
  //     sign-in, so this form never edits it — Save sends the stored value
  //     back unchanged, and "Change sign-in email" is the only way to move it.
  //     Until the answer loads, treat it as a login (the safe side): a
  //     read-only box for a moment is better than an edit the server refuses.
  const emailIsSignIn = hasLoginQ.data !== false;

  const dirty =
    first.trim() !== (person.first_name ?? '') ||
    last.trim() !== (person.last_name ?? '') ||
    (!emailIsSignIn && email.trim() !== (person.email ?? ''));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!person) return;
    save.mutate(
      {
        name: person.name,
        first_name: first,
        last_name: last,
        email: emailIsSignIn ? (person.email ?? '') : email,
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
          {/* ★★★ fix-505 §B — THE PICTURE, AND THE THREE STATES IT HAS.
              · an admin, on somebody with a login → the full control
              · anyone, on somebody with NO login → the picture cannot be set,
                and the note says why rather than showing a button that fails
              · a non-admin → the picture, read-only
              The order matters: "no login" is a fact about the PERSON and beats
              "you are not an admin", which is a fact about the viewer. Telling
              an editor they lack permission to do something nobody can do
              would send them to ask an admin who would also fail. */}
          <PersonFieldRow
            label="Picture"
            htmlFor={`${formId}-avatar`}
            hint="Shown wherever this person's initials appear today."
          >
            <div id={`${formId}-avatar`}>
              <AvatarControl
                profileId={profileIdQ.data ?? null}
                name={person.name}
                canEdit={isAdmin && !!profileIdQ.data}
                noLoginNote={
                  profileIdQ.isLoading || profileIdQ.data
                    ? undefined
                    : 'No login — a picture can be set once they can sign in.'
                }
                testId="person-details-avatar"
              />
            </div>
          </PersonFieldRow>

          {/* ★★ THE JOIN KEY IS SHOWN AND NOT EDITABLE. Hiding it would leave
              somebody wondering where "Fisk" is; a disabled box says "this is
              the name the app matches on, and it is not changed here". */}
          {/* ⚖️ Bobby, 2026-10-01: *"think of it as a nickname — my email is
              robert, but i go by bobby."* So the label is his word for it, and
              the hint says what it costs to change — which is why nothing on
              this screen can. */}
          <PersonFieldRow
            label="Goes by"
            htmlFor={`${formId}-name`}
            hint="How work is credited. The app matches on this name, so it is not edited here."
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
            hint={
              emailIsSignIn
                ? 'This is their sign-in email.'
                : 'How their login is matched to this roster row.'
            }
          >
            {emailIsSignIn ? (
              <div className="space-y-1.5">
                <input
                  id={`${formId}-email`}
                  type="email"
                  value={person.email ?? ''}
                  readOnly
                  disabled
                  className={`${PERSON_FIELD_INPUT} opacity-60 cursor-not-allowed`}
                  data-testid="person-details-email"
                  data-signin="true"
                />
                {isAdmin && <ChangeSignInEmail person={person} />}
              </div>
            ) : (
              <input
                id={`${formId}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={PERSON_FIELD_INPUT}
                placeholder="person@blueprintcap.com"
                data-testid="person-details-email"
              />
            )}
          </PersonFieldRow>

          {/* ═══ ★★★ fix-613 §A — THE THREE CONTROLS THE NINE LISTS HELD ═══

              Each saves IMMEDIATELY through its own RPC, rather than joining the
              Save button's patch. That is not laziness: `bp_set_team_department`
              and `bp_set_team_agenda_member` write by NAME across every one of a
              person's rows, and `bp_upsert_team_member_row` writes ONE row with
              its own OCC token. Folding four different write shapes into one
              submit would mean inventing a transaction the database does not
              offer, and a partial failure nobody could explain.

              ★ So Save still owns exactly the three fields it always owned, and
                these three say so by acting at once. */}
          <PersonFieldRow
            label="Department"
            htmlFor={`${formId}-dept`}
            hint="One department per person. Saving moves every roster row they have."
          >
            <select
              id={`${formId}-dept`}
              value={person.department ?? ''}
              disabled={!isAdmin || setDept.isPending}
              onChange={(e) =>
                setDept.mutate({
                  name: person.name,
                  // ★ '' means un-classify, which is a legitimate value to SET and
                  //   not only to start at — somebody classified by mistake has to
                  //   be able to go back.
                  department: (e.target.value || null) as Department | null,
                })
              }
              className={PERSON_FIELD_INPUT}
              data-testid="person-details-department"
            >
              <option value="">{departmentLabel(null)}</option>
              {departments.list.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
              {/* ★ A stored key the list no longer has still renders, never blank. */}
              {person.department &&
                !departments.labels.has(person.department) && (
                  <option value={person.department}>
                    {departmentLabel(person.department, departments.labels)}
                  </option>
                )}
            </select>
          </PersonFieldRow>

          <PersonFieldRow
            label="Agenda"
            htmlFor={`${formId}-agenda`}
            hint="Whether they appear on the weekly agenda."
          >
            <label className="flex items-center gap-2 text-[12px] text-text">
              <input
                id={`${formId}-agenda`}
                type="checkbox"
                checked={person.agenda === true}
                disabled={!isAdmin || setAgenda.isPending}
                onChange={(e) =>
                  setAgenda.mutate({
                    name: person.name,
                    member: e.target.checked,
                  })
                }
                data-testid="person-details-agenda"
              />
              On the weekly agenda
            </label>
          </PersonFieldRow>

          {/* ★★★ ROLES — ADD INSERTS A ROW, REMOVE *RETIRES* ONE.
              §A: *"removing a role retires that row (never a hard delete)"*, and
              census gap 37 is the reason: `bp_delete_team_member_row` would take
              the person's name off the roster while ~2,209 assignments still
              point at that string. A retired row keeps the name readable on the
              work it is credited with.

              ★★ The right FLAG per role — `former` for a DA, `active` for
                 everything else — comes from `retirePatch`, the one place that
                 asymmetry is written down. See lib/peopleTable for why it is
                 load-bearing rather than legacy. */}
          {person.members && person.members.length > 0 && (
            <PersonFieldRow
              label="Roles"
              htmlFor={`${formId}-roles`}
              hint="Taking a role away retires that row. Nothing is deleted."
            >
              <div id={`${formId}-roles`} className="space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {person.members.map((m) => {
                    const live = isCurrentMember(m);
                    return (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 bg-s2 border border-border text-muted"
                        data-testid={`person-role-${m.role}`}
                        data-live={live ? 'true' : 'false'}
                      >
                        <span className={live ? undefined : 'line-through decoration-dim/60'}>
                          {ROLE_TITLE[m.role] ?? m.role}
                        </span>
                        {isAdmin && live && (
                          <button
                            type="button"
                            onClick={() =>
                              upsertRow.mutate({
                                op: 'update',
                                member: m as never,
                                patch: retirePatch(m.role),
                              })
                            }
                            className="text-muted hover:text-co leading-none"
                            title={`Retire the ${ROLE_TITLE[m.role] ?? m.role} role`}
                            data-testid={`person-role-retire-${m.role}`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                {isAdmin && (
                  <select
                    value=""
                    onChange={(e) => {
                      const role = e.target.value as TeamRole;
                      if (!role) return;
                      upsertRow.mutate({
                        op: 'insert',
                        patch: { name: person.name, role },
                      });
                      e.target.value = '';
                    }}
                    className={`${PERSON_FIELD_INPUT} text-[11px]`}
                    data-testid="person-role-add"
                  >
                    <option value="">+ add a role…</option>
                    {PEOPLE_ROLE_FILTERS.filter(
                      (r) => !(person.members ?? []).some((m) => m.role === r),
                    ).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_TITLE[r] ?? r}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </PersonFieldRow>
          )}

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

/**
 * ★★★ fix-659 (census 42) — "Change sign-in email", admin-only.
 *
 * Two steps on purpose: type the new address, then a confirm that says in
 * plain words what changes for the person — they sign in with the new
 * address, and the old one stops working. The write is the Edge Function,
 * which moves auth, profile and every roster row together or not at all.
 *
 * ★ It sits INSIDE the dialog's <form>, so every button is type="button" and
 *   Enter in the box is caught — otherwise Enter would submit the outer Save.
 */
function ChangeSignInEmail({ person }: { person: RosterPerson }) {
  const change = useChangeSignInEmail();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [confirming, setConfirming] = useState(false);
  const typed = next.trim().toLowerCase();
  const looksValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed);
  const same = typed === (person.email ?? '').trim().toLowerCase();

  function reset() {
    setOpen(false);
    setNext('');
    setConfirming(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-bold underline"
        style={{ color: 'var(--color-de)' }}
        data-testid="person-details-change-signin"
      >
        Change sign-in email
      </button>
    );
  }

  return (
    <div
      className="rounded border px-2.5 py-2 space-y-2"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="person-details-change-signin-panel"
    >
      {!confirming ? (
        <>
          <input
            type="email"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (looksValid && !same) setConfirming(true);
              }
            }}
            placeholder="new address"
            autoFocus
            className={PERSON_FIELD_INPUT}
            data-testid="person-details-change-signin-input"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!looksValid || same}
              onClick={() => setConfirming(true)}
              className="text-[11px] font-bold px-2 py-1 rounded border disabled:opacity-40"
              style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
              data-testid="person-details-change-signin-next"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] text-muted px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] text-text m-0" data-testid="person-details-change-signin-confirm">
            {person.name} will sign in with <strong>{typed}</strong> from now on.{' '}
            {person.email ? (
              <>
                <span className="font-mono">{person.email}</span> will stop working
                for signing in.
              </>
            ) : null}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={change.isPending}
              onClick={() =>
                change.mutate(
                  { name: person.name, new_email: typed },
                  { onSuccess: reset },
                )
              }
              className="text-[11px] font-bold px-2 py-1 rounded disabled:opacity-50"
              style={{ background: 'var(--color-de)', color: 'var(--color-bg)' }}
              data-testid="person-details-change-signin-confirm-btn"
            >
              {change.isPending ? 'Changing…' : 'Change sign-in email'}
            </button>
            <button
              type="button"
              disabled={change.isPending}
              onClick={() => setConfirming(false)}
              className="text-[11px] text-muted px-2 py-1"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
