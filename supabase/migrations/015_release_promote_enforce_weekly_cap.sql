-- Migration 015: Enforce MAX_DAYS_PER_USER on waitlist promotion
--
-- WHY THIS EXISTS
-- ───────────────────────────────────────────────────────────────────
-- release_and_promote / release_fixed_and_promote always promoted the
-- FIFO waitlist head with no weekly day-count check.  Concrete trigger
-- on low-registration weeks (allocation fill-up still stops at 3 days
-- while MAX_DAYS_PER_USER = 4):
--   1. User requests Mon–Thu, gets Mon/Tue/Wed, waitlisted for Thu
--   2. User claims an empty Friday spot via /api/claim (3 < 4)
--   3. Someone releases Thursday → promotion assigns Thu
--   4. User now holds 5 days, exceeding the advertised weekly cap
--
-- Keep this constant in sync with lib/constants.ts MAX_DAYS_PER_USER.
-- Also keep the Lisbon past-date guard (same as migration 014 intent)
-- so replacing these functions does not regress that check.
-- ───────────────────────────────────────────────────────────────────

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
  v_alloc_id   UUID;
  v_waitlist   RECORD;
  v_week_days  INTEGER;
  v_week_start DATE;
  v_week_end   DATE;
  v_today      DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Lisbon')::date;
  -- Must match lib/constants.ts MAX_DAYS_PER_USER
  c_max_days   CONSTANT INTEGER := 4;
BEGIN
  IF p_date < v_today THEN
    RETURN json_build_object('error', 'Cannot modify a past date');
  END IF;

  -- Monday–Friday bounds for the ISO week containing p_date
  v_week_start := p_date - ((EXTRACT(ISODOW FROM p_date)::integer) - 1);
  v_week_end   := v_week_start + 4;

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

  -- 3. Walk the waitlist in FCFS order. Skip users already at the weekly
  --    cap (leave them queued — they may become eligible after a later
  --    release of one of their own days). Remove stale same-day entries.
  FOR v_waitlist IN
    SELECT *
    FROM waitlist
    WHERE date = p_date
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1
      FROM weekly_allocations
      WHERE user_id = v_waitlist.user_id
        AND date = p_date
    ) THEN
      DELETE FROM waitlist WHERE id = v_waitlist.id;
      CONTINUE;
    END IF;

    SELECT COUNT(*)::integer INTO v_week_days
    FROM weekly_allocations
    WHERE user_id = v_waitlist.user_id
      AND date >= v_week_start
      AND date <= v_week_end;

    IF v_week_days >= c_max_days THEN
      CONTINUE;
    END IF;

    INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
    VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

    DELETE FROM waitlist WHERE id = v_waitlist.id;

    RETURN json_build_object(
      'released',         true,
      'promoted_user_id', v_waitlist.user_id
    );
  END LOOP;

  RETURN json_build_object(
    'released',         true,
    'promoted_user_id', NULL
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
  v_week_days   INTEGER;
  v_week_start  DATE;
  v_week_end    DATE;
  v_today       DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Lisbon')::date;
  -- Must match lib/constants.ts MAX_DAYS_PER_USER
  c_max_days    CONSTANT INTEGER := 4;
BEGIN
  IF p_date < v_today THEN
    RETURN json_build_object('error', 'Cannot modify a past date');
  END IF;

  v_week_start := p_date - ((EXTRACT(ISODOW FROM p_date)::integer) - 1);
  v_week_end   := v_week_start + 4;

  -- 1. Verify the caller owns this fixed spot (row-level lock on the spot)
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  -- 2. Same cap-aware FCFS promotion as release_and_promote
  FOR v_waitlist IN
    SELECT *
    FROM waitlist
    WHERE date = p_date
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1
      FROM weekly_allocations
      WHERE user_id = v_waitlist.user_id
        AND date = p_date
    ) THEN
      DELETE FROM waitlist WHERE id = v_waitlist.id;
      CONTINUE;
    END IF;

    SELECT COUNT(*)::integer INTO v_week_days
    FROM weekly_allocations
    WHERE user_id = v_waitlist.user_id
      AND date >= v_week_start
      AND date <= v_week_end;

    IF v_week_days >= c_max_days THEN
      CONTINUE;
    END IF;

    INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
    VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

    DELETE FROM waitlist WHERE id = v_waitlist.id;

    RETURN json_build_object(
      'released',         true,
      'promoted_user_id', v_waitlist.user_id
    );
  END LOOP;

  RETURN json_build_object(
    'released',         true,
    'promoted_user_id', NULL
  );
END;
$$;
