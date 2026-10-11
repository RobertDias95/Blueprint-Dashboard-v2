-- fix-641 §B (P-337): "Footage folder" opens the project's OWN drone folder.
--
-- Bobby, 2026-10-11: *"when i clicked it, it did not open 10431, just opened
-- the wholisitic drone library. it should open the project address"* · *"the
-- drone footage folders are just the address… sometimes we put the city at
-- the end."*
--
-- 1. projects.drone_folder — nullable text, the folder's EXACT name inside the
--    shared "Drone Photos" folder (app_config droneFootageFolderUrl). The app
--    builds the link from the Settings URL + this name, so Blake's path is not
--    stored per project. Not editable in this ticket, so neither save RPC
--    learns it (fix-410's four-place rule: the useProjects select list is the
--    one read path, and it lists the column).
--
-- ⚠️ APPLY BEFORE THE FRONTEND DEPLOYS. useProjects lists its columns
--    explicitly; a build asking for a column the database lacks fails the
--    whole projects query. Additive, so applying first is safe.
--
-- 2. THE ONE-TIME SEED (approved by Bobby, 10-11) — 88 folder names read by
--    Cowork from Blake's OneDrive (Brain/reference/drone-photos-folders-
--    2026-10-11.txt). EXACT matches only, never fuzzy:
--      · a trailing " - <City>" is stripped from the folder name;
--      · "1301, 1303, 1307 6th Ave N" is one folder for each address on the
--        shared street (every leading element must be a bare house number);
--      · both sides are lower-cased, dots dropped, whitespace collapsed, and
--        street words / directions map to their USPS abbreviation
--        (Street→st, Avenue→ave, North→n, Northeast→ne …) token by token.
--    src/lib/siteLinks.ts (normaliseAddress / matchDroneFolders) is the
--    tested mirror of this rule.
--    ★ Writes only where drone_folder IS NULL — it never overwrites.
--    ★ projects_set_updated_at and bp_log_user_activity are suppressed
--      (fix-415): filling a link is not "a person edited this project", and
--      bumping updated_at would hand anyone with one open a false "modified
--      by someone else". projects_audit_row stays ON, so every write is
--      recorded.
--
-- Dry run on prod 2026-10-11: 62 of 88 folders matched → 72 projects (10
-- folders match two projects whose address is byte-identical); 26 matched
-- nothing; no project matched two folders.

BEGIN;

-- 1 ─ the column ───────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS drone_folder text;

COMMENT ON COLUMN public.projects.drone_folder IS
  'fix-641: exact name of this project''s folder inside the shared Drone Photos folder (app_config droneFootageFolderUrl). NULL = not matched; Site Data then opens the shared folder. drone_video_url, when set, wins.';

-- 2 ─ the seed ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.bp641_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT string_agg(
    CASE tok
      WHEN 'street' THEN 'st' WHEN 'avenue' THEN 'ave' WHEN 'av' THEN 'ave'
      WHEN 'place' THEN 'pl' WHEN 'drive' THEN 'dr' WHEN 'boulevard' THEN 'blvd'
      WHEN 'road' THEN 'rd' WHEN 'lane' THEN 'ln' WHEN 'court' THEN 'ct'
      WHEN 'terrace' THEN 'ter' WHEN 'parkway' THEN 'pkwy' WHEN 'circle' THEN 'cir'
      WHEN 'north' THEN 'n' WHEN 'south' THEN 's' WHEN 'east' THEN 'e' WHEN 'west' THEN 'w'
      WHEN 'northeast' THEN 'ne' WHEN 'northwest' THEN 'nw'
      WHEN 'southeast' THEN 'se' WHEN 'southwest' THEN 'sw'
      ELSE tok END, ' ' ORDER BY ord)
  FROM regexp_split_to_table(
         btrim(regexp_replace(replace(lower(coalesce(t, '')), '.', ''), '\s+', ' ', 'g')), ' ')
       WITH ORDINALITY AS s(tok, ord)
  WHERE tok <> ''
$f$;

