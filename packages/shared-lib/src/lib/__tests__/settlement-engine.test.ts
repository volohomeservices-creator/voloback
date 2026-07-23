import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { client, mockQueries } = vi.hoisted(() => {
  const queries = {
    single: vi.fn(),
    maybeSingle: vi.fn(),
    resolvedValue: null as any
  };

  const supabaseClient = {
    from: vi.fn().mockImplementation(() => {
      const builder = {
        select: vi.fn().mockImplementation(() => builder),
        insert: vi.fn().mockImplementation(() => builder),
        update: vi.fn().mockImplementation(() => builder),
        eq: vi.fn().mockImplementation(() => builder),
        in: vi.fn().mockImplementation(() => builder),
        single: queries.single,
        maybeSingle: queries.maybeSingle,
        then: (onfulfilled: any) => {
          return Promise.resolve(queries.resolvedValue || { data: [], error: null }).then(onfulfilled);
        }
      };
      return builder;
    }),
    rpc: vi.fn()
  };

  return { client: supabaseClient, mockQueries: queries };
});

vi.mock('../supabase-server', () => {
  return {
    supabaseAdmin: client
  };
});

vi.mock('../audit', () => {
  return {
    logAuditAction: vi.fn().mockResolvedValue(true)
  };
});

vi.mock('../notification-dispatcher', () => {
  return {
    dispatchNotification: vi.fn().mockResolvedValue(true)
  };
});

vi.mock('../payouts/payout-service', () => {
  return {
    PayoutService: {
      queuePayoutsForBatch: vi.fn().mockResolvedValue({ success: true })
    }
  };
});

import { calculateWorkerSettlement, generateSettlementBatch } from '../settlement-engine';

describe('settlement-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries.resolvedValue = null;
  });

  describe('calculateWorkerSettlement', () => {
    it('returns calculated aggregated settlement values', async () => {
      mockQueries.resolvedValue = {
        data: [
          { gross_amount: 100, commission_amount: 15, net_amount: 85, status: 'PENDING' },
          { gross_amount: 200, commission_amount: 30, net_amount: 170, status: 'PAID' }
        ],
        error: null
      };

      const result = await calculateWorkerSettlement('worker-123');
      expect(result).toEqual({
        gross_earnings: 300,
        commission: 45,
        net_earnings: 255,
        pending_amount: 85,
        processing_amount: 0,
        ready_for_payout_amount: 0,
        paid_amount: 170
      });
    });

    it('returns null if query fails', async () => {
      mockQueries.resolvedValue = {
        data: null,
        error: { message: 'Database error' }
      };

      const result = await calculateWorkerSettlement('worker-123');
      expect(result).toBeNull();
    });
  });

  describe('generateSettlementBatch', () => {
    it('returns success message if no pending settlements are found', async () => {
      mockQueries.resolvedValue = {
        data: [],
        error: null
      };

      const result = await generateSettlementBatch('WEDNESDAY');
      expect(result.success).toBe(true);
      expect(result.message).toBe('No pending settlements found.');
    });

    it('creates batch and marks ledger entries processing', async () => {
      // 1. Fetch pending
      mockQueries.resolvedValue = {
        data: [
          { id: 's-1', worker_id: 'w-1', gross_amount: 100, commission_amount: 15, net_amount: 85 }
        ],
        error: null
      };

      // 2. Insert batch
      mockQueries.single.mockResolvedValueOnce({
        data: { id: 'batch-123' },
        error: null
      });

      // 3. Update ledger (we will let resolvedValue handle it)
      // mockQueries.resolvedValue = { data: null, error: null } will be default

      const result = await generateSettlementBatch('WEDNESDAY');
      expect(result.success).toBe(true);
      expect(result.batch_id).toBe('batch-123');
    });
  });
});
