ALTER TABLE users RENAME COLUMN supabase_uid TO firebase_uid;

-- Admin accounts don't use Firebase so firebase_uid can be NULL
ALTER TABLE users ALTER COLUMN firebase_uid DROP NOT NULL;

-- Add unique index (firebase_uid can be null, nulls don't conflict)
CREATE UNIQUE INDEX idx_users_firebase_uid
  ON users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;
