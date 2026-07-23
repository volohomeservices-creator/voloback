-- Migration 033: Firebase Notifications and User Devices

CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    platform TEXT NOT NULL,
    permission_status TEXT DEFAULT 'DEFAULT',
    is_active BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_device_unique ON user_devices(user_id, device_token);

-- RLS
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own devices" ON user_devices;
CREATE POLICY "Users can view their own devices" ON user_devices
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own devices" ON user_devices;
CREATE POLICY "Users can insert their own devices" ON user_devices
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own devices" ON user_devices;
CREATE POLICY "Users can update their own devices" ON user_devices
    FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own devices" ON user_devices;
CREATE POLICY "Users can delete their own devices" ON user_devices
    FOR DELETE TO authenticated USING (user_id = auth.uid());
