import { NextResponse } from 'next/server';

function checkAuth(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || cronSecret.includes('placeholder')) {
    console.error('CRON_SECRET is not configured or contains placeholders');
    return { success: false, status: 500, error: 'Server misconfiguration' };
  }

  if (!authHeader) {
    return { success: false, status: 401, error: 'Missing authorization header' };
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  if (token !== cronSecret) {
    return { success: false, status: 403, error: 'Forbidden' };
  }

  return { success: true };
}

export async function POST(request: Request) {
  const auth = checkAuth(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    return NextResponse.json({ success: true, message: 'Settlements job processed' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process settlements' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const auth = checkAuth(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  return NextResponse.json({ status: 'Settlements cron endpoint active' });
}
