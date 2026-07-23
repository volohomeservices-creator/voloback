-- Admin uses email+password. Store bcrypt hash here.
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- This column is only populated for role='admin' rows.
-- Customer and Worker rows will have password_hash = NULL.
