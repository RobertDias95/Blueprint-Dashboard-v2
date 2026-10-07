import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  sendGraphMail,
  type GraphDeps,
  type SendMailInput,
} from '../_shared/graphMail.ts';
import { ENV_CLIENT_SECRET, ENV_HOOK_SECRET } from '../_shared/msGraphConfig.ts';
import {
  handleSendEmail,
  type Deps,
  type OutboxRow,
} from './handler.ts';

// ===========================================================================
// ★★★ fix-628 §C (P-092) — THE WIRING. ALL DECISIONS ARE IN handler.ts
// ===========================================================================
//
// ⚠️ DEPLOY WITH JWT VERIFICATION OFF:
//
//      supabase functions deploy auth-send-email --no-verify-jwt
//
//    Supabase Auth calls this without a user JWT, so `verify_jwt` on would
//    reject every hook call with a 401 before the function ran. The Standard
//    Webhooks signature is the authentication — see `_shared/standardWebhooks.ts`
//    for why that is sufficient and `plan-share` (fix-523) for the precedent.
//
// ⚠️ AN EDGE FUNCTION IS NOT SHIPPED WHEN THE PR MERGES. The Brain rule is
//    `an-edge-function-ships-only-when-redeployed`: merging changes the repo and
//    nothing else. Cowork deploys this from `origin/main` and records the version.
//
// ⛔ NO SECRET IS IN THIS REPOSITORY. `MS_GRAPH_CLIENT_SECRET` and
//    `SEND_EMAIL_HOOK_SECRET` are read from the environment here and nowhere
//    else, and are never logged — see the note on `recordOutbox` below.

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: { http_code: 405, message: 'POST only.' } }, 405);
  }

  // ★★★ THE RAW BODY, READ ONCE AND NEVER RE-PARSED BEFORE VERIFICATION. The
  //     signature covers these exact bytes, so `await req.json()` here would
  //     verify a re-serialisation of the payload rather than the payload — and
  //     any key reordering or whitespace difference would fail a valid request.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json({ error: { http_code: 400, message: 'Could not read the body.' } }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // ★ The service-role key is injected into every Edge Function. It is what
    //   lets the insert below past `email_outbox`' RLS, which has no anon and no
    //   authenticated policy at all.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const graphDeps: GraphDeps = {
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
    clientSecret: Deno.env.get(ENV_CLIENT_SECRET) ?? undefined,
  };

  const deps: Deps = {
    sendMail: (input: SendMailInput) =>
      // ★ A fresh boundary seed per message, so two emails sent in the same
      //   isolate cannot share a MIME boundary.
      sendGraphMail(graphDeps, input, crypto.randomUUID().slice(0, 12)),

    // ★★★ THE OUTBOX WRITE CANNOT FAIL THE SEND. The email has already gone by
    //     the time this runs; throwing here would turn a delivered reset code
    //     into a 500 and make Auth tell the person it failed. So it swallows and
    //     logs — and the log line is the ONE place a dropped row is visible,
    //     which is why it names the kind and the status rather than just erroring.
    //
    // ★★ WHAT IS LOGGED IS DELIBERATE: kind, status and the database's complaint.
    //    Never the payload, never the token, never a secret.
    recordOutbox: async (row: OutboxRow) => {
      try {
        const { error } = await admin.from('email_outbox').insert(row);
        if (error) {
          console.error(
            `[auth-send-email] could not record ${row.kind} (${row.status}) in ` +
              `email_outbox: ${error.message}`,
          );
        }
      } catch (e) {
        console.error(
          `[auth-send-email] could not record ${row.kind} (${row.status}) in ` +
            `email_outbox: ${(e as Error).message}`,
        );
      }
    },

    hookSecret: Deno.env.get(ENV_HOOK_SECRET) ?? undefined,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };

  const res = await handleSendEmail(deps, {
    rawBody,
    headers: {
      id: req.headers.get('webhook-id'),
      timestamp: req.headers.get('webhook-timestamp'),
      signature: req.headers.get('webhook-signature'),
    },
  });

  return json(res.body, res.status);
});
