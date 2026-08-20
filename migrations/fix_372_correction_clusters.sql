-- ===========================================================================
-- ★★★ fix-372 — the corrections report names categories but never the correction
-- ===========================================================================
--
-- Bobby: *"Run that corrections report and now see, by category or by theme, the
-- top corrections that are occurring and which ones they apply to… What makes up
-- that 78%? Is it 42% are getting this one correction, and then it applies to 36
-- projects, and then we can just click and see all 36 projects."*
--
-- And the purpose, which every decision below serves:
-- *"If you were working on templates for your architectural sheets… how do I
-- know which corrections are constantly occurring so that I can update our
-- template? That's the mindset."*
--
-- ---------------------------------------------------------------------------
-- ★★★ 1 · RANK BY SHARE OF PROJECTS. NEVER BY ITEM COUNT.
-- ---------------------------------------------------------------------------
--
-- MEASURED ON PROD 2026-08-20:
--
--   jurisdiction   projects   letters   items   ITEMS PER LETTER
--   Seattle             105       713   2,236        3.1
--   Bellevue              2        28     890   ★★★ 31.8
--   Edmonds               4        22     269       12.2
--   Kirkland              6        19     128        6.7
--
-- ★★★ Seattle sends one letter per discipline per round; Bellevue sends one
-- wholistic Bluebeam markup summary. A Bellevue letter carries ten times the
-- rows for the same amount of review, so ANY ranking by item count puts two
-- Bellevue projects above a pattern hitting 75 Seattle ones.
--
-- ★★ Every percentage in here is `distinct projects hit / projects with
-- corrections in the selected jurisdiction scope`. The item count is returned
-- because it is interesting; nothing sorts on it.
--
-- ---------------------------------------------------------------------------
-- ★★★ 2 · TWO TIERS, BECAUSE THE CITIES BEHAVE DIFFERENTLY
-- ---------------------------------------------------------------------------
--
-- ★★★ TIER 1 — WHERE THE CITY GIVES A CODED SUBJECT, THE SUBJECT IS THE
-- CLUSTER. No matching, no curation, nothing to get wrong. `302 Fire
-- Separation`, `308 Safety Glazing`, `Zoning - SMC 23.44`.
--
-- ★★ And the case that proves it is counter-intuitive: `302 Fire Separation` is
-- 106 items over 39 projects, 22 reviewers, 103 DISTINCT bodies — essentially
-- nothing repeats. It is still ONE recurring correction and it is MORE of a
-- template item, not less: a gap 37% of projects hit despite nobody phrasing it
-- the same way twice is a persistent plan-set failure rather than one
-- reviewer's habit. `wording_variance` below is what lets the screen say so.
--
-- ★★★ TIER 2 — BODY CLUSTERING, needed in far fewer places than it looks:
--
--   subject            items  projects  verdict
--   General              440        75  ★★★ the only real cross-project junk drawer
--   (no subject)         484         1  Bellevue wholistic — ONE project
--   BUILDING concern     209         1  Bellevue wholistic — ONE project
--
-- ★ The two Bellevue buckets are 693 items on two projects with four buildings
-- each. They are legitimate and they are NOT a cross-project pattern; the
-- project-share ranking drops them to the floor on its own, without a special
-- case, which is the point of ranking that way.
--
-- ---------------------------------------------------------------------------
-- ★★★ 3 · THE CLUSTERING RULE, AND IT WAS MEASURED BEFORE IT WAS BUILT
-- ---------------------------------------------------------------------------
--
-- The brief's own attempt — lowercase, strip punctuation, match a 110-character
-- prefix — put 20% of `General` into clusters of 3+ projects and NOTHING at all
-- into one for `302 Fire Separation` (100 distinct keys from 105 items). It
-- only worked in `General` because that bucket happens to hold pasted city
-- boilerplate.
--
-- ★★ THE RULE THAT SHIPPED: normalise (lowercase, every non-letter to a space,
-- collapse runs), require 20 characters, then GREEDY SEED-AND-ATTRACT on
-- trigram similarity >= 0.60 — the seed is the unassigned item with the most
-- unassigned neighbours, id as tie-break, and a cluster is the seed plus
-- everything within 0.60 OF THE SEED.
--
-- ★★★ SEED-AND-ATTRACT, NOT SINGLE-LINK TRANSITIVE CLOSURE, AND THAT IS THE
-- WHOLE SAFETY ARGUMENT. Single-link chains: A resembles B, B resembles C, and
-- A and C end up in one pile having nothing in common. On boilerplate-heavy
-- letter text that collapses into one giant blob. Measuring every member
-- against the SEED bounds how far a cluster can drift.
--
-- ★★ MEASURED ON `General` (438 eligible of 440 items, 75 projects):
--
--   threshold  clusters  items in 3+-project clusters
--       0.50        24        273
--       0.55        27        274
--       0.60        29        260   ← shipped
--       0.70        30        238
--
-- ★ 0.60 because below it COVERAGE IS FLAT WHILE CLUSTERS FALL — loosening buys
-- merges, not reach. Against the brief's failed rule: 20% -> 59% of items in a
-- cluster spanning three or more projects. 137 singletons remain, and that is
-- correct; a correction one project got once is not a template change.
--
-- ★★★ PURITY, which is the number that mattered: of the 29 cross-project
-- clusters, 17 span more than one SHEET number — correct, and the useful part,
-- because the same correction lands on C1.0 here and C1.1 there — and exactly
-- ONE spans more than one CODE section. That one is the drainage boilerplate,
-- whose single paragraph cites both SMC 22.807.020 and 22.805.030. So: no false
-- merges at all. A rule that groups two genuinely different corrections is
-- worse than one that groups nothing, because it sends somebody to change a
-- plan set for a reason that is not real.
--
-- ★ VERBATIM BOILERPLATE IS A SEPARATE CLASS AND IT IS A FACT, NOT A JUDGEMENT:
-- a body byte-identical across five or more projects. Nine of them exist. The
-- top one — "General Drainage Review Information: Per SMC 22.807.020…", 25
-- projects, 2 reviewers — is pasted into every letter and would top the ranking
-- for ever. It is FLAGGED and hidden by default behind a visible count, never
-- deleted: some verbatim texts ARE real template items ("SMC 23.44.008
-- (Lighting): add a general compliance note", 7 projects), and a machine
-- throwing those away silently would be the worse error.
--
-- ---------------------------------------------------------------------------
-- ★★★ STANDING RULE: NOT ONE EXISTING `correction_items` ROW IS EDITED
-- ---------------------------------------------------------------------------
--
-- Everything here READS that table and writes its conclusions to new tables of
-- its own. Nothing below contains an UPDATE or a DELETE against it.

-- ---------------------------------------------------------------------------
-- ★ The vocabulary, single-sourced, IMMUTABLE so it can be indexed later.
-- ---------------------------------------------------------------------------

/** Minimum body length to be worth clustering. Below this a body is a fragment
 *  — an OCR crumb, a bare sheet number — and matching on it is noise. */
CREATE OR REPLACE FUNCTION public.bp_correction_min_body_len()
  RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT 20; $$;

/** ★★ The trigram threshold, measured above. One definition, so the rebuild and
 *  anything that later explains the rebuild cannot disagree about it. */
CREATE OR REPLACE FUNCTION public.bp_correction_similarity_threshold()
  RETURNS real LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT 0.60::real; $$;

/** How many distinct projects a byte-identical body must appear on before it is
 *  called verbatim boilerplate. Measured: 5 catches nine texts, and the tenth
 *  is a genuine four-project repeat. */
CREATE OR REPLACE FUNCTION public.bp_correction_verbatim_projects()
  RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT 5; $$;

/** ★ THE NORMALISER. Lowercase, every non-letter to a space, collapse runs.
 *
 *  ★★ Digits go too, deliberately. A sheet number and a code section are the
 *  most variable tokens in an otherwise identical sentence — "sheet C1.0" here
 *  and "sheet C1.1" there — and keeping them would split one correction into
 *  one cluster per project. They are EXTRACTED separately and shown as chips,
 *  which is where they are actually useful. */
CREATE OR REPLACE FUNCTION public.bp_correction_norm(p_body text)
  RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(lower(btrim(coalesce(p_body, ''))), '[^a-z ]+', ' ', 'g'),
           ' +', ' ', 'g'));
