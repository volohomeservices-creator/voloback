CREATE TYPE payment_status AS ENUM ('PENDING','SUCCESS','FAILED','REFUNDED');

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id          UUID NOT NULL REFERENCES bookings(id),
  customer_id         UUID NOT NULL REFERENCES users(id),

  payment_mode        payment_mode NOT NULL,
  status              payment_status NOT NULL DEFAULT 'PENDING',

  amount              NUMERIC(10,2) NOT NULL,
  admin_commission    NUMERIC(10,2),
  worker_share        NUMERIC(10,2),

  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,

  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
