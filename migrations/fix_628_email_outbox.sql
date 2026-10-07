-- ===========================================================================
-- fix-628 §A — THE OUTBOX: ONE ROW PER SEND ATTEMPT                    P-092
-- ===========================================================================
--
-- Every email the Bridge sends today goes through Supabase's built-in demo
-- sender (`noreply@mail.app.supabase.io`), which is throttled and almost never
-- reaches a real inbox. So a password reset never arrives — Lucas was locked out
-- on 2026-10-06 and had to be let back in by hand in the SQL editor. fix-426's
-- reset-by-code is correct; nothing delivered its email.
--
-- fix-628 sends through Microsoft Graph as `bridge@blueprintcap.com`. This table
-- is the half that makes a FAILED send visible.
--
-- ★★★ WHY A TABLE AT ALL. P-286 found 83 of 94 write hooks reported nothing when
--     they failed. An email sender is the worst possible place to be the 84th:
--     the person who needed the mail is, by construction, the person who cannot
--     tell you it never came. Lucas's lockout was invisible for a day because
--     there was nowhere for "the send failed" to be written down.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE BRIEF ASKED FOR A `subject` COLUMN *AND* FOR THE CODE NEVER TO BE
--     STORED. FOR `recovery` THOSE TWO CONFLICT.
-- ---------------------------------------------------------------------------
-- The recovery subject is `Your Bridge reset code: 123456`. Storing it verbatim
-- would put a live password-reset code in a table — the one thing §A says never
-- to store, defeated by the one column §A asks for.
--
-- ★★ So the subject is stored REDACTED: `Your Bridge reset code: ••••••`. The
--    masking happens in the sender (`redactSubject`, with its own test) before
--    the row is written, not here, because the function is the only thing that
--    ever holds the token. A CHECK constraint below refuses a row whose subject
--    still contains a run of digits long enough to be a code, so a future caller
--    that forgets to redact fails loudly instead of leaking quietly.
--
-- ★ And no body column at all. There is nothing in a rendered body that is not
--   either the code or boilerplate this repo already contains.
--
-- ---------------------------------------------------------------------------
-- ★★ NO DATA IS CHANGED BY THIS FILE. It creates one table, one policy, one
--    read RPC, and grants. Nothing is inserted.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- ★ `auth:recovery`, `auth:magiclink`, … — the namespace is deliberate: the
  --   next tickets (P-323 mention emails, P-017, P-180) are not auth emails and
  --   will use their own prefix, and a mixed table should say which is which.
  kind             text NOT NULL,
  to_email         text NOT NULL,
  -- ★ REDACTED — see the header. Nullable because a send that fails before a
  --   subject exists (a missing secret) still deserves a row.
  subject          text,
  status           text NOT NULL,
  -- ★ NULL exactly when status = 'sent'; the CHECK below enforces the pair, so
  --   "failed with no reason recorded" cannot happen.
  error            text,
  -- ★ Graph's `request-id` / `client-request-id` response header. It is what
  --   Microsoft support asks for, and it is the only way to ask them about one
  --   specific message. NULL when the failure happened before Graph answered.
  graph_request_id text,
  attempts         integer NOT NULL DEFAULT 1,

  CONSTRAINT email_outbox_status_known
    CHECK (status IN ('sent', 'failed')),
  -- ★★ A failure must say why, and a success must not claim one.
  CONSTRAINT email_outbox_error_matches_status
    CHECK ((status = 'failed' AND error IS NOT NULL)
        OR (status = 'sent'   AND error IS NULL)),
  CONSTRAINT email_outbox_attempts_positive CHECK (attempts >= 1),
  -- ★★★ THE REDACTION GUARD. A Supabase auth token is 6+ digits; a subject
  --     carrying one means somebody skipped `redactSubject`. Refusing the row is
  --     right: losing one audit row is a smaller harm than storing a live reset
  --     code, and the function logs the constraint violation.
  CONSTRAINT email_outbox_subject_has_no_code
    CHECK (subject IS NULL OR subject !~ '[0-9]{6}')
);

COMMENT ON TABLE public.email_outbox IS
  'fix-628 (P-092): one row per Bridge email send attempt, so a FAILED send is '
  'visible. Written by the service role from the auth-send-email Edge Function. '
  'NEVER holds a token or a body — `subject` is stored redacted and a CHECK '
  'constraint refuses any subject containing a 6-digit run.';

