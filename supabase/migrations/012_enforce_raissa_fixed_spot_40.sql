-- Migration 012: enforce spot #40 as Raissa's fixed reserved spot
--
-- Why:
-- In some environments, spot 40 may drift to a non-reserved state
-- (fixed_user_id/reserved_name missing), causing it to appear available.
-- This migration restores the intended rule:
--   - reserved_name column exists on parking_spots (idempotent).
--   - Spot 40 always carries reserved_name = 'Raissa Ramos'.
--   - If Raissa's profile exists, spot 40 is bound to her user id.

-- 1. Ensure the column exists (in case migration 007 was skipped on this DB).
ALTER TABLE public.parking_spots
  ADD COLUMN IF NOT EXISTS reserved_name TEXT;

-- 2. Keep spot 40 visibly reserved in UI/admin even before user linkage exists.
UPDATE public.parking_spots
SET reserved_name = 'Raíssa Ramos'
WHERE label = '40'
  AND (reserved_name IS NULL OR btrim(reserved_name) = '');

-- 3. If Raissa's profile exists, bind spot 40 to her user id.
UPDATE public.parking_spots s
SET fixed_user_id = p.id
FROM public.profiles p
WHERE s.label = '40'
  AND p.email = 'raissa.ramos@shieldfc.com'
  AND s.fixed_user_id IS DISTINCT FROM p.id;
