-- ===========================================================================
-- fix-387 — What's New announces, but it does not teach
-- ===========================================================================
--
-- From the register: an entry should let a person click through to the feature,
-- or expand into a how-to. fix-350's own framing was the diagnosis — "a feature
-- nobody knows exists is indistinguishable from one that was never built" — and
-- a feature nobody can FIND is the same feature one click later. Reading
-- "Pipeline pills are back" tells the other 28 logins a thing exists; it does
-- not get them standing in front of it.
--
-- Measured on prod 2026-08-21 and unchanged today: 23 entries, 5 tips, 10
-- distinct readers. The reading habit exists; this gives it somewhere to go.
--
-- ---------------------------------------------------------------------------
-- ★★ TWO NULLABLE COLUMNS, BOTH OPTIONAL, NO DEFAULTS
-- ---------------------------------------------------------------------------
--
-- ★★★ The 23 existing rows are UNTOUCHED and render exactly as they do today.
-- An entry with neither column is fix-350's entry, unchanged — which is the
-- default case and the one the tests pin hardest.
--
-- ★ `how_to` is PLAIN TEXT and renders with `whitespace-pre-line`, the same way
-- `body` already does. No markdown library: these are three sentences, not
-- documents, and a renderer would be a dependency plus an injection surface
-- bought for formatting nobody asked for.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE CHECK IS NOT "STARTS WITH A SLASH"
-- ---------------------------------------------------------------------------
--
-- The brief says constrain go_href to start with `/` so this never becomes a
-- vector for an external link dressed as an announcement. A literal reading of
-- that is NOT ENOUGH, and the gap is the whole reason to write the constraint
-- carefully:
--
--   ★★★ `//evil.com` starts with a slash and is a PROTOCOL-RELATIVE URL.
--   A browser given <a href="//evil.com"> goes to https://evil.com. So does
--   `/\evil.com` in browsers that fold a backslash into a slash.
--
-- So the rule is "starts with exactly ONE slash, and contains no backslash":
--
--   '/'                      ✓ (the app root)
--   '/board?tab=notifications'  ✓
--   '//evil.com'             ✗ protocol-relative
--   '/\evil.com'             ✗ backslash-folded
--   'https://evil.com'       ✗
--   'javascript:alert(1)'    ✗
--
-- ★★ AND THE READER NEVER USES IT AS AN href ANYWAY. The page navigates with
-- react-router's `navigate()`, which treats the value as an in-app path and
-- cannot leave the origin whatever it says. The CHECK is the second lock, not
-- the only one — the same "hidden control is a decoration, not a permission"
-- rule fix-350 applied to its admin editor.
--
-- ★ NO ROW IS WRITTEN BY THIS MIGRATION. The teaching content for the 23
-- existing entries is DRAFTED, not applied — see
-- migrations/fix_387_entry_drafts_PENDING_APPROVAL.sql. Bobby approves the
-- list, or writes it himself in the admin editor, which is the faster path now
-- that the editor has the fields.
-- ===========================================================================

ALTER TABLE public.whats_new_entries
  ADD COLUMN IF NOT EXISTS go_href text,
  ADD COLUMN IF NOT EXISTS how_to  text;

COMMENT ON COLUMN public.whats_new_entries.go_href IS
  'fix-387: an APP-RELATIVE path to the thing this entry announces, e.g. '
  '/board?tab=notifications. NULL when the entry describes a behaviour with no '
  'single destination. Constrained to one leading slash and no backslash so it '
  'can never be a protocol-relative or external link.';

COMMENT ON COLUMN public.whats_new_entries.how_to IS
  'fix-387: the steps, as plain multiline text rendered with whitespace-pre-line. '
  'NULL when the entry needs no teaching. Never markdown.';

-- ★ Named, so a failure says which rule was broken rather than "check
-- constraint violated" on an anonymous name.
ALTER TABLE public.whats_new_entries
  DROP CONSTRAINT IF EXISTS whats_new_entries_go_href_is_app_path;

ALTER TABLE public.whats_new_entries
  ADD CONSTRAINT whats_new_entries_go_href_is_app_path
  CHECK (
    go_href IS NULL
    OR (
      -- exactly one leading slash: '/' alone, or '/' followed by something
      -- that is neither a slash nor a backslash
      go_href ~ '^/($|[^/\\])'
      -- and no backslash anywhere, so no later segment can fold into one
      AND position('\' in go_href) = 0
    )
  );
