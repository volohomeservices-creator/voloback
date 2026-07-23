-- Migration 036: Phase 14 - Payout Architecture

-- 1. Payouts
CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    settlement_batch_id UUID REFERENCES settlement_batches(id) ON DELETE SET NULL,
    settlement_ledger_id UUID REFERENCES settlement_ledger(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL,
    provider TEXT DEFAULT 'RAZORPAYX',
    provider_reference TEXT,
    provider_status TEXT,
    utr_number TEXT,
    failure_code TEXT,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY_FOR_PAYOUT', 'QUEUED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED')),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_worker_id ON payouts(worker_id);
CREATE INDEX IF NOT EXISTS idx_payouts_settlement_batch_id ON payouts(settlement_batch_id);
CREATE INDEX IF NOT EXISTS idx_payouts_settlement_ledger_id ON payouts(settlement_ledger_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_provider_reference ON payouts(provider_reference);

-- 2. Payout Attempts
CREATE TABLE IF NOT EXISTS payout_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_id UUID NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    request_payload JSONB,
    response_payload JSONB,
    status TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_attempts_payout_id ON payout_attempts(payout_id);

-- 3. Payout Provider Configs
CREATE TABLE IF NOT EXISTS payout_provider_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_name TEXT UNIQUE NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    environment TEXT DEFAULT 'test',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO payout_provider_configs (provider_name, enabled, environment)
VALUES ('RAZORPAYX', false, 'test')
ON CONFLICT (provider_name) DO NOTHING;

-- 4. Payout Webhook Events
CREATE TABLE IF NOT EXISTS payout_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_webhook_events_provider ON payout_webhook_events(provider);
CREATE INDEX IF NOT EXISTS idx_payout_webhook_events_event_type ON payout_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_payout_webhook_events_processed ON payout_webhook_events(processed);

-- 5. Extend Worker Bank Accounts
ALTER TABLE worker_bank_accounts
ADD COLUMN IF NOT EXISTS provider_contact_id TEXT,
ADD COLUMN IF NOT EXISTS provider_fund_account_id TEXT;

-- 6. RLS Policies
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_webhook_events ENABLE ROW LEVEL SECURITY;

-- Payouts Policies
CREATE POLICY "Workers can view own payouts" ON payouts FOR SELECT TO authenticated USING (worker_id = auth.uid());
CREATE POLICY "Admins can view all payouts" ON payouts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can manage payouts" ON payouts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Payout Attempts Policies
CREATE POLICY "Admins can view all payout attempts" ON payout_attempts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Provider Configs Policies
CREATE POLICY "Admins can view provider configs" ON payout_provider_configs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can manage provider configs" ON payout_provider_configs FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- Webhook Events Policies
CREATE POLICY "Admins can view webhook events" ON payout_webhook_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
