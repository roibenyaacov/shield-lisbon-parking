-- Migration 014: Harden client-write and RPC authorization boundaries
--
-- Critical allocation/profile state is written through authenticated API
-- routes using the service role.  Direct browser Supabase writes bypass the
-- route-level time/auth checks, so keep client access read-only here.

-- Missing profiles may still be self-created, but never with elevated role.
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role = 'user'
  );

-- Weekly request writes must pass through /api/request, which enforces the
-- Lisbon registration window and derives user_id from the verified session.
DROP POLICY IF EXISTS "Users can insert own requests" ON weekly_requests;
DROP POLICY IF EXISTS "Users can update own requests" ON weekly_requests;
DROP POLICY IF EXISTS "Users can delete own requests" ON weekly_requests;

-- Waitlist rows are allocation results.  Direct client inserts can jump the
-- waitlist and direct deletes can remove another promotion opportunity.
DROP POLICY IF EXISTS "Users can insert own waitlist entries" ON waitlist;
DROP POLICY IF EXISTS "Users can delete own waitlist entries" ON waitlist;

-- Release RPCs are SECURITY DEFINER and trust p_user_id supplied by the API.
-- Do not expose them to browser clients where p_user_id can be forged.
ALTER FUNCTION release_and_promote(UUID, INTEGER, DATE) SET search_path = public;
ALTER FUNCTION release_fixed_and_promote(UUID, INTEGER, DATE) SET search_path = public;

REVOKE EXECUTE ON FUNCTION release_and_promote(UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION release_fixed_and_promote(UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION release_and_promote(UUID, INTEGER, DATE)
  TO service_role;
GRANT EXECUTE ON FUNCTION release_fixed_and_promote(UUID, INTEGER, DATE)
  TO service_role;
