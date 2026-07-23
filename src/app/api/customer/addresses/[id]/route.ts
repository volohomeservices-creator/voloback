import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;
    const { id } = await params;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    const { label, address, latitude, longitude, is_default, place_id, formatted_address } = body;

    // Check ownership
    const { data: existingAddr } = await supabaseAdmin
      .from('customer_addresses')
      .select('*')
      .eq('id', id)
      .single();

    if (!existingAddr || existingAddr.customer_id !== customerId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }

    let lat = latitude !== undefined ? Number(latitude) : existingAddr.latitude;
    let lng = longitude !== undefined ? Number(longitude) : existingAddr.longitude;

    // If the address text changed, or if coordinates are default, geocode it
    if ((address !== undefined && address !== existingAddr.address) || (lat === 12.9716 && lng === 77.5946)) {
      const targetAddress = address !== undefined ? address : existingAddr.address;
      const geocodeResult = await geocodeAddress(targetAddress);
      if (geocodeResult) {
        lat = geocodeResult.lat;
        lng = geocodeResult.lng;
      }
    }

    const { data: updatedAddr, error } = await supabaseAdmin
      .from('customer_addresses')
      .update({
        label,
        address,
        latitude: lat,
        longitude: lng,
        is_default: is_default !== undefined ? !!is_default : existingAddr.is_default,
        place_id: place_id !== undefined ? place_id : existingAddr.place_id,
        formatted_address: formatted_address !== undefined ? formatted_address : existingAddr.formatted_address,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, address: updatedAddr });
  } catch (error: any) {
    console.error('Error updating customer address:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;
    const { id } = await params;

    // Check ownership
    const { data: existingAddr } = await supabaseAdmin
      .from('customer_addresses')
      .select('*')
      .eq('id', id)
      .single();

    if (!existingAddr || existingAddr.customer_id !== customerId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('customer_addresses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Address deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting customer address:', error.message || error);
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
