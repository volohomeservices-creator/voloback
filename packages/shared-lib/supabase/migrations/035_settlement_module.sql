-- Migration 035: Phase 13 - Settlement Module

-- 1. Settlement Batches
CREATE TABLE IF NOT EXISTS settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_reference TEXT UNIQUE NOT NULL,
    batch_type TEXT NOT NULL CHECK (batch_type IN ('WEDNESDAY', 'SUNDAY')),
    total_workers INTEGER DEFAULT 0,
    total_transactions INTEGER DEFAULT 0,
    gross_amount NUMERIC(12,2) DEFAULT 0,
    commission_amount NUMERIC(12,2) DEFAULT 0,
    net_amount NUMERIC(12,2) DEFAULT 0,
    status TEXT DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'PROCESSING', 'READY_FOR_PAYOUT', 'PAID', 'FAILED')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches(status);

-- 2. Worker Bank Accounts
CREATE TABLE IF NOT EXISTS worker_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID UNIQUE NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    account_holder_name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_number_encrypted TEXT NOT NULL,
    account_last_four TEXT NOT NULL,
    ifsc_code TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_bank_accounts_worker_id ON worker_bank_accounts(worker_id);

-- 3. Alter Settlement Ledger
-- Add UNIQUE constraint on booking_id (One booking = One settlement)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_ledger_booking_id_key'
  ) THEN
    ALTER TABLE settlement_ledger ADD CONSTRAINT settlement_ledger_booking_id_key UNIQUE(booking_id);
  END IF;
END $$;

ALTER TABLE settlement_ledger 
ADD COLUMN IF NOT EXISTS settlement_batch_id UUID REFERENCES settlement_batches(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add new constraints for status if necessary
-- By default it was TEXT, let's keep it TEXT but we know it will be PENDING, PROCESSING, READY_FOR_PAYOUT, PAID, FAILED, CANCELLED

-- 4. RLS Policies
ALTER TABLE settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Settlement Batches Policies
CREATE POLICY "Admins can view all batches" ON settlement_batches FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can manage batches" ON settlement_batches FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Worker Bank Accounts Policies
CREATE POLICY "Workers can view own bank account" ON worker_bank_accounts FOR SELECT TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Workers can manage own bank account" ON worker_bank_accounts FOR ALL TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Admins can view all bank accounts" ON worker_bank_accounts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can verify bank accounts" ON worker_bank_accounts FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
