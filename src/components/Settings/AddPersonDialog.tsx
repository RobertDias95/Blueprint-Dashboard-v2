import { useId, useState } from 'react';
import {
  reportWelcomeFailure,
  useCreateBridgeUser,
  useResendWelcome,
} from '../../hooks/useCreateBridgeUser';
import {
  ADD_PERSON_ROLE_OPTIONS,
  DEFAULT_DEPARTMENT_FOR_ROLE,
  generatePassword,
  welcomePlate,
} from '../../lib/addPerson';
import { useDepartments } from '../../hooks/useDepartments';
import { welcomeAreas } from '../../lib/welcomeAreas';
import { ROLE_TITLE } from '../../lib/roleLabels';
// ★ fix-487 §B: the label + input shell moved to `personFields` so the details
//   dialog renders the SAME three fields rather than a copy of them.
import { PERSON_FIELD_INPUT as INPUT, PersonFieldRow as Row } from './personFields';
import type { TeamRole } from '../../lib/database.types';
import type {
  AddPersonSuccess,
  WelcomeOutcome,
  WelcomeRequest,
} from '../../../supabase/functions/admin-create-user/handler';
import { useDirtySurface } from '../../hooks/useDirtySurface';

// ===========================================================================
// ★★★ fix-436 §C (P-086) — Bobby adds the person
// ===========================================================================
//
// Darin and Eric were created on 2026-08-28 by hand-writing `auth.users`,
// because there was no screen. This is the screen.
//
// ★★★ fix-670 §C: SUPERSEDED BY DEFAULT — the Bridge now sends mail (fix-628),
// so "Send welcome email" is ticked by default: no password is generated or
// shown, and the person sets their own from a code in the email. Unticked, the
// paragraph below still describes exactly what happens.
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
  /** ★ fix-670 §B: a `departments.key`, or '' when not picked. */
  department: string;
  /** ★ fix-670 §C: on by default. */
  send_welcome: boolean;
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
  department: DEFAULT_DEPARTMENT_FOR_ROLE.da ?? '',
  send_welcome: true,
};

