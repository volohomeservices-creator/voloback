-- Add is_hidden column to reviews table to allow admins to moderate abusive reviews
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='reviews' AND column_name='is_hidden'
  ) THEN
    ALTER TABLE reviews ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE;
  END IF;
END $$;
