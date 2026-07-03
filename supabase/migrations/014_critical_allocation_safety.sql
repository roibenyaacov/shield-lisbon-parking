-- Migration 014: critical allocation and fixed-spot release safety
--
-- Fixes:
--   1. Weekly allocation persistence must be atomic and idempotent by week.
--   2. Fixed-spot releases must be stored per day and maintained by the RPCs.
--   3. SECURITY DEFINER release RPCs must not be directly executable by clients.

-- -------------------------------------------------------------------------
-- Atomic weekly allocation persistence
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.allocation_runs (
  week_start   DATE        PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.allocation_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.save_weekly_allocation_results(
  p_week_start  DATE,
  p_allocations JSONB,
  p_waitlisted  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_end DATE := p_week_start + 4;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('weekly_allocation:' || p_week_start::TEXT)::BIGINT);

  IF EXISTS (
    SELECT 1
    FROM public.allocation_runs
    WHERE week_start = p_week_start
  ) THEN
    RETURN jsonb_build_object('saved', false, 'already_run', true);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_allocations, '[]'::jsonb)) AS a(date DATE)
    WHERE a.date < p_week_start OR a.date > v_week_end
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_waitlisted, '[]'::jsonb)) AS w(date DATE)
    WHERE w.date < p_week_start OR w.date > v_week_end
  ) THEN
    RAISE EXCEPTION 'Allocation payload contains dates outside target week %', p_week_start;
  END IF;

  DELETE FROM public.weekly_allocations
  WHERE date BETWEEN p_week_start AND v_week_end;

  DELETE FROM public.waitlist
  WHERE date BETWEEN p_week_start AND v_week_end;

  INSERT INTO public.weekly_allocations (user_id, spot_id, date, pass_number)
  SELECT a.user_id, a.spot_id, a.date, a.pass_number
  FROM jsonb_to_recordset(COALESCE(p_allocations, '[]'::jsonb)) AS a(
    user_id UUID,
    spot_id INTEGER,
    date DATE,
    pass_number INTEGER
  );

  INSERT INTO public.waitlist (user_id, date)
  SELECT w.user_id, w.date
  FROM jsonb_to_recordset(COALESCE(p_waitlisted, '[]'::jsonb)) AS w(
    user_id UUID,
    date DATE
  );

  INSERT INTO public.allocation_runs (week_start)
  VALUES (p_week_start);

  RETURN jsonb_build_object('saved', true, 'already_run', false);
END;
$$;

REVOKE ALL ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB) TO service_role;

-- -------------------------------------------------------------------------
-- Day-specific fixed-spot release markers
-- -------------------------------------------------------------------------

ALTER TABLE public.spot_releases
  ADD COLUMN IF NOT EXISTS date DATE;

ALTER TABLE public.spot_releases
  DROP CONSTRAINT IF EXISTS spot_releases_user_id_week_start_key;

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
  v_alloc_id         UUID;
  v_is_fixed_release BOOLEAN;
  v_waitlist         RECORD;
BEGIN
  SELECT wa.id,
         EXISTS (
           SELECT 1
           FROM public.parking_spots ps
           WHERE ps.id = wa.spot_id
             AND ps.fixed_user_id = p_user_id
         )
  INTO v_alloc_id, v_is_fixed_release
  FROM public.weekly_allocations wa
  WHERE wa.user_id = p_user_id
    AND wa.spot_id = p_spot_id
    AND wa.date    = p_date
  FOR UPDATE;

  IF v_alloc_id IS NULL THEN
    RETURN json_build_object('error', 'You do not have this allocation');
  END IF;

  DELETE FROM public.weekly_allocations
  WHERE id = v_alloc_id;

  IF v_is_fixed_release THEN
    INSERT INTO public.spot_releases (user_id, spot_id, week_start, date)
    VALUES (p_user_id, p_spot_id, date_trunc('week', p_date::timestamp)::date, p_date)
    ON CONFLICT (user_id, spot_id, date) DO NOTHING;
  END IF;

  SELECT * INTO v_waitlist
  FROM public.waitlist
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

  INSERT INTO public.weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

  DELETE FROM public.waitlist
  WHERE id = v_waitlist.id;

  RETURN json_build_object(
    'released',         true,
    'promoted_user_id', v_waitlist.user_id
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
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM public.parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.spot_releases
    WHERE user_id = p_user_id
      AND spot_id = p_spot_id
      AND date = p_date
  ) THEN
    RETURN json_build_object('error', 'Spot is already released for this day');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.weekly_allocations
    WHERE spot_id = p_spot_id
      AND date = p_date
  ) THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END IF;

  INSERT INTO public.spot_releases (user_id, spot_id, week_start, date)
  VALUES (p_user_id, p_spot_id, date_trunc('week', p_date::timestamp)::date, p_date);

  SELECT * INTO v_waitlist
  FROM public.waitlist
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

  INSERT INTO public.weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

  DELETE FROM public.waitlist
  WHERE id = v_waitlist.id;

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
BEGIN
  SELECT fixed_user_id INTO v_fixed_owner
  FROM public.parking_spots
  WHERE id = p_spot_id
  FOR UPDATE;

  IF v_fixed_owner IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('error', 'You do not own this fixed spot');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.weekly_allocations
    WHERE spot_id = p_spot_id
      AND date = p_date
  ) THEN
    RETURN json_build_object('error', 'Spot is already taken for this day');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.weekly_allocations
    WHERE user_id = p_user_id
      AND date = p_date
  ) THEN
    RETURN json_build_object('error', 'You already have a spot for this day');
  END IF;

  INSERT INTO public.weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (p_user_id, p_spot_id, p_date, 0);

  DELETE FROM public.spot_releases
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date = p_date;

  RETURN json_build_object('reclaimed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reclaim_fixed_spot(UUID, INTEGER, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.reclaim_fixed_spot(UUID, INTEGER, DATE) TO service_role;