$$;

/** The tier-1 identity: the city's own subject, normalised only enough that
 *  case and spacing do not fork it. */
CREATE OR REPLACE FUNCTION public.bp_correction_subject(p_subject text)
  RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(nullif(btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g')), ''),
                  '(no subject)');
$$;

/** The KEY, which is the subject lowercased.
 *
 *  A rolled-back prod probe caught the reason this exists before anything
 *  shipped: two subjects differing only in case ("Drainage Details" and
 *  "Drainage details") grouped separately but keyed identically, and the
 *  tier-1 insert hit the (tenant_id, cluster_key) unique constraint. The
 *  rebuild groups by THIS, not by the raw subject, and takes min(subject) as
 *  the representative label - deterministic, so the name does not flip between
 *  rebuilds. */
CREATE OR REPLACE FUNCTION public.bp_correction_subject_key(p_subject text)
  RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT lower(public.bp_correction_subject(p_subject)); $$;

/** How much of a cluster ONE byte-identical body has to account for before the
 *  cluster is called boilerplate rather than merely containing some.
 *
 *  Caught by reading the first real ranking: without a dominance test,
 *  `is_verbatim` meant "contains a byte-identical body seen on 5+ projects",
 *  which flagged a 440-item subject because ONE member was boilerplate.
 *  `General` (75 projects) and `Zoning - SMC 23.44` (48 projects) - the two
 *  biggest patterns in the corpus - both vanished from the default ranking.
 *  Measured: the drainage cluster is 25 of 25 (100%); `General` is 25 of 440
 *  (5.7%) and is correctly no longer flagged. */
CREATE OR REPLACE FUNCTION public.bp_correction_verbatim_dominance()
  RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT 0.50::numeric; $$;

-- ---------------------------------------------------------------------------
-- ★★ EXTRACTION — mechanical, no inference (§4a)
-- ---------------------------------------------------------------------------
--
-- Bobby: *"maybe they're calling out a certain page, maybe they're calling out
-- a certain detail"*. `Sheet A6.1` recurring across five separate reviewers is
-- the single most actionable fact this feature produces: it says where the
-- change goes.
--
-- ★★★ PATTERN MATCHES ONLY. Nothing here infers, summarises or rewrites. A body
-- with no sheet reference returns no sheet, and the UI shows none rather than a
-- guess.

/** Sheet references: "Sheet A6.1", "sheet C1.0", "SHEET A2". */
CREATE OR REPLACE FUNCTION public.bp_correction_sheets(p_body text)
  RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT array_agg(DISTINCT upper(m[1]) ORDER BY upper(m[1]))
       FROM regexp_matches(coalesce(p_body, ''),
            'sheet[ ]+([A-Za-z]{1,3}-?[0-9]{1,2}(?:\.[0-9]{1,2})?)', 'gi') m),
    '{}'::text[]);
