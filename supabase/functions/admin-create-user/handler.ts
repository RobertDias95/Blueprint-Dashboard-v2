// ===========================================================================
// ★★★ fix-436 (P-086) — adding a person, without Claude writing auth.users
// ===========================================================================
//
// Darin and Eric were created on 2026-08-28 by hand-writing `auth.users`.
// Bobby ruled this the ticket after the password reset (fix-426): he adds the
// next person himself.
//
// ★★★ THIS FILE IS DELIBERATELY FREE OF DENO, OF `fetch`, AND OF THE SUPABASE
// CLIENT. Everything it needs arrives through the `Deps` interface, so the
// whole decision tree — the admin gate, the roster reuse rule, the rollback —
// is exercised by vitest in CI, which has neither a Deno runtime nor a
// database. `index.ts` next door is the ten lines that bind these operations to
// a real service-role client. The service-role key is read there, from
// `Deno.env`, and never crosses into the browser.
//
// ★★ WHAT THE DATABASE ALREADY DOES, AND THIS MUST NOT REPEAT (measured on
// prod 2026-08-29). `handle_new_user` is an AFTER INSERT trigger on
// `auth.users`:
//
//     insert into profiles (id, email, role) values (new.id, new.email, 'editor')
//     if lower(split_part(new.email,'@',2)) = 'blueprintcap.com' then
//       insert into tenant_memberships (user_id, tenant, 'editor')   -- guarded
//
// So by the time `createAuthUser` returns, the profile EXISTS and — for a
// @blueprintcap.com address only — so does the membership. Inserting either one
// here would be a duplicate-key error on the profile and a second membership
// row on the other. What is left for this function is the two things the
// trigger cannot know: the ADMIN tier, and a membership for an address outside
// the domain.
//
// ★★ `profiles_role_check` allows `admin` and `editor` ONLY. There is no
// read-only tier, so "Bridge access" is a two-way switch and this file refuses
// anything else rather than letting the constraint refuse it later.

import {
  WELCOME_AREA_KEYS,
  renderWelcomeEmail,
  type WelcomeAreaKey,
  type WelcomeEmail,
} from './welcome.ts';

// ---------------------------------------------------------------------------
// Vocabulary — kept in step with src/lib/database.types.ts TeamRole by a test
// ---------------------------------------------------------------------------

/** `team_members.role`. Mirrors TeamRole in src/lib/database.types.ts; a test
 *  asserts the two lists are identical, because this file cannot import from
 *  `src/` (Deno would have to resolve the whole app tree to run it). */
export const TEAM_ROLES = [
  'director',
  'ent_lead',
  'ent',
  'dm',
  'da',
  'schematic',
  'acq_lead',
  'acq',
  // ★ fix-487 (P-144). The twin test is what makes this line non-optional.
  'ca',
  'viewer',
] as const;
export type TeamRoleName = (typeof TEAM_ROLES)[number];

/** `profiles.role` / `tenant_memberships.role`. Two values, by CHECK constraint. */
export const BRIDGE_ROLES = ['admin', 'editor'] as const;
export type BridgeRole = (typeof BRIDGE_ROLES)[number];

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface AddPersonRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  /** The roster JOIN KEY. House convention is the first name alone. */
  name: string;
  role: TeamRoleName;
  /** Printed verbatim as the job title when `role` is `viewer` (fix-343). */
  notes: string | null;
  bridge_role: BridgeRole;
  /** ★ fix-670 §B: a `departments.key`. Required for a `viewer` — their
   *  department IS their label — optional for everyone else. */
  department?: string | null;
  /** ★ fix-670 §C: send the welcome email instead of handing over a password.
   *  When true, `password` is ignored and a random one nobody sees is set. */
  send_welcome?: boolean;
  /** What the welcome email needs from the client: the name plate it previewed
   *  and the areas `lib/ribbonNav` says this person can open. */
  welcome?: WelcomeRequest | null;
}

