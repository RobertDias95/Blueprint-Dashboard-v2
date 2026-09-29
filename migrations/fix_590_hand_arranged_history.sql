-- ===========================================================================
-- fix-590 — the work you arranged by hand, and getting it back
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED.** Written for Bobby to apply. fix-590 did not run this
--       against prod. The app ships working with it unapplied: every surface
--       this ticket adds degrades to "No history recorded yet" and the two
--       restore RPCs simply do not exist, which the client handles.
--
-- ★★ AND IT IS **NOT** ON `PENDING_APPROVAL_INDEX.md`, DELIBERATELY. That page is
--    the COMMENTED-OUT BACKFILL shelf: `PendingApprovalIndexFix450` defines it as
--    files ending `_PENDING_APPROVAL.sql` / `_SUPERSEDED.sql`, requires every
--    `fix_*.sql` the page names to BE one of them, and asserts that none of them
--    contains uncommented DDL. This file is live DDL, so listing it there would
--    fail two of that test's assertions — I tried it and it did. It follows
--    `fix_520_projects_audit_trail.sql` instead: a plain migration whose header
--    says NOT APPLIED and whose test pins that.
--
-- THE REPORT (2026-09-16). Bobby's hand-arranged Q4 2025 draw-schedule layout —
-- twelve columns, two DM groups — was not in the tool, and he found out eleven
-- months later from a screenshot. **The thing that could not be answered was
-- whether it had been deleted or never saved**, because
-- `draw_schedule_quarter_layout` has no history and those two are the same
-- observation. He rebuilt it from a picture.
--
--   *"That sucks and we need a way to quickly restore areas like this
--    negatively impacted by updates."*
--
-- ★★★ THE PATTERN WAS BACKWARDS. The tables the system writes constantly had
--     history; the tables a PERSON arranges by hand had none.
--
-- ---------------------------------------------------------------------------
-- MEASURED 2026-09-29 (re-derived; the brief was written 09-20)
-- ---------------------------------------------------------------------------
--
--   table                           rows   history before this file
--   permit_cycles                  2,224   none      (brief said 1,931)
--   permits                          773   none      (brief said 695)
--   draw_schedule_quarter_layout     104   none      ← this ticket's origin
--   task_templates                    87   none
--   team_members                      51   none
--   app_config                        28   none
--   permit_type_defaults              15   none
--   da_team_routing                   12   none
--   projects                         270   UPDATE ONLY  ← the same hole
--   permit_tasks                   2,088   I/D/U     (bespoke, untouched)
--   draw_schedule                    270   I/D/U     (bespoke, untouched)
--   permit_task_assignees              —   I/D       (bespoke, untouched)
--
-- ★★★ THERE ARE FOUR EXISTING MECHANISMS, NOT THREE. The brief lists
--     `audit_log`, `permit_task_audit` and `draw_schedule_audit`.
--     `permit_task_assignees` also has one — `bp_audit_task_assignee`, INSERT
--     and DELETE only. **This file adds no fifth**: it generalises
--     `bp_audit_projects_row` into ONE function and points nine tables at it.
--     Consolidating the three bespoke ones is a separate ticket with its own
--     risk; deliberately not attempted here.
--
-- ---------------------------------------------------------------------------
-- EXPECTED ROW GROWTH — the number to read before applying
-- ---------------------------------------------------------------------------
--
--   audit_log today            22,381 rows / 19 MB   (brief: 19,097 / 14 MB)
--   written in the last 7d      3,030               of which 1,297 had no actor
--   permits touched in 7d         333               (brief said 252)
--   permit_cycles touched in 7d   308               ★ brief said 71 — 4x more
--
-- So the eight tables add roughly **640 rows a week** on top of 3,030 — about
-- **21%**, not the 12% the brief estimated, because `permit_cycles` churn has
-- quadrupled since 09-20. At 19 MB this is still not a volume problem.
-- ⛔ NO RETENTION OR PRUNING JOB. Revisit at a gigabyte.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT TOUCH
-- ---------------------------------------------------------------------------
--   · No RLS policy is created, altered or dropped. `audit_log`'s SELECT policy
--     stays `tenant_id = ANY (auth_tenant_ids())` — verified 2026-09-29 to be
--     the SAME predicate every one of the nine audited tables uses for its own
--     SELECT, so recording their history cannot show anybody a row they could
--     not already read.
--   · `permit_task_audit`, `draw_schedule_audit`, `bp_audit_permit_task`,
--     `bp_audit_draw_schedule`, `bp_audit_task_assignee` — untouched.
--   · `error_reports`, `audit_log` itself, `client_build_seen` and the
--     `_*_backup_*` tables are NOT audited. Recording the recorder is noise.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. audit_log gains ONE nullable column: the row's primary key, structured.
-- ---------------------------------------------------------------------------
--
-- ★★★ WHY NOT OVERLOAD `row_id`. `row_id` is text and holds `NEW.id::text`
--     today. Two of the eight tables do not have an `id`: `app_config` is keyed
--     by `key` and `permit_type_defaults` by `(tenant_id, type)`. A composite
--     key flattened into that text column would have to be PARSED back out by
--     the restore path, and a parser over somebody's data is where the next bug
--     lives — a jurisdiction called `a&b` would break a `&`-joined key.
--
-- ★★ `row_id` IS STILL WRITTEN, and for a single-column key it is byte-identical
--    to what fix-520's trigger wrote, so the 22,381 existing rows and any reader
--    of `row_id` keep working. `row_key` is the machine-readable twin.
--
-- ★ NULLABLE, so no backfill and no rewrite of the existing rows. A history
--   entry written before this file has no `row_key`; the restore path refuses
--   those rather than guessing, and says why.
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS row_key jsonb;

