-- ===========================================================================
-- fix-657 (P-342) — What's New becomes a Tips-style guide
-- ===========================================================================
--
-- Bobby, 2026-10-12, looking at 55 entries in one flat list of paragraphs:
--   "like a highlevel summary of what the TIP is, then you click it for more
--    info, and details of how to use it if so. think of apples tip app"
--   "a categorical function to this, and a smart search, so if someone wants
--    to know how to do something ... the words do not need to be 1:1"
--
-- ★★★ NO EXISTING ROW IS WRITTEN. Four NULLABLE columns with NO default, so
--     every one of the 55 entries reads exactly as before until someone fills
--     them in. The page falls back to the first sentence of `body` when
--     `summary` is empty — at display time, never by writing it back.
--
-- ★★ THE ONE WRITE: the area list, seeded once into app_config
--    (`whatsNewAreas`, carrying tenant_id like every other list there). It is a
--    list rather than a CHECK so it can grow without a migration; the editor
--    offers it as a select. ON CONFLICT DO NOTHING — re-running never resets a
--    list somebody has since edited.
--
-- ★★ THE SEARCH (bp_search_whats_new). "The words do not need to be 1:1", so
--    three things are scored per query word and the entry keeps the best:
--      · English full-text (stemming: "deleted" finds "deleting") — a hit in
--        the title / summary / keywords counts 1.0, in the how-to or body 0.6;
--      · pg_trgm word similarity for typos ("corectons" → corrections at 0.47),
--        with a looser bar for long words (≥ 7 letters: 0.45) than short ones
--        (0.6), because a short word near-matches everything;
--      · keywords ARE the synonyms — whoever writes an entry lists the words
--        people would search ("deadline", "video"), and they score like the
--        title does.
--    Rank = average word score + half the share of query words matched + a
--    small full-text tie-break. Stop-words ("how do I") are dropped first.
--    Measured on prod 2026-10-12 with today's text (no summaries or keywords
--    yet), every fixture in the brief finds its entry at or near the top.
--
-- ★ SECURITY INVOKER: it reads whats_new_entries through the caller's own RLS
--   (tenant SELECT policy), so it can never show another tenant's entries.
--   anon gets nothing (fix-157's posture).
-- ===========================================================================

ALTER TABLE public.whats_new_entries
  ADD COLUMN IF NOT EXISTS summary   text,
  ADD COLUMN IF NOT EXISTS area      text,
  ADD COLUMN IF NOT EXISTS keywords  text[],
  ADD COLUMN IF NOT EXISTS media_url text;

-- One line — the editor counts to 120 and warns; the database only refuses
-- something that is plainly not one line.
ALTER TABLE public.whats_new_entries
  DROP CONSTRAINT IF EXISTS whats_new_entries_summary_one_line;
ALTER TABLE public.whats_new_entries
  ADD CONSTRAINT whats_new_entries_summary_one_line
  CHECK (summary IS NULL OR (char_length(summary) <= 200 AND position(E'\n' IN summary) = 0));

-- ★★ A screenshot or GIF: an https URL, or an app path under the same rule as
--    go_href (one leading slash, no backslash — `//evil.com` is not a path).
ALTER TABLE public.whats_new_entries
  DROP CONSTRAINT IF EXISTS whats_new_entries_media_url_safe;
ALTER TABLE public.whats_new_entries
  ADD CONSTRAINT whats_new_entries_media_url_safe
  CHECK (
    media_url IS NULL
    OR (media_url ~ '^https://[^\s]+$')
    OR (media_url ~ '^/($|[^/\\])' AND position('\' IN media_url) = 0)
  );

-- The one data write: the area list.
INSERT INTO public.app_config (key, value, tenant_id)
SELECT 'whatsNewAreas',
       '["Projects", "Project Overview", "Permits & Reviews", "Corrections",
         "Chat & Notifications", "Draw Schedule", "My Tasks & Board", "Reports",
         "Library", "Settings", "Email"]'::jsonb,
       t.tenant_id
  FROM (SELECT DISTINCT tenant_id FROM public.whats_new_entries) t
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bp_search_whats_new(q text)
RETURNS TABLE (id uuid, rank real, snippet text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
  WITH input AS (
    SELECT lower(btrim(coalesce(q, ''))) AS q
  ),
  terms AS (
    -- Query words, minus English stop-words (a word whose tsvector is empty).
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
    SELECT e.id,
           coalesce(e.summary, '') AS summary,
           e.body,
           lower(e.title || ' ' || coalesce(e.summary, '') || ' ' ||
                 coalesce(array_to_string(e.keywords, ' '), '')) AS head,
           lower(coalesce(e.how_to, '') || ' ' || e.body) AS tail,
           setweight(to_tsvector('english', e.title), 'A') ||
           setweight(to_tsvector('english', coalesce(e.summary, '')), 'A') ||
           setweight(to_tsvector('english', coalesce(array_to_string(e.keywords, ' '), '')), 'B') AS head_tsv,
           setweight(to_tsvector('english', coalesce(e.how_to, '')), 'C') ||
           setweight(to_tsvector('english', e.body), 'D') AS tail_tsv
      FROM public.whats_new_entries e
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
  SELECT d.id,
         (a.term_score
          + 0.5 * a.matched::real / greatest(x.n_terms, 1)
          + 0.1 * coalesce(ts_rank_cd('{0.1, 0.2, 0.5, 1.0}', d.head_tsv || d.tail_tsv, x.tsq, 1), 0)
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
   LIMIT 30;
$function$;

REVOKE ALL ON FUNCTION public.bp_search_whats_new(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_search_whats_new(text) TO authenticated, service_role;
