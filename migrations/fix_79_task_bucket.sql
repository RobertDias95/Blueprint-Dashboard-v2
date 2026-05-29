-- fix-79 (2026-05-29): permit_tasks.bucket = lifecycle PHASE (D&E vs Permitting).
--
-- Context: fix-70 added a `discipline` column (arch/ent) and used the existing
-- `bucket` column ONLY as a hardcoded 'de' placeholder on insert. v1's task
-- model had TWO independent axes:
--   - discipline: arch / ent  (who owns it — handled by fix-70's `discipline`)
--   - bucket    : de   / pm   (when in the permit lifecycle — what fix-79 restores)
-- fix-70's RPC signature used `p_bucket` for the discipline; this migration
-- renames that to `p_discipline` and frees `p_bucket` for the real lifecycle
-- meaning. The old terminology drift is the reason fix-79 exists at all.
--
-- Rules (locked with Bobby):
--   bucket='de' (Design & Engineering) — task created BEFORE the parent permit
--     entered city review (cycle 0 .submitted IS NULL at task creation).
--   bucket='pm' (Permitting) — task created AFTER cycle 0 .submitted is set.
--
-- The legacy schema accepted 'co' (Corrections) as a 3rd value; corrections
-- ARE part of the Permitting lifecycle phase, so the migration collapses any
-- existing 'co' rows into 'pm' before locking the CHECK to ('de','pm').
--
-- ADDITIVE + SAFE: column is `ADD … IF NOT EXISTS`; backfill is idempotent;
-- CHECK constraint is created fresh after the collapse.

-- ---------------------------------------------------------------------------
-- 1. Column + backfill
-- ---------------------------------------------------------------------------
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS bucket text;

-- Backfill rows with NULL bucket using the c0-submitted rule.
UPDATE public.permit_tasks t
SET bucket = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.permit_cycles c0
    WHERE c0.permit_id = t.permit_id
      AND c0.cycle_index = 0
      AND c0.submitted IS NOT NULL
      AND c0.submitted <= t.created_at::date
  ) THEN 'pm'
  ELSE 'de'
END
WHERE t.bucket IS NULL;

-- Collapse legacy 'co' into 'pm' (corrections live inside the Permitting
-- lifecycle). Any other legacy value falls through to 'de'.
UPDATE public.permit_tasks SET bucket = 'pm' WHERE bucket = 'co';
UPDATE public.permit_tasks
  SET bucket = 'de'
  WHERE bucket IS NOT NULL AND bucket NOT IN ('de','pm');

-- Drop any prior CHECK on bucket (legacy schemas may have had one that
-- allowed 'co' or other values) so the strict 2-value CHECK below succeeds.
DO $drop_check$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.permit_tasks'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%bucket%'
  LOOP
    EXECUTE format('ALTER TABLE public.permit_tasks DROP CONSTRAINT IF EXISTS %I',
                   v_conname);
  END LOOP;
END
$drop_check$;

ALTER TABLE public.permit_tasks
  ALTER COLUMN bucket SET NOT NULL,
  ALTER COLUMN bucket SET DEFAULT 'de',
  ADD CONSTRAINT permit_tasks_bucket_check CHECK (bucket IN ('de','pm'));

CREATE INDEX IF NOT EXISTS permit_tasks_permit_bucket_idx
  ON public.permit_tasks(permit_id, bucket);

-- ---------------------------------------------------------------------------
-- 2. BEFORE INSERT trigger — auto-default bucket from the parent permit's
--    current cycle 0 state when the caller doesn't supply one (or supplies
--    the sentinel 'auto'). The RPC below uses 'auto' for that opt-in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_permit_task_default_bucket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_c0_submitted date;
BEGIN
  IF NEW.bucket IS NOT NULL AND NEW.bucket <> 'auto' THEN
    RETURN NEW;
  END IF;
  SELECT submitted INTO v_c0_submitted
    FROM public.permit_cycles
    WHERE permit_id = NEW.permit_id AND cycle_index = 0
    LIMIT 1;
  NEW.bucket := CASE WHEN v_c0_submitted IS NOT NULL THEN 'pm' ELSE 'de' END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bp_trg_permit_task_default_bucket ON public.permit_tasks;
CREATE TRIGGER bp_trg_permit_task_default_bucket
  BEFORE INSERT ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_permit_task_default_bucket();

-- ---------------------------------------------------------------------------
-- 3. RPC updates — additive: existing callers keep working, new ones get
--    bucket on read and can pass discipline + bucket on write.
-- ---------------------------------------------------------------------------

