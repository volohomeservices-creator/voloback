-- 043_promo_codes.sql
-- Promo / Coupon Code Management System

CREATE TABLE promo_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FLAT')),
    discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
    min_order_amount NUMERIC DEFAULT 0,
    max_discount_amount NUMERIC,          -- cap for PERCENT type
    max_uses INTEGER DEFAULT NULL,        -- NULL = unlimited
    used_count INTEGER DEFAULT 0,
    applicable_role TEXT DEFAULT 'customer' CHECK (applicable_role IN ('customer', 'worker', 'all')),
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NULL,  -- NULL = never expires
    active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promo_codes_code ON promo_codes(code);
CREATE INDEX idx_promo_codes_active ON promo_codes(active);
CREATE INDEX idx_promo_codes_expires_at ON promo_codes(expires_at);

-- Track which bookings used which promo code
CREATE TABLE promo_code_usages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    discount_applied NUMERIC NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(promo_code_id, user_id)  -- one use per user per code
);

CREATE INDEX idx_promo_code_usages_code_id ON promo_code_usages(promo_code_id);
CREATE INDEX idx_promo_code_usages_user_id ON promo_code_usages(user_id);

-- RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages ENABLE ROW LEVEL SECURITY;

-- Admins have full access
CREATE POLICY "Admins have full access to promo_codes" ON promo_codes
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN'));

CREATE POLICY "Admins have full access to promo_code_usages" ON promo_code_usages
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN'));

-- Customers / Workers can read active codes (needed for validation)
CREATE POLICY "Authenticated users can read active promo_codes" ON promo_codes
    FOR SELECT TO authenticated
    USING (active = true AND (expires_at IS NULL OR expires_at > NOW()));

-- Users can see their own usage
CREATE POLICY "Users can see their own promo usages" ON promo_code_usages
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