COMMENT ON COLUMN public.email_outbox.graph_request_id IS
  'Microsoft Graph request-id from the sendMail response headers — the id MS '
  'support asks for. NULL when the attempt failed before Graph replied.';

CREATE INDEX IF NOT EXISTS email_outbox_created_at_idx
  ON public.email_outbox (created_at DESC);
-- ★ The query an admin actually runs is "what failed recently", so the partial
--   index is the one worth having.
CREATE INDEX IF NOT EXISTS email_outbox_failed_idx
  ON public.email_outbox (created_at DESC) WHERE status = 'failed';

-- ---------------------------------------------------------------------------
-- RLS — the `permit_task_audit` pattern (fix-272), which is the one this repo
-- already uses for a service-role-written, admin-read table.
-- ---------------------------------------------------------------------------
-- ★★★ AND STRICTER IN ONE WAY, AS §A ASKS: `permit_task_audit` gives
--     `authenticated` a tenant SELECT policy. This table has **no anon and no
--     authenticated policy at all**, so the table itself is unreadable with a
--     user's JWT. Admins read through `bp_email_outbox_recent` below.
--
-- ★★ WHY NOT A TENANT COLUMN + `is_tenant_admin`. An auth email is addressed to
--    an auth user, and an auth user does not necessarily map to a tenant (a
--    recovery can be requested for an address that is not a member of anything —
--    which is exactly the case fix-426 deliberately answers identically). A
--    `tenant_id` here would be NULL for the rows that matter most. So the gate
--    is `bp_is_admin_anywhere()` (fix-608), the repo's tenant-less admin test.
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_outbox_service ON public.email_outbox;
CREATE POLICY email_outbox_service ON public.email_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ★★★ `FROM public, anon` AND NEVER `FROM anon` ALONE — anon INHERITS the PUBLIC
--     grant, so revoking from anon by itself leaves the table readable by an
--     unauthenticated session (fix-157).
REVOKE ALL ON TABLE public.email_outbox FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_outbox TO service_role;

-- ---------------------------------------------------------------------------
-- The admin read path
-- ---------------------------------------------------------------------------
-- ★★ SECURITY DEFINER *with* an explicit admin check, which is the shape
--    fix-608/fix-617 settled on: definer rights bypass RLS, so the gate has to
--    be in the body or the definer is the hole.
--
-- ★ It returns no more than it must. `error` is included because that is the
--   whole point; `graph_request_id` because that is what MS support needs.
CREATE OR REPLACE FUNCTION public.bp_email_outbox_recent(p_limit integer DEFAULT 100)
RETURNS TABLE(
  id               uuid,
  created_at       timestamptz,
  kind             text,
  to_email         text,
  subject          text,
  status           text,
  error            text,
  graph_request_id text,
  attempts         integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.bp_is_admin_anywhere() THEN
    RAISE EXCEPTION 'Only an admin can read the email outbox.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT o.id, o.created_at, o.kind, o.to_email, o.subject, o.status,
           o.error, o.graph_request_id, o.attempts
      FROM public.email_outbox o
     ORDER BY o.created_at DESC, o.id DESC   -- fix-338: now() ties need id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));
END;
$function$;

COMMENT ON FUNCTION public.bp_email_outbox_recent(integer) IS
  'fix-628 (P-092): admin-only read of email_outbox. The table has no anon or '
  'authenticated policy, so this is the only way to see it with a user JWT. '
  'Gated on bp_is_admin_anywhere() because an auth email has no tenant.';

REVOKE ALL ON FUNCTION public.bp_email_outbox_recent(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_email_outbox_recent(integer) TO authenticated;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. ★★★ It stores no token, no code and no body. `subject` is redacted by the
--    sender and a CHECK refuses any 6-digit run, so the guard survives a future
--    caller that forgets.
-- 2. It changes NO DATA — one table, one policy, one function, grants.
-- 3. It does not enable the Send Email hook, touch Auth settings, or hold any
--    secret. `MS_GRAPH_CLIENT_SECRET` and `SEND_EMAIL_HOOK_SECRET` are Edge
--    Function secrets that Bobby sets; nothing about them is in this repo.
-- 4. It adds no retry machinery. `attempts` records what happened; re-sending is
--    Auth's business (the person asks for another code), and a queue nobody
--    drains is worse than a visible failure.
