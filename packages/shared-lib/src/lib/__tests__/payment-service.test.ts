import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockChain, mockFn } = vi.hoisted(() => {
  const chain: any = {};
  const fn = vi.fn().mockImplementation(() => chain);
  chain.select = fn;
  chain.insert = fn;
  chain.update = fn;
  chain.eq = fn;
  chain.single = vi.fn();
  chain.maybeSingle = vi.fn();
  chain.then = (onfulfilled: any) => {
    return Promise.resolve(chain._resolvedValue || { data: [], error: null }).then(onfulfilled);
  };
  return { mockChain: chain, mockFn: fn };
});

vi.mock('../supabase-server', () => {
  return {
    supabaseAdmin: {
      from: () => mockFn()
    }
  };
});

vi.mock('../audit', () => {
  return {
    logAuditAction: vi.fn().mockResolvedValue(true)
  };
});

vi.mock('./mock-payment-provider', () => {
  return {
    paymentProvider: {
      createOrder: vi.fn().mockResolvedValue({ id: 'ord_mock_123' })
    }
  };
});

// Mock helpers in packages/shared-lib/src/lib
vi.mock('../commission-engine', () => {
  return {
    calculateCommission: vi.fn().mockResolvedValue(15) // mock 15 commission
  };
});

vi.mock('../wallet-engine', () => {
  return {
    deductCommission: vi.fn().mockResolvedValue({ success: true })
  };
});

import { createOnlinePayment, finalizeBookingFinancials } from '../payment-service';

describe('payment-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChain._resolvedValue = undefined;
  });

  describe('createOnlinePayment', () => {
    it('successfully creates online payment and attempts log', async () => {
      // payment insert mock
      mockChain.single.mockResolvedValueOnce({
        data: { id: 'payment-123' },
        error: null
      });

      // payment attempts insert mock
      mockChain._resolvedValue = { data: null, error: null };

      const result = await createOnlinePayment('booking-123', 'customer-123', 100);
      expect(result.success).toBe(true);
    });

    it('returns error if db insert fails', async () => {
      mockChain.single.mockResolvedValueOnce({
        data: null,
        error: new Error('DB error')
      });

      const result = await createOnlinePayment('booking-123', 'customer-123', 100);
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });

  describe('finalizeBookingFinancials', () => {
    it('successfully processes COD booking financials', async () => {
      // 1. Fetch booking details
      mockChain.single.mockResolvedValueOnce({
        data: {
          id: 'booking-123',
          customer_id: 'cust-123',
          worker_id: 'worker-123',
          total_amount: 100,
          payment_mode: 'COD',
          service_items: { category_id: 'cat-123' }
        },
        error: null
      });

      // 2. Payments / ledger insert mock
      mockChain._resolvedValue = { data: null, error: null };

      const result = await finalizeBookingFinancials('booking-123');
      expect(result).toBe(true);
    });

    it('successfully processes ONLINE booking financials', async () => {
      // 1. Fetch booking details
      mockChain.single.mockResolvedValueOnce({
        data: {
          id: 'booking-123',
          customer_id: 'cust-123',
          worker_id: 'worker-123',
          total_amount: 100,
          payment_mode: 'ONLINE',
          service_items: { category_id: 'cat-123' }
        },
        error: null
      });

      // 2. Payments update, ledger insert mock
      mockChain._resolvedValue = { data: null, error: null };

      const result = await finalizeBookingFinancials('booking-123');
      expect(result).toBe(true);
    });
  });
});
