-- Migration 015: Force weekly request writes through /api/request
--
-- The server route enforces the Lisbon registration window, validates the
-- target week, and caps selected days. Authenticated client-side writes can
-- bypass those checks if INSERT/UPDATE/DELETE policies remain open.

DROP POLICY IF EXISTS "Users can insert own requests" ON weekly_requests;
DROP POLICY IF EXISTS "Users can update own requests" ON weekly_requests;
DROP POLICY IF EXISTS "Users can delete own requests" ON weekly_requests;

DROP POLICY IF EXISTS "Service role can manage weekly requests" ON weekly_requests;

CREATE POLICY "Service role can manage weekly requests"
  ON weekly_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
