-- Migration 013: restrict release promotion internals to trusted server code.
--
-- The release RPCs run as SECURITY DEFINER and trust their user_id argument.
-- They are called by the Next.js API through the service role after checking
-- the session user, so browser clients should not be able to execute them
-- directly with arbitrary user IDs. Waitlist rows are also produced by the
-- allocation job; letting clients insert their own rows lets them jump the
-- promotion queue on the next release.

REVOKE EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_and_promote(UUID, INTEGER, DATE) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_fixed_and_promote(UUID, INTEGER, DATE) TO service_role;

DROP POLICY IF EXISTS "Users can insert own waitlist entries" ON public.waitlist;
DROP POLICY IF EXISTS "Users can delete own waitlist entries" ON public.waitlist;