COMMENT ON COLUMN public.audit_log.row_key IS
  'fix-590: the audited row''s PRIMARY KEY as {column: value}, so a restore can '
  'find the row again without parsing row_id. Null on rows written before '
  'fix-590 and on the three bespoke audit paths.';

-- ★ The index the history panel reads by. `(table_name, row_id, id DESC)`:
--   every history query is "this row, newest first". `id DESC` and not
--   `created_at DESC` because fix-338 established that several rows routinely
--   share a created_at to the microsecond and only `id` breaks the tie.
CREATE INDEX IF NOT EXISTS audit_log_table_row_idx
  ON public.audit_log (table_name, row_id, id DESC);

-- ---------------------------------------------------------------------------
-- 2. The primary-key columns of a table, derived from the catalogue.
-- ---------------------------------------------------------------------------
--
-- ★★★ DERIVED, NOT DECLARED, which is the brief's ★: *"so attaching the trigger
--     to a ninth table later needs no thought."* A trigger argument listing the
--     key columns would be a second place to keep the schema, and it would be
--     wrong the first time somebody changed a primary key.
--
-- ★ STABLE so the planner may cache it within a statement — a bulk scraper write
--   of 300 permits does one catalogue lookup, not 300.
CREATE OR REPLACE FUNCTION public.bp_audit_pk_cols(p_rel regclass)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(a.attname ORDER BY k.ord), ARRAY[]::text[])
    FROM pg_index i
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indrelid = p_rel
     AND i.indisprimary;
$function$;

-- ---------------------------------------------------------------------------
-- 3. ★★★ THE ONE MECHANISM — `bp_audit_projects_row` generalised.
-- ---------------------------------------------------------------------------
--
-- fix-520's shape, kept exactly: diff `to_jsonb(OLD)` against `to_jsonb(NEW)`,
-- skip `updated_at`, write `{col: {before, after}}` into `audit_log.changes`,
-- insert nothing when nothing changed.
--
-- ★★★ WHAT IS NEW, and only this:
--       · the row identity comes from the REAL primary key (§1)
--       · INSERT and DELETE are recorded, carrying the WHOLE row
--       · the action noun is a trigger argument, so `projects` keeps the exact
--         `project_updated` string its 22,381 rows already use
--
-- ★★★ INSERT AND DELETE USE THE SAME `{before, after}` SHAPE as an UPDATE —
--     an INSERT is `{before: null, after: value}` and a DELETE is
--     `{before: value, after: null}`. That is not tidiness: it makes **restore
--     uniform**. "Put the prior version back" is always "set every column to its
--     `before`", so a DELETE's audit row already contains everything needed to
--     re-create the row, and the restore path needs no per-op branch.
--
-- ★★★ IT CANNOT FAIL A PERSON'S SAVE. AFTER trigger (so the write has already
--     happened) **and** the whole body is wrapped in an exception handler that
--     swallows anything and returns. §4: *"say in the PR what happens if the
--     insert fails."* The answer is: the person's edit still lands, and the
--     history entry is lost silently. That is the right trade — an audit that
--     can refuse a save is worse than one with a gap — and it is why the
--     handler is here rather than left to AFTER-ness alone, which does NOT
--     protect you: an exception in an AFTER trigger still aborts the statement.
CREATE OR REPLACE FUNCTION public.bp_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_noun     text := COALESCE(NULLIF(TG_ARGV[0], ''), TG_TABLE_NAME);
  v_old      jsonb;
  v_new      jsonb;
  v_changes  jsonb := '{}'::jsonb;
  v_key      text;
  v_pk_cols  text[];
  v_row_key  jsonb := '{}'::jsonb;
  v_row_id   text;
  v_tenant   uuid;
  v_action   text;
  v_subject  jsonb;
