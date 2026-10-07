# _shared — code several Edge Functions use

fix-628 (P-092) added this folder. **It is not a function and it is never
deployed on its own.** Supabase treats a directory whose name begins with `_` as
shared code: `supabase functions deploy <name>` bundles whatever that function
imports from here, so a change in this folder reaches production only when the
functions that import it are **redeployed**.

★★★ Which means a bug fixed here is fixed in nothing until every importing
function is deployed again. Today that is `auth-send-email` alone; check
`DEPLOY_STATUS.md` before assuming.

## What is here

| file | what it is |
|---|---|
| `msGraphConfig.ts` | The non-secret constants: tenant id, client id, the sender address, the endpoints, and the **names** of the two env vars. No secret value is in this repository. |
| `graphMail.ts` | One sender for every Bridge email — a client-credentials token (cached, refreshed a minute early) and a base64 MIME `sendMail`. It never throws for a send failure; it returns `{ ok: false, error }` so the caller always has something to record. Also `redactSubject`. |
| `standardWebhooks.ts` | Standard Webhooks signature verification. The most security-sensitive file in the ticket: `auth-send-email` runs `--no-verify-jwt`, so this is the only thing standing between the internet and "send mail as bridge@". |

## The rules this folder keeps

1. **No Deno, no real `fetch`, no Supabase client.** Everything arrives through a
   `Deps` interface (the fix-436 split), so CI — which has no Deno runtime, no
   network and no database — drives every branch.
2. **It cannot import from `src/`.** A constant that must agree with the frontend
   is a deliberate copy with a twin test, the way `plan-share` copies
   `pagePaths`.
3. **A missing env var is a loud failure, never a silent success.** Returning
   "sent" with nothing sent is the behaviour that let P-092 live for months.
4. **No secret, ever.** Only the env var names.
