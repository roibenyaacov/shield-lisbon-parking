-- Migration 005: Multiple spot changes
--
-- CHANGES
-- ───────────────────────────────────────────────────────────────────
-- 1. Clear the fixed_user_id on spot #49 so Rita Vaz no longer has a
--    reserved spot.  Spot #49 becomes a regular general allocation spot.
--
-- 2. Move Raíssa Ramos' fixed assignment from spot #39 to spot #40.
--    Spot #39 becomes a regular general allocation spot.
--
-- 3. Remove the Rita Vaz branch from handle_new_user() and update
--    the Raíssa branch to reference label '40'.
--
-- 4. Swap spot labels '1' ↔ '2' so the motorcycle spot is labelled 2
--    and the previously-general spot is labelled 1.
--    (labels are display-only; all FK references use the spot UUID)
-- ───────────────────────────────────────────────────────────────────

-- 1. Release spot #49 from Rita Vaz
UPDATE public.parking_spots
SET fixed_user_id = NULL
WHERE label = '49';

-- 2. Move Raíssa's fixed assignment: #39 → #40
--    Copy the existing fixed_user_id from spot 39 to spot 40,
--    then clear it from spot 39.
UPDATE public.parking_spots
SET fixed_user_id = (
  SELECT fixed_user_id FROM public.parking_spots WHERE label = '39'
)
WHERE label = '40';

UPDATE public.parking_spots
SET fixed_user_id = NULL
WHERE label = '39';

-- 3. Swap motorcycle label: '1' → '2' and '2' → '1'
--    Use a temporary value to avoid a unique-constraint collision.
UPDATE public.parking_spots SET label = '__tmp__' WHERE label = '1';
UPDATE public.parking_spots SET label = '1'       WHERE label = '2';
UPDATE public.parking_spots SET label = '2'       WHERE label = '__tmp__';

-- 4. Update handle_new_user() — drop Rita Vaz branch, update Raíssa to spot #40
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
