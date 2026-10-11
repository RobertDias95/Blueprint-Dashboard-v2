# Edge functions — what is deployed, and what is waiting

**Read from prod (`eibnmwthkcuumyclyxoe`) on 2026-10-11 by fix-638, read-only
(`list_edge_functions`, plus each function's live source compared with the repo).**

> ★★★ **WHY THIS PAGE EXISTS.** An Edge Function in this repo is **not** shipped
> by merging it. Nothing in CI deploys one, so a function can sit written,
> tested, reviewed and merged while the feature it exists for is broken in front
> of customers. **That is P-279:** `plan-share` was merged by fix-523 on
> 2026-09-11 and every share link sent in the next four days showed *"The pages
> could not be loaded."*
>
> ★★ **AND A PAGE LIKE THIS GOES STALE THE SAME WAY.** Until fix-638 every row
> below was wrong — three functions said "NOT DEPLOYED" that had been live for
> days, and the test pinned those exact words, so correcting the page failed CI.
> The test now checks the page's **shape** (every function has a row, a deploy
> command and a README) and never its **verdicts**. Keeping the verdicts true
> is the job of whoever deploys: **update the row in the same breath as the
> deploy, with the version the deploy returned.**

## The table

| function | live version | deployed (UTC) | `verify_jwt` | live code vs `origin/main` | who may call it | deploy |
|---|---|---|---|---|---|---|
| `admin-create-user` | **6** | 2026-10-01 | `true` | ✅ current — carries fix-608's `tenant_memberships` gate | a signed-in admin (re-checked inside against the caller's `tenant_memberships` row for the tenant being written to) | `supabase functions deploy admin-create-user --project-ref eibnmwthkcuumyclyxoe` |
| `plan-share` | **4** | 2026-09-15 | `false` | ✅ current — deployed after fix-528, its last change. **P-279 is closed.** | **anon**; the share token is the whole credential | `supabase functions deploy plan-share --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt` |
| `auth-send-email` | **3** | 2026-10-10 | `false` | ✅ current — deployed after fix-631b. The Send Email hook **is on**: `email_outbox` holds `auth:recovery` sends, the newest 2026-10-11 | **Supabase Auth**, which calls it with no user JWT; the Standard Webhooks signature is the whole credential | `supabase functions deploy auth-send-email --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt` |
| `notify-send` | **3** | 2026-10-11 | `false` | ✅ current — fix-634 (P-323) mentions/assignments, fix-637 v2 Seattle intake warning, fix-642 v3 Weekly Update email | **the database** (pg_net, no JWT). The body is never read; a caller can only make it drain mail already queued | `supabase functions deploy notify-send --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt` |

"Current" means the live version was deployed **after** the last commit that
touched the function's folder or the `_shared/` files it imports (dates compared
2026-10-11). Source was also compared directly for `admin-create-user` (the
fix-608 gate is in the live `handler.ts`), for `auth-send-email`'s four `_shared`
files and for `notify-send` (code-identical to `origin/main` once comments are
stripped — the agent deploy path drops them to keep the transcription short).

## ⚠️ `--no-verify-jwt` is the one flag to get right

Three of the four run with `verify_jwt` **off**, because their callers hold no
user JWT: an anonymous visitor (`plan-share`), Supabase Auth (`auth-send-email`)
and the database (`notify-send`). With it on, the platform answers 401 before the
function runs — and the symptom is the same as not deploying at all ("the pages
could not be loaded", "the reset code never came", "no mention email"), which
sends the next person round P-279's loop again. Each function's own check is the
real gate: the share token, the webhook signature, and "only drain what the
database queued".

## `_shared/` is not a function

It is bundled into whatever imports it and is never deployed on its own. A fix
there reaches production only when **every importing function is redeployed** —
today `auth-send-email` and `notify-send`. See `_shared/README.md`.

## How to re-read this page's facts

- versions and `verify_jwt`: the Supabase MCP `list_edge_functions`, or the
  dashboard's Edge Functions list;
- whether live code is current: `get_edge_function` for the source, compared
  with `git show origin/main:supabase/functions/<name>/…`;
- whether a sender actually sends: `select kind, status, count(*), max(created_at)
  from email_outbox group by 1, 2`.

## ★★★ What is NOT the fix

**Do not add an `anon` SELECT policy to `storage.objects` for `plan-thumbnails`.**
It was proposed as fix-574 option A and it would fix nothing, because **nothing
reads that bucket as `anon`**: the shared page calls this function, and this
function signs with the **service-role key, which bypasses RLS entirely**. The
policy would be dead code *and* a permanent widening of a public boundary — a
path-holder could read a set for as long as any live share existed on that
project, including after their own link was revoked.

See the fix-574 PR for the full argument and the four scope probes that were
written before the diagnosis changed.

## Adding a function

Add the folder, add a README, **and add a row above** with its deploy command.
`SharedPageReadableFix574` fails if a function directory has no row, no deploy
command or no README — and it does not care what the row's verdict says, so
writing the truth never breaks the build.
