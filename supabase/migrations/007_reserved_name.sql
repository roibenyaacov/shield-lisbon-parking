-- Migration 007: Add reserved_name to parking_spots
-- Allows showing the owner's name on reserved spots even before they register
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE public.parking_spots ADD COLUMN IF NOT EXISTS reserved_name TEXT;

UPDATE public.parking_spots SET reserved_name = 'Raíssa Ramos' WHERE label = '40';
UPDATE public.parking_spots SET reserved_name = 'Roi' WHERE label = '39';
