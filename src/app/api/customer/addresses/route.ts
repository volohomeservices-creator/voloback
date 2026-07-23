import { customerAddressSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;

    const { data: addresses, error } = await supabaseAdmin
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', customerId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ addresses: addresses || [] });
  } catch (error: any) {
    console.error('Error fetching customer addresses:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;
    const validation = await validateBody(request, customerAddressSchema);
    if (!validation.success) return validation.errorResponse;
    const body = validation.data;
    const { label, address, latitude, longitude, is_default, place_id, formatted_address } = body;

    if (!label || !address) {
      return NextResponse.json({ error: 'Label and Address are required.' }, { status: 400 });
    }

    let lat = Number(latitude || 12.9716);
    let lng = Number(longitude || 77.5946);

    // If coordinates are the default Bangalore coordinates, try to geocode the address string
    if (lat === 12.9716 && lng === 77.5946) {
      const geocodeResult = await geocodeAddress(address);
      if (geocodeResult) {
        lat = geocodeResult.lat;
        lng = geocodeResult.lng;
      }
    }

    // Insert new address
    const { data: newAddr, error } = await supabaseAdmin
      .from('customer_addresses')
      .insert({
        customer_id: customerId,
        label,
        address,
        latitude: lat,
        longitude: lng,
        is_default: !!is_default,
        place_id: place_id || null,
        formatted_address: formatted_address || address
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, address: newAddr });
  } catch (error: any) {
    console.error('Error creating customer address:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
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
}
