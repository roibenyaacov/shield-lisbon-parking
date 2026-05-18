-- Migration 013: Save weekly allocation results atomically
--
-- Replacing a week's allocations used to happen as separate client-side
-- DELETE and INSERT calls. If an insert failed after the deletes committed,
-- the week could be left with no allocations or waitlist rows. This RPC keeps
-- the replacement in one database transaction, so any failure rolls back the
-- whole operation.

CREATE OR REPLACE FUNCTION save_weekly_allocation_results(
  p_week_start  DATE,
  p_allocations JSONB DEFAULT '[]'::JSONB,
  p_waitlisted  JSONB DEFAULT '[]'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_dates DATE[];
BEGIN
  p_allocations := COALESCE(p_allocations, '[]'::JSONB);
  p_waitlisted := COALESCE(p_waitlisted, '[]'::JSONB);

  IF jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'p_allocations must be a JSON array';
  END IF;

  IF jsonb_typeof(p_waitlisted) <> 'array' THEN
    RAISE EXCEPTION 'p_waitlisted must be a JSON array';
  END IF;

  SELECT ARRAY(
    SELECT p_week_start + day_offset
    FROM generate_series(0, 4) AS offsets(day_offset)
  )
  INTO v_week_dates;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_allocations) AS allocation_row(date DATE)
    WHERE allocation_row.date IS NULL
       OR NOT (allocation_row.date = ANY(v_week_dates))
  ) THEN
    RAISE EXCEPTION 'allocation dates must be within the target week';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_waitlisted) AS waitlist_row(date DATE)
    WHERE waitlist_row.date IS NULL
       OR NOT (waitlist_row.date = ANY(v_week_dates))
  ) THEN
    RAISE EXCEPTION 'waitlist dates must be within the target week';
  END IF;

  DELETE FROM weekly_allocations
  WHERE date = ANY(v_week_dates);

  DELETE FROM waitlist
  WHERE date = ANY(v_week_dates);

  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  SELECT user_id, spot_id, date, pass_number
  FROM jsonb_to_recordset(p_allocations) AS allocation_row(
    user_id UUID,
    spot_id INTEGER,
    date DATE,
    pass_number INTEGER
  );

  INSERT INTO waitlist (user_id, date)
  SELECT user_id, date
  FROM jsonb_to_recordset(p_waitlisted) AS waitlist_row(
    user_id UUID,
    date DATE
  );
END;
$$;

REVOKE ALL ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION save_weekly_allocation_results(DATE, JSONB, JSONB) TO service_role;
