-- Migration 002: Hardened trigger + atomic release_and_promote RPC
-- Run this in Supabase SQL Editor AFTER 001_initial_schema.sql

-- ============================================
-- FIX: Harden handle_new_user trigger
--
-- The original trigger would throw (and block
-- the signup) if the enum cast failed on an
-- unexpected metadata value.  Wrapping each
-- cast in its own BEGIN/EXCEPTION block makes
-- the function safe: bad metadata falls back
-- to NULL rather than aborting user creation.
-- An outer EXCEPTION clause ensures that even
-- an unexpected error (e.g. schema mismatch)
-- never blocks auth.users INSERT.
-- ============================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public          -- Required: trigger fires from auth schema; without this,
AS $$                             -- PostgreSQL won't find team_enum / vehicle_type_enum in public.
DECLARE
  v_team         team_enum;
  v_vehicle_type vehicle_type_enum;
BEGIN
  -- Safe enum cast: invalid value → NULL instead of error
  BEGIN
    v_team := (NEW.raw_user_meta_data->>'team')::team_enum;
  EXCEPTION WHEN others THEN
    v_team := NULL;
  END;

  BEGIN
    v_vehicle_type := (NEW.raw_user_meta_data->>'vehicle_type')::vehicle_type_enum;
  EXCEPTION WHEN others THEN
    v_vehicle_type := NULL;
  END;

  INSERT INTO public.profiles (id, email, full_name, team, vehicle_type)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    v_team,
    v_vehicle_type
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name    = COALESCE(EXCLUDED.full_name,    profiles.full_name),
    team         = COALESCE(EXCLUDED.team,         profiles.team),
    vehicle_type = COALESCE(EXCLUDED.vehicle_type, profiles.vehicle_type);

  -- Auto-assign fixed spots based on email
  IF NEW.email = 'raissa.ramos@shieldfc.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '40';
  END IF;

  -- Spot 39 → Roi (temporary, for testing)
  IF NEW.email = 'roi2304@gmail.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '39';
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Never block user creation due to a profile error
  RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


-- ============================================
-- NEW: Atomic release_and_promote RPC
--
-- Replaces the three-step API sequence
-- (DELETE allocation → SELECT waitlist →
--  INSERT allocation + DELETE waitlist) with
-- a single database transaction.
--
-- Guarantees:
--   • Ownership verified before any mutation.
--   • The released spot and the promoted
--     allocation are never both absent at the
--     same time (no orphaned spot window).
--   • FOR UPDATE / SKIP LOCKED prevents two
--     concurrent releases promoting the same
--     waitlist entry.
--
-- Returns JSON:
--   { "released": true, "promoted_user_id": "<uuid>" }
--   { "released": true, "promoted_user_id": null }
--   { "error": "<message>" }
-- ============================================

CREATE OR REPLACE FUNCTION release_and_promote(
  p_user_id UUID,
  p_spot_id INTEGER,
  p_date    DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alloc_id UUID;
  v_waitlist RECORD;
BEGIN
  -- 1. Verify ownership with a row-level lock to prevent concurrent races
  SELECT id INTO v_alloc_id
  FROM weekly_allocations
  WHERE user_id = p_user_id
    AND spot_id = p_spot_id
    AND date    = p_date
  FOR UPDATE;

  IF v_alloc_id IS NULL THEN
    RETURN json_build_object('error', 'You do not have this allocation');
  END IF;

  -- 2. Release the spot
  DELETE FROM weekly_allocations WHERE id = v_alloc_id;

  -- 3. Claim the first waitlist entry (SKIP LOCKED avoids deadlock with
  --    a concurrent release running the same query simultaneously)
  SELECT * INTO v_waitlist
  FROM waitlist
  WHERE date = p_date
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_waitlist IS NULL THEN
    RETURN json_build_object(
      'released',          true,
      'promoted_user_id',  NULL
    );
  END IF;

  -- 4. Atomically promote: insert new allocation and remove from waitlist
  INSERT INTO weekly_allocations (user_id, spot_id, date, pass_number)
  VALUES (v_waitlist.user_id, p_spot_id, p_date, 4);

  DELETE FROM waitlist WHERE id = v_waitlist.id;

  RETURN json_build_object(
    'released',          true,
    'promoted_user_id',  v_waitlist.user_id
  );
END;
$$;
