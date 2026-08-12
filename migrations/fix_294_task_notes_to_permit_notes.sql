-- fix-294: move the task-detail notes onto the permits, where people look.
--
-- ★ THE PROBLEM. The "Notes" box in the My Tasks detail panel wrote
-- permit_tasks.notes — a column rendered on exactly ONE screen: that panel.
-- Project Overview, the permit detail and every report ignore it. So whatever
-- was typed there was invisible to everyone but the person who typed it, which
-- is a write surface whose output nobody can find.
--
-- 19 tasks carried a note, and they are not scratch: "Holding for MHA",
-- "Pending Builder Signature", "To be paid near mid- end of august per andrew",
-- and several full paths to picked-up redlines. Dropping them would have thrown
-- away real operational context, so they MOVE rather than die.
--
-- WHERE THEY GO. public.notes, the fix-notes-1 unified log, scoped to the
-- task's permit (permit_id set = per-permit note). That is the same store the
-- permit detail's NotesPanel and Project Overview already read, and as of
-- fix-294 the same store the My Tasks panel writes.
--
-- WHAT THE MIGRATED ROW LOOKS LIKE
--   body        the note, prefixed with the task it came from. "Waiting for
--               SSS." on its own loses its subject once it is no longer sitting
--               inside a task; "Drainage Correction — Waiting for SSS." keeps
--               it. The prefix is dropped when the note already starts with the
--               task text.
--   completed   TRUE when the source task is Resolved (11 of the 19). Those
--               notes are history, so they land in the collapsed
--               Completed/history section rather than the active list.
--   created_at  the task's updated_at, NOT now(), so the notes sit at the right
--               point in the permit's timeline instead of all appearing to have
--               been written the day of this migration.
--
-- ★ permit_tasks.notes IS NOT DROPPED. The column keeps its values and simply
-- stops being written — the same treatment fix-notes-1 gave the legacy
-- per-permit notes columns. Dropping it would make this migration
-- irreversible for no benefit, and the data is the only record of what was
-- moved. The app no longer reads or writes it.
--
-- Idempotent: re-running inserts nothing, because the guard below looks for a
-- note already carrying the same body on the same permit.

INSERT INTO public.notes (tenant_id, project_id, permit_id, body, completed,
                          completed_at, created_at, updated_at)
SELECT
  t.tenant_id,
  p.project_id,
  t.permit_id,
  CASE
    WHEN btrim(t.notes) ILIKE btrim(t.text) || '%' THEN btrim(t.notes)
    ELSE btrim(t.text) || ' — ' || btrim(t.notes)
  END,
  (t.completion_status = 'Resolved'),
  CASE WHEN t.completion_status = 'Resolved'
       THEN COALESCE(t.done_at, t.updated_at) END,
  t.updated_at,
  t.updated_at
FROM public.permit_tasks t
JOIN public.permits p ON p.id = t.permit_id
WHERE t.notes IS NOT NULL
  AND btrim(t.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.permit_id = t.permit_id
      AND n.body = CASE
        WHEN btrim(t.notes) ILIKE btrim(t.text) || '%' THEN btrim(t.notes)
        ELSE btrim(t.text) || ' — ' || btrim(t.notes)
      END
  );

COMMENT ON COLUMN public.permit_tasks.notes IS
  'fix-138-a, FROZEN by fix-294. Was the My Tasks task-detail notes box, which '
  'nothing else rendered — so its contents were invisible to everyone but the '
  'author. The 19 populated rows were copied into public.notes against their '
  'permit and the app no longer reads or writes this column. Kept, not '
  'dropped: it is the record of what was moved.';
