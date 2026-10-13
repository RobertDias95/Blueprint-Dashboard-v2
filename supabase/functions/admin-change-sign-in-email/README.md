# admin-change-sign-in-email

fix-659 (P-318, Settings audit census 42). Changes a person's **sign-in email**
and every copy of it together:

| copy | written by |
|---|---|
| `auth.users.email` (and its identity) | `auth.admin.updateUserById({ email, email_confirm: true })` |
| `profiles.email` | this function |
| `team_members.email`, **every row of that roster name** | this function |

Before this, People → Save wrote `team_members.email` only, so changing a
person's email there detached them from their own login
(`resolveRosterIdentity` joins the signed-in address to the roster email). The
fix-659 migration makes `bp_set_person_details` refuse an email change for a
person with a login, so this function is the only way to move one.

## Deploy

```
supabase functions deploy admin-change-sign-in-email --project-ref eibnmwthkcuumyclyxoe
```

Leave `verify_jwt` **on**. The admin check inside (`tenant_memberships.role =
'admin'` for the caller's own tenant, the fix-608 gate) is the real rule on top.

## Secrets

None to add — only the auto-injected `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. The service-role key never leaves the function.

## Shape

`POST` with the caller's session JWT in `Authorization: Bearer …` and

```json
{ "name": "Rice", "new_email": "david.rice@blueprintcap.com" }
```

`name` is the roster join key. The tenant comes from the caller, never the body.

Answers `{ ok: true, name, old_email, new_email, roster_rows, unchanged }` or
`{ ok: false, code, message }` with the status in `ERROR_STATUS`
(`unauthenticated` 401 · `not_admin` 403 · `invalid` 400 · `not_found` 404 ·
`no_login` / `email_taken` / `no_tenant` 409 · `auth_failed` / `roster_failed`
500).

## No half-changes

Everything that can be refused (not admin, bad address, no login, address
already somebody's sign-in or on another person's roster rows) is checked
**before** anything is written. If auth moves and the profile or roster write
then fails, auth (and the profile) are put back and the answer is
`roster_failed` — "Nothing was changed".

## Tests

`handler.ts` has no Deno, `fetch` or client in it; `src/__tests__/ThreeWrongSavesFix659.test.tsx`
runs every branch with fakes. `index.ts` is the wiring.
