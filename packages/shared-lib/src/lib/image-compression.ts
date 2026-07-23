import imageCompression from 'browser-image-compression';

export async function compressKycImage(file: File, documentType: string): Promise<File> {
  const isDocument = ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN_CARD'].includes(documentType);
  
  const options = {
    maxSizeMB: isDocument ? 0.3 : 0.25, // 300KB for docs, 250KB for photos
    maxWidthOrHeight: isDocument ? 1200 : 800, // 1200px width for docs, 800px for photos
    useWebWorker: true,
    fileType: 'image/webp'
  };

  try {
    const compressedBlob = await imageCompression(file, options);
    
    // Create new WebP File object from the compressed blob
    const fileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const webpFile = new File(
      [compressedBlob], 
      `${fileName}.webp`, 
      {
        type: 'image/webp',
        lastModified: Date.now()
      }
    );
    
    console.log(`[Compression] Original: ${(file.size / 1024).toFixed(1)}KB, Compressed: ${(webpFile.size / 1024).toFixed(1)}KB`);
    return webpFile;
  } catch (err) {
    console.error('Image compression failed:', err);
    throw err;
  }
}

export async function compressCategoryImage(file: File): Promise<File> {
  // If the file is already under 50KB, return it directly to avoid any quality loss
  if (file.size <= 49 * 1024) {
    console.log(`[Category Compression] File is already under 50KB (${(file.size / 1024).toFixed(1)}KB). Skipping compression.`);
    return file;
  }

  const options = {
    maxSizeMB: 0.048, // Target strictly under 50KB (48KB limit)
    maxWidthOrHeight: 1000, // High-res width/height for premium crispness (Urban Company standard)
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.90 // Start with high quality factor
  };

  try {
    const compressedBlob = await imageCompression(file, options);
    const fileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const webpFile = new File(
      [compressedBlob],
      `${fileName}.webp`,
      {
        type: 'image/webp',
        lastModified: Date.now()
      }
    );
    console.log(`[Category Compression] Original: ${(file.size / 1024).toFixed(1)}KB, Compressed: ${(webpFile.size / 1024).toFixed(1)}KB`);
    return webpFile;
  } catch (err) {
    console.error('Category image compression failed:', err);
    throw err;
  }
}

