CREATE TABLE worker_location_logs (
  id          BIGSERIAL PRIMARY KEY,
  worker_id   UUID NOT NULL REFERENCES workers(id),
  booking_id  UUID REFERENCES bookings(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_location_worker_booking
  ON worker_location_logs(worker_id, booking_id, recorded_at DESC);
