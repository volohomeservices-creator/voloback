-- Pure SQL Haversine — NO Google Maps API call.
-- Returns all ONLINE + KYC-approved workers within radius_km,
-- ordered by distance ascending.

CREATE OR REPLACE FUNCTION find_nearby_workers(
  p_lat     DOUBLE PRECISION,
  p_lng     DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 10
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
          cos(radians(p_lat)) * cos(radians(w.current_lat))
          * cos(radians(w.current_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(w.current_lat))
        )
      )
    ) AS distance_km
  FROM workers w
  WHERE
    w.status = 'ONLINE'
    AND w.kyc_status = 'APPROVED'
    AND w.current_lat IS NOT NULL
    AND w.current_lng IS NOT NULL
    AND (
      6371 * acos(
        LEAST(1.0,
          cos(radians(p_lat)) * cos(radians(w.current_lat))
          * cos(radians(w.current_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(w.current_lat))
        )
      )
    ) <= radius_km
  ORDER BY distance_km ASC;
$$;
