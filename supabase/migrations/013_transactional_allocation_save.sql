-- Migration 013: Save weekly allocation results atomically
--
-- A failed insert after deleting the week used to leave weekly_allocations
-- and waitlist empty. This RPC replaces the week inside one transaction and
-- records a durable completion marker so manual claims cannot spoof a
-- completed Friday allocation run.

CREATE TABLE IF NOT EXISTS public.allocation_runs (
  week_start       DATE PRIMARY KEY,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocation_count INTEGER NOT NULL DEFAULT 0 CHECK (allocation_count >= 0),
  waitlist_count   INTEGER NOT NULL DEFAULT 0 CHECK (waitlist_count >= 0)
);

ALTER TABLE public.allocation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage allocation runs" ON public.allocation_runs;
CREATE POLICY "Service role can manage allocation runs"
  ON public.allocation_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.allocation_runs FROM anon, authenticated;
GRANT ALL ON TABLE public.allocation_runs TO service_role;

CREATE OR REPLACE FUNCTION public.save_weekly_allocation_results(
  p_week_start  DATE,
  p_allocations JSONB DEFAULT '[]'::jsonb,
  p_waitlist    JSONB DEFAULT '[]'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_end         DATE := p_week_start + 4;
  v_allocation_count INTEGER := 0;
  v_waitlist_count   INTEGER := 0;
BEGIN
  p_allocations := COALESCE(p_allocations, '[]'::jsonb);
  p_waitlist := COALESCE(p_waitlist, '[]'::jsonb);

  IF jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_allocations must be a JSON array';
  END IF;

  IF jsonb_typeof(p_waitlist) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_waitlist must be a JSON array';
  END IF;

  -- Serialize concurrent cron/admin runs for the same target week.
  PERFORM pg_advisory_xact_lock(
    hashtext('save_weekly_allocation_results'),
    hashtext(p_week_start::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.allocation_runs
    WHERE week_start = p_week_start
  ) THEN
    RETURN json_build_object('saved', false, 'already_run', true);
  END IF;

  DELETE FROM public.weekly_allocations
  WHERE date BETWEEN p_week_start AND v_week_end;

  DELETE FROM public.waitlist
  WHERE date BETWEEN p_week_start AND v_week_end;

  IF jsonb_array_length(p_allocations) > 0 THEN
    INSERT INTO public.weekly_allocations (user_id, spot_id, date, pass_number)
    SELECT user_id, spot_id, date, pass_number
    FROM jsonb_to_recordset(p_allocations) AS allocation_rows(
      user_id UUID,
      spot_id INTEGER,
      date DATE,
      pass_number INTEGER
    );
  END IF;

  IF jsonb_array_length(p_waitlist) > 0 THEN
    INSERT INTO public.waitlist (user_id, date)
    SELECT user_id, date
    FROM jsonb_to_recordset(p_waitlist) AS waitlist_rows(
      user_id UUID,
      date DATE
    );
  END IF;

  SELECT COUNT(*) INTO v_allocation_count
  FROM public.weekly_allocations
  WHERE date BETWEEN p_week_start AND v_week_end;

  SELECT COUNT(*) INTO v_waitlist_count
  FROM public.waitlist
  WHERE date BETWEEN p_week_start AND v_week_end;

  INSERT INTO public.allocation_runs (week_start, allocation_count, waitlist_count)
  VALUES (p_week_start, v_allocation_count, v_waitlist_count);

  RETURN json_build_object(
    'saved', true,
    'already_run', false,
    'allocation_count', v_allocation_count,
    'waitlist_count', v_waitlist_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB)
  TO service_role;
