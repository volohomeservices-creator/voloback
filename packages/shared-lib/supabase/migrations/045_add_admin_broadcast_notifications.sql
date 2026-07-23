-- Migration 045: Add ADMIN_BROADCAST and ADMIN_BROADCAST_LOG to notification_type enum
 
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN_BROADCAST' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'ADMIN_BROADCAST';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN_BROADCAST_LOG' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'ADMIN_BROADCAST_LOG';
    END IF;
END
$$;
