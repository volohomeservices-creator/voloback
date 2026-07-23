export interface PaymentOrderRequest {
  amount: number;
  currency?: string;
  receiptId: string;
  notes?: Record<string, string>;
}

export interface PaymentOrderResponse {
  id: string; // Gateway Order ID
  amount: number;
  currency: string;
  status: string;
}

export interface PaymentVerificationRequest {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface PaymentRefundRequest {
  paymentId: string;
  amount?: number; // Optional, full refund if not provided
  notes?: Record<string, string>;
}

export interface PaymentRefundResponse {
  id: string; // Gateway Refund ID
  status: string;
}

export interface IPaymentProvider {
  createOrder(request: PaymentOrderRequest): Promise<PaymentOrderResponse>;
  verifyPayment(request: PaymentVerificationRequest): Promise<boolean>;
  refundPayment(request: PaymentRefundRequest): Promise<PaymentRefundResponse>;
}
