-- ===========================================================================
-- fix-648 — MENTION AND TASK-ASSIGNMENT EMAILS ARE OPT-IN   (P-339)
-- ===========================================================================
--
-- Bobby, 2026-10-11: "only a select few people want an email notification, so
-- we can turn that off for everyone". 2026-10-15: "email settings should be off
-- by standard, and those who want it on, or who have manually turned it on, can
-- keep it on … the weekly updates and resubmit emails should keep coming, i am
-- more talking about mentions and task assignments."
--
-- ★★★ THE GAP. fix-634 made `bp_notify_enabled` opt-OUT (NOT EXISTS a row with
--     enabled = false), so a login with no row got every email. Cowork wrote
--     enabled = false rows for all 44 logins by hand; the next Add Person would
--     have been opted back in. Now `mention` and `assignment` are on ONLY when a
--     row says enabled = true. `weekly` and `resubmit` are unchanged (opt-out).
--
-- ★★ NO DATA CHANGE. Existing rows keep their meaning: the 4 people who ticked
--    a box (enabled = true) stay on; the enabled = false rows stay off.
--
-- §0 — every caller (pg_proc, read 2026-10-15), and the category it passes:
--   bp_notify_enqueue          v_category = 'mention' for notify:mention, else
--                              'assignment' (called by bp_trg_notify_mentions
--                              and bp_notify_assignment)
--   bp_trg_notify_mentions     'mention' — the fix-643 corrections-notice branch
--                              (inserts directly) — so notices follow mentions
--   bp_notify_claim            'weekly' / 'resubmit' / 'mention' / 'assignment'
--                              by queue kind (re-checked at send time)
--   bp_weekly_update_enqueue   'weekly'
--   bp_resubmit_warning_enqueue 'resubmit'
--   No client code and no Edge Function calls it; admin-create-user writes no
--   preference rows and needs none now.
--
-- ★ CREATE OR REPLACE with the SAME signature keeps the existing grants
--   (EXECUTE revoked from public, anon, authenticated in fix-634).

CREATE OR REPLACE FUNCTION public.bp_notify_enabled(p_user uuid, p_category text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- ★★★ fix-648: OPT-IN — on only when the person turned it on.
    WHEN p_category IN ('mention', 'assignment') THEN EXISTS (
      SELECT 1 FROM public.notification_preferences
       WHERE user_id = p_user AND category = p_category AND enabled = true
    )
    -- Weekly Update and Resubmit-by: OPT-OUT, as before.
    ELSE NOT EXISTS (
      SELECT 1 FROM public.notification_preferences
       WHERE user_id = p_user AND category = p_category AND enabled = false
    )
  END;
$function$;

COMMENT ON FUNCTION public.bp_notify_enabled(uuid, text) IS
  'fix-648: mention + assignment are OPT-IN (a row with enabled = true); weekly + resubmit are OPT-OUT (off only with enabled = false). Twin: src/lib/notificationPreferences.ts emailEnabled.';