CREATE TEMP TABLE bp641_folders (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO bp641_folders (name) VALUES
  ('10150 NE 64th St'),
  ('10431 SE 19th St - Bellevue'),
  ('11231 NE 67th St - Kirkland'),
  ('1142 N 77th St'),
  ('120 7th Ave - Kirkland'),
  ('1208 NW 77th St'),
  ('12238 4th Ave NW'),
  ('123 N 48th St'),
  ('12526 NE 80th St - Kirkland'),
  ('12822 NE 68th St - Kirkland'),
  ('12827 NE 80th St - Kirkland'),
  ('1301, 1303, 1307 6th Ave N'),
  ('1343 N 79th St'),
  ('1400 8th Ave W'),
  ('1513 19th Ave'),
  ('1515 Martin Luther King Jr Way'),
  ('1521 26th Ave S - Seattle'),
  ('1524 Martin Luther King Jr Way'),
  ('1602 41st Ave E'),
  ('1917 3rd Ave W'),
  ('1919 2nd Ave W'),
  ('1953 10th Ave W'),
  ('198 106th Ave SE - Bellevue'),
  ('2039 N 78th St'),
  ('2043 N 78th St'),
  ('220 N 58th St'),
  ('224 2nd Ave N'),
  ('2443 5th Ave W'),
  ('2450 3rd Ave W - Seattle'),
  ('2601 E Galer St'),
  ('2610 NW 62nd St'),
  ('2627 25th Ave W'),
  ('2822 NW 92nd St'),
  ('3004 NW 59th St - Seattle'),
  ('3021 NW 62nd St'),
  ('3046 NW 64th St'),
  ('3210 S Washington St - Seattle'),
  ('3244 NW 64th St'),
  ('3505 Densmore Ave N'),
  ('3522 Ashworth Ave N'),
  ('3617 Corliss Ave N - Seattle'),
  ('3626 164th Pl SE - Bellevue'),
  ('3670 Interlake Ave N'),
  ('370 Lynn St'),
  ('3819 33rd Ave W'),
  ('4017 Corliss Ave N'),
  ('403 W Dravus St'),
  ('4115 SW Elmgrove St'),
  ('4215 51st Ave S - Seattle'),
  ('4523 48th Ave NE'),
  ('4563 34th Ave W'),
  ('4611 34th Ave W - Seattle'),
  ('4707 S Graham St'),
  ('5003 NE 41st St - Seattle'),
  ('5107 S Hudson St'),
  ('516 13th Ave W - Kirkland'),
  ('5235 S Graham St'),
  ('548 3rd Ave N'),
  ('552 NE 89th St'),
  ('5537 35th Ave NE'),
  ('554 N 75th St - Seattle'),
  ('6006 105th Ave NE - Kirkland'),
  ('6027 4th Ave NE'),
  ('610 N 48th St'),
  ('611 3rd Ave N - Edmonds'),
  ('621 Daley St'),
  ('6340 4th Ave NE'),
  ('6533 52nd Ave S'),
  ('6605 57th Ave NE'),
  ('6712 14th Ave NW'),
  ('7017 20th Ave NW'),
  ('723 16th Ave W'),
  ('728 12th Ave E'),
  ('7315 Jones Ave NW'),
  ('7324 27th Ave NW'),
  ('733 N 78th St'),
  ('7336 132nd Ave NE - Redmond'),
  ('7508 126th Ave NE - Kirkland'),
  ('7603 8th Ave NW'),
  ('7708 131st Ave NE - Kirkland'),
  ('7708 44th Ave NE'),
  ('7730 17th Ave NE - Seattle'),
  ('7748 25th Ave NW'),
  ('8100 Stone Ave N'),
  ('8307 27th Ave NW'),
  ('910 11th Ave E - Seattle'),
  ('9100 Lake Washington Blvd NE - Bellevue'),
  ('9711 12th Ave NW')
;

CREATE TEMP TABLE bp641_hits ON COMMIT DROP AS
WITH f AS (
  SELECT name, regexp_replace(name, '\s+-\s+[A-Za-z .]+$', '') AS base FROM bp641_folders
), p AS (
  SELECT name, string_to_array(base, ',') AS arr FROM f
), expanded AS (
  SELECT p.name,
         CASE
           WHEN cardinality(p.arr) = 1 THEN btrim(p.arr[1])
           WHEN i < cardinality(p.arr) THEN btrim(p.arr[i]) || ' ' ||
                regexp_replace(btrim(p.arr[cardinality(p.arr)]), '^\d+\s+', '')
           ELSE btrim(p.arr[i])
         END AS addr
  FROM p, generate_subscripts(p.arr, 1) AS i
  WHERE cardinality(p.arr) = 1
     OR (btrim(p.arr[cardinality(p.arr)]) ~ '^\d+\s+\S'
         AND NOT EXISTS (SELECT 1 FROM generate_subscripts(p.arr, 1) j
                          WHERE j < cardinality(p.arr) AND btrim(p.arr[j]) !~ '^\d+$'))
)
SELECT e.name, pr.id AS project_id
FROM expanded e
JOIN public.projects pr ON pg_temp.bp641_norm(pr.address) = pg_temp.bp641_norm(e.addr);

-- ★ A project that matched two DIFFERENT folders is ambiguous: refuse rather
--   than pick one. (Measured zero on the dry run; this keeps it honest.)
DO $amb$
BEGIN
  IF EXISTS (SELECT 1 FROM bp641_hits GROUP BY project_id HAVING count(DISTINCT name) > 1) THEN
    RAISE EXCEPTION 'fix-641: a project matched two folders — refusing to guess';
  END IF;
END
$amb$;

ALTER TABLE public.projects DISABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects DISABLE TRIGGER bp_log_user_activity;

UPDATE public.projects pr
SET drone_folder = h.name
FROM bp641_hits h
WHERE h.project_id = pr.id
  AND pr.drone_folder IS NULL;

ALTER TABLE public.projects ENABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects ENABLE TRIGGER bp_log_user_activity;

-- 3 ─ verify ───────────────────────────────────────────────────────────────
DO $v$
DECLARE v_set int; v_hits int;
BEGIN
  SELECT count(*) INTO v_set FROM public.projects WHERE drone_folder IS NOT NULL;
  SELECT count(DISTINCT project_id) INTO v_hits FROM bp641_hits;
  IF v_set < v_hits THEN
    RAISE EXCEPTION 'fix-641: % matched projects but only % carry drone_folder', v_hits, v_set;
  END IF;
  RAISE NOTICE 'fix-641: % projects carry a drone_folder', v_set;
END
$v$;

COMMIT;
