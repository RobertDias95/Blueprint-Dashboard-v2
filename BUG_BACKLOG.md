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

## Triage

### "X changed since you loaded it" — reading an OCC refusal (P-283)

**Status: OPEN and UNEXPLAINED.** This section is not a fix. It exists so the
next occurrence answers the question instead of restarting the investigation.

`"Time block changed since you loaded it"` has refused edits from **five people
across four weeks** (11 occurrences since 2026-08-21). One sequence, from a
single person relabelling a column on 2026-09-15 — five writes land and one is
refused in the middle, **with no second actor anywhere in the table**:

```
15:21:04  Fisk      Training     "Schematic Design"
15:21:14  Marc      Other        "Schematic Design"
15:22     —         REFUSED — error report 730
15:22:39  George    Corrections  "Corrections"
15:22:59  Qisheng   Vacation     "Eastside Template"
15:23:17  Nicky     Vacation     "Template Updates"
```

#### Four mechanisms are already ruled out — do not re-propose them

| # | theory | how it died |
|---|---|---|
| 1 | a sibling rewrite invalidates the token | `bp_upsert_da_time_block_row` touches **exactly one row**; there is no overlap resolver |
| 2 | an insert retry reports a duplicate id as a conflict | real trap, wrong case — every row in the observed sequence is an UPDATE to a row created 2025-08-20 |
| 3 | the popup holds a stale snapshot across saves | `NpBlockEditPopup` calls `onClose()` immediately after `onUpdate`, so every save closes it |
| 4 | `resetQueries` discards the cache mid-edit | one caller (`useRenameDA`); the verb is deliberate and fix-511 §B argues it in the file |

#### What fix-579 added, and how to read it

Since fix-579 every OCC refusal on `da_time_blocks` and `intake_records`
carries **both sides of the comparison it lost** in the error report's
`context`. The server's side was always on the wire — each RPC's conflict path
re-reads the row into `v_actual` and returns it — and the client was discarding
it.

| field | meaning |
|---|---|
| `occRowId` | the row the write was aimed at |
| `occExpected` | the token the client POSTED as `p_expected_updated_at` |
| `occActual` | the row's REAL `updated_at` at the moment of refusal |
| `occDeltaMs` | `actual − expected`, **the number that answers the question** |
| `occTokenAgeMs` | `now − expected` — how old the client's token had become |
| `occConflict` | `stale-token` · `row-missing` · `same-instant` |

**Read `occDeltaMs` first:**

- **Sub-second** — the row moved *during* the save. Look for a second write in
  the same interaction: a cache write, a realtime echo, a retry.
- **Minutes or more** — the row moved while the editor sat open, and
  `occTokenAgeMs` says how long the client had been holding that token. This is
  an ordinary stale-token conflict and the message is telling the truth.
- **Exactly `0` (`occConflict: 'same-instant'`)** — both stamps mean the same
  moment and the comparison refused anyway. That is a **different bug**: the
  stamps round-trip through JSON as text and are compared as `timestamptz`, so
  a precision or formatting difference would look exactly like this. Compare
  the raw `occExpected` / `occActual` strings character by character.
- **Negative** — the row's stamp went backwards, which should be impossible.
- **`occConflict: 'row-missing'`** — there is no `occActual` because **the row
  no longer exists**. The refusal is a delete racing an edit, not a conflict,
  and it has been wearing the same message as one.

Query the reports with:

```sql
select created_at, context->>'write' as rpc, context->>'occConflict' as kind,
       context->>'occDeltaMs' as delta_ms, context->>'occTokenAgeMs' as token_age_ms,
       context->>'occExpected' as expected, context->>'occActual' as actual
from error_reports
where message like '%changed since you loaded it%'
order by created_at desc;
```

⚠️ Rows logged **before** fix-579 carry none of these fields — reports 729/730
and everything earlier will show only `write` and `fields`.
