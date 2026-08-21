-- ===========================================================================
-- ★★★ fix-376 — the snapshot views bypass their own tables' RLS
-- ===========================================================================
--
-- This ticket is about to put fix-373's three snapshot views on a screen, so
-- their read path was checked first. It should not have passed.
--
-- MEASURED ON PROD 2026-08-21, before anything was built:
--
--   view                             security_invoker   anon SELECT
--   correction_missing_worklist      true               revoked      ★ the house pattern
--   indexer_run_current              (unset)            GRANTED
--   indexer_reconciliation_current   (unset)            GRANTED
--   indexer_missing_letter_current   (unset)            GRANTED
--
-- ★★★ A view without `security_invoker` executes as its OWNER. The RLS on
-- `indexer_run`, `indexer_project_reconciliation` and `indexer_missing_letter`
-- — two policies each, present precisely to scope those tables by `tenant_id` —
-- therefore does not apply to anything read through the views.
--
-- ★★ Today that is harmless: one tenant, and all three tables hold zero rows.
-- It stops being harmless the moment a second tenant exists or the tables fill.
-- And building a screen on top of it would be INTRODUCING the hole into the
-- product rather than finding it, which is the only reason this DDL is in a
-- read-and-display ticket at all.
--
-- ★ fix-279's `correction_missing_worklist` is the pattern this repo already
-- follows, and fix-374's hook says why in as many words: "created WITH
-- (security_invoker = true) so the caller's own RLS decides which rows come
-- back". These three now match it.
--
-- ★★★ NO ROW IS WRITTEN OR EDITED. This is DDL on three views and nothing else.

ALTER VIEW public.indexer_run_current            SET (security_invoker = true);
ALTER VIEW public.indexer_reconciliation_current SET (security_invoker = true);
ALTER VIEW public.indexer_missing_letter_current SET (security_invoker = true);

-- ★ fix-157's posture, fix-273's audit: anon reads nothing. The base tables'
-- policies are TO authenticated, so an anon read through an invoker view would
-- return nothing anyway — revoking SAYS so rather than relying on it.
REVOKE ALL ON public.indexer_run_current            FROM anon;
REVOKE ALL ON public.indexer_reconciliation_current FROM anon;
REVOKE ALL ON public.indexer_missing_letter_current FROM anon;

GRANT SELECT ON public.indexer_run_current            TO authenticated;
GRANT SELECT ON public.indexer_reconciliation_current TO authenticated;
GRANT SELECT ON public.indexer_missing_letter_current TO authenticated;

-- ★★★ AND THE TRAP THAT SHAPED THE WHOLE OF §1, WRITTEN DOWN WHERE THE NEXT
-- READER WILL HIT IT. `indexer_run_current` filters `WHERE reconciliation_written`
-- — so a run that was KILLED before it wrote one never appears in it at all.
-- Reading only this view would make "the process never returned" look
-- identical to "no run has ever happened", which is the exact distinction
-- fix-373 built the `ok IS NULL` state to preserve.
COMMENT ON VIEW public.indexer_run_current IS
  'fix-373: the most recent run that WROTE a reconciliation (reconciliation_written). '
  'fix-376 made it security_invoker so the caller''s RLS scopes it. NOTE: a run that '
  'was killed before writing never appears here — read indexer_run itself for the '
  'last ATTEMPT, which is how "never returned" is told apart from "failed".';
