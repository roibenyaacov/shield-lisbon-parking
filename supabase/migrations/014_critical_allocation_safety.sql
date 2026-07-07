-- Migration 014: Critical allocation persistence and fixed-release safety
--
-- Keep weekly allocation publication atomic and mark fixed-spot releases by
-- date so later allocation runs and the fixed-owner UI do not silently undo a
-- released day.

CREATE TABLE IF NOT EXISTS public.allocation_runs (
  week_start DATE PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.allocation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage allocation runs" ON public.allocation_runs;
CREATE POLICY "Service role can manage allocation runs"
  ON public.allocation_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.spot_releases
  ADD COLUMN IF NOT EXISTS date DATE;

-- The original uniqueness was week-wide, which made it impossible to release
-- several specific days in the same week.
ALTER TABLE public.spot_releases
  DROP CONSTRAINT IF EXISTS spot_releases_user_id_week_start_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_spot_releases_user_spot_date
  ON public.spot_releases(user_id, spot_id, date)
  WHERE date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spot_releases_date
  ON public.spot_releases(date);

CREATE OR REPLACE FUNCTION public.save_weekly_allocation_results(
  p_week_start  DATE,
  p_allocations JSONB,
  p_waitlist    JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_end DATE := p_week_start + 4;
BEGIN
  -- Serialize concurrent admin/cron runs for the same week.  Everything below
  -- commits or rolls back as one database transaction.
  PERFORM pg_advisory_xact_lock(hashtext('weekly_allocation:' || p_week_start::text));

  IF EXISTS (SELECT 1 FROM allocation_runs WHERE week_start = p_week_start) THEN
    RETURN json_build_object('already_run', true);
  END IF;

  DELETE FROM weekly_allocations
  WHERE date BETWEEN p_week_start AND v_week_end;

  DELETE FROM waitlist
  WHERE date BETWEEN p_week_start AND v_week_end;

  IF jsonb_array_length(COALESCE(p_allocations, '[]'::jsonb)) > 0 THEN
    INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
    SELECT user_id, spot_id, date, pass_number
    FROM jsonb_to_recordset(p_allocations) AS x(
      user_id UUID,
      spot_id INTEGER,
      date DATE,
      pass_number INTEGER
    );
  END IF;

  IF jsonb_array_length(COALESCE(p_waitlist, '[]'::jsonb)) > 0 THEN
    INSERT INTO waitlist (user_id, date)
    SELECT user_id, date
    FROM jsonb_to_recordset(p_waitlist) AS x(
      user_id UUID,
      date DATE
    );
  END IF;

  INSERT INTO allocation_runs (week_start)
  VALUES (p_week_start);

  RETURN json_build_object('already_run', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_and_promote(
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
  v_alloc_id       UUID;
  v_waitlist       RECORD;
  v_fixed_owner_id UUID;
  v_week_start     DATE := p_date - ((EXTRACT(ISODOW FROM p_date)::INTEGER - 1));
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner_id
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

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

  IF v_fixed_owner_id IS NOT DISTINCT FROM p_user_id THEN
    INSERT INTO spot_releases (user_id, spot_id, week_start, date)
    VALUES (p_user_id, p_spot_id, v_week_start, p_date)
    ON CONFLICT (user_id, spot_id, date) WHERE date IS NOT NULL DO NOTHING;
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

CREATE OR REPLACE FUNCTION public.release_fixed_and_promote(
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
  v_week_start  DATE := p_date - ((EXTRACT(ISODOW FROM p_date)::INTEGER - 1));
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  INSERT INTO spot_releases (user_id, spot_id, week_start, date)
  VALUES (p_user_id, p_spot_id, v_week_start, p_date)
  ON CONFLICT (user_id, spot_id, date) WHERE date IS NOT NULL DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.reclaim_fixed_spot(
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
  v_existing_id UUID;
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  SELECT id INTO v_existing_id
  FROM weekly_allocations
  WHERE spot_id = p_spot_id
    AND date = p_date
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END IF;

  SELECT id INTO v_existing_id
  FROM weekly_allocations
  WHERE user_id = p_user_id
    AND date = p_date
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    RETURN json_build_object('error', 'You already have a spot for this day');
  END IF;

  BEGIN
    INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
    VALUES (p_user_id, p_spot_id, p_date, 0);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END;

  DELETE FROM spot_releases
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date = p_date;

  RETURN json_build_object('reclaimed', true);
END;
$$;
