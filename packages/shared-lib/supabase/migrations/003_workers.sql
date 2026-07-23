CREATE TYPE worker_status AS ENUM ('ONLINE','OFFLINE','ON_JOB','SUSPENDED');
CREATE TYPE kyc_status    AS ENUM ('PENDING','APPROVED','REJECTED');

CREATE TABLE workers (
  id                        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                    worker_status NOT NULL DEFAULT 'OFFLINE',
  kyc_status                kyc_status NOT NULL DEFAULT 'PENDING',

  current_lat               DOUBLE PRECISION,
  current_lng               DOUBLE PRECISION,
  location_updated_at       TIMESTAMPTZ,

  aadhar_front_url          TEXT,
  aadhar_back_url           TEXT,
  pan_url                   TEXT,
  selfie_url                TEXT,

  bank_account_name         TEXT,
  bank_account_number       TEXT,
  bank_ifsc                 TEXT,
  razorpayx_contact_id      TEXT,
  razorpayx_fund_account_id TEXT,

  commission_wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,

  rating                    NUMERIC(3,2) DEFAULT 5.00,
  total_jobs                INT DEFAULT 0,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workers_location ON workers (current_lat, current_lng)
  WHERE status = 'ONLINE';
