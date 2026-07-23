import { adminMessaging } from './firebase-admin';
import type { MulticastMessage } from 'firebase-admin/messaging';
import { supabaseAdmin } from './supabase-server';
import { logAuditAction } from './audit';
import { AuditAction } from '@/types';


// Send push notification payload interface

export interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface BulkPushNotificationPayload {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushNotification({ userId, title, body, data }: PushNotificationPayload) {
  try {
    // 1. Fetch active device tokens for the user
    const { data: devices, error } = await supabaseAdmin
      .from('user_devices')
      .select('id, device_token')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    if (!devices || devices.length === 0) {
      return { success: false, reason: 'NO_ACTIVE_DEVICES' };
    }

    const tokens = devices.map(d => d.device_token);

    // 2. Prepare message
    const message: MulticastMessage = {
      notification: {
        title,
        body,
      },
      data: data || {},
      tokens,
    };

    // 3. Send via Firebase Admin Messaging
    const response = await adminMessaging.sendEachForMulticast(message);

    // 4. Handle failures and invalid tokens
    const failedTokens: string[] = [];
    response.responses.forEach((res: any, idx: number) => {
      if (!res.success) {
        const errorMsg = res.error?.message;
        if (
          res.error?.code === 'messaging/invalid-registration-token' ||
          res.error?.code === 'messaging/registration-token-not-registered'
        ) {
          failedTokens.push(tokens[idx]);
        }
      }
    });

    if (failedTokens.length > 0) {
      await supabaseAdmin
        .from('user_devices')
        .update({ is_active: false })
        .in('device_token', failedTokens)
        .eq('user_id', userId);
    }

    // Audit Log for the send
    if (response.successCount > 0) {
      await logAuditAction({
        admin_id: userId, // Assuming user context here or system context
        action: AuditAction.PUSH_NOTIFICATION_SENT,
        target_type: 'user',
        target_id: userId,
        metadata: { title, successCount: response.successCount }
      });
    }

    return { success: true, successCount: response.successCount, failureCount: response.failureCount };

  } catch (err: any) {
    console.error('Push notification failed:', err);
    await logAuditAction({
      admin_id: userId,
      action: AuditAction.PUSH_NOTIFICATION_FAILED,
      target_type: 'user',
      target_id: userId,
      metadata: { title, error: err.message }
    });
    return { success: false, error: err.message };
  }
}

export async function sendBulkNotifications({ userIds, title, body, data }: BulkPushNotificationPayload) {
  try {
    if (userIds.length === 0) return { success: true, successCount: 0 };

    // Grouping by users to ensure we properly handle invalid tokens per user
    const { data: devices, error } = await supabaseAdmin
      .from('user_devices')
      .select('id, user_id, device_token')
      .in('user_id', userIds)
      .eq('is_active', true);

    if (error || !devices || devices.length === 0) {
      return { success: false, reason: 'NO_ACTIVE_DEVICES' };
    }

    const tokens = devices.map(d => d.device_token);

    const message: MulticastMessage = {
      notification: { title, body },
      data: data || {},
      tokens,
    };

    const response = await adminMessaging.sendEachForMulticast(message);

    const invalidDeviceIds: string[] = [];
    response.responses.forEach((res: any, idx: number) => {
      if (!res.success) {
        if (
          res.error?.code === 'messaging/invalid-registration-token' ||
          res.error?.code === 'messaging/registration-token-not-registered'
        ) {
          invalidDeviceIds.push(devices[idx].id);
        }
      }
    });

    if (invalidDeviceIds.length > 0) {
      await supabaseAdmin
        .from('user_devices')
        .update({ is_active: false })
        .in('id', invalidDeviceIds);
    }

    return { success: true, successCount: response.successCount, failureCount: response.failureCount };

  } catch (err: any) {
    console.error('Bulk push notification failed:', err);
    return { success: false, error: err.message };
  }
}
