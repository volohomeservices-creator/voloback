import { supabaseAdmin } from './supabase-server';

export async function ensureBucketsExist() {
  const buckets = ['kyc-docs', 'profile-images', 'service-images', 'booking-images', 'invoices'];
  
  for (const bucket of buckets) {
    const isPublic = ['service-images', 'profile-images', 'booking-images'].includes(bucket);
    try {
      const { data: bucketData, error: getError } = await supabaseAdmin.storage.getBucket(bucket);
      
      if (getError || !bucketData) {
        console.log(`Bucket "${bucket}" not found, creating it...`);
        const { error: createError } = await supabaseAdmin.storage.createBucket(bucket, {
          public: isPublic,
          fileSizeLimit: 1048576 * 5, // 5MB limit
          allowedMimeTypes: bucket === 'invoices' 
            ? ['application/pdf'] 
            : ['image/webp', 'image/png', 'image/jpeg']
        });
        
        if (createError) {
          console.error(`Failed to create bucket "${bucket}":`, createError.message);
        } else {
          console.log(`Successfully created bucket: "${bucket}"`);
        }
      }
    } catch (err: any) {
      console.error(`Error verifying bucket "${bucket}":`, err.message || err);
    }
  }
}
