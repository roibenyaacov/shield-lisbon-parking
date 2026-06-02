-- Migration 014: atomic weekly allocation persistence
--
-- The application used to save a weekly allocation by deleting each weekday's
-- allocation/waitlist rows and then inserting the new rows in separate client
-- requests.  A concurrent cron/admin run or any insert failure after the
-- deletes could wipe the week.  This RPC serializes each week with an advisory
-- lock and runs the delete/insert/marker writes inside one database transaction.

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

  IF EXISTS (
    SELECT 1
    FROM public.weekly_allocations
    WHERE date BETWEEN p_week_start AND v_week_end
  ) OR EXISTS (
    SELECT 1
    FROM public.waitlist
    WHERE date BETWEEN p_week_start AND v_week_end
  ) THEN
    RAISE EXCEPTION 'Allocation rows already exist for week % without an allocation run marker', p_week_start;
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

REVOKE ALL ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB) TO service_role;
