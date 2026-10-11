-- ===========================================================================
-- fix-644 (P-318) — Settings cleanup sweep: retire the two v1 config writers,
-- delete the unused app_config keys (Bobby, 2026-10-11: "Delete, with a
-- backup").
-- ===========================================================================
--
-- ★★★ BACKUP FIRST. Every row this deletes is in
--   supabase/backups/app_config_unused_keys_2026-10.json
-- (and the Brain's reference/app_config-backup-2026-10-fix644.json, the same
-- bytes). Verified equal to prod, row for row, before this ran. Restore is one
-- statement — see the header of that file's PR (fix-644) or:
--
--   INSERT INTO public.app_config (key, value, updated_at, tenant_id)
--   SELECT r->>'key', r->'value', (r->>'updated_at')::timestamptz,
--          (r->>'tenant_id')::uuid
--     FROM jsonb_array_elements('<contents of the backup file>'::jsonb) r
--   ON CONFLICT (key) DO NOTHING;
--
-- ★★★ 17 KEYS WERE APPROVED; 16 ARE DELETED. `design_guidance_task_enabled_at`
-- has a LIVE reader the census could not see from this repo: the scraper's
-- file_indexer (run.py → design_guidance_task.ENABLED_AT_KEY) reads it every
-- run as the cutoff for which projects get a "design guidance missing" task
-- (51 such tasks, newest 2026-10-06). Deleting it would make the next run
-- re-stamp NOW and silently move the cutoff. The brief's STOP rule: a key with
-- a live reader is not deleted.
--
-- ★★ THE TWO WRITERS ARE DROPPED, NOT TRIMMED — they have no caller:
--   · bp_replace_app_config_and_roster(bigint, jsonb) — v1's bulk config save.
--     Its only caller is the v1 single-file index.html in the scraper repo,
--     which is served by nothing. `bp_versions.app_config_bundle` is still 0,
--     and every successful call bumps it: it has never once completed. It was
--     also the most dangerous function in the schema to leave callable by
--     `authenticated` — it marks the whole current roster inactive, then
--     deletes every jurisdiction and custom permit type not in its payload.
--   · bp_finalize_app_config_extras() — a one-off v1→v2 import step (copies
--     nextId/permitOrder out of legacy_project_data). No caller anywhere.
--   Neither is called by another function, a cron job, an edge function, the
--   app, or the scraper. Their definitions stay in migration history
--   (fix_379_dm_derived.sql for the first).
--
-- ★ bp_get_weekly_da_report is UNCHANGED. Its 'das' is the name of its OUTPUT
-- field (one entry per DA key derived from permits.da); it never reads
-- app_config. Output proven identical before/after the delete in a rolled-back
-- probe.
--
-- Side effect, stated: the DELETE fires app_config_audit_row, which appends one
-- audit_log row per deleted key (16, each carrying the full old value).
-- bp_log_user_activity records nothing (no auth.uid() in a migration). No
-- existing row in any table is changed.

DROP FUNCTION IF EXISTS public.bp_replace_app_config_and_roster(bigint, jsonb);
DROP FUNCTION IF EXISTS public.bp_finalize_app_config_extras();

DO $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.app_config
   WHERE key IN (
     'permitTypes', 'jurisdictions', 'dmDaGroups', 'das', 'dms', 'entLeads',
     'acqLeads', 'formerDas', 'consultantTypes', 'dmOrder', 'quarterTeams',
     'wizQuestions', 'permitOrder', 'nextId', '_ulsMigrated', 'learnThresholds'
   );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- ★ Exactly the 16 measured on 2026-10-11. Anything else means prod moved
  --   under us: abort the whole migration rather than delete a surprise.
  IF v_n <> 16 THEN
    RAISE EXCEPTION 'fix-644: expected to delete 16 app_config rows, would delete %', v_n;
  END IF;
END
$$;
