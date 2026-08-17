-- fix-339: request a post — and the first SHARED board item.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-18 via MCP apply_migration,
--   and verified with a rolled-back multi-identity probe. See the bottom.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE HARD PART: a shared item, not a per-person one
-- ---------------------------------------------------------------------------
-- Everything on the board today is PER-PERSON. fix-307's model is
-- `board_item_reads`: one row per user per key, and a thing is unread FOR YOU.
--
-- A post request is not that shape. Bobby: "it pings the oversight people + the
-- ent lead for that project, then once it is created/read/satisfied, as a
-- notification, IT GETS REMOVED FROM ALL QUEUES."
--
-- ★★ SO IT HAS NO READ MODEL AT ALL, AND THAT IS THE WHOLE DESIGN.
--
-- A per-user read row would mean five people each dismissing the same request —
-- precisely the busywork this is deleting — and it makes "satisfied"
-- unrepresentable, because there is no shared state to satisfy.
--
-- Instead the item's EXISTENCE IS ITS UNREAD STATE. The board derives an item
-- from this table only while `status = 'open'`. The moment anybody resolves it,
-- the row stops qualifying and it leaves every queue at once — not because five
-- read rows were written, but because the one fact everybody was reading
-- changed.
--
-- ★ FIRST-RESPONDER-WINS IS ENFORCED BY THE DATABASE, not by the client: the
-- UPDATE policy's USING clause requires `status = 'open'`, so a second resolver
-- arriving a moment later affects ZERO ROWS. Two people clicking at once cannot
-- double-write, and neither of them has to be trusted to check first.
--
-- ★★ THE RULE, NAMED SO #102 AND #105 CAN REUSE IT:
--
--     A PERSONAL board item needs board_item_reads, because "seen" is not a
--     fact any domain row carries.
--
--     A SHARED board item needs no read model, because the domain row already
--     records resolution — and deriving the item from that row gives
--     first-responder-wins, idempotence and a satisfiable state for free.
--
-- Bobby is converging on this shape from three directions: milestones that
-- clear when acknowledged (#105), bot tasks that close and announce themselves
-- (#102), and this. All three already HAVE a domain row
-- (permit_milestone_acks, permit_tasks, post_requests), so none of them needs a
-- shared read table — each needs its item derived from its own row's state.
-- The reusable part is the RULE and `NewItem.audience`, not a table.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Stamped by the trigger below, not by a DEFAULT auth.uid(): a bare default
  -- FK-fails for an authenticated user with no profiles row, the trap
  -- fix-notes-1 hit and fix-329 documented.
  requested_by uuid REFERENCES public.profiles(id),
  title        text NOT NULL CHECK (length(btrim(title)) > 0),
  -- ★ A reason is REQUIRED. The point of routing a request is that whoever
  -- picks it up can create the right thread without a conversation about it.
  reason       text NOT NULL CHECK (length(btrim(reason)) > 0),

  -- ★★ THE SHARED STATE. One row, one status, everybody's view derived from it.
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'created', 'acknowledged', 'declined')),
  resolved_by  uuid REFERENCES public.profiles(id),
  resolved_at  timestamptz,
  resolution_note text,
  -- Set when the resolution was "an admin made the post" — the requester is
  -- taken straight to it.
  created_post_id uuid REFERENCES public.project_messages(id) ON DELETE SET NULL,

  -- ★ THE RECIPIENTS, RESOLVED AT REQUEST TIME. uuid[] rather than a child
  -- table for the reason fix-329 gave for `mentions`: written once, read with
  -- the row, never queried on its own.
  recipients   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  -- ★★ AND THE ONES THAT COULD NOT BE RESOLVED, BY NAME. Dave holds oversight
  -- and his roster row has no email, so his login cannot be matched to it and
  -- he will not receive this. A recipient who silently vanishes is how somebody
  -- concludes the feature works when it half does — so the names are kept and
  -- the UI says them out loud. THE ROSTER IS NOT FIXED HERE; that is queued
  -- separately and is Bobby's to approve.
  unresolved_recipients text[] NOT NULL DEFAULT ARRAY[]::text[],

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- status and resolved_at cannot drift apart.
  CONSTRAINT post_requests_resolution_shape CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.post_requests IS
  'fix-339: a request for an admin to open a chat post. THE FIRST SHARED BOARD '
  'ITEM — several recipients, one status, and resolving it clears it from all '
  'their queues at once. It has no per-user read model on purpose: the item '
  'exists only while status = open, so its existence IS its unread state.';

