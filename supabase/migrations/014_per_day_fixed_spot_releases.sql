-- Migration 014: Persist fixed-spot releases per day
--
-- Fixed-spot owners can release individual weekdays before weekly allocation
-- has created allocation rows. Those releases need their own durable marker;
-- absence of a weekly_allocations row is also the normal default state before
-- allocation runs.

ALTER TABLE public.spot_releases
  ADD COLUMN IF NOT EXISTS date DATE;

-- Existing application code did not write spot_releases. If any legacy rows
-- exist, preserve them as a release for their stored week_start date.
UPDATE public.spot_releases
SET date = week_start
WHERE date IS NULL;

ALTER TABLE public.spot_releases
  ALTER COLUMN date SET NOT NULL;

ALTER TABLE public.spot_releases
  DROP CONSTRAINT IF EXISTS spot_releases_user_id_week_start_key;

ALTER TABLE public.spot_releases
  ADD CONSTRAINT spot_releases_user_id_spot_id_date_key
  UNIQUE (user_id, spot_id, date);

CREATE INDEX IF NOT EXISTS idx_spot_releases_date
  ON public.spot_releases(date);

-- Fixed-spot release with waitlist promotion in one transaction.
-- Handles both explicit allocation rows and the default reserved state.
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
  v_alloc_id    UUID;
  v_alloc_owner UUID;
  v_waitlist    RECORD;
  v_week_start  DATE;
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  SELECT id, user_id INTO v_alloc_id, v_alloc_owner
  FROM weekly_allocations
  WHERE spot_id = p_spot_id
    AND date = p_date
  FOR UPDATE;

  IF v_alloc_owner IS NOT NULL AND v_alloc_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END IF;

  v_week_start := (p_date - ((EXTRACT(ISODOW FROM p_date)::INTEGER - 1) * INTERVAL '1 day'))::DATE;

  INSERT INTO spot_releases (user_id, spot_id, week_start, date)
  VALUES (p_user_id, p_spot_id, v_week_start, p_date)
  ON CONFLICT (user_id, spot_id, date) DO UPDATE
  SET week_start = EXCLUDED.week_start;

  IF v_alloc_id IS NOT NULL THEN
    DELETE FROM weekly_allocations WHERE id = v_alloc_id;
  END IF;

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

  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

  DELETE FROM waitlist WHERE id = v_waitlist.id;

  RETURN json_build_object(
    'released',         true,
    'promoted_user_id', v_waitlist.user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION reclaim_fixed_spot(
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
  v_spot_alloc  UUID;
  v_user_alloc  UUID;
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  SELECT id INTO v_spot_alloc
  FROM weekly_allocations
  WHERE spot_id = p_spot_id
    AND date = p_date
  FOR UPDATE;

  IF v_spot_alloc IS NOT NULL THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END IF;

  SELECT id INTO v_user_alloc
  FROM weekly_allocations
  WHERE user_id = p_user_id
    AND date = p_date
  FOR UPDATE;

  IF v_user_alloc IS NOT NULL THEN
    RETURN json_build_object('error', 'You already have a spot for this day');
  END IF;

  DELETE FROM spot_releases
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date = p_date;

  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (p_user_id, p_spot_id, p_date, 0);

  RETURN json_build_object('success', true, 'reclaimed', true);
END;
$$;
