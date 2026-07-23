-- Migration 037: Phase 15 - Google Maps, Live Tracking & Location Intelligence

-- 1. Table: worker_live_locations
CREATE TABLE IF NOT EXISTS worker_live_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID UNIQUE NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  latitude    NUMERIC(9, 6) NOT NULL,
  longitude   NUMERIC(9, 6) NOT NULL,
  accuracy    NUMERIC(6, 2),
  speed       NUMERIC(5, 2),
  heading     NUMERIC(5, 2),
  device_type VARCHAR(10) CHECK (device_type IN ('WEB', 'ANDROID', 'IOS')),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_live_locations_worker_id ON worker_live_locations(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_live_locations_updated_at ON worker_live_locations(updated_at);

-- 2. Table: worker_live_locations_approx (Customer Privacy Layer)
CREATE TABLE IF NOT EXISTS worker_live_locations_approx (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID UNIQUE NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  latitude    NUMERIC(9, 6) NOT NULL,
  longitude   NUMERIC(9, 6) NOT NULL,
  accuracy    NUMERIC(6, 2),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_live_locations_approx_worker ON worker_live_locations_approx(worker_id);

-- 3. Trigger for rounding worker coordinates to ~22-meter grid steps (0.0002 degrees)
CREATE OR REPLACE FUNCTION handle_approximate_worker_location()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO worker_live_locations_approx (worker_id, latitude, longitude, accuracy, updated_at)
  VALUES (
    NEW.worker_id,
    ROUND(NEW.latitude / 0.0002) * 0.0002,
    ROUND(NEW.longitude / 0.0002) * 0.0002,
    NEW.accuracy,
    NEW.updated_at
  )
  ON CONFLICT (worker_id) DO UPDATE SET
    latitude = ROUND(EXCLUDED.latitude / 0.0002) * 0.0002,
    longitude = ROUND(EXCLUDED.longitude / 0.0002) * 0.0002,
    accuracy = EXCLUDED.accuracy,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approximate_worker_location ON worker_live_locations;
CREATE TRIGGER trg_approximate_worker_location
  AFTER INSERT OR UPDATE ON worker_live_locations
  FOR EACH ROW
  EXECUTE FUNCTION handle_approximate_worker_location();

-- 4. Table: worker_location_history
CREATE TABLE IF NOT EXISTS worker_location_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  latitude    NUMERIC(9, 6) NOT NULL,
  longitude   NUMERIC(9, 6) NOT NULL,
  accuracy    NUMERIC(6, 2),
  speed       NUMERIC(5, 2),
  heading     NUMERIC(5, 2),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_location_history_worker_id ON worker_location_history(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_location_history_created_at ON worker_location_history(created_at);

-- 5. Table: tracking_sessions
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  worker_id    UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  platform     VARCHAR(10) CHECK (platform IN ('WEB', 'ANDROID', 'IOS')),
  app_version  VARCHAR(50),
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  ended_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_booking_id ON tracking_sessions(booking_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_worker_id ON tracking_sessions(worker_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_status ON tracking_sessions(status);

-- 6. Table: booking_tracking_events
CREATE TABLE IF NOT EXISTS booking_tracking_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  worker_id   UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  latitude    NUMERIC(9, 6) NOT NULL,
  longitude   NUMERIC(9, 6) NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('LOCATION_UPDATE', 'ROUTE_STARTED', 'ARRIVED', 'WORK_STARTED', 'WORK_COMPLETED')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_tracking_events_booking_id ON booking_tracking_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_tracking_events_worker_id ON booking_tracking_events(worker_id);

-- 7. Table: booking_route_snapshots
CREATE TABLE IF NOT EXISTS booking_route_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  distance_km NUMERIC(6, 2) NOT NULL,
  eta_minutes INTEGER NOT NULL,
  worker_lat  NUMERIC(9, 6) NOT NULL,
  worker_lng  NUMERIC(9, 6) NOT NULL,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_route_snapshots_booking_id ON booking_route_snapshots(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_route_snapshots_captured_at ON booking_route_snapshots(captured_at);

-- 8. Table: service_zones
CREATE TABLE IF NOT EXISTS service_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_name   VARCHAR(100) NOT NULL,
  zone_name   VARCHAR(100) NOT NULL,
  radius_km   NUMERIC(6, 2) NOT NULL,
  active      BOOLEAN DEFAULT TRUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_zones_city_name ON service_zones(city_name);
CREATE INDEX IF NOT EXISTS idx_service_zones_active ON service_zones(active);

-- 9. Add columns to customer_addresses
ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS place_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS formatted_address TEXT;

-- 10. Update Haversine Matching RPCs to prioritize worker_live_locations over workers.current_lat/current_lng
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
          cos(radians(p_lat)) * cos(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
          * cos(radians(COALESCE(loc.longitude::double precision, w.current_lng)) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
        )
      )
    ) AS distance_km
  FROM workers w
  LEFT JOIN worker_live_locations loc ON loc.worker_id = w.id
  WHERE
    w.status = 'ONLINE'
    AND w.kyc_status = 'APPROVED'
    AND COALESCE(loc.latitude::double precision, w.current_lat) IS NOT NULL
    AND COALESCE(loc.longitude::double precision, w.current_lng) IS NOT NULL
    AND (
      6371 * acos(
        LEAST(1.0,
          cos(radians(p_lat)) * cos(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
          * cos(radians(COALESCE(loc.longitude::double precision, w.current_lng)) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(COALESCE(loc.latitude::double precision, w.current_lat)))
        )
      )
    ) <= radius_km
  ORDER BY distance_km ASC;
$$;

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
    -- COD wallet minimum balance check
    AND (
      p_payment_mode != 'COD'
      OR w.commission_wallet_balance >= (
        SELECT COALESCE(value::numeric, 500)
        FROM platform_settings
        WHERE key = 'min_cod_wallet_balance'
      )
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

-- 11. Add values to enums if not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'LOCATION_UPDATED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'LOCATION_UPDATED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TRACKING_STARTED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'TRACKING_STARTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TRACKING_STOPPED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'TRACKING_STOPPED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ROUTE_STARTED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'ROUTE_STARTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WORKER_ARRIVED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'WORKER_ARRIVED';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'BOOKING_TRACKING_STARTED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'BOOKING_TRACKING_STARTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WORKER_NEARBY' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'WORKER_NEARBY';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ETA_UPDATED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'ETA_UPDATED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WORKER_ARRIVED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'WORKER_ARRIVED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ROUTE_STARTED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'ROUTE_STARTED';
    END IF;
END $$;

-- 12. Setup Row Level Security (RLS) Policies
ALTER TABLE worker_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_live_locations_approx ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_route_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_zones ENABLE ROW LEVEL SECURITY;

-- worker_live_locations
CREATE POLICY "Admins have full access to worker_live_locations" ON worker_live_locations FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Workers can manage own live location" ON worker_live_locations FOR ALL TO authenticated USING (worker_id = auth.uid());

-- worker_live_locations_approx
CREATE POLICY "Admins have full access to worker_live_locations_approx" ON worker_live_locations_approx FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Customers can select locations of workers assigned to their active bookings" ON worker_live_locations_approx FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.worker_id = worker_live_locations_approx.worker_id
      AND b.customer_id = auth.uid()
      AND b.status IN ('WORKER_ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS')
  )
);

-- worker_location_history
CREATE POLICY "Admins have full access to worker_location_history" ON worker_location_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Workers can manage own history" ON worker_location_history FOR ALL TO authenticated USING (worker_id = auth.uid());

-- tracking_sessions
CREATE POLICY "Admins have full access to tracking_sessions" ON tracking_sessions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Workers can manage own tracking sessions" ON tracking_sessions FOR ALL TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Customers can view own booking tracking sessions" ON tracking_sessions FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = tracking_sessions.booking_id
      AND b.customer_id = auth.uid()
  )
);

-- booking_tracking_events
CREATE POLICY "Admins have full access to booking_tracking_events" ON booking_tracking_events FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Workers can manage own tracking events" ON booking_tracking_events FOR ALL TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Customers can view own booking tracking events" ON booking_tracking_events FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = booking_tracking_events.booking_id
      AND b.customer_id = auth.uid()
  )
);

-- booking_route_snapshots
CREATE POLICY "Admins have full access to booking_route_snapshots" ON booking_route_snapshots FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Workers can view own booking snapshots" ON booking_route_snapshots FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = booking_route_snapshots.booking_id
      AND b.worker_id = auth.uid()
  )
);
CREATE POLICY "Customers can view own booking snapshots" ON booking_route_snapshots FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = booking_route_snapshots.booking_id
      AND b.customer_id = auth.uid()
  )
);

-- service_zones
CREATE POLICY "Admins have full access to service_zones" ON service_zones FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Anyone authenticated can view service zones" ON service_zones FOR SELECT TO authenticated USING (true);

-- 13. Enable Supabase Realtime
-- Check if table is already in supabase_realtime publication, if not, add it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE worker_live_locations_approx;
  END IF;
END $$;

-- 14. Setup pg_cron database cleanup jobs
SELECT cron.schedule(
  'location-history-retention-cleanup',
  '0 0 * * *', -- Everyday at midnight
  $$
    DELETE FROM worker_location_history WHERE created_at < NOW() - INTERVAL '90 days';
    DELETE FROM booking_tracking_events WHERE created_at < NOW() - INTERVAL '180 days';
    DELETE FROM booking_route_snapshots WHERE captured_at < NOW() - INTERVAL '180 days';
  $$
);
