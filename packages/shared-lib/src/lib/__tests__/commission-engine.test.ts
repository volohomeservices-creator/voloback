import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockChain, mockFn } = vi.hoisted(() => {
  const chain: any = {};
  const fn = vi.fn().mockImplementation(() => chain);
  chain.select = fn;
  chain.eq = fn;
  chain.is = fn;
  chain.single = vi.fn();
  return { mockChain: chain, mockFn: fn };
});

vi.mock('../supabase-server', () => {
  return {
    supabaseAdmin: {
      from: () => mockFn()
    }
  };
});

import { calculateCommission } from '../commission-engine';

describe('calculateCommission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates custom category commission when active rule exists', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: { commission_percent: 20 },
      error: null
    });

    const result = await calculateCommission(1000, 'category-123');
    expect(result).toBe(200); // 20% of 1000
  });

  it('falls back to default 15% commission if no rule is found', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: null,
      error: null
    });

    const result = await calculateCommission(1000, 'category-123');
    expect(result).toBe(150); // 15% of 1000
  });

  it('uses global default rule if serviceCategoryId is null and global rule is found', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: { commission_percent: 10 },
      error: null
    });

    const result = await calculateCommission(1000, null);
    expect(result).toBe(100); // 10% of 1000
  });
});
