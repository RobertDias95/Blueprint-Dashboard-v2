import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// fix-notes-3: single-source write-back proof. An edit anywhere (the Weekly
// Updates report, the permit NotesPanel, Project Overview) goes through the
// same fix-notes-1 hooks, which invalidate the whole notes prefix — so the
// permit view's per-project query AND the report's all-notes query both
// refetch and read the change back from public.notes.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  const updateFn = vi.fn();
  const builder = {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => {
          updateFn(patch);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { builder, updateFn };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useUpdateNote, useAddNote } from '../hooks/useNotes';

beforeEach(() => {
  mocks.updateFn.mockClear();
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
});

function isPrefix(prefix: readonly unknown[], key: readonly unknown[]): boolean {
  return prefix.every((seg, i) => JSON.stringify(seg) === JSON.stringify(key[i]));
}

describe('notes single-source write-back', () => {
  it('the notes prefix covers BOTH the per-project (permit view) key and the all-notes (report) key', () => {
    const prefix = queryKeys.notesAll;
    expect(isPrefix(prefix, queryKeys.notes(T, 'proj-1'))).toBe(true);
    expect(isPrefix(prefix, queryKeys.allNotes(T))).toBe(true);
  });

  it('useUpdateNote invalidates the whole notes prefix (so every notes surface refetches)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateNote(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'note-1', projectId: 'proj-1', body: 'x' });
    });
    expect(mocks.updateFn).toHaveBeenCalledWith({ body: 'x' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.notesAll });
  });

  it('useAddNote invalidates the whole notes prefix too', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddNote(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'proj-1', permitId: null, body: 'y' });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.notesAll });
  });
});
