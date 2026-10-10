-- fix-632 (P-328): a drone-video link on each project, and the shared
-- drone-footage folder as a Settings value.
--
-- ⚠️ APPLIED BEFORE THE FRONTEND DEPLOYS, ON PURPOSE. `useProjects` lists its
--    columns explicitly, and the new build lists `drone_video_url`; a build
--    that asks for a column the database does not have fails the whole
--    projects query. Everything here is additive — the running app neither
--    reads nor writes the new column or key — so applying it first is safe.
--
-- 1. projects.drone_video_url — nullable text, web links only (a CHECK).
--    A server path does not open from a browser (P-149), so it is refused here
--    as well as in the editor.
-- 2. bp_update_project_with_permits — the Project Data modal buffers every
--    Site field and saves through this RPC, which writes an EXPLICIT column
--    list (fix-410: a new projects column is a four-place job). An unlisted
--    column would be dropped silently. Patched by ANCHOR on the live body
--    (md5-guarded), never retyped: one line after `alley`.
--    `bp_update_project_fields` (the per-field path) is generic and needs no
--    change; `bp_create_project_with_permits` is not given a drone link at
--    creation, so it is left alone.
-- 3. app_config `droneFootageFolderUrl` — the one data write this ticket
--    makes: Bobby's "Drone Photos" folder (Blake's OneDrive), tenant explicit.
--    ON CONFLICT DO NOTHING: it never overwrites an edited value.

BEGIN;

-- 1 ─ the column ───────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS drone_video_url text;

DO $con$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.projects'::regclass
                    AND conname = 'projects_drone_video_url_web') THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_drone_video_url_web
      CHECK (drone_video_url IS NULL OR drone_video_url ~* '^https?://\S+$');
  END IF;
END
$con$;

COMMENT ON COLUMN public.projects.drone_video_url IS
  'fix-632: web link (http/https — SharePoint/OneDrive) to this project''s drone video or footage folder. NULL = none; Site Data then offers app_config droneFootageFolderUrl.';

-- 2 ─ the atomic save RPC learns the column ──────────────────────────────────
DO $rpc$
DECLARE
  v_oid oid := 'public.bp_update_project_with_permits(uuid,timestamptz,jsonb,jsonb,integer[])'::regprocedure;
  v_src text;
  v_def text;
  v_anchor constant text := 'ELSE alley END,';
  v_hits int;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%drone_video_url%' THEN
    RAISE NOTICE 'fix-632: bp_update_project_with_permits already writes drone_video_url';
    RETURN;
  END IF;
  IF md5(v_src) <> 'd862e98e797ce4c0d787949a51521851' THEN
    RAISE EXCEPTION 'fix-632: bp_update_project_with_permits is not the body read on 2026-10-10 — STOP';
  END IF;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-632: anchor % found % times, expected 1 — STOP', v_anchor, v_hits;
  END IF;
  v_def := replace(
    pg_get_functiondef(v_oid),
    v_anchor,
    v_anchor || E'\n        drone_video_url  = CASE WHEN v_patch ? ''drone_video_url'' THEN NULLIF(btrim(coalesce(v_patch->>''drone_video_url'','''')),'''') ELSE drone_video_url END,'
  );
  EXECUTE v_def;  -- CREATE OR REPLACE: the ACL is kept
END
$rpc$;

-- 3 ─ the shared folder (the one data write) ────────────────────────────────
INSERT INTO public.app_config (key, value, tenant_id)
VALUES (
  'droneFootageFolderUrl',
  to_jsonb('https://blueprintcap-my.sharepoint.com/shared?listurl=https%3A%2F%2Fblueprintcap%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments&id=%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments%2FDrone%20Photos&ct=1791661069093&or=Teams%2DHL&shareLink=1&ga=1&LOF=1'::text),
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (key) DO NOTHING;

-- 4 ─ read back ─────────────────────────────────────────────────────────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects'
                    AND column_name = 'drone_video_url') THEN
    RAISE EXCEPTION 'fix-632: projects.drone_video_url missing';
  END IF;
  IF (SELECT prosrc FROM pg_proc
       WHERE oid = 'public.bp_update_project_with_permits(uuid,timestamptz,jsonb,jsonb,integer[])'::regprocedure)
     NOT LIKE '%drone_video_url%' THEN
    RAISE EXCEPTION 'fix-632: the atomic RPC does not write drone_video_url';
  END IF;
  IF has_function_privilege('anon',
       'public.bp_update_project_with_permits(uuid,timestamptz,jsonb,jsonb,integer[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-632: anon can execute bp_update_project_with_permits';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_config
                  WHERE key = 'droneFootageFolderUrl' AND tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'fix-632: droneFootageFolderUrl missing or without a tenant';
  END IF;
END
$check$;

COMMIT;
