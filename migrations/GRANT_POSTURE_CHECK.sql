-- ===========================================================================
-- GRANT POSTURE CHECK — run against prod, read-only (fix-455 §B2)
-- ===========================================================================
--
-- ★★★ THIS IS A MANUAL CHECK, NOT AN AUTOMATED ONE, AND THAT IS DELIBERATE.
--
-- This repo has no CI database connection and fix-455 did not invent one. The
-- vitest suite runs against jsdom with a mocked Supabase client; there is
-- nothing for a grant assertion to talk to, and standing up a database in CI
-- purely to assert an ACL would be a much larger change than the posture it
-- guards. So the guard is this file plus the habit of running it — and the
-- ratchet in fix_455_anon_write_grants.sql, which is what actually keeps the
-- posture true without anybody remembering.
--
-- WHEN TO RUN IT
--   · after any migration that creates a table or a view
--   · after a Supabase platform upgrade (the default ACLs are theirs, not ours)
--   · when auditing, e.g. the next time somebody asks "who can write what"
--
-- HOW: paste into the Supabase SQL editor, or run it through the MCP
-- `execute_sql` tool. It writes nothing.
--
-- ---------------------------------------------------------------------------
-- EXPECTED, as of fix-455 (measured 2026-08-30, after applying):
--   kind    | total | anon_write | anon_select | auth_write | rls_on
--   table   |    97 |          0 |          60 |         80 |     97
--   view    |    11 |          0 |           1 |          0 |    n/a
--   matview |     1 |          0 |           0 |          0 |    n/a
--
-- ★ anon_write MUST BE ZERO. Everything else is context: anon SELECT is
--   deliberately left alone (fix-455 §A2 — removing read is a separate,
--   riskier decision), and `authenticated` write on TABLES is the Bridge's own
--   save path and must NOT be revoked.
-- ---------------------------------------------------------------------------

-- §1 · The headline table. anon_write is the number that must stay 0.
with rels as (
  select c.relname, c.relkind, c.relrowsecurity,
         coalesce(c.relacl, acldefault('r', c.relowner)) as acl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm')
),
w as (select unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as p),
x as (
  select relname, relkind, relrowsecurity,
    exists (select 1 from aclexplode(acl) a join w on w.p = a.privilege_type
             where a.grantee = 'anon'::regrole) as anon_write,
    exists (select 1 from aclexplode(acl) a
             where a.grantee = 'anon'::regrole and a.privilege_type = 'SELECT') as anon_select,
    exists (select 1 from aclexplode(acl) a join w on w.p = a.privilege_type
             where a.grantee = 'authenticated'::regrole) as auth_write
  from rels
)
select case when relkind in ('r','p') then 'table'
            when relkind = 'v' then 'view' else 'matview' end as kind,
       count(*) as total,
       count(*) filter (where anon_write)  as anon_write,   -- ★ must be 0
       count(*) filter (where anon_select) as anon_select,
       count(*) filter (where auth_write)  as auth_write,
       count(*) filter (where relrowsecurity) as rls_on
  from x
 group by 1
 order by 1;

-- §2 · Name the offenders, if §1 is not zero. An empty result is a pass.
with rels as (
  select c.oid::regclass::text as rel, coalesce(c.relacl, acldefault('r', c.relowner)) as acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
)
select rel, string_agg(a.privilege_type, ', ' order by a.privilege_type) as anon_write_privileges
  from rels, aclexplode(acl) a
 where a.grantee = 'anon'::regrole
   and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
 group by rel
 order by rel;

-- §3 · ★★★ THE ROOT CAUSE. A new relation inherits these, so this is the
--      check that actually matters — §1 can be clean today and dirty tomorrow
--      if `anon` reappears here.
--
--      EXPECTED: the `postgres` rows carry NO `anon=` entry.
--      ★ The `supabase_admin` rows still DO, and cannot be changed from here:
--        `pg_has_role(current_user,'supabase_admin','USAGE')` is false for
--        postgres on a managed project, and ALTER DEFAULT PRIVILEGES FOR ROLE
--        requires membership. They govern relations Supabase's own
--        provisioning creates, not ours — every migration in this repo runs as
--        `postgres`. Known and accepted, not missed.
select pg_get_userbyid(d.defaclrole) as granter,
       case d.defaclobjtype when 'r' then 'tables'
            when 'S' then 'sequences' when 'f' then 'functions'
            else d.defaclobjtype::text end as objtype,
       coalesce((select string_agg(x, ' | ') from unnest(d.defaclacl::text[]) x), '(empty)') as default_acl
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public'
 order by granter, objtype;

-- §4 · The shape a new relation should end up with, for comparison.
--      permit_cycle_reviewers_current (fix-454) is the reference:
--      `authenticated=r`, no anon, service_role ALL.
select c.oid::regclass::text as rel,
       coalesce((select string_agg(x, ' | ') from unnest(c.relacl::text[]) x), '(none)') as acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('permit_cycle_reviewers_current', 'permit_task_audit')
 order by 1;
