-- Migration 006: Temporarily assign spot #39 to roi2304@gmail.com for testing
--
-- ⚠️  TEMPORARY — remove before production launch
-- ───────────────────────────────────────────────────────────────────

-- 1. Assign spot #39 to roi2304@gmail.com (if already registered)
UPDATE public.parking_spots
SET fixed_user_id = (
  SELECT id FROM public.profiles WHERE email = 'roi2304@gmail.com'
)
WHERE label = '39';

-- 2. Update handle_new_user() to also auto-assign spot #39 on signup
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
  EXCEPTION WHEN invalid_text_representation THEN
    v_team := NULL;
  END;

  BEGIN
    v_vehicle_type := (NEW.raw_user_meta_data->>'vehicle_type')::vehicle_type_enum;
  EXCEPTION WHEN invalid_text_representation THEN
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

  -- Spot #40 → Raíssa Ramos
  IF NEW.email = 'raissa.ramos@shieldfc.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '40';
  END IF;

  -- Spot #39 → Roi (temporary, for testing)
  IF NEW.email = 'roi2304@gmail.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '39';
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
