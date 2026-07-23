-- ============================================================
-- VOLO AUTHENTICATION & SECURITY HARDENING MIGRATION
-- ============================================================

-- 1. Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Alter users table to add pin and suspension fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 3. Create trusted_devices table
CREATE TABLE IF NOT EXISTS trusted_devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token_hash   VARCHAR(255) NOT NULL,
    device_fingerprint  TEXT,
    device_name         VARCHAR(100),
    ip_address          VARCHAR(45),
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    last_used_at        TIMESTAMPTZ DEFAULT NOW(),
    last_ip             VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_token ON trusted_devices(device_token_hash);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_active ON trusted_devices(is_active) WHERE is_active = TRUE;

-- 4. Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_hash   VARCHAR(255) NOT NULL,
    refresh_token_hash  VARCHAR(255) NOT NULL,
    device_id           UUID REFERENCES trusted_devices(id) ON DELETE SET NULL,
    ip_address          VARCHAR(45),
    user_agent          TEXT,
    auth_method         VARCHAR(30) NOT NULL, -- 'firebase_otp' | 'trusted_device' | 'pin' | 'email_link'
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    last_activity       TIMESTAMPTZ DEFAULT NOW(),
    refresh_count       INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_access ON sessions(access_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active) WHERE is_active = TRUE;

-- 5. Create auth_logs table
CREATE TABLE IF NOT EXISTS auth_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    phone           VARCHAR(15),
    event_type      VARCHAR(50) NOT NULL,
    auth_method     VARCHAR(30),
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    device_id       UUID,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_logs_user ON auth_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_logs_phone ON auth_logs(phone);
CREATE INDEX IF NOT EXISTS idx_auth_logs_event ON auth_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_logs_created ON auth_logs(created_at);

-- 6. Create security_events table
CREATE TABLE IF NOT EXISTS security_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type      VARCHAR(50) NOT NULL,
    severity        VARCHAR(10) NOT NULL DEFAULT 'medium',
    details         JSONB DEFAULT '{}',
    resolved        BOOLEAN DEFAULT FALSE,
    resolved_by     VARCHAR(100),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_unresolved ON security_events(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);

-- 7. Create rate_limits table
CREATE TABLE IF NOT EXISTS rate_limits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier      VARCHAR(100) NOT NULL,
    limit_type      VARCHAR(30) NOT NULL,
    request_count   INTEGER DEFAULT 1,
    window_start    TIMESTAMPTZ DEFAULT NOW(),
    blocked_until   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, limit_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON rate_limits(blocked_until) WHERE blocked_until IS NOT NULL;

-- 8. Enable Row Level Security (RLS) on new tables to secure them
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
