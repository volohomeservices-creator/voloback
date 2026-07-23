-- Atomic manual assignment transaction
CREATE OR REPLACE FUNCTION manual_assign_worker(
  p_booking_id UUID,
  p_worker_id UUID,
  p_admin_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_booking_status booking_status;
  v_worker_status worker_status;
  v_kyc_status kyc_status;
BEGIN
  -- 1. Lock the booking row
  SELECT status INTO v_booking_status
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  -- 2. Lock the worker row
  SELECT status, kyc_status INTO v_worker_status, v_kyc_status
  FROM workers
  WHERE id = p_worker_id
  FOR UPDATE;

  -- 3. Verify states
  IF v_booking_status NOT IN ('PENDING_ASSIGNMENT', 'MANUAL_ASSIGNMENT_REQUIRED') THEN
    RAISE EXCEPTION 'BOOKING_NOT_PENDING';
  END IF;

  IF v_worker_status != 'ONLINE' OR v_kyc_status != 'APPROVED' THEN
    RAISE EXCEPTION 'WORKER_NOT_AVAILABLE';
  END IF;

  -- 4. Assign worker and update status
  UPDATE bookings
  SET worker_id = p_worker_id,
      status = 'WORKER_ASSIGNED',
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- 5. Mark worker as busy/on job
  UPDATE workers
  SET status = 'ON_JOB',
      updated_at = NOW()
  WHERE id = p_worker_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Atomic manual reassignment transaction
CREATE OR REPLACE FUNCTION manual_reassign_worker(
  p_booking_id UUID,
  p_new_worker_id UUID,
  p_admin_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_old_worker_id UUID;
  v_booking_status booking_status;
  v_worker_status worker_status;
  v_kyc_status kyc_status;
BEGIN
  -- 1. Lock the booking row
  SELECT worker_id, status INTO v_old_worker_id, v_booking_status
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  -- 2. Lock the new worker row
  SELECT status, kyc_status INTO v_worker_status, v_kyc_status
  FROM workers
  WHERE id = p_new_worker_id
  FOR UPDATE;

  -- 3. Verify states
  IF v_booking_status NOT IN ('PENDING_ASSIGNMENT', 'WORKER_ASSIGNED', 'WORKER_ACCEPTED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'BOOKING_NOT_REASSIGNABLE';
  END IF;

  IF v_worker_status != 'ONLINE' OR v_kyc_status != 'APPROVED' THEN
    RAISE EXCEPTION 'WORKER_NOT_AVAILABLE';
  END IF;

  -- 4. Mark old worker back to ONLINE
  IF v_old_worker_id IS NOT NULL THEN
    UPDATE workers
    SET status = 'ONLINE',
        updated_at = NOW()
    WHERE id = v_old_worker_id;
  END IF;

  -- 5. Reassign worker and update status
  UPDATE bookings
  SET worker_id = p_new_worker_id,
      status = 'WORKER_ASSIGNED',
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- 6. Mark new worker as ON_JOB
  UPDATE workers
  SET status = 'ON_JOB',
      updated_at = NOW()
  WHERE id = p_new_worker_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
