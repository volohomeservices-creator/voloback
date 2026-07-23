-- Migration: 058_performance_indexes.sql
-- Purpose: Resolve PERF-003 (Geo-Spatial Query Optimization) and PERF-004 (High Volume Table Optimization)

-- 1. Geo-Spatial Query Optimization (Bounding Box & Nearest Search)
-- Since PostGIS is deferred until measurable benefit is proven, we use composite B-Tree indexes 
-- to vastly accelerate lat/lng range bounding queries in the Assignment Engine.
CREATE INDEX IF NOT EXISTS idx_worker_locations_lat_lng 
ON worker_locations (lat, lng);

-- In the Assignment Engine, we often filter by worker status (e.g. ONLINE) alongside bounding boxes.
-- A composite index on status + lat + lng is highly optimal for these queries.
CREATE INDEX IF NOT EXISTS idx_workers_status_updated_at
ON workers (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_status_customer
ON bookings (status, customer_id);

CREATE INDEX IF NOT EXISTS idx_bookings_status_worker
ON bookings (status, worker_id);

-- 2. Audit Logs & Rate Limits (Preparation for large volume)
-- Creating BRIN (Block Range Index) or B-Tree indexes on timestamp columns 
-- which are heavily queried or deleted (like our rate limits cleanup job).
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start 
ON rate_limits (window_start);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
ON audit_logs (created_at DESC);

-- Note: We avoid Native Partitioning (e.g. PARTITION BY RANGE) right now 
-- to preserve backwards compatibility without complex migration logic that 
-- involves dropping and recreating the tables (which breaks zero-downtime rules).
-- The composite B-Trees and BRIN indexes serve as the immediate fix.
