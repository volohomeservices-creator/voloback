CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supabase_uid  UUID UNIQUE NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('customer','worker','admin')),
  full_name     TEXT,
  phone         TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  avatar_url    TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
