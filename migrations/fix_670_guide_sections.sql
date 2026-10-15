-- ===========================================================================
-- fix-670 (P-056) — the training guide lives in the Bridge
-- ===========================================================================
--
-- Bobby, 2026-10-14: "i want the training guide to be a live document in the
-- bridge. i want it to flow from start to finish, and be a complete guide for
-- any new hires in any role so they can see their roles, their
-- responsibilities." Ruled the same day: a Guide tab in What's New, one search
-- box over the guide and the tips, and a GIF + "Show me" on every step.
--
-- ★★★ WHAT THIS WRITES: one NEW table (EMPTY), one NEW private bucket, its four
--     storage policies, two IMMUTABLE text helpers and one search RPC. No
--     existing row in any table is read or written. Content is inserted
--     separately, after Bobby approves it.
--
-- ★★ THE SHAPE MIRRORS whats_new_entries ON PURPOSE (fix-350): tenant members
--    read, tenant admins write, enforced HERE — the hidden Edit button is a
--    decoration, this policy is the permission (fix-234 / fix-331 §6).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Text helpers — IMMUTABLE, so the search vector can be a GENERATED column
-- ---------------------------------------------------------------------------
-- A block is {t, text?, title?, items?, head?, rows?, ...}. Search weights:
--   title A · summary A · STEP titles B · every other block string C.
-- So there are two extractors: the step titles, and everything else.

CREATE OR REPLACE FUNCTION public.bp_guide_step_titles(blocks jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce(string_agg(b->>'title', ' '), '')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(blocks) = 'array' THEN blocks ELSE '[]'::jsonb END) AS b
   WHERE jsonb_typeof(b) = 'object'
     AND b->>'t' = 'step'
     AND jsonb_typeof(b->'title') = 'string';
$function$;

-- ★ Every string a reader sees except a step's title: text, a non-step title,
--   list items, a table's head and rows. Ids (`cards`), paths and media are not
--   words anybody searches for, so they are left out.
CREATE OR REPLACE FUNCTION public.bp_guide_text(blocks jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce(string_agg(s, ' '), '')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(blocks) = 'array' THEN blocks ELSE '[]'::jsonb END) AS b
    CROSS JOIN LATERAL (
      SELECT b->>'text' AS s WHERE jsonb_typeof(b->'text') = 'string'
      UNION ALL
      SELECT b->>'title' WHERE jsonb_typeof(b->'title') = 'string' AND b->>'t' <> 'step'
      UNION ALL
      SELECT i #>> '{}'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b->'items') = 'array' THEN b->'items' ELSE '[]'::jsonb END) i
       WHERE jsonb_typeof(i) = 'string'
      UNION ALL
      SELECT h #>> '{}'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b->'head') = 'array' THEN b->'head' ELSE '[]'::jsonb END) h
       WHERE jsonb_typeof(h) = 'string'
      UNION ALL
      SELECT c #>> '{}'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b->'rows') = 'array' THEN b->'rows' ELSE '[]'::jsonb END) r
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r) = 'array' THEN r ELSE '[]'::jsonb END) c
       WHERE jsonb_typeof(c) = 'string'
    ) x
   WHERE jsonb_typeof(b) = 'object';
$function$;

