-- Migration 010: Add UNIQUE(user_id, date) to weekly_allocations
--
-- WHY THIS EXISTS
-- ───────────────────────────────────────────────────────────────────
-- The table only had UNIQUE(spot_id, date), preventing two people from
-- taking the same physical spot on the same day.  It did NOT prevent
-- one person from holding two different spots on the same day, which
-- could happen through a race between the non-atomic fixed-spot
-- release fallback path and a concurrent release_and_promote() RPC
-- call promoting the same waitlist user to a different spot.
--
-- This constraint closes that gap at the database level.
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE weekly_allocations
  ADD CONSTRAINT uq_user_date UNIQUE (user_id, date);
