-- Migration 031: Manual Assignment Tracking and Schema Enhancements

-- 1. Create manual_assignment_history table if not exists
CREATE TABLE IF NOT EXISTS manual_assignment_history (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    worker_id   UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES users(id),
    status      TEXT NOT NULL CHECK (status IN ('ASSIGNED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REASSIGNED')),
    notes       TEXT,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS on manual_assignment_history
ALTER TABLE manual_assignment_history ENABLE ROW LEVEL SECURITY;

-- 3. Add database constraints (Update 11)
-- Partial unique index to enforce that at most one ACTIVE ('ASSIGNED') manual offer exists per booking
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_offer_active
ON manual_assignment_history(booking_id)
WHERE status = 'ASSIGNED';

-- 4. Add new audit actions to audit_action enum if they do not exist (Update 4)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_CREATED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'MANUAL_ASSIGNMENT_CREATED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_ACCEPTED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'MANUAL_ASSIGNMENT_ACCEPTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_REJECTED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'MANUAL_ASSIGNMENT_REJECTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_REASSIGNED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'MANUAL_ASSIGNMENT_REASSIGNED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_COMPLETED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'MANUAL_ASSIGNMENT_COMPLETED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_EXPIRED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'MANUAL_ASSIGNMENT_EXPIRED';
    END IF;
END $$;

-- 5. Add new notification types to notification_type enum if they do not exist (Update 5)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_CREATED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'MANUAL_ASSIGNMENT_CREATED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_ACCEPTED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'MANUAL_ASSIGNMENT_ACCEPTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_REJECTED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'MANUAL_ASSIGNMENT_REJECTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_REASSIGNED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'MANUAL_ASSIGNMENT_REASSIGNED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MANUAL_ASSIGNMENT_EXPIRED' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'MANUAL_ASSIGNMENT_EXPIRED';
    END IF;
END $$;

-- 6. Modify auto_accept_booking() to support both PENDING_ASSIGNMENT and MANUAL_ASSIGNMENT_REQUIRED (Update 1)
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

  -- Already assigned by another worker or in an unsupported state
  IF v_status NOT IN ('PENDING_ASSIGNMENT', 'MANUAL_ASSIGNMENT_REQUIRED') THEN
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

-- 7. Create Offer Expiry Automation Function (Update 2)
CREATE OR REPLACE FUNCTION expire_expired_manual_offers()
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    SELECT id, booking_id, worker_id, assigned_by
    FROM manual_assignment_history
    WHERE status = 'ASSIGNED'
    AND expires_at < NOW()
  LOOP
    -- 1. Update status to EXPIRED
    UPDATE manual_assignment_history
    SET status = 'EXPIRED',
        updated_at = NOW()
    WHERE id = v_rec.id;

    -- 2. Create Audit Log
    INSERT INTO audit_logs (admin_id, action, target_type, target_id, metadata, created_at)
    VALUES (
      'ad8e7a68-b7eb-4b2a-8cfa-c529a65f9733', -- SYSTEM ADMIN
      'MANUAL_ASSIGNMENT_EXPIRED',
      'booking',
      v_rec.booking_id,
      jsonb_build_object('offer_id', v_rec.id, 'worker_id', v_rec.worker_id),
      NOW()
    );

    -- 3. Create Notification for Worker
    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    VALUES (
      v_rec.worker_id,
      'MANUAL_ASSIGNMENT_EXPIRED',
      'Direct Job Offer Expired',
      'The direct job offer from the admin has expired.',
      jsonb_build_object('booking_id', v_rec.booking_id, 'offer_id', v_rec.id),
      NOW()
    );

    -- 4. Create Notification for Admin
    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    VALUES (
      v_rec.assigned_by,
      'MANUAL_ASSIGNMENT_EXPIRED',
      'Manual Offer Expired',
      'Your manual assignment offer to the worker has expired without response.',
      jsonb_build_object('booking_id', v_rec.booking_id, 'offer_id', v_rec.id),
      NOW()
    );
  END LOOP;
END;
$$;

-- 8. pg_cron Job setup: Runs every 5 minutes (Update 3)
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'manual-assignment-expiry';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'manual-assignment-expiry',
  '*/5 * * * *',
  $$
    SELECT expire_expired_manual_offers();
  $$
);
