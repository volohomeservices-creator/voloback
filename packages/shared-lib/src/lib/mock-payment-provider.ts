import 'server-only';
import {
  IPaymentProvider,
  PaymentOrderRequest,
  PaymentOrderResponse,
  PaymentVerificationRequest,
  PaymentRefundRequest,
  PaymentRefundResponse
} from './payment-provider';

export class MockPaymentProvider implements IPaymentProvider {
  async createOrder(request: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    // Generate a fake Razorpay-like order ID
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const orderId = `order_mock_${randomSuffix}`;

    return {
      id: orderId,
      amount: request.amount,
      currency: request.currency || 'INR',
      status: 'created'
    };
  }

  async verifyPayment(request: PaymentVerificationRequest): Promise<boolean> {
    // Mock always verifies successfully if signature exists
    return !!request.signature;
  }

  async refundPayment(request: PaymentRefundRequest): Promise<PaymentRefundResponse> {
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    return {
      id: `rfnd_mock_${randomSuffix}`,
      status: 'processed'
    };
  }
}

// Export a singleton instance for use throughout the app
export const paymentProvider = new MockPaymentProvider();
