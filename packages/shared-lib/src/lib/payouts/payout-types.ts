export enum PayoutStatus {
  PENDING = 'PENDING',
  READY_FOR_PAYOUT = 'READY_FOR_PAYOUT',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export interface PayoutRecord {
  id: string;
  worker_id: string;
  settlement_batch_id: string | null;
  settlement_ledger_id: string | null;
  amount: number;
  provider: string;
  provider_reference: string | null;
  provider_status: string | null;
  utr_number: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  retry_count: number;
  status: PayoutStatus;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutAttempt {
  id: string;
  payout_id: string;
  attempt_number: number;
  request_payload: any;
  response_payload: any;
  status: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PayoutProviderConfig {
  id: string;
  provider_name: string;
  enabled: boolean;
  environment: string;
  created_at: string;
  updated_at: string;
}
