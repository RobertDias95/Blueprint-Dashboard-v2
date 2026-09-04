-- ===========================================================================
-- fix-494 (P-155) — "SUBMITTED" MEANS ONE THING
-- ===========================================================================
--
-- Bobby, 2026-09-04, on `5811 Greenwood Ave N` / `7128829-CN` (permit 316):
--
--   *"why did the task get created in the design bucket if the project is
--    under corrections for the architect?"*
--
-- Miles posted CR1 in chat and made *"CR1 – Review Corrections"* from the
-- message. It landed in **D&E** on a permit submitted 2026-06-25, intake
-- accepted 2026-06-26, corrections issued 2026-09-04.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE CAUSE: TWO DEFINITIONS OF "SUBMITTED", AND THEY DISAGREE
-- ---------------------------------------------------------------------------
-- The permit SCREEN defaults its phase from `c0.intake_accepted`
-- (PermitDetailV2, fix-123). This TRIGGER used `c0.submitted`. They are
-- different dates, and on permit 316 they disagree:
--
--     c0.submitted        NULL         ← what the trigger read
--     c0.intake_accepted  2026-06-26   ← what the screen reads
--     c1.submitted        2026-06-25
--
-- So the screen said Permitting and the database said D&E, and a task created
-- from chat (which sends no bucket) got the database's answer.
--
-- ★★★ MEASURED ON PROD 2026-09-04: **58 of 261 open permits** are in this
--     shape — `c0.submitted` NULL while `c0.intake_accepted` or a cycle-1+
--     `submitted` says the permit is with the city. ("Open" = `actual_issue IS
--     NULL`, which is the definition that reproduces the brief's figures;
--     under the stricter "no approval AND no actual_issue" it is 41 of 211.)
--     Every chat-created task on any of them went to D&E.
--
-- ---------------------------------------------------------------------------
-- ★★★ NO BACKFILL. EXISTING ROWS KEEP THEIR BUCKET.
-- ---------------------------------------------------------------------------
-- A task's bucket is a placement somebody may since have corrected by hand, and
-- this migration cannot tell a misfiled row from a deliberate one. The two
-- tasks Bobby found were moved by Cowork on his yes (2026-09-04); two "MGR
-- Redlines" tasks on 3241 44th Ave SW were left alone as plausibly design work.
-- This changes what happens NEXT, and nothing that already happened.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — THE PREDICATE, ONCE
-- ---------------------------------------------------------------------------
-- ★★ A permit is SUBMITTED when any of three things is true. All three mean
--    "the city has it"; none of them is more authoritative than the others,
--    and requiring `c0.submitted` alone is what produced the defect.
--
--      c0.intake_accepted   the city accepted intake      (what the screen used)
--      c0.submitted         cycle 0 was submitted         (what the trigger used)
--      any cycle >= 1 with a `submitted` date             (a resubmittal, and on
--                                                          permit 316 the ONLY
--                                                          signal of the three
--                                                          the old rule could
--                                                          have seen)
--
-- ★★★ IT IS A FUNCTION SO THERE IS ONE COPY. The trigger below calls it, and so
--     does any future caller. Its TypeScript twin is `permitIsSubmitted`
--     (src/lib/permitPhase.ts), which the chat composer and the permit screen
--     both use — three readers, one rule, which is the whole point of the
--     ticket (D-2026-09-02: consistency is a brand rule).
--
-- ★ STABLE, SECURITY INVOKER: called directly it must respect the caller's RLS
--   on `permit_cycles`. Called from the SECURITY DEFINER trigger it runs with
--   the definer's rights, which is what the trigger already had.
create or replace function public.bp_permit_is_submitted(p_permit_id integer)
returns boolean
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.permit_cycles c
     where c.permit_id = p_permit_id
       and (
         (c.cycle_index = 0 and (c.intake_accepted is not null or c.submitted is not null))
         or (c.cycle_index >= 1 and c.submitted is not null)
       )
  );
$function$;

comment on function public.bp_permit_is_submitted(integer) is
  'fix-494 (P-155): is this permit with the city? True when cycle 0 has an '
  'intake_accepted or a submitted date, or any cycle >= 1 has a submitted '
  'date. The one definition of "submitted" for task phase; TS twin is '
  'permitIsSubmitted in src/lib/permitPhase.ts.';

-- ★ authenticated only — no anon (fix-157's posture).
revoke all on function public.bp_permit_is_submitted(integer) from public, anon;
grant execute on function public.bp_permit_is_submitted(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2 — THE TRIGGER USES IT
-- ---------------------------------------------------------------------------
-- ★★ EVERYTHING ELSE IS fix-79'S, UNCHANGED: the same trigger, the same
--    explicit-bucket short circuit (a caller that names a bucket still wins,
--    which is how the permit screen's tabs keep working), the same `'auto'`
--    handling, the same fallthrough to 'de', still SECURITY DEFINER.
create or replace function public.bp_trg_permit_task_default_bucket()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  -- fix-79: an explicit bucket always wins. 'auto' is the caller asking for
  -- the default, which is what the rest of this function computes.
  IF NEW.bucket IS NOT NULL AND NEW.bucket <> 'auto' THEN
    RETURN NEW;
  END IF;
  -- ★★★ fix-494: was `c0.submitted IS NOT NULL`, which is one of three
  --     signals and the one permit 316 does not have.
  NEW.bucket := CASE
    WHEN public.bp_permit_is_submitted(NEW.permit_id) THEN 'pm'
    ELSE 'de'
  END;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3 — VERIFY
-- ---------------------------------------------------------------------------
do $$
begin
  -- ★ Permit 316 is the case Bobby reported: c0.submitted NULL, intake
  --   accepted, cycle 1 submitted. It must now read as submitted.
  if not public.bp_permit_is_submitted(316) then
    raise exception 'fix-494: permit 316 still does not read as submitted';
  end if;
  -- ★ …and the trigger must be calling the function, not the old column read.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'bp_trg_permit_task_default_bucket')
      not like '%bp_permit_is_submitted%' then
    raise exception 'fix-494: the trigger did not take the new predicate';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- ★ VERIFIED AFTER COMMIT, 2026-09-04 — measured, not predicted
-- ---------------------------------------------------------------------------
--   bp_permit_is_submitted(316)      TRUE   (the reported permit)
--   trigger calls the helper         yes
--   grants                           postgres=EXECUTE, authenticated=EXECUTE,
--                                    service_role=EXECUTE  (no anon)
--   permits this now buckets to 'pm' 58 of 261 open (actual_issue IS NULL)
--   permit_tasks buckets after       de=508 · pm=1214 · other=0
--
--   ★ NOTHING WAS BACKFILLED, and that is checkable rather than promised: this
--     file contains no UPDATE, INSERT or DELETE against permit_tasks at all.
--     A suite assertion greps for all three.