CREATE INDEX IF NOT EXISTS post_requests_open_idx
  ON public.post_requests (tenant_id, created_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS post_requests_recipients_gin
  ON public.post_requests USING GIN (recipients);
CREATE INDEX IF NOT EXISTS post_requests_project_idx
  ON public.post_requests (project_id, created_at DESC);

DROP TRIGGER IF EXISTS post_requests_default_tenant ON public.post_requests;
CREATE TRIGGER post_requests_default_tenant
  BEFORE INSERT ON public.post_requests
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

CREATE OR REPLACE FUNCTION public.bp_trg_post_request_author()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.requested_by IS NULL THEN
    SELECT p.id INTO NEW.requested_by FROM public.profiles p WHERE p.id = auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS post_requests_author ON public.post_requests;
CREATE TRIGGER post_requests_author
  BEFORE INSERT ON public.post_requests
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_post_request_author();

-- ---------------------------------------------------------------------------
-- 2. RLS — anyone may ask; only a recipient may answer; only once
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_requests_tenant_select ON public.post_requests;
CREATE POLICY post_requests_tenant_select ON public.post_requests
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★ ANYONE MAY REQUEST. That is the entire point — fix-334 gated post CREATION
-- to admins, and this is the escape hatch that stops a non-admin's topic being
-- buried at the bottom of General.
DROP POLICY IF EXISTS post_requests_tenant_insert ON public.post_requests;
CREATE POLICY post_requests_tenant_insert ON public.post_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY (public.auth_tenant_ids())
    AND (requested_by IS NULL OR requested_by = auth.uid())
    AND status = 'open'
  );

-- ★★ FIRST-RESPONDER-WINS, AS A POLICY. `status = 'open'` in USING means the
-- row stops being updatable the instant somebody resolves it, so a second
-- resolver affects zero rows rather than overwriting the first. This is what
-- makes "cannot be resolved twice" a property of the database instead of a
-- check the client is trusted to perform.
DROP POLICY IF EXISTS post_requests_recipient_resolve ON public.post_requests;
CREATE POLICY post_requests_recipient_resolve ON public.post_requests
  FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY (public.auth_tenant_ids())
    AND status = 'open'
    AND (
      auth.uid() = ANY (recipients)
      OR public.is_tenant_admin(tenant_id)
    )
  )
  WITH CHECK (
    tenant_id = ANY (public.auth_tenant_ids())
    AND (
      auth.uid() = ANY (recipients)
      OR public.is_tenant_admin(tenant_id)
    )
  );

-- ★ No DELETE policy and no DELETE grant: a request is a record of somebody
-- asking, and the requester is owed the outcome.
REVOKE ALL ON TABLE public.post_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.post_requests TO authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.post_requests FROM authenticated;
-- ★ COLUMN-LEVEL, fix-334's pattern: RLS says which ROWS, this says which
-- FIELDS. Without it a recipient resolving a request could also rewrite its
-- title, its reason or its recipient list, and the row policy would allow it.
GRANT UPDATE (status, resolved_by, resolved_at, resolution_note, created_post_id)
  ON TABLE public.post_requests TO authenticated;
GRANT UPDATE ON TABLE public.post_requests TO service_role;

