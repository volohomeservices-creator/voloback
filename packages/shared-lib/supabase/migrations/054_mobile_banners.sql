CREATE TABLE IF NOT EXISTS mobile_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  discount_label TEXT NOT NULL DEFAULT 'OFFER',
  action_url TEXT,
  background_color TEXT DEFAULT '#6366f1',
  image_name TEXT DEFAULT 'home_services_banner.png',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
