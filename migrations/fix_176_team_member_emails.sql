-- fix-176 (v2): login -> roster mapping data fill.
--
-- The role-aware self-default keys off team_members.email (auth login email)
-- -> team_members.name (the string stored on permits.da / projects.entitlement_lead
-- / projects.design_manager etc.) -> team_members.role (discipline). The column
-- existed but was unpopulated for almost everyone, so the lookup returned no
-- discipline and every user fell back to "all".
--
-- This fills the email on EVERY roster row for each login user (a person can hold
-- multiple rows, e.g. Miles is both ent + ent_lead) so the lookup is stable no
-- matter which row it hits. Guarded: only sets the email where the name matches
-- AND the email is currently NULL — idempotent and non-destructive (Bobby's
-- robertd@ link is already set and is left untouched by the IS NULL guard).
--
-- Logins WITHOUT a roster assignment (Lucas / Dave / Keenan) are intentionally
-- NOT given rows here — they resolve to no discipline and default to "all".

UPDATE public.team_members AS tm
SET email = m.email
FROM (VALUES
  ('Miles',    'miles@blueprintcap.com'),
  ('Briana',   'briana@blueprintcap.com'),
  ('Brittani', 'brittani@blueprintcap.com'),
  ('Cam',      'cameron@blueprintcap.com'),
  ('Shire',    'smahdi@blueprintcap.com')
) AS m(name, email)
WHERE tm.name = m.name
  AND tm.email IS NULL;
