-- fix-350: What's New — nobody knows what the tool can do.
--
-- Bobby: *"We should add a what's new thing to the ribbon so people are aware
-- of the features, tips and tricks etc."*
--
-- ★★★ THE PROBLEM IS NOT THAT THE FEATURES ARE MISSING. Between 2026-08-14 and
-- 2026-08-19 this tool gained project chat, @mentions, reactions, tags, a
-- notification centre, live updates, a new logo and a dozen other things.
-- Bobby has seen every one because he asked for it. ★ The other 28 logins have
-- been told about none of them, and a feature nobody knows exists is
-- indistinguishable from one that was never built.
--
-- ★ WHAT THIS WRITES: two new tables and 15 rows in one of them. No existing
-- row in any table is read or written.
--
-- ---------------------------------------------------------------------------
-- ★★ WHY THE DATABASE AND NOT A CONSTANT IN THE SOURCE
-- ---------------------------------------------------------------------------
-- The brief asked for entries to be admin-editable rather than a TS array, and
-- invited disagreement. I agree with it, for a reason the brief does not give:
-- Bobby wants TIPS as well as features. A release note is written when code
-- ships and a deploy is already happening anyway — but "did you know you can
-- paste a screenshot straight into a post" occurs to somebody on a Tuesday,
-- watching a person do it the long way. Making that require a pull request is
-- how the tips half of this feature quietly never happens.
--
-- ★ The cost is honest and small: one table, admin-write RLS, and a Settings
-- editor. The alternative — a constant — would have needed a deploy per tip and
-- would have put the audience's language inside the repo, which is precisely
-- the confusion this ticket exists to fix.

-- ---------------------------------------------------------------------------
-- 1. The entries
-- ---------------------------------------------------------------------------
--
-- ★ `kind` is a CHECK'd vocabulary of THREE, chosen against Bobby's own words
-- ("features, tips and tricks"):
--
--     new       something that did not exist before
--     improved  something that existed and now behaves better
--     tip       something that already worked and nobody knew about
--
-- ★★ THE THIRD ONE IS THE POINT. Without it this is a release-notes table and
-- the "tips and tricks" half of the request has nowhere to live. With it, an
-- admin can write an entry about a two-month-old feature and it is not a lie.
--
-- ★ CHECK'd rather than free text so the filter chips and the badge colours are
-- a closed set — the fix-232 lesson about registries with two sources.
CREATE TABLE IF NOT EXISTS public.whats_new_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ★ The date it SHIPPED, not the date the row was written. The seed below
  -- takes these from the git history, which is why the entries are dated across
  -- five days rather than all landing today.
  published_on  date NOT NULL DEFAULT current_date,
  kind          text NOT NULL DEFAULT 'new'
                  CHECK (kind IN ('new', 'improved', 'tip')),
  title         text NOT NULL CHECK (btrim(title) <> ''),
  body          text NOT NULL CHECK (btrim(body) <> ''),
  -- Tie-break within a day, so several entries on one date have a stable order
  -- instead of whatever the planner returns.
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whats_new_entries_tenant_date_idx
  ON public.whats_new_entries (tenant_id, published_on DESC, sort_order DESC);

-- tenant_id filled by the shared BEFORE-INSERT trigger, exactly like
-- external_team_directory (fix-227) and public.builders, so an admin's client
-- can insert without passing it.
DROP TRIGGER IF EXISTS whats_new_entries_default_tenant ON public.whats_new_entries;
CREATE TRIGGER whats_new_entries_default_tenant
  BEFORE INSERT ON public.whats_new_entries
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.whats_new_entries ENABLE ROW LEVEL SECURITY;

-- ★★ READS: EVERY MEMBER OF THE TENANT, NOT JUST ADMINS. The brief is explicit
-- and it is the whole point — 23 of the 29 logins are non-admin editors
-- (fix-331), and they are the people who have not been told anything.
DROP POLICY IF EXISTS whats_new_entries_tenant_select ON public.whats_new_entries;
CREATE POLICY whats_new_entries_tenant_select
  ON public.whats_new_entries
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★★★ WRITES: ADMINS ONLY, ENFORCED HERE. fix-234's lesson, which fix-331 §6
-- had to go back and apply: a page hidden from a non-admin is not a permission,
-- it is a decoration. The editor is also hidden in Settings, but this policy is
-- what makes it true — a non-admin POSTing straight at PostgREST gets 42501.
DROP POLICY IF EXISTS whats_new_entries_tenant_admin_write ON public.whats_new_entries;
CREATE POLICY whats_new_entries_tenant_admin_write
  ON public.whats_new_entries
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

REVOKE ALL ON public.whats_new_entries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whats_new_entries
  TO authenticated, service_role;

COMMENT ON TABLE public.whats_new_entries IS
  'fix-350: What''s New entries — short, dated, plain-language notes written by '
  'an admin for the team. Read by every tenant member, written by admins only '
  '(RLS, not just a hidden page). kind: new | improved | tip.';

