-- fix-338: the error triage groups the wrong things together.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-18 via MCP apply_migration.
--   Verified afterwards with a rolled-back probe — see the bottom of this file.
--
-- ---------------------------------------------------------------------------
-- ★★ WHAT WAS ACTUALLY WRONG. Two bugs, and Bobby saw both symptoms.
-- ---------------------------------------------------------------------------
-- Two rows, both `TypeError: Failed to fetch`, both Miles, four hours apart on
-- 2026-08-14 — one on /projects querying permit_cycle_reviewers (resolved), one
-- on a project page querying notes/search-index (new). They shared fingerprint
-- a52a318b357738475fcd8c38fa671cda.
--
--   1. bp_log_error hashed `source || '|' || normalized_message` and NOTHING
--      ELSE. p_context never reached the fingerprint, so every "Failed to
--      fetch" anywhere in the app — any query, any screen — was one group. And
--      because bp_update_error_group_status updates every row carrying the
--      fingerprint, resolving the failure in front of you silently resolved
--      failures you had never seen. ★ THAT is the defect; the network error
--      itself is benign.
--
--   2. bp_list_error_groups filtered by status BEFORE the GROUP BY, then
--      reported COUNT(*). So a fingerprint with one resolved row and one new
--      row rendered as "New · 1 occurrence" — the resolved occurrence was
--      filtered out before it could be counted, and nothing said the thing had
--      been triaged once already and come back.
--
-- ★★★ Bobby read symptom 2 correctly days ago — "I just felt like they were
-- already marked as resolved" — and was told to leave it. He was right.

-- ---------------------------------------------------------------------------
-- ★★ 1. THE DISCRIMINATOR: the query NAME, and only the query name
-- ---------------------------------------------------------------------------
-- The new formula is:
--
--     md5( source || '|' || normalized_message [ || '|' || query_name ] )
--
-- ★ THE FIRST ELEMENT OF context->'queryKey' AND NOTHING ELSE. React Query keys
-- in this app routinely carry the tenant id and a project id —
-- ['project_messages', tenantId, projectId], ['notes', tenantId, {projectId}] —
-- so hashing the WHOLE key would give every project its own group and turn the
-- list into a raw log. That is the opposite failure and the worse one, because
-- it hides frequency. The first element is the query NAME, a bounded set drawn
-- from queryKeys.ts. `v_normalized` already replaces digit runs and timestamps
-- for exactly this reason; this respects that intent.
--
-- ★ AND NOTHING FOR THE OTHER SOURCES, which is a decision rather than an
-- omission. Scraper rows carry module / juris / phase, and backend_rpc rows
-- carry kind (mutation|query) — all bounded, all tempting. Measured on prod
-- before choosing: NOT ONE existing group mixes two modules, two jurisdictions,
-- two phases or two kinds. Adding them would have rewritten 100 of 116
-- fingerprints and merged or split nothing. Scraper messages already carry the
-- permit number, so those rows are already maximally separated.
--
-- ★ A ROW WITH NO queryKey FINGERPRINTS EXACTLY AS IT DOES TODAY. The
-- COALESCE below appends nothing when the discriminator is absent, so the
-- expression is byte-identical to the old one. Measured: 100 of the 116 rows in
-- error_reports are unaffected, and only 9 of 57 groups are touched.
CREATE OR REPLACE FUNCTION public.bp_log_error(
  p_source text,
  p_level text,
  p_message text,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_tenant_id uuid DEFAULT NULL::uuid
)
  RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id            bigint;
  v_fingerprint   text;
  v_normalized    text;
  v_discriminator text;
  v_user_id       uuid := auth.uid();
  v_user_email    text;
