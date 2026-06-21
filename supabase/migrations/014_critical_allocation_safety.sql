-- Migration 014: Critical allocation safety fixes
--
-- 1. Persist weekly allocation output and the idempotency marker in one
--    transaction so failed inserts cannot leave the week deleted.
-- 2. Track completed allocation runs explicitly so manual claims/reclaims do
--    not make the weekly cron skip the company-wide allocation.
-- 3. Restrict release mutation RPCs to the server-side service role. The API
--    route already verifies the signed-in user before calling these RPCs; this
--    closes the direct browser RPC bypass where callers could spoof p_user_id.

-- ============================================
-- ALLOCATION RUN MARKER
-- ============================================

CREATE TABLE IF NOT EXISTS allocation_runs (
  week_start DATE PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE allocation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage allocation runs" ON allocation_runs;
CREATE POLICY "Service role can manage allocation runs"
  ON allocation_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- ATOMIC WEEKLY ALLOCATION SAVE
-- ============================================

CREATE OR REPLACE FUNCTION save_weekly_allocation_results(
  p_week_start  DATE,
  p_allocations JSONB,
  p_waitlisted  JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_dates DATE[];
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(p_week_start + offsets.day_offset)
  INTO v_week_dates
  FROM generate_series(0, 4) AS offsets(day_offset);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) AS entry(value)
    WHERE (entry.value->>'date')::date <> ALL(v_week_dates)
  ) THEN
    RAISE EXCEPTION 'Allocation date outside target week';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_waitlisted, '[]'::jsonb)) AS entry(value)
    WHERE (entry.value->>'date')::date <> ALL(v_week_dates)
  ) THEN
    RAISE EXCEPTION 'Waitlist date outside target week';
  END IF;

  DELETE FROM weekly_allocations
  WHERE date = ANY(v_week_dates);

  DELETE FROM waitlist
  WHERE date = ANY(v_week_dates);

  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  SELECT
    (entry.value->>'user_id')::uuid,
    (entry.value->>'spot_id')::integer,
    (entry.value->>'date')::date,
    (entry.value->>'pass_number')::integer
  FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) AS entry(value);

  INSERT INTO waitlist (user_id, date)
  SELECT
    (entry.value->>'user_id')::uuid,
    (entry.value->>'date')::date
  FROM jsonb_array_elements(COALESCE(p_waitlisted, '[]'::jsonb)) AS entry(value);

  INSERT INTO allocation_runs (week_start, created_at)
  VALUES (p_week_start, now())
  ON CONFLICT (week_start) DO UPDATE
    SET created_at = EXCLUDED.created_at;
END;
$$;

REVOKE ALL ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB) TO service_role;

-- ============================================
-- LOCK DOWN RELEASE MUTATION RPCS
-- ============================================

CREATE OR REPLACE FUNCTION release_and_promote(
  p_user_id UUID,
  p_spot_id INTEGER,
  p_date    DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc_id UUID;
  v_waitlist RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'Forbidden');
  END IF;

  -- 1. Verify ownership with a row-level lock to prevent concurrent races
  SELECT id INTO v_alloc_id
  FROM weekly_allocations
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date    = p_date
  FOR UPDATE;

  IF v_alloc_id IS NULL THEN
    RETURN json_build_object('error', 'You do not have this allocation');
  END IF;

  -- 2. Release the spot
  DELETE FROM weekly_allocations WHERE id = v_alloc_id;

  -- 3. Claim the first waitlist entry (SKIP LOCKED avoids deadlock with
  --    a concurrent release running the same query simultaneously)
  SELECT * INTO v_waitlist
  FROM waitlist
  WHERE date = p_date
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_waitlist IS NULL THEN
    RETURN json_build_object(
      'released',          true,
      'promoted_user_id',  NULL
    );
  END IF;

  -- 4. Atomically promote: insert new allocation and remove from waitlist
  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

  DELETE FROM waitlist WHERE id = v_waitlist.id;

  RETURN json_build_object(
    'released',          true,
    'promoted_user_id',  v_waitlist.user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION release_and_promote(UUID, INTEGER, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_and_promote(UUID, INTEGER, DATE) TO service_role;

CREATE OR REPLACE FUNCTION release_fixed_and_promote(
  p_user_id UUID,
  p_spot_id INTEGER,
  p_date    DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixed_owner UUID;
  v_waitlist    RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'Forbidden');
  END IF;

  -- 1. Verify the caller owns this fixed spot (row-level lock on the spot)
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  -- 2. Grab the first waitlist entry for this date (SKIP LOCKED avoids
  --    deadlock when two concurrent releases run simultaneously)
  SELECT * INTO v_waitlist
  FROM waitlist
  WHERE date = p_date
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_waitlist IS NULL THEN
    RETURN json_build_object(
      'released',         true,
      'promoted_user_id', NULL
    );
  END IF;

  -- 3. Atomically promote: assign the released spot to the waitlist user
  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

  DELETE FROM waitlist WHERE id = v_waitlist.id;

  RETURN json_build_object(
    'released',         true,
    'promoted_user_id', v_waitlist.user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION release_fixed_and_promote(UUID, INTEGER, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_fixed_and_promote(UUID, INTEGER, DATE) TO service_role;
