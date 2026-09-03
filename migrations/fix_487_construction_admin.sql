-- ===========================================================================
-- fix-487 (P-144) — CONSTRUCTION ADMIN, THE SIXTH INTERNAL ROLE
-- ===========================================================================
--
-- ★★★ APPROVED BY BOBBY 2026-09-02/03:
--
--   *"We want to add one more internal position, construction admin. There's
--    two people on that team, Steve and David Rice. Construction admin will
--    always default to Steve, and as needed Steve would hand it off to David
--    Rice… say there's a PPR — they get thrown onto it because they're more
--    construction-based, post-permit-issuance."*
--
--   *"Steve should be the default on every new **project**. He would only get
--    assigned to a permit by himself, or ENT in general."*
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD 2026-09-03, BEFORE THIS RAN
-- ---------------------------------------------------------------------------
--   team_members rows                        47
--   roles in use    acq · acq_lead · da · director · dm · ent · ent_lead ·
--                   schematic · viewer        (nine — `ca` is the tenth)
--   ★ NO ROW NAMED Steve OR David, and no `first_name`/`last_name` matching
--     Steve/Svetlik/David/Rice. The brief's collision check passes.
--   projects        211 (★ ZERO archived — the brief said "active and
--                   archived, ~202"; the real number is 211 and the
--                   archived/active split does not exist on prod)
--   permits         666
--
-- ★★★ THERE IS NO CHECK CONSTRAINT ON `team_members.role`. Departments have
--     one (`team_members_department_check`); roles do not. So `ca` needs no
--     database permission to exist — which is exactly why the vocabulary has
--     to be enumerated carefully in `src/`, where every list of roles actually
--     lives. The role's inventory is in the fix-487 PR body.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE TRIGGER TRAP THIS MIGRATION EXISTS TO AVOID
-- ---------------------------------------------------------------------------
-- `projects_cascade_lead` is `AFTER UPDATE **OF entitlement_lead**` with a
-- `WHEN (new.entitlement_lead IS DISTINCT FROM old.entitlement_lead)` clause.
-- Adding a `construction_admin` block INSIDE `bp_trg_project_lead_cascade`
-- and stopping there would have been **completely dead code**: the trigger
-- would never fire for a construction_admin-only change, and nothing would
-- have failed loudly. Both halves move together below.
--
-- ★★ AND fix-377's CASCADE IS SMALLER THAN THE BRIEF ASSUMED. Its
--    `design_manager → permits.dm` block was REMOVED by fix-379 (permits.dm is
--    derived from the permit's DA), so `entitlement_lead` is the ONLY column
--    that cascades today. "Treat `ca` like the others" therefore means "like
--    ent_lead", singular — and the new block is a copy of that one, including
--    `actual_issue IS NULL`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — THE PROJECT COLUMN, AND ITS DEFAULT
-- ---------------------------------------------------------------------------
-- ★★★ THE DEFAULT IS ON THE COLUMN, NOT IN THE WIZARD OR THE CREATE RPC.
--
-- Bobby: *"Steve should be the default on every new project."* Every insert
-- path then gets it for free — the wizard, the redesign path, the reuse path,
-- the backfill path, and any hand SQL — and none of them has to remember. The
-- alternative (a `COALESCE(..., 'Steve')` inside `bp_create_project_with_permits`)
-- covers one of those five and looks like it covers all of them.
--
-- ★★ IT IS A ROSTER `name`, exactly like `design_manager` and
--    `entitlement_lead` — a text join key, no FK, no cascade
--    (`team_members.name` is the join key across ~1,850 references).
--
-- ★ WHEN STEVE LEAVES, THIS IS ONE `ALTER ... SET DEFAULT`. Written down here
--   because a hard-coded person in a schema default is the kind of thing that
--   is obvious today and mysterious in a year.
alter table public.projects
  add column if not exists construction_admin text default 'Steve';

comment on column public.projects.construction_admin is
  'fix-487 (P-144): the project''s Construction Admin, a team_members.name. '
  'Defaults to Steve on every insert path per Bobby 2026-09-03; changing that '
  'default is one ALTER COLUMN SET DEFAULT.';

-- ---------------------------------------------------------------------------
-- 2 — THE PERMIT COLUMN
-- ---------------------------------------------------------------------------
-- ★★★ NO DEFAULT HERE, DELIBERATELY. Bobby: *"He would only get assigned to a
--     permit by himself, or ENT in general."* A permit-level CA is an
--     exception somebody makes on purpose (his example was a PPR), so the
--     column is blank until a person fills it, and the permit card shows the
--     row only when it is set.
alter table public.permits
  add column if not exists ca text;

comment on column public.permits.ca is
  'fix-487 (P-144): permit-level Construction Admin, a team_members.name. '
  'Blank by default — set by hand when a permit is handed to a CA.';

-- ---------------------------------------------------------------------------
-- 3 — THE DEPARTMENT VOCABULARY (fix-464''s five places, two of them here)
-- ---------------------------------------------------------------------------
-- fix-464 recorded that the department vocabulary lives in FIVE places and
-- that widening four of them ships a picker offering an option the writer
-- rejects. The two database ones are the CHECK and `bp_set_team_department`''s
-- own list; the three in `src/` move in the same commit.
alter table public.team_members
  drop constraint if exists team_members_department_check;

alter table public.team_members
  add constraint team_members_department_check check (
    department is null or department in (
      'policy', 'design_entitlements', 'acquisitions', 'underwriting',
      'executive', 'it_investor_relations',
      -- ★ fix-487. See the PR for the naming note: every other department is a
      --   FUNCTION and this one is a JOB TITLE, so "Construction" may read
      --   better. The label is what would change; this key would not.
      'construction_admin'
    )
  );

create or replace function public.bp_set_team_department(p_name text, p_department text)
 returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_dep  text := nullif(btrim(coalesce(p_department, '')), '');
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'a person is required';
  end if;
  if v_dep is not null and v_dep not in (
       'policy', 'design_entitlements', 'acquisitions', 'underwriting',
       'executive', 'it_investor_relations',
       -- ★ fix-487: the fifth place. fix-464's STEP 0 found this list by
       --   accident; it is named in the type's own comment now so the next
       --   department does not have to.
       'construction_admin') then
    raise exception 'unknown department: %', p_department;
  end if;

  update public.team_members m
     set department = v_dep
   where m.tenant_id = any (public.auth_tenant_ids())
     and m.name = v_name
     and m.department is distinct from v_dep;
  get diagnostics v_rows = row_count;

  if v_rows = 0 and not exists (
       select 1 from public.team_members m
        where m.tenant_id = any (public.auth_tenant_ids())
          and m.name = v_name) then
    raise exception 'no roster row for %', p_name;
  end if;
  return v_rows;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4 — THE CASCADE: BOTH HALVES
-- ---------------------------------------------------------------------------
create or replace function public.bp_trg_project_lead_cascade()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_old text;
  v_new text;
BEGIN
  -- entitlement_lead → permits.ent_lead (fix-377, unchanged)
  v_old := NULLIF(btrim(COALESCE(OLD.entitlement_lead, '')), '');
  v_new := NULLIF(btrim(COALESCE(NEW.entitlement_lead, '')), '');
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    UPDATE public.permits p
       SET ent_lead = v_new
     WHERE p.project_id = NEW.id
       AND p.actual_issue IS NULL
       AND lower(btrim(COALESCE(p.ent_lead, ''))) = lower(v_old);
  END IF;

  -- ★★★ fix-487: construction_admin → permits.ca, the SAME shape as the block
  -- above and for the same three reasons.
  --
  --   · BOTH SIDES NON-NULL. Clearing the project's CA does not clear it off
  --     the permits — that would erase a hand-made assignment from a screen
  --     that never mentioned it. Setting it for the first time does not push
  --     it down either: a permit-level CA is deliberate (Bobby's PPR case).
  --   · ONLY WHERE THE PERMIT STILL NAMES THE OLD PERSON. A permit David was
  --     handed by hand keeps David.
  --   · ★★★ `actual_issue IS NULL` — D-2026-08-28: AN ISSUED PERMIT RECORDS
  --     WHO TOOK IT THROUGH. Rewriting that would be falsifying history, and
  --     it matters more here than for ent_lead: the whole point of a CA is
  --     post-permit-issuance work, so issued permits are exactly the ones
  --     somebody will read this off later.
  v_old := NULLIF(btrim(COALESCE(OLD.construction_admin, '')), '');
  v_new := NULLIF(btrim(COALESCE(NEW.construction_admin, '')), '');
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    UPDATE public.permits p
       SET ca = v_new
     WHERE p.project_id = NEW.id
       AND p.actual_issue IS NULL
       AND lower(btrim(COALESCE(p.ca, ''))) = lower(v_old);
  END IF;

  -- ★★ fix-379: the design_manager → dm block that stood here is REMOVED.
  -- permits.dm is derived from the permit's DA (permits_derive_dm); a
  -- project's design manager changing moves nothing on permits.
  RETURN NULL;
END;
$function$;

-- ★★★ THE HALF THAT WOULD HAVE BEEN SILENT. Without this the block above is
--     unreachable for a construction_admin-only change.
drop trigger if exists projects_cascade_lead on public.projects;
create trigger projects_cascade_lead
  after update of entitlement_lead, construction_admin on public.projects
  for each row
  when (new.entitlement_lead is distinct from old.entitlement_lead
        or new.construction_admin is distinct from old.construction_admin)
  execute function public.bp_trg_project_lead_cascade();

-- ---------------------------------------------------------------------------
-- 5 — THE UPDATE RPC LEARNS THE COLUMN
-- ---------------------------------------------------------------------------
-- ★★ fix-410's FOUR-PLACE RULE for a new `projects` column: the column, BOTH
--    atomic RPCs, and `useProjects`' explicit select list — three of which
--    fail SILENTLY. Here the CREATE rpc is covered by the column DEFAULT
--    (step 1) rather than by an edit, so what is left is the UPDATE rpc and
--    the select list (in `src/`).
--
-- ★★★ PATCHED BY ANCHOR, NEVER RETYPED. `bp_update_project_with_permits` is
--     12.7 KB of live function text; retyping it from memory is how a
--     migration silently reverts six other tickets.
do $$
declare
  v_src    text;
  v_anchor text;
  v_add    text;
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bp_update_project_with_permits';

  v_anchor := '        design_manager   = CASE WHEN v_patch ? ''design_manager''    THEN NULLIF(v_patch->>''design_manager'','''')       ELSE design_manager END,';
  v_add    := '        construction_admin = CASE WHEN v_patch ? ''construction_admin'' THEN NULLIF(v_patch->>''construction_admin'','''')   ELSE construction_admin END,';

  if position(v_anchor in v_src) = 0 then
    raise exception 'fix-487: the design_manager anchor is not in bp_update_project_with_permits — refusing to guess';
  end if;

  if position('construction_admin' in v_src) > 0 then
    raise notice 'fix-487: bp_update_project_with_permits already knows construction_admin — skipping';
  else
    -- ★★ The body goes back as a QUOTED LITERAL, not inside a $tag$ block. The
    --    live text is 12.7 KB of plpgsql containing its own dollar-quoting, and
    --    picking a tag that happens to collide would be a silent truncation.
    execute
      'CREATE OR REPLACE FUNCTION public.bp_update_project_with_permits(' ||
      pg_get_function_identity_arguments('public.bp_update_project_with_permits'::regproc) ||
      ') RETURNS ' || pg_get_function_result('public.bp_update_project_with_permits'::regproc) ||
      ' LANGUAGE plpgsql' ||
      (select case when p.prosecdef then ' SECURITY DEFINER' else '' end
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'bp_update_project_with_permits') ||
      ' SET search_path TO ''public'', ''pg_temp'' AS ' ||
      quote_literal(replace(v_src, v_anchor, v_anchor || E'\n' || v_add));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6 — VERIFY
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='projects'
                    and column_name='construction_admin') then
    raise exception 'fix-487: projects.construction_admin missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='permits'
                    and column_name='ca') then
    raise exception 'fix-487: permits.ca missing';
  end if;
  if (select pg_get_triggerdef(t.oid) from pg_trigger t
       where t.tgrelid='public.projects'::regclass and t.tgname='projects_cascade_lead')
      not like '%construction_admin%' then
    raise exception 'fix-487: the cascade trigger does not watch construction_admin';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='bp_update_project_with_permits')
      not like '%construction_admin%' then
    raise exception 'fix-487: bp_update_project_with_permits did not take the patch';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='bp_set_team_department')
      not like '%construction_admin%' then
    raise exception 'fix-487: bp_set_team_department did not take the new department';
  end if;
end $$;

commit;
