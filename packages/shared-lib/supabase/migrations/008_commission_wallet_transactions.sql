CREATE TYPE wallet_txn_type AS ENUM ('TOP_UP','DEDUCTION','REFUND');

CREATE TABLE commission_wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id     UUID NOT NULL REFERENCES workers(id),
  booking_id    UUID REFERENCES bookings(id),
  type          wallet_txn_type NOT NULL,
  amount        NUMERIC(10,2) NOT NULL,
  balance_after NUMERIC(10,2) NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
