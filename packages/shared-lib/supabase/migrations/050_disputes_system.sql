-- Create disputes system for the Admin Resolution Center
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_status') THEN
    CREATE TYPE dispute_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_type') THEN
    CREATE TYPE dispute_type AS ENUM ('PAYMENT_ISSUE', 'DAMAGE_REPORT', 'WORKER_NO_SHOW', 'CUSTOMER_NO_SHOW', 'UNPROFESSIONAL_CONDUCT', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  reported_by_id UUID NOT NULL REFERENCES users(id),
  assigned_admin_id UUID REFERENCES users(id),
  type dispute_type NOT NULL,
  description TEXT NOT NULL,
  status dispute_status NOT NULL DEFAULT 'OPEN',
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_booking ON disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_reported_by ON disputes(reported_by_id);

-- Add an updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at_disputes()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputes_updated_at ON disputes;
CREATE TRIGGER trg_disputes_updated_at
BEFORE UPDATE ON disputes
FOR EACH ROW EXECUTE FUNCTION set_updated_at_disputes();

-- Add a boolean flag on bookings to quickly check if it has active disputes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bookings' AND column_name='has_active_dispute'
  ) THEN
    ALTER TABLE bookings ADD COLUMN has_active_dispute BOOLEAN DEFAULT FALSE;
  END IF;
END $$;
