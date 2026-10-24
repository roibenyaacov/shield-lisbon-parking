-- Reject past-date mutations in release RPCs.
-- UI already disables past days; these guards stop direct API/RPC calls from
-- deleting historical allocations or promoting waitlist users onto past dates.

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
  v_today    DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  IF p_date < v_today THEN
    RETURN json_build_object('error', 'Cannot modify a past date');
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
  v_today       DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  IF p_date < v_today THEN
    RETURN json_build_object('error', 'Cannot modify a past date');
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
