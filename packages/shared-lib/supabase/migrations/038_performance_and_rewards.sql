-- 038_performance_and_rewards.sql

-- 1. Modify existing `reviews` table
ALTER TABLE reviews RENAME COLUMN comment TO review_text;
ALTER TABLE reviews ADD COLUMN would_recommend BOOLEAN;

-- Create indexes on existing reviews table
CREATE INDEX IF NOT EXISTS idx_reviews_booking_id ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_worker_id ON reviews(worker_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);

-- 2. Performance Scores
CREATE TABLE worker_performance_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID NOT NULL UNIQUE REFERENCES workers(id) ON DELETE CASCADE,
    overall_score NUMERIC DEFAULT 0,
    rating_score NUMERIC DEFAULT 0,
    acceptance_score NUMERIC DEFAULT 0,
    completion_score NUMERIC DEFAULT 0,
    arrival_score NUMERIC DEFAULT 0,
    response_score NUMERIC DEFAULT 0,
    jobs_completed INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Worker Badges
CREATE TABLE worker_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    badge_type TEXT NOT NULL,
    badge_name TEXT NOT NULL,
    earned_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_worker_badges_worker_id ON worker_badges(worker_id);

-- 4. Incentive Engine
CREATE TABLE incentive_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name TEXT NOT NULL,
    condition_type TEXT NOT NULL,
    threshold NUMERIC NOT NULL,
    reward_amount NUMERIC NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE worker_incentives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES incentive_rules(id) ON DELETE CASCADE,
    reward_amount NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);
CREATE INDEX idx_worker_incentives_worker_id ON worker_incentives(worker_id);
CREATE INDEX idx_worker_incentives_status ON worker_incentives(status);

-- 5. Referral System
CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code TEXT UNIQUE NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_referral_codes_user_id ON referral_codes(user_id);

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL REFERENCES referral_codes(referral_code),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'QUALIFIED', 'REWARDED')),
    reward_amount NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX idx_referrals_status ON referrals(status);

-- 6. Loyalty Program
CREATE TABLE loyalty_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    points INTEGER NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_loyalty_points_customer_id ON loyalty_points(customer_id);

CREATE TABLE loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('EARNED', 'REDEEMED', 'EXPIRED')),
    reference_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_loyalty_transactions_customer_id ON loyalty_transactions(customer_id);

-- Enable RLS
ALTER TABLE worker_performance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_incentives ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

-- Admin Full Access Policies
CREATE POLICY "Admins have full access to worker_performance_scores" ON worker_performance_scores FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to worker_badges" ON worker_badges FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to incentive_rules" ON incentive_rules FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to worker_incentives" ON worker_incentives FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to referral_codes" ON referral_codes FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to referrals" ON referrals FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to loyalty_points" ON loyalty_points FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);
CREATE POLICY "Admins have full access to loyalty_transactions" ON loyalty_transactions FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);

-- Worker Access Policies
CREATE POLICY "Workers can view their own performance scores" ON worker_performance_scores FOR SELECT TO authenticated USING (
    worker_id = auth.uid()
);
CREATE POLICY "Workers can view their own badges" ON worker_badges FOR SELECT TO authenticated USING (
    worker_id = auth.uid()
);
CREATE POLICY "Workers can view their own incentives" ON worker_incentives FOR SELECT TO authenticated USING (
    worker_id = auth.uid()
);
CREATE POLICY "Workers can view active incentive rules" ON incentive_rules FOR SELECT TO authenticated USING (
    active = true
);
CREATE POLICY "Users can view their own referral codes" ON referral_codes FOR SELECT TO authenticated USING (
    user_id = auth.uid()
);
CREATE POLICY "Users can view their own referrals" ON referrals FOR SELECT TO authenticated USING (
    referrer_id = auth.uid() OR referred_user_id = auth.uid()
);

-- Customer Access Policies
CREATE POLICY "Customers can view their loyalty points" ON loyalty_points FOR SELECT TO authenticated USING (
    customer_id = auth.uid()
);
CREATE POLICY "Customers can view their loyalty transactions" ON loyalty_transactions FOR SELECT TO authenticated USING (
    customer_id = auth.uid()
);

-- Updates to reviews policy if necessary
-- Assuming it already exists, let's just make sure customers can create their own reviews
DROP POLICY IF EXISTS "Customers can create reviews for their bookings" ON reviews;
CREATE POLICY "Customers can create reviews for their bookings" ON reviews FOR INSERT TO authenticated WITH CHECK (
    customer_id = auth.uid()
);

DROP POLICY IF EXISTS "Customers can view their own reviews" ON reviews;
CREATE POLICY "Customers can view their own reviews" ON reviews FOR SELECT TO authenticated USING (
    customer_id = auth.uid() OR worker_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN')
);

-- Function to handle average rating update trigger (optional optimization for performance score calculation)
CREATE OR REPLACE FUNCTION update_worker_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE worker_performance_scores
    SET rating_score = (
        SELECT COALESCE(AVG(rating), 0)
        FROM reviews
        WHERE worker_id = NEW.worker_id
    )
    WHERE worker_id = NEW.worker_id;

    -- Update the core workers table as well, since that might be used elsewhere
    UPDATE workers
    SET rating = (
        SELECT COALESCE(AVG(rating), 0)
        FROM reviews
        WHERE worker_id = NEW.worker_id
    )
    WHERE id = NEW.worker_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_worker_rating_trigger
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION update_worker_rating();
