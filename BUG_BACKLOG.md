# Bug / hardening backlog

Known gaps and deferred work, separate from any single PR's scope.

## Security

### Role-based write authorization (admin vs member) — DEFERRED
Surfaced by the fix-157 security hardening (audit follow-up, 2026-06-12).

fix-157 locked the **public-key (`anon`) role** out of all RPCs (except `auth_tenant_ids`, needed for pre-auth realtime RLS evaluation). But **every authenticated user is currently equivalent**: any logged-in user can call any RPC and write any table their tenant's RLS allows. There is no admin / member / read-only distinction at the authorization layer.

RLS already scopes writes to the caller's **tenant** (`auth_tenant_ids()`), so this is not a cross-tenant leak — it is an intra-tenant privilege question (e.g. should every member be able to delete permits, rename DAs, edit task templates, run backfills?).

Scope when picked up:
- Define roles (e.g. `tenant_admin` vs `member`) — `tenant_memberships` likely needs a `role` column; `is_tenant_admin()` / `is_admin()` already exist and are referenced by some RLS policies.
- Gate destructive / admin RPCs (deletes, renames, template edits, config writes, sweeps) on the admin role.
- Decide member-level read/write boundaries per surface.

This is a design project, not a quick fix — it needs Bobby's input on the role model before implementation.

### Leaked-password protection — Supabase dashboard toggle (Bobby)
Advisor `auth_leaked_password_protection`. Not code — Bobby enables it in the Supabase Auth settings.
