-- Migration 039: Resolve find_nearby_workers function overloading conflict
-- Drops the old 5-parameter version of find_nearby_workers so PostgREST resolves the 3-parameter version unambiguously.

DROP FUNCTION IF EXISTS public.find_nearby_workers(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  radius_km DOUBLE PRECISION,
  p_limit INTEGER,
  p_max_age_minutes INTEGER
);