-- ---------------------------------------------------------------------------
-- ★ 3. Raise a request — and work out who it goes to
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because resolving recipients reads team_members and
-- profiles across the tenant, and profiles is read-own-only under RLS.
--
-- ★ WHO: the oversight holders (team_members.is_oversight — Dave, Gena and
-- Bobby today) PLUS the project's entitlement lead. Oversight is deliberately
-- not role-scoped; boardAging.ts already records that "the viewer must own a
-- leg, UNLESS they hold oversight", so an oversight holder legitimately sees
-- everything.
--
-- ★ ent_lead IS A NAME STRING, not an id, so it resolves through
-- team_members.name → team_members.email → profiles.email. That is fix-176's
-- login↔roster mapping, reused rather than re-invented.
--
-- ★ THE REQUESTER IS EXCLUDED from their own recipient list — a request you
-- raised sitting in your own queue as an action to take is noise.
CREATE OR REPLACE FUNCTION public.bp_request_post(
  p_project_id uuid,
  p_title text,
  p_reason text
)
  RETURNS TABLE (
    id uuid,
    recipient_count integer,
    unresolved_recipients text[]
  )
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_tenant     uuid;
  v_me         uuid := auth.uid();
  v_recipients uuid[];
  v_unresolved text[];
  v_id         uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant FROM public.projects p WHERE p.id = p_project_id;
  IF v_tenant IS NULL OR NOT (v_tenant = ANY (public.auth_tenant_ids())) THEN
    RAISE EXCEPTION 'bp_request_post: project % not in caller scope', p_project_id
      USING ERRCODE = '42501';
  END IF;

  WITH wanted AS (
    -- the oversight holders
    SELECT DISTINCT tm.name, tm.email
    FROM public.team_members tm
    WHERE tm.tenant_id = v_tenant
      AND tm.is_oversight IS TRUE
    UNION
    -- the project's entitlement lead(s), by name off the permits
    SELECT DISTINCT tm.name, tm.email
    FROM public.permits pe
    JOIN public.team_members tm
      ON tm.tenant_id = v_tenant
     AND NULLIF(btrim(tm.name), '') = NULLIF(btrim(pe.ent_lead), '')
    WHERE pe.project_id = p_project_id
      AND pe.ent_lead IS NOT NULL
  ),
  matched AS (
    SELECT w.name,
           (SELECT pr.id FROM public.profiles pr
             WHERE pr.email IS NOT NULL
               AND w.email IS NOT NULL
               AND lower(btrim(pr.email)) = lower(btrim(w.email))
             LIMIT 1) AS user_id
    FROM wanted w
  )
  SELECT
    COALESCE(array_agg(DISTINCT m.user_id) FILTER (
      WHERE m.user_id IS NOT NULL AND m.user_id <> v_me
    ), ARRAY[]::uuid[]),
    -- ★ Kept, not dropped. A recipient nobody can reach is a fact the requester
    -- needs, not an empty space.
    COALESCE(array_agg(DISTINCT m.name) FILTER (WHERE m.user_id IS NULL), ARRAY[]::text[])
  INTO v_recipients, v_unresolved
  FROM matched m;

  INSERT INTO public.post_requests
    (tenant_id, project_id, requested_by, title, reason,
     recipients, unresolved_recipients)
  VALUES
    (v_tenant, p_project_id, v_me, btrim(p_title), btrim(p_reason),
     v_recipients, v_unresolved)
  RETURNING post_requests.id INTO v_id;

  RETURN QUERY SELECT v_id, COALESCE(array_length(v_recipients, 1), 0), v_unresolved;
END $$;

