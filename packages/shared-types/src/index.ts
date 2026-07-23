// ============================================================
// @volo/shared-types
// Single source of truth for all domain types shared between
// the VOLO web app (Next.js) and mobile app (Expo RN).
//
// DO NOT add platform-specific code here.
// DO NOT import from Next.js or React Native.
// ============================================================

import { z } from 'zod';

// ─── Role & Status Enums ────────────────────────────────────

export type UserRole = 'customer' | 'worker' | 'admin';

export enum WorkerStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ON_JOB = 'ON_JOB',
  SUSPENDED = 'SUSPENDED',
}

export enum KycStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum BookingType {
  INSTANT = 'INSTANT',
  SCHEDULED = 'SCHEDULED',
}

export enum PaymentMode {
  ONLINE = 'ONLINE',
  COD = 'COD',
  WALLET = 'WALLET',
}

export enum BookingStatus {
  PENDING_ASSIGNMENT = 'PENDING_ASSIGNMENT',
  WORKER_ASSIGNED = 'WORKER_ASSIGNED',
  WORKER_ACCEPTED = 'WORKER_ACCEPTED',
  WORKER_REJECTED = 'WORKER_REJECTED',
  ON_THE_WAY = 'ON_THE_WAY',
  ARRIVED = 'ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MANUAL_ASSIGNMENT_REQUIRED = 'MANUAL_ASSIGNMENT_REQUIRED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum SettlementStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  FAILED = 'FAILED',
}

export enum WalletTxnType {
  COMMISSION_DEDUCTION = 'COMMISSION_DEDUCTION',
  WALLET_TOPUP = 'WALLET_TOPUP',
  ADJUSTMENT = 'ADJUSTMENT',
  REFUND = 'REFUND',
}

export enum NotificationType {
  BOOKING_REQUEST = 'BOOKING_REQUEST',
  BOOKING_ACCEPTED = 'BOOKING_ACCEPTED',
  BOOKING_REJECTED = 'BOOKING_REJECTED',
  WORKER_ARRIVING = 'WORKER_ARRIVING',
  JOB_STARTED = 'JOB_STARTED',
  JOB_COMPLETED = 'JOB_COMPLETED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYOUT_PROCESSED = 'PAYOUT_PROCESSED',
  KYC_APPROVED = 'KYC_APPROVED',
  KYC_REJECTED = 'KYC_REJECTED',
  LOW_WALLET_BALANCE = 'LOW_WALLET_BALANCE',
  MANUAL_ASSIGNMENT_CREATED = 'MANUAL_ASSIGNMENT_CREATED',
  MANUAL_ASSIGNMENT_ACCEPTED = 'MANUAL_ASSIGNMENT_ACCEPTED',
  MANUAL_ASSIGNMENT_REJECTED = 'MANUAL_ASSIGNMENT_REJECTED',
  MANUAL_ASSIGNMENT_REASSIGNED = 'MANUAL_ASSIGNMENT_REASSIGNED',
  MANUAL_ASSIGNMENT_EXPIRED = 'MANUAL_ASSIGNMENT_EXPIRED',
  BOOKING_TRACKING_STARTED = 'BOOKING_TRACKING_STARTED',
  WORKER_NEARBY = 'WORKER_NEARBY',
  ETA_UPDATED = 'ETA_UPDATED',
  WORKER_ARRIVED = 'WORKER_ARRIVED',
  ROUTE_STARTED = 'ROUTE_STARTED',
}

// ─── Core Domain Interfaces ──────────────────────────────────