BEGIN
  BEGIN
    v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    -- The surviving side of the row: what identifies it and which tenant owns it.
    v_subject := COALESCE(v_new, v_old);

    -- ---- the row's identity, from its real primary key --------------------
    v_pk_cols := public.bp_audit_pk_cols(TG_RELID);
    IF array_length(v_pk_cols, 1) IS NULL THEN
      -- No primary key. Nothing could find the row again, so record nothing
      -- rather than record something unusable.
      RETURN NULL;
    END IF;
    FOREACH v_key IN ARRAY v_pk_cols LOOP
      v_row_key := v_row_key || jsonb_build_object(v_key, v_subject -> v_key);
    END LOOP;
    -- ★ SINGLE-COLUMN KEY → the bare value, byte-identical to fix-520's
    --   `NEW.id::text`. COMPOSITE → the jsonb text, which is stable because
    --   `v_pk_cols` is ordered by the index's own column order.
    v_row_id := CASE
      WHEN array_length(v_pk_cols, 1) = 1
        THEN v_subject #>> ARRAY[v_pk_cols[1]]
      ELSE v_row_key::text
    END;

    v_tenant := NULLIF(v_subject ->> 'tenant_id', '')::uuid;
    IF v_tenant IS NULL THEN
      -- `audit_log.tenant_id` is NOT NULL. A row with no tenant cannot be
      -- recorded; that is a schema fact, not a failure to hide.
      RETURN NULL;
    END IF;

    -- ---- the change itself ------------------------------------------------
    IF TG_OP = 'UPDATE' THEN
      v_action := v_noun || '_updated';
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        IF v_key = 'updated_at' THEN
          CONTINUE;
        END IF;
        IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
          v_changes := v_changes || jsonb_build_object(
            v_key,
            jsonb_build_object('before', v_old -> v_key, 'after', v_new -> v_key)
          );
        END IF;
      END LOOP;
      -- fix-520's rule, kept: a no-op UPDATE records nothing.
      IF v_changes = '{}'::jsonb THEN
        RETURN NULL;
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      v_action := v_noun || '_inserted';
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        IF v_key = 'updated_at' THEN CONTINUE; END IF;
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('before', NULL, 'after', v_new -> v_key));
      END LOOP;
    ELSE
      v_action := v_noun || '_deleted';
      FOR v_key IN SELECT jsonb_object_keys(v_old) LOOP
        IF v_key = 'updated_at' THEN CONTINUE; END IF;
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('before', v_old -> v_key, 'after', NULL));
      END LOOP;
    END IF;

    -- ★★★ `auth.uid()` IS NULL FOR THE SCRAPER, and that is the signal §3 asks
    --     for rather than a column to add. 1,297 of the last 3,030 audit rows
    --     already have no actor. ⛔ Scraper writes are NOT filtered out — "what
    --     did the scraper change on this permit overnight" is the question.
    INSERT INTO public.audit_log
      (tenant_id, user_id, action, table_name, row_id, row_key, changes)
    VALUES
      (v_tenant, auth.uid(), v_action, TG_TABLE_NAME, v_row_id, v_row_key, v_changes);
  EXCEPTION WHEN OTHERS THEN
    -- ★★★ THE AUDIT NEVER FAILS THE WRITE. See the header block: an exception
    --     in an AFTER trigger DOES abort the statement, so AFTER-ness alone is
    --     not enough. The person's edit stands; the history entry is lost.
    RETURN NULL;
  END;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. ★★★ THE TWO WORDS THAT ARE THE WHOLE LESSON.
