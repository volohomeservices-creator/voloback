-- Migration 057: Security Hardening (DB-001, DB-002)

-- ==========================================
-- ISSUE DB-001: Storage RLS Hardening
-- ==========================================

-- 1. Drop the overly permissive public policies
DROP POLICY IF EXISTS "Public profile-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public profile-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public profile-images delete" ON storage.objects;

DROP POLICY IF EXISTS "Public booking-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public booking-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public booking-images delete" ON storage.objects;

DROP POLICY IF EXISTS "Public service-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images delete" ON storage.objects;

DROP POLICY IF EXISTS "Public kyc-docs insert" ON storage.objects;
DROP POLICY IF EXISTS "Public kyc-docs update" ON storage.objects;
DROP POLICY IF EXISTS "Public kyc-docs delete" ON storage.objects;
DROP POLICY IF EXISTS "Public kyc-docs select" ON storage.objects; -- Remove public SELECT for KYC

-- 2. Create Bounded Auth Policies (Restricted to owner's UUID folder)
-- Profile Images
CREATE POLICY "Auth profile-images insert" ON storage.objects 
  FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'profile-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth profile-images update" ON storage.objects 
  FOR UPDATE TO authenticated 
  USING (bucket_id = 'profile-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth profile-images delete" ON storage.objects 
  FOR DELETE TO authenticated 
  USING (bucket_id = 'profile-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Booking Images
CREATE POLICY "Auth booking-images insert" ON storage.objects 
  FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'booking-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth booking-images update" ON storage.objects 
  FOR UPDATE TO authenticated 
  USING (bucket_id = 'booking-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth booking-images delete" ON storage.objects 
  FOR DELETE TO authenticated 
  USING (bucket_id = 'booking-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Service Images (Only Admin can insert/update/delete via service_role, no auth UI uploads needed, but if so, bounded)
CREATE POLICY "Auth service-images insert" ON storage.objects 
  FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'service-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth service-images update" ON storage.objects 
  FOR UPDATE TO authenticated 
  USING (bucket_id = 'service-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth service-images delete" ON storage.objects 
  FOR DELETE TO authenticated 
  USING (bucket_id = 'service-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- KYC Docs (No public select)
CREATE POLICY "Auth kyc-docs insert" ON storage.objects 
  FOR INSERT TO authenticated 
  WITH CHECK (bucket_id = 'kyc-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth kyc-docs update" ON storage.objects 
  FOR UPDATE TO authenticated 
  USING (bucket_id = 'kyc-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth kyc-docs select" ON storage.objects 
  FOR SELECT TO authenticated 
  USING (bucket_id = 'kyc-docs' AND auth.uid()::text = (storage.foldername(name))[1]);


-- ==========================================
-- ISSUE DB-002: SECURITY DEFINER Search Path
-- ==========================================

CREATE OR REPLACE FUNCTION deduct_wallet_commission(
  p_worker_id UUID,
  p_booking_id UUID,
  p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
BEGIN
  -- Lock the row
  SELECT balance INTO v_balance_before
  FROM worker_wallets
  WHERE worker_id = p_worker_id
  FOR UPDATE;

  IF v_balance_before IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for worker';
  END IF;

  v_balance_after := v_balance_before - p_amount;

  UPDATE worker_wallets
  SET balance = v_balance_after,
      updated_at = NOW()
  WHERE worker_id = p_worker_id;

  INSERT INTO wallet_transactions (
    worker_id, booking_id, type, amount, balance_before, balance_after, description
  ) VALUES (
    p_worker_id, p_booking_id, 'COMMISSION_DEDUCTION', p_amount, v_balance_before, v_balance_after, 'Commission deducted for booking ' || p_booking_id
  );

  RETURN jsonb_build_object('success', true, 'balance_after', v_balance_after);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


CREATE OR REPLACE FUNCTION increment_rate_limit(
    p_key text,
    p_max_requests integer,
    p_window_seconds integer
) RETURNS json AS $$
DECLARE
    v_record rate_limits%ROWTYPE;
    v_now timestamptz := now();
    v_result json;
BEGIN
    -- Try to insert or lock for update
    INSERT INTO rate_limits (key, request_count, window_start, blocked_until)
    VALUES (p_key, 1, v_now, null)
    ON CONFLICT (key) DO UPDATE 
    SET request_count = rate_limits.request_count + 1
    RETURNING * INTO v_record;
    
    -- If blocked
    IF v_record.blocked_until IS NOT NULL AND v_record.blocked_until > v_now THEN
        RETURN json_build_object(
            'limited', true,
            'blockedUntil', v_record.blocked_until,
            'remaining', 0
        );
    END IF;

    -- If window expired
    IF extract(epoch from (v_now - v_record.window_start)) > p_window_seconds THEN
        UPDATE rate_limits 
        SET request_count = 1,
            window_start = v_now,
            blocked_until = null
        WHERE key = p_key
        RETURNING * INTO v_record;
    END IF;

    -- If exceeded max requests, block
    IF v_record.request_count > p_max_requests THEN
        UPDATE rate_limits 
        SET blocked_until = v_now + (p_window_seconds || ' seconds')::interval
        WHERE key = p_key
        RETURNING * INTO v_record;
        
        RETURN json_build_object(
            'limited', true,
            'blockedUntil', v_record.blocked_until,
            'remaining', 0
        );
    END IF;

    -- Not limited
    RETURN json_build_object(
        'limited', false,
        'blockedUntil', null,
        'remaining', p_max_requests - v_record.request_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
    -- Delete limits where window_start is older than 1 hour and they are not currently blocked
    DELETE FROM rate_limits 
    WHERE (blocked_until IS NULL OR blocked_until < now()) 
      AND window_start < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