-- ---------------------------------------------------------------------------
-- 2. Who has read what
-- ---------------------------------------------------------------------------
--
-- ★★ PER PERSON. The brief: "Bobby reading an entry must not clear it for Cam."
-- That is fix-307's PERSONAL shape — the domain row cannot record "seen", so a
-- read row has to — and this table is deliberately a copy of
-- `board_item_reads`, down to the `auth.uid()` default and the two policies.
--
-- ★★★ AND IT IS A SEPARATE TABLE, WHICH IS A DECISION, NOT AN OVERSIGHT.
-- Reusing board_item_reads with a 'whatsnew:<id>' key would have worked and was
-- the first design. It loses one thing worth more than the shared table: a real
-- FOREIGN KEY. An entry is a durable row an admin can delete, and with a text
-- key its read rows would outlive it as orphans nothing ever cleans up. Board
-- items are DERIVED and transient, so they cannot have one.
--
-- ★ To be clear about what is NOT duplicated: the unread STYLE. fix-335 §9's
-- treatment (--color-de) is reused verbatim, because "this concerns you" should
-- look the same everywhere. The brief forbids a second unread vocabulary and
-- this does not add one — it adds a second STORE, for a different lifecycle.
--
-- ★ Append-only: there is SELECT and INSERT and no DELETE policy. "I have read
-- this" is not a thing anyone needs to undo, and the marker returns on its own
-- when a NEW entry is written, which is the behaviour Bobby asked for.
CREATE TABLE IF NOT EXISTS public.whats_new_reads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  entry_id   uuid NOT NULL
               REFERENCES public.whats_new_entries(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_id)
);

CREATE INDEX IF NOT EXISTS whats_new_reads_user_idx
  ON public.whats_new_reads (user_id);

DROP TRIGGER IF EXISTS whats_new_reads_default_tenant ON public.whats_new_reads;
CREATE TRIGGER whats_new_reads_default_tenant
  BEFORE INSERT ON public.whats_new_reads
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.whats_new_reads ENABLE ROW LEVEL SECURITY;

-- ★★ YOUR OWN ROWS ONLY, both directions. This is what makes "per person" a
-- fact rather than a convention: one login cannot read another's read state,
-- and cannot write one either.
DROP POLICY IF EXISTS whats_new_reads_own_select ON public.whats_new_reads;
CREATE POLICY whats_new_reads_own_select
  ON public.whats_new_reads
  FOR SELECT USING (
    user_id = auth.uid() AND tenant_id = ANY (public.auth_tenant_ids())
  );

DROP POLICY IF EXISTS whats_new_reads_own_insert ON public.whats_new_reads;
CREATE POLICY whats_new_reads_own_insert
  ON public.whats_new_reads
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND tenant_id = ANY (public.auth_tenant_ids())
  );

REVOKE ALL ON public.whats_new_reads FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.whats_new_reads TO authenticated, service_role;

COMMENT ON TABLE public.whats_new_reads IS
  'fix-350: one row per person per entry they have read. Mirrors '
  'board_item_reads (fix-307) but with a real FK, because an entry is a durable '
  'row an admin can delete. Append-only; RLS confines a login to its own rows.';

