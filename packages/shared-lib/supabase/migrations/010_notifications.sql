CREATE TYPE notification_type AS ENUM (
  'BOOKING_REQUEST',
  'BOOKING_ACCEPTED',
  'BOOKING_REJECTED',
  'WORKER_ARRIVING',
  'JOB_STARTED',
  'JOB_COMPLETED',
  'PAYMENT_SUCCESS',
  'PAYOUT_PROCESSED',
  'KYC_APPROVED',
  'KYC_REJECTED',
  'LOW_WALLET_BALANCE'
);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id),
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  data       JSONB,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user
  ON notifications(user_id, is_read, created_at DESC);
