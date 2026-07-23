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
        single: queries.single,
        maybeSingle: queries.maybeSingle,
        then: (onfulfilled: any) => {
          return Promise.resolve(queries.resolvedValue || { data: null, error: null }).then(onfulfilled);
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

import { createWallet, getBalance, validateWallet, deductCommission } from '../wallet-engine';

describe('wallet-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries.resolvedValue = null;
  });

  describe('createWallet', () => {
    it('returns true if wallet already exists', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: { id: 'wallet-123' }, error: null });
      const result = await createWallet('worker-123');
      expect(result).toBe(true);
    });

    it('creates wallet and returns true if it does not exist', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: null, error: null });
      mockQueries.resolvedValue = { data: null, error: null };
      const result = await createWallet('worker-123');
      expect(result).toBe(true);
    });

    it('returns false if insert fails', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: null, error: null });
      mockQueries.resolvedValue = { data: null, error: { message: 'Insert failed' } };
      const result = await createWallet('worker-123');
      expect(result).toBe(false);
    });
  });

  describe('getBalance', () => {
    it('returns wallet balance if found', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: { balance: 250 }, error: null });
      const result = await getBalance('worker-123');
      expect(result).toBe(250);
    });

    it('returns 0 if query fails', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });
      const result = await getBalance('worker-123');
      expect(result).toBe(0);
    });
  });

  describe('validateWallet', () => {
    it('returns true if balance is above minimum balance', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: { balance: -100, minimum_balance: -500 }, error: null });
      const result = await validateWallet('worker-123');
      expect(result).toBe(true);
    });

    it('returns false if balance is below minimum balance', async () => {
      mockQueries.single.mockResolvedValueOnce({ data: { balance: -600, minimum_balance: -500 }, error: null });
      const result = await validateWallet('worker-123');
      expect(result).toBe(false);
    });
  });

  describe('deductCommission', () => {
    it('calls rpc to deduct commission successfully', async () => {
      client.rpc.mockResolvedValueOnce({ data: { success: true }, error: null });
      const result = await deductCommission('worker-123', 'booking-123', 15);
      expect(result.success).toBe(true);
    });

    it('returns failure message if rpc fails', async () => {
      client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'RPC Error' } });
      const result = await deductCommission('worker-123', 'booking-123', 15);
      expect(result.success).toBe(false);
      expect(result.error).toBe('RPC Error');
    });
  });
});