-- ---------------------------------------------------------------------------
-- 3. ★★★ THE SEED — what has already shipped, written as a person would
-- ---------------------------------------------------------------------------
--
-- ★ An empty What's New is worse than none: it teaches people there is nothing
-- to look at. So it opens with the five days nobody was told about.
--
-- ★★★ WRITTEN FOR THE TEAM, NOT FROM THE REPO. Not one of these is generated
-- from a commit message or a PR title, and not one mentions a ticket number —
-- "fix-347" means nothing to a design associate. A test asserts that: no entry
-- body may contain a fix-NNN reference.
--
-- ★★ GROUPED BY WHAT A PERSON WOULD NOTICE, not by ticket. 24 tickets merged in
-- this window; they are 15 entries here. Project chat alone was three tickets
-- (the chat, the picker and attachments, then editing and search) and is ONE
-- entry to a reader — but "you can type @ to mention someone" is a different
-- thing you DO, so it is its own.
--
-- ★ Dated from the git history — the day each thing actually reached people,
-- which is why they span five days rather than all landing today.
--
-- ★ Idempotent: keyed on (tenant, title), so re-running adds nothing.
INSERT INTO public.whats_new_entries (tenant_id, published_on, kind, title, body, sort_order)
SELECT t.id, v.published_on, v.kind, v.title, v.body, v.sort_order
FROM public.tenants t
CROSS JOIN (VALUES
  ('2026-08-19'::date, 'new', 'A new look for the Bridge',
   'The header now carries Blueprint''s new Bridge logo, and the blue line under it runs straight into the rule across the top of the screen. The browser tab has the new mark too — if your tab still shows the old one, a hard refresh will pick it up.',
   90),

  ('2026-08-19'::date, 'new', 'WAC is a permit type now',
   'A WAC is a separate Seattle permit and is generally required, but the tool had no type for it, so it lived as a checkbox on the PAR task list. You can now add one to a project like any other permit, with its own dates, status and pipeline row. Existing projects were left alone — add one when you next need it.',
   80),

  ('2026-08-18'::date, 'improved', 'Your tasks now show up on My Board',
   'The forecast on My Board used to list permit milestones only, which is why your tasks never appeared there. It now blends both into the same date buckets — past due, today, tomorrow, this week, next week — and a task keeps its own amber ✓ badge so you can still tell the two apart at a glance.',
   70),

  ('2026-08-18'::date, 'improved', 'Work that no longer applies clears itself',
   'Checks that only made sense before a permit issued now close on their own the moment it does, and they are marked with a ⏱ SYSTEM badge so it is obvious nobody ticked them. Milestone prompts also stopped appearing for stages a permit has already passed — that alone removed several hundred prompts that were asking about things already done.',
   60),

  ('2026-08-18'::date, 'new', 'Notifications arrive live, and there is a place to find them',
   'Mentions, task changes and status flips now appear without refreshing the page. The bell still carries the count, and Notifications in the ribbon is the full list — including the quieter things that were never worth a badge. Anything you have not seen yet is tinted blue and goes quiet once you have looked at it.',
   50),

  ('2026-08-18'::date, 'new', 'React to a message',
   'Six emoji, one tap, on any post or reply. A reaction here is closer to a read receipt than an opinion: on a post you sent, you can flip it around and see who has NOT reacted yet, which is a gentler way of finding out who has not seen something than asking them.',
   40),

  ('2026-08-18'::date, 'tip', 'Tag a whole project at once',
   'Type @project in any project chat and it reaches everyone on that project''s team — acquisitions, the entitlement lead, the design manager and the DA. It resolves to whoever is assigned today, so it never goes stale as people move around. Admins can also create custom tags in Settings for groups the tool does not know about.',
   30),

  ('2026-08-18'::date, 'new', 'Every new project starts with three posts',
   'ACQ Questions, Design Phase and Preliminary Assessment are created along with the project, so there is an obvious place to put things from day one instead of a blank chat nobody wants to be first in. Existing projects were not backfilled.',
   20),

  ('2026-08-18'::date, 'improved', 'People have job titles, not database names',
   'Names used to appear beside raw role keys. Everyone now shows with their actual title — Entitlements Manager, Design Associate, Design Manager and so on — and where somebody holds more than one role, the most senior one is shown rather than whichever came back first.',
   10),

  ('2026-08-18'::date, 'tip', 'Jump to today on the Draw Schedule',
   'There is a Today button above the board, greyed out when you are already looking at the current quarter. This always worked by clicking the quarter label, which is exactly why it is now a button that says what it does.',
   5),

  ('2026-08-17'::date, 'new', 'Project chat',
   'Every project has a chat now. Start a post, reply underneath it in a thread, attach a file, or paste a screenshot straight in from your clipboard. Posts sort by the most recent activity, so whatever is moving stays at the top, and you can search across all of them.',
   90),

  ('2026-08-17'::date, 'tip', 'Mention someone with @',
   'Type @ in a message and start typing a name — the list narrows as you go. The person you pick gets a notification, and the mention keeps pointing at them even if their name is later spelled differently, because the tool stores who you meant rather than what you typed.',
   80),

  ('2026-08-17'::date, 'improved', 'Fix a message you have already sent',
   'You can edit or delete your own posts and replies. An edited message keeps its history, so a conversation cannot quietly change underneath the people reading it, and a deleted one leaves a marker rather than a hole.',
   70),

  ('2026-08-17'::date, 'tip', 'Ask for a post to be started',
   'Only admins can start a new post, but anyone can request one — the request goes to the oversight team and that project''s entitlement lead. Once somebody acts on it, it clears from everyone''s queue at once, so five people are not each dismissing the same thing.',
   60),

  ('2026-08-17'::date, 'tip', 'SharePoint is one click away',
   'There is a SharePoint link in the ribbon, at the bottom with the other links. It opens in a new tab, so you do not lose your place in the tool.',
   50)
) AS v(published_on, kind, title, body, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whats_new_entries e
  WHERE e.tenant_id = t.id AND e.title = v.title
);

-- ---------------------------------------------------------------------------
-- 4. Realtime (applied as fix_350_whats_new_realtime)
-- ---------------------------------------------------------------------------
--
-- ★★ fix-336's lesson, applied at the point of the mistake rather than after
-- it: a subscription to an UNPUBLISHED table is SILENT — no error, no warning,
-- the handler simply never fires. Six tables sat like that for a quarter.
-- REALTIME_TABLES in src/lib/queryKeys.ts names both of these, so they have to
-- be published or that registration is decoration.
--
--   whats_new_entries  an admin writes a tip and everyone's ribbon dot appears,
--                      rather than only for whoever reloads next.
--   whats_new_reads    fix-307's reasoning exactly — reading in one tab clears
--                      the dot in every other tab of the SAME login. RLS on the
--                      stream keeps it to your own rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'whats_new_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whats_new_entries;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'whats_new_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whats_new_reads;
  END IF;
END $$;