-- ---------------------------------------------------------------------------
--
-- fix-520's trigger fires on **UPDATE only**, so a deleted project leaves no
-- trace and neither does a created one — **and absence is exactly the shape that
-- hurt Bobby.** The one table that HAD an audit could not have answered the
-- question this ticket exists to answer.
--
-- ★ `bp_audit_projects_row` is left in place but no longer attached, so this is
--   reversible by re-pointing the trigger. It is NOT dropped: dropping it would
--   make rolling back this file a rewrite.
DROP TRIGGER IF EXISTS projects_audit_row ON public.projects;
CREATE TRIGGER projects_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row('project');

-- ---------------------------------------------------------------------------
-- 5. The eight hand-arranged tables.
-- ---------------------------------------------------------------------------
--
-- ★★★ `permits` AND `permit_cycles` ARE THE SURPRISE AND THEY OUTRANK THE CONFIG
--     TABLES. Between them they hold every submitted / corrections / resubmitted
--     date the team manages to, and a wrong one is invisible until somebody
--     misses a deadline.
--
-- ★ The noun is left to default to the table name, so these read
--   `permits_updated`, `app_config_deleted` and so on. **Deliberately not
--   prefixed `scrape_`**: `bp_scraper_activity_feed_action` is an ALLOWLIST
--   (`action LIKE 'scrape\_%' OR action = 'manual_admin_correction'`) applied
--   BEFORE fix-370's row budget, so these rows cannot crowd the activity feed
--   or the notification bell. Verified against the live function 2026-09-29.

DROP TRIGGER IF EXISTS permits_audit_row ON public.permits;
CREATE TRIGGER permits_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.permits
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS permit_cycles_audit_row ON public.permit_cycles;
CREATE TRIGGER permit_cycles_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.permit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS draw_schedule_quarter_layout_audit_row ON public.draw_schedule_quarter_layout;
CREATE TRIGGER draw_schedule_quarter_layout_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.draw_schedule_quarter_layout
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS task_templates_audit_row ON public.task_templates;
CREATE TRIGGER task_templates_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS team_members_audit_row ON public.team_members;
CREATE TRIGGER team_members_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS app_config_audit_row ON public.app_config;
CREATE TRIGGER app_config_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS permit_type_defaults_audit_row ON public.permit_type_defaults;
CREATE TRIGGER permit_type_defaults_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.permit_type_defaults
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

DROP TRIGGER IF EXISTS da_team_routing_audit_row ON public.da_team_routing;
CREATE TRIGGER da_team_routing_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON public.da_team_routing
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_row();

-- ---------------------------------------------------------------------------
-- 6. ★★★ RESTORE, WHICH IS THE DELIVERABLE.
-- ---------------------------------------------------------------------------
--
-- §2: *"A history nobody can act on is a longer version of the problem. Bobby's
-- ask was a way to quickly RESTORE, not a way to find out."*
--
-- ★★★ SECURITY **INVOKER**, AND THAT IS THE DESIGN. The write happens as the
--     CALLER, so the target table's own RLS decides whether it is allowed —
--     `team_members`, `task_templates` and `app_config` are `is_tenant_admin`,
--     `draw_schedule_quarter_layout` is admin OR `profiles.may_edit_draw_schedule`.
--     Re-deriving those rules inside a SECURITY DEFINER function would be a
--     second writer of one rule, which is the defect this Brain has removed six
--     times. **The permission check is the policy that already exists.**
--
-- ★★★ AND RESTORING IS ITSELF AN AUDITED WRITE — for free, because the UPDATE or
--     INSERT below fires the trigger from §3 like any other change. It is not a
--     rewind; it is a new change that happens to reinstate old values. Otherwise
--     the restore would be the one write with no history, which is the joke
--     writing itself.
--
-- ★ THE ALLOWED TABLES ARE LISTED. This function builds dynamic SQL from a
--   table name held in a row, so the name is checked against a fixed set before
--   it reaches `format()`. Without that, a row in `audit_log` naming any table
--   in the schema would be a write primitive.
CREATE OR REPLACE FUNCTION public.bp_restorable_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY[
    'draw_schedule_quarter_layout',
    'team_members',
    'permit_type_defaults',
    'app_config',
    'task_templates',
    'da_team_routing'
  ]::text[];
