-- Migration 013: Lock down privileged database entry points
--
-- WHY THIS EXISTS
-- -------------------------------------------------------------------
-- SECURITY DEFINER RPCs execute with elevated privileges. PostgreSQL
-- grants EXECUTE on new functions to PUBLIC by default, which would let
-- authenticated clients call the release RPCs directly with an arbitrary
-- p_user_id instead of going through the server route that binds p_user_id
-- to the verified session.
--
-- The original profiles INSERT policy also allowed a user to create their
-- own profile row with any role value. If the signup trigger ever failed
-- to create a profile, a direct client insert could self-grant admin.
-- -------------------------------------------------------------------

-- Only server-side service-role code should be able to execute the
-- elevated release RPCs. The app's /api/release route already validates
-- the session user and calls these functions with the service client.
REVOKE EXECUTE ON FUNCTION public.release_and_promote(uuid, integer, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_and_promote(uuid, integer, date)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_fixed_and_promote(uuid, integer, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_fixed_and_promote(uuid, integer, date)
  TO service_role;

-- Pin SECURITY DEFINER name resolution to the intended schema.
ALTER FUNCTION public.release_and_promote(uuid, integer, date)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.release_fixed_and_promote(uuid, integer, date)
  SET search_path = public, pg_temp;

-- Direct profile inserts are only for creating the caller's own normal
-- user profile. Admin assignment must be done by trusted database/server
-- code, not by client-controlled INSERT payloads.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role = 'user'::public.user_role
  );
