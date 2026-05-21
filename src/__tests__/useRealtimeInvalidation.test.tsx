import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// fix-39 Track B: the realtime invalidator must NOT refetch while a mutation
// is in flight. A realtime event landing mid-mutation would refetch the
// pre-commit row and clobber the optimistic edit (the silent "approval_date
// goes blank" race). This suite pins the guard.

const mocks = vi.hoisted(() => {
  const handlers: Array<() => void> = [];
  const channelObj: {
    on: (...a: unknown[]) => unknown;
    subscribe: () => unknown;
  } = {
    on: (...args: unknown[]) => {
      handlers.push(args[2] as () => void);
      return channelObj;
    },
    subscribe: () => channelObj,
  };
  return {
    handlers,
    supabase: { channel: () => channelObj, removeChannel: vi.fn() },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

import { useRealtimeInvalidation } from '../hooks/useRealtimeInvalidation';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useRealtimeInvalidation(), { wrapper });
  return queryClient;
}

beforeEach(() => {
  mocks.handlers.length = 0;
});

describe('useRealtimeInvalidation — fix-39 clobber guard', () => {
  it('invalidates when no mutation is in flight', () => {
    const qc = setup();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    expect(mocks.handlers.length).toBeGreaterThan(0);

    mocks.handlers[0]();
    expect(spy).toHaveBeenCalled();
  });

  it('does NOT invalidate (no clobber) while a mutation is in flight', () => {
    const qc = setup();
    // Seed an optimistic value the way useUpdatePermit.onMutate would.
    qc.setQueryData(['permits', 't1'], [{ id: 1, approval_date: '2026-02-24' }]);
    vi.spyOn(qc, 'isMutating').mockReturnValue(1);
    const spy = vi.spyOn(qc, 'invalidateQueries');

    mocks.handlers[0]();

    // The realtime event is dropped while mutating → no refetch → the
    // optimistic value survives instead of being clobbered by a stale read.
    expect(spy).not.toHaveBeenCalled();
    expect(qc.getQueryData(['permits', 't1'])).toEqual([
      { id: 1, approval_date: '2026-02-24' },
    ]);
  });
});