REVOKE ALL ON FUNCTION public.bp_guide_step_titles(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_guide_text(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_guide_step_titles(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_guide_text(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The sections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guide_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- 1 Start here · 2 How a project moves · 3 Your role · 4 The screens ·
  -- 5 Words we use (the names live in src/lib/guide.ts).
  part        smallint NOT NULL
                CONSTRAINT guide_sections_part_range CHECK (part BETWEEN 1 AND 5),
  -- Order across the WHOLE guide — it always reads start to finish.
  sort_order  integer NOT NULL DEFAULT 0,
  -- The deep-link anchor: /whats-new?tab=guide&s=<slug>.
  slug        text NOT NULL
                CONSTRAINT guide_sections_slug_shape CHECK (slug ~ '^[a-z0-9-]{1,60}$'),
  title       text NOT NULL
                CONSTRAINT guide_sections_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
  summary     text
                CONSTRAINT guide_sections_summary_length CHECK (summary IS NULL OR char_length(summary) <= 240),
  audience    text[] NOT NULL DEFAULT '{everyone}'
                CONSTRAINT guide_sections_audience_known CHECK (
                  cardinality(audience) > 0
                  AND audience <@ ARRAY['everyone', 'permitting', 'design', 'acquisitions',
                                        'construction_admin', 'leadership']::text[]
                ),
  -- ★★★ fix-387's rule, copied: ONE leading slash and no backslash anywhere.
  --     `//evil.com` starts with a slash and is a protocol-relative URL.
  show_me     text
                CONSTRAINT guide_sections_show_me_is_app_path CHECK (
                  show_me IS NULL
                  OR (show_me ~ '^/($|[^/\\])' AND position('\' in show_me) = 0)
                ),
  blocks      jsonb NOT NULL DEFAULT '[]'::jsonb
                CONSTRAINT guide_sections_blocks_is_array CHECK (jsonb_typeof(blocks) = 'array'),
  -- "Last checked".
  reviewed_on date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid(),
  search_tsv  tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
                setweight(to_tsvector('english'::regconfig, coalesce(summary, '')), 'A') ||
                setweight(to_tsvector('english'::regconfig, public.bp_guide_step_titles(blocks)), 'B') ||
                setweight(to_tsvector('english'::regconfig, public.bp_guide_text(blocks)), 'C')
              ) STORED,
  CONSTRAINT guide_sections_tenant_slug_key UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS guide_sections_tenant_order_idx
  ON public.guide_sections (tenant_id, part, sort_order);
CREATE INDEX IF NOT EXISTS guide_sections_search_tsv_idx
  ON public.guide_sections USING gin (search_tsv);

-- tenant_id from the caller, exactly like whats_new_entries.
DROP TRIGGER IF EXISTS guide_sections_default_tenant ON public.guide_sections;
CREATE TRIGGER guide_sections_default_tenant
  BEFORE INSERT ON public.guide_sections
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

-- ★ Who last touched it, stamped by the server rather than trusted from the
--   client (the client still sends updated_at, as the What's New editor does).
CREATE OR REPLACE FUNCTION public.guide_sections_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guide_sections_stamp ON public.guide_sections;
CREATE TRIGGER guide_sections_stamp
  BEFORE UPDATE ON public.guide_sections
  FOR EACH ROW EXECUTE FUNCTION public.guide_sections_stamp();

ALTER TABLE public.guide_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guide_sections_tenant_select ON public.guide_sections;
CREATE POLICY guide_sections_tenant_select
  ON public.guide_sections
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS guide_sections_tenant_admin_write ON public.guide_sections;
CREATE POLICY guide_sections_tenant_admin_write
  ON public.guide_sections
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

-- ★★ The default-privileges gotcha: REVOKE from PUBLIC/anon leaves
--    `authenticated` with whatever the defaults granted, so the grant below is
--    written out in full rather than assumed (fix-273).
REVOKE ALL ON public.guide_sections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guide_sections TO authenticated, service_role;

COMMENT ON TABLE public.guide_sections IS
  'fix-670: the training guide (What''s New → Guide). One row per section, in '
  'part + sort_order order. blocks = ordered JSON array (p, list, callout, table, '
  'step, cards). Read by every tenant member, written by tenant admins (RLS).';

-- ---------------------------------------------------------------------------
-- 3. Realtime — an admin's edit reaches every open guide (fix-336 / fix-393:
--    a client key with no publication is SILENT, so publish it here).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'guide_sections'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guide_sections;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Media — private bucket `guide-media`, path prefix = tenant id
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('guide-media', 'guide-media', false, 15728640,
        ARRAY['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

-- Read: any member of the tenant named by the first path segment (avatars' rule).
DROP POLICY IF EXISTS guide_media_tenant_read ON storage.objects;
CREATE POLICY guide_media_tenant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'guide-media'
    AND (split_part(name, '/', 1))::uuid = ANY (public.auth_tenant_ids())
  );

-- Write / delete: that tenant's admins only.
DROP POLICY IF EXISTS guide_media_admin_insert ON storage.objects;
CREATE POLICY guide_media_admin_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'guide-media'
    AND public.is_tenant_admin((split_part(name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS guide_media_admin_update ON storage.objects;
CREATE POLICY guide_media_admin_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'guide-media'
    AND public.is_tenant_admin((split_part(name, '/', 1))::uuid)
  )
  WITH CHECK (
    bucket_id = 'guide-media'
    AND public.is_tenant_admin((split_part(name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS guide_media_admin_delete ON storage.objects;
CREATE POLICY guide_media_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'guide-media'
    AND public.is_tenant_admin((split_part(name, '/', 1))::uuid)
  );

-- ---------------------------------------------------------------------------
-- 5. Search — bp_search_guide, the twin of bp_search_whats_new (fix-657)
-- ---------------------------------------------------------------------------
-- Same per-word scoring, same thresholds: english FTS on the weighted vector
-- (a hit in title/summary/step titles counts 1.0, elsewhere 0.6) plus pg_trgm
-- word_similarity for typos. Rank = average word score + half the share of
-- query words matched + a small ts_rank_cd tie-break.
-- ★ SECURITY INVOKER: the caller's own RLS scopes the tenant.
CREATE OR REPLACE FUNCTION public.bp_search_guide(q text)
RETURNS TABLE (id uuid, slug text, title text, rank real, snippet text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
  WITH input AS (
    SELECT lower(btrim(coalesce(q, ''))) AS q
  ),
  terms AS (
    SELECT DISTINCT w
      FROM input, regexp_split_to_table(input.q, '[^a-z0-9]+') AS w
     WHERE length(w) >= 2
       AND to_tsvector('english', w) <> ''::tsvector
  ),
  tsq AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL
                ELSE string_agg(plainto_tsquery('english', w)::text, ' | ')::tsquery
           END AS tsq,
           count(*) AS n_terms
      FROM terms
  ),
  docs AS (
    SELECT g.id, g.slug, g.title,
           coalesce(g.summary, '') AS summary,
           -- the snippet's source: step titles first (they are the headings a
           -- reader scans), then every other string.
           btrim(public.bp_guide_step_titles(g.blocks) || ' ' || public.bp_guide_text(g.blocks)) AS body,
           lower(g.title || ' ' || coalesce(g.summary, '') || ' ' ||
                 public.bp_guide_step_titles(g.blocks)) AS head,
           lower(public.bp_guide_text(g.blocks)) AS tail,
           g.search_tsv,
           ts_filter(g.search_tsv, '{a,b}') AS head_tsv,
           ts_filter(g.search_tsv, '{c}') AS tail_tsv
      FROM public.guide_sections g
  ),
  per_term AS (
    SELECT d.id,
           greatest(
             CASE WHEN d.head_tsv @@ plainto_tsquery('english', t.w) THEN 1.0 ELSE 0 END,
             CASE WHEN d.tail_tsv @@ plainto_tsquery('english', t.w) THEN 0.6 ELSE 0 END,
             CASE WHEN extensions.word_similarity(t.w, d.head)
                       >= CASE WHEN length(t.w) >= 7 THEN 0.45 ELSE 0.6 END
                  THEN extensions.word_similarity(t.w, d.head) ELSE 0 END,
             CASE WHEN extensions.word_similarity(t.w, d.tail)
                       >= CASE WHEN length(t.w) >= 7 THEN 0.45 ELSE 0.6 END
                  THEN 0.6 * extensions.word_similarity(t.w, d.tail) ELSE 0 END
           ) AS score
      FROM docs d CROSS JOIN terms t
  ),
  agg AS (
    SELECT p.id,
           count(*) FILTER (WHERE p.score > 0) AS matched,
           avg(p.score) AS term_score
      FROM per_term p
     GROUP BY p.id
  )
  SELECT d.id, d.slug, d.title,
         (a.term_score
          + 0.5 * a.matched::real / greatest(x.n_terms, 1)
          + 0.1 * coalesce(ts_rank_cd('{0.1, 0.2, 0.5, 1.0}', d.search_tsv, x.tsq, 1), 0)
         )::real AS rank,
         -- «» mark the matched words; the page renders them as <mark>, never as HTML.
         ts_headline('english',
                     CASE WHEN d.summary <> '' THEN d.summary || ' — ' ELSE '' END || d.body,
                     coalesce(x.tsq, to_tsquery('english', 'zzzz')),
                     'StartSel=«, StopSel=», MaxWords=22, MinWords=10, ShortWord=2, MaxFragments=1') AS snippet
    FROM docs d
    JOIN agg a ON a.id = d.id
    CROSS JOIN tsq x
   WHERE a.matched > 0
   ORDER BY rank DESC, d.id
   LIMIT 20;
$function$;

REVOKE ALL ON FUNCTION public.bp_search_guide(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_search_guide(text) TO authenticated, service_role;
