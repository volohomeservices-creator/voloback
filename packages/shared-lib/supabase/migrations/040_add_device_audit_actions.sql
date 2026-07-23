-- Migration 040: Add Device and Push Notification Audit Actions
-- Add new audit actions to audit_action enum if they do not exist

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DEVICE_REGISTERED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'DEVICE_REGISTERED';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DEVICE_REMOVED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'DEVICE_REMOVED';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PUSH_NOTIFICATION_SENT' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'PUSH_NOTIFICATION_SENT';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PUSH_NOTIFICATION_FAILED' AND enumtypid = 'audit_action'::regtype) THEN
        ALTER TYPE audit_action ADD VALUE 'PUSH_NOTIFICATION_FAILED';
    END IF;
END
$$;
