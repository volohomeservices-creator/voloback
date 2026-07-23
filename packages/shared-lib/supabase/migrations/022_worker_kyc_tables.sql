-- Create worker_documents table to track document uploads
CREATE TABLE IF NOT EXISTS worker_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL, -- AADHAAR_FRONT, AADHAAR_BACK, PAN_CARD, PROFILE_PHOTO, SELFIE_VERIFICATION
  file_url      TEXT NOT NULL,
  file_size     INTEGER NOT NULL, -- in bytes
  mime_type     VARCHAR(50) NOT NULL DEFAULT 'image/webp',
  status        kyc_status NOT NULL DEFAULT 'PENDING',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_worker_document UNIQUE (worker_id, document_type)
);

-- Create worker_kyc table for verification review state
CREATE TABLE IF NOT EXISTS worker_kyc (
  worker_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  aadhaar_status kyc_status NOT NULL DEFAULT 'PENDING',
  pan_status     kyc_status NOT NULL DEFAULT 'PENDING',
  selfie_status  kyc_status NOT NULL DEFAULT 'PENDING',
  overall_status kyc_status NOT NULL DEFAULT 'PENDING',
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  remarks        TEXT,
  submitted_at   TIMESTAMPTZ
);

-- Trigger function to automatically create a worker_kyc record on worker insertion
CREATE OR REPLACE FUNCTION create_worker_kyc_entry()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO worker_kyc (worker_id)
  VALUES (NEW.id)
  ON CONFLICT (worker_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute on worker creation
DROP TRIGGER IF EXISTS trg_create_worker_kyc ON workers;
CREATE TRIGGER trg_create_worker_kyc
  AFTER INSERT ON workers
  FOR EACH ROW
  EXECUTE FUNCTION create_worker_kyc_entry();

-- Backfill worker_kyc entries for existing workers
INSERT INTO worker_kyc (worker_id, aadhaar_status, pan_status, selfie_status, overall_status)
SELECT 
  id,
  kyc_status AS aadhaar_status,
  kyc_status AS pan_status,
  kyc_status AS selfie_status,
  kyc_status AS overall_status
FROM workers
ON CONFLICT (worker_id) DO NOTHING;
