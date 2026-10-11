import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ★ fix-638: a component that runs a query (the reviewer popover now fetches its
//   open reviewers' due dates) needs a QueryClient. A fresh one per render, no
//   retries, so a test never waits on a retry or sees another test's cache.
export function renderWithQuery(ui: ReactElement, options?: RenderOptions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
