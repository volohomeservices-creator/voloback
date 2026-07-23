-- Migration 023: Create worker availability and profiles schema.

-- 1. Create worker_profiles table
CREATE TABLE IF NOT EXISTS worker_profiles (
  worker_id   UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
  address     TEXT,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  skills      TEXT[] DEFAULT '{}'::TEXT[],
  experience  INTEGER DEFAULT 0 CHECK (experience >= 0),
  languages   TEXT[] DEFAULT '{}'::TEXT[],
  bio         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create worker_availability table
CREATE TABLE IF NOT EXISTS worker_availability (
  worker_id         UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
  working_days      TEXT[] DEFAULT '{"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}'::TEXT[],
  start_time        TIME DEFAULT '09:00:00',
  end_time          TIME DEFAULT '18:00:00',
  vacation_mode     BOOLEAN DEFAULT FALSE,
  unavailable_dates DATE[] DEFAULT '{}'::DATE[],
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Trigger to automatically provision profiles and availability on worker creation
CREATE OR REPLACE FUNCTION handle_new_worker_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO worker_profiles (worker_id, city, state)
  VALUES (NEW.id, 'Bangalore', 'Karnataka')
  ON CONFLICT (worker_id) DO NOTHING;

  INSERT INTO worker_availability (worker_id)
  VALUES (NEW.id)
  ON CONFLICT (worker_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_worker_profile ON workers;
CREATE TRIGGER trg_create_worker_profile
  AFTER INSERT ON workers
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_worker_profile();

-- Backfill profiles and availability configurations for existing workers
INSERT INTO worker_profiles (worker_id, city, state)
SELECT id, 'Bangalore', 'Karnataka'
FROM workers
ON CONFLICT (worker_id) DO NOTHING;

INSERT INTO worker_availability (worker_id)
SELECT id
FROM workers
ON CONFLICT (worker_id) DO NOTHING;
