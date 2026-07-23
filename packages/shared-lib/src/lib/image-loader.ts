export default function supabaseImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  const supabaseDomain = 'supabase.co';
  
  if (src.includes(supabaseDomain)) {
    // Transform storage object retrieval URL into Supabase's image-resizer endpoint
    let transformedSrc = src;
    if (src.includes('/object/public/')) {
      transformedSrc = src.replace('/object/public/', '/render/image/public/');
    }
    
    try {
      const url = new URL(transformedSrc);
      url.searchParams.set('width', width.toString());
      url.searchParams.set('quality', (quality || 75).toString());
      return url.toString();
    } catch {
      return src;
    }
  }
  
  return src;
}