export interface WelcomeRequest {
  plate: string;
  areas: WelcomeAreaKey[];
}

/** ★ fix-670 §C: the outcome of the welcome email, reported beside the login.
 *  A failed send never undoes the login — it is reported, with a reason, so the
 *  screen can offer Resend. `null` when no email was asked for. */
export type WelcomeOutcome = { sent: true } | { sent: false; error: string };

export type AddPersonErrorCode =
  | 'unauthenticated'
  | 'not_admin'
  | 'invalid'
  | 'email_taken'
  | 'roster_name_taken'
  | 'no_tenant'
  | 'create_failed'
  | 'roster_failed';

export interface AddPersonFailure {
  ok: false;
  code: AddPersonErrorCode;
  /** Plain language, shown to Bobby as-is. */
  message: string;
  /** Which field to point at, when there is one. */
  field?: keyof AddPersonRequest;
}

export interface AddPersonSuccess {
  ok: true;
  user_id: string;
  email: string;
  /** What actually happened to each row, so the screen can say it. */
  roster: {
    action: 'inserted' | 'reused';
    id: string | null;
    name: string;
    role: TeamRoleName;
    /** ★ A reused row that is retired is reported, never silently revived —
     *  fix-407's two-flag rule is somebody else's decision to make. */
    was_retired: boolean;
  };
  profile: { role: BridgeRole; created_by: 'trigger' };
  membership: { role: BridgeRole; source: 'trigger' | 'function' };
  welcome: WelcomeOutcome | null;
}

export type AddPersonResult = AddPersonSuccess | AddPersonFailure;

/** HTTP status for each failure, so index.ts has no opinion of its own. */
export const ERROR_STATUS: Record<AddPersonErrorCode, number> = {
  unauthenticated: 401,
  not_admin: 403,
  invalid: 400,
  email_taken: 409,
  roster_name_taken: 409,
  no_tenant: 409,
  create_failed: 500,
  roster_failed: 500,
};

export interface RosterRow {
  id: string;
  name: string;
  role: string;
  email: string | null;
  active: boolean | null;
  former: boolean | null;
}

/** Every effect the orchestration needs. `index.ts` supplies real ones. */
export interface Deps {
  /** Resolve the bearer token to a user id, or null when it is not valid. */
  callerId(jwt: string): Promise<string | null>;
  /**
   * The caller's `tenant_memberships.role` for the tenant being written to —
   * the admin gate (A2).
   *
   * ★★★ fix-608 §C.2: THIS USED TO BE `profileRole`, reading `profiles.role`.
   *     Two stored keys answered "is this person an admin" and they had drifted:
   *     measured on prod 2026-09-30, 8 admins in `tenant_memberships`, 7 in
   *     `profiles`. The one who differed saw the admin screens and was refused by
   *     this function. `tenant_memberships` is what `useIsTenantAdmin` and
   *     `is_tenant_admin()` read, so it is the one source now.
   *
   * ★★ `profiles.role` IS STILL WRITTEN — see `setProfileRole`, unchanged. Only
   *    the GATES stopped reading it.
   */
  membershipRole(userId: string, tenantId: string): Promise<BridgeRole | null>;
  /** The tenant the CALLER belongs to. Never taken from the request body. */
  callerTenantId(userId: string): Promise<string | null>;
  createAuthUser(email: string, password: string): Promise<
    { id: string } | { error: string; taken?: boolean }
  >;
  deleteAuthUser(userId: string): Promise<void>;
  /** Rows matching the roster name OR the email, case-insensitively. */
  findRosterRows(name: string, email: string, tenantId: string): Promise<RosterRow[]>;
  updateRosterRow(id: string, patch: RosterPatch): Promise<void>;
  insertRosterRow(row: RosterInsert): Promise<string>;
  /** Make the membership say `role`, whether or not the trigger already made
   *  one. Inserts when missing, UPDATES when present with a different role
   *  (the trigger always writes 'editor'). Returns true when it had to insert,
   *  which is exactly the non-@blueprintcap.com case the trigger skips. */
  ensureMembership(userId: string, tenantId: string, role: BridgeRole): Promise<boolean>;
  setProfileRole(userId: string, role: BridgeRole): Promise<void>;

