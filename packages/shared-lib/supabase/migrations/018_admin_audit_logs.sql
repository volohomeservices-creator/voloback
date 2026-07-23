CREATE TYPE audit_action AS ENUM (
  'ADMIN_LOGIN',
  'WORKER_KYC_APPROVED',
  'WORKER_KYC_REJECTED',
  'WORKER_SUSPENDED',
  'WORKER_ACTIVATED',
  'MANUAL_ASSIGNMENT',
  'MANUAL_REASSIGNMENT',
  'SERVICE_CREATED',
  'SERVICE_UPDATED',
  'SERVICE_DELETED',
  'SETTLEMENT_PROCESSED',
  'SETTINGS_UPDATED',
  'CUSTOMER_DEACTIVATED',
  'CUSTOMER_ACTIVATED',
  'BOOKING_CANCELLED',
  'BOOKING_REASSIGNED'
);

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id     UUID NOT NULL REFERENCES users(id),
  action       audit_action NOT NULL,
  target_type  TEXT,        -- 'worker', 'customer', 'booking', 'service', etc.
  target_id    UUID,        -- the ID of the affected record
  metadata     JSONB,       -- any extra context (old value, new value, etc.)
  ip_address   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_admin   ON audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_audit_logs_action  ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_logs_target  ON audit_logs(target_id);
