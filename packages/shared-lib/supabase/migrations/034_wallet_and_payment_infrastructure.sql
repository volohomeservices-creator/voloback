-- Migration 034: Combined Phase 11 & Phase 12 - Commission Wallet + Payment Infrastructure

-- 1. Extend Payment Status Enum
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'CAPTURED';

-- 2. Worker Wallets
CREATE TABLE IF NOT EXISTS worker_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID UNIQUE NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    balance NUMERIC(12,2) DEFAULT 0,
    minimum_balance NUMERIC(12,2) DEFAULT -500,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_wallets_worker_id ON worker_wallets(worker_id);

-- 3. Wallet Transactions
DROP TABLE IF EXISTS commission_wallet_transactions CASCADE;

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    amount NUMERIC(12,2),
    balance_before NUMERIC(12,2),
    balance_after NUMERIC(12,2),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_worker_id ON wallet_transactions(worker_id);

-- 4. Commission Rules
CREATE TABLE IF NOT EXISTS commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_category_id UUID REFERENCES service_categories(id) ON DELETE CASCADE,
    commission_percent NUMERIC(5,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Payment Attempts
CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    status TEXT,
    response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Recreate Settlement Ledger
DROP TABLE IF EXISTS settlement_ledger CASCADE;

CREATE TABLE settlement_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    gross_amount NUMERIC(12,2),
    commission_amount NUMERIC(12,2),
    net_amount NUMERIC(12,2),
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_ledger_worker_id ON settlement_ledger(worker_id);

-- 6.5. Wallet Deduction RPC with FOR UPDATE locking
CREATE OR REPLACE FUNCTION deduct_wallet_commission(
  p_worker_id UUID,
  p_booking_id UUID,
  p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
BEGIN
  -- Lock the row
  SELECT balance INTO v_balance_before
  FROM worker_wallets
  WHERE worker_id = p_worker_id
  FOR UPDATE;

  IF v_balance_before IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for worker';
  END IF;

  v_balance_after := v_balance_before - p_amount;

  UPDATE worker_wallets
  SET balance = v_balance_after,
      updated_at = NOW()
  WHERE worker_id = p_worker_id;

  INSERT INTO wallet_transactions (
    worker_id, booking_id, type, amount, balance_before, balance_after, description
  ) VALUES (
    p_worker_id, p_booking_id, 'COMMISSION_DEDUCTION', p_amount, v_balance_before, v_balance_after, 'Commission deducted for booking ' || p_booking_id
  );

  RETURN jsonb_build_object('success', true, 'balance_after', v_balance_after);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RLS Policies
ALTER TABLE worker_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_ledger ENABLE ROW LEVEL SECURITY;

-- Worker Wallets Policies
CREATE POLICY "Workers can view own wallet" ON worker_wallets FOR SELECT TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Admins can view all wallets" ON worker_wallets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update all wallets" ON worker_wallets FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Wallet Transactions Policies
CREATE POLICY "Workers can view own transactions" ON wallet_transactions FOR SELECT TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Admins can view all transactions" ON wallet_transactions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can insert transactions" ON wallet_transactions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Commission Rules Policies
CREATE POLICY "Anyone can view commission rules" ON commission_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage commission rules" ON commission_rules FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Payment Attempts Policies
CREATE POLICY "Admins can view payment attempts" ON payment_attempts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Settlement Ledger Policies
CREATE POLICY "Workers can view own settlements" ON settlement_ledger FOR SELECT TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Admins can view all settlements" ON settlement_ledger FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
