-- Migration 009: Remove Roi's fixed spot assignment and user account
--
-- Spot #39 becomes a regular allocation spot (no longer fixed).
-- Only Raíssa Ramos keeps a fixed spot (#40).
-- Roi's profile and auth user are deleted.
-- The handle_new_user trigger is updated to remove the Roi auto-assign block.
-- ───────────────────────────────────────────────────────────────────

-- 1. Clear the fixed_user_id and reserved_name from spot #39
UPDATE public.parking_spots
SET fixed_user_id = NULL,
    reserved_name = NULL
WHERE label = '39';

-- 2. Delete Roi's weekly data (allocations, requests, waitlist, releases)
DELETE FROM public.weekly_allocations
WHERE user_id IN (SELECT id FROM public.profiles WHERE email = 'roi2304@gmail.com');

DELETE FROM public.weekly_requests
WHERE user_id IN (SELECT id FROM public.profiles WHERE email = 'roi2304@gmail.com');

DELETE FROM public.waitlist
WHERE user_id IN (SELECT id FROM public.profiles WHERE email = 'roi2304@gmail.com');

DELETE FROM public.spot_releases
WHERE user_id IN (SELECT id FROM public.profiles WHERE email = 'roi2304@gmail.com');

-- 3. Delete Roi's profile
DELETE FROM public.profiles WHERE email = 'roi2304@gmail.com';

-- 4. Delete Roi from auth.users (requires service role / superuser)
DELETE FROM auth.users WHERE email = 'roi2304@gmail.com';

-- 5. Re-create handle_new_user WITHOUT the Roi spot #39 block
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team         team_enum;
  v_vehicle_type vehicle_type_enum;
BEGIN
  BEGIN
    v_team := (NEW.raw_user_meta_data->>'team')::team_enum;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'handle_new_user: invalid team value "%" for user %, defaulting to NULL',
      NEW.raw_user_meta_data->>'team', NEW.id;
    v_team := NULL;
  END;

  BEGIN
    v_vehicle_type := (NEW.raw_user_meta_data->>'vehicle_type')::vehicle_type_enum;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'handle_new_user: invalid vehicle_type value "%" for user %, defaulting to NULL',
      NEW.raw_user_meta_data->>'vehicle_type', NEW.id;
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

  -- Spot #40 → Raíssa Ramos (only remaining fixed spot)
  IF NEW.email = 'raissa.ramos@shieldfc.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '40';
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
