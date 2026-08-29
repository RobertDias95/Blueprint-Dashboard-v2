import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ERROR_STATUS,
  createPerson,
  type AddPersonRequest,
  type BridgeRole,
  type Deps,
  type RosterRow,
} from './handler.ts';

// ===========================================================================
// ★★★ fix-436 — the FIRST Edge Function in this project
// ===========================================================================
//
// There was no `supabase/` directory and the prod project had zero functions
// (listed 2026-08-29). This file is the whole reason there is one: creating a
// login needs the SERVICE ROLE key, and a service-role key that reaches the
// browser is a full database bypass handed to anyone who opens devtools. So the
// key stays here, read from `Deno.env`, and the browser gets an endpoint that
// checks who is asking.
//
// ★★★ EVERY DECISION LIVES IN `handler.ts`, WHICH HAS NO DENO IN IT. This file
// is the wiring: it turns a Request into the arguments `createPerson` wants and
// binds the `Deps` interface to a real client. That split is what lets CI —
// which has no Deno runtime and no database — test the admin gate, the roster
// reuse rule and the rollback.
//
// ★★ `verify_jwt` IS LEFT ON at deploy. The platform then rejects an
// unauthenticated request before this code runs, and the `profiles.role='admin'`
// check inside `createPerson` is the real gate on top of it. Two layers,
// because the outer one only proves you are *somebody*.

const ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ★ Both are provided to every Edge Function automatically — no secrets are
//   added for this ticket, and none are ever printed.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const deps: Deps = {
  async callerId(jwt) {
    // ★ `getUser(jwt)` validates the token against the auth server. It needs no
    //   anon key, which is why this file reads exactly two env vars.
    const { data, error } = await admin.auth.getUser(jwt);
    if (error) return null;
    return data.user?.id ?? null;
  },

  async profileRole(userId) {
    const { data, error } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.role as BridgeRole | undefined) ?? null;
  },

  async callerTenantId(userId) {
    // ★★ THE TENANT COMES FROM THE CALLER, NEVER FROM THE REQUEST BODY. A body
    //    field would let an admin of one tenant write a roster row into
    //    another. Single-tenant in production today; this keeps it honest if
    //    that stops being true.
    const { data, error } = await admin
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0]?.tenant_id as string | undefined) ?? null;
  },

  async createAuthUser(email, password) {
    // ★★★ `email_confirm: true` — CONFIRMED ON CREATION, because no
    //     confirmation mail can arrive. Bridge mail is still Supabase's demo
    //     SMTP and delivers nothing (P-092), which is also why this screen sets
    //     the initial password instead of inviting by email.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      const msg = error.message ?? String(error);
      const taken =
        /already been registered|already registered|already exists|duplicate/i.test(
          msg,
        );
      return { error: msg, taken };
    }
    const id = data.user?.id;
    if (!id) return { error: 'the auth server returned no user id' };
    return { id };
  },

  async deleteAuthUser(userId) {
    await admin.auth.admin.deleteUser(userId);
  },

  async findRosterRows(name, email, tenantId) {
    // ★ Case-insensitive on both, matching `resolveRosterIdentity`'s
    //   trim+lowercase. `ilike` with no wildcards is an exact, case-insensitive
    //   compare; the trim is done on the inputs before they get here.
    const { data, error } = await admin
      .from('team_members')
      .select('id,name,role,email,active,former')
      .eq('tenant_id', tenantId)
      .or(`name.ilike.${name},email.ilike.${email}`);
    if (error) throw new Error(error.message);
    return (data ?? []) as RosterRow[];
  },

  async updateRosterRow(id, patch) {
    // ★★ NAME AND ROLE ARE NOT IN THE PATCH, and that is a rule rather than an
    //    omission: `team_members.name` is a JOIN KEY across ~2,209 assignment
    //    rows. Renaming through this path would silently orphan them. The Team
    //    screen's rename cascade (useRenameDA / useRenameDM) is the only thing
    //    allowed to move a name.
    const { error } = await admin.from('team_members').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async insertRosterRow(row) {
    const { data, error } = await admin
      .from('team_members')
      .insert(row)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  },

  async ensureMembership(userId, tenantId, role) {
    const { data, error } = await admin
      .from('tenant_memberships')
      .select('user_id,role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const { error: insErr } = await admin
        .from('tenant_memberships')
        .insert({ user_id: userId, tenant_id: tenantId, role });
      if (insErr) throw new Error(insErr.message);
      return true;
    }
    if (data.role !== role) {
      const { error: updErr } = await admin
        .from('tenant_memberships')
        .update({ role })
        .eq('user_id', userId)
        .eq('tenant_id', tenantId);
      if (updErr) throw new Error(updErr.message);
    }
    return false;
  },

  async setProfileRole(userId, role) {
    const { error } = await admin.from('profiles').update({ role }).eq('id', userId);
    if (error) throw new Error(error.message);
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'invalid', message: 'POST only.' }, 405);
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');

  // ★ Declared without an initialiser: both branches assign, and a `= null`
  //   that is always overwritten is a value nothing reads.
  let body: Partial<AddPersonRequest> | null;
  try {
    body = (await req.json()) as Partial<AddPersonRequest>;
  } catch {
    body = null;
  }

  try {
    const result = await createPerson(deps, jwt || null, body);
    return json(result, result.ok ? 200 : ERROR_STATUS[result.code]);
  } catch (e) {
    // ★ A thrown error before the auth user exists (a bad profiles read, say)
    //   has nothing to roll back — createPerson owns everything after that
    //   point and handles its own rollback.
    return json(
      {
        ok: false,
        code: 'create_failed',
        message: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});