BEGIN
  IF p_tenant_id IS NOT NULL
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_log_error: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  v_normalized := lower(regexp_replace(
    regexp_replace(p_message, '\d{4}-\d{2}-\d{2}[T0-9:.+Z-]*', '<ts>', 'g'),
    '\s+', ' ', 'g'
  ));
  v_normalized := regexp_replace(v_normalized, '\b\d{2,}\b', '<num>', 'g');

  -- ★ The stable slice of the context. Array-typed queryKey only: a string or
  -- object shaped key is not something this can reason about, and guessing
  -- would be how an unbounded value sneaks in.
  v_discriminator := CASE
    WHEN jsonb_typeof(p_context -> 'queryKey') = 'array'
      THEN NULLIF(btrim(lower(p_context -> 'queryKey' ->> 0)), '')
    ELSE NULL
  END;

  v_fingerprint := md5(
    p_source || '|' || trim(v_normalized)
    || COALESCE('|' || v_discriminator, '')
  );

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  INSERT INTO public.error_reports
    (user_id, user_email, source, level, message, fingerprint, context, tenant_id)
  VALUES
    (v_user_id, v_user_email, p_source, p_level, p_message, v_fingerprint,
     COALESCE(p_context, '{}'::jsonb), p_tenant_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.bp_log_error(text, text, text, jsonb, uuid) IS
  'fix-338: the fingerprint now includes the QUERY NAME (context->queryKey->>0) '
  'when there is one. Only the first element — a whole React Query key carries '
  'tenant and project ids and would give every project its own group. A row '
  'with no queryKey fingerprints exactly as it did before.';

-- ---------------------------------------------------------------------------
-- ★★ 2. A GROUP MUST SHOW ITS RECURRENCES
-- ---------------------------------------------------------------------------
-- ★ THE FILTER MOVED FROM THE ROWS TO THE GROUPS. It used to sit in the WHERE,
-- so it decided both which groups appeared AND which occurrences were counted.
-- Those are two different questions and it was answering them with one clause:
-- COUNT(*) meant "occurrences that are still open" while the page rendered it
-- as "occurrences".
--
-- Now every row of a fingerprint is aggregated, and the HAVING decides whether
-- the GROUP is shown — by its CURRENT status, which is the latest row's, the
-- same definition the function already used for the badge it renders.
--
-- ★ The status filter keeps its meaning: a group whose latest occurrence is
-- resolved still does not appear in the Active list. What changed is that a
-- shown group now reports the truth about itself.
--
-- ★★ AND IT SAYS WHEN SOMETHING CAME BACK. `recurred` is the fact Bobby was
-- reaching for — the difference between "new problem" and "the fix did not
-- hold". It is true when the group has at least one occurrence that was once
-- resolved or dismissed AND its current status is open again.
-- ★★ THE TIE-BREAK IS LOAD-BEARING, and a rolled-back probe is what found it.
-- `now()` is CONSTANT inside a transaction, so several occurrences written in
-- one transaction share a created_at to the microsecond — and
-- `ORDER BY created_at DESC` then picks among them arbitrarily. A group that had
-- just recurred reported itself as resolved and vanished from the Active list,
-- which is the very bug this ticket exists to remove, reintroduced by the fix.
-- `id` is a bigserial: monotonic, never tied, and the later-inserted row is
-- exactly what "current status" means. Every ordered aggregate below carries it.
CREATE OR REPLACE FUNCTION public.bp_list_error_groups(
  p_status text[] DEFAULT ARRAY['new'::text, 'queued'::text, 'in_progress'::text]
)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(g ORDER BY last_seen DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      fingerprint,
      (array_agg(source   ORDER BY created_at DESC, id DESC))[1] AS source,
      (array_agg(level    ORDER BY created_at DESC, id DESC))[1] AS level,
      (array_agg(message  ORDER BY created_at DESC, id DESC))[1] AS sample_message,
      (array_agg(context  ORDER BY created_at DESC, id DESC))[1] AS sample_context,
      (array_agg(status   ORDER BY created_at DESC, id DESC))[1] AS status,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen,
      -- ★ EVERY occurrence, not only the ones that survived a status filter.
      COUNT(*)::int AS count,
      COUNT(DISTINCT user_id)::int AS user_count,
      -- ★ How many of them had already been triaged away.
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_count,
      MAX(resolved_at) AS last_resolved_at,
      -- ★★ "Resolved before, and back again." Open now, closed at least once.
      (
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) > 0
        AND (array_agg(status ORDER BY created_at DESC, id DESC))[1]
              IN ('new', 'queued', 'in_progress')
      ) AS recurred,
      (array_agg(backlog_ref ORDER BY created_at DESC, id DESC)
        FILTER (WHERE backlog_ref IS NOT NULL))[1] AS backlog_ref
    FROM public.error_reports
    WHERE tenant_id = ANY(auth_tenant_ids())
    GROUP BY fingerprint
    -- ★ The filter applies to the GROUP, after the counting.
    HAVING (array_agg(status ORDER BY created_at DESC, id DESC))[1] = ANY(p_status)
  ) g;
  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.bp_list_error_groups(text[]) IS
  'fix-338: counts and last-seen span the WHOLE fingerprint; the status filter '
  'selects which GROUPS are shown (by their current, i.e. latest, status) '
  'rather than which occurrences are counted. Adds resolved_count, '
  'last_resolved_at and recurred.';

