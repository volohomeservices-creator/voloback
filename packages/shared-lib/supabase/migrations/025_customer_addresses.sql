-- Migration 025: Create customer_addresses table

-- Create address_label enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'address_label') THEN
    CREATE TYPE address_label AS ENUM ('HOME', 'WORK', 'OTHER');
  END IF;
END $$;

-- Create customer_addresses table
CREATE TABLE IF NOT EXISTS customer_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       address_label NOT NULL DEFAULT 'HOME',
  address     TEXT NOT NULL,
  latitude    NUMERIC(9, 6),
  longitude   NUMERIC(9, 6),
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

-- Trigger to clear other defaults when setting default
CREATE OR REPLACE FUNCTION handle_default_address()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = TRUE THEN
    UPDATE customer_addresses 
    SET is_default = FALSE 
    WHERE customer_id = NEW.customer_id AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_handle_default_address ON customer_addresses;
CREATE TRIGGER trg_handle_default_address
  BEFORE INSERT OR UPDATE ON customer_addresses
  FOR EACH ROW
  EXECUTE FUNCTION handle_default_address();