-- bp_upsert_permit_task: fix-70 used `p_bucket` to mean discipline. Rename to
-- `p_discipline` and free `p_bucket` for the real lifecycle phase. Legacy
-- callers pass p_bucket=NULL → trigger picks the phase, default discipline
-- 'ent' from existing rows preserved.
DROP FUNCTION IF EXISTS public.bp_upsert_permit_task(uuid, integer, uuid, text, text, text, date, date, integer);
CREATE OR REPLACE FUNCTION public.bp_upsert_permit_task(
  p_id             uuid,
  p_permit_id      integer,
  p_parent_task_id uuid,
  p_discipline     text,
  p_text           text,
  p_status         text,
  p_start_date     date,
  p_target_date    date,
  p_sort_order     integer,
  p_bucket         text DEFAULT NULL  -- 'de' | 'pm' | NULL (=auto via trigger)
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants    uuid[] := public.auth_tenant_ids();
  v_primary    uuid   := (public.auth_tenant_ids())[1];
  v_discipline text   := CASE WHEN p_discipline = 'arch' THEN 'arch' ELSE 'ent' END;
  v_status     text   := CASE
                           WHEN p_status IN ('Open','In Progress','Resolved') THEN p_status
                           ELSE 'Open'
                         END;
  -- NULL or 'auto' means "let the BEFORE INSERT trigger pick the phase".
  v_bucket     text   := CASE
                           WHEN p_bucket IN ('de','pm') THEN p_bucket
                           ELSE NULL
                         END;
  v_id         uuid;
BEGIN
  IF COALESCE(TRIM(p_text), '') = '' THEN
    RAISE EXCEPTION 'task text is required';
  END IF;

  IF p_parent_task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.permit_tasks
    WHERE id = p_parent_task_id
      AND tenant_id = ANY (v_tenants)
      AND parent_task_id IS NULL
  ) THEN
    RAISE EXCEPTION 'parent task % is not a valid top-level task in caller tenant', p_parent_task_id;
  END IF;

  IF p_id IS NULL THEN
    -- Insert: pass bucket=NULL to let the BEFORE INSERT trigger compute the
    -- phase from c0.submitted; otherwise honor the explicit value.
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, parent_task_id, discipline, bucket, stage,
      text, completion_status, start_date, target_date, sort_order
    )
    VALUES (
      v_primary, p_permit_id, p_parent_task_id, v_discipline, v_bucket, 'de',
      TRIM(p_text), v_status, p_start_date, p_target_date, COALESCE(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.permit_tasks
      SET parent_task_id    = p_parent_task_id,
          discipline        = v_discipline,
          -- Edit-time bucket: explicit value moves the task between
          -- D&E and Permitting; NULL leaves the existing bucket alone.
          bucket            = COALESCE(v_bucket, bucket),
          text              = TRIM(p_text),
          completion_status = v_status,
          start_date        = p_start_date,
          target_date       = p_target_date,
          sort_order        = COALESCE(p_sort_order, sort_order),
          updated_at        = now()
    WHERE id = p_id
      AND tenant_id = ANY (v_tenants)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'task % not found in caller tenant', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_upsert_permit_task(
  uuid, integer, uuid, text, text, text, date, date, integer, text
) TO authenticated;

-- bp_list_permit_tasks: surface bucket on every task + every nested subtask.
CREATE OR REPLACE FUNCTION public.bp_list_permit_tasks(p_permit_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_da      text;
  v_ent     text;
  v_result  jsonb;
BEGIN
  SELECT da, ent_lead INTO v_da, v_ent
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = ANY (v_tenants);

  SELECT COALESCE(jsonb_agg(task_obj ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'permit_id', t.permit_id,
        'parent_task_id', t.parent_task_id,
        'discipline', COALESCE(t.discipline, 'ent'),
        'bucket', t.bucket,
        'text', t.text,
        'status', t.completion_status,
        'start_date', t.start_date,
        'target_date', t.target_date,
        'done_at', t.done_at,
        'sort_order', t.sort_order,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch' THEN v_da ELSE v_ent END,
        'co_assignees', public.bp_task_co_assignees(t.id),
        'subtasks', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'permit_id', s.permit_id,
              'parent_task_id', s.parent_task_id,
              'discipline', COALESCE(s.discipline, COALESCE(t.discipline,'ent')),
              'bucket', s.bucket,
              'text', s.text,
              'status', s.completion_status,
              'start_date', s.start_date,
              'target_date', s.target_date,
              'done_at', s.done_at,
              'sort_order', s.sort_order,
              'primary_assignee',
                CASE WHEN COALESCE(s.discipline, COALESCE(t.discipline,'ent')) = 'arch'
                     THEN v_da ELSE v_ent END,
              'co_assignees', public.bp_task_co_assignees(s.id)
            )
            ORDER BY s.sort_order, s.created_at
          )
          FROM public.permit_tasks s
          WHERE s.parent_task_id = t.id AND s.tenant_id = ANY (v_tenants)
        ), '[]'::jsonb)
      ) AS task_obj
    FROM public.permit_tasks t
    WHERE t.permit_id = p_permit_id
      AND t.tenant_id = ANY (v_tenants)
      AND t.parent_task_id IS NULL
  ) ranked;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_list_permit_tasks(integer) TO authenticated;

-- bp_list_tasks (fix-78): include bucket on every row so the MyTasks page +
-- consumers can filter on D&E vs Permitting too.
CREATE OR REPLACE FUNCTION public.bp_list_tasks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_result  jsonb;
BEGIN
  SELECT COALESCE(
           jsonb_agg(obj ORDER BY project_address, permit_id, sort_order, created_at),
           '[]'::jsonb
         )
    INTO v_result
  FROM (
    SELECT
      pr.address AS project_address,
      t.permit_id,
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id',              t.id,
        'permit_id',       t.permit_id,
        'project_id',      p.project_id,
        'project_address', pr.address,
        'permit_type',     p.type,
        'parent_task_id',  t.parent_task_id,
        'discipline',      COALESCE(t.discipline, 'ent'),
        'bucket',          t.bucket,
        'text',            t.text,
        'status',          t.completion_status,
        'start_date',      t.start_date,
        'target_date',     t.target_date,
        'done_at',         t.done_at,
        'sort_order',      t.sort_order,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch'
               THEN p.da ELSE p.ent_lead END,
        'co_assignees', public.bp_task_co_assignees(t.id)
      ) AS obj
    FROM public.permit_tasks t
    JOIN public.permits  p  ON p.id = t.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE t.tenant_id = ANY (v_tenants)
  ) rows;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_list_tasks() TO authenticated;