$function$;

-- ★★★ THE LINE THIS TICKET DREW, STATED IN THE CODE. `permits` and
--     `permit_cycles` get the RECORDING now and are deliberately NOT restorable
--     from the screen yet — §2 permits exactly that (*"their restore UI can
--     follow"*). The reason is not effort: a permit's dates are also written by
--     the scraper every night, so "put the old value back" on a permit needs a
--     ruling about what happens on the next scrape, and that ruling is Bobby's.
--     `projects` is likewise recording-only here; it has its own editors.

-- ★★★ THE VALUES GO BACK THROUGH `jsonb_populate_record`, AND THAT IS NOT A
--     STYLE CHOICE — IT IS THE ONLY THING THAT TYPES THEM.
--
--     The obvious spelling, `SET %I = ($1 -> %L -> %L)`, assigns a **jsonb** to a
--     `uuid` / `integer` / `date` column and Postgres refuses it: there is no
--     implicit cast. I wrote that first and a rolled-back prod probe rejected it.
--     `jsonb_populate_record(NULL::public.<table>, <before-values>)` hands back a
--     properly typed row of that table's own composite type — verified on prod
--     2026-09-29 to produce `uuid`, `integer`, `text` and `NULL` correctly from
--     the jsonb the trigger writes — so the UPDATE assigns column to column and
--     every cast is Postgres's own.
--
-- ★ `updated_at` is excluded from the before-values, so the row's OCC stamp moves
--   forward on a restore like any other write rather than being reinstated. A
--   restore is a NEW change; pretending its timestamp is old would be the one
--   place this feature lied.
CREATE OR REPLACE FUNCTION public.bp_restore_audited_row(p_audit_id bigint)
RETURNS TABLE(out_table text, out_row_id text, out_columns text[], out_created boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec        record;
  v_pk_cols    text[];
  v_where      text := '';
  v_cols       text[] := ARRAY[]::text[];
  v_col_list   text := '';
  v_before     jsonb;
  /** ★ fix-590: the key PLUS the before-values — what a re-create needs. */
  v_full       jsonb;
  v_key        text;
  v_rows       integer;
  v_exists     boolean;
  v_created    boolean := false;
BEGIN
  -- ★ The SELECT is RLS-scoped, so an audit row for another tenant simply is not
  --   found — the same answer as one that does not exist, which is correct.
  SELECT * INTO v_rec FROM public.audit_log WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That history entry could not be found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_rec.table_name = ANY (public.bp_restorable_tables())) THEN
    RAISE EXCEPTION 'History for % cannot be restored from here yet.', v_rec.table_name
      USING ERRCODE = '0A000';
  END IF;

  -- ★★★ AN INSERT HAS NO PRIOR VERSION. Its `before` is null on every column, so
  --     "restore" would mean deleting the row — a different action with a
  --     different meaning, and not one anybody asked for. Refused in words.
  IF v_rec.action LIKE '%\_inserted' THEN
    RAISE EXCEPTION 'That entry is the row being created — there is no earlier version to restore.'
      USING ERRCODE = '22023';
  END IF;

  IF v_rec.row_key IS NULL OR v_rec.row_key = '{}'::jsonb THEN
    -- ★ Rows written before fix-590 carry no structured key. Refused rather than
    --   parsed out of `row_id`, because a parser over somebody's data is where
    --   the next bug lives.
    RAISE EXCEPTION 'That entry predates history tracking and cannot be restored automatically.'
      USING ERRCODE = '22023';
  END IF;

  v_pk_cols := ARRAY(SELECT jsonb_object_keys(v_rec.row_key) ORDER BY 1);

  -- ---- the `before` side of the entry, as a flat jsonb of column → value ----
  SELECT jsonb_object_agg(k, v -> 'before')
    INTO v_before
    FROM jsonb_each(v_rec.changes) AS e(k, v)
   WHERE k <> 'updated_at';

  -- ---- which columns to write back -----------------------------------------
  FOR v_key IN SELECT jsonb_object_keys(v_before) ORDER BY 1 LOOP
    -- ★ Never write the key columns back on an UPDATE: they are what identifies
    --   the row, and an audit entry cannot move a row to a different key.
    IF v_key = ANY (v_pk_cols) THEN
      CONTINUE;
    END IF;
    v_cols := v_cols || v_key;
  END LOOP;

  IF array_length(v_cols, 1) IS NULL THEN
    RAISE EXCEPTION 'That entry records no column values to put back.'
      USING ERRCODE = '22023';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- ★★★ THE IDENTITY COMES FROM `row_key`, **NOT** FROM `changes`, AND A
  --     ROLLED-BACK PROD PROBE IS THE ONLY REASON I KNOW THAT
  -- ═══════════════════════════════════════════════════════════════════════
  --
  -- I first built the `WHERE` out of the before-values, which works for a DELETE
  -- entry (it carries every column) and **silently fails for an UPDATE entry**,
  -- which carries only the columns that moved. On `permit_type_defaults` the
  -- entry held `{intake_to_approval_days}` and nothing else, so the key columns
  -- came back NULL, the row "did not exist", and the function took the re-create
  -- branch and tried to INSERT a row with one column in it:
  --
  --   ERROR: null value in column "tenant_id" violates not-null constraint
  --   INSERT INTO permit_type_defaults (intake_to_approval_days) SELECT …
  --
  -- ★★★ `row_key` IS WRITTEN ON EVERY ENTRY AND ALWAYS HOLDS THE WHOLE KEY.
  --     That is what it is for — and it is why the restore path needed a
  --     structured key rather than a parsed `row_id`.
  FOREACH v_key IN ARRAY v_pk_cols LOOP
    v_where := v_where || CASE WHEN v_where = '' THEN '' ELSE ' AND ' END ||
               format('%I = (SELECT r.%I FROM jsonb_populate_record(NULL::public.%I, $2) r)',
                      v_key, v_key, v_rec.table_name);
  END LOOP;

  -- ★ The whole row to re-create, if it comes to that: the key, plus whatever
  --   values the entry carries. For a DELETE entry the two overlap completely;
  --   for an UPDATE entry the key is the only thing `changes` was missing.
  v_full := v_rec.row_key || v_before;

  -- Does the row still exist, for THIS caller? Distinguishes "gone" from
  -- "not allowed" so the message can say which.
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %s)', v_rec.table_name, v_where
  ) INTO v_exists USING v_before, v_rec.row_key;

  IF v_exists THEN
    -- ★ Multi-column assignment from the typed record: `SET (a, b) = (SELECT
    --   r.a, r.b FROM …)`. One statement, every cast Postgres's own.
    SELECT string_agg(format('r.%I', c), ', ' ORDER BY ord)
      INTO v_col_list
      FROM unnest(v_cols) WITH ORDINALITY AS u(c, ord);
    EXECUTE format(
      'UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) r) WHERE %s',
      v_rec.table_name,
      (SELECT string_agg(quote_ident(c), ', ' ORDER BY ord)
         FROM unnest(v_cols) WITH ORDINALITY AS u(c, ord)),
      v_col_list,
      v_rec.table_name,
      v_where
    ) USING v_before, v_rec.row_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      -- The row is visible but the write matched nothing: RLS refused it.
      RAISE EXCEPTION 'You do not have permission to change this record.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- ★★★ THE DELETED CASE — the one Bobby actually hit. The entry carries the
    --     whole row, so the row is re-created rather than reported missing.
    v_created := true;
    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) r',
        v_rec.table_name,
        (SELECT string_agg(quote_ident(k), ', ' ORDER BY k)
           FROM jsonb_object_keys(v_full) AS k),
        (SELECT string_agg(format('r.%I', k), ', ' ORDER BY k)
           FROM jsonb_object_keys(v_full) AS k),
        v_rec.table_name
      ) USING v_full;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'You do not have permission to restore this record.'
          USING ERRCODE = '42501';
      WHEN unique_violation THEN
        RAISE EXCEPTION 'A record with that key already exists — restore the existing one instead.'
          USING ERRCODE = '23505';
    END;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'You do not have permission to restore this record.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  out_table := v_rec.table_name;
  out_row_id := v_rec.row_id;
  out_columns := v_cols;
  out_created := v_created;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. ★★★ THE ORIGIN CASE — A WHOLE QUARTER BACK IN ONE ACTION.
