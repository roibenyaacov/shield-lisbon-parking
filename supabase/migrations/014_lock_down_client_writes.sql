-- Migration 014: Lock down client-side writes that bypass API validation
--
-- Request timing/day-count validation and waitlist placement are enforced in
-- server routes and allocation code. Authenticated clients must not be able to
-- write those tables directly through PostgREST.

DROP POLICY IF EXISTS "Users can insert own requests" ON public.weekly_requests;
DROP POLICY IF EXISTS "Users can update own requests" ON public.weekly_requests;
DROP POLICY IF EXISTS "Users can delete own requests" ON public.weekly_requests;

DROP POLICY IF EXISTS "Users can insert own waitlist entries" ON public.waitlist;
DROP POLICY IF EXISTS "Users can delete own waitlist entries" ON public.waitlist;

-- The release RPCs are called by trusted server routes with the service role.
-- Without these revokes, authenticated clients can call SECURITY DEFINER RPCs
-- directly with an arbitrary p_user_id and force-release someone else's spot.
REVOKE ALL ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE)
  TO service_role;

REVOKE ALL ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE)
  TO service_role;
