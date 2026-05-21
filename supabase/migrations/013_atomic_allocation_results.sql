-- Migration 013: Atomic weekly allocation save and run marker
--
-- The allocation endpoint must not infer "already ran" from rows in
-- weekly_allocations because users can manually claim/reclaim individual
-- days before cron runs.  It also must not delete a week and then insert
-- replacement rows across separate client round-trips: any insert failure
-- would leave the week empty.

CREATE TABLE IF NOT EXISTS allocation_runs (
  week_start DATE PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE allocation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage allocation runs" ON allocation_runs;

CREATE POLICY "Service role can manage allocation runs"
  ON allocation_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION save_weekly_allocation_results(
  p_week_start  DATE,
  p_allocations JSONB,
  p_waitlisted  JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
BEGIN
  IF p_week_start IS NULL THEN
    RAISE EXCEPTION 'week_start is required';
  END IF;

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'allocations must be a JSON array';
  END IF;

  IF p_waitlisted IS NULL OR jsonb_typeof(p_waitlisted) <> 'array' THEN
    RAISE EXCEPTION 'waitlisted must be a JSON array';
  END IF;

  -- Serialize saves for the same week so a retry/admin click cannot
  -- interleave the delete/insert sequence with another allocation run.
  PERFORM pg_advisory_xact_lock(hashtext('weekly_allocation:' || p_week_start::text));

  FOR v_date IN
    SELECT p_week_start + offset_value
    FROM generate_series(0, 4) AS offsets(offset_value)
  LOOP
    DELETE FROM waitlist WHERE date = v_date;
    DELETE FROM weekly_allocations WHERE date = v_date;
  END LOOP;

  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  SELECT
    (item.value->>'user_id')::uuid,
    (item.value->>'spot_id')::integer,
    (item.value->>'date')::date,
    (item.value->>'pass_number')::integer
  FROM jsonb_array_elements(p_allocations) AS item(value);

  INSERT INTO waitlist (user_id, date)
  SELECT
    (item.value->>'user_id')::uuid,
    (item.value->>'date')::date
  FROM jsonb_array_elements(p_waitlisted) AS item(value);

  INSERT INTO allocation_runs (week_start, created_at)
  VALUES (p_week_start, now())
  ON CONFLICT (week_start) DO UPDATE
    SET created_at = EXCLUDED.created_at;
END;
$$;

REVOKE ALL ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB)
  TO service_role;
