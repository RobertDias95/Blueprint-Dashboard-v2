# notify-send — mention and task-assignment emails (fix-634, P-323)

Sends "Dave mentioned you · 7708 131st Ave NE" and "New task for you · <address>"
from bridge@, in fix-631's branded template, through fix-628's Graph sender.

## How it is called

```
chat insert / task assign  →  AFTER trigger queues rows in notification_email_queue
                           →  pg_net POSTs an EMPTY body here (once per transaction)
                           →  this function claims every pending row (bp_notify_claim,
                              FOR UPDATE SKIP LOCKED), sends, writes one email_outbox
                              row per email, marks the queue rows sent/failed/skipped
```

The database decides **who** (see `migrations/fix_634_mention_assignment_emails.sql`):
author excluded, opt-outs excluded, one email per person per message/task,
assignment names resolved only when they map to exactly one roster email with a
login, roles never guessed, machine writes (no `auth.uid()`) never emailed.

This function decides only **whether it is still worth sending** (opted out,
message deleted, or task finished in the seconds since) and **how it looks**.
Several assignments for one person in one drain become one email listing them.

## Scheduled kinds (pg_cron → queue → this function)

| kind | queued by | when | who | switch |
|---|---|---|---|---|
| `notify:intake` (fix-637) | `bp_intake_warning_enqueue()` | weekdays 7 AM Pacific, while anything is due | Settings → Teams → Seattle intake warning | none (work alert) |
| `notify:weekly` (fix-642) | `bp_weekly_update_enqueue()` | Wednesday 7 AM Pacific, once per edition | agenda members | "Weekly Update" |

Both freeze their content into `notification_email_queue.payload` at queue time,
so the email says what was true at 7 AM. Both cron jobs fire at 14:00 and 15:00
UTC (7 AM in either DST state); the function's own Pacific-hour gate and the
dedupe key make the extra firing a no-op.

## Deploy

```
supabase functions deploy notify-send --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt
```

⚠️ **`--no-verify-jwt` is required.** The caller is pg_net, which has no JWT.
The request is trusted for nothing — the body is never read — so all a caller can
do is make it drain mail that was already queued (the claim is atomic, so nothing
is sent twice). This is what lets the design need **no new secret**.

Secrets used: `MS_GRAPH_CLIENT_SECRET` (fix-628's, already set) and the injected
service-role key. Nothing new.

## Reading what happened

```sql
-- what was queued and what became of it
select created_at, kind, to_email, status, note, outbox_id
  from notification_email_queue order by created_at desc limit 20;

-- the send attempts themselves
select created_at, kind, to_email, subject, status, error, graph_request_id
  from email_outbox where kind like 'notify:%' order by created_at desc limit 20;
```

- `pending` older than a minute → the nudge was lost; the next mention/assignment drains it.
- `sending` older than a few minutes → the function died mid-send; read its logs.
- `failed` → the reason is in `email_outbox.error`.
- `skipped` → `note` says why (opted out / deleted / done).
