import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendGraphMail, type GraphDeps, type SendMailInput } from '../_shared/graphMail.ts';
import { ENV_CLIENT_SECRET } from '../_shared/msGraphConfig.ts';
import { drain, type ClaimedRow, type Deps, type DrainSummary, type OutboxRow } from './handler.ts';

// ===========================================================================
// ★★★ fix-634 (P-323) — THE WIRING. ALL DECISIONS ARE IN handler.ts
// ===========================================================================
//
// ⚠️ DEPLOY WITH JWT VERIFICATION OFF:
//
//      supabase functions deploy notify-send --no-verify-jwt
//
//    The caller is the database (pg_net), which holds no JWT — and storing one
//    there would be a new secret. So the request is TRUSTED FOR NOTHING: its
//    body is never read. All any caller can do is make this function drain the
//    rows the database already queued, which it would have drained anyway; the
//    claim is atomic (SKIP LOCKED), so nothing is sent twice.
//
// ⚠️ AN EDGE FUNCTION IS NOT SHIPPED WHEN THE PR MERGES — see DEPLOY_STATUS.md.
//
// ⛔ NO SECRET IS IN THIS REPOSITORY. `MS_GRAPH_CLIENT_SECRET` (fix-628's) and
//    the injected service-role key are read from the environment and never
//    logged. The response carries COUNTS only — never an address or a subject.

const BATCH = 50;
/** ★ A ceiling, so a runaway queue cannot hold one invocation open forever. */
const MAX_BATCHES = 5;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ★ The request is never read — see the header.
Deno.serve(async (): Promise<Response> => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
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
      sendGraphMail(graphDeps, input, crypto.randomUUID().slice(0, 12)),

    // ★★ Never throws: the email has already gone (or failed) by now.
    recordOutbox: async (row: OutboxRow) => {
      try {
        const { data, error } = await admin.from('email_outbox').insert(row).select('id').single();
        if (error) {
          console.error(`[notify-send] could not record ${row.kind} (${row.status}) in email_outbox: ${error.message}`);
          return null;
        }
        return (data as { id: string }).id;
      } catch (e) {
        console.error(`[notify-send] could not record ${row.kind} (${row.status}) in email_outbox: ${(e as Error).message}`);
        return null;
      }
    },

    markQueue: async (ids, outcome, outboxId, note) => {
      try {
        const { error } = await admin
          .from('notification_email_queue')
          .update({ status: outcome, outbox_id: outboxId, note, processed_at: new Date().toISOString() })
          .in('id', ids);
        if (error) console.error(`[notify-send] could not mark ${ids.length} queue row(s) ${outcome}: ${error.message}`);
      } catch (e) {
        console.error(`[notify-send] could not mark ${ids.length} queue row(s) ${outcome}: ${(e as Error).message}`);
      }
    },
  };

  const total: DrainSummary & { claimed: number } = { claimed: 0, emails: 0, sent: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const { data, error } = await admin.rpc('bp_notify_claim', { p_limit: BATCH });
    if (error) {
      console.error(`[notify-send] bp_notify_claim failed: ${error.message}`);
      return json({ error: 'claim failed', ...total }, 500);
    }
    const rows = (data ?? []) as ClaimedRow[];
    if (rows.length === 0) break;
    total.claimed += rows.length;
    const s = await drain(deps, rows);
    total.emails += s.emails;
    total.sent += s.sent;
    total.failed += s.failed;
    total.skipped += s.skipped;
    if (rows.length < BATCH) break;
  }

  return json(total, 200);
});
