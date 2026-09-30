-- ===========================================================================
-- fix-560 (P-264) — a skipped rung stops writing a zero-day turnaround
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED.** Claude applies this from Cowork. CI is green with it
--       unapplied, because nothing in the app reads a consultant duration yet.
--
-- ⚠️ THE BRIEF SAYS "no migration". IT IS WRONG, and harmlessly so: §A's one
--    change is inside `bp_set_consultant_status`, which is a database function.
--    There is no client-side stamping to change — the RPC owns every date.
--
-- ---------------------------------------------------------------------------
-- §0 — WHAT IS TRUE, RE-MEASURED 2026-09-29 (the brief is 15 days old)
-- ---------------------------------------------------------------------------
--
--   claim (2026-09-14)                        measured (2026-09-29)
--   ───────────────────────────────────────── ────────────────────────────────
--   "recd = sent on ALL 22 completed rounds,  **38 completed: 28 zero-day AND
--    min/median/max 0 days"                     10 with a REAL interval**
--   155 of 184 consultants have no dates      137 of 198
--   9 rounds Pending with sent, no recd       **15**
--   11 Received with NO sent (the backfill)   **11** ✓
--
-- ★★★ THE BRIEF'S HEADLINE — *"min/median/max 0 days"* — NO LONGER HOLDS, AND
--     THAT IS THE BEST NEWS IN THIS FILE. Ten rounds now carry a genuine
--     interval: **min 5, median 14, max 37 days**, the earliest sent 2026-06-05
--     and the latest 2026-09-23. **The ladder produces real numbers when it is
--     walked** — which is what §0 argued from reading the function, now shown
--     from the data rather than inferred.
--
-- ★★★ AND THE DEFECT IS STILL WRITING. **6 of the 28 zeroes were stamped ON OR
--     AFTER 2026-09-15**, the day Bobby ruled. 22 zeroes became 28 in fifteen
--     days. This is not a historical mess to be tidied; it is a live source.
--
-- ---------------------------------------------------------------------------
-- ★★★ §0 — THE STAMPING IS ALREADY CORRECT, AND THE 28 ARE ARITHMETIC
-- ---------------------------------------------------------------------------
--
-- `bp_set_consultant_status` does, and has always done:
--
--     Scheduled → sent=null,                  recd=null
--     Pending   → sent=coalesce(sent,today),  recd=null
--     Received  → sent=coalesce(sent,today),  recd=coalesce(recd,today)
--
-- Walk the ladder and the interval is real — 15 rounds sit at `Pending` with a
-- `sent` and no `recd` right now, waiting to become one. The 28 zeroes are
-- rounds that went straight **Scheduled → Received**: at that moment `sent` is
-- still null, so BOTH slots stamp today. **Same-day is the arithmetic of
-- skipping `Pending`, not a capture bug.**
--
-- ⚠️ Cowork first called this a capture bug and ranked it first on invented
--    urgency. Reading the function corrected it. → [[rows-are-not-history-dated-rows-are]]
--
-- ---------------------------------------------------------------------------
-- §A — THE ONE CHANGE
-- ---------------------------------------------------------------------------
--
-- A round arriving at `Received` **no longer stamps `sent`**. Walking the ladder
-- stamps it at `Pending`, where it belongs; arriving straight from `Scheduled`
-- leaves it NULL.
--
-- ★★★ BECAUSE A 0-DAY TURNAROUND IS WORSE THAN NO TURNAROUND: a zero averages
--     into every future number and a null does not. Twenty-eight zeroes would
--     drag a median of 14 days to somewhere near 3.
--
-- ★★ THE `Pending` PATH IS UNTOUCHED, and `coalesce` stays there for the reason
--    fix-474 recorded: re-entering `Pending` after a correction must not
--    overwrite the date it really went out.
--
-- ★ `recd` IS UNTOUCHED TOO. `coalesce(r.recd, v_today)` still stands — a round
--   that reached `Received` really was received today, whatever route it took.
--   The skip costs us the SEND date, not the receipt.
--
-- ⚠️ WHAT THIS DOES NOT DO: nothing is backfilled and no date is deleted. The
--    28 zeroes keep their rows (§B, and the Do-NOT list). This file contains no
--    UPDATE, INSERT or DELETE of any kind — asserted in the suite.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE PROBE — BOTH LADDERS, PROD, ROLLED BACK, 2026-09-29
-- ---------------------------------------------------------------------------
--
-- The fix-153 pattern this repo uses in place of a CI database. This exact
-- replacement was applied on eibnmwthkcuumyclyxoe inside `BEGIN; … ROLLBACK;`
-- and both ladders were walked through the REAL RPC on a REAL consultant:
--
--   A. the SKIP      Scheduled → Received in one call
--                    → status=Received  sent=**NULL**  recd=2026-09-29
--                    → duration: NOT COUNTABLE. ★ This is the whole ticket.
--
--   B. the WALK      Scheduled → Pending → (backdated 2 days) → Received
--                    → status=Received  sent=2026-09-27  recd=2026-09-29
--                    → duration: **2 days** — a real interval, asserted as a
--                      NUMBER rather than as "not null", which is what the
--                      brief's second test asks for.
--
--   C. `Pending` still stamps `sent` .......................... YES
--
-- Absence re-checked afterwards: the old `when v_status in ('Pending',
-- 'Received')` is still live, no `fix-560` marker leaked, 201 live rounds and
-- 28 zero-day rounds unchanged.
--
-- ---------------------------------------------------------------------------
-- §B — THE CUTOFF, AND WHY IT IS NOT THE DATE BOBBY SPOKE
-- ---------------------------------------------------------------------------
--
-- Pre-cutoff rounds keep their dates and are never counted or rendered as a
-- duration. Bobby's *"only keep the dates starting today"* is read as **stop
-- counting them**, not erase them — the 15 in-flight rounds need their `sent`.
-- ⚠️ Stated for correction: if he meant erase, it is one line and this file does
--    not contain it.
--
-- ★★★ THE CUTOFF IS THE DAY THIS FILE IS APPLIED, NOT 2026-09-15. Six zeroes
--     were stamped after Bobby ruled, because the ruling did not change the
--     function — this file does. A cutoff at the ruling date would let those six
--     straight through into the first average anybody computes.
--
-- ★★ THE CONSTANT LIVES IN `src/lib/consultants.ts` as
--    `CONSULTANT_DURATION_CUTOFF`, set to **2026-09-29**, the day this shipped.
--    **If you apply this file later than that, run the check below** — it names
--    any zero-day round that slipped through the gap, and if it returns rows the
--    constant should be raised to the apply date.
--
-- ★ Nothing renders a duration today — measured: `recd` appears in the UI only
--   as a date. The predicate exists so that P-214 (the expand panel) and P-265
--   (the benchmark) inherit the rule instead of each inventing one. Both are
--   deliberately NOT built here.
-- ===========================================================================


BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The one change, by anchor
-- ---------------------------------------------------------------------------
--
-- ★★ ANCHORED AND RE-EMITTED FROM THE LIVE DEFINITION rather than retyped, so
--    the other ninety lines of this function — the OCC check (fix-382), the
--    reopen branch (fix-479), the void filter, the Pacific `today` (fix-433) —
--    cannot be silently reverted by a stale copy. fix-410's rule.
--
-- ★ It RAISES if the anchor has moved. A `replace` that matches nothing reports
--   success, which is fix-540's lesson and the reason this is a DO block rather
--   than a hand-written CREATE OR REPLACE.
DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_live text;
  v_anchor text :=
    '         sent = case' || chr(10) ||
    '                  when v_status = ''Scheduled'' then null' || chr(10) ||
    '                  when v_status in (''Pending'', ''Received'')' || chr(10) ||
    '                    then coalesce(r.sent, v_today)' || chr(10) ||
    '                  else r.sent' || chr(10) ||
    '                end,';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'bp_set_consultant_status';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'fix-560: bp_set_consultant_status not found';
  END IF;

  IF position('fix-560' IN v_src) > 0 THEN
    RAISE NOTICE 'fix-560: already applied'; RETURN;
  END IF;

  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION
      'fix-560: anchor not found in bp_set_consultant_status — re-derive it '
      'from pg_get_functiondef; a replace that matches nothing reports success';
  END IF;

  v_new := replace(v_src, v_anchor,
    '         sent = case' || chr(10) ||
    '                  when v_status = ''Scheduled'' then null' || chr(10) ||
    '                  -- fix-560 (P-264): Pending is where a send is stamped.' || chr(10) ||
    '                  when v_status = ''Pending'' then coalesce(r.sent, v_today)' || chr(10) ||
    '                  -- ★★★ fix-560: Received does NOT stamp. A round that' || chr(10) ||
    '                  --     skipped Pending has no send date, and NULL is' || chr(10) ||
    '                  --     honest where a same-day zero would not be: a zero' || chr(10) ||
    '                  --     averages into every future number, a null does not.' || chr(10) ||
    '                  when v_status = ''Received'' then r.sent' || chr(10) ||
    '                  else r.sent' || chr(10) ||
    '                end,');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'fix-560: replacement changed nothing';
  END IF;
  EXECUTE v_new;

  -- ★ fix-540's rule: read the LIVE definition back, not the string we built.
  SELECT pg_get_functiondef(p.oid) INTO v_live
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'bp_set_consultant_status';
  IF position('when v_status = ''Received'' then r.sent' IN v_live) = 0 THEN
    RAISE EXCEPTION 'fix-560: executed but the LIVE body still stamps sent on Received';
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. The assertions
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_def text; v_rounds int; v_zero int; v_pending int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'bp_set_consultant_status';

  -- (a) Received no longer coalesces a send date into existence
  IF position('when v_status in (''Pending'', ''Received'')' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fix-560: the old combined Pending/Received branch survives';
  END IF;

  -- (b) ★★★ THE PENDING PATH IS UNTOUCHED — §A says so in as many words, and
  --     losing it would stop every send date being recorded at all.
  IF position('when v_status = ''Pending'' then coalesce(r.sent, v_today)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-560: Pending no longer stamps sent — the fix went too far';
  END IF;

  -- (c) `recd` is untouched
  IF position('when v_status = ''Received'' then coalesce(r.recd, v_today)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-560: the recd stamp was disturbed';
  END IF;

  -- (d) ★★ the rest of the function survived the re-emit
  IF position('if v_cur.status = ''Received'' and v_status = ''Scheduled'' then' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-560: fix-479''s reopen branch was lost';
  END IF;
  IF position('p_expected_updated_at is not null' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-560: fix-382''s OCC check was lost';
  END IF;
  IF position('now() at time zone ''America/Los_Angeles''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-560: fix-433''s Pacific today was lost';
  END IF;
  IF position('r.voided_at is null' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fix-560: fix-479''s void filter was lost';
  END IF;

  -- (e) ★★★ NO ROW MOVED. The Do-NOT list: do not backfill the zeroes, do not
  --     delete any date. This file writes no data at all.
  SELECT count(*),
         count(*) FILTER (WHERE status='Received' AND sent IS NOT NULL AND recd = sent),
         count(*) FILTER (WHERE status='Pending' AND sent IS NOT NULL AND recd IS NULL)
    INTO v_rounds, v_zero, v_pending
    FROM public.project_consultant_rounds WHERE voided_at IS NULL;
  IF v_rounds <> 201 OR v_zero <> 28 OR v_pending <> 15 THEN
    RAISE NOTICE 'fix-560: counts have moved since 2026-09-29 — % live, % zero-day, % pending '
      '(was 201 / 28 / 15). Not a failure; the data is live. Nothing here changed them.',
      v_rounds, v_zero, v_pending;
  END IF;
  RAISE NOTICE 'fix-560: Received no longer stamps sent; % live rounds, % zero-day, % in flight',
    v_rounds, v_zero, v_pending;
END
$verify$;

COMMIT;


-- ---------------------------------------------------------------------------
-- 3. Verify after applying — the behaviour, not the text
-- ---------------------------------------------------------------------------
--
-- ⚠️ Run this inside a transaction you ROLL BACK, on a consultant whose latest
--    live round is `Scheduled` with no dates. Set the JWT claims, as fix-549
--    recorded, or the tenant scope check refuses.
--
--   BEGIN;
--   select set_config('request.jwt.claims','{"sub":"<admin uid>","role":"authenticated"}',true);
--   -- the SKIP: expect sent NULL, recd today
--   select * from public.bp_set_consultant_status('<consultant uuid>','Received','<token>');
--   select status, sent, recd from public.project_consultant_rounds where id = '<round>';
--   ROLLBACK;
--
-- ---------------------------------------------------------------------------
-- ★★★ 4. THE CUTOFF CHECK — run this ONCE after applying
-- ---------------------------------------------------------------------------
--
-- `CONSULTANT_DURATION_CUTOFF` in `src/lib/consultants.ts` is **2026-09-29**,
-- the day this shipped. If this file is applied later than that, zeroes could
-- have been written in the gap and would pass the filter.
--
--   SELECT count(*) AS zeroes_after_the_cutoff
--     FROM public.project_consultant_rounds
--    WHERE voided_at IS NULL AND status = 'Received'
--      AND sent IS NOT NULL AND recd = sent
--      AND sent >= DATE '2026-09-29';
--
-- ★ Expect **0**. If it returns rows, raise the constant in `consultants.ts` to
--   the apply date and ship that one-line change — the rows themselves stay, as
--   §B requires.
--
-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------
--
-- ★ Re-run step 1's block against the then-live definition with the replacement
--   reversed — anchor on the three fix-560 lines and restore the single
--   `when v_status in ('Pending', 'Received') then coalesce(r.sent, v_today)`.
--   No data has to be restored, because none was changed.
