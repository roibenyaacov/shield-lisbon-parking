-- Shield Lisbon Parking - Initial Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE team_enum AS ENUM (
  'cs',
  'cloudops',
  'pm',
  'sm',
  'marketing',
  'data_sources',
  'devops',
  'app_team'
);

CREATE TYPE vehicle_type_enum AS ENUM (
  'car',
  'electric',
  'motorcycle'
);

CREATE TYPE user_role AS ENUM (
  'admin',
  'user'
);

CREATE TYPE spot_priority_enum AS ENUM (
  'ev',
  'motorcycle',
  'general'
);

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  team team_enum,
  vehicle_type vehicle_type_enum,
  role user_role DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE parking_spots (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  priority spot_priority_enum DEFAULT 'general',
  is_active BOOLEAN DEFAULT true,
  fixed_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE weekly_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  mon BOOLEAN DEFAULT false,
  tue BOOLEAN DEFAULT false,
  wed BOOLEAN DEFAULT false,
  thu BOOLEAN DEFAULT false,
  fri BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, week_start)
);

CREATE TABLE weekly_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spot_id INTEGER NOT NULL REFERENCES parking_spots(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  pass_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(spot_id, date)
);

CREATE TABLE waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE TABLE spot_releases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spot_id INTEGER NOT NULL REFERENCES parking_spots(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_weekly_requests_week ON weekly_requests(week_start);
CREATE INDEX idx_weekly_requests_user ON weekly_requests(user_id);
CREATE INDEX idx_weekly_allocations_date ON weekly_allocations(date);
CREATE INDEX idx_weekly_allocations_user ON weekly_allocations(user_id);
CREATE INDEX idx_waitlist_date ON waitlist(date);
CREATE INDEX idx_spot_releases_week ON spot_releases(week_start);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- + Auto-assign fixed parking spots by email
-- ============================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, team, vehicle_type)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    (NEW.raw_user_meta_data->>'team')::team_enum,
    (NEW.raw_user_meta_data->>'vehicle_type')::vehicle_type_enum
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    team = COALESCE(EXCLUDED.team, profiles.team),
    vehicle_type = COALESCE(EXCLUDED.vehicle_type, profiles.vehicle_type);

  -- Auto-assign fixed spots based on email
  -- Spot 39 → Raíssa Ramos
  IF NEW.email = 'raissa.ramos@shieldfc.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '39';
  END IF;

  -- Spot 49 → Rita Vaz
  IF NEW.email = 'rita.vaz@shieldfc.com' THEN
    UPDATE public.parking_spots SET fixed_user_id = NEW.id WHERE label = '49';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_releases ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "Profiles are viewable by all authenticated users"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Parking spots: readable by all authenticated
CREATE POLICY "Spots are viewable by all authenticated users"
  ON parking_spots FOR SELECT
  TO authenticated
  USING (true);

-- Weekly requests: users can manage own, read all
CREATE POLICY "Requests are viewable by all authenticated users"
  ON weekly_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own requests"
  ON weekly_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own requests"
  ON weekly_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own requests"
  ON weekly_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Weekly allocations: readable by all authenticated
CREATE POLICY "Allocations are viewable by all authenticated users"
  ON weekly_allocations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage allocations"
  ON weekly_allocations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Waitlist: users can manage own, read all
CREATE POLICY "Waitlist is viewable by all authenticated users"
  ON waitlist FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own waitlist entries"
  ON waitlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own waitlist entries"
  ON waitlist FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage waitlist"
  ON waitlist FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Spot releases: users can manage own for fixed spots
CREATE POLICY "Releases are viewable by all authenticated users"
  ON spot_releases FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own releases"
  ON spot_releases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own releases"
  ON spot_releases FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================
-- SEED: PARKING SPOTS
-- ============================================

INSERT INTO parking_spots (label, priority) VALUES
  ('1',  'motorcycle'),
  ('2',  'general'),
  ('37', 'ev'),
  ('38', 'ev'),
  ('39', 'general'),
  ('40', 'general'),
  ('41', 'general'),
  ('48', 'general'),
  ('49', 'general'),
  ('51', 'general');

-- Fixed spots are auto-assigned via the handle_new_user() trigger:
--   Spot 39 → raissa.ramos@shieldfc.com
--   Spot 49 → rita.vaz@shieldfc.com
-- When these users sign up, their spots are linked automatically.
--
-- To change emails, update the IF conditions in handle_new_user() above.
-- To manually assign after the fact:
--   UPDATE parking_spots SET fixed_user_id = (SELECT id FROM profiles WHERE email = 'someone@shieldfc.com') WHERE label = '39';

-- ============================================
-- ENABLE REALTIME
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE weekly_allocations;
ALTER PUBLICATION supabase_realtime ADD TABLE waitlist;
