# admin-create-user

fix-436 (P-086). Creates a Bridge login and its roster row in one operation, so
Bobby can add a person from Settings → Team instead of somebody hand-writing
`auth.users`.

This is the **first** Edge Function in the project — there was no `supabase/`
directory and the prod project had zero functions before this ticket.

## Deploy

```
supabase functions deploy admin-create-user --project-ref eibnmwthkcuumyclyxoe
```

Leave `verify_jwt` at its default (**on**). The platform then rejects an
unauthenticated request before the function runs, and the
`profiles.role = 'admin'` check inside `createPerson` is the real gate on top of
that.

## Secrets

None to add. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into
every Edge Function automatically, and those are the only two this function
reads. **The service-role key never leaves the function** — that is the entire
reason this is not client-side code.

## Shape

`POST` with the caller's session JWT in `Authorization: Bearer …`
(`supabase.functions.invoke` attaches it).

```jsonc
{
  "email": "person@blueprintcap.com",
  "password": "…",              // >= 10 chars; this screen SETS it, because
                                // Bridge mail delivers nothing (P-092)
  "first_name": "Darin",
  "last_name": "Granger",
  "name": "Darin",              // roster JOIN KEY, defaults to first_name
  "role": "viewer",             // team_members.role
  "notes": "CEO",               // printed as the title when role is viewer
  "bridge_role": "editor"       // admin | editor — profiles_role_check
}
```

Success returns which rows were touched and whether the roster row was new or
reused. Failures return `{ ok: false, code, message, field? }`; `code` maps to
an HTTP status in `ERROR_STATUS`.

## What a successful create touches

| row | who writes it |
|---|---|
| `auth.users` | this function, `auth.admin.createUser({ email_confirm: true })` |
| `profiles` | **the `handle_new_user` trigger**, `role='editor'` — this function only UPDATEs it, and only to `admin` |
| `tenant_memberships` | **the trigger**, for `@blueprintcap.com` only. This function inserts it for any other domain, and sets the role when it is `admin` |
| `team_members` | this function — one row INSERTed, or an existing row's `email` / `first_name` / `last_name` / `notes` UPDATEd |

`team_members.name` and `.role` are **never** written on the reuse path: the
name is a join key across ~2,209 assignment rows, and the Team screen's rename
cascade is the only thing allowed to move it.

## Where the logic lives

`handler.ts` — no Deno, no `fetch`, no Supabase client. Everything arrives
through a `Deps` interface, so CI (which has neither a Deno runtime nor a
database) tests the admin gate, the roster-reuse rule and the rollback.
`index.ts` is the wiring.
