import { useId, useState } from 'react';
import { useCreateBridgeUser } from '../../hooks/useCreateBridgeUser';
import {
  ADD_PERSON_ROLE_OPTIONS,
  generatePassword,
  namePlatePreview,
} from '../../lib/addPerson';
import { ROLE_TITLE } from '../../lib/roleLabels';
import type { TeamRole } from '../../lib/database.types';
import type { AddPersonSuccess } from '../../../supabase/functions/admin-create-user/handler';

// ===========================================================================
// ★★★ fix-436 §C (P-086) — Bobby adds the person
// ===========================================================================
//
// Darin and Eric were created on 2026-08-28 by hand-writing `auth.users`,
// because there was no screen. This is the screen.
//
// ★★★ IT SETS THE PASSWORD, IT DOES NOT INVITE. Bridge mail is still Supabase's
// demo SMTP and delivers nothing (P-092, parked to Monday), so an
// invite-by-email flow would create a login nobody could ever reach. The
// password is shown ONCE, here, for Bobby to hand over — and the function marks
// the address confirmed on creation for the same reason.
//
// ★★★ THE BACKDROP DOES NOTHING, AND NEITHER DOES ESCAPE. This is fix-411 §1's
// rule (P-049/P-057), applied to the second dialog in the app that holds real
// typing: Bobby, on the project wizard — *"if you click anywhere outside of the
// pop-up, it closes and you have to restart and re-input all that
// information."* Seven fields and a generated password are exactly that kind of
// input. The two exits are the × and Cancel, both explicit.

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  role: TeamRole;
  notes: string;
  bridge_role: 'admin' | 'editor';
  password: string;
}

const EMPTY: FormState = {
  email: '',
  first_name: '',
  last_name: '',
  name: '',
  role: 'da',
  notes: '',
  bridge_role: 'editor',
  password: '',
};

