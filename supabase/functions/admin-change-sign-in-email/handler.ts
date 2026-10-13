// ===========================================================================
// ★★★ fix-659 (P-318, Settings audit census 42) — ONE EMAIL, NOT TWO
// ===========================================================================
//
// Bobby, 2026-10-12: *"Changing someone's email in People doesn't update their
// login, so the two can disagree."*
//
// A person's email lived in two places that nothing kept together:
//
//     auth.users.email   (+ profiles.email, written by handle_new_user)
//     team_members.email (one copy per roster ROW — seven people carry two)
//
// `resolveRosterIdentity` joins the signed-in address to `team_members.email`,
// so editing the roster copy alone (People → Save) did not move the login — it
// DETACHED it: the person signs in with the old address and the Bridge no
// longer knows who they are.
//
// ★★★ THE RULE NOW: for somebody WITH a login, the login address is the
// truth and this function is the only way to change it. It moves all three
// copies together — auth, profile, every roster row of that name — and puts
// auth back if the later writes fail. `bp_set_person_details` refuses an email
// change for such a person (fix-659 migration), so the People Save button can
// no longer split them. People WITHOUT a login keep a plain editable email.
//
// ★★ SAME SHAPE AS admin-create-user (fix-436): this file has no Deno, no
// fetch and no Supabase client, so CI runs every branch of it with fakes.
// `index.ts` binds `Deps` to a service-role client.

/** The browser sends the roster name (the join key) and the new address. Who
 *  is asking and which tenant come from the token, never from the body. */
export interface ChangeSignInEmailRequest {
  name: string;
  new_email: string;
}

export type ChangeSignInEmailErrorCode =
  | 'unauthenticated'
  | 'no_tenant'
  | 'not_admin'
  | 'invalid'
  | 'not_found'
  | 'no_login'
  | 'email_taken'
  | 'auth_failed'
  | 'roster_failed';

export interface ChangeSignInEmailFailure {
  ok: false;
  code: ChangeSignInEmailErrorCode;
  /** Plain language, shown as-is. */
  message: string;
}

export interface ChangeSignInEmailSuccess {
  ok: true;
  name: string;
  old_email: string;
  new_email: string;
  /** Roster rows moved — said out loud, the fix-487 way. */
  roster_rows: number;
  /** True when the new address equals the old one (case-insensitively). */
  unchanged: boolean;
}

export type ChangeSignInEmailResult =
  | ChangeSignInEmailSuccess
  | ChangeSignInEmailFailure;

export const ERROR_STATUS: Record<ChangeSignInEmailErrorCode, number> = {
  unauthenticated: 401,
  no_tenant: 409,
  not_admin: 403,
  invalid: 400,
  not_found: 404,
  no_login: 409,
  email_taken: 409,
  auth_failed: 500,
  roster_failed: 500,
};

export interface Login {
  id: string;
  email: string;
}

export interface Deps {
  callerId(jwt: string): Promise<string | null>;
  callerTenantId(userId: string): Promise<string | null>;
  /** `tenant_memberships.role` — the same gate admin-create-user uses (fix-608). */
  membershipRole(userId: string, tenantId: string): Promise<string | null>;
  /** The roster rows carrying this exact name in this tenant. */
  rosterEmailsForName(name: string, tenantId: string): Promise<Array<string | null>>;
  /** Roster names (other than none) whose email is this address, case-insensitive. */
  rosterNamesForEmail(email: string, tenantId: string): Promise<string[]>;
  /** The login whose address is this one, case-insensitive, or null. */
  loginByEmail(email: string): Promise<Login | null>;
  setAuthEmail(userId: string, email: string): Promise<{ error?: string }>;
  setProfileEmail(userId: string, email: string): Promise<void>;
  /** Write the address onto every roster row of the name; returns the count. */
  setRosterEmail(name: string, tenantId: string, email: string): Promise<number>;
}

