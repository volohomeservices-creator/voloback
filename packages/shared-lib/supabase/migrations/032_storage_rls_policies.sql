-- Migration 032: Storage Buckets Visibility and Refined RLS Policies

-- 1. Configure bucket visibility status
UPDATE storage.buckets 
SET public = true 
WHERE id IN ('profile-images', 'booking-images');

-- 2. Clear existing policies to prevent conflict errors
DROP POLICY IF EXISTS "Public profile-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public profile-images select" ON storage.objects;
DROP POLICY IF EXISTS "Public profile-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public profile-images delete" ON storage.objects;

DROP POLICY IF EXISTS "Public booking-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public booking-images select" ON storage.objects;
DROP POLICY IF EXISTS "Public booking-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public booking-images delete" ON storage.objects;

DROP POLICY IF EXISTS "Public service-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images select" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images delete" ON storage.objects;

DROP POLICY IF EXISTS "Public kyc-docs insert" ON storage.objects;
DROP POLICY IF EXISTS "Public kyc-docs select" ON storage.objects;
DROP POLICY IF EXISTS "Public kyc-docs update" ON storage.objects;
DROP POLICY IF EXISTS "Public kyc-docs delete" ON storage.objects;

DROP POLICY IF EXISTS "Public invoices insert" ON storage.objects;
DROP POLICY IF EXISTS "Public invoices select" ON storage.objects;
DROP POLICY IF EXISTS "Public invoices update" ON storage.objects;
DROP POLICY IF EXISTS "Public invoices delete" ON storage.objects;

-- 3. Re-create refined RLS policies for storage buckets

-- profile-images (Public Read/Write)
CREATE POLICY "Public profile-images insert" ON storage.objects 
  FOR INSERT TO public WITH CHECK (bucket_id = 'profile-images');

CREATE POLICY "Public profile-images select" ON storage.objects 
  FOR SELECT TO public USING (bucket_id = 'profile-images');

CREATE POLICY "Public profile-images update" ON storage.objects 
  FOR UPDATE TO public USING (bucket_id = 'profile-images');

CREATE POLICY "Public profile-images delete" ON storage.objects 
  FOR DELETE TO public USING (bucket_id = 'profile-images');

-- booking-images (Public Read/Write)
CREATE POLICY "Public booking-images insert" ON storage.objects 
  FOR INSERT TO public WITH CHECK (bucket_id = 'booking-images');

CREATE POLICY "Public booking-images select" ON storage.objects 
  FOR SELECT TO public USING (bucket_id = 'booking-images');

CREATE POLICY "Public booking-images update" ON storage.objects 
  FOR UPDATE TO public USING (bucket_id = 'booking-images');

CREATE POLICY "Public booking-images delete" ON storage.objects 
  FOR DELETE TO public USING (bucket_id = 'booking-images');

-- service-images (Public Read Only)
CREATE POLICY "Public service-images select" ON storage.objects 
  FOR SELECT TO public USING (bucket_id = 'service-images');

-- kyc-docs (Public uploads/upsert capability, bucket itself remains private)
CREATE POLICY "Public kyc-docs insert" ON storage.objects 
  FOR INSERT TO public WITH CHECK (bucket_id = 'kyc-docs');

CREATE POLICY "Public kyc-docs select" ON storage.objects 
  FOR SELECT TO public USING (bucket_id = 'kyc-docs');

CREATE POLICY "Public kyc-docs update" ON storage.objects 
  FOR UPDATE TO public USING (bucket_id = 'kyc-docs');
