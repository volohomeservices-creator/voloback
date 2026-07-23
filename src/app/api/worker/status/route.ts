import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function PATCH(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    // 1. Fetch worker KYC status
    const { data: worker, error: workerErr } = await supabaseAdmin
      .from('workers')
      .select('kyc_status, status')
      .eq('id', workerId)
      .single();

    if (workerErr || !worker) {
      return NextResponse.json({ error: 'Worker profile not found.' }, { status: 404 });
    }

    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { status, latitude, longitude } = body;
    
    if (status !== 'ONLINE' && status !== 'OFFLINE' && status !== 'VACATION') {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }

    // 2. Enforce restriction: must be KYC APPROVED to go ONLINE
    if (status === 'ONLINE' && worker.kyc_status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'KYC approval is required before going online.' },
        { status: 403 }
      );
    }

    let lat = (latitude !== undefined && latitude !== null) ? Number(latitude) : null;
    let lng = (longitude !== undefined && longitude !== null) ? Number(longitude) : null;

    if (status === 'ONLINE' && (lat === null || lng === null)) {
      // Check if worker already has non-null coordinates
      const { data: currentWorker } = await supabaseAdmin
        .from('workers')
        .select('current_lat, current_lng')
        .eq('id', workerId)
        .single();
      
      if (currentWorker && currentWorker.current_lat !== null && currentWorker.current_lng !== null) {
        lat = currentWorker.current_lat;
        lng = currentWorker.current_lng;
      } else {
        // Fetch profile details to geocode
        const { data: profile } = await supabaseAdmin
          .from('worker_profiles')
          .select('address, city, state')
          .eq('worker_id', workerId)
          .maybeSingle();
        
        if (profile) {
          const fullAddress = `${profile.address || ''}, ${profile.city}, ${profile.state}`;
          const geocodeResult = await geocodeAddress(fullAddress, profile.city, profile.state);
          if (geocodeResult) {
            lat = geocodeResult.lat;
            lng = geocodeResult.lng;
          }
        }
      }
    }

    // 3. Update status and coordinates in workers table
    const updatePayload: any = {
      status,
      location_updated_at: new Date().toISOString()
    };

    if (status === 'ONLINE' && lat !== null && lng !== null) {
      updatePayload.current_lat = lat;
      updatePayload.current_lng = lng;
    }

    const { error: updateErr } = await supabaseAdmin
      .from('workers')
      .update(updatePayload)
      .eq('id', workerId);

    if (updateErr) throw updateErr;

    // 4. Update vacation mode if toggled via status
    if (status === 'VACATION') {
      await supabaseAdmin
        .from('worker_availability')
        .update({ vacation_mode: true })
        .eq('worker_id', workerId);
    } else {
      await supabaseAdmin
        .from('worker_availability')
        .update({ vacation_mode: false })
        .eq('worker_id', workerId);
    }

    return NextResponse.json({
      success: true,
      status,
      latitude: lat,
      longitude: lng
    });
  } catch (error: any) {
    console.error('Error updating worker status:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

async function geocodeAddress(address: string, city?: string, state?: string): Promise<{ lat: number; lng: number } | null> {
  const queryNominatim = async (q: string) => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'VoloHomeServices/1.0 (contact@volo.com)'
        }
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          return { lat, lng: lon };
        }
      }
    } catch (error) {
      console.error('Nominatim geocoding error:', error);
    }
    return null;
  };

  let coords = await queryNominatim(address);
  if (coords) return coords;

  if (city && state) {
    coords = await queryNominatim(`${city}, ${state}`);
    if (coords) return coords;
  }

  if (city) {
    coords = await queryNominatim(city);
    if (coords) return coords;
  }

  if (state) {
    coords = await queryNominatim(state);
    if (coords) return coords;
  }

  return null;
}