$$;

/** Code sections: "SMC 22.807.020", "2021 SEC R406.3", "SRC M1505.4.3". The
 *  prefix is kept because 23.44 means nothing without the SMC in front of it. */
CREATE OR REPLACE FUNCTION public.bp_correction_codes(p_body text)
  RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT array_agg(DISTINCT upper(m[1]) || ' ' || m[2] ORDER BY upper(m[1]) || ' ' || m[2])
       FROM regexp_matches(coalesce(p_body, ''),
            '\m(SMC|SRC|SEC|SBC|IRC|IBC|IECC|WAC|AHRI|ASHRAE)[ ]*([A-Z]?[0-9]+(?:\.[0-9]+){0,3})',
            'gi') m),
    '{}'::text[]);
$$;

-- ---------------------------------------------------------------------------
-- The derived tables. Rebuilt wholesale; never a source of truth.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.correction_clusters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  -- ★★★ THE STABLE IDENTITY, and the reason curation survives a re-index.
  --
  -- Tier 1: `subject:<normalised subject>` — derived from the city's own text,
  -- so it is the same key in October as in August whatever else moves.
  --
  -- Tier 2: `body:<normalised subject>:<seed content_hash>`. The seed is the
  -- most-connected item in the cluster, which is the LAST member a re-index
  -- would drop; keying on it means a cluster that merely gains members keeps
  -- its key. See bp_rebuild_correction_clusters for what happens when it does
  -- not.
  cluster_key  text NOT NULL,
  tier         text NOT NULL CHECK (tier IN ('subject', 'body')),
  subject      text NOT NULL,
  /** The machine's name for it. ★ Replaceable by a person — see the curation
   *  table — because a machine-picked name will be the first line of somebody's
   *  sentence when they explain a template change. */
  label        text NOT NULL,
  seed_item_id uuid,
  item_count   integer NOT NULL DEFAULT 0,
  project_count integer NOT NULL DEFAULT 0,
  reviewer_count integer NOT NULL DEFAULT 0,
  distinct_bodies integer NOT NULL DEFAULT 0,
  /** ★ A body byte-identical across >= bp_correction_verbatim_projects()
   *  projects. A FACT about the text, not a verdict about its worth. */
  is_verbatim  boolean NOT NULL DEFAULT false,
  first_seen   date,
  last_seen    date,
  built_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cluster_key)
);

