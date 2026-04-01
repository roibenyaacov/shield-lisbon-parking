-- Migration 004: Prevent self-elevating to admin via profiles UPDATE
--
-- WHY THIS EXISTS
-- ───────────────────────────────────────────────────────────────────
-- The original "Users can update own profile" policy had no WITH CHECK
-- clause, which means any authenticated user could run:
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id)
--
-- and silently elevate themselves to admin.
--
-- The fix adds a WITH CHECK that asserts the role column may not change
-- from its current value.  All other profile fields (full_name, team,
-- vehicle_type) can still be updated freely by the owner.
-- ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent any client from changing the role column:
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
  );
