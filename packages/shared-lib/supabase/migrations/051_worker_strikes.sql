-- Create worker strikes system
CREATE TABLE IF NOT EXISTS worker_strikes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id UUID NOT NULL REFERENCES workers(id),
  admin_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_strikes_worker ON worker_strikes(worker_id);

-- Add a strike count caching column to workers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workers' AND column_name='strike_count'
  ) THEN
    ALTER TABLE workers ADD COLUMN strike_count SMALLINT DEFAULT 0;
  END IF;
END $$;

-- Trigger to auto-update worker's strike count
CREATE OR REPLACE FUNCTION update_worker_strike_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE workers SET strike_count = strike_count + 1 WHERE id = NEW.worker_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE workers SET strike_count = GREATEST(0, strike_count - 1) WHERE id = OLD.worker_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_strike_count ON worker_strikes;
CREATE TRIGGER trg_update_strike_count
AFTER INSERT OR DELETE ON worker_strikes
FOR EACH ROW EXECUTE FUNCTION update_worker_strike_count();