  // ★ fix-670 ---------------------------------------------------------------
  /** Is `key` a row in `departments` for this tenant? */
  departmentExists(tenantId: string, key: string): Promise<boolean>;
  /** The caller's roster first name — "Bobby has set you up". profiles.name is
   *  NULL for every login (fix-330), so this reads team_members by email. */
  callerFirstName(userId: string, tenantId: string): Promise<string | null>;
  /** A strong random password nobody will ever see (welcome path). */
  randomPassword(): string;
  /** A recovery code for an existing login, via admin `generateLink` — which
   *  does NOT send Supabase's own email. */
  recoveryCode(email: string): Promise<{ code: string } | { error: string }>;
  /** Send through bridge@ (fix-628). Never throws for a send failure. */
  sendWelcome(
    to: string,
    email: WelcomeEmail,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** One `email_outbox` row per attempt. Must not throw. */
  recordOutbox(row: {
    kind: string;
    to_email: string;
    subject: string;
    status: 'sent' | 'failed';
    error: string | null;
  }): Promise<void>;
}

export interface RosterPatch {
  email: string;
  first_name: string;
  last_name: string;
  notes: string | null;
  /** ★ fix-670: only sent when the dialog picked one, so a reused row's
   *  existing department is never blanked. */
  department?: string;
}

export interface RosterInsert extends RosterPatch {
  name: string;
  role: TeamRoleName;
  tenant_id: string;
  active: true;
  former: false;
}

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

export function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** ★ The same normalisation `resolveRosterIdentity` uses (src/lib/selfScope):
 *  trim + lowercase. The name plate matches the auth email to
 *  `team_members.email` that way, which is the whole reason the roster row is
 *  mandatory in this flow — an auth user with no matching roster row gets no
 *  name and no title on screen. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 10;

export function validateAddPerson(
  raw: Partial<AddPersonRequest> | null | undefined,
): { ok: true; value: AddPersonRequest } | AddPersonFailure {
  const bad = (message: string, field?: keyof AddPersonRequest): AddPersonFailure => ({
    ok: false,
    code: 'invalid',
    message,
    field,
  });
  if (!raw || typeof raw !== 'object') return bad('No details were sent.');

  // ★ fix-674 (P-354): STORED lowercase, not only matched lowercase — the
  //   login, the roster row and the welcome email all take this value. Jeanne
  //   and Kerry were saved as typed ("Jeanne@…") and Cowork had to fix them.
  const email = norm(raw.email);
  if (!EMAIL_RE.test(email)) return bad('That is not a valid email address.', 'email');

  // ★ fix-670 §C: with the welcome email the person sets their own password,
  //   so none is asked for here (a random one is set server-side).
  const send_welcome = raw.send_welcome === true;
  const password = send_welcome ? '' : raw.password ?? '';
  if (!send_welcome && password.length < MIN_PASSWORD_LENGTH) {
    return bad(
      `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
      'password',
    );
  }

  const first_name = (raw.first_name ?? '').trim();
  if (first_name === '') return bad('First name is required.', 'first_name');
  const last_name = (raw.last_name ?? '').trim();
  if (last_name === '') return bad('Last name is required.', 'last_name');

  // ★ Defaults to the first name, which is the house convention for the join
  //   key — but it is a separate field because two people can share one.
  const name = ((raw.name ?? '').trim() || first_name).trim();
  if (name === '') return bad('Roster name is required.', 'name');

  const role = raw.role as TeamRoleName;
  if (!TEAM_ROLES.includes(role)) return bad('Pick a roster role.', 'role');

  const bridge_role = raw.bridge_role as BridgeRole;
  if (!BRIDGE_ROLES.includes(bridge_role)) {
    return bad('Bridge access must be Editor or Admin.', 'bridge_role');
  }

  // ★★ fix-670 §B: a viewer's department IS their label (fix-652: it wins on
  //    the name plate), so a viewer must have one. Everyone else may leave it.
  const department = (raw.department ?? '').trim() || null;
  if (department !== null && !DEPARTMENT_KEY_RE.test(department)) {
    return bad('That department is not on the list.', 'department');
  }
  if (role === 'viewer' && department === null) {
    return bad(
      "Pick a department — for someone who views, it's the label people see.",
      'department',
    );
  }

  const notesRaw = (raw.notes ?? '').trim();
  return {
    ok: true,
    value: {
      email,
      password,
      first_name,
      last_name,
      name,
      role,
      notes: notesRaw === '' ? null : notesRaw,
      bridge_role,
      department,
      send_welcome,
      welcome: send_welcome ? cleanWelcome(raw.welcome, first_name) : null,
    },
  };
}

/** The shape `departments.key` is constrained to (the migration's CHECK). */
export const DEPARTMENT_KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** ★ The plate is the client's preview; it is escaped when rendered, and
 *  capped so a pasted essay cannot become an email. Areas are kept only when
 *  they are keys this function has words for. */
export function cleanWelcome(
  raw: Partial<WelcomeRequest> | null | undefined,
  firstName: string,
): WelcomeRequest {
  const plate = (raw?.plate ?? '').trim().slice(0, 120) || firstName;
  const given: unknown[] = Array.isArray(raw?.areas) ? (raw?.areas as unknown[]) : [];
  const areas = WELCOME_AREA_KEYS.filter((k) => given.includes(k));
  return { plate, areas };
}

/** Mask a run of digits, exactly as graphMail.redactSubject does, so the
 *  outbox CHECK (no 6-digit run) can never refuse a welcome row. */
function redact(subject: string): string {
  return subject.replace(/\d{4,}/g, (m) => '•'.repeat(m.length));
}

/**
 * ★★★ fix-670 §C — SEND THE WELCOME EMAIL FOR A LOGIN THAT EXISTS.
 *
 * Shared by the create path and Resend. It NEVER throws: every failure becomes
 * `{ sent: false, error }`, because by the time this runs the login exists and
 * must stay existing — the screen offers Resend instead.
 */
export async function sendWelcomeFor(
  deps: Deps,
  args: {
    callerId: string;
    tenantId: string;
    email: string;
    first_name: string;
    role: TeamRoleName;
    welcome: WelcomeRequest;
  },
): Promise<WelcomeOutcome> {
  let subject = `Welcome to the Bridge, ${args.first_name}`;
  const record = (status: 'sent' | 'failed', error: string | null) =>
    deps
      .recordOutbox({
        kind: 'welcome',
        to_email: args.email,
        subject: redact(subject),
        status,
        error,
      })
      .catch(() => {});
  try {
    const code = await deps.recoveryCode(args.email);
    if ('error' in code) {
      const error = `Could not make a sign-in code — ${code.error}`;
      await record('failed', error);
      return { sent: false, error };
    }
    const adder = await deps.callerFirstName(args.callerId, args.tenantId).catch(() => null);
    const email = renderWelcomeEmail({
      audience: args.role === 'viewer' ? 'viewer' : 'works',
      firstName: args.first_name,
      adderFirstName: adder,
      plate: args.welcome.plate,
      email: args.email,
      code: code.code,
      areas: args.welcome.areas,
    });
    subject = email.subject;
    const res = await deps.sendWelcome(args.email, email);
    if (res.ok) {
      await record('sent', null);
      return { sent: true };
    }
    await record('failed', res.error);
    return { sent: false, error: res.error };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await record('failed', error);
    return { sent: false, error };
  }
}

export type RosterAction =
  | { kind: 'reuse'; row: RosterRow }
  | { kind: 'insert' }
  | { kind: 'conflict'; heldBy: string };

/**
 * ★★★ A5 — REUSE BEFORE INSERT, AND THE KEY IS NOT WHAT IT LOOKS LIKE.
 *
 * `team_members` is UNIQUE on **(name, role)**, not on name: a person holds one
 * ROW PER ROLE (Derry and Lindsay each hold `dm` and `schematic`; Dave holds
 * `director` and `schematic`). So "does this name exist" is not the question a
 * unique index would answer, and an insert keyed on the name alone would either
 * collide or duplicate depending on the role.
 *
 * The order is deliberate:
 *
 *   1. THE EMAIL WINS. It is what `resolveRosterIdentity` matches on, so a row
 *      already carrying this address IS this person, whatever it is called.
 *   2. Then (name, role) exactly — the row this person would have had.
 *   3. Then the name alone — Darin's case: `Darin`/`viewer` sat with a NULL
 *      email for ten days after his login was hand-made. That row is him.
 *   4. Otherwise insert.
 *
 * ★★★ AND THE GUARD THAT MAKES 3 SAFE: if a name-matched row already carries a
 * DIFFERENT email, it belongs to somebody else and reuse would hand one
 * person's assignments to another. The roster has `Eric` (viewer,
 * eric@blueprintcap.com) and `Erick` (da, eruivo@blueprintcap.com) — one letter
 * apart — so this is not hypothetical. That case is a refusal, never a merge.
 */
export function resolveRosterAction(
  rows: readonly RosterRow[],
  input: Pick<AddPersonRequest, 'name' | 'role' | 'email'>,
): RosterAction {
  const wantEmail = norm(input.email);
  const wantName = norm(input.name);

  const byEmail = rows.filter((r) => norm(r.email) !== '' && norm(r.email) === wantEmail);
  if (byEmail.length > 0) return { kind: 'reuse', row: byEmail[0] };

  const byName = rows.filter((r) => norm(r.name) === wantName);
  if (byName.length === 0) return { kind: 'insert' };

  const heldByOther = byName.find(
    (r) => norm(r.email) !== '' && norm(r.email) !== wantEmail,
  );
  if (heldByOther) return { kind: 'conflict', heldBy: heldByOther.email ?? '' };

  const exact = byName.find((r) => r.role === input.role);
  return { kind: 'reuse', row: exact ?? byName[0] };
}

// ---------------------------------------------------------------------------
// The orchestration
// ---------------------------------------------------------------------------

/**
 * ★★★ A6 — ONE LOGICAL OPERATION. NO HALF-PEOPLE.
 *
 * Everything after `createAuthUser` runs inside a try; anything that throws
 * deletes the auth user before returning the error. A login with no roster row
 * is precisely the state this ticket exists to stop being created by hand: the
 * person can sign in and the Bridge shows them no name, no title and no work,
 * because `resolveRosterIdentity` has nothing to match their address to.
 *
 * ★ The auth user is created LAST of the things that can be checked cheaply —
 * validation and the admin gate both run first — so the rollback path is as
 * narrow as it can be.
 */
export async function createPerson(
  deps: Deps,
  jwt: string | null,
  raw: Partial<AddPersonRequest> | null,
): Promise<AddPersonResult> {
  if (!jwt) {
    return { ok: false, code: 'unauthenticated', message: 'Please sign in again.' };
  }
  const callerId = await deps.callerId(jwt);
  if (!callerId) {
    return { ok: false, code: 'unauthenticated', message: 'Please sign in again.' };
  }

  // ★★ A2 — THE GATE IS HERE, IN THE FUNCTION, NOT IN THE SCREEN. The screen's
  //    admin check is a courtesy; this one is the rule. Anything that is not an
  //    admin of the tenant being written to gets 403 whatever it sends.
  //
  // ★★★ fix-608 §C.2: THE TENANT IS NOW RESOLVED FIRST, BECAUSE THE QUESTION
  //     NEEDS IT. "Is this person an admin" is not answerable on its own — only
  //     "is this person an admin OF THE TENANT this row is going into" is, and
  //     that is the question `tenant_memberships` answers. The reorder is
  //     deliberate and it changes one thing: somebody with no tenant at all now
  //     gets `no_tenant` instead of `not_admin`, which is the more accurate of
  //     the two and is asserted in the tests.
  const tenantId = await deps.callerTenantId(callerId);
  if (!tenantId) {
    return {
      ok: false,
      code: 'no_tenant',
      message: 'Your own account is not attached to an organization.',
    };
  }

  const callerRole = await deps.membershipRole(callerId, tenantId);
  if (callerRole !== 'admin') {
    return {
      ok: false,
      code: 'not_admin',
      message: 'You are not an admin, so you cannot add people.',
    };
  }

  const parsed = validateAddPerson(raw);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  // ★ Checked BEFORE the auth user exists, so the common "this name is already
  //   somebody else's" mistake never needs a rollback at all.
  // ★ fix-670 §B: checked BEFORE the login exists, so a stale picker cannot
  //   create a login and then have its roster row refused by the FK.
  if (
    input.department &&
    !(await deps.departmentExists(tenantId, input.department))
  ) {
    return {
      ok: false,
      code: 'invalid',
      field: 'department',
      message: 'That department is no longer on the list. Pick another.',
    };
  }

  const existing = await deps.findRosterRows(input.name, input.email, tenantId);
  const action = resolveRosterAction(existing, input);
  if (action.kind === 'conflict') {
    return {
      ok: false,
      code: 'roster_name_taken',
      field: 'name',
      message: `That roster name already belongs to ${action.heldBy}. Pick a different one — the roster name is how work is attributed.`,
    };
  }

  const created = await deps.createAuthUser(
    input.email,
    input.send_welcome ? deps.randomPassword() : input.password,
  );
  if ('error' in created) {
    return {
      ok: false,
      code: created.taken ? 'email_taken' : 'create_failed',
      field: created.taken ? 'email' : undefined,
      message: created.taken
        ? 'That email already has a login.'
        : `Could not create the login — ${created.error}`,
    };
  }

  const userId = created.id;
  try {
    const patch: RosterPatch = {
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
      notes: input.notes,
      ...(input.department ? { department: input.department } : {}),
    };
    let roster: AddPersonSuccess['roster'];
    if (action.kind === 'reuse') {
      await deps.updateRosterRow(action.row.id, patch);
      roster = {
        action: 'reused',
        id: action.row.id,
        name: action.row.name,
        role: action.row.role as TeamRoleName,
        was_retired: action.row.active === false || action.row.former === true,
      };
    } else {
      const id = await deps.insertRosterRow({
        ...patch,
        name: input.name,
        role: input.role,
        tenant_id: tenantId,
        active: true,
        former: false,
      });
      roster = {
        action: 'inserted',
        id,
        name: input.name,
        role: input.role,
        was_retired: false,
      };
    }

    // ★★ A4 — the two things the trigger cannot do.
    //
    // The membership call is idempotent and REPORTS whether it wrote: for a
    // @blueprintcap.com address the trigger already inserted one, and for
    // anything else it deliberately did not (the domain guard is the org access
    // gate, and this function is the manual grant it was written to require).
    // ★ `ensureMembership` carries the role, so an admin's membership is set
    //   here whether the trigger made the row (blueprintcap) or this did.
    const inserted = await deps.ensureMembership(userId, tenantId, input.bridge_role);
    if (input.bridge_role === 'admin') {
      // ★★ BOTH ROWS, because they are read by different things:
      //    `profiles.role` gated the server-side admin RLS and was what THIS
      //    function's own gate read (fix-608 §C moved both to
      //    `tenant_memberships`), while `tenant_memberships.role` is what
      //    useIsTenantAdmin reads for the UI. Setting one and not the other is
      //    how somebody ends up able to see the admin screens and not write, or
      //    the reverse.
      await deps.setProfileRole(userId, 'admin');
    }

    // ★★ fix-670 §C: AFTER everything else succeeded, and outside the
    //    rollback — a mail failure must never delete a good login.
    const welcome =
      input.send_welcome && input.welcome
        ? await sendWelcomeFor(deps, {
            callerId,
            tenantId,
            email: input.email,
            first_name: input.first_name,
            role: input.role,
            welcome: input.welcome,
          })
        : null;

    return {
      ok: true,
      user_id: userId,
      email: input.email,
      roster,
      profile: { role: input.bridge_role, created_by: 'trigger' },
      membership: {
        role: input.bridge_role,
        source: inserted ? 'function' : 'trigger',
      },
      welcome,
    };
  } catch (e) {
    // ★★★ ROLLBACK. The login must not outlive the failure that stopped its
    // roster row being written.
    await deps.deleteAuthUser(userId).catch(() => {});
    return {
      ok: false,
      code: 'roster_failed',
      message: `The login was rolled back — the roster row could not be written: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

// ===========================================================================
// ★★ fix-670 §C — RESEND, for a login that already exists
// ===========================================================================
//
// The Add Person screen offers it when the first send failed. Same admin gate
// as creating; and the address must belong to a roster row in the CALLER's
// organization, so an admin cannot mail a sign-in code to another org's login.

export interface ResendWelcomeRequest {
  action: 'resend_welcome';
  email: string;
  first_name: string;
  role: TeamRoleName;
  welcome: WelcomeRequest;
}

export type ResendWelcomeResult = { ok: true; welcome: WelcomeOutcome } | AddPersonFailure;

export async function resendWelcome(
  deps: Deps,
  jwt: string | null,
  raw: Partial<ResendWelcomeRequest> | null,
): Promise<ResendWelcomeResult> {
  const signIn: AddPersonFailure = {
    ok: false,
    code: 'unauthenticated',
    message: 'Please sign in again.',
  };
  if (!jwt) return signIn;
  const callerId = await deps.callerId(jwt);
  if (!callerId) return signIn;
  const tenantId = await deps.callerTenantId(callerId);
  if (!tenantId) {
    return {
      ok: false,
      code: 'no_tenant',
      message: 'Your own account is not attached to an organization.',
    };
  }
  if ((await deps.membershipRole(callerId, tenantId)) !== 'admin') {
    return {
      ok: false,
      code: 'not_admin',
      message: 'You are not an admin, so you cannot send this.',
    };
  }
  const email = norm(raw?.email);
  if (!EMAIL_RE.test(email)) {
    return {
      ok: false,
      code: 'invalid',
      field: 'email',
      message: 'That is not a valid email address.',
    };
  }
  const first_name = (raw?.first_name ?? '').trim();
  if (first_name === '') {
    return {
      ok: false,
      code: 'invalid',
      field: 'first_name',
      message: 'First name is required.',
    };
  }
  const role = raw?.role as TeamRoleName;
  if (!TEAM_ROLES.includes(role)) {
    return { ok: false, code: 'invalid', field: 'role', message: 'Pick a roster role.' };
  }
  const rows = await deps.findRosterRows(first_name, email, tenantId);
  if (!rows.some((r) => norm(r.email) === norm(email))) {
    return {
      ok: false,
      code: 'invalid',
      field: 'email',
      message: 'Nobody on your roster has that sign-in email.',
    };
  }
  const welcome = await sendWelcomeFor(deps, {
    callerId,
    tenantId,
    email,
    first_name,
    role,
    welcome: cleanWelcome(raw?.welcome, first_name),
  });
  return { ok: true, welcome };
}
