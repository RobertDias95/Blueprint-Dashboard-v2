import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  PAGE_SIGN_TTL_SECONDS,
  SHARE_BUCKET,
  signShare,
  type Deps,
  type ShareRow,
} from './handler.ts';

// ===========================================================================
// ★★★ fix-523 §A5 — the SECOND Edge Function, and the first PUBLIC one
// ===========================================================================
//
// fix-436's `admin-create-user` keeps `verify_jwt` ON and checks
// `profiles.role = 'admin'` on top of it. **This one is the opposite by
// design**: it is the anonymous door, deployed `--no-verify-jwt`, and the
// TOKEN is the whole credential. That is the point of the ticket — a builder
// opens a link without a login — so the properties are worth stating rather
// than left to whoever reads the deploy flag:
//
//   · it accepts a TOKEN and nothing else, and derives every object path from
//     the row that token resolves to. It will not sign a path it was handed;
//   · it grants nothing but signed URLs to ONE set's page images, minted fresh
//     per visit and short-lived (`PAGE_SIGN_TTL_SECONDS`), never the 30 days
//     the LINK lives for;
//   · it answers the same shape for a bad token, a dead token and a live set
//     with no pages, so it cannot be used to probe which tokens are real;
//   · the SERVICE-ROLE key is read here from `Deno.env` and never crosses into
//     the browser. It is the only key that can read this bucket without a
//     session, because `plan-thumbnails` has no `anon` policy.
//
// ★★ NO SECRETS TO ADD. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
//    injected into every Edge Function, and those are the only two read here.

const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';

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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const deps: Deps = {
  async resolve(token) {
    // ★ The RPC, not a table read. It is `SECURITY DEFINER`, it owns the
    //   expired/revoked/current-set rules, and it bumps `view_count` and
    //   `last_seen_at` — so a share's usage is recorded exactly once per
    //   resolve, by the database, rather than by whoever remembers to.
    const { data, error } = await admin.rpc('bp_resolve_plan_share', {
      p_token: token,
    });
    if (error) return null;
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as ShareRow[];
    return rows[0] ?? null;
  },

  async sign(objectPath) {
    const { data, error } = await admin.storage
      .from(SHARE_BUCKET)
      .createSignedUrl(objectPath, PAGE_SIGN_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return json({ pages: [], thumb: null }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  try {
    return json(await signShare(deps, body), 200);
  } catch {
    // ★ Never the error text. A caller with no session gets one shape whatever
    //   went wrong, and a storage error would name a path.
    return json({ pages: [], thumb: null }, 200);
  }
});