export default function AddPersonDialog({ open, onClose }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  // ★ fix-595: a half-filled new-person form. `EMPTY` is the clean state, so
  //   any field with something in it counts.
  useDirtySurface(
    'add-person',
    open && Object.values(form).some((v) => typeof v === 'string' && v.trim() !== ''),
  );
  // ★ The roster name defaults to the first name (house convention) but stops
  //   following it the moment somebody types a different one — two people
  //   called Chris need two different join keys.
  const [nameTouched, setNameTouched] = useState(false);
  // ★ fix-670 §B: the department follows the role until somebody picks one.
  const [deptTouched, setDeptTouched] = useState(false);
  const [done, setDone] = useState<AddPersonSuccess | null>(null);
  const create = useCreateBridgeUser();
  const departments = useDepartments();
  const formId = useId();

  const rosterName = nameTouched ? form.name : form.first_name;
  const departmentWords = form.department
    ? (departments.labels.get(form.department) ?? form.department)
    : null;
  const plate = welcomePlate(
    rosterName,
    form.role,
    form.notes.trim() === '' ? null : form.notes,
    departmentWords,
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setRole(role: TeamRole) {
    setForm((f) => ({
      ...f,
      role,
      // ★★ A viewer has NO default: their department is their label, so it is
      //    picked on purpose — never inherited from the last role clicked.
      department: deptTouched ? f.department : (DEFAULT_DEPARTMENT_FOR_ROLE[role] ?? ''),
    }));
  }

  /** What the welcome email needs — the preview line and the areas this
   *  person can open, from lib/ribbonNav. */
  const welcome: WelcomeRequest = {
    plate: plate.line,
    areas: welcomeAreas(form.role, form.bridge_role === 'admin'),
  };

  function close() {
    setForm(EMPTY);
    setNameTouched(false);
    setDeptTouched(false);
    setDone(null);
    create.reset();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        email: form.email.trim(),
        password: form.send_welcome ? '' : form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        name: rosterName.trim(),
        role: form.role,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
        bridge_role: form.bridge_role,
        department: form.department || null,
        send_welcome: form.send_welcome,
        welcome: form.send_welcome ? welcome : null,
      },
      {
        onSuccess: (res) => {
          if (res.welcome && !res.welcome.sent) reportWelcomeFailure(res.welcome.error);
          setDone(res);
        },
      },
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
          <Created
            result={done}
            plate={plate}
            password={form.password}
            resend={{
              email: done.email,
              first_name: form.first_name.trim(),
              role: form.role,
              welcome,
            }}
            onDone={close}
          />
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
                  onChange={(e) => setRole(e.target.value as TeamRole)}
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
              label="Department"
              htmlFor={`${formId}-dept`}
              hint={
                form.role === 'viewer'
                  ? 'Their label on the Bridge — pick the department they work in.'
                  : 'Filled in from their role. Change it if they sit elsewhere.'
              }
            >
              <select
                id={`${formId}-dept`}
                // ★★ REQUIRED FOR A VIEWER: their department IS their label.
                required={form.role === 'viewer'}
                value={form.department}
                onChange={(e) => {
                  setDeptTouched(true);
                  set('department', e.target.value);
                }}
                className={INPUT}
                data-testid="add-person-department"
              >
                <option value="">
                  {form.role === 'viewer' ? 'Pick a department…' : 'No department'}
                </option>
                {departments.list.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Row>

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

            {/* ★★★ fix-670 §C — ON BY DEFAULT. The person sets their own
                password from a code in the email, so nobody generates, sees or
                hands over one. */}
            <label
              className="flex items-start gap-2 text-[12px] text-text"
              data-testid="add-person-send-welcome-row"
            >
              <input
                type="checkbox"
                checked={form.send_welcome}
                onChange={(e) => set('send_welcome', e.target.checked)}
                className="mt-0.5"
                data-testid="add-person-send-welcome"
              />
              <span>
                <span className="font-semibold">Send welcome email</span>
                <span className="block text-[11px] text-dim">
                  From bridge@blueprintcap.com. They set their own password with a
                  code in the email — no password to hand over.
                </span>
              </span>
            </label>

            {!form.send_welcome && (
              <Row
                label="Initial password"
                htmlFor={`${formId}-password`}
                hint="Shown once. Hand it to them yourself, or tick Send welcome email instead."
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
            )}

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

// ★★ fix-487 §B: `INPUT` and `Row` are IMPORTED now (see the top of the file),
//    not declared here. They were this dialog's private chrome; the details
//    dialog needs the same three fields, and the brief asked for reuse rather
//    than a second copy that starts identical and drifts.

/** ★★ C2 — WHAT THE PERSON WILL SEE, built the way Chrome builds it. */
function PlatePreview({ plate }: { plate: { name: string; title: string; line?: string } }) {
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
  resend,
  onDone,
}: {
  result: AddPersonSuccess;
  plate: { name: string; title: string };
  password: string;
  resend: { email: string; first_name: string; role: TeamRole; welcome: WelcomeRequest };
  onDone: () => void;
}) {
  const resendQ = useResendWelcome();
  // ★ fix-670 §C: the latest word on the email — the create call's, then any
  //   Resend's.
  const [welcome, setWelcome] = useState<WelcomeOutcome | null>(result.welcome ?? null);
  return (
    <div className="px-5 py-4 space-y-3" data-testid="add-person-success">
      <div className="text-[12px] text-text font-semibold">
        {result.welcome ? `${result.email} has a login.` : `${result.email} can sign in now.`}
      </div>
      <PlatePreview plate={plate} />
      {welcome?.sent === true && (
        <div
          className="rounded border px-2.5 py-2 text-[11px]"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
          data-testid="add-person-welcome-sent"
        >
          Welcome email sent to <strong>{result.email}</strong>. They set their own
          password from the code in it.
        </div>
      )}
      {welcome?.sent === false && (
        // ★★ THE LOGIN STILL EXISTS. Say so first, then why the mail did not
        //    go, then the way out.
        <div
          className="rounded border px-2.5 py-2 text-[11px] space-y-1.5"
          style={{
            borderColor: 'var(--color-er-border)',
            background: 'var(--color-er-bg)',
            color: 'var(--color-er)',
          }}
          role="alert"
          data-testid="add-person-welcome-failed"
        >
          <div>
            Login created — the welcome email didn&apos;t send ({welcome.error}).
          </div>
          <button
            type="button"
            disabled={resendQ.isPending}
            onClick={() =>
              resendQ.mutate(resend, {
                onSuccess: (res) => {
                  if (!res.welcome.sent) reportWelcomeFailure(res.welcome.error);
                  setWelcome(res.welcome);
                },
                onError: (e) => setWelcome({ sent: false, error: e.message }),
              })
            }
            className="text-[11px] font-bold px-2.5 py-1 rounded border border-de bg-de text-white disabled:opacity-50"
            data-testid="add-person-welcome-resend"
          >
            {resendQ.isPending ? 'Sending…' : 'Resend'}
          </button>
        </div>
      )}
      {!result.welcome && (
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
      )}
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
