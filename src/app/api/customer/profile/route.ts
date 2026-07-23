import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { validateBody } from '@/lib/zod-validator';
import { customerProfileUpdateSchema } from '@/lib/schemas';

function getCompletionPercentage(user: any, defaultAddr: any) {
  let completedFields = 2; // user ID and phone are guaranteed
  const totalFields = 8;

  if (user?.full_name) completedFields++;
  if (user?.email) completedFields++;
  if (user?.avatar_url) completedFields++;
  if (defaultAddr?.address) completedFields += 3; // counts address, city, state

  return Math.min(100, Math.round((completedFields / totalFields) * 100));
}

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;

    // Fetch user details
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('full_name, phone, email, avatar_url')
      .eq('id', customerId)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch default address
    const { data: defaultAddr } = await supabaseAdmin
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_default', true)
      .maybeSingle();

    return NextResponse.json({
      full_name: user.full_name || '',
      phone: user.phone || '',
      email: user.email || '',
      avatar_url: user.avatar_url || '',
      address: defaultAddr?.address || '',
      city: defaultAddr?.city || (defaultAddr ? 'Bangalore' : ''),
      state: defaultAddr?.state || (defaultAddr ? 'Karnataka' : ''),
      pincode: defaultAddr?.pincode || '',
      profileCompletion: getCompletionPercentage(user, defaultAddr)
    });
  } catch (error: any) {
    console.error('Error fetching customer profile:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;
    const validation = await validateBody(request, customerProfileUpdateSchema);
    if (!validation.success) return validation.errorResponse;
    const body = validation.data;

    const {
      full_name,
      email,
      address,
      avatar_url,
      city,
      state,
      pincode
    } = body;

    // 1. Update user fields
    const { error: userErr } = await supabaseAdmin
      .from('users')
      .update({
        full_name,
        email,
        avatar_url,
        updated_at: new Date().toISOString()
      })
      .eq('id', customerId);

    if (userErr) {
      if (userErr.code === '23505' || userErr.message?.includes('users_email_key')) {
        return NextResponse.json({ error: 'This email address is already registered to another account.' }, { status: 409 });
      }
      throw userErr;
    }
    // 2. Update default address if provided
    if (address !== undefined || city !== undefined || state !== undefined || pincode !== undefined) {
      // Check if default address exists
      const { data: existingAddr } = await supabaseAdmin
        .from('customer_addresses')
        .select('*')
        .eq('customer_id', customerId)
        .eq('is_default', true)
        .maybeSingle();

      if (existingAddr) {
        const targetAddress = address !== undefined ? address : existingAddr.address;
        const targetCity = city !== undefined ? city : existingAddr.city;
        const targetState = state !== undefined ? state : existingAddr.state;
        const targetPincode = pincode !== undefined ? pincode : existingAddr.pincode;

        let lat = existingAddr.latitude;
        let lng = existingAddr.longitude;

        const fullAddress = `${targetAddress || ''}, ${targetCity || ''}, ${targetState || ''} ${targetPincode || ''}`;
        const geocodeResult = await geocodeAddress(fullAddress, targetCity, targetState);
        if (geocodeResult) {
          lat = geocodeResult.lat;
          lng = geocodeResult.lng;
        }

        await supabaseAdmin
          .from('customer_addresses')
          .update({
            address: targetAddress,
            city: targetCity,
            state: targetState,
            pincode: targetPincode,
            latitude: lat,
            longitude: lng,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingAddr.id);
      } else {
        const targetCity = city || '';
        const targetState = state || '';
        const targetPincode = pincode || '';
        let lat: number | null = null;
        let lng: number | null = null;

        const fullAddress = `${address || ''}, ${targetCity}, ${targetState} ${targetPincode}`;
        const geocodeResult = await geocodeAddress(fullAddress, targetCity, targetState);
        if (geocodeResult) {
          lat = geocodeResult.lat;
          lng = geocodeResult.lng;
        }

        // Insert new default address
        await supabaseAdmin
          .from('customer_addresses')
          .insert({
            customer_id: customerId,
            label: 'HOME',
            address: address || '',
            city: targetCity,
            state: targetState,
            pincode: targetPincode,
            latitude: lat,
            longitude: lng,
            is_default: true
          });
      }
    }

    // 3. Recalculate completion
    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', customerId).single();
    const { data: defaultAddr } = await supabaseAdmin.from('customer_addresses').select('*').eq('customer_id', customerId).eq('is_default', true).maybeSingle();

    return NextResponse.json({
      success: true,
      profileCompletion: getCompletionPercentage(user, defaultAddr)
    });
  } catch (error: any) {
    console.error('Error updating customer profile:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;

    // Soft delete: is_active = false
    const { error } = await supabaseAdmin
      .from('users')
      .update({ is_active: false })
      .eq('id', customerId);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Customer account deactivated.' });
  } catch (error: any) {
    console.error('Error deactivating customer profile:', error.message || error);
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
    } catch (err) {
      console.error(`Nominatim query error for "${q}":`, err);
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
