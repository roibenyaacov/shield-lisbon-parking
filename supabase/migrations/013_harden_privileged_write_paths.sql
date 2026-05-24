-- Migration 013: Harden privileged write paths
--
-- Several server routes enforce business rules before writing with the
-- service role. The matching tables/functions must not remain directly
-- writable/callable by browser sessions, or clients can bypass those rules.

-- Only the server should execute release promotion RPCs. They trust their
-- arguments because /api/release binds p_user_id to the authenticated session.
ALTER FUNCTION public.release_and_promote(UUID, INTEGER, DATE)
  SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE)
  TO service_role;

ALTER FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE)
  SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE)
  TO service_role;

-- Request writes must go through /api/request, which validates the Lisbon
-- registration window, target week, and maximum number of requested days.
DROP POLICY IF EXISTS "Users can insert own requests" ON public.weekly_requests;
DROP POLICY IF EXISTS "Users can update own requests" ON public.weekly_requests;
DROP POLICY IF EXISTS "Users can delete own requests" ON public.weekly_requests;
DROP POLICY IF EXISTS "Service role can manage requests" ON public.weekly_requests;

CREATE POLICY "Service role can manage requests"
  ON public.weekly_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Waitlist membership is produced by allocation and consumed by release/claim
-- routes. Direct client inserts can poison the FIFO promotion queue.
DROP POLICY IF EXISTS "Users can insert own waitlist entries" ON public.waitlist;
DROP POLICY IF EXISTS "Users can delete own waitlist entries" ON public.waitlist;

-- If profile trigger creation ever fails, a client-side fallback insert must
-- still be unable to create an admin account.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role = 'user'::user_role
  );

-- Persist a full allocation week in one database transaction. The previous
-- application-side delete-then-insert sequence could erase the week if a later
-- insert failed after the deletes had already committed.
CREATE OR REPLACE FUNCTION public.save_weekly_allocation_results(
  p_week_start DATE,
  p_allocations JSONB DEFAULT '[]'::jsonb,
  p_waitlisted JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_week_end DATE := p_week_start + 5;
BEGIN
  IF p_week_start IS NULL THEN
    RAISE EXCEPTION 'week_start is required';
  END IF;

  p_allocations := COALESCE(p_allocations, '[]'::jsonb);
  p_waitlisted := COALESCE(p_waitlisted, '[]'::jsonb);

  IF jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'allocations payload must be an array';
  END IF;

  IF jsonb_typeof(p_waitlisted) <> 'array' THEN
    RAISE EXCEPTION 'waitlisted payload must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_allocations)
      AS allocation_row(user_id UUID, spot_id INTEGER, date DATE, pass_number INTEGER)
    WHERE allocation_row.user_id IS NULL
      OR allocation_row.spot_id IS NULL
      OR allocation_row.date IS NULL
      OR allocation_row.pass_number IS NULL
      OR allocation_row.date < p_week_start
      OR allocation_row.date >= v_week_end
  ) THEN
    RAISE EXCEPTION 'invalid allocation row in payload';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_waitlisted)
      AS waitlist_row(user_id UUID, date DATE)
    WHERE waitlist_row.user_id IS NULL
      OR waitlist_row.date IS NULL
      OR waitlist_row.date < p_week_start
      OR waitlist_row.date >= v_week_end
  ) THEN
    RAISE EXCEPTION 'invalid waitlist row in payload';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('save_weekly_allocation_results'),
    hashtext(p_week_start::text)
  );

  DELETE FROM public.weekly_allocations
  WHERE date >= p_week_start
    AND date < v_week_end;

  DELETE FROM public.waitlist
  WHERE date >= p_week_start
    AND date < v_week_end;

  INSERT INTO public.weekly_allocations (user_id, spot_id, date, pass_number)
  SELECT allocation_row.user_id,
         allocation_row.spot_id,
         allocation_row.date,
         allocation_row.pass_number
  FROM jsonb_to_recordset(p_allocations)
    AS allocation_row(user_id UUID, spot_id INTEGER, date DATE, pass_number INTEGER);

  INSERT INTO public.waitlist (user_id, date)
  SELECT waitlist_row.user_id,
         waitlist_row.date
  FROM jsonb_to_recordset(p_waitlisted)
    AS waitlist_row(user_id UUID, date DATE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_weekly_allocation_results(DATE, JSONB, JSONB)
  TO service_role;
