-- Migration 013: Atomic weekly allocation save and explicit run marker
--
-- Allocation completion must not be inferred from weekly_allocations rows:
-- manual claims/reclaims can create isolated rows before cron runs.  Saving
-- results also needs to be all-or-nothing so an insert failure cannot leave
-- a week empty after deletes have already committed.

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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
  v_inserted_week DATE;
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

  INSERT INTO allocation_runs (week_start, created_at)
  VALUES (p_week_start, now())
  ON CONFLICT (week_start) DO NOTHING
  RETURNING week_start INTO v_inserted_week;

  IF v_inserted_week IS NULL THEN
    RETURN jsonb_build_object('already_run', true);
  END IF;

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

  RETURN jsonb_build_object('already_run', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB)
  TO service_role;
