-- Migration 013: Persist fixed-spot releases per date
--
-- Fixed-spot release actions were only mutating weekly_allocations/waitlist,
-- but runAllocation() suppresses fixed reservations from spot_releases. Store
-- the exact released date so a release survives reloads and future allocation
-- runs without suppressing the whole week.

ALTER TABLE public.spot_releases
  ADD COLUMN IF NOT EXISTS date DATE;

UPDATE public.spot_releases
SET date = week_start
WHERE date IS NULL;

ALTER TABLE public.spot_releases
  ALTER COLUMN date SET NOT NULL;

ALTER TABLE public.spot_releases
  DROP CONSTRAINT IF EXISTS spot_releases_user_id_week_start_key;

ALTER TABLE public.spot_releases
  ADD CONSTRAINT spot_releases_user_spot_date_key UNIQUE (user_id, spot_id, date);

CREATE INDEX IF NOT EXISTS idx_spot_releases_date
  ON public.spot_releases(date);

CREATE OR REPLACE FUNCTION release_and_promote(
  p_user_id UUID,
  p_spot_id INTEGER,
  p_date    DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alloc_id UUID;
  v_fixed_owner UUID;
  v_waitlist RECORD;
BEGIN
  SELECT id INTO v_alloc_id
  FROM weekly_allocations
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date    = p_date
  FOR UPDATE;

  IF v_alloc_id IS NULL THEN
    RETURN json_build_object('error', 'You do not have this allocation');
  END IF;

  DELETE FROM weekly_allocations WHERE id = v_alloc_id;

  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id;

  IF v_fixed_owner = p_user_id THEN
    INSERT INTO spot_releases (user_id, spot_id, week_start, date)
    VALUES (
      p_user_id,
      p_spot_id,
      (p_date - ((EXTRACT(ISODOW FROM p_date)::INTEGER - 1) * INTERVAL '1 day'))::DATE,
      p_date
    )
    ON CONFLICT (user_id, spot_id, date) DO NOTHING;
  END IF;

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
AS $$
DECLARE
  v_fixed_owner UUID;
  v_waitlist    RECORD;
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  INSERT INTO spot_releases (user_id, spot_id, week_start, date)
  VALUES (
    p_user_id,
    p_spot_id,
    (p_date - ((EXTRACT(ISODOW FROM p_date)::INTEGER - 1) * INTERVAL '1 day'))::DATE,
    p_date
  )
  ON CONFLICT (user_id, spot_id, date) DO NOTHING;

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
