-- ===========================================================================
-- fix-464 — TWO MORE DEPARTMENTS: Executive, and IT & Investor Relations
-- ===========================================================================
--
-- ★★★ THIS MIGRATION ASSIGNS NOBODY. It widens a vocabulary. Bobby has already
-- told Claude who goes where, and Claude applies those three rows from Cowork
-- after merge in the approved-migration lane. There is no UPDATE against a real
-- person in this file.
--
-- ---------------------------------------------------------------------------
-- WHY, MEASURED ON PROD 2026-08-31 (0c — every number confirmed before writing)
-- ---------------------------------------------------------------------------
-- Bobby classified the roster himself over the weekend, exactly as fix-461
-- intended. **32 of 35 active people are done.** The three that are not —
-- Darin, Eric and Keenan — are not an oversight: the CHECK constraint admitted
-- exactly four values and none of them fit.
--
--   design_entitlements  21    acquisitions  7    underwriting  3    policy  1
--   NULL                  3    Darin, Eric, Keenan
--
-- ★ The roster already records what those three do, in `team_members.notes` —
--   the field `rosterRoleTitle()` prints as a viewer's name plate:
--   **Darin `CEO` · Eric `President` · Keenan `IT`.** For the four classified
--   viewers the note and the department say the same word (EJ/Greg/Taylor
--   `Underwriting`, Lucas `Policy`), which is why those set cleanly. CEO and
--   President do not, because they sit ABOVE the four rather than inside one.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE RULING, AND WHAT IT SUPERSEDES
-- ---------------------------------------------------------------------------
-- Bobby, 2026-08-31, amending his 2026-08-26 list: *"eric and darin are
-- president and ceo, so they need a department. keenan is investor
-- relations/IT so he needs a department too."* Asked to choose the shape, he
-- took **two new departments, not one** — Executive for Darin and Eric, and
-- IT & Investor Relations for Keenan — so that **IT is its own function rather
-- than filed under the CEO**.
--
-- SIX, FINAL: Policy · Design & Entitlements · Acquisitions · Underwriting ·
--            Executive · IT & Investor Relations.
--
-- ★★ NEWEST-FIRST. fix-461 recorded "do not add a fifth" in three places; that
-- instruction is SUPERSEDED and those comments now say so. ★ ACCOUNTING IS
-- STILL NOT A DEPARTMENT — that half of fix-461's note stands, and the two must
-- not be blurred: he replaced Accounting with Underwriting in the same
-- conversation, and has not revisited it.

-- ---------------------------------------------------------------------------
-- §A2 — THE CONSTRAINT
-- ---------------------------------------------------------------------------
alter table public.team_members
  drop constraint if exists team_members_department_check;

alter table public.team_members
  add constraint team_members_department_check
  check (department is null or department in (
    'policy', 'design_entitlements', 'acquisitions', 'underwriting',
    'executive', 'it_investor_relations'
  ));

comment on column public.team_members.department is
  'fix-461 (P-045 prereq), widened by fix-464: which of Bobby''s SIX departments '
  'this PERSON belongs to — policy | design_entitlements | acquisitions | '
  'underwriting | executive | it_investor_relations. NULL = not yet classified, '
  'a first-class state. It is a fact about the PERSON, not the role row: '
  'bp_trg_team_department_sync keeps every row sharing a name in agreement. Set '
  'it through bp_set_team_department, which works by NAME.';

-- ---------------------------------------------------------------------------
-- ★★★ THE FIFTH PLACE — AND STEP 0a IS WHY IT IS IN THIS FILE
-- ---------------------------------------------------------------------------
-- The brief named four places the vocabulary lives and asked whether
-- `bp_set_team_department` carries a list of its own. **It does**, and prod
-- confirmed it before anything was written:
--
--   if v_dep is not null and v_dep not in (
--        'policy', 'design_entitlements', 'acquisitions', 'underwriting') then
--     raise exception 'unknown department: %', p_department;
--
-- ★★ SO WIDENING ONLY THE CONSTRAINT WOULD HAVE SHIPPED A PICKER THAT OFFERS
-- TWO OPTIONS THE WRITER REJECTS. The constraint would have allowed the value,
-- the type would have allowed it, the dropdown would have shown it — and
-- clicking it would raise "unknown department: executive". A failure at the
-- last step of a four-step change, which is the shape that survives review.
--
-- ★ `bp_trg_team_department_sync` was checked too and is genuinely
--   value-agnostic — it copies whatever value it is given across a person's
--   rows and never inspects it. It is not touched here.
--
-- ★★ The function is otherwise UNCHANGED — same signature, same SECURITY
--    INVOKER (team_members' RLS already gates writes on is_tenant_admin), same
--    name-keyed contract, same NULL-is-allowed rule so somebody can be
--    un-classified. Only the list moved.
create or replace function public.bp_set_team_department(
  p_name       text,
  p_department text
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_dep  text := nullif(btrim(coalesce(p_department, '')), '');
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'a person is required';
  end if;
  -- ★ NULL is a legitimate value to SET, not just to start at: Bobby must be
  --   able to un-classify somebody he classified by mistake.
  if v_dep is not null and v_dep not in (
       'policy', 'design_entitlements', 'acquisitions', 'underwriting',
       'executive', 'it_investor_relations') then
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
$$;

revoke all on function public.bp_set_team_department(text, text) from public, anon;
grant execute on function public.bp_set_team_department(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- ★ §A6: no backfill and no default. These must be UNCHANGED by this file.
-- select count(distinct name) filter (where department is not null) as classified,
--        count(distinct name) filter (where department is null)     as unclassified
--   from public.team_members where active;                       -- 32 / 3
-- select string_agg(distinct name, ', ') from public.team_members
--  where active and department is null;                          -- Darin, Eric, Keenan
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'team_members_department_check';              -- six values
