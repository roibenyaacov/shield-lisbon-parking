-- Migration 003: Ensure enums exist + document handle_new_user metadata mapping
--
-- WHY THIS FILE EXISTS
-- ─────────────────────────────────────────────────────────────────────────────
-- The 500 error on signup was traced to missing enum types in the live database.
-- This migration safely creates team_enum and vehicle_type_enum (idempotent: it
-- does nothing if they already exist) and re-applies handle_new_user with
-- explicit comments showing exactly how the form metadata maps to each enum.
--
-- IMPORTANT — enum values use SHORT CODES, not display labels
-- ─────────────────────────────────────────────────────────────────────────────
-- The SignupForm renders teams/vehicles from TEAM_LABELS / VEHICLE_LABELS in
-- lib/constants.ts.  Those constants map:
--
--   Database value  ←→  Display label shown in UI
--   ─────────────────────────────────────────────
--   'cs'            ←→  'CS Team'
--   'cloudops'      ←→  'CloudOps'
--   'pm'            ←→  'PMs'
--   'sm'            ←→  'SMs'
--   'marketing'     ←→  'Marketing'
--   'data_sources'  ←→  'Data Sources'
--   'devops'        ←→  'DevOps'
--   'app_team'      ←→  'App Team'
--   ─────────────────────────────────────────────
--   'car'           ←→  'Car'
--   'electric'      ←→  'Electric Vehicle'
--   'motorcycle'    ←→  'Motorcycle'
--
-- The form submits the KEY ('cs', 'electric', …) as auth metadata.
-- The trigger casts that key directly to the enum type.
-- Using display labels as enum values would break every signup.
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================
-- STEP 1 — Create enums (idempotent)
--
-- PostgreSQL has no CREATE TYPE IF NOT EXISTS,
-- so we use the standard DO/EXCEPTION pattern.
-- ============================================

DO $$ BEGIN
  CREATE TYPE team_enum AS ENUM (
    'cs',           -- display: 'CS Team'
    'cloudops',     -- display: 'CloudOps'
    'pm',           -- display: 'PMs'
    'sm',           -- display: 'SMs'
    'marketing',    -- display: 'Marketing'
    'data_sources', -- display: 'Data Sources'
    'devops',       -- display: 'DevOps'
    'app_team'      -- display: 'App Team'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'team_enum already exists, skipping.';
END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_type_enum AS ENUM (
    'car',          -- display: 'Car'
    'electric',     -- display: 'Electric Vehicle'
    'motorcycle'    -- display: 'Motorcycle'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'vehicle_type_enum already exists, skipping.';
END $$;


-- ============================================
-- STEP 2 — Ensure profiles columns use the
--           correct types.
--
-- If 001_initial_schema.sql was never run the
-- columns won't exist yet; if it was partially
-- run they may already be correct.  Both cases
-- are handled by the DO/EXCEPTION wrappers.
-- ============================================

DO $$ BEGIN
  -- Add 'team' column if missing
  ALTER TABLE public.profiles
    ADD COLUMN team team_enum;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'profiles.team already exists, skipping.';
END $$;

DO $$ BEGIN
  -- Add 'vehicle_type' column if missing
  ALTER TABLE public.profiles
    ADD COLUMN vehicle_type vehicle_type_enum;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'profiles.vehicle_type already exists, skipping.';
END $$;

-- If the columns already exist but were created as TEXT, cast them over.
-- This is a no-op when the columns are already the correct enum type.
DO $$ BEGIN
  ALTER TABLE public.profiles
    ALTER COLUMN team         TYPE team_enum         USING team::team_enum;
  ALTER TABLE public.profiles
    ALTER COLUMN vehicle_type TYPE vehicle_type_enum USING vehicle_type::vehicle_type_enum;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Column type already correct, skipping cast: %', SQLERRM;
END $$;


-- ============================================
-- STEP 3 — Re-apply handle_new_user trigger
--
-- Identical to the version in 002 but with
-- the metadata → enum mapping documented
-- inline so it is visible when reading the
-- trigger definition in the Supabase dashboard.
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
  -- The SignupForm passes these keys in options.data:
  --
  --   raw_user_meta_data->>'team'
  --     one of: 'cs' | 'cloudops' | 'pm' | 'sm' |
  --             'marketing' | 'data_sources' | 'devops' | 'app_team'
  --
  --   raw_user_meta_data->>'vehicle_type'
  --     one of: 'car' | 'electric' | 'motorcycle'
  --
  -- Safe cast: if the value is NULL or an unrecognised string, fall back
  -- to NULL rather than throwing and blocking auth.users creation.

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
