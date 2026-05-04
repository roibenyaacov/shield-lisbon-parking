-- Migration 011: Atomic release_fixed_and_promote RPC
--
-- WHY THIS EXISTS
-- ───────────────────────────────────────────────────────────────────
-- /api/release has two code paths:
--
-- 1. Normal release (user has an explicit weekly_allocations row):
--    Uses the existing release_and_promote() RPC — fully atomic with
--    FOR UPDATE / SKIP LOCKED locks.
--
-- 2. Fixed-spot "default reserved state" release (fixed-spot owner
--    has no allocation row because the spot was never formally
--    allocated — e.g. they released the whole week before allocation
--    ran, or they reclaimed the spot with pass_number=0 and then
--    immediately released again):
--    Previously this was handled by three separate round-trips
--    (SELECT waitlist → INSERT allocation → DELETE waitlist) with no
--    transaction or lock.  A concurrent release_and_promote() call on
--    any other spot could pick up the same waitlist entry between the
--    INSERT and DELETE, promoting the same user to two different spots
--    on the same day.
--
-- This RPC replaces that fallback path with a single atomic
-- transaction, matching the safety guarantees of release_and_promote().
--
-- Unlike release_and_promote(), there is NO ownership check on an
-- existing allocation row (because the spot is in its default reserved
-- state — no row exists).  Ownership is instead verified by checking
-- that p_spot_id.fixed_user_id = p_user_id before any mutation.
--
-- Returns JSON:
--   { "released": true, "promoted_user_id": "<uuid>" }
--   { "released": true, "promoted_user_id": null }
--   { "error": "<message>" }
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION release_fixed_and_promote(
  p_user_id UUID,
  p_spot_id INTEGER,
  p_date    DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fixed_owner UUID;
  v_waitlist    RECORD;
BEGIN
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
