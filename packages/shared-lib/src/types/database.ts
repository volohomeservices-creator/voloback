import {
  User,
  Worker,
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
  AuditLog,
  PlatformSettings,
  AssignmentQueue,
  ServiceCategory,
  ServiceItem,
} from './index';

export interface Database {
  public: {
    Tables: Record<string, { Row: any, Insert: any, Update: any }>;
    Views: Record<string, { Row: any, Insert: any, Update: any }>;
    Functions: Record<string, { Args: any, Returns: any }>;
    Enums: Record<string, any>;
  };
}