export function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Same test `bp_set_person_details` applies, so the two never disagree on
 *  what an address looks like. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function changeSignInEmail(
  deps: Deps,
  jwt: string | null,
  raw: Partial<ChangeSignInEmailRequest> | null,
): Promise<ChangeSignInEmailResult> {
  if (!jwt) {
    return { ok: false, code: 'unauthenticated', message: 'Please sign in again.' };
  }
  const callerId = await deps.callerId(jwt);
  if (!callerId) {
    return { ok: false, code: 'unauthenticated', message: 'Please sign in again.' };
  }
  const tenantId = await deps.callerTenantId(callerId);
  if (!tenantId) {
    return {
      ok: false,
      code: 'no_tenant',
      message: 'Your own account is not attached to an organization.',
    };
  }
  // ★★ The gate is here; the screen's admin check is a courtesy.
  if ((await deps.membershipRole(callerId, tenantId)) !== 'admin') {
    return {
      ok: false,
      code: 'not_admin',
      message: 'Only an admin can change somebody’s sign-in email.',
    };
  }

  const name = (raw?.name ?? '').trim();
  const next = norm(raw?.new_email);
  if (name === '') {
    return { ok: false, code: 'invalid', message: 'Which person? No name was sent.' };
  }
  if (!EMAIL_RE.test(next)) {
    return {
      ok: false,
      code: 'invalid',
      message: 'That does not look like an email address.',
    };
  }

  const rosterEmails = await deps.rosterEmailsForName(name, tenantId);
  if (rosterEmails.length === 0) {
    return { ok: false, code: 'not_found', message: `There is no roster entry for ${name}.` };
  }

  // ★★ THE LOGIN IS FOUND THROUGH THE ROSTER ADDRESS — the same join
  //    `resolveRosterIdentity` makes. Rows of one person agree (fix-487's sync
  //    trigger); if they somehow do not, the first address with a login wins.
  let login: Login | null = null;
  for (const e of [...new Set(rosterEmails.map(norm).filter((e) => e !== ''))]) {
    login = await deps.loginByEmail(e);
    if (login) break;
  }
  if (!login) {
    return {
      ok: false,
      code: 'no_login',
      message: `${name} has no login, so their email is edited in the form directly.`,
    };
  }
  // ★★ An admin moves logins of THEIR OWN organization only — a roster row
  //    that happens to carry another tenant's member's address is not a
  //    licence to change that member's sign-in.
  if ((await deps.membershipRole(login.id, tenantId)) === null) {
    return {
      ok: false,
      code: 'no_login',
      message: `${name}'s address belongs to a login outside your organization.`,
    };
  }
  const old = norm(login.email);

  if (old === next) {
    return {
      ok: true,
      name,
      old_email: login.email,
      new_email: next,
      roster_rows: 0,
      unchanged: true,
    };
  }

  // ★★ Refused BEFORE anything writes, so the common mistake needs no rollback.
  const otherLogin = await deps.loginByEmail(next);
  if (otherLogin && otherLogin.id !== login.id) {
    return {
      ok: false,
      code: 'email_taken',
      message: `${next} is already somebody else’s sign-in.`,
    };
  }
  const otherNames = (await deps.rosterNamesForEmail(next, tenantId)).filter(
    (n) => n !== name,
  );
  if (otherNames.length > 0) {
    return {
      ok: false,
      code: 'email_taken',
      message: `${next} is already on the roster for ${otherNames.join(', ')}.`,
    };
  }

  const authRes = await deps.setAuthEmail(login.id, next);
  if (authRes.error) {
    return {
      ok: false,
      code: 'auth_failed',
      message: `The sign-in could not be changed — ${authRes.error}`,
    };
  }

  // ★★★ NO HALF-CHANGES. Auth moved; if the profile or the roster cannot
  //     follow, auth goes back, because a login whose roster rows still carry
  //     the old address is exactly the detached person this ticket ends.
  try {
    await deps.setProfileEmail(login.id, next);
    const rows = await deps.setRosterEmail(name, tenantId, next);
    return {
      ok: true,
      name,
      old_email: login.email,
      new_email: next,
      roster_rows: rows,
      unchanged: false,
    };
  } catch (e) {
    await deps.setAuthEmail(login.id, login.email);
    try {
      await deps.setProfileEmail(login.id, login.email);
    } catch {
      // The auth revert is the one that matters for signing in; the profile
      // copy is re-read from auth on the next change.
    }
    return {
      ok: false,
      code: 'roster_failed',
      message: `Nothing was changed — the roster could not be updated (${
        e instanceof Error ? e.message : String(e)
      }).`,
    };
  }
}