export default function AddPersonDialog({ open, onClose }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  // ★ The roster name defaults to the first name (house convention) but stops
  //   following it the moment somebody types a different one — two people
  //   called Chris need two different join keys.
  const [nameTouched, setNameTouched] = useState(false);
  const [done, setDone] = useState<AddPersonSuccess | null>(null);
  const create = useCreateBridgeUser();
  const formId = useId();

  const rosterName = nameTouched ? form.name : form.first_name;
  const plate = namePlatePreview(
    rosterName,
    form.role,
    form.notes.trim() === '' ? null : form.notes,
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    setForm(EMPTY);
    setNameTouched(false);
    setDone(null);
    create.reset();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        email: form.email.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        name: rosterName.trim(),
        role: form.role,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
        bridge_role: form.bridge_role,
      },
      { onSuccess: (res) => setDone(res) },
    );
  }

  if (!open) return null;

  const errorMessage = create.error?.message ?? null;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-12 pb-12 px-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-title`}
      data-testid="add-person-dialog"
      // ★★★ NO onClick HERE, DELIBERATELY — see the header note. A stray click
      // on the backdrop would throw away seven fields and a password that has
      // been shown to nobody yet. Same decision, same reason, as
      // NewProjectWizard.
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-[560px]">
        <header className="px-5 pt-4 pb-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2
              id={`${formId}-title`}
              className="text-sm font-display font-extrabold text-text m-0"
            >
              Add a person to the Bridge
            </h2>
            <p className="text-[11px] text-dim m-0 mt-0.5">
              Creates their login and their roster row together.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-muted hover:text-text text-lg leading-none px-1"
            aria-label="Close"
            data-testid="add-person-close"
          >
            ×
          </button>
        </header>

        {done ? (
          <Created result={done} plate={plate} password={form.password} onDone={close} />
        ) : (
          <form onSubmit={submit} className="px-5 py-4 space-y-3" data-testid="add-person-form">
            <Row label="Email" htmlFor={`${formId}-email`}>
              <input
                id={`${formId}-email`}
                type="email"
                required
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                className={INPUT}
                placeholder="person@blueprintcap.com"
                data-testid="add-person-email"
              />
            </Row>

            <div className="grid grid-cols-2 gap-3">
              <Row label="First name" htmlFor={`${formId}-first`}>
                <input
                  id={`${formId}-first`}
                  required
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                  className={INPUT}
                  data-testid="add-person-first"
                />
              </Row>
              <Row label="Last name" htmlFor={`${formId}-last`}>
                <input
                  id={`${formId}-last`}
                  required
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                  className={INPUT}
                  data-testid="add-person-last"
                />
              </Row>
            </div>

            <Row
              label="Roster name"
              htmlFor={`${formId}-roster`}
              hint="How work is attributed. First name alone, unless it is taken."
            >
              <input
                id={`${formId}-roster`}
                value={rosterName}
                onChange={(e) => {
                  setNameTouched(true);
                  set('name', e.target.value);
                }}
                className={INPUT}
                data-testid="add-person-roster-name"
              />
            </Row>

            <div className="grid grid-cols-2 gap-3">
              <Row label="Roster role" htmlFor={`${formId}-role`}>
                <select
                  id={`${formId}-role`}
                  value={form.role}
                  onChange={(e) => set('role', e.target.value as TeamRole)}
                  className={INPUT}
                  data-testid="add-person-role"
                >
                  {ADD_PERSON_ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row
                label="Bridge access"
                htmlFor={`${formId}-bridge`}
                hint="Admin can edit Settings."
              >
                <select
                  id={`${formId}-bridge`}
                  value={form.bridge_role}
                  onChange={(e) =>
                    set('bridge_role', e.target.value as 'admin' | 'editor')
                  }
                  className={INPUT}
                  data-testid="add-person-bridge-role"
                >
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </Row>
            </div>

            <Row
              label="Title"
              htmlFor={`${formId}-notes`}
              // ★ fix-343: `notes` is printed verbatim as the title ONLY for a
              //   `viewer`. For every other role the role's own title wins, so
              //   the hint says which one is in play rather than letting Bobby
              //   type something that never appears.
              hint={
                form.role === 'viewer'
                  ? 'Printed on their name plate — e.g. CEO.'
                  : 'Optional note. Their role supplies the printed title.'
              }
            >
              <input
                id={`${formId}-notes`}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                className={INPUT}
                data-testid="add-person-notes"
              />
            </Row>

            <Row
              label="Initial password"
              htmlFor={`${formId}-password`}
              hint="Shown once. Hand it over — the Bridge cannot email it yet."
            >
              <div className="flex gap-2">
                <input
                  id={`${formId}-password`}
                  required
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  className={`${INPUT} font-mono`}
                  data-testid="add-person-password"
                />
                <button
                  type="button"
                  onClick={() => set('password', generatePassword())}
                  className="text-[11px] font-bold px-2.5 rounded border border-de text-de bg-de-bg hover:opacity-90 whitespace-nowrap"
                  data-testid="add-person-generate"
                >
                  Generate
                </button>
              </div>
            </Row>

            <PlatePreview plate={plate} />

            {errorMessage && (
              <div
                className="text-[11px] rounded border px-2.5 py-2"
                style={{
                  borderColor: 'var(--color-er-border)',
                  background: 'var(--color-er-bg)',
                  color: 'var(--color-er)',
                }}
                role="alert"
                data-testid="add-person-error"
              >
                {errorMessage}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={create.isPending}
                className="text-[12px] font-bold px-3 py-1.5 rounded border border-de bg-de text-white disabled:opacity-50"
                data-testid="add-person-submit"
              >
                {create.isPending ? 'Creating…' : 'Create login'}
              </button>
              <button
                type="button"
                onClick={close}
                className="text-[12px] px-3 py-1.5 rounded border border-border text-muted hover:text-text"
                data-testid="add-person-cancel"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** ★ `profiles.role` / `tenant_memberships.role` are two stored keys, and the
 *  same rule applies to them as to a roster role: name them, never print them.
 *  Matches the wording AdminAccountTab uses for the signed-in person. */
const BRIDGE_ACCESS_LABEL: Record<'admin' | 'editor', string> = {
  admin: 'Admin',
  editor: 'Editor',
};

const INPUT =
  'w-full text-[12px] px-2 py-1.5 rounded border border-border bg-bg text-text focus:outline-none focus:border-de';

function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[10px] uppercase tracking-wide text-dim font-semibold mb-1"
      >
        {label}
      </label>
      {children}
      {hint && <div className="text-[10px] text-dim mt-0.5">{hint}</div>}
    </div>
  );
}

/** ★★ C2 — WHAT THE PERSON WILL SEE, built the way Chrome builds it. */
function PlatePreview({ plate }: { plate: { name: string; title: string } }) {
  return (
    <div
      className="rounded border px-2.5 py-2 flex items-center gap-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
      data-testid="add-person-plate"
    >
      <span className="text-[10px] uppercase tracking-wide text-dim font-semibold">
        Their name plate
      </span>
      <div className="leading-tight ml-auto text-right">
        <div
          className="font-display font-semibold text-text"
          style={{ fontSize: 12.5 }}
          data-testid="add-person-plate-name"
        >
          {plate.name}
        </div>
        <div className="text-dim" style={{ fontSize: 10.5 }} data-testid="add-person-plate-title">
          {plate.title}
        </div>
      </div>
    </div>
  );
}

function Created({
  result,
  plate,
  password,
  onDone,
}: {
  result: AddPersonSuccess;
  plate: { name: string; title: string };
  password: string;
  onDone: () => void;
}) {
  return (
    <div className="px-5 py-4 space-y-3" data-testid="add-person-success">
      <div className="text-[12px] text-text font-semibold">
        {result.email} can sign in now.
      </div>
      <PlatePreview plate={plate} />
      <div
        className="rounded border px-2.5 py-2 text-[11px]"
        style={{ borderColor: 'var(--color-co-border)', background: 'var(--color-co-bg)' }}
        data-testid="add-person-password-readout"
      >
        <div className="text-co font-bold mb-1">
          Password — shown once, copy it now
        </div>
        <code className="font-mono text-[12px] text-text break-all">{password}</code>
      </div>
      {/* ★★★ fix-343's rule, enforced by RoleLabelsFix343's source scan and
          caught by it here: NO STORED ROLE REACHES THE SCREEN. The first draft
          of this receipt printed `da` and `editor` straight out of the
          response, which is the exact "ENT underscore lead" Bobby complained
          about, in a new place. Both go through a label. */}
      <ul className="text-[11px] text-muted list-disc pl-4 space-y-0.5" data-testid="add-person-receipt">
        <li>
          Roster row{' '}
          {result.roster.action === 'inserted' ? 'created' : 'reused and filled in'} —{' '}
          <span className="font-semibold text-text">
            {result.roster.name} · {ROLE_TITLE[result.roster.role]}
          </span>
        </li>
        <li>
          Bridge access:{' '}
          <span className="font-semibold text-text">
            {BRIDGE_ACCESS_LABEL[result.membership.role]}
          </span>{' '}
          ({result.membership.source === 'trigger'
            ? 'membership already existed'
            : 'membership added for this address'}
          )
        </li>
        {result.roster.was_retired && (
          <li className="text-co">
            That roster row is marked former — reactivate it in the roster below
            if they are back.
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={onDone}
        className="text-[12px] font-bold px-3 py-1.5 rounded border border-de bg-de text-white"
        data-testid="add-person-done"
      >
        Done
      </button>
    </div>
  );
}
