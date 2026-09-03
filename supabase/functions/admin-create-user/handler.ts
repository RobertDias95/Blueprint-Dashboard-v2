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
}

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
  /** `profiles.role` for that id — the admin gate (A2). */
  profileRole(userId: string): Promise<BridgeRole | null>;
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
}

export interface RosterPatch {
  email: string;
  first_name: string;
  last_name: string;
  notes: string | null;
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

  const email = (raw.email ?? '').trim();
  if (!EMAIL_RE.test(email)) return bad('That is not a valid email address.', 'email');

  const password = raw.password ?? '';
  if (password.length < MIN_PASSWORD_LENGTH) {
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
    },
  };
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
  //    admin check is a courtesy; this one is the rule. Anything that is not
  //    profiles.role='admin' gets 403 whatever it sends.
  const callerRole = await deps.profileRole(callerId);
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

  const tenantId = await deps.callerTenantId(callerId);
  if (!tenantId) {
    return {
      ok: false,
      code: 'no_tenant',
      message: 'Your own account is not attached to an organization.',
    };
  }

  // ★ Checked BEFORE the auth user exists, so the common "this name is already
  //   somebody else's" mistake never needs a rollback at all.
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

  const created = await deps.createAuthUser(input.email, input.password);
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
      //    `profiles.role` gates the server-side admin RLS and is what THIS
      //    function's own gate reads, while `tenant_memberships.role` is what
      //    useIsTenantAdmin reads for the UI. Setting one and not the other is
      //    how somebody ends up able to see the admin screens and not write, or
      //    the reverse.
      await deps.setProfileRole(userId, 'admin');
    }

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
