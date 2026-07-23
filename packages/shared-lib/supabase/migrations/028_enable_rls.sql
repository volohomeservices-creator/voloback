-- Migration 028: Enable RLS on all remaining tables from Phases 3 to 8
ALTER TABLE audit_logs                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_documents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_kyc                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_availability              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_images                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_queue                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_job_rejections            ENABLE ROW LEVEL SECURITY;
