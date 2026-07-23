-- Migration 041: Customer Wallets + Transactions

-- 1. Customer Wallets Table
CREATE TABLE IF NOT EXISTS customer_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_wallets_customer_id ON customer_wallets(customer_id);

-- 2. Customer Wallet Transactions Table
CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('TOP_UP', 'PAYMENT', 'REFUND')),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_wallet_txns_customer_id ON customer_wallet_transactions(customer_id);

-- 3. Enable RLS
ALTER TABLE customer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_wallet_transactions ENABLE ROW LEVEL SECURITY;

-- 4. Policies for Customer Wallets
DROP POLICY IF EXISTS "Customers can view own wallet" ON customer_wallets;
CREATE POLICY "Customers can view own wallet" ON customer_wallets
    FOR SELECT TO authenticated
    USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all customer wallets" ON customer_wallets;
CREATE POLICY "Admins can view all customer wallets" ON customer_wallets
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

DROP POLICY IF EXISTS "Admins can update all customer wallets" ON customer_wallets;
CREATE POLICY "Admins can update all customer wallets" ON customer_wallets
    FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- 5. Policies for Customer Wallet Transactions
DROP POLICY IF EXISTS "Customers can view own customer transactions" ON customer_wallet_transactions;
CREATE POLICY "Customers can view own customer transactions" ON customer_wallet_transactions
    FOR SELECT TO authenticated
    USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all customer transactions" ON customer_wallet_transactions;
CREATE POLICY "Admins can view all customer transactions" ON customer_wallet_transactions
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

DROP POLICY IF EXISTS "Admins can insert customer transactions" ON customer_wallet_transactions;
CREATE POLICY "Admins can insert customer transactions" ON customer_wallet_transactions
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
