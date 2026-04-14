-- Migration 008: add HR team option for signup/profile
--
-- Ensures the enum accepts "hr" so new users can register under HR.
ALTER TYPE team_enum ADD VALUE IF NOT EXISTS 'hr';
