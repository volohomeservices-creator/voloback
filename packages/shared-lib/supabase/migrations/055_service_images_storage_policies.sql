-- Migration 055: Create storage policies for service-images bucket to allow image upload by admin
-- Clear existing policies if any
DROP POLICY IF EXISTS "Public service-images insert" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images update" ON storage.objects;
DROP POLICY IF EXISTS "Public service-images delete" ON storage.objects;

-- Create policies for public access (since other public buckets like profile-images and booking-images use TO public)
CREATE POLICY "Public service-images insert" ON storage.objects 
  FOR INSERT TO public WITH CHECK (bucket_id = 'service-images');

CREATE POLICY "Public service-images update" ON storage.objects 
  FOR UPDATE TO public USING (bucket_id = 'service-images');

CREATE POLICY "Public service-images delete" ON storage.objects 
  FOR DELETE TO public USING (bucket_id = 'service-images');
