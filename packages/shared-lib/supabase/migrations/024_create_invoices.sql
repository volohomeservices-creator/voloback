-- Migration 024: Create invoices table and automatic triggers

-- Create invoice_status enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM ('GENERATED', 'PAID', 'PENDING');
  END IF;
END $$;

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_no   TEXT NOT NULL UNIQUE,
  amount       NUMERIC(10, 2) NOT NULL,
  status       invoice_status DEFAULT 'PENDING',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_booking_id ON invoices(booking_id);

-- Auto-completion trigger
CREATE OR REPLACE FUNCTION generate_booking_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_no TEXT;
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' THEN
    v_invoice_no := 'INV-' || to_char(NOW(), 'YYYYMMDD') || '-' || substring(md5(random()::text) from 1 for 6);
    
    INSERT INTO invoices (booking_id, customer_id, invoice_no, amount, status)
    VALUES (NEW.id, NEW.customer_id, v_invoice_no, NEW.total_amount, 'PENDING')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_invoice_on_completed ON bookings;
CREATE TRIGGER trg_generate_invoice_on_completed
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION generate_booking_invoice();
