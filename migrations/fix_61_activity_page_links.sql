-- fix-61 (2026-05-27): additive expansion of bp_fetch_scraper_activity.
--
-- The Activity page renders each event with the permit number as plain
-- text and groups them by address. Bobby asked for three frontend tweaks:
--   1. permit number renders as a hyperlink to the city portal
--      (target=_blank) when permits.portal_url is populated
--   2. a larger expand/collapse caret on each address-group header
--   3. an "Open Project" button on each address-group header that routes
--      to the project's overview page
--
-- Items 1 and 3 need two columns the RPC doesn't currently surface:
--   - permits.portal_url    (~79% populated in prod, optional link)
--   - permits.project_id    (100% populated, drives the Open Project route)
--
-- Both source columns are already reachable on the existing joined
-- `public.permits p` row — we add them to the SELECT list and to the
-- RETURNS TABLE signature only. WHERE / ORDER BY / LIMIT / function args
-- are byte-identical to prod. Display-only frontend additions are gated
-- on these fields being non-null at render time.
--
-- Function metadata also byte-identical:
--   LANGUAGE sql STABLE
--   SET search_path = 'public', 'pg_temp'
--   arg (p_days integer DEFAULT 14)
--
-- Confirmed against prod via:
--   SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n
--     ON n.oid=p.pronamespace WHERE n.nspname='public'
--      AND p.proname='bp_fetch_scraper_activity';
-- and against the typed column nullability of permits.portal_url (text)
-- + permits.project_id (uuid). project_id is uuid; the RPC returns it as
-- text-cast-able by PostgREST (it serializes uuid as JSON string).

CREATE OR REPLACE FUNCTION public.bp_fetch_scraper_activity(p_days integer DEFAULT 14)
 RETURNS TABLE(
   id bigint,
   created_at timestamp with time zone,
   action text,
   row_id text,
   changes jsonb,
   permit_num text,
   permit_type text,
   address text,
   juris text,
   cycle_index integer,
   ent_lead text,
   portal_url text,
   project_id uuid
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    al.id,
    al.created_at,
    al.action,
    al.row_id,
    al.changes,
    p.num         AS permit_num,
    p.type        AS permit_type,
    pr.address    AS address,
    pr.juris      AS juris,
    (substring(al.row_id from ':cycle:([0-9]+)'))::int AS cycle_index,
    p.ent_lead    AS ent_lead,
    p.portal_url  AS portal_url,
    p.project_id  AS project_id
  FROM public.audit_log al
  LEFT JOIN public.permits  p  ON p.id  = (substring(al.row_id from '^[0-9]+'))::int
  LEFT JOIN public.projects pr ON pr.id = p.project_id
  WHERE al.created_at > NOW() - make_interval(days => GREATEST(p_days, 1))
    AND (al.action LIKE 'scrape_%' OR al.action = 'manual_admin_correction')
    AND al.action NOT LIKE 'scrape_reviewer_%'
  ORDER BY al.created_at DESC
  LIMIT 300;
$function$;
