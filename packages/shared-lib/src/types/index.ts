import * as shared from '@volo/shared-types';

export type UserRole = shared.UserRole;

export {
  WorkerStatus,
  KycStatus,
  BookingType,
  PaymentMode,
  BookingStatus,
  PaymentStatus,
  SettlementStatus,
  WalletTxnType,
  NotificationType,
} from '@volo/shared-types';

export type {
  ServiceCategory,
  ServiceItem,
  Booking,
  Payment,
  SettlementLedger,
  CommissionWalletTransaction,
  WorkerLocationLog,
  Notification,
  Review,
  WorkerWallet,
  WalletTransaction,
  SettlementBatch,
  WorkerBankAccount,
} from '@volo/shared-types';

// 1. Users Table Interface
export interface User extends Omit<shared.User, 'created_at' | 'updated_at'> {
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

// 2. Workers Table Interface
export interface Worker extends Omit<shared.Worker, 'created_at' | 'updated_at'> {
  razorpayx_contact_id: string | null;
  razorpayx_fund_account_id: string | null;
  created_at: string;
  updated_at: string;
}

// Audit Action Enum
export enum AuditAction {
  ADMIN_LOGIN = 'ADMIN_LOGIN',
  WORKER_KYC_APPROVED = 'WORKER_KYC_APPROVED',
  WORKER_KYC_REJECTED = 'WORKER_KYC_REJECTED',
  WORKER_SUSPENDED = 'WORKER_SUSPENDED',
  WORKER_ACTIVATED = 'WORKER_ACTIVATED',
  MANUAL_ASSIGNMENT = 'MANUAL_ASSIGNMENT',
  MANUAL_REASSIGNMENT = 'MANUAL_REASSIGNMENT',
  SERVICE_CREATED = 'SERVICE_CREATED',
  SERVICE_UPDATED = 'SERVICE_UPDATED',
  SERVICE_DELETED = 'SERVICE_DELETED',
  SETTLEMENT_PROCESSED = 'SETTLEMENT_PROCESSED',
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',
  CUSTOMER_DEACTIVATED = 'CUSTOMER_DEACTIVATED',
  CUSTOMER_ACTIVATED = 'CUSTOMER_ACTIVATED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  BOOKING_REASSIGNED = 'BOOKING_REASSIGNED',
  ASSIGNMENT_STARTED = 'ASSIGNMENT_STARTED',
  ASSIGNMENT_BROADCAST = 'ASSIGNMENT_BROADCAST',
  ASSIGNMENT_ACCEPTED = 'ASSIGNMENT_ACCEPTED',
  ASSIGNMENT_REJECTED = 'ASSIGNMENT_REJECTED',
  ASSIGNMENT_FAILED = 'ASSIGNMENT_FAILED',
  ASSIGNMENT_MANUAL_REQUIRED = 'ASSIGNMENT_MANUAL_REQUIRED',
  MANUAL_ASSIGNMENT_CREATED = 'MANUAL_ASSIGNMENT_CREATED',
  MANUAL_ASSIGNMENT_ACCEPTED = 'MANUAL_ASSIGNMENT_ACCEPTED',
  MANUAL_ASSIGNMENT_REJECTED = 'MANUAL_ASSIGNMENT_REJECTED',
  MANUAL_ASSIGNMENT_REASSIGNED = 'MANUAL_ASSIGNMENT_REASSIGNED',
  MANUAL_ASSIGNMENT_COMPLETED = 'MANUAL_ASSIGNMENT_COMPLETED',
  MANUAL_ASSIGNMENT_EXPIRED = 'MANUAL_ASSIGNMENT_EXPIRED',
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_DEBIT = 'WALLET_DEBIT',
  WALLET_TOPUP = 'WALLET_TOPUP',
  WALLET_ADJUSTMENT = 'WALLET_ADJUSTMENT',
  COMMISSION_DEDUCTED = 'COMMISSION_DEDUCTED',
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_CAPTURED = 'PAYMENT_CAPTURED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  BANK_ACCOUNT_ADDED = 'BANK_ACCOUNT_ADDED',
  BANK_ACCOUNT_UPDATED = 'BANK_ACCOUNT_UPDATED',
  BANK_ACCOUNT_VERIFIED = 'BANK_ACCOUNT_VERIFIED',
  SETTLEMENT_CREATED = 'SETTLEMENT_CREATED',
  SETTLEMENT_BATCH_CREATED = 'SETTLEMENT_BATCH_CREATED',
  SETTLEMENT_READY_FOR_PAYOUT = 'SETTLEMENT_READY_FOR_PAYOUT',
  SETTLEMENT_PAID = 'SETTLEMENT_PAID',
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',
  PAYOUT_CREATED = 'PAYOUT_CREATED',
  PAYOUT_READY = 'PAYOUT_READY',
  PAYOUT_QUEUED = 'PAYOUT_QUEUED',
  PAYOUT_PROCESSING = 'PAYOUT_PROCESSING',
  PAYOUT_PAID = 'PAYOUT_PAID',
  PAYOUT_FAILED = 'PAYOUT_FAILED',
  PAYOUT_REVERSED = 'PAYOUT_REVERSED',
  PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED',
  LOCATION_UPDATED = 'LOCATION_UPDATED',
  TRACKING_STARTED = 'TRACKING_STARTED',
  TRACKING_STOPPED = 'TRACKING_STOPPED',
  ROUTE_STARTED = 'ROUTE_STARTED',
  WORKER_ARRIVED = 'WORKER_ARRIVED',
  DEVICE_REGISTERED = 'DEVICE_REGISTERED',
  DEVICE_REMOVED = 'DEVICE_REMOVED',
  PUSH_NOTIFICATION_SENT = 'PUSH_NOTIFICATION_SENT',
  PUSH_NOTIFICATION_FAILED = 'PUSH_NOTIFICATION_FAILED',
}

// 12. Audit Logs Table Interface
export interface AuditLog {
  id: string;
  admin_id: string;
  action: AuditAction;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
}

// 13. Platform Settings Table Interface
export interface PlatformSettings {
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export type AssignmentQueueStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'BROADCASTING'
  | 'ASSIGNED'
  | 'FAILED';

export interface AssignmentQueueWorker {
  worker_id:   string;
  distance_km: number;
}

export interface AssignmentQueue {
  id:                    string;
  booking_id:            string;
  current_group:         1 | 2 | 3;
  group_workers:         AssignmentQueueWorker[];
  all_notified_workers:  string[];
  status:                AssignmentQueueStatus;
  attempts:              number;
  group_expires_at:      string | null;
  started_at:            string | null;
  assigned_at:           string | null;
  created_at:            string;
  updated_at:            string;
}

export interface WorkerJobRejection {
  id:         string;
  booking_id: string;
  worker_id:  string;
  reason:     string | null;
  created_at: string;
}



export interface CommissionRule {
  id: string;
  service_category_id: string | null;
  commission_percent: number;
  is_active: boolean;
  created_at: string;
}

export interface PaymentAttempt {
  id: string;
  payment_id: string;
  status: string | null;
  response: Record<string, any> | null;
  created_at: string;
}


