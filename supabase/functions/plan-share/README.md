# plan-share

fix-523 §A5 (P-187). Turns a share token into signed URLs for one set's page
images, so a builder can open `/s/<token>` without a login.

This is the **second** Edge Function in the project and the **first public**
one — `admin-create-user` keeps `verify_jwt` on and gates on
`profiles.role = 'admin'`; this one is the anonymous door and the token is the
whole credential.

## Why it has to exist

`plan-thumbnails` is a private bucket. Its only read policy is

```
plan_thumbnails_tenant_read  →  authenticated
  bucket_id = 'plan-thumbnails'
  and exists (select 1 from projects p
               where p.id::text = split_part(name, '/', 1)
                 and p.tenant_id = any (auth_tenant_ids()))
```

Measured on prod 2026-09-11: **`anon` has no policy on that bucket at all**, so
an anonymous browser cannot sign or fetch a single page. Postgres cannot sign a
Storage URL either, which is why `bp_resolve_plan_share` returns `pages_prefix`
and `page_count` and stops. Signing needs the service-role key, and the key must
not reach a public route — so it stays here.

## Deploy

```
supabase functions deploy plan-share --project-ref eibnmwthkcuumyclyxoe --no-verify-jwt
```

⚠️ **`--no-verify-jwt` is required and is the one flag to get right.** With
`verify_jwt` on, the platform rejects the request before this code runs and the
shared page shows a set with no pages. The gate is the token, checked by
`bp_resolve_plan_share` inside the function.

**Not deployed at merge.** Until it is, `/s/<token>` renders the set's name,
page count and expiry and says the pages could not be loaded — it does not
error, and nothing else in the app is affected.

## Secrets

None to add. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into
every Edge Function and are the only two this function reads. **The
service-role key never leaves the function.**

## Shape

`POST` with no auth header required:

```jsonc
{ "token": "a7Kd92…" }
```

```jsonc
{ "pages": ["https://…p001.jpg?token=…", "…"], "thumb": "https://…" }
```

## The four properties that make it safe

| | |
|---|---|
| **Token only** | Object paths are DERIVED from the resolved row. It will not sign a path a caller supplies — a signing endpoint that signs what it is handed is an open proxy onto the bucket, whatever it checks first. |
| **One set** | Only that link's `(project, set_type, variant)` pages plus its thumbnail. Never a listing, never a sibling set, never another project. |
| **Short signatures** | `PAGE_SIGN_TTL_SECONDS` is one hour, minted per visit — *not* the 30 days the link lives for. A signature that outlives the visit is another copy of the drawing loose in the world. |
| **One answer** | A malformed token, an expired one, a revoked one, one whose set has disappeared and a live set with no pages all return `{ "pages": [], "thumb": null }` with status 200. It cannot be used to probe which tokens are real. |

## Where the logic lives

`handler.ts` — no Deno, no `fetch`, no Supabase client. Everything arrives
through a `Deps` interface, so CI (which has neither a Deno runtime nor a
database) tests the token check, the path derivation and the drop-a-bad-page
rule. `index.ts` is the wiring.

`pagePaths` and `SHARE_BUCKET` are deliberate copies of `src/lib/planShare.ts`
and `src/lib/planOfRecordShare.ts` — this module cannot import from `src/` —
and a twin test replays both over the same inputs.
