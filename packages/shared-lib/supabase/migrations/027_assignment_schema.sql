-- 1. Extend booking_status enum
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'MANUAL_ASSIGNMENT_REQUIRED';

-- 2. Add service category matching to workers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workers' AND column_name='service_category_ids'
  ) THEN
    ALTER TABLE workers
    ADD COLUMN service_category_ids UUID[] DEFAULT '{}';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workers_service_categories
  ON workers USING GIN (service_category_ids);

-- 3. assignment_queue table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_queue_status') THEN
    CREATE TYPE assignment_queue_status AS ENUM (
      'QUEUED',        -- SCHEDULED booking waiting for trigger time
      'PROCESSING',    -- Groups being formed, about to broadcast
      'BROADCASTING',  -- Active group notified, waiting for accept/timeout
      'ASSIGNED',      -- A worker accepted
      'FAILED'         -- All groups exhausted → MANUAL_ASSIGNMENT_REQUIRED
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS assignment_queue (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id       UUID NOT NULL UNIQUE REFERENCES bookings(id),
  current_group    SMALLINT NOT NULL DEFAULT 1 CHECK (current_group IN (1,2,3)),
  -- JSONB array: [{"worker_id":"uuid","distance_km":2.3}, ...]
  group_workers    JSONB NOT NULL DEFAULT '[]',
  -- All workers across all groups that have been broadcast to
  all_notified_workers UUID[] DEFAULT '{}',
  status           assignment_queue_status NOT NULL DEFAULT 'QUEUED',
  attempts         SMALLINT DEFAULT 0,
  group_expires_at TIMESTAMPTZ,   -- NULL for QUEUED state
  started_at       TIMESTAMPTZ,
  assigned_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_queue_booking
  ON assignment_queue(booking_id);
CREATE INDEX IF NOT EXISTS idx_assignment_queue_status_expires
  ON assignment_queue(status, group_expires_at)
  WHERE status IN ('BROADCASTING', 'QUEUED');

-- 4. worker_job_rejections table
CREATE TABLE IF NOT EXISTS worker_job_rejections (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  worker_id  UUID NOT NULL REFERENCES workers(id),
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_rejections_booking
  ON worker_job_rejections(booking_id);

-- 5. Updated Haversine function with eligibility filters
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
          cos(radians(p_lat)) * cos(radians(w.current_lat))
          * cos(radians(w.current_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(w.current_lat))
        )
      )
    ) AS distance_km
  FROM workers w
  JOIN users u ON u.id = w.id
  WHERE
    w.status = 'ONLINE'
    AND w.kyc_status = 'APPROVED'
    AND u.is_active = TRUE
    AND w.current_lat IS NOT NULL
    AND w.current_lng IS NOT NULL
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
          cos(radians(p_lat)) * cos(radians(w.current_lat))
          * cos(radians(w.current_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(w.current_lat))
        )
      )
    ) <= p_radius_km
  ORDER BY distance_km ASC;
$$;

-- 6. Race-safe accept function (FOR UPDATE lock)
CREATE OR REPLACE FUNCTION auto_accept_booking(
  p_booking_id UUID,
  p_worker_id  UUID
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_status booking_status;
BEGIN
  -- Lock the row exclusively — prevents simultaneous accepts
  SELECT status INTO v_status
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  -- Already assigned by another worker
  IF v_status != 'PENDING_ASSIGNMENT' THEN
    RETURN FALSE;
  END IF;

  -- Assign this worker
  UPDATE bookings SET
    worker_id  = p_worker_id,
    status     = 'WORKER_ACCEPTED',
    updated_at = NOW()
  WHERE id = p_booking_id;

  -- Mark worker as ON_JOB
  UPDATE workers SET
    status     = 'ON_JOB',
    updated_at = NOW()
  WHERE id = p_worker_id;

  RETURN TRUE;
END;
$$;

-- 7. Race-safe advance function (SKIP LOCKED prevents dual advance)
CREATE OR REPLACE FUNCTION advance_assignment_queue(
  p_queue_id UUID
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_status assignment_queue_status;
BEGIN
  -- Try to acquire lock — skip if another process has it
  SELECT status INTO v_status
  FROM assignment_queue
  WHERE id = p_queue_id
  FOR UPDATE SKIP LOCKED;

  -- Another process is handling this queue entry
  IF NOT FOUND THEN
    RETURN 'SKIPPED';
  END IF;

  -- Not in a state we should advance
  IF v_status != 'BROADCASTING' THEN
    RETURN 'NOT_BROADCASTING';
  END IF;

  -- Mark as PROCESSING so app layer can do the group work
  UPDATE assignment_queue SET
    status     = 'PROCESSING',
    updated_at = NOW()
  WHERE id = p_queue_id;

  RETURN 'LOCKED';
END;
$$;

-- 8. pg_cron: advance expired queues every 15 seconds fallback / start scheduled
SELECT cron.schedule(
  'assignment-advance-fallback',
  '* * * * *',
  $$
    UPDATE assignment_queue SET status = 'PROCESSING'
    WHERE status = 'BROADCASTING'
    AND group_expires_at < NOW() - INTERVAL '90 seconds';
  $$
);

SELECT cron.schedule(
  'assignment-start-scheduled',
  '* * * * *',
  $$
    UPDATE assignment_queue SET status = 'PROCESSING'
    WHERE status = 'QUEUED'
    AND group_expires_at < NOW();
  $$
);

-- 9. Add audit actions for assignment events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ASSIGNMENT_STARTED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ASSIGNMENT_BROADCAST';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ASSIGNMENT_ACCEPTED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ASSIGNMENT_REJECTED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ASSIGNMENT_FAILED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ASSIGNMENT_MANUAL_REQUIRED';

-- 10. updated_at trigger for assignment_queue
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_queue_updated_at ON assignment_queue;
CREATE TRIGGER trg_assignment_queue_updated_at
BEFORE UPDATE ON assignment_queue
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
