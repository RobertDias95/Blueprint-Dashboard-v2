-- fix-307 (register #36-#41): per-user, per-item READ state for the board bell.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-14 via MCP apply_migration.
--   Grants verified afterwards with has_table_privilege:
--     authenticated  SELECT ✓  INSERT ✓  UPDATE ✗  DELETE ✗
--     anon           nothing
--
-- ★ WHY A NEW TABLE. There is no seen/read state anywhere in the schema.
-- permit_milestone_acks records "I PERFORMED this milestone" — a statement
-- about the work — and overloading it would make "I glanced at the bell"
-- indistinguishable from "I paid the fees". Read and done are two independent
-- states and the schema has to keep them apart, because the whole point of
-- this ticket is that acknowledging is not starting.
--
-- ★ THE ITEM KEY, AND WHY IT IS STABLE. Board items are DERIVED on every page
-- load, so an unstable key would re-notify on every refresh. The scheme:
--
--     flip:{audit_log_id}:{kind}   a scraper-detected status flip
--     task:{task_uuid}             a task assigned to you
--     handoff:{ack_uuid}           a design leg completed onto your plate
--     permit:{permit_id}           a permit newly naming you
--
-- Each root is an immutable database identity, not a re-derived value:
--   * audit_log is append-only and its ids are never reused, so the same flip
--     always produces the same key however many times parseFlips runs. `kind`
--     is appended because ONE audit row can carry several applied keys (a
--     cycle row can apply submitted + city_target + corr_issued at once) and
--     each is a separately acknowledgeable event.
--   * task and ack ids are uuid primary keys.
--   * permit_id is an identity column.
-- Nothing in a key is derived from a date, a name or a status, all of which
-- can change under a row and would silently re-notify if they did.
--
-- ★ PER USER, AND THE TEAM-SCOPE TRAP. user_id is the reader, always. fix-306
-- shipped a queue scope, so Brittani can be looking at Fisk's queue — reading
-- an item there writes a row for BRITTANI and must never touch Fisk's. The RLS
-- policies below only ever let a caller see or write their own rows, so the
-- isolation is enforced by the database rather than by the client remembering
-- to pass the right id.
--
-- ★ THE BACKFILL, done with ZERO ROWS. On the day this ships every existing
-- flip and assignment would become "new" at once and everybody would open the
-- tool to a three-figure badge. Rather than writing 29 users x N items of read
-- rows, the CLIENT carries an epoch constant (BOARD_NOTIFICATIONS_EPOCH in
-- src/lib/boardReads.ts) and nothing older than it can ever be new, for
-- anyone. That is exactly "treat everything older than the deploy as already
-- read": it needs no rows, it cannot drift out of sync with a user list, and
-- it still works for the 30th user created next month.
--
-- Append-only: SELECT + INSERT only. Reading is a fact that happened at a
-- moment; there is no such thing as un-reading, and "mark all read" is
-- expressed as more rows rather than a mutated one.

CREATE TABLE IF NOT EXISTS public.board_item_reads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  item_key   text NOT NULL,
  read_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.board_item_reads IS
  'fix-307: one row per (user, board item) the user has acknowledged. READ is '
  'not DONE — an acknowledged item leaves the badge and keeps its place on the '
  'board. Append-only; see the migration for the key scheme and why it is stable.';

-- Reading the same item twice is the same fact, so the second write is a no-op
-- rather than a duplicate. The client inserts ON CONFLICT DO NOTHING, which
-- needs no UPDATE privilege.
CREATE UNIQUE INDEX IF NOT EXISTS board_item_reads_user_item_uidx
  ON public.board_item_reads (user_id, item_key);

DROP TRIGGER IF EXISTS board_item_reads_default_tenant ON public.board_item_reads;
CREATE TRIGGER board_item_reads_default_tenant
  BEFORE INSERT ON public.board_item_reads
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.board_item_reads ENABLE ROW LEVEL SECURITY;

-- ★ OWN ROWS ONLY, both ways. This is what makes "Brittani reading Fisk's
-- queue does not clear Fisk's notifications" a database guarantee rather than
-- a client convention.
DROP POLICY IF EXISTS board_item_reads_own_select ON public.board_item_reads;
CREATE POLICY board_item_reads_own_select
  ON public.board_item_reads FOR SELECT
  USING (user_id = auth.uid() AND tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS board_item_reads_own_insert ON public.board_item_reads;
CREATE POLICY board_item_reads_own_insert
  ON public.board_item_reads FOR INSERT
  WITH CHECK (user_id = auth.uid() AND tenant_id = ANY (public.auth_tenant_ids()));

REVOKE ALL ON public.board_item_reads FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.board_item_reads TO authenticated, service_role;
-- ★ Named explicitly. Supabase DEFAULT PRIVILEGES hand every new table full
-- DML to `authenticated`, and a REVOKE that does not name the role leaves it —
-- which is exactly what happened on permit_milestone_acks in fix-298 P2 and
-- was only caught by checking has_table_privilege afterwards. Checked again
-- here, and it had re-granted again.
REVOKE UPDATE, DELETE, TRUNCATE ON public.board_item_reads FROM authenticated;
