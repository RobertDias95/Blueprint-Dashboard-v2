import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-24c: wire-shape test for useBuilderSearch. Locks in two contracts:
//   1. The `.or()` filter uses `*` as the wildcard (PostgREST URL-safe
//      convention) — NOT `%`. The original `%boyd%` pattern silently
//      returned nothing in production (no requests landed correctly on
//      /rest/v1/builders), almost certainly due to a `%`/URL-encoding
//      interaction somewhere in the stack. `*boyd*` sidesteps the entire
//      class of bugs.
//   2. User-typed wildcards (`*`, `%`, `_`, `\`) are escaped so a user
//      searching for an underscore in an email actually matches the
//      underscore.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  const orFn = vi.fn();
  const selectFn = vi.fn();
  const fromFn = vi.fn();
  const orderFn = vi.fn();
  const limitFn = vi.fn();
  let nextResult: { data: unknown[] | null; error: Error | null } = {
    data: [],
    error: null,
  };

  type Chain = {
    from: (table: string) => Chain;
    select: (cols: string) => Chain;
    or: (filter: string) => Chain;
    order: (col: string, opts: { ascending: boolean }) => Chain;
    limit: (n: number) => Promise<typeof nextResult>;
  };
  const chain = {} as Chain;
  chain.from = (table) => {
    fromFn(table);
    return chain;
  };
  chain.select = (cols) => {
    selectFn(cols);
    return chain;
  };
  chain.or = (filter) => {
    orFn(filter);
    return chain;
  };
  chain.order = (col, opts) => {
    orderFn(col, opts);
    return chain;
  };
  chain.limit = (n) => {
    limitFn(n);
    return Promise.resolve(nextResult);
  };

  return {
    chain,
    orFn,
    selectFn,
    fromFn,
    orderFn,
    limitFn,
    setResult(r: { data: unknown[] | null; error: Error | null }) {
      nextResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.chain }));

import { useBuilderSearch } from '../hooks/useBuilderSearch';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  mocks.orFn.mockClear();
  mocks.selectFn.mockClear();
  mocks.fromFn.mockClear();
  mocks.orderFn.mockClear();
  mocks.limitFn.mockClear();
  mocks.setResult({ data: [], error: null });
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useBuilderSearch — fix-24c wire shape', () => {
  it('issues an .or() filter with * wildcards (NOT %) across name/company/email/phone for "boyd"', async () => {
    mocks.setResult({
      data: [
        {
          id: 'b1',
          name: 'Boyd Lybeck',
          company: null,
          email: null,
          phone: null,
          notes: null,
          active: true,
        },
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBuilderSearch('boyd'), {
      wrapper,
    });
    await waitFor(() => {
      expect(mocks.orFn).toHaveBeenCalledTimes(1);
    });
    const filter = mocks.orFn.mock.calls[0][0] as string;
    expect(filter).toBe(
      'name.ilike.*boyd*,company.ilike.*boyd*,email.ilike.*boyd*,phone.ilike.*boyd*',
    );
    // And — critically — no raw `%` in the filter string. This is what
    // we suspect was breaking Bobby's prod smoke.
    expect(filter).not.toContain('%');
    // The hook returns the row to the caller.
    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });
    expect((result.current.data[0] as { name: string }).name).toBe('Boyd Lybeck');
  });

  it('skips the query when there is no active tenant (RLS would reject anyway)', async () => {
    useAuthStore.setState({ activeTenantId: null, memberships: [] });
    const { wrapper } = setup();
    renderHook(() => useBuilderSearch('boyd'), { wrapper });
    // Give react-query a chance to fire if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.orFn).not.toHaveBeenCalled();
  });

  it('skips the query when the trimmed input is empty', async () => {
    const { wrapper } = setup();
    renderHook(() => useBuilderSearch('   '), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.orFn).not.toHaveBeenCalled();
  });

  it('escapes user-typed wildcards (*, %, _, \\) so they match literally', async () => {
    const { wrapper } = setup();
    renderHook(() => useBuilderSearch('a_b*c%d'), { wrapper });
    await waitFor(() => {
      expect(mocks.orFn).toHaveBeenCalledTimes(1);
    });
    const filter = mocks.orFn.mock.calls[0][0] as string;
    // Each wildcard char in the user's input gets a leading backslash.
    expect(filter).toBe(
      'name.ilike.*a\\_b\\*c\\%d*,company.ilike.*a\\_b\\*c\\%d*,email.ilike.*a\\_b\\*c\\%d*,phone.ilike.*a\\_b\\*c\\%d*',
    );
  });

  it('orders by name ascending and caps the result set', async () => {
    const { wrapper } = setup();
    renderHook(() => useBuilderSearch('lyb'), { wrapper });
    await waitFor(() => {
      expect(mocks.orderFn).toHaveBeenCalled();
    });
    expect(mocks.orderFn).toHaveBeenCalledWith('name', { ascending: true });
    expect(mocks.limitFn).toHaveBeenCalledWith(20);
  });

  it('selects the columns the autocomplete UI needs (id, name, company, email, phone, notes, active)', async () => {
    const { wrapper } = setup();
    renderHook(() => useBuilderSearch('lyb'), { wrapper });
    await waitFor(() => {
      expect(mocks.selectFn).toHaveBeenCalled();
    });
    expect(mocks.selectFn).toHaveBeenCalledWith(
      'id, name, company, email, phone, notes, active',
    );
    expect(mocks.fromFn).toHaveBeenCalledWith('builders');
  });
});