-- ---------------------------------------------------------------------------
--
-- §2: *"a whole quarter restored in one action, including one that was deleted
-- or never existed."*
--
-- ★★★ "NEVER EXISTED" CANNOT BE RESTORED, AND SAYING SO IS THE OTHER HALF OF THE
--     FIX. §0's injury was *"I could not tell him whether it had been deleted or
--     never saved"* — those were the same observation. After this file they are
--     different observations, and if the answer is "never saved" then there is
--     nothing to put back and the screen says exactly that. A restore that
--     invented a layout would be worse than the gap.
--
-- ★★ SO THIS RESTORES WHAT WAS DELETED: every row of the quarter whose NEWEST
--    history entry is a delete, re-created in one call. That is Bobby's case —
--    twelve columns that vanished — and it composes with per-row restore for the
--    case where a row was edited rather than removed.
--
-- ★ One `_deleted` entry per row_key, newest first, and only where no later
--   entry exists for that key (a row deleted and then re-created is not
--   missing).
CREATE OR REPLACE FUNCTION public.bp_restore_deleted_quarter_layout(p_quarter text)
RETURNS TABLE(out_restored integer, out_audit_ids bigint[])
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id      bigint;
  v_ids     bigint[] := ARRAY[]::bigint[];
  v_n       integer := 0;