-- ---------------------------------------------------------------------------
-- 3. The badge counts the same way the list does
-- ---------------------------------------------------------------------------
-- ★ It counted fingerprints having ANY row with status='new'. The list now
-- selects on the group's CURRENT status, so leaving the badge on the old rule
-- would let the two disagree about the same group — which is the defect
-- fix-298 Phase 2 spent a whole ticket collapsing. One definition, both places.
CREATE OR REPLACE FUNCTION public.bp_new_error_count()
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COUNT(*)::int FROM (
    SELECT fingerprint
    FROM public.error_reports
    WHERE tenant_id = ANY(auth_tenant_ids())
    GROUP BY fingerprint
    HAVING (array_agg(status ORDER BY created_at DESC, id DESC))[1] = 'new'
  ) x;
$function$;

-- ---------------------------------------------------------------------------
-- ★★ 4. HISTORIC ROWS ARE NOT TOUCHED — a decision, stated
-- ---------------------------------------------------------------------------
-- Changing the formula means existing rows carry fingerprints computed the old
-- way, so a future occurrence of one of them starts a new group.
--
-- ★ MEASURED BEFORE DECIDING, on prod: 116 rows in 57 groups (the brief said
-- 15 rows — that number is stale). Only 16 of those rows carry a queryKey at
-- all, so 100 are byte-identical under the new formula. The 16 live in 9
-- groups, and 8 of those 9 are already fully resolved.
--
--   ★ EXACTLY ONE still-open group is affected: a52a318b…, the pair Bobby
--     found — and splitting it in two is the entire point of this ticket.
--
-- So the cost of leaving history alone is: eight closed groups whose next
-- recurrence (if any ever comes) opens a fresh group. That is one cosmetic
-- split on already-triaged history.
--
-- ★★ AND THE ALTERNATIVE IS A WRITE TO EXISTING ROWS, WHICH IS BOBBY'S CALL,
-- NOT MINE. His standing rule is that existing rows are his. Recomputing is a
-- one-line UPDATE if he wants it — the expression is in this file — but it is
-- not run here and nothing in this migration writes to error_reports.

-- ---------------------------------------------------------------------------
-- ★ VERIFY AFTER APPLYING — by logging errors, not by reading the function:
--
--   the pair, before → after
--     permit_cycle_reviewers  a52a318b…  →  53df341d…
--     notes / search-index    a52a318b…  →  84e76baa…
--
--   two errors, same message, different query names  → DIFFERENT fingerprints
--   two occurrences of the same failure              → ONE fingerprint
--   a context-free error                             → unchanged fingerprint
--   resolving one group                              → the other stays open
--   a resolved group that recurs                     → recurred=true, count
--                                                      includes the resolved one
--   a fully resolved group                           → absent from the default
--                                                      list
-- ---------------------------------------------------------------------------
