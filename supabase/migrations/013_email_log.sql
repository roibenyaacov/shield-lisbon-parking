-- Migration 013: email_log table for delivery observability
--
-- WHY THIS EXISTS
-- ─────────────────────────────────────────────────────────────────────────
-- Until this migration the only record of email delivery was a console.error
-- on failure.  After a cron run there was no way to answer "did Roi get his
-- Friday allocation email last week?" without opening the Resend dashboard
-- and searching.
--
-- This table is a write-only audit log.  It does not gate or retry sends —
-- it is purely a record-keeping mechanism so we can later answer questions
-- like "which users have never received an email" or "what was last week's
-- failure rate".
--
-- WRITE PATH
-- ─────────────────────────────────────────────────────────────────────────
-- Writes are performed by the Next.js API routes via the service-role
-- client (which bypasses RLS).  Send logic in lib/resend.ts wraps every
-- insert in a try/catch — if logging fails, the send result is still
-- returned and the user is not affected.
--
-- READ PATH
-- ─────────────────────────────────────────────────────────────────────────
-- Only admins can read this table from the client.  RLS is enabled with a
-- single SELECT policy keyed on profiles.role = 'admin'.  No client-side
-- INSERT / UPDATE / DELETE policy is granted; all mutations must go through
-- the service-role key.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_log (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  email               TEXT         NOT NULL,
  type                TEXT         NOT NULL,
  status              TEXT         NOT NULL CHECK (status IN ('sent', 'failed')),
  error               TEXT,
  provider_message_id TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user_id ON public.email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_type    ON public.email_log(type);
CREATE INDEX IF NOT EXISTS idx_email_log_status  ON public.email_log(status);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON public.email_log(created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read.  Service role bypasses RLS so cron / API writes work
-- without an explicit INSERT policy.
DROP POLICY IF EXISTS "email_log_admin_read" ON public.email_log;
CREATE POLICY "email_log_admin_read"
  ON public.email_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
