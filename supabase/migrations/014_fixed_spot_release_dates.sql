-- Migration 014: day-specific fixed-spot release markers
--
-- Fixed spot releases are selected per day in the UI, but the original
-- spot_releases table only had a week-level uniqueness constraint. Worse,
-- releasing a fixed spot that had no weekly_allocations row recorded no
-- marker at all, so the next allocation run treated the owner as coming.
--
-- This migration makes release markers per-date and records them inside the
-- release/reclaim RPC transactions.

ALTER TABLE public.spot_releases
  ADD COLUMN IF NOT EXISTS date DATE;

-- Allow more than one released day in a week for the same fixed spot.
ALTER TABLE public.spot_releases
  DROP CONSTRAINT IF EXISTS spot_releases_user_id_week_start_key;

-- Preserve any legacy week-level marker by expanding it to each weekday.
INSERT INTO public.spot_releases (user_id, spot_id, week_start, date, created_at)
SELECT legacy.user_id,
       legacy.spot_id,
       legacy.week_start,
       legacy.week_start + offs.day_offset,
       legacy.created_at
FROM public.spot_releases AS legacy
CROSS JOIN generate_series(0, 4) AS offs(day_offset)
WHERE legacy.date IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.spot_releases AS existing
    WHERE existing.user_id = legacy.user_id
      AND existing.spot_id = legacy.spot_id
      AND existing.date = legacy.week_start + offs.day_offset
  );

DELETE FROM public.spot_releases
WHERE date IS NULL;

ALTER TABLE public.spot_releases
  ALTER COLUMN date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_spot_releases_user_spot_date'
      AND conrelid = 'public.spot_releases'::regclass
  ) THEN
    ALTER TABLE public.spot_releases
      ADD CONSTRAINT uq_spot_releases_user_spot_date UNIQUE (user_id, spot_id, date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_spot_releases_date ON public.spot_releases(date);

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
  v_alloc_id         UUID;
  v_is_fixed_release BOOLEAN;
  v_waitlist         RECORD;
BEGIN
  -- 1. Verify ownership with a row-level lock to prevent concurrent races.
  SELECT wa.id,
         EXISTS (
           SELECT 1
           FROM parking_spots ps
           WHERE ps.id = wa.spot_id
             AND ps.fixed_user_id = p_user_id
         )
  INTO v_alloc_id, v_is_fixed_release
  FROM weekly_allocations wa
  WHERE wa.user_id = p_user_id
    AND wa.spot_id = p_spot_id
    AND wa.date    = p_date
  FOR UPDATE;

  IF v_alloc_id IS NULL THEN
    RETURN json_build_object('error', 'You do not have this allocation');
  END IF;

  -- 2. Release the spot.
  DELETE FROM weekly_allocations WHERE id = v_alloc_id;

  -- Fixed spot releases must survive future allocation runs for this date.
  IF v_is_fixed_release THEN
    INSERT INTO spot_releases (user_id, spot_id, week_start, date)
    VALUES (p_user_id, p_spot_id, date_trunc('week', p_date::timestamp)::date, p_date)
    ON CONFLICT (user_id, spot_id, date) DO NOTHING;
  END IF;

  -- 3. Claim the first waitlist entry (SKIP LOCKED avoids deadlock with
  --    a concurrent release running the same query simultaneously).
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

  -- 4. Atomically promote: insert new allocation and remove from waitlist.
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
  -- 1. Verify the caller owns this fixed spot (row-level lock on the spot).
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  INSERT INTO spot_releases (user_id, spot_id, week_start, date)
  VALUES (p_user_id, p_spot_id, date_trunc('week', p_date::timestamp)::date, p_date)
  ON CONFLICT (user_id, spot_id, date) DO NOTHING;

  -- 2. Grab the first waitlist entry for this date (SKIP LOCKED avoids
  --    deadlock when two concurrent releases run simultaneously).
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

  -- 3. Atomically promote: assign the released spot to the waitlist user.
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
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  IF EXISTS (
    SELECT 1 FROM weekly_allocations
    WHERE spot_id = p_spot_id
      AND date = p_date
  ) THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END IF;

  IF EXISTS (
    SELECT 1 FROM weekly_allocations
    WHERE user_id = p_user_id
      AND date = p_date
  ) THEN
    RETURN json_build_object('error', 'You already have a spot for this day');
  END IF;

  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (p_user_id, p_spot_id, p_date, 0);

  DELETE FROM spot_releases
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date = p_date;

  RETURN json_build_object('reclaimed', true);
END;
$$;
