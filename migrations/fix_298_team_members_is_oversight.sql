-- fix-298 Phase 1: oversight is a FLAG, not a role.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-13 via MCP apply_migration.
--   4 rows flagged: Bobby (ent + ent_lead), Gena (dm), Dave (schematic).
--
-- Bobby, Gena and Dave see a wide view ON TOP OF their own scope. Modelling
-- that as a role would REPLACE their base scope — it would strip Gena's DM
-- view to give her the wide one, which is the opposite of what is wanted.
-- Oversight is additive, so it is a boolean beside the role.
--
-- team_members carries one row per (name, role) — Bobby holds both 'ent' and
-- 'ent_lead' — so the flag is set on EVERY row for a person and the client ORs
-- across the rows a login resolves to (resolveBoardViewer).
--
-- ⚠ Dave has NO EMAIL on his roster row, so resolveRosterIdentity cannot map a
-- login to him. His flag is set but inert until an email is added.
--
-- Phase 1 is read-only: this column is the ONLY schema change. The
-- notifications table and the append-only interaction log belong to Phases 2/3
-- and are deliberately not created here.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS is_oversight boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.team_members.is_oversight IS
  'fix-298: this person sees the company-wide board IN ADDITION TO their own '
  'role scope. A flag, not a role — additive, never a replacement.';

-- Named here because the ROSTER is the source of truth for who they are; the
-- CLIENT must never hardcode these names (brief: "do not hardcode oversight to
-- names"). resolveBoardViewer reads the flag, never a name list.
UPDATE public.team_members
SET is_oversight = true
WHERE name IN ('Bobby', 'Gena', 'Dave');
