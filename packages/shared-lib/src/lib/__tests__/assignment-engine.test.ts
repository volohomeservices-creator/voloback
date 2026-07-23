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
        order: vi.fn().mockImplementation(() => builder),
        limit: vi.fn().mockImplementation(() => builder),
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

vi.mock('../notification-dispatcher', () => {
  return {
    dispatchNotification: vi.fn().mockResolvedValue(true),
    dispatchBulkNotifications: vi.fn().mockResolvedValue(true)
  };
});

import { startAssignment } from '../assignment-engine';

describe('assignment-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries.resolvedValue = null;
  });

  describe('startAssignment', () => {
    it('throws error if booking is not in PENDING_ASSIGNMENT status', async () => {
      mockQueries.single.mockResolvedValueOnce({
        data: { id: 'booking-123', status: 'ASSIGNED' },
        error: null
      });

      await expect(startAssignment('booking-123')).rejects.toThrow();
    });

    it('updates booking to MANUAL_ASSIGNMENT_REQUIRED if no workers found', async () => {
      // 1. Fetch booking
      mockQueries.single.mockResolvedValueOnce({
        data: { id: 'booking-123', status: 'PENDING_ASSIGNMENT', lat: 10, lng: 10, payment_mode: 'ONLINE', service_item_id: 'si-1' },
        error: null
      });

      // 2. Fetch search radius
      mockQueries.single.mockResolvedValueOnce({
        data: { value: '10' },
        error: null
      });

      // 3. RPC mock returns empty workers list
      client.rpc.mockResolvedValueOnce({ data: [], error: null });

      // 4. Update booking to MANUAL_ASSIGNMENT_REQUIRED
      // 5. Fetch system admin
      mockQueries.single.mockResolvedValueOnce({
        data: { id: 'admin-123' },
        error: null
      });

      const result = await startAssignment('booking-123');
      expect(result).toBe('NO_WORKERS');
    });
  });
});
