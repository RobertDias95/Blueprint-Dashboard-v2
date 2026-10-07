# Edge functions — what is deployed, and what is waiting

**Measured against prod (`eibnmwthkcuumyclyxoe`) on 2026-09-15; the `auth-send-email` row added 2026-10-07.**

> ★★★ **WHY THIS PAGE EXISTS.** An Edge Function in this repo is **not** shipped
> by merging it. Nothing in CI deploys one, and nothing anywhere told us which
> ones were live — so a function could sit written, tested, reviewed and merged
> while the feature it exists for was broken in front of customers.
>
> **That is not hypothetical: it is P-279.** `plan-share` was merged by fix-523
> on 2026-09-11 with *"Not deployed at merge"* in its own README, and every plan
> share link sent in the four days after showed **"The pages could not be
> loaded."** The 404s were in the logs the whole time. The README said the right
> thing in the right file and nobody had a reason to open it.
>
> ★★ This is the same shape as `migrations/PENDING_APPROVAL_INDEX.md`: work that
> is finished in the repo and unfinished in production needs **one page that
> lists it**, not a note filed beside the thing nobody is looking at. A test
> keeps this table and the folder in step.

## The table

| function | status on prod | `verify_jwt` | who may call it | deploy |
|---|---|---|---|---|
| `admin-create-user` | ⚠️ **DEPLOYED, BUT STALE** — version 2 (2026-09-15) is live; fix-608 changed the gate and is NOT yet deployed | `true` | a signed-in admin (checked again inside the function — as of fix-608 against the caller’s `tenant_memberships` row for the tenant being written to, no longer `profiles.role`) | `supabase functions deploy admin-create-user --project-ref eibnmwthkcuumyclyxoe` |
| `plan-share` | ⛔️ **NOT DEPLOYED — this is P-279, live and external-facing** | must be `false` | **anon**; the share token is the whole credential | `supabase functions deploy plan-share --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt` |
| `auth-send-email` | ⛔️ **NOT DEPLOYED — new in fix-628 (P-092); the Send Email hook is also NOT enabled** | must be `false` | **Supabase Auth**, which calls it with no user JWT; the Standard Webhooks signature is the whole credential | `supabase functions deploy auth-send-email --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt` |

## ⛔️ The outstanding actions

### 1. `plan-share` (P-279)

```
supabase functions deploy plan-share --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt
```

⚠️ **`--no-verify-jwt` is the one flag to get right.** With `verify_jwt` on, the
platform rejects the request before the function runs and the shared page shows
a set with no pages — the *same* symptom as not deploying it at all. The gate is
the token, checked by `bp_resolve_plan_share` inside the function.

**Evidence it is the whole fix, measured 2026-09-15:**

- `function_edge_logs`: **12 requests** to
  `https://…/functions/v1/plan-share` in 24 hours, **every one a 404**.
- `plan_share_links.view_count` climbing on six live links (17 resolves, newest
  19:49 UTC) — so real visitors are arriving and `bp_resolve_plan_share` is
  answering. The failure is entirely downstream of the RPC.
- The handler's decision tree is covered by **59 passing tests**
  (`PlanShareFix523`, `EmailCarriesPdfFix528`) and needs no change.

### 2. `auth-send-email` (P-092, new in fix-628)

```
supabase functions deploy auth-send-email --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt
```

⚠️ **Same flag, same reason, and the same misleading symptom.** Supabase Auth
calls a Send Email hook with no user JWT, so with `verify_jwt` on the platform
answers 401 before the function runs — and what a person sees is *"password
resets still do not arrive"*, which is indistinguishable from the bug fix-628
exists to fix.

★★★ **AND DEPLOYING IT IS NOT ENOUGH ON ITS OWN.** This one has a second half
that lives outside the repo, in this order:

1. apply `migrations/fix_628_email_outbox.sql`
2. set `MS_GRAPH_CLIENT_SECRET` (Edge Function secrets)
3. deploy, with the command above
4. create the Send Email hook, copy its signing secret into
   `SEND_EMAIL_HOOK_SECRET`, **then** enable it
5. ask for one password reset and read `email_outbox`

★★ Step 4 is in that order deliberately: a hook enabled before its secret is set
refuses every call and sends nothing, which looks exactly like step 3 failing.

Until all five are done Auth keeps using the demo sender, which is throttled and
almost never delivers — so nothing changes, **including the problem**. Lucas was
locked out on 2026-10-06 and let back in by hand.

See `auth-send-email/README.md` for the measured §0 figures and the secret names.

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

Add the folder, add a README, **and add a row above**. `EdgeFunctionDeployStatusFix574`
fails if a function directory has no row here.
