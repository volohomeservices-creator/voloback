-- Migration: 056_rate_limits.sql

CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    request_count integer DEFAULT 1,
    window_start timestamptz DEFAULT now(),
    blocked_until timestamptz
);

-- RLS policies
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- We don't want clients reading/writing directly, only via backend server role
CREATE POLICY "Service Role Full Access" 
ON rate_limits FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- Create a fast RPC function to atomically increment or block
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup function to prevent unbounded growth
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
    -- Delete limits where window_start is older than 1 hour and they are not currently blocked
    DELETE FROM rate_limits 
    WHERE (blocked_until IS NULL OR blocked_until < now()) 
      AND window_start < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
