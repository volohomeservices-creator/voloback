-- Migration 048: Remove wallet balance restrictions from worker dispatch matching
CREATE OR REPLACE FUNCTION find_nearby_eligible_workers(
  p_lat               DOUBLE PRECISION,
  p_lng               DOUBLE PRECISION,
  p_radius_km         DOUBLE PRECISION DEFAULT 10,
  p_service_category_id UUID DEFAULT NULL,
  p_booking_id        UUID DEFAULT NULL,
  p_payment_mode      TEXT DEFAULT 'ONLINE'
)
RETURNS TABLE (
  worker_id   UUID,
  distance_km DOUBLE PRECISION
) LANGUAGE sql STABLE AS $$
  SELECT
    w.id AS worker_id,
    (
      6371 * acos(
        LEAST(1.0,
          cos(radians(p_lat)) * cos(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
          * cos(radians(COALESCE(loc.longitude::double precision, w.current_lng)) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
        )
      )
    ) AS distance_km
  FROM workers w
  JOIN users u ON u.id = w.id
  LEFT JOIN worker_live_locations loc ON loc.worker_id = w.id
  WHERE
    w.status = 'ONLINE'
    AND w.kyc_status = 'APPROVED'
    AND u.is_active = TRUE
    AND COALESCE(loc.latitude::double precision, w.current_lat) IS NOT NULL
    AND COALESCE(loc.longitude::double precision, w.current_lng) IS NOT NULL
    -- Service category matching (NULL = any category allowed)
    AND (
      p_service_category_id IS NULL
      OR w.service_category_ids @> ARRAY[p_service_category_id]
    )
    -- Exclude workers who already rejected this booking
    AND (
      p_booking_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM worker_job_rejections r
        WHERE r.booking_id = p_booking_id
        AND r.worker_id = w.id
      )
    )
    -- Distance limit
    AND (
      6371 * acos(
        LEAST(1.0,
          cos(radians(p_lat)) * cos(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
          * cos(radians(COALESCE(loc.longitude::double precision, w.current_lng)) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
        )
      )
    ) <= p_radius_km
  ORDER BY distance_km ASC;
$$;
