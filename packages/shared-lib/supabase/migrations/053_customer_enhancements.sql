-- Add VIP Subscription (Volo Prime) and Gamification (Volo Coins) to Users

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_prime BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS volo_coins INTEGER DEFAULT 0;

-- Optional: Create a table for coin transaction history
CREATE TABLE IF NOT EXISTS volo_coin_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL, -- Positive for earning, negative for spending
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user ON volo_coin_transactions(user_id);

-- Create customer favorites table
CREATE TABLE IF NOT EXISTS customer_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id),
    worker_id UUID NOT NULL REFERENCES workers(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_customer ON customer_favorites(customer_id);
