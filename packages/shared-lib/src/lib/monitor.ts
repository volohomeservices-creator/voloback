import 'server-only';
import { supabaseAdmin } from './supabase-server';

export interface LogEvent {
  event_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, any>;
  user_id?: string | null;
}

export async function trackEvent(event: LogEvent) {
  try {
    // Write to security_events table for persistent auditing
    await supabaseAdmin.from('security_events').insert({
      user_id: event.user_id || null,
      event_type: event.event_type,
      severity: event.severity,
      details: {
        ...event.details,
        timestamp: new Date().toISOString(),
        memory_usage: process.memoryUsage(),
        uptime: process.uptime()
      }
    });
  } catch (err) {
    console.error('[Monitor Engine] Failed to record event:', err);
  }
}

// Global exception tracking hooks
export function registerCrashReporting() {
  if (typeof process !== 'undefined') {
    if ((process as any)._crashReportingRegistered) return;
    (process as any)._crashReportingRegistered = true;

    process.on('uncaughtException', async (error) => {
      console.error('[Crash Reporter] Uncaught Exception:', error);
      await trackEvent({
        event_type: 'app_crash',
        severity: 'critical',
        details: {
          error_name: error.name,
          error_message: error.message,
          stack: error.stack
        }
      });
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('[Crash Reporter] Unhandled Rejection:', reason);
      await trackEvent({
        event_type: 'unhandled_rejection',
        severity: 'high',
        details: {
          reason: reason instanceof Error ? reason.message : String(reason),
          stack: reason instanceof Error ? reason.stack : undefined
        }
      });
    });
  }
}
