import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ERROR_STATUS,
  changeSignInEmail,
  type ChangeSignInEmailRequest,
  type Deps,
} from './handler.ts';

// ★★★ fix-659 — the wiring for handler.ts, in admin-create-user's shape.
//
// The service-role key is read from `Deno.env` here and never reaches the
// browser. `verify_jwt` stays ON at deploy; the admin check in the handler is
// the real gate on top of it.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** `ilike` with no wildcards is an exact, case-insensitive compare; escape the
 *  two characters that would otherwise be wildcards. */
function exactIlike(s: string): string {
  return s.replace(/([\\%_])/g, '\\$1');
}

const deps: Deps = {
  async callerId(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error) return null;
    return data.user?.id ?? null;
  },

  async callerTenantId(userId) {
    const { data, error } = await admin
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0]?.tenant_id as string | undefined) ?? null;
  },

  async membershipRole(userId, tenantId) {
    const { data, error } = await admin
      .from('tenant_memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.role as string | undefined) ?? null;
  },

  async rosterEmailsForName(name, tenantId) {
    const { data, error } = await admin
      .from('team_members')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('name', name);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => (r.email as string | null) ?? null);
  },

  async rosterNamesForEmail(email, tenantId) {
    const { data, error } = await admin
      .from('team_members')
      .select('name')
      .eq('tenant_id', tenantId)
      .ilike('email', exactIlike(email));
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((r) => r.name as string))];
  },

  async loginByEmail(email) {
    // ★ `profiles` mirrors auth.users (handle_new_user + this function), and
    //   unlike the admin user list it can be filtered. The auth record is then
    //   read by id so the address returned is auth's own, not the copy.
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', exactIlike(email))
      .limit(1);
    if (error) throw new Error(error.message);
    const id = data?.[0]?.id as string | undefined;
    if (!id) return null;
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(id);
    if (uErr || !u.user?.email) return null;
    return { id, email: u.user.email };
  },

  async setAuthEmail(userId, email) {
    // ★★ `email_confirm: true` — confirmed on change, as on creation (fix-436):
    //    Bridge mail cannot deliver a confirmation link, and the admin is the
    //    one vouching for the address.
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    return error ? { error: error.message ?? String(error) } : {};
  },

  async setProfileEmail(userId, email) {
    const { error } = await admin.from('profiles').update({ email }).eq('id', userId);
    if (error) throw new Error(error.message);
  },

  async setRosterEmail(name, tenantId, email) {
    const { data, error } = await admin
      .from('team_members')
      .update({ email })
      .eq('tenant_id', tenantId)
      .eq('name', name)
      .select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'invalid', message: 'POST only.' }, 405);
  }
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let body: Partial<ChangeSignInEmailRequest> | null;
  try {
    body = (await req.json()) as Partial<ChangeSignInEmailRequest>;
  } catch {
    body = null;
  }
  try {
    const result = await changeSignInEmail(deps, jwt || null, body);
    return json(result, result.ok ? 200 : ERROR_STATUS[result.code]);
  } catch (e) {
    return json(
      {
        ok: false,
        code: 'auth_failed',
        message: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});