export interface User {
  id: string;
  firebase_uid: string | null;
  role: UserRole;
  full_name: string | null;
  phone: string;
  email: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  status: WorkerStatus;
  kyc_status: KycStatus;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
  aadhar_front_url: string | null;
  aadhar_back_url: string | null;
  pan_url: string | null;
  selfie_url: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  commission_wallet_balance: number;
  rating: number;
  total_jobs: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  icon_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface ServiceItem {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  base_price: number;
  estimated_mins: number;
  icon_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Booking {
  id: string;
  customer_id: string;
  worker_id: string | null;
  service_item_id: string;
  booking_type: BookingType;
  payment_mode: PaymentMode;
  status: BookingStatus;
  address_line: string;
  lat: number;
  lng: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_amount: number;
  notes: string | null;
  otp: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (optional, present when fetched with relations)
  service_items?: Pick<ServiceItem, 'name' | 'description' | 'base_price' | 'estimated_mins'>;
  workers?: { users?: Pick<User, 'full_name' | 'phone'> };
}

export interface Payment {
  id: string;
  booking_id: string;
  customer_id: string;
  payment_mode: PaymentMode;
  status: PaymentStatus;
  amount: number;
  admin_commission: number | null;
  worker_share: number | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface SettlementLedger {
  id: string;
  worker_id: string;
  payment_id: string;
  amount: number;
  status: SettlementStatus;
  razorpayx_payout_id: string | null;
  razorpayx_transfer_id: string | null;
  payout_initiated_at: string | null;
  payout_completed_at: string | null;
  week_end_date: string | null;
  created_at: string;
}

export interface CommissionWalletTransaction {
  id: string;
  worker_id: string;
  booking_id: string | null;
  type: WalletTxnType;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

export interface WorkerLocationLog {
  id: number;
  worker_id: string;
  booking_id: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, any> | null;
  is_read: boolean;
  created_at: string;
}

export interface Review {
  id: string;
  booking_id: string;
  customer_id: string;
  worker_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface WorkerWallet {
  id: string;
  worker_id: string;
  balance: number;
  minimum_balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  worker_id: string;
  booking_id: string | null;
  type: string;
  amount: number | null;
  balance_before: number | null;
  balance_after: number | null;
  description: string | null;
  created_at: string;
}

export interface WorkerBankAccount {
  id: string;
  worker_id: string;
  account_holder_name: string;
  bank_name: string;
  account_number_encrypted: string;
  account_last_four: string;
  ifsc_code: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface SettlementBatch {
  id: string;
  batch_reference: string;
  batch_type: string;
  total_workers: number;
  total_transactions: number;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── API Response & Auth Types ───────────────────────────────

export interface AuthUser {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  refreshToken: string;
  user: AuthUser;
  isNewUser: boolean;
  redirectTo: string;
  deviceToken: string;
  pinSet: boolean;
  promptPinSetup: boolean;
}

export interface MobileRefreshResponse {
  token: string;
  refreshToken: string;
}

export interface LocationUpdatePayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  deviceType: 'ANDROID' | 'IOS' | 'WEB';
}

export interface CreateBookingPayload {
  service_item_id: string;
  address: string;
  latitude: number;
  longitude: number;
  scheduled_at?: string | null;
  notes?: string;
  payment_mode: 'ONLINE' | 'COD' | 'WALLET';
  promo_code?: string;
}

export interface ApiError {
  error: string;
  status?: number;
}

export interface CustomerWallet {
  balance: number;
  currency: string;
}

export interface WalletResponse {
  wallet: CustomerWallet;
  transactions: WalletTransaction[];
}

export interface ServiceCategoryWithItems extends ServiceCategory {
  items: ServiceItem[];
}

export interface BookingListResponse {
  bookings: Booking[];
}

export interface JobListResponse {
  jobs: Booking[];
}

export interface CreateBookingResponse {
  success: boolean;
  bookingId: string;
  message: string;
}

export interface ProfileResponse {
  user: User & { worker?: any };
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

export interface SettlementsResponse {
  settlements: SettlementLedger[];
  total: number;
}

// ─── Zod Validation Schemas ───────────────────────────────────

export const PhoneSchema = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const OtpSchema = z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d+$/, 'OTP must contain only digits');

export const CreateBookingSchema = z.object({
  service_item_id: z.string().uuid('Invalid service item ID'),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  latitude: z.number(),
  longitude: z.number(),
  payment_mode: z.enum(['ONLINE', 'COD', 'WALLET']),
  notes: z.string().optional(),
});

export const ProfileUpdateSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
});


