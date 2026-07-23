-- 042_referral_program.sql
-- Full referral system for both customers and workers
-- Reward amounts managed dynamically from admin dashboard

-- 1. Referral Settings (admin-configurable reward amounts)
CREATE TABLE IF NOT EXISTS referral_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role TEXT NOT NULL CHECK (role IN ('customer', 'worker')),
    referrer_reward NUMERIC NOT NULL DEFAULT 500,   -- reward given to the person who referred
    referee_reward NUMERIC NOT NULL DEFAULT 200,    -- reward given to the new signup (discount)
    min_bookings_to_qualify INTEGER NOT NULL DEFAULT 1, -- referred user must complete N bookings
    active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Insert default settings for both roles
INSERT INTO referral_settings (role, referrer_reward, referee_reward, min_bookings_to_qualify)
VALUES 
    ('customer', 500, 200, 1),
    ('worker', 500, 0, 5)
ON CONFLICT DO NOTHING;

-- 2. Add role column to referral_codes so we know whether the code is for customer or worker
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'worker'));

-- 3. Add role to referrals table for filtering
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'worker'));

-- 4. Add rewarded_at timestamp to referrals
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMPTZ;

-- 5. RLS for referral_settings - Admins full access, users can read
ALTER TABLE referral_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to referral_settings" ON referral_settings
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'ADMIN'));

CREATE POLICY "Authenticated users can read referral_settings" ON referral_settings
    FOR SELECT TO authenticated
    USING (active = true);

-- 6. Allow users to INSERT their own referral_code (so the API can create it on first visit)
CREATE POLICY "Users can insert their own referral code" ON referral_codes
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- 7. Allow any authenticated user to look up a referral code (to validate on signup)
CREATE POLICY "Any user can look up referral codes by code" ON referral_codes
    FOR SELECT TO authenticated
    USING (true);

-- 8. Allow users to insert referral records (on signup with ref code)
CREATE POLICY "Users can insert referral records for themselves" ON referrals
    FOR INSERT TO authenticated
    WITH CHECK (referred_user_id = auth.uid());
