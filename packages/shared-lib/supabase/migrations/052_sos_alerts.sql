-- Create SOS Alerts system for emergencies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sos_status') THEN
    CREATE TYPE sos_status AS ENUM ('ACTIVE', 'RESOLVED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  booking_id UUID REFERENCES bookings(id),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status sos_status NOT NULL DEFAULT 'ACTIVE',
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_alerts(user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION set_updated_at_sos()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sos_updated_at ON sos_alerts;
CREATE TRIGGER trg_sos_updated_at
BEFORE UPDATE ON sos_alerts
FOR EACH ROW EXECUTE FUNCTION set_updated_at_sos();
