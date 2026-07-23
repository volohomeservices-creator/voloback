CREATE TYPE settlement_status AS ENUM ('PENDING','PROCESSING','PAID','FAILED');

CREATE TABLE settlement_ledger (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id             UUID NOT NULL REFERENCES workers(id),
  payment_id            UUID NOT NULL REFERENCES payments(id),

  amount                NUMERIC(10,2) NOT NULL,
  status                settlement_status NOT NULL DEFAULT 'PENDING',

  razorpayx_payout_id   TEXT,
  razorpayx_transfer_id TEXT,
  payout_initiated_at   TIMESTAMPTZ,
  payout_completed_at   TIMESTAMPTZ,

  week_end_date         DATE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_settlement_worker ON settlement_ledger(worker_id, status);