BEGIN
  IF COALESCE(btrim(p_quarter), '') = '' THEN
    RAISE EXCEPTION 'A quarter is required.' USING ERRCODE = '22023';
  END IF;

  FOR v_id IN
    WITH latest AS (
      SELECT DISTINCT ON (al.row_key)
             al.id, al.action
        FROM public.audit_log al
       WHERE al.table_name = 'draw_schedule_quarter_layout'
         AND al.row_key IS NOT NULL
         AND al.changes -> 'quarter' -> 'before' = to_jsonb(p_quarter)
       ORDER BY al.row_key, al.id DESC
    )
    SELECT l.id FROM latest l
     WHERE l.action LIKE '%\_deleted'
     ORDER BY l.id
  LOOP
    -- ★ Reuses §6 rather than repeating its permission and insert logic. Each
    --   restored row is audited on its own, so the log reads as what happened:
    --   twelve re-creations, not one opaque "restored".
    PERFORM public.bp_restore_audited_row(v_id);
    v_ids := v_ids || v_id;
    v_n := v_n + 1;
  END LOOP;

  out_restored := v_n;
  out_audit_ids := v_ids;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Grants. ⛔ NO RLS POLICY IS CREATED, ALTERED OR DROPPED BY THIS FILE.
-- ---------------------------------------------------------------------------
--
-- ★ `authenticated` only, per fix-157's posture — `anon` gets nothing. Both
--   functions are SECURITY INVOKER, so EXECUTE is permission to ASK, and the
--   table's own policy still decides.
REVOKE ALL ON FUNCTION public.bp_restore_audited_row(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bp_restore_deleted_quarter_layout(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_restore_audited_row(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_restore_deleted_quarter_layout(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_restorable_tables() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_audit_pk_cols(regclass) TO authenticated;

COMMIT;

-- ===========================================================================
-- VERIFY, after applying
-- ===========================================================================
--
--   -- nine tables, each firing on all three events
--   SELECT c.relname,
--          (CASE WHEN (t.tgtype & 4)>0 THEN 'I' ELSE '' END) ||
--          (CASE WHEN (t.tgtype & 8)>0 THEN 'D' ELSE '' END) ||
--          (CASE WHEN (t.tgtype & 16)>0 THEN 'U' ELSE '' END) AS events
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE NOT t.tgisinternal AND t.tgfoid = 'public.bp_audit_row'::regproc
--    ORDER BY 1;
--   -- expect 9 rows, every one 'IDU'
--
--   -- the composite key round-trips
--   SELECT row_id, row_key FROM public.audit_log
--    WHERE table_name = 'permit_type_defaults' ORDER BY id DESC LIMIT 1;
--   -- expect row_key to hold BOTH tenant_id and type
-- ===========================================================================
