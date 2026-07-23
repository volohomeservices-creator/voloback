import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock supabase-server using its alias path BEFORE importing the route
const mockSelect = vi.fn();
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock('@/lib/supabase-server', () => {
  return {
    supabaseAdmin: {
      from: (table: string) => mockFrom(table)
    }
  };
});

import { GET } from '../health/route';

describe('health check endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns UP if supabase probe query succeeds', async () => {
    mockSelect.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValueOnce({
        data: [{ id: '1' }],
        error: null
      })
    });

    const response = await GET();
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.status).toBe('UP');
    expect(data.database.status).toBe('CONNECTED');
  });

  it('returns DEGRADED if supabase probe query fails', async () => {
    mockSelect.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'Supabase failure' }
      })
    });

    const response = await GET();
    const data = await response.json();
    
    expect(response.status).toBe(500);
    expect(data.status).toBe('DEGRADED');
    expect(data.database.status).toBe('DEGRADED');
  });
});
