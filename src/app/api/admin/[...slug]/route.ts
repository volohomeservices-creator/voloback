import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { logAuditAction } from '@/lib/audit';
import { AuditAction } from '@/types';
import { dispatchNotification, dispatchBulkNotifications } from '@/lib/notification-dispatcher';
import { memoryCache } from '@/lib/cache';


// Helper to calculate date boundaries
const getTodayDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const getStartOfWeekDate = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
};

const getStartOfMonthDate = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};

// GET Route handlers
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    // 1. Enforce strict admin access control
    const session = await requireRole(request, 'admin');
    const { slug } = await params;

    // X. search
    if (slug[0] === 'search') {
      const { searchParams } = new URL(request.url);
      const query = searchParams.get('q') || '';

      if (!query.trim()) {
        return NextResponse.json({ workers: [], customers: [], bookings: [] });
      }

      const cleanQuery = query.trim();

      // Parallel database lookups
      const [workersRes, customersRes, bookingsRes] = await Promise.all([
        supabaseAdmin
          .from('users')
          .select('id, full_name, phone')
          .eq('role', 'worker')
          .or(`full_name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%`)
          .eq('is_active', true)
          .limit(5),
        supabaseAdmin
          .from('users')
          .select('id, full_name, phone')
          .eq('role', 'customer')
          .or(`full_name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%`)
          .eq('is_active', true)
          .limit(5),
        supabaseAdmin
          .from('bookings')
          .select('id, status, service_items(name)')
          .or(`status.ilike.%${cleanQuery}%`)
          .limit(5)
      ]);

      // Handle UUID check for exact booking ID lookup
      let bookingByUuid: any[] = [];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(cleanQuery)) {
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('id, status, service_items(name)')
          .eq('id', cleanQuery)
          .limit(1);
        if (data) bookingByUuid = data;
      }

      const workers = (workersRes.data || []).map((w: any) => ({
        name: `${w.full_name} (${w.phone})`,
        url: `/admin/workers/${w.id}`
      }));

      const customers = (customersRes.data || []).map((c: any) => ({
        name: `${c.full_name} (${c.phone})`,
        url: `/admin/customers/${c.id}`
      }));

      const bookingsCombined = [...bookingByUuid, ...(bookingsRes.data || [])];
      // Deduplicate bookings
      const uniqueBookings = Array.from(new Map(bookingsCombined.map(b => [b.id, b])).values());

      const bookings = uniqueBookings.slice(0, 5).map((b: any) => ({
        name: `Booking ${(b.service_items as any)?.name || 'Service'} (${b.id.substring(0, 8)}) - ${b.status}`,
        url: `/admin/bookings`
      }));

      return NextResponse.json({ workers, customers, bookings });
    }

    // A. dashboard/metrics
    if (slug[0] === 'dashboard' && slug[1] === 'metrics') {
      const today = getTodayDate();
      const weekStart = getStartOfWeekDate();
      const monthStart = getStartOfMonthDate();

      // Run multiple aggregations parallelly to avoid block
      const [
        { count: totalWorkers },
        { count: activeWorkers },
        { count: pendingKyc },
        { count: totalCustomers },
        { count: todaysBookings },
        { count: completedBookings },
        { count: pendingBookings },
        { data: paymentsToday },
        { data: paymentsWeek },
        { data: paymentsMonth },
        { data: pendingSettlementsData }
      ] = await Promise.all([
        supabaseAdmin.from('workers').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('workers').select('*', { count: 'exact', head: true }).in('status', ['ONLINE', 'ON_JOB']),
        supabaseAdmin.from('workers').select('*', { count: 'exact', head: true }).eq('kyc_status', 'PENDING'),
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer'),
        supabaseAdmin.from('bookings').select('*', { count: 'exact', head: true }).gte('created_at', today),
        supabaseAdmin.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED'),
        supabaseAdmin.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'PENDING_ASSIGNMENT'),
        supabaseAdmin.from('payments').select('amount').eq('status', 'SUCCESS').gte('paid_at', today),
        supabaseAdmin.from('payments').select('amount').eq('status', 'SUCCESS').gte('paid_at', weekStart),
        supabaseAdmin.from('payments').select('amount').eq('status', 'SUCCESS').gte('paid_at', monthStart),
        supabaseAdmin.from('settlement_ledger').select('amount').eq('status', 'PENDING')
      ]);

      const sumAmount = (arr: any[] | null) => (arr || []).reduce((sum, item) => sum + Number(item.amount), 0);

      return NextResponse.json({
        total_workers: totalWorkers || 0,
        active_workers: activeWorkers || 0,
        pending_kyc: pendingKyc || 0,
        total_customers: totalCustomers || 0,
        todays_bookings: todaysBookings || 0,
        completed_bookings: completedBookings || 0,
        pending_bookings: pendingBookings || 0,
        revenue_today: sumAmount(paymentsToday),
        revenue_this_week: sumAmount(paymentsWeek),
        revenue_this_month: sumAmount(paymentsMonth),
        pending_settlements: (pendingSettlementsData || []).length,
        pending_settlement_amount: sumAmount(pendingSettlementsData)
      });
    }

    // B. dashboard/recent-activity
    if (slug[0] === 'dashboard' && slug[1] === 'recent-activity') {
      const { data: logs, error } = await supabaseAdmin
        .from('audit_logs')
        .select('*, users(full_name)')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return NextResponse.json(logs || []);
    }

    // C. workers
    if (slug[0] === 'workers' && slug.length === 1) {
      const { searchParams } = new URL(request.url);
      const page = Math.max(1, Number(searchParams.get('page') || 1));
      const limit = Math.max(1, Number(searchParams.get('limit') || 20));
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const kycStatus = searchParams.get('kyc_status') || '';

      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from('workers')
        .select('id, status, kyc_status, rating, total_jobs, created_at, location_updated_at, users!inner(full_name, phone), worker_wallets(balance)', { count: 'exact' });

      if (search) {
        query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`, { foreignTable: 'users' });
      }
      if (status) {
        query = query.eq('status', status);
      }
      if (kycStatus) {
        query = query.eq('kyc_status', kycStatus);
      }

      const { data: workers, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return NextResponse.json({
        workers: (workers || []).map((w: any) => ({
          id: w.id,
          full_name: w.users?.full_name,
          phone: w.users?.phone,
          status: w.status,
          kyc_status: w.kyc_status,
          rating: w.rating,
          total_jobs: w.total_jobs,
          commission_wallet_balance: (Array.isArray(w.worker_wallets) ? w.worker_wallets[0]?.balance : w.worker_wallets?.balance) || 0,
          created_at: w.created_at,
          location_updated_at: w.location_updated_at
        })),
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });
    }

    // D. workers/[id]
    if (slug[0] === 'workers' && slug.length === 2) {
      const workerId = slug[1];

      // Fetch user profile join worker details and profile details
      const { data: worker, error: workerErr } = await supabaseAdmin
        .from('workers')
        .select('*, users(*), worker_profiles(*), worker_wallets(balance)')
        .eq('id', workerId)
        .single();

      if (workerErr || !worker) {
        return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
      }

      // Resolve service category IDs to names
      let categoryNames: string[] = [];
      const workerData = worker as any;
      if (workerData.service_category_ids && workerData.service_category_ids.length > 0) {
        const { data: categories } = await supabaseAdmin
          .from('service_categories')
          .select('name')
          .in('id', workerData.service_category_ids);
        if (categories) {
          categoryNames = categories.map((c: any) => c.name);
        }
      }

      // Fetch last 10 wallet transactions
      const { data: walletTxns } = await supabaseAdmin
        .from('wallet_transactions')
        .select('*')
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Fetch last 10 settlements
      const { data: settlements } = await supabaseAdmin
        .from('settlement_ledger')
        .select('*')
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Mask bank account number securely for display
      const maskBankAcc = (acc: string | null) => {
        if (!acc) return '';
        if (acc.length < 4) return '****';
        return `******${acc.slice(-4)}`;
      };

      return NextResponse.json({
        id: workerData.id,
        full_name: workerData.users?.full_name,
        phone: workerData.users?.phone,
        email: workerData.users?.email,
        status: workerData.status,
        kyc_status: workerData.kyc_status,
        aadhar_front_url: workerData.aadhar_front_url,
        aadhar_back_url: workerData.aadhar_back_url,
        pan_url: workerData.pan_url,
        selfie_url: workerData.selfie_url,
        bank_account_name: workerData.bank_account_name,
        bank_account_number: maskBankAcc(workerData.bank_account_number),
        bank_ifsc: workerData.bank_ifsc,
        razorpayx_contact_id: workerData.razorpayx_contact_id,
        razorpayx_fund_account_id: workerData.razorpayx_fund_account_id,
        commission_wallet_balance: (Array.isArray((workerData as any).worker_wallets) ? (workerData as any).worker_wallets[0]?.balance : (workerData as any).worker_wallets?.balance) || 0,
        rating: workerData.rating,
        total_jobs: workerData.total_jobs,
        created_at: workerData.created_at,
        is_active: workerData.users?.is_active,
        wallet_transactions: walletTxns || [],
        settlements: settlements || [],
        dob: workerData.dob,
        worker_id_code: workerData.worker_id_code,
        skills: workerData.worker_profiles?.skills || [],
        service_categories: categoryNames,
        service_category_ids: workerData.service_category_ids || []
      });
    }

    // D.2 workers/[id]/kyc-docs
    if (slug[0] === 'workers' && slug.length === 3 && slug[2] === 'kyc-docs') {
      const workerId = slug[1];

      // Fetch documents metadata
      const { data: docs, error: docsErr } = await supabaseAdmin
        .from('worker_documents')
        .select('*')
        .eq('worker_id', workerId);

      if (docsErr) {
        return NextResponse.json({ error: docsErr.message }, { status: 500 });
      }

      // Generate signed URLs for documents
      const docsWithUrls = await Promise.all((docs || []).map(async (doc: any) => {
        let bucket = 'kyc-docs';
        let path = '';

        if (doc.document_type === 'PROFILE_PHOTO') {
          bucket = 'profile-images';
          path = `worker_${workerId}/profile.webp`;
        } else {
          bucket = 'kyc-docs';
          const fileMap: Record<string, string> = {
            AADHAAR_FRONT: 'aadhaar-front.webp',
            AADHAAR_BACK: 'aadhaar-back.webp',
            PAN_CARD: 'pan.webp',
            SELFIE_VERIFICATION: 'selfie.webp'
          };
          path = `worker_${workerId}/${fileMap[doc.document_type]}`;
        }

        const { data, error } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(path, 900); // 15 mins expiry

        return {
          ...doc,
          signedUrl: data?.signedUrl || null
        };
      }));

      // Fetch overall kyc status review state
      const { data: kycState } = await supabaseAdmin
        .from('worker_kyc')
        .select('*')
        .eq('worker_id', workerId)
        .single();

      return NextResponse.json({
        success: true,
        documents: docsWithUrls,
        kycState: kycState || {
          worker_id: workerId,
          aadhaar_status: 'PENDING',
          pan_status: 'PENDING',
          selfie_status: 'PENDING',
          overall_status: 'PENDING',
          remarks: null,
          submitted_at: null
        }
      });
    }

    // E. customers
    if (slug[0] === 'customers' && slug.length === 1) {
      const { searchParams } = new URL(request.url);
      const page = Math.max(1, Number(searchParams.get('page') || 1));
      const limit = Math.max(1, Number(searchParams.get('limit') || 20));
      const search = searchParams.get('search') || '';

      const offset = (page - 1) * limit;

      let countQuery = supabaseAdmin
        .from('users')
        .select('id', { count: 'exact' })
        .eq('role', 'customer');

      let query = supabaseAdmin
        .from('users')
        .select('id, full_name, phone, email, is_active, created_at, bookings(id)')
        .eq('role', 'customer');

      if (search) {
        countQuery = countQuery.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
        query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      const [{ count }, { data: customers, error }] = await Promise.all([
        countQuery,
        query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
      ]);

      if (error) throw error;

      return NextResponse.json({
        customers: (customers || []).map((c: any) => ({
          id: c.id,
          full_name: c.full_name,
          phone: c.phone,
          email: c.email,
          is_active: c.is_active,
          created_at: c.created_at,
          total_bookings: c.bookings?.length || 0
        })),
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });
    }

    // F. customers/[id]
    if (slug[0] === 'customers' && slug.length === 2) {
      const customerId = slug[1];

      const { data: customer, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', customerId)
        .eq('role', 'customer')
        .single();

      if (error || !customer) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }

      // Fetch last 20 bookings
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('id, status, total_amount, created_at, service_items(name)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);

      const customerData = customer as any;

      return NextResponse.json({
        id: customerData.id,
        full_name: customerData.full_name,
        phone: customerData.phone,
        email: customerData.email,
        is_active: customerData.is_active,
        created_at: customerData.created_at,
        bookings: (bookings || []).map((b: any) => ({
          id: b.id,
          status: b.status,
          total_amount: b.total_amount,
          created_at: b.created_at,
          service_name: b.service_items?.name
        }))
      });
    }

    // G. bookings
    if (slug[0] === 'bookings' && slug.length === 1) {
      const { searchParams } = new URL(request.url);
      const page = Math.max(1, Number(searchParams.get('page') || 1));
      const limit = Math.max(1, Number(searchParams.get('limit') || 20));
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const paymentMode = searchParams.get('payment_mode') || '';
      const bookingType = searchParams.get('booking_type') || '';
      const dateFrom = searchParams.get('date_from') || '';
      const dateTo = searchParams.get('date_to') || '';

      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from('bookings')
        .select('id, status, payment_mode, booking_type, total_amount, created_at, scheduled_at, service_items(name), customer:users!bookings_customer_id_fkey(full_name, phone), worker:workers(users(full_name, phone))', { count: 'exact' });

      if (status) query = query.eq('status', status);
      if (paymentMode) query = query.eq('payment_mode', paymentMode);
      if (bookingType) query = query.eq('booking_type', bookingType);
      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo);

      if (search) {
        query = query.or(`full_name.ilike.%${search}%`, { foreignTable: 'users' });
      }

      const { data: bookings, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return NextResponse.json({
        bookings: (bookings || []).map((b: any) => ({
          id: b.id,
          status: b.status,
          payment_mode: b.payment_mode,
          booking_type: b.booking_type,
          total_amount: b.total_amount,
          created_at: b.created_at,
          scheduled_at: b.scheduled_at,
          service_name: b.service_items?.name,
          customer_name: b.customer?.full_name,
          customer_phone: b.customer?.phone,
          worker_name: b.worker?.users?.full_name,
          worker_phone: b.worker?.users?.phone
        })),
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });
    }

    // H. bookings/[id]
    if (slug[0] === 'bookings' && slug.length === 2) {
      const bookingId = slug[1];

      const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .select('*, service_items(*), customer:users!bookings_customer_id_fkey(*), worker:workers(id, users(*)), payments(*)')
        .eq('id', bookingId)
        .single();

      if (error || !booking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      const bookingData = booking as any;

      // Fetch completion images
      const { data: images } = await supabaseAdmin
        .from('booking_images')
        .select('image_url')
        .eq('booking_id', bookingId);

      const imageUrls = (images || []).map((img: any) => {
        if (img.image_url.startsWith('http')) return img.image_url;
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from('booking-images')
          .getPublicUrl(img.image_url);
        return publicUrl;
      });

      return NextResponse.json({
        id: bookingData.id,
        status: bookingData.status,
        booking_type: bookingData.booking_type,
        payment_mode: bookingData.payment_mode,
        address_line: bookingData.address_line,
        lat: bookingData.lat,
        lng: bookingData.lng,
        scheduled_at: bookingData.scheduled_at,
        started_at: bookingData.started_at,
        completed_at: bookingData.completed_at,
        total_amount: bookingData.total_amount,
        notes: bookingData.notes,
        otp: bookingData.otp,
        created_at: bookingData.created_at,
        service: bookingData.service_items,
        customer: bookingData.customer,
        worker: bookingData.worker ? {
          id: bookingData.worker.id,
          full_name: bookingData.worker.users?.full_name,
          phone: bookingData.worker.users?.phone,
        } : null,
        images: imageUrls,
        payment: bookingData.payments || []
      });
    }

    // I. services
    if (slug[0] === 'services' && slug.length === 1) {
      const { data: categories, error } = await supabaseAdmin
        .from('service_categories')
        .select('*, service_items(*)')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return NextResponse.json(categories || []);
    }

    // J. manual-assignment
    if (slug[0] === 'manual-assignment' && slug.length === 1) {
      const { searchParams } = new URL(request.url);
      const bookingId = searchParams.get('booking_id');

      // Fetch all unassigned jobs
      const { data: unassignedJobs } = await supabaseAdmin
        .from('bookings')
        .select('id, address_line, lat, lng, created_at, service_items(name), customer:users!bookings_customer_id_fkey(full_name)')
        .eq('status', 'PENDING_ASSIGNMENT')
        .order('created_at', { ascending: false });

      let availableWorkers: any[] = [];

      // If a booking is selected, search nearby workers via Haversine calculation
      if (bookingId) {
        const { data: targetJob } = await supabaseAdmin
          .from('bookings')
          .select('lat, lng')
          .eq('id', bookingId)
          .single();

        if (targetJob) {
          const supabaseAdminAny: any = supabaseAdmin;
          const { data: nearbyWorkers, error: rpcErr } = await supabaseAdminAny.rpc(
            'find_nearby_workers',
            {
              p_lat: targetJob.lat,
              p_lng: targetJob.lng,
              radius_km: 25.0 // search up to 25km for manual assignments
            }
          );

          if (!rpcErr && nearbyWorkers) {
            const workerIds = nearbyWorkers.map((w: any) => w.worker_id);
            if (workerIds.length > 0) {
               const { data: workerProfiles } = await supabaseAdmin
                .from('workers')
                .select('id, rating, total_jobs, users(full_name, phone), worker_profiles(skills, experience)')
                .in('id', workerIds);

              availableWorkers = (workerProfiles || []).map((w: any) => {
                const distanceObj = nearbyWorkers.find((nw: any) => nw.worker_id === w.id);
                return {
                  id: w.id,
                  name: w.users?.full_name,
                  phone: w.users?.phone,
                  rating: w.rating,
                  distance_km: distanceObj ? Number(distanceObj.distance_km.toFixed(2)) : null,
                  total_jobs: w.total_jobs || 0,
                  experience: w.worker_profiles?.experience || 0,
                  skills: w.worker_profiles?.skills || []
                };
              }).sort((a: any, b: any) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
            }
          }
        }
      } else {
        const { data: onlineWorkers } = await supabaseAdmin
          .from('workers')
          .select('id, rating, total_jobs, users(full_name, phone), worker_profiles(skills, experience)')
          .eq('status', 'ONLINE')
          .eq('kyc_status', 'APPROVED');

        availableWorkers = (onlineWorkers || []).map((w: any) => ({
          id: w.id,
          name: w.users?.full_name,
          phone: w.users?.phone,
          rating: w.rating,
          distance_km: null,
          total_jobs: w.total_jobs || 0,
          experience: w.worker_profiles?.experience || 0,
          skills: w.worker_profiles?.skills || []
        }));
      }

      return NextResponse.json({
        unassigned_jobs: (unassignedJobs || []).map((j: any) => ({
          id: j.id,
          customer_name: j.customer?.full_name,
          service_name: j.service_items?.name,
          address_line: j.address_line,
          lat: j.lat,
          lng: j.lng,
          created_at: j.created_at
        })),
        available_workers: availableWorkers
      });
    }

    // K. settlements
    if (slug[0] === 'settlements' && slug.length === 1) {
      const { searchParams } = new URL(request.url);
      const page = Math.max(1, Number(searchParams.get('page') || 1));
      const limit = Math.max(1, Number(searchParams.get('limit') || 20));
      const status = searchParams.get('status') || '';
      const dateFrom = searchParams.get('date_from') || '';
      const dateTo = searchParams.get('date_to') || '';

      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from('settlement_ledger')
        .select('*, worker:workers(users(full_name, phone))', { count: 'exact' });

      if (status) query = query.eq('status', status);
      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo);

      const { data: settlements, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return NextResponse.json({
        settlements: (settlements || []).map((s: any) => ({
          id: s.id,
          worker_id: s.worker_id,
          worker_name: s.worker?.users?.full_name,
          worker_phone: s.worker?.users?.phone,
          gross_amount: s.gross_amount,
          commission_amount: s.commission_amount,
          net_amount: s.net_amount,
          status: s.status,
          created_at: s.created_at
        })),
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });
    }

    // L. settlements/[worker_id]
    if (slug[0] === 'settlements' && slug.length === 2) {
      const workerId = slug[1];

      const { data: userProfile } = await supabaseAdmin
        .from('users')
        .select('full_name, phone')
        .eq('id', workerId)
        .single();

      const { data: ledger } = await supabaseAdmin
        .from('settlement_ledger')
        .select('*, payment:payments(booking_id, amount)')
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false });

      return NextResponse.json({
        worker_name: userProfile?.full_name || 'Worker',
        worker_phone: userProfile?.phone || '',
        history: ledger || []
      });
    }

    // M. reports/revenue
    if (slug[0] === 'reports' && slug[1] === 'revenue') {
      const { searchParams } = new URL(request.url);
      const dateFrom = searchParams.get('date_from') || '';
      const dateTo = searchParams.get('date_to') || '';

      let query = supabaseAdmin
        .from('payments')
        .select('amount, admin_commission, worker_share, paid_at')
        .eq('status', 'SUCCESS');

      if (dateFrom) query = query.gte('paid_at', dateFrom);
      if (dateTo) query = query.lte('paid_at', dateTo);

      const { data: payments, error } = await query;
      if (error) throw error;

      // Group payments by date simple parser
      const timeSeriesMap: Record<string, any> = {};
      let totalRev = 0;
      let totalComm = 0;
      let totalShare = 0;

      (payments || []).forEach((p: any) => {
        const dateStr = p.paid_at ? p.paid_at.split('T')[0] : 'N/A';
        const amt = Number(p.amount);
        const comm = Number(p.admin_commission || amt * 0.15);
        const share = Number(p.worker_share || amt * 0.85);

        totalRev += amt;
        totalComm += comm;
        totalShare += share;

        if (!timeSeriesMap[dateStr]) {
          timeSeriesMap[dateStr] = {
            period: dateStr,
            total_revenue: 0,
            admin_commission: 0,
            worker_share: 0,
            booking_count: 0
          };
        }

        timeSeriesMap[dateStr].total_revenue += amt;
        timeSeriesMap[dateStr].admin_commission += comm;
        timeSeriesMap[dateStr].worker_share += share;
        timeSeriesMap[dateStr].booking_count += 1;
      });

      const timeSeries = Object.values(timeSeriesMap).sort((a: any, b: any) => a.period.localeCompare(b.period));

      return NextResponse.json({
        time_series: timeSeries,
        summary: {
          total: totalRev,
          avg_per_booking: payments && payments.length > 0 ? Number((totalRev / payments.length).toFixed(2)) : 0,
          admin_share: totalComm,
          worker_share: totalShare
        }
      });
    }

    // N. reports/bookings
    if (slug[0] === 'reports' && slug[1] === 'bookings') {
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('status, payment_mode, booking_type');

      const byStatus: Record<string, number> = {};
      const byPayment: Record<string, number> = {};
      const byType: Record<string, number> = {};
      let cancelledCount = 0;

      (bookings || []).forEach((b: any) => {
        byStatus[b.status] = (byStatus[b.status] || 0) + 1;
        byPayment[b.payment_mode] = (byPayment[b.payment_mode] || 0) + 1;
        byType[b.booking_type] = (byType[b.booking_type] || 0) + 1;
        if (b.status === 'CANCELLED') {
          cancelledCount += 1;
        }
      });

      const total = bookings?.length || 0;

      return NextResponse.json({
        by_status: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
        by_payment: Object.entries(byPayment).map(([name, value]) => ({ name, value })),
        by_type: Object.entries(byType).map(([name, value]) => ({ name, value })),
        cancellation_rate: total > 0 ? Number(((cancelledCount / total) * 100).toFixed(2)) : 0
      });
    }

    // O. reports/workers
    if (slug[0] === 'reports' && slug[1] === 'workers') {
      const { data: topWorkers } = await supabaseAdmin
        .from('workers')
        .select('id, rating, total_jobs, users(full_name)')
        .order('total_jobs', { ascending: false })
        .limit(10);

      const { data: bestRated } = await supabaseAdmin
        .from('workers')
        .select('id, rating, total_jobs, users(full_name)')
        .order('rating', { ascending: false })
        .limit(10);

      const [
        { count: pendingCount },
        { count: approvedCount },
        { count: rejectedCount }
      ] = await Promise.all([
        supabaseAdmin.from('workers').select('id', { count: 'exact', head: true }).eq('kyc_status', 'PENDING'),
        supabaseAdmin.from('workers').select('id', { count: 'exact', head: true }).eq('kyc_status', 'APPROVED'),
        supabaseAdmin.from('workers').select('id', { count: 'exact', head: true }).eq('kyc_status', 'REJECTED')
      ]);

      return NextResponse.json({
        top_by_jobs: (topWorkers || []).map((w: any) => ({
          name: w.users?.full_name,
          jobs: w.total_jobs,
          rating: w.rating
        })),
        top_by_rating: (bestRated || []).map((w: any) => ({
          name: w.users?.full_name,
          jobs: w.total_jobs,
          rating: w.rating
        })),
        kyc_funnel: {
          pending: pendingCount || 0,
          approved: approvedCount || 0,
          rejected: rejectedCount || 0
        }
      });
    }

    // P. reports/services
    if (slug[0] === 'reports' && slug[1] === 'services') {
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('service_item_id, total_amount, service_items(name)');

      const serviceStatsMap: Record<string, any> = {};

      (bookings || []).forEach((b: any) => {
        const serviceId = b.service_item_id;
        const name = b.service_items?.name || 'Unknown Service';
        const amt = Number(b.total_amount);

        if (!serviceStatsMap[serviceId]) {
          serviceStatsMap[serviceId] = {
            id: serviceId,
            name,
            bookings_count: 0,
            revenue: 0
          };
        }

        serviceStatsMap[serviceId].bookings_count += 1;
        serviceStatsMap[serviceId].revenue += amt;
      });

      return NextResponse.json(Object.values(serviceStatsMap).sort((a: any, b: any) => b.bookings_count - a.bookings_count));
    }

    // Q. settings
    if (slug[0] === 'settings' && slug.length === 1) {
      const { data: settings, error } = await supabaseAdmin
        .from('platform_settings')
        .select('*');

      if (error) throw error;

      const settingsMap: Record<string, string> = {};
      (settings || []).forEach((s: any) => {
        settingsMap[s.key] = s.value;
      });

      return NextResponse.json(settingsMap);
    }

    // R. audit-logs
    if (slug[0] === 'audit-logs' && slug.length === 1) {
      const { searchParams } = new URL(request.url);
      const page = Math.max(1, Number(searchParams.get('page') || 1));
      const limit = Math.max(1, Number(searchParams.get('limit') || 20));
      const action = searchParams.get('action') || '';
      const dateFrom = searchParams.get('date_from') || '';
      const dateTo = searchParams.get('date_to') || '';

      const offset = (page - 1) * limit;

      let query = supabaseAdmin
        .from('audit_logs')
        .select('*, admin:users(full_name)', { count: 'exact' });

      if (action) query = query.eq('action', action);
      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo);

      const { data: logs, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return NextResponse.json({
        logs: (logs || []).map((l: any) => ({
          id: l.id,
          timestamp: l.created_at,
          admin_name: l.admin?.full_name || 'System',
          action: l.action,
          target_type: l.target_type,
          target_id: l.target_id,
          metadata: l.metadata
        })),
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });
    }

    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Admin GET route error:', error);
    const status = error.status || 500;
    const msg = error.message || 'Internal server error';
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST Route handlers
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const session = await requireRole(request, 'admin');
    const { slug } = await params;

    // A.2 services/categories
    if (slug[0] === 'services' && slug[1] === 'categories' && slug.length === 2) {
      const { data: { name, icon_url, sort_order }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!name) {
        return NextResponse.json({ error: 'Missing category name' }, { status: 400 });
      }

      const { data: newCategory, error } = await supabaseAdmin
        .from('service_categories')
        .insert({
          name,
          icon_url: icon_url || null,
          sort_order: sort_order || 0,
          is_active: true
        })
        .select('*')
        .single();

      if (error || !newCategory) throw error;

      memoryCache.delete('customer_services_default');

      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SERVICE_CREATED,
        target_type: 'service_category',
        target_id: newCategory.id,
        metadata: { category_name: name }
      });

      return NextResponse.json(newCategory);
    }

    // A.3 services/categories/[id]
    if (slug[0] === 'services' && slug[1] === 'categories' && slug.length === 3) {
      const categoryId = slug[2];
      const { data: updateFields, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      const { data: updatedCategory, error } = await supabaseAdmin
        .from('service_categories')
        .update(updateFields)
        .eq('id', categoryId)
        .select('*')
        .single();

      if (error || !updatedCategory) throw error;

      memoryCache.delete('customer_services_default');

      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SERVICE_UPDATED,
        target_type: 'service_category',
        target_id: categoryId,
        metadata: { updated_fields: Object.keys(updateFields) }
      });

      return NextResponse.json({ success: true, category: updatedCategory });
    }

    // A. services

    if (slug[0] === 'services' && slug.length === 1) {
      const { data: { category_id, name, description, base_price, estimated_mins }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!category_id || !name || !base_price) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }

      const { data: newService, error } = await supabaseAdmin
        .from('service_items')
        .insert({
          category_id,
          name,
          description,
          base_price,
          estimated_mins: estimated_mins || 60,
          is_active: true
        })
        .select('*')
        .single();

      if (error || !newService) throw error;

      memoryCache.delete('customer_services_default');

      // Log audit action
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SERVICE_CREATED,
        target_type: 'service',
        target_id: newService.id,
        metadata: { service_name: name, base_price }
      });

      return NextResponse.json({ success: true, service: newService });
    }

    // B. manual-assignment
    if (slug[0] === 'manual-assignment' && slug.length === 1) {
      const { data: { booking_id, worker_id }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!booking_id || !worker_id) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }

      // Execute row-locked Postgres Transaction RPC
      const supabaseAdminAny: any = supabaseAdmin;
      const { data: assignResult, error: assignErr } = await supabaseAdminAny.rpc(
        'manual_assign_worker',
        {
          p_booking_id: booking_id,
          p_worker_id: worker_id,
          p_admin_id: session.user_id
        }
      );

      if (assignErr || !assignResult) {
        const errorMsg = assignErr?.message || '';
        if (errorMsg.includes('BOOKING_NOT_PEND')) {
          return NextResponse.json({ error: 'Booking is no longer pending assignment' }, { status: 409 });
        }
        if (errorMsg.includes('WORKER_NOT_AVAIL')) {
          return NextResponse.json({ error: 'Worker is no longer online or approved' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Assignment failed' }, { status: 500 });
      }

      // Send Firebase Cloud Notification payloads
      const customerId = (await supabaseAdmin.from('bookings').select('customer_id').eq('id', booking_id).single()).data?.customer_id;
      
      await Promise.all([
        dispatchNotification({
          userId: worker_id,
          type: 'BOOKING_REQUEST',
          title: 'New Manual Assignment',
          body: 'You have been manually assigned a new booking by the administrator.'
        }),
        dispatchNotification({
          userId: customerId,
          type: 'BOOKING_ACCEPTED',
          title: 'Worker Dispatched',
          body: 'A worker has been manually assigned to your service request.'
        })
      ]);

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.MANUAL_ASSIGNMENT,
        target_type: 'booking',
        target_id: booking_id,
        metadata: { worker_id, assigned_by: session.user_id }
      });

      return NextResponse.json({ success: true, message: 'Worker manually assigned successfully' });
    }

    // C. manual-assignment/reassign
    if (slug[0] === 'manual-assignment' && slug[1] === 'reassign') {
      const { data: { booking_id, new_worker_id }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!booking_id || !new_worker_id) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }

      const { data: currentBooking } = await supabaseAdmin
        .from('bookings')
        .select('worker_id, customer_id')
        .eq('id', booking_id)
        .single();

      const old_worker_id = currentBooking?.worker_id;

      // Execute row-locked Postgres Transaction RPC
      const supabaseAdminAny: any = supabaseAdmin;
      const { data: reassignResult, error: reassignErr } = await supabaseAdminAny.rpc(
        'manual_reassign_worker',
        {
          p_booking_id: booking_id,
          p_new_worker_id: new_worker_id,
          p_admin_id: session.user_id
        }
      );

      if (reassignErr || !reassignResult) {
        return NextResponse.json({ error: 'Reassignment failed' }, { status: 500 });
      }

      // Send notifications
      const notifyPromises = [
        dispatchNotification({
          userId: new_worker_id,
          type: 'BOOKING_REQUEST',
          title: 'New Job Assigned',
          body: 'You have been reassigned a manual booking request.'
        }),
        dispatchNotification({
          userId: currentBooking?.customer_id,
          type: 'BOOKING_ACCEPTED',
          title: 'Worker Reassigned',
          body: 'A new worker has been assigned to your booking request.'
        })
      ];

      if (old_worker_id) {
        notifyPromises.push(
          dispatchNotification({
            userId: old_worker_id,
            type: 'BOOKING_REJECTED',
            title: 'Job Unassigned',
            body: 'You have been unassigned from the booking.'
          })
        );
      }

      await Promise.all(notifyPromises);

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.MANUAL_REASSIGNMENT,
        target_type: 'booking',
        target_id: booking_id,
        metadata: { old_worker_id, new_worker_id, reassigned_by: session.user_id }
      });

      return NextResponse.json({ success: true, message: 'Worker reassigned successfully' });
    }

    // D. workers/kyc or workers/[id]/kyc
    if (slug[0] === 'workers' && (slug[1] === 'kyc' || (slug.length === 3 && slug[2] === 'kyc'))) {
      const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
      const workerId = slug.length === 3 ? slug[1] : body.workerId;
      const { action, reason, fieldApproval } = body;

      if (!workerId || !action) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }

      if (!['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION'].includes(action)) {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }

      const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      const { data: updatedWorker, error } = await supabaseAdmin
        .from('workers')
        .update({ kyc_status: status })
        .eq('id', workerId)
        .select('*')
        .single();

      if (error) throw error;

      if (action === 'APPROVE') {
        const { createWallet } = await import('@/lib/wallet-engine');
        await createWallet(workerId);
      }

      // Update overall kyc checklist and remarks in worker_kyc table
      await supabaseAdmin
        .from('worker_kyc')
        .update({
          overall_status: status,
          remarks: reason || null,
          reviewed_by: session.user_id,
          reviewed_at: new Date().toISOString()
        })
        .eq('worker_id', workerId);

      // Update specific checklists if fieldApproval is provided
      if (fieldApproval) {
        await supabaseAdmin
          .from('worker_kyc')
          .update({
            aadhaar_status: fieldApproval.aadhaar || status,
            pan_status: fieldApproval.pan || status,
            selfie_status: fieldApproval.selfie || status
          })
          .eq('worker_id', workerId);

        // Update individual document statuses in worker_documents
        const docTypes = {
          aadhaar: ['AADHAAR_FRONT', 'AADHAAR_BACK'],
          pan: ['PAN_CARD'],
          selfie: ['SELFIE_VERIFICATION']
        };

        for (const [field, types] of Object.entries(docTypes)) {
          const fieldStatus = fieldApproval[field as keyof typeof docTypes];
          if (fieldStatus) {
            await supabaseAdmin
              .from('worker_documents')
              .update({ status: fieldStatus })
              .eq('worker_id', workerId)
              .in('document_type', types);
          }
        }
      }

      // Dispatch alert notification
      await dispatchNotification({
        userId: workerId,
        type: action === 'APPROVE' ? 'KYC_APPROVED' : 'KYC_REJECTED',
        title: action === 'APPROVE' ? 'KYC Approved' : 'KYC Status Update',
        body: action === 'APPROVE'
          ? 'Congratulations! Your profile KYC registration is approved.'
          : `KYC Review Update. Remarks: ${reason || 'Document verification updated.'}`
      });

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: action === 'APPROVE' ? AuditAction.WORKER_KYC_APPROVED : AuditAction.WORKER_KYC_REJECTED,
        target_type: 'worker',
        target_id: workerId,
        metadata: { action, reason }
      });

      return NextResponse.json({ success: true, worker: updatedWorker });
    }

    // D.2 workers/[id]/status
    if (slug[0] === 'workers' && slug.length === 3 && slug[2] === 'status') {
      const workerId = slug[1];
      const { data: { action }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!action || !['ACTIVATE', 'SUSPEND'].includes(action)) {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }

      const isActive = action === 'ACTIVATE';

      const { data: updatedUser, error } = await supabaseAdmin
        .from('users')
        .update({ is_active: isActive })
        .eq('id', workerId)
        .select('*')
        .single();

      if (error) throw error;

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: isActive ? AuditAction.WORKER_ACTIVATED : AuditAction.WORKER_SUSPENDED,
        target_type: 'worker',
        target_id: workerId,
        metadata: { action }
      });

      return NextResponse.json({ success: true, user: updatedUser });
    }

    // D.3 workers/[id]/categories
    if (slug[0] === 'workers' && slug.length === 3 && slug[2] === 'categories') {
      const workerId = slug[1];
      const { data: { categoryIds }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!Array.isArray(categoryIds)) {
        return NextResponse.json({ error: 'categoryIds must be an array' }, { status: 400 });
      }

      const { data: updatedWorker, error } = await supabaseAdmin
        .from('workers')
        .update({ service_category_ids: categoryIds, updated_at: new Date().toISOString() })
        .eq('id', workerId)
        .select('*')
        .single();

      if (error) throw error;

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SETTINGS_UPDATED,
        target_type: 'worker',
        target_id: workerId,
        metadata: { service_category_ids: categoryIds }
      });

      return NextResponse.json({ success: true, worker: updatedWorker });
    }

    // E. bookings/[id]/cancel
    if (slug[0] === 'bookings' && slug.length === 3 && slug[2] === 'cancel') {
      const bookingId = slug[1];
      const { data: { reason }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      if (!bookingId) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }

      const { data: booking, error: fetchErr } = await supabaseAdmin
        .from('bookings')
        .select('worker_id, customer_id')
        .eq('id', bookingId)
        .single();

      if (fetchErr) throw fetchErr;

      const { error: cancelErr } = await supabaseAdmin
        .from('bookings')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', bookingId);

      if (cancelErr) throw cancelErr;

      // Revert worker status to ONLINE if they were matched
      if (booking?.worker_id) {
        await supabaseAdmin
          .from('workers')
          .update({ status: 'ONLINE' })
          .eq('id', booking.worker_id);

        await dispatchNotification({
          userId: booking.worker_id,
          type: 'BOOKING_REJECTED',
          title: 'Booking Cancelled',
          body: `Job booking ${bookingId} was cancelled by administrator.`
        });
      }

      await dispatchNotification({
        userId: booking?.customer_id,
        type: 'BOOKING_REJECTED',
        title: 'Booking Cancelled',
        body: `Your booking request was cancelled by the administrator. Reason: ${reason}`
      });

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.BOOKING_CANCELLED,
        target_type: 'booking',
        target_id: bookingId,
        metadata: { reason }
      });

      return NextResponse.json({ success: true, status: 'CANCELLED' });
    }

    // E. services/[id]
    if (slug[0] === 'services' && slug.length === 2) {
      const serviceId = slug[1];
      const { data: updateFields, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      const { data: updatedService, error } = await supabaseAdmin
        .from('service_items')
        .update(updateFields)
        .eq('id', serviceId)
        .select('*')
        .single();

      if (error) throw error;

      memoryCache.delete('customer_services_default');

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SERVICE_UPDATED,
        target_type: 'service',
        target_id: serviceId,
        metadata: { updated_fields: Object.keys(updateFields) }
      });

      return NextResponse.json({ success: true, service: updatedService });
    }

    // F. settings
    if (slug[0] === 'settings' && slug.length === 1) {
      const { data: settingsPayload, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

      // Get old settings values first for audit logs comparison
      const { data: oldSettings } = await supabaseAdmin.from('platform_settings').select('*');
      const oldMap: Record<string, string> = {};
      (oldSettings || []).forEach((s: any) => {
        oldMap[s.key] = s.value;
      });

      // Write transaction-style updates in loops
      const promises = Object.entries(settingsPayload).map(([key, val]) => {
        return supabaseAdmin
          .from('platform_settings')
          .update({ value: String(val), updated_by: session.user_id, updated_at: new Date().toISOString() })
          .eq('key', key);
      });

      await Promise.all(promises);

      // Write Audit Log
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SETTINGS_UPDATED,
        metadata: {
          changed_keys: Object.keys(settingsPayload),
          old_values: oldMap,
          new_values: settingsPayload
        }
      });

      return NextResponse.json({ success: true, settings: settingsPayload });
    }

    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Admin PATCH route error:', error);
    const status = error.status || 500;
    const msg = error.message || 'Internal server error';
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string[] }> }
) {
  return POST(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ slug: string[] }> }
) {
  return POST(request, context);
}

// DELETE Route handlers
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const session = await requireRole(request, 'admin');
    const { slug } = await params;

    // A. services/[id] (Try Hard Delete first, Fallback to Soft Delete if used in bookings)
    if (slug[0] === 'services' && slug.length === 2) {
      const serviceId = slug[1];

      // Try hard delete first
      const { error: deleteErr } = await supabaseAdmin
        .from('service_items')
        .delete()
        .eq('id', serviceId);

      if (deleteErr) {
        if (deleteErr.code === '23503') {
          // Fallback to soft-deactivating if referenced by bookings
          const { data: service, error: updateErr } = await supabaseAdmin
            .from('service_items')
            .update({ is_active: false })
            .eq('id', serviceId)
            .select('name')
            .single();

          if (updateErr) throw updateErr;

          memoryCache.delete('customer_services_default');

          // Write Audit Log
          await logAuditAction({
            admin_id: session.user_id,
            action: AuditAction.SERVICE_DELETED,
            target_type: 'service',
            target_id: serviceId,
            metadata: { service_name: service?.name, type: 'soft_delete_due_to_bookings' }
          });

          return NextResponse.json({ 
            success: true, 
            message: 'Service is referenced by bookings. It was deactivated/soft-deleted instead.' 
          });
        }
        throw deleteErr;
      }

      memoryCache.delete('customer_services_default');

      // Write Audit Log for hard delete
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SERVICE_DELETED,
        target_type: 'service',
        target_id: serviceId,
        metadata: { type: 'hard_delete' }
      });

      return NextResponse.json({ success: true, message: 'Service deleted permanently' });
    }

    // B. services/categories/[id]
    if (slug[0] === 'services' && slug[1] === 'categories' && slug.length === 3) {
      const categoryId = slug[2];

      // Try hard delete first
      const { error: deleteErr } = await supabaseAdmin
        .from('service_categories')
        .delete()
        .eq('id', categoryId);

      if (deleteErr) {
        if (deleteErr.code === '23503') {
          // Fallback to soft-deactivating if referenced by items/bookings
          const { data: category, error: updateErr } = await supabaseAdmin
            .from('service_categories')
            .update({ is_active: false })
            .eq('id', categoryId)
            .select('name')
            .single();

          if (updateErr) throw updateErr;

          memoryCache.delete('customer_services_default');

          // Write Audit Log
          await logAuditAction({
            admin_id: session.user_id,
            action: AuditAction.SERVICE_DELETED,
            target_type: 'service_category',
            target_id: categoryId,
            metadata: { category_name: category?.name, type: 'soft_delete_due_to_items_or_bookings' }
          });

          return NextResponse.json({ 
            success: true, 
            message: 'Category is referenced by service items or bookings. It was deactivated/soft-deleted instead.' 
          });
        }
        throw deleteErr;
      }

      memoryCache.delete('customer_services_default');

      // Write Audit Log for hard delete
      await logAuditAction({
        admin_id: session.user_id,
        action: AuditAction.SERVICE_DELETED,
        target_type: 'service_category',
        target_id: categoryId,
        metadata: { type: 'hard_delete' }
      });

      return NextResponse.json({ success: true, message: 'Category deleted permanently' });
    }

    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Admin DELETE route error:', error);
    const status = error.status || 500;
    const msg = error.message || 'Internal server error';
    return NextResponse.json({ error: msg }, { status });
  }
}