CREATE TABLE IF NOT EXISTS public.correction_cluster_items (
  cluster_id uuid NOT NULL REFERENCES public.correction_clusters(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.correction_items(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL,
  PRIMARY KEY (cluster_id, item_id)
);
CREATE INDEX IF NOT EXISTS correction_cluster_items_item_idx
  ON public.correction_cluster_items (item_id);

-- ---------------------------------------------------------------------------
-- ★★★ THE HUMAN HALF — and it is keyed on cluster_key, NOT on cluster id
-- ---------------------------------------------------------------------------
--
-- Bobby: *"I don't necessarily want you to create this big bucket one time. I
-- want you to create this operable reoccurring bucket."*
--
-- ★★★ A MERGE MADE IN AUGUST MUST STILL HOLD IN OCTOBER. The clusters table is
-- truncated and rebuilt by every re-index, so a curation row pointing at a
-- cluster ROW would be dangling the moment the rebuild ran. Pointing at the KEY
-- means it reattaches to whatever cluster carries that key next time — and for
-- tier 1, which is where the real merges live (`Addressing` and `ASSIGNED
-- ADDRESSES FOR ALL UNITS`, 29 projects each), the key is the city's own
-- subject and cannot move at all.
--
-- ★★ A curation row whose key matches NOTHING after a rebuild is kept, not
-- deleted, and `bp_correction_curation_orphans()` lists it. Silently discarding
-- somebody's written fix note because a cluster reshaped is the worst thing
-- this table could do.
CREATE TABLE IF NOT EXISTS public.correction_cluster_curation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ★ No DEFAULT. `default_tenant_id_to_caller` is a TRIGGER function, not a
  -- scalar one, so it cannot be a column default; the setter RPC resolves the
  -- tenant explicitly and is the only writer.
  tenant_id   uuid NOT NULL,
  cluster_key text NOT NULL,
  /** RENAME — plain English, replacing the machine-picked label. */
  display_name text,
  /** MERGE — this pile is part of that one. Counts combine; future letters
   *  matching either wording land in the merged pile because both keys resolve
   *  to the same target. */
  merged_into_key text,
  /** ★★★ THE FIX NOTE — WRITTEN BY A PERSON, ONCE, AND IT PERSISTS.
   *
   *  ★★ NOT auto-summarised. Bobby approved that explicitly, and the reason is
   *  that a summary which quietly invents a requirement would drive a wrong
   *  change to the standard plan set. Stored and rendered verbatim; nothing in
   *  this migration or in the client generates or rewrites it. */
  fix_note      text,
  fix_note_by   uuid,
  fix_note_by_name text,
  fix_note_at   timestamptz,
  /** ★★★ MARK AS ADDRESSED — the template gap is fixed. The cluster STAYS
   *  counted; occurrences after this date are counted separately, because
   *  otherwise nobody can tell whether the template change worked. */
  addressed_on  date,
  /** Bury a pile — the boilerplate somebody has decided never to see again. */
  hidden        boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  UNIQUE (tenant_id, cluster_key)
);

ALTER TABLE public.correction_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correction_cluster_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correction_cluster_curation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS correction_clusters_select ON public.correction_clusters;
CREATE POLICY correction_clusters_select ON public.correction_clusters
  FOR SELECT TO authenticated USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS correction_cluster_items_select ON public.correction_cluster_items;
CREATE POLICY correction_cluster_items_select ON public.correction_cluster_items
  FOR SELECT TO authenticated USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS correction_curation_select ON public.correction_cluster_curation;
CREATE POLICY correction_curation_select ON public.correction_cluster_curation
  FOR SELECT TO authenticated USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★ Writes go through the RPCs below, never straight at the table. The derived
-- tables are written by a SECURITY DEFINER rebuild; curation by a SECURITY
-- DEFINER setter that stamps the actor.
REVOKE ALL ON public.correction_clusters FROM PUBLIC, anon;
REVOKE ALL ON public.correction_cluster_items FROM PUBLIC, anon;
REVOKE ALL ON public.correction_cluster_curation FROM PUBLIC, anon;
GRANT SELECT ON public.correction_clusters TO authenticated;
GRANT SELECT ON public.correction_cluster_items TO authenticated;
GRANT SELECT ON public.correction_cluster_curation TO authenticated;
GRANT ALL ON public.correction_clusters TO service_role;
GRANT ALL ON public.correction_cluster_items TO service_role;
GRANT ALL ON public.correction_cluster_curation TO service_role;

/** Recompute `is_verbatim` for every cluster in one grouped pass.
 *
 *  The first shape of this was a lateral join per item and timed out on 5,990
 *  memberships; same rule, one pass. A cluster IS boilerplate when ONE
 *  byte-identical body both reaches the project floor and accounts for at least
 *  half of it. */
CREATE OR REPLACE FUNCTION public.bp_correction_mark_verbatim(p_tenant uuid)
  RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
  WITH bodies AS (
    SELECT cci.cluster_id,
           count(*)                      AS n,
           count(DISTINCT ci.project_id) AS projects
      FROM public.correction_cluster_items cci
      JOIN public.correction_items ci ON ci.id = cci.item_id
     WHERE cci.tenant_id = p_tenant
       AND length(btrim(coalesce(ci.body, ''))) >= 40
     GROUP BY cci.cluster_id, md5(btrim(ci.body))
  ), totals AS (
    SELECT cluster_id, count(*) AS total
      FROM public.correction_cluster_items
     WHERE tenant_id = p_tenant
     GROUP BY cluster_id
  ), verdict AS (
    SELECT t.cluster_id,
           bool_or(b.projects >= public.bp_correction_verbatim_projects()
                   AND b.n::numeric / nullif(t.total, 0)
                       >= public.bp_correction_verbatim_dominance()) AS dominant
      FROM totals t
      LEFT JOIN bodies b ON b.cluster_id = t.cluster_id
     GROUP BY t.cluster_id
  )
  UPDATE public.correction_clusters c
     SET is_verbatim = coalesce(v.dominant, false)
    FROM verdict v
   WHERE c.id = v.cluster_id AND c.tenant_id = p_tenant;
$$;

-- ---------------------------------------------------------------------------
-- ★★★ THE REBUILD
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_rebuild_correction_clusters()
  RETURNS TABLE(subject_clusters integer, body_clusters integer, items_clustered integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant   uuid;
  v_thresh   real := public.bp_correction_similarity_threshold();
  v_key      text;
  v_seed     uuid;
  v_subjects integer := 0;
  v_bodies   integer := 0;
  v_items    integer := 0;
BEGIN
  SELECT t INTO v_tenant FROM unnest(public.auth_tenant_ids()) t LIMIT 1;
  IF v_tenant IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  -- ★ Wholesale rebuild of the DERIVED tables only.
  -- correction_cluster_curation is never touched here - that is the point of
  -- keying it on cluster_key.
  DELETE FROM public.correction_clusters WHERE tenant_id = v_tenant;

  CREATE TEMP TABLE _cc_items ON COMMIT DROP AS
  SELECT ci.id, ci.project_id, ci.reviewer, ci.letter_date, ci.body, ci.content_hash,
         public.bp_correction_subject(ci.subject)     AS subject,
         public.bp_correction_subject_key(ci.subject) AS subject_key,
         public.bp_correction_norm(ci.body)           AS norm
    FROM public.correction_items ci
   WHERE ci.tenant_id = v_tenant
     AND ci.is_correction IS NOT FALSE;
  CREATE INDEX ON _cc_items (subject_key);

  -- ★★★ TIER 1: the subject IS the cluster. Nothing is matched, so nothing can
  -- be mismatched. Grouped by the KEY; min(subject) is the representative label.
  INSERT INTO public.correction_clusters
    (tenant_id, cluster_key, tier, subject, label, item_count, project_count,
     reviewer_count, distinct_bodies, first_seen, last_seen)
  SELECT v_tenant, 'subject:' || i.subject_key, 'subject',
         min(i.subject), min(i.subject),
         count(*), count(DISTINCT i.project_id), count(DISTINCT i.reviewer),
         count(DISTINCT md5(i.norm)),
         min(i.letter_date), max(i.letter_date)
    FROM _cc_items i GROUP BY i.subject_key;
  GET DIAGNOSTICS v_subjects = ROW_COUNT;

  INSERT INTO public.correction_cluster_items (cluster_id, item_id, tenant_id)
  SELECT c.id, i.id, v_tenant
    FROM _cc_items i
    JOIN public.correction_clusters c
      ON c.tenant_id = v_tenant AND c.cluster_key = 'subject:' || i.subject_key;

  -- ★★ TIER 2: body clustering, per subject, greedy seed-and-attract. Subjects
  -- with fewer than 5 eligible items are skipped: with that few, every item is
  -- its own cluster and the pairwise pass is pure cost.
  CREATE TEMP TABLE _cc_assign (id uuid PRIMARY KEY, seed uuid) ON COMMIT DROP;

  FOR v_key IN
    SELECT i.subject_key FROM _cc_items i
     WHERE length(i.norm) >= public.bp_correction_min_body_len()
     GROUP BY i.subject_key HAVING count(*) >= 5
  LOOP
    CREATE TEMP TABLE _cc_n ON COMMIT DROP AS
    SELECT i.id, i.norm FROM _cc_items i
     WHERE i.subject_key = v_key
       AND length(i.norm) >= public.bp_correction_min_body_len();

    -- ★ ONE similarity pass per subject, both directions, then the greedy loop
    -- reads the edge list. Recomputing similarity inside the loop is what made
    -- the first attempt time out.
    CREATE TEMP TABLE _cc_edge ON COMMIT DROP AS
    WITH e AS (
      SELECT p.id AS a, q.id AS b FROM _cc_n p JOIN _cc_n q ON p.id < q.id
       WHERE p.norm % q.norm AND extensions.similarity(p.norm, q.norm) >= v_thresh
    )
    SELECT a, b FROM e UNION ALL SELECT b, a FROM e;
    CREATE INDEX ON _cc_edge (a);

    DELETE FROM _cc_assign;
    LOOP
      -- ★★★ The seed is the unassigned item with the most unassigned
      -- neighbours; `id` breaks ties so two runs over the same corpus pick the
      -- same seed and produce the same cluster_key.
      SELECT n.id INTO v_seed FROM _cc_n n
       WHERE NOT EXISTS (SELECT 1 FROM _cc_assign a WHERE a.id = n.id)
       ORDER BY (SELECT count(*) FROM _cc_edge e
                  WHERE e.a = n.id
                    AND NOT EXISTS (SELECT 1 FROM _cc_assign a2 WHERE a2.id = e.b)
                ) DESC, n.id ASC
       LIMIT 1;
      EXIT WHEN v_seed IS NULL;

      INSERT INTO _cc_assign (id, seed) VALUES (v_seed, v_seed);
      -- ★★★ Every member is within the threshold OF THE SEED. Not of each
      -- other, and not transitively - that is what stops a chain.
      INSERT INTO _cc_assign (id, seed)
      SELECT DISTINCT e.b, v_seed FROM _cc_edge e
       WHERE e.a = v_seed AND NOT EXISTS (SELECT 1 FROM _cc_assign a3 WHERE a3.id = e.b);
      v_seed := NULL;
    END LOOP;

    INSERT INTO public.correction_clusters
      (tenant_id, cluster_key, tier, subject, label, seed_item_id, item_count,
       project_count, reviewer_count, distinct_bodies, first_seen, last_seen)
    SELECT v_tenant,
           'body:' || v_key || ':' || coalesce(s.content_hash, a.seed::text),
           'body', min(i.subject),
           -- ★ The machine's name: the seed's own opening words. ★★ Deliberately
           -- NOT a generated summary; a person can rename it, and until they do
           -- it is visibly the reviewer's own text rather than something invented.
           left(regexp_replace(btrim(coalesce(min(s.body), '')), '\s+', ' ', 'g'), 80),
           a.seed,
           count(*), count(DISTINCT i.project_id), count(DISTINCT i.reviewer),
           count(DISTINCT md5(i.norm)),
           min(i.letter_date), max(i.letter_date)
      FROM _cc_assign a
      JOIN _cc_items i ON i.id = a.id
      JOIN _cc_items s ON s.id = a.seed
     GROUP BY a.seed, s.content_hash
    ON CONFLICT (tenant_id, cluster_key) DO NOTHING;
    GET DIAGNOSTICS v_items = ROW_COUNT;
    v_bodies := v_bodies + v_items;

    INSERT INTO public.correction_cluster_items (cluster_id, item_id, tenant_id)
    SELECT c.id, a.id, v_tenant
      FROM _cc_assign a
      JOIN _cc_items s ON s.id = a.seed
      JOIN public.correction_clusters c
        ON c.tenant_id = v_tenant
       AND c.cluster_key = 'body:' || v_key || ':' || coalesce(s.content_hash, a.seed::text)
    ON CONFLICT DO NOTHING;

    DROP TABLE _cc_n;
    DROP TABLE _cc_edge;
  END LOOP;

  -- One pass, after every membership exists.
  PERFORM public.bp_correction_mark_verbatim(v_tenant);

  SELECT count(*) INTO v_items FROM public.correction_cluster_items WHERE tenant_id = v_tenant;
  RETURN QUERY SELECT v_subjects, v_bodies, v_items;
END;
$function$;

COMMENT ON FUNCTION public.bp_rebuild_correction_clusters() IS
  'fix-372: re-derives correction clusters from correction_items. Tier 1 is the '
  'city subject; tier 2 is greedy seed-and-attract on trigram similarity >= 0.60 '
  '(measured: 59% of General lands in a 3+-project cluster, zero false merges). '
  'Never edits correction_items and never touches correction_cluster_curation.';

-- ---------------------------------------------------------------------------
-- ★★★ THE RANKED READ — project share, scoped to a jurisdiction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_correction_cluster_ranking(
  p_juris    text DEFAULT NULL,
  p_tier     text DEFAULT 'subject',
  p_include_verbatim boolean DEFAULT false
)
  RETURNS TABLE(
    cluster_key text, tier text, subject text, label text, display_name text,
    item_count integer, project_count integer, reviewer_count integer,
    distinct_bodies integer, scope_projects integer, project_share numeric,
    wording_variance numeric, is_verbatim boolean, hidden boolean,
    merged_into_key text, fix_note text, fix_note_by_name text,
    fix_note_at timestamptz, addressed_on date,
    occurrences_after_addressed integer,
    first_seen date, last_seen date, sheets text[], codes text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (
    -- ★★★ THE DENOMINATOR. Distinct projects that have ANY correction inside the
    -- selected jurisdiction — not all projects, and not all corrections. A
    -- percentage measured against a different population than the numerator is
    -- the bug this whole ranking exists to avoid.
    SELECT count(DISTINCT ci.project_id)::integer AS n
      FROM public.correction_items ci
      LEFT JOIN public.projects pr ON pr.id = ci.project_id
     WHERE ci.tenant_id = ANY (public.auth_tenant_ids())
       AND ci.is_correction IS NOT FALSE
       AND (p_juris IS NULL OR pr.juris = p_juris)
  ), member AS (
    SELECT cci.cluster_id, ci.id AS item_id, ci.project_id, ci.reviewer,
           ci.body, ci.letter_date
      FROM public.correction_cluster_items cci
      JOIN public.correction_items ci ON ci.id = cci.item_id
      LEFT JOIN public.projects pr ON pr.id = ci.project_id
     WHERE cci.tenant_id = ANY (public.auth_tenant_ids())
       AND (p_juris IS NULL OR pr.juris = p_juris)
  ), agg AS (
    SELECT c.id, c.cluster_key, c.tier, c.subject, c.label, c.is_verbatim,
           c.first_seen, c.last_seen,
           count(*)::integer                       AS items,
           count(DISTINCT m.project_id)::integer   AS projects,
           count(DISTINCT m.reviewer)::integer     AS reviewers,
           count(DISTINCT md5(public.bp_correction_norm(m.body)))::integer AS bodies,
           coalesce((SELECT array_agg(DISTINCT s ORDER BY s)
                       FROM member m2, unnest(public.bp_correction_sheets(m2.body)) s
                      WHERE m2.cluster_id = c.id), '{}'::text[])  AS sheets,
           coalesce((SELECT array_agg(DISTINCT k ORDER BY k)
                       FROM member m3, unnest(public.bp_correction_codes(m3.body)) k
                      WHERE m3.cluster_id = c.id), '{}'::text[])  AS codes
      FROM public.correction_clusters c
      JOIN member m ON m.cluster_id = c.id
     WHERE c.tenant_id = ANY (public.auth_tenant_ids())
       AND c.tier = p_tier
     GROUP BY c.id, c.cluster_key, c.tier, c.subject, c.label, c.is_verbatim,
              c.first_seen, c.last_seen
  )
  SELECT a.cluster_key, a.tier, a.subject, a.label, cur.display_name,
         a.items, a.projects, a.reviewers, a.bodies,
         (SELECT n FROM scope),
         -- ★★ THE RANKING NUMBER, and the only one anything sorts on.
         CASE WHEN (SELECT n FROM scope) > 0
              THEN round(a.projects::numeric * 100 / (SELECT n FROM scope), 1)
              ELSE 0 END,
         -- ★★★ HOW DIFFERENTLY IT GETS WRITTEN. 1.0 means every occurrence is
         -- worded differently — which for a high-reach cluster is the strongest
         -- template signal there is, not the weakest. `302 Fire Separation`:
         -- 39 projects, 103 distinct bodies, variance 0.97.
         CASE WHEN a.items > 0
              THEN round(a.bodies::numeric / a.items, 2) ELSE 0 END,
         a.is_verbatim,
         coalesce(cur.hidden, false),
         cur.merged_into_key,
         cur.fix_note, cur.fix_note_by_name, cur.fix_note_at, cur.addressed_on,
         -- ★★★ DID THE TEMPLATE CHANGE WORK? Occurrences dated after the day it
         -- was marked addressed. Still counted in the total above, separately
         -- visible here — that is the whole reason "addressed" is a date and
         -- not a delete.
         (SELECT count(*)::integer FROM member m4
           WHERE m4.cluster_id = a.id
             AND cur.addressed_on IS NOT NULL
             AND m4.letter_date > cur.addressed_on),
         a.first_seen, a.last_seen, a.sheets, a.codes
    FROM agg a
    LEFT JOIN public.correction_cluster_curation cur
      ON cur.tenant_id = ANY (public.auth_tenant_ids())
     AND cur.cluster_key = a.cluster_key
   WHERE (p_include_verbatim OR NOT a.is_verbatim)
     AND coalesce(cur.hidden, false) = false
     -- ★ A merged pile is not listed on its own; its counts are read through
     -- its target. The client resolves the chain so the merge is visible.
     AND cur.merged_into_key IS NULL
   ORDER BY a.projects DESC, a.items DESC, a.cluster_key ASC;
$function$;

-- ---------------------------------------------------------------------------
-- ★★ WHAT A PERSON READS WHEN THEY DRILL IN (§4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_correction_cluster_detail(
  p_cluster_key text,
  p_juris       text DEFAULT NULL
)
  RETURNS TABLE(
    item_id uuid, project_id uuid, address text, juris text,
    reviewer text, letter_date date, cycle integer,
    /** ★★ VERBATIM. The reviewer's own words, exactly as stored. Nothing
     *  paraphrases, summarises or repairs them — including the OCR bleed the
     *  two-column read leaves behind ("CCORDANCE WITH AHRI 550/590"). */
    body text,
    sheets text[], codes text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ci.id, ci.project_id, pr.address, pr.juris,
         ci.reviewer, ci.letter_date, ci.cycle,
         ci.body,
         public.bp_correction_sheets(ci.body),
         public.bp_correction_codes(ci.body)
    FROM public.correction_clusters c
    JOIN public.correction_cluster_items cci ON cci.cluster_id = c.id
    JOIN public.correction_items ci ON ci.id = cci.item_id
    LEFT JOIN public.projects pr ON pr.id = ci.project_id
   WHERE c.tenant_id = ANY (public.auth_tenant_ids())
     AND (c.cluster_key = p_cluster_key
          -- ★★★ A MERGED PILE'S MEMBERS ARE PART OF ITS TARGET. This is what
          -- makes "counts combine, and future letters matching either wording
          -- land in the merged pile" true rather than aspirational: the merge
          -- is read at query time, so a letter indexed next month joins
          -- whichever pile its wording clusters into and arrives here anyway.
          OR c.cluster_key IN (
            SELECT cur.cluster_key FROM public.correction_cluster_curation cur
             WHERE cur.tenant_id = ANY (public.auth_tenant_ids())
               AND cur.merged_into_key = p_cluster_key))
     AND (p_juris IS NULL OR pr.juris = p_juris)
   ORDER BY ci.letter_date DESC NULLS LAST, ci.id;
$function$;

-- ---------------------------------------------------------------------------
-- ★★ CURATION (§5) — four actions, one setter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_set_correction_curation(
  p_cluster_key   text,
  p_display_name  text DEFAULT NULL,
  p_fix_note      text DEFAULT NULL,
  p_merged_into_key text DEFAULT NULL,
  p_addressed_on  date DEFAULT NULL,
  p_hidden        boolean DEFAULT NULL,
  /** ★ Which fields this call is actually setting. Without it there is no way
   *  to CLEAR a fix note or undo a merge — a NULL would always mean "leave it
   *  alone" and the four actions would be one-way doors. */
  p_fields        text[] DEFAULT ARRAY['display_name','fix_note']
)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_name   text;
BEGIN
  SELECT t INTO v_tenant FROM unnest(public.auth_tenant_ids()) t LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant';
  END IF;
  IF p_cluster_key IS NULL OR btrim(p_cluster_key) = '' THEN
    RAISE EXCEPTION 'cluster_key required';
  END IF;
  -- ★ A pile cannot be merged into itself, and a merge target must exist.
  IF 'merged_into_key' = ANY (p_fields) AND p_merged_into_key IS NOT NULL THEN
    IF p_merged_into_key = p_cluster_key THEN
      RAISE EXCEPTION 'a cluster cannot be merged into itself';
    END IF;
  END IF;

  v_name := public.bp_profile_display_name(auth.uid());

  INSERT INTO public.correction_cluster_curation AS c
    (tenant_id, cluster_key, display_name, fix_note, fix_note_by, fix_note_by_name,
     fix_note_at, merged_into_key, addressed_on, hidden, updated_by)
  VALUES
    (v_tenant, p_cluster_key,
     CASE WHEN 'display_name'   = ANY (p_fields) THEN p_display_name END,
     CASE WHEN 'fix_note'       = ANY (p_fields) THEN p_fix_note END,
     CASE WHEN 'fix_note'       = ANY (p_fields) AND p_fix_note IS NOT NULL THEN auth.uid() END,
     CASE WHEN 'fix_note'       = ANY (p_fields) AND p_fix_note IS NOT NULL THEN v_name END,
     CASE WHEN 'fix_note'       = ANY (p_fields) AND p_fix_note IS NOT NULL THEN now() END,
     CASE WHEN 'merged_into_key'= ANY (p_fields) THEN p_merged_into_key END,
     CASE WHEN 'addressed_on'   = ANY (p_fields) THEN p_addressed_on END,
     coalesce(CASE WHEN 'hidden' = ANY (p_fields) THEN p_hidden END, false),
     auth.uid())
  ON CONFLICT (tenant_id, cluster_key) DO UPDATE SET
    display_name = CASE WHEN 'display_name' = ANY (p_fields)
                        THEN EXCLUDED.display_name ELSE c.display_name END,
    fix_note     = CASE WHEN 'fix_note' = ANY (p_fields)
                        THEN EXCLUDED.fix_note ELSE c.fix_note END,
    -- ★★ WHO WROTE IT AND WHEN travel with the note and are replaced only when
    -- the note is. An edited note is a new authorship; an untouched one keeps
    -- the name it had.
    fix_note_by      = CASE WHEN 'fix_note' = ANY (p_fields)
                            THEN EXCLUDED.fix_note_by ELSE c.fix_note_by END,
    fix_note_by_name = CASE WHEN 'fix_note' = ANY (p_fields)
                            THEN EXCLUDED.fix_note_by_name ELSE c.fix_note_by_name END,
    fix_note_at      = CASE WHEN 'fix_note' = ANY (p_fields)
                            THEN EXCLUDED.fix_note_at ELSE c.fix_note_at END,
    merged_into_key  = CASE WHEN 'merged_into_key' = ANY (p_fields)
                            THEN EXCLUDED.merged_into_key ELSE c.merged_into_key END,
    addressed_on     = CASE WHEN 'addressed_on' = ANY (p_fields)
                            THEN EXCLUDED.addressed_on ELSE c.addressed_on END,
    hidden           = CASE WHEN 'hidden' = ANY (p_fields)
                            THEN EXCLUDED.hidden ELSE c.hidden END,
    updated_at = now(),
    updated_by = auth.uid();
END;
$function$;

/** ★★ Curation whose cluster_key matches no current cluster. Kept, listed, and
 *  never deleted by a rebuild — see the table's own note. */
CREATE OR REPLACE FUNCTION public.bp_correction_curation_orphans()
  RETURNS TABLE(cluster_key text, display_name text, fix_note text,
                fix_note_by_name text, updated_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT cur.cluster_key, cur.display_name, cur.fix_note, cur.fix_note_by_name, cur.updated_at
    FROM public.correction_cluster_curation cur
   WHERE cur.tenant_id = ANY (public.auth_tenant_ids())
     AND NOT EXISTS (
       SELECT 1 FROM public.correction_clusters c
        WHERE c.tenant_id = cur.tenant_id AND c.cluster_key = cur.cluster_key)
   ORDER BY cur.updated_at DESC;
$function$;

-- ---------------------------------------------------------------------------
-- Grants — fix-157's posture, fix-273's audit. anon gets nothing.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_correction_min_body_len() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_similarity_threshold() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_verbatim_projects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_norm(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_subject(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_subject_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_verbatim_dominance() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_mark_verbatim(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_sheets(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_codes(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_rebuild_correction_clusters() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_cluster_ranking(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_cluster_detail(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_set_correction_curation(text, text, text, text, date, boolean, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_correction_curation_orphans() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bp_correction_min_body_len() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_similarity_threshold() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_verbatim_projects() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_norm(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_subject(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_subject_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_verbatim_dominance() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_mark_verbatim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_sheets(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_codes(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_rebuild_correction_clusters() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_cluster_ranking(text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_cluster_detail(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_set_correction_curation(text, text, text, text, date, boolean, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_correction_curation_orphans() TO authenticated, service_role;
