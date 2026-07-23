-- ========================================================================================
-- PERF-016: Database Performance Verification (EXPLAIN ANALYZE)
-- ========================================================================================
-- This file contains analytical queries to verify that the PostgreSQL query planner 
-- is correctly utilizing the indexes created in 058_performance_indexes.sql.
-- 
-- DO NOT RUN THESE IN PRODUCTION WITHOUT UNDERSTANDING THE LOAD IMPACT.
-- THESE ARE INTENDED FOR FORENSIC PROFILING.
-- ========================================================================================

-- 1. Verify Spatial Join Performance (Worker Discovery via B-Tree Bounding Box + Haversine)
EXPLAIN ANALYZE
SELECT
    w.id AS worker_id,
    u.full_name,
    w.rating,
    wll.latitude,
    wll.longitude,
    (
      6371 * acos(
        LEAST(1.0,
          cos(radians(28.6139)) * cos(radians(wll.latitude::double precision))
          * cos(radians(wll.longitude::double precision) - radians(77.2090))
          + sin(radians(28.6139)) * sin(radians(wll.latitude::double precision))
        )
      )
    ) AS distance_km
FROM workers w
JOIN users u ON u.id = w.id
JOIN worker_profiles wp ON w.id = wp.worker_id
JOIN worker_live_locations wll ON w.id = wll.worker_id
WHERE w.status = 'ONLINE'
  AND w.kyc_status = 'APPROVED'
  -- 10km Bounding Box Filter (1 degree ~ 111km -> 0.09 degrees ~ 10km)
  AND wll.latitude BETWEEN (28.6139 - 0.09) AND (28.6139 + 0.09)
  AND wll.longitude BETWEEN (77.2090 - 0.09) AND (77.2090 + 0.09)
ORDER BY distance_km ASC
LIMIT 50;

-- 2. Verify Time-series Analytics (Dashboard Lookups)
EXPLAIN ANALYZE
SELECT 
    COUNT(id) as todays_bookings,
    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_bookings,
    SUM(CASE WHEN status IN ('WORKER_ASSIGNED', 'WORKER_ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS') THEN 1 ELSE 0 END) as active_bookings,
    SUM(CASE WHEN status = 'COMPLETED' THEN estimated_earnings ELSE 0 END) as total_earnings
FROM bookings
WHERE scheduled_at >= current_date
  AND scheduled_at < current_date + interval '1 day';

-- 3. Verify Worker Booking History (Pagination Query)
EXPLAIN ANALYZE
SELECT 
    b.id,
    b.status,
    si.name as service_name,
    b.scheduled_at,
    b.estimated_earnings
FROM bookings b
JOIN service_items si ON b.service_item_id = si.id
WHERE b.worker_id = '00000000-0000-0000-0000-000000000000' -- Replace with real UUID
ORDER BY b.scheduled_at DESC, b.id DESC
LIMIT 10;
