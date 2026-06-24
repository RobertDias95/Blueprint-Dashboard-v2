-- fix-198: dedupe intake_records — remove the one-time re-seed duplicates.
--
-- intake_records is Seattle's intake-slot inventory (real + placeholder slots),
-- managed manually via the Intake Tracker UI (Draw Schedule → Seattle Intakes).
-- It is NOT scraped/cron-fed — the only writers are the Tracker hooks
-- (bp_upsert_intake_records_row / bp_delete_intake_records_row /
-- bp_swap_intake_dates) plus the original bulk seed.
--
-- The seed was run twice: 47 rows created 2026-05-07, then a partial RE-SEED of
-- 21 of those rows on 2026-05-12 — each an EXACT duplicate (same tenant_id,
-- permit_id, intake_date, address, permit_num, permit_type, is_placeholder). So
-- 21 permits (e.g. 4222 Latona Ave NE) appear twice in the tracker. Probed in
-- prod: exactly 21 duplicate pairs, all with the 5/12 copy as the higher id.
--
-- This deletes the duplicate copies, keeping the LOWEST id per group (the
-- original 5/07 row). It is:
--   * SCOPED to REAL-permit rows (permit_id IS NOT NULL) — placeholder slots
--     (permit_id NULL, address 'OPEN') are intentional inventory and are NEVER
--     touched, even if two happen to match.
--   * IDEMPOTENT — re-running is a no-op once the duplicates are gone.
--   * SAFE — nothing references intake_records.id (FKs point OUT to projects /
--     permits / tenants); deleting a duplicate row affects no other table.
--
-- This is data cleanup ONLY. It does NOT address the structural sync gap
-- (editing permits.intake_date on the Project Overview does not reach
-- intake_records, so the tracker is missing ~130 permits' current intake dates).
-- That bidirectional-model fix is a separate change pending sign-off.

DELETE FROM public.intake_records a
USING public.intake_records b
WHERE a.id > b.id
  AND a.permit_id IS NOT NULL
  AND a.tenant_id      =  b.tenant_id
  AND a.permit_id      IS NOT DISTINCT FROM b.permit_id
  AND a.intake_date    IS NOT DISTINCT FROM b.intake_date
  AND a.address        IS NOT DISTINCT FROM b.address
  AND a.permit_num     IS NOT DISTINCT FROM b.permit_num
  AND a.permit_type    IS NOT DISTINCT FROM b.permit_type
  AND a.is_placeholder IS NOT DISTINCT FROM b.is_placeholder;
