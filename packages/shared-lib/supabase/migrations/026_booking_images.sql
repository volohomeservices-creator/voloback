-- Migration 026: Create booking_images table

CREATE TABLE IF NOT EXISTS booking_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_booking_images_booking ON booking_images(booking_id);
