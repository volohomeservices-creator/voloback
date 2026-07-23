import 'server-only';
import { trackEvent } from './monitor';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL',
}

class StructuredLogger {
  private level: LogLevel = LogLevel.INFO;

  constructor() {
    if (process.env.NODE_ENV === 'development') {
      this.level = LogLevel.DEBUG;
    }
  }

  private shouldLog(current: LogLevel): boolean {
    const priority = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
      [LogLevel.FATAL]: 4,
    };
    return priority[current] >= priority[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta: meta || null,
      env: process.env.NODE_ENV || 'production',
    };
    return JSON.stringify(payload);
  }

  debug(message: string, meta?: any) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, meta));
    }
  }

  info(message: string, meta?: any) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage(LogLevel.INFO, message, meta));
    }
  }

  warn(message: string, meta?: any) {
    if (this.shouldLog(LogLevel.WARN)) {
      const payload = this.formatMessage(LogLevel.WARN, message, meta);
      console.warn(payload);
      // Route warning to persistent monitor logs
      trackEvent({
        event_type: 'operational_warning',
        severity: 'medium',
        details: { message, ...meta }
      }).catch(() => {});
      // Optional Log drain hook (e.g. Datadog Logs API or Axiom)
      if (process.env.LOG_DRAIN_URL) {
        fetch(process.env.LOG_DRAIN_URL, {
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
      }
    }
  }

  error(message: string, error?: any, meta?: any) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorMeta = error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...meta
      } : { error, ...meta };
      const payload = this.formatMessage(LogLevel.ERROR, message, errorMeta);
      console.error(payload);
      // Route error to persistent monitor logs
      trackEvent({
        event_type: 'operational_error',
        severity: 'high',
        details: { message, error: errorMeta }
      }).catch(() => {});
      // Optional Log drain hook
      if (process.env.LOG_DRAIN_URL) {
        fetch(process.env.LOG_DRAIN_URL, {
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
      }
    }
  }

  fatal(message: string, error?: any, meta?: any) {
    if (this.shouldLog(LogLevel.FATAL)) {
      const errorMeta = error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...meta
      } : { error, ...meta };
      console.error(this.formatMessage(LogLevel.FATAL, message, errorMeta));
      // Route fatal to persistent monitor logs
      trackEvent({
        event_type: 'operational_fatal',
        severity: 'critical',
        details: { message, error: errorMeta }
      }).catch(() => {});
    }
  }
}

export const logger = new StructuredLogger();

// Bind global process exception and rejection handlers
if (typeof process !== 'undefined') {
  process.on('uncaughtException', (err) => {
    logger.fatal('CRITICAL: Uncaught Exception detected in Node process', err);
    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => process.exit(1), 500);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('CRITICAL: Unhandled Rejection detected in Node process', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined
    });
  });
}