REVOKE ALL ON FUNCTION public.bp_request_post(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_request_post(uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. What the board reads
-- ---------------------------------------------------------------------------
-- ★ ONE QUERY FOR BOTH SURFACES. The bell and My Board call the same thing, so
-- they cannot disagree about an open request — fix-329's rule, and the defect
-- fix-298 Phase 2 spent a ticket collapsing.
--
-- It returns:
--   · OPEN requests addressed to me            → the shared item
--   · requests I RAISED that have been resolved → my personal outcome notice
--
-- ★ The second is deliberately a different animal: the outcome is news for ONE
-- person, so it is a personal item and uses board_item_reads like everything
-- else. The two models coexist in one payload, and that is the clearest
-- statement of how they differ.
CREATE OR REPLACE FUNCTION public.bp_my_post_requests()
  RETURNS TABLE (
    id uuid,
    project_id uuid,
    project_address text,
    title text,
    reason text,
    status text,
    requested_by uuid,
    requester_name text,
    resolved_by uuid,
    resolver_name text,
    resolution_note text,
    created_post_id uuid,
    recipients uuid[],
    unresolved_recipients text[],
    created_at timestamptz,
    resolved_at timestamptz,
    /** true when this row is the shared item; false when it is my outcome. */
    is_recipient boolean
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT r.id, r.project_id, p.address AS project_address,
         r.title, r.reason, r.status,
         r.requested_by, public.bp_profile_display_name(r.requested_by),
         r.resolved_by,  public.bp_profile_display_name(r.resolved_by),
         r.resolution_note, r.created_post_id,
         r.recipients, r.unresolved_recipients,
         r.created_at, r.resolved_at,
         (auth.uid() = ANY (r.recipients)) AS is_recipient
  FROM public.post_requests r
  JOIN public.projects p ON p.id = r.project_id
  WHERE r.tenant_id = ANY (public.auth_tenant_ids())
    AND (
      (r.status = 'open' AND auth.uid() = ANY (r.recipients))
      OR (r.status <> 'open' AND r.requested_by = auth.uid())
    )
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.bp_my_post_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_my_post_requests() TO authenticated, service_role;

-- ★ Every OPEN request on one project, for the chat modal's admin panel — an
-- admin opening the chat should see what has been asked for there even if they
-- were not a resolved recipient.
CREATE OR REPLACE FUNCTION public.bp_project_post_requests(p_project_id uuid)
  RETURNS TABLE (
    id uuid, title text, reason text, status text,
    requested_by uuid, requester_name text,
    unresolved_recipients text[], created_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT r.id, r.title, r.reason, r.status,
         r.requested_by, public.bp_profile_display_name(r.requested_by),
         r.unresolved_recipients, r.created_at
  FROM public.post_requests r
  WHERE r.project_id = p_project_id
    AND r.tenant_id = ANY (public.auth_tenant_ids())
    AND r.status = 'open'
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.bp_project_post_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_project_post_requests(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ★★ 5. Resolve it — once, for everybody
-- ---------------------------------------------------------------------------
-- Returns the number of rows affected: 1 for the first responder, 0 for anyone
-- arriving afterwards. The client reports that honestly rather than pretending
-- both succeeded.
--
-- ★ The UPDATE relies on the policy's `status = 'open'` for the race; it does
-- NOT re-check in application code, because a check in plpgsql would be a
-- second opinion about the same fact and the two could disagree under
-- concurrency.
CREATE OR REPLACE FUNCTION public.bp_resolve_post_request(
  p_id uuid,
  p_status text,
  p_note text DEFAULT NULL,
  p_created_post_id uuid DEFAULT NULL
)
  RETURNS integer
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_status NOT IN ('created', 'acknowledged', 'declined') THEN
    RAISE EXCEPTION 'bp_resolve_post_request: % is not a resolution', p_status;
  END IF;
  UPDATE public.post_requests
     SET status = p_status,
         resolved_by = auth.uid(),
         resolved_at = now(),
         resolution_note = p_note,
         created_post_id = COALESCE(p_created_post_id, created_post_id)
   WHERE id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.bp_resolve_post_request(uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_resolve_post_request(uuid, text, text, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Realtime — the existing channel
-- ---------------------------------------------------------------------------
-- ★ ONE CHANNEL. post_requests joins the existing bp-v2-realtime subscription;
-- useScraperActivity's comment records what opening a second one cost.
DO $pub$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'post_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.post_requests;
  END IF;
END $pub$;

-- ---------------------------------------------------------------------------
-- ★ VERIFY AFTER APPLYING — with real identities, not by reading the policy:
--
--   a NON-ADMIN raises a request                     → allowed
--   recipients                                       → oversight + ent lead,
--                                                      requester excluded
--   ★ Dave (oversight, no roster email)              → in unresolved_recipients,
--                                                      request still works
--   two recipients both see it open                  → 1 shared item each
--   recipient A resolves                             → 1 row
--   ★ recipient B resolves the same one              → 0 rows
--   ★ and it is gone from BOTH queues                → 0 open items each
--   the requester sees the outcome                   → 1 personal item
--   a NON-recipient, NON-admin tries to resolve      → 0 rows
-- ---------------------------------------------------------------------------
