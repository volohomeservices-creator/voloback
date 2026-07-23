import 'server-only';
import { supabaseAdmin } from './supabase-server';

export interface RateLimitResult {
  limited: boolean;
  blockedUntil: Date | null;
  remaining: number;
}

interface RateLimitEntry {
  requestCount: number;
  windowStart: number;
  blockedUntil: number | null;
}

// In-memory rate limiting map as fallback
const memoryRateLimit = new Map<string, RateLimitEntry>();
const GC_THRESHOLD = 10000;

function performGarbageCollection() {
  const now = Date.now();
  for (const [key, entry] of memoryRateLimit.entries()) {
    const isBlocked = entry.blockedUntil && entry.blockedUntil > now;
    if (!isBlocked && (now - entry.windowStart > 3600 * 1000)) {
      memoryRateLimit.delete(key);
    }
  }
}

/**
 * Checks if a specific identifier (IP address, phone number, etc.) is rate limited.
 * Uses a robust Supabase RPC function for serverless environments.
 * Falls back to local memory if the DB query fails.
 */
export async function isRateLimited(
  identifier: string,
  limitType: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `${limitType}:${identifier}`;
  
  try {
    // Try Supabase RPC first
    const { data, error } = await supabaseAdmin.rpc('increment_rate_limit', {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds
    });

    if (!error && data) {
      return {
        limited: data.limited,
        blockedUntil: data.blockedUntil ? new Date(data.blockedUntil) : null,
        remaining: data.remaining
      };
    }
    
    // Log error but proceed to fallback
    if (error) {
      console.warn('[Rate Limit] DB RPC failed, falling back to memory:', error.message);
    }
  } catch (err) {
    console.warn('[Rate Limit] DB RPC exception, falling back to memory');
  }

  // Graceful fallback to memory Map
  try {
    if (memoryRateLimit.size > GC_THRESHOLD) {
      performGarbageCollection();
    }

    const now = Date.now();
    const entry = memoryRateLimit.get(key);

    if (!entry) {
      memoryRateLimit.set(key, {
        requestCount: 1,
        windowStart: now,
        blockedUntil: null
      });

      return {
        limited: false,
        blockedUntil: null,
        remaining: maxRequests - 1
      };
    }

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return {
        limited: true,
        blockedUntil: new Date(entry.blockedUntil),
        remaining: 0
      };
    }

    const elapsedSeconds = (now - entry.windowStart) / 1000;

    if (elapsedSeconds > windowSeconds) {
      entry.requestCount = 1;
      entry.windowStart = now;
      entry.blockedUntil = null;

      return {
        limited: false,
        blockedUntil: null,
        remaining: maxRequests - 1
      };
    }

    entry.requestCount += 1;

    if (entry.requestCount > maxRequests) {
      const blockUntil = now + windowSeconds * 1000;
      entry.blockedUntil = blockUntil;

      return {
        limited: true,
        blockedUntil: new Date(blockUntil),
        remaining: 0
      };
    }

    return {
      limited: false,
      blockedUntil: null,
      remaining: maxRequests - entry.requestCount
    };

  } catch (err) {
    console.error('[Rate Limit] Unhandled rate limit error:', err);
    return { limited: false, blockedUntil: null, remaining: 1 };
  }
}
