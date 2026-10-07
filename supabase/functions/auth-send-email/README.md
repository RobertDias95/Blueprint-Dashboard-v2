# auth-send-email

fix-628 (P-092). Supabase Auth's **Send Email hook**: Auth hands this function
every auth email instead of sending it itself, and it sends through Microsoft
Graph as `bridge@blueprintcap.com`.

This is the **third** Edge Function in the project and the **second public** one
— like `plan-share` it runs with `verify_jwt` off, because Auth calls it without
a user JWT. Unlike `plan-share`, its credential is a **signature**: Standard
Webhooks, checked in `_shared/standardWebhooks.ts` before the body is parsed.

## Why it has to exist

Every email the Bridge sends today goes through Supabase's built-in demo sender
(`noreply@mail.app.supabase.io`), which is rate-limited to a handful an hour and
almost never reaches a real inbox. So a password reset never arrives. **Lucas was
locked out on 2026-10-06 and had to be let back in by hand in the SQL editor.**
fix-426's reset-by-code is correct; nothing delivered its email.

Measured read-only on prod 2026-10-07, which is why `recovery` is the one that
matters first:

| | |
|---|---|
| users ever sent an auth email | **4, every one a `recovery`** — the newest 2026-10-06 17:42:14 UTC. ★ `auth.users.recovery_sent_at` keeps only the LATEST per user, so 4 is a floor on the emails, not a count of them. |
| invites / confirmations / email changes | **0 of each** (`invited_at`, `confirmation_sent_at`, `email_change_sent_at` are all null for all 37) |
| users already `email_confirmed` | **37 of 37** — because `admin-create-user` passes `email_confirm: true` *precisely because* no confirmation mail could arrive |

★★ Once the hook is on, **every** `email_action_type` routes here, so every type
is rendered and tested — not just the one that is live today.

## Not SMTP, and not a third party

Microsoft turns **Basic SMTP AUTH off at the end of December 2026**, so an SMTP
integration shipped now would be dead within months. Graph with client
credentials uses the mailbox IT has already provisioned and authorised, needs no
DNS work, and no drawing or address leaves the tenant.

## Deploy

```
supabase functions deploy auth-send-email --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt
```

⚠️ **`--no-verify-jwt` is required and is the one flag to get right.** Supabase
Auth calls a Send Email hook with no user JWT, so with `verify_jwt` on the
platform answers 401 before this code runs — and the symptom is *"password
resets still do not arrive"*, which is indistinguishable from the bug being
fixed. The signature is the authentication.

**Not deployed at merge, and the hook is NOT enabled by this PR.** Until Cowork
deploys it and Bobby enables the hook, Auth keeps using the demo sender and
nothing changes — including the problem.

## Secrets — names only; no value is in this repository

| name | what it is | who sets it |
|---|---|---|
| `MS_GRAPH_CLIENT_SECRET` | the "Bridge sender" app registration's client **secret value** (not the secret ID) | Bobby, in Supabase → Edge Functions → Secrets |
| `SEND_EMAIL_HOOK_SECRET` | the `v1,whsec_…` signing secret Supabase shows when the Send Email hook is created | Bobby, same place |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into every Edge
Function and are the only others read. ★ A **missing** secret is a loud failure,
never a silent "sent" — see `getGraphToken` and `verifyStandardWebhook`.

The non-secret ids (tenant, client id, sender address) are in
`_shared/msGraphConfig.ts`, in the open, where they belong.

## The live sequence (Cowork + Bobby — not this PR)

1. Apply `migrations/fix_628_email_outbox.sql`.
2. Set `MS_GRAPH_CLIENT_SECRET`.
3. Deploy with the command above.
4. Create the Send Email hook pointing at the function, copy its signing secret
   into `SEND_EMAIL_HOOK_SECRET`, **then** enable it.
5. Ask for one password reset and read `email_outbox` — one `sent` row, subject
   stored redacted.

★★★ Step 4 is in that order on purpose. A hook enabled before its secret is set
sends nothing and refuses every call, which looks exactly like step 3 failing.

## Shape

`POST`, no auth header, three `webhook-*` headers. Body is Auth's payload:

```jsonc
{ "user": { "email": "…", "new_email": "…" },
  "email_data": { "email_action_type": "recovery", "token": "123456",
                  "token_new": "…", "token_hash": "…" } }
```

`200 {}` means sent. Anything else is `{ "error": { "http_code": …, "message": … } }`
and Auth reports the failure to the person instead of claiming their mail is on
its way — which is the whole point, and the half P-092 was missing.

## What stops this being an open relay

| | |
|---|---|
| **Signature first** | Checked before the body is even parsed, so an unsigned caller cannot steer a single code path. A missing `SEND_EMAIL_HOOK_SECRET` is a refusal, never a pass. |
| **Constant-time compare** | `===` on a signature leaks how many leading bytes were guessed right, which turns forging one into a few thousand requests. |
| **A replay window** | `webhook-timestamp` must be within 5 minutes, so a captured request is not useful tomorrow. |
| **One mailbox** | The sender is a constant. The function will not send *as* anything a caller names. |

## The outbox

Every attempt writes one row to `public.email_outbox` (§A), so a **failed** send
is visible to a human: P-286 found 83 of 94 write hooks reported nothing when
they failed, and an email sender is the worst possible place to be the 84th —
the person who needed the mail is, by construction, the person who cannot tell
you it never came.

★★★ **The row never holds the code.** `subject` is stored redacted
(`Your Bridge reset code: ••••••`) by `redactSubject`, and a CHECK constraint
refuses any subject containing a 6-digit run, so a future caller that forgets
gets a rejected row rather than a stored reset code. There is no body column.

Admins read it through `bp_email_outbox_recent()`; the table itself has **no
`anon` and no `authenticated` policy at all**.

## Where the logic lives

`handler.ts` — no Deno, no `fetch`, no Supabase client; everything arrives
through `Deps`, the fix-436 split that `plan-share/handler.ts` keeps. CI has
neither a Deno runtime nor a network, and drives all of it:
`src/__tests__/BridgeSendsEmailFix628.test.ts`. `index.ts` is the wiring, and is
the only file that touches the environment.

`_shared/graphMail.ts` is the sender, built to be reused: the mention emails
(P-323), the weekly digest (P-017) and vendor sends (P-180) all want the same
`sendGraphMail(deps, { to, subject, html, text, attachments })`.
