CREATE TYPE booking_type   AS ENUM ('INSTANT','SCHEDULED');
CREATE TYPE payment_mode   AS ENUM ('ONLINE','COD');
CREATE TYPE booking_status AS ENUM (
  'PENDING_ASSIGNMENT',
  'WORKER_ASSIGNED',
  'WORKER_ACCEPTED',
  'WORKER_REJECTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID NOT NULL REFERENCES users(id),
  worker_id       UUID REFERENCES workers(id),
  service_item_id UUID NOT NULL REFERENCES service_items(id),

  booking_type    booking_type NOT NULL,
  payment_mode    payment_mode NOT NULL,
  status          booking_status NOT NULL DEFAULT 'PENDING_ASSIGNMENT',

  address_line    TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,

  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  total_amount    NUMERIC(10,2) NOT NULL,
  notes           TEXT,
  otp             TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_worker   ON bookings(worker_id);
CREATE INDEX idx_bookings_status   ON bookings(status);
