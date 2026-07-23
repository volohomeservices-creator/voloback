CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id UUID NOT NULL REFERENCES users(id),
  worker_id   UUID NOT NULL REFERENCES workers(id),
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
