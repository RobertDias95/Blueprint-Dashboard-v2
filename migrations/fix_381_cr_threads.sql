-- ===========================================================================
-- fix-381 — every project gets a correction round, and a thread waiting for it
-- ===========================================================================
--
-- Bobby: "add a CR 1 — this is for correction cycle 1. We always know we're
-- going to have at least one correction cycle, for the most part. Any new
-- project should have a Preliminary Assessment, a Design Phase, ACQ Questions,
-- and then a CR 1 folder." And on later rounds, asked whether CR 2 / CR 3
-- should self-create: "yes, but only for a building permit CR 2 etc."
--
-- Two halves:
--   1. CR 1 joins the new-project seed (unconditional, like the other three).
--   2. A permit_cycles trigger mints CR N when a BUILDING PERMIT's correction
--      round N is issued — and nothing at all for any other permit type.
--
-- ★★★ THE MAPPING: permit_cycles.cycle_index N  ->  thread 'CR N', N >= 1.
-- Cycle 0 is the design / initial submittal and never mints a thread. This is
-- the same axis fix-40's bp_compute_corr_rounds counts on
-- ("cycle_index >= 1 AND corr_issued IS NOT NULL"), so a project's CR threads
-- and its corr_rounds can never disagree about which round is which.
--
-- Proved on prod permit 168, BLDG-2026-02118 (Building Permit, corr_rounds=3):
--   cycle 0  submitted 2026-03-27  corr_issued NULL     <- design, no thread
--   cycle 1  submitted 2026-05-12  corr_issued 06-09    -> CR 1
--   cycle 2  submitted 2026-06-29  corr_issued 07-14    -> CR 2
--   cycle 3  submitted 2026-07-21  corr_issued 07-23    -> CR 3
--   cycle 4  submitted 2026-07-29  corr_issued NULL     <- open, no thread yet
-- Three corr_issued rounds, corr_rounds = 3, threads CR 1..CR 3. They line up.
--
-- ★★ ONE PROJECT, SEVERAL BUILDING PERMITS, ONE THREAD PER ROUND. The threads
-- hang off the PROJECT (project_messages.project_id) — which is what the seed
-- function already assumed — so two BPs on one project both reaching cycle 2
-- must not mint two 'CR 2's. Two guards, because the existence check alone is
-- only safe against a sequential writer:
--   · the same NOT EXISTS title check the seed already uses, and
--   · a transaction-scoped advisory lock on (project, title), so two
--     concurrent scraper writes serialise instead of both passing the check.
-- A partial unique index was the alternative and was rejected: it would also
-- forbid a person from ever creating two same-titled threads by hand, which is
-- a rule nobody asked for.
--
-- ★★ THE AUTHOR ON A TRIGGER-MINTED THREAD IS NULL, DELIBERATELY. The seed
-- keeps auth.uid() (the person really did create the project), but a CR thread
-- minted by the cycle trigger is a machine act: under the scraper there is no
-- auth.uid() anyway, and under a signed-in user stamping them would put their
-- name on a byline they never wrote and hand them Edit/Delete, which the chat
-- gates on author_id = auth.uid(). Per fix-363 a null author means NOT
-- RECORDED, never "nobody". Verified in the client: bp_profile_display_name
-- (NULL) returns NULL without dropping the row, the byline falls back to
-- "Unknown" (ChatMessageRow.tsx:178, ProjectChatModal.tsx:512) and the avatar
-- to "··" (projectChat.ts:405) — no crash, no "undefined". These would be the
-- first null-author rows in prod; today there are none.
--
-- ★★★ IT NOTIFIES NOBODY, BY CONSTRUCTION. Every notification path keys off
-- MENTIONS and never looks at author_id: useProjectMessages.ts:114-125 filters
-- .contains('mentions',[userId]), boardReads.ts:479 re-checks
-- `if (!(m.mentions ?? []).includes(meId)) continue`, and the bell, centre,
-- desktop alert and sound all read that one item list. A seeded row carries
-- mentions = {} and so produces no item anywhere. Asserted, not assumed.
--
-- ★★★ NOT WIRED TO CORRECTIONS DATA. A 'CR N' thread is a conversation, not a
-- correction record. fix-372's clustering reads correction_items and is
-- untouched here; nothing in this migration references that table.
--
-- ★ NO ROW IS EDITED BY THIS MIGRATION. It replaces one function and adds
-- three more objects plus two triggers. The 88-project CR 1 backfill is a DATA
-- change and lives, unapplied and commented out, in
-- migrations/fix_381_backfill_PENDING_APPROVAL.sql.
--
-- Based on the LIVE pg_get_functiondef from prod (eibnmwthkcuumyclyxoe).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · The body text, in one place, so a CR 1 written by the seed and a CR 1
--     written by the trigger are the same thread, word for word.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_cr_thread_body(p_round integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_round <= 1
      THEN 'The first round of city corrections — what came back, and who is clearing what.'
    ELSE 'Round ' || p_round || ' of city corrections — what came back, and who is clearing what.'
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 2 · Ensure one 'CR N' thread on a project. Idempotent, and safe against a
--     second writer arriving for the same round at the same moment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_ensure_cr_thread(
  p_project_id uuid,
  p_round      integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_title  text;
  v_made   integer := 0;
BEGIN
  -- Cycle 0 is design, not a correction round: nothing to open.
  IF p_project_id IS NULL OR p_round IS NULL OR p_round < 1 THEN
    RETURN 0;
  END IF;

  SELECT pr.tenant_id INTO v_tenant FROM public.projects pr WHERE pr.id = p_project_id;
  IF v_tenant IS NULL THEN
    RETURN 0;
  END IF;

  v_title := 'CR ' || p_round;

  -- ★★ Serialise only same-project-same-round writers. Two building permits on
  -- one project reaching round N in concurrent transactions would otherwise
  -- both pass the NOT EXISTS below and mint two threads.
  PERFORM pg_advisory_xact_lock(hashtext(p_project_id::text || '|' || v_title));

  -- ★★★ author_id is NULL ON PURPOSE, not merely because the scraper has no
  -- auth.uid(). This thread is machine-minted: the person who happened to save
  -- a corrections date did not open it, and stamping them would put their name
  -- on a byline they never wrote AND hand them Edit/Delete on it, since the
  -- chat gates both on author_id = auth.uid(). fix-363's three-state rule says
  -- a machine act is not a person's; NULL ("not recorded") is the honest value
  -- project_messages can hold, and it renders as "Unknown". Writing it
  -- explicitly also means the row is identical whether the scraper or a signed-
  -- in user triggered it, instead of depending on who was logged in.
  INSERT INTO public.project_messages
    (tenant_id, project_id, author_id, title, body, parent_message_id, created_at)
  SELECT v_tenant, p_project_id, NULL::uuid, v_title,
         public.bp_cr_thread_body(p_round), NULL, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_messages m
    WHERE m.project_id = p_project_id
      AND m.parent_message_id IS NULL
      AND m.title = v_title
  );
  GET DIAGNOSTICS v_made = ROW_COUNT;

  RETURN v_made;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3 · The new-project seed, now four threads. Everything else is as it was:
--     same three titles, same bodies, same ordering, same idempotence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_seed_project_posts(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_author uuid := auth.uid();
  v_made   integer := 0;
  v_rows   integer;
  v_seed   record;
BEGIN
  SELECT pr.tenant_id INTO v_tenant FROM public.projects pr WHERE pr.id = p_project_id;
  IF v_tenant IS NULL THEN RETURN 0; END IF;

  FOR v_seed IN
    SELECT * FROM (VALUES
      (1, 'ACQ Questions',
          'Anything acquisitions — questions for the ACQ team live here.'),
      (2, 'Design Phase',
          'Design through intake: drawings, consultants, and the submittal set.'),
      (3, 'Preliminary Assessment',
          'The city''s initial comments on what we are submitting.'),
      -- ★★★ fix-381: "We always know we're going to have at least one
      -- correction cycle, for the most part" — so the folder is there from
      -- the start rather than being made on the day the corrections land.
      (4, 'CR 1',
          public.bp_cr_thread_body(1))
    ) AS s(ord, title, body)
    ORDER BY ord
  LOOP
    -- ★ Idempotent by existence: creating a project twice cannot produce eight
    -- posts, and a project that already has one of these threads keeps it.
    INSERT INTO public.project_messages
      (tenant_id, project_id, author_id, title, body, parent_message_id, created_at)
    SELECT v_tenant, p_project_id, v_author, v_seed.title, v_seed.body, NULL,
           now() + (v_seed.ord * interval '1 millisecond')
    WHERE NOT EXISTS (
      SELECT 1 FROM public.project_messages m
      WHERE m.project_id = p_project_id
        AND m.parent_message_id IS NULL
        AND m.title = v_seed.title
    );
    -- ★ fix-381: count what was actually written. This used to increment
    -- unconditionally, so the function always claimed 3 even when it wrote
    -- nothing — harmless to the trigger, which ignores the result, but it
    -- made the return value useless for saying what a backfill did.
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_made := v_made + v_rows;
  END LOOP;

  RETURN v_made;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4 · Later rounds mint themselves — BUILDING PERMITS ONLY.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_cycle_cr_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project uuid;
  v_type    text;
BEGIN
  -- Cycle 0 is the design / initial submittal — never a correction round.
  IF NEW.cycle_index IS NULL OR NEW.cycle_index < 1 THEN
    RETURN NULL;
  END IF;

  SELECT p.project_id, p.type INTO v_project, v_type
  FROM public.permits p WHERE p.id = NEW.permit_id;

  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  -- ★★★ Bobby, verbatim: "yes, but only for a building permit CR 2 etc."
  -- A ULS, demo, SDOT Tree or PAR/Pre-Sub reaching round 2 mints nothing.
  IF v_type IS DISTINCT FROM 'Building Permit' THEN
    RETURN NULL;
  END IF;

  PERFORM public.bp_ensure_cr_thread(v_project, NEW.cycle_index);
  RETURN NULL;
END;
$function$;

-- Two triggers rather than one, so an UPDATE that merely restates the same
-- corr_issued does no work — the bp_trg_permits_intake_sync_ins/_upd shape.
DROP TRIGGER IF EXISTS permit_cycles_cr_thread_ins ON public.permit_cycles;
CREATE TRIGGER permit_cycles_cr_thread_ins
AFTER INSERT ON public.permit_cycles
FOR EACH ROW
WHEN (NEW.corr_issued IS NOT NULL)
EXECUTE FUNCTION public.bp_trg_cycle_cr_thread();

DROP TRIGGER IF EXISTS permit_cycles_cr_thread_upd ON public.permit_cycles;
CREATE TRIGGER permit_cycles_cr_thread_upd
AFTER UPDATE OF corr_issued ON public.permit_cycles
FOR EACH ROW
WHEN (NEW.corr_issued IS NOT NULL AND NEW.corr_issued IS DISTINCT FROM OLD.corr_issued)
EXECUTE FUNCTION public.bp_trg_cycle_cr_thread();

-- ---------------------------------------------------------------------------
-- 5 · Grants, matching the surrounding chat surface.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_cr_thread_body(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_ensure_cr_thread(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_cr_thread_body(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_ensure_cr_thread(uuid, integer) TO authenticated, service_role;
