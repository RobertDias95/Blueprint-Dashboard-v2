import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ===========================================================================
// fix-648 (P-339) — the Email notifications panel, rendered against the REAL
// hooks with a mocked Supabase client: no row shows OFF for Mentions and Task
// assignments, ON for the other two, and ticking one writes enabled = true.
// ===========================================================================

const state = vi.hoisted(() => ({
  rows: [] as { category: string; enabled: boolean }[],
  upserts: [] as { user_id: string; category: string; enabled: boolean }[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: state.rows, error: null }),
      }),
      upsert: async (row: { user_id: string; category: string; enabled: boolean }) => {
        state.upserts.push(row);
        state.rows = [
          ...state.rows.filter((r) => r.category !== row.category),
          { category: row.category, enabled: row.enabled },
        ];
        return { error: null };
      },
    }),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'u-new' } }),
}));

import EmailNotificationsPanel from '../components/Settings/EmailNotificationsPanel';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EmailNotificationsPanel />
    </QueryClientProvider>,
  );
}

const box = (c: string) => screen.getByTestId(`email-notifications-${c}`) as HTMLInputElement;

beforeEach(() => {
  state.rows = [];
  state.upserts = [];
});

describe('fix-648: Settings → My account → Email notifications', () => {
  it('★★★ a new login (no rows) sees Mentions and Task assignments OFF, the rest ON', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('email-notifications')).toBeInTheDocument());
    expect(box('mention').checked).toBe(false);
    expect(box('assignment').checked).toBe(false);
    expect(box('weekly').checked).toBe(true);
    expect(box('resubmit').checked).toBe(true);
    expect(screen.getAllByText(/Off unless you turn it on\./)).toHaveLength(2);
  });

  it('★★★ ticking Mentions writes enabled = true, and the box stays ticked', async () => {
    mount();
    await waitFor(() => expect(box('mention')).toBeInTheDocument());
    fireEvent.click(box('mention'));
    await waitFor(() => expect(state.upserts).toHaveLength(1));
    expect(state.upserts[0]).toMatchObject({ user_id: 'u-new', category: 'mention', enabled: true });
    await waitFor(() => expect(box('mention').checked).toBe(true));
  });

  it('★★ someone who turned theirs on (Cam, Dom, Jake, Taylor) still sees it on', async () => {
    state.rows = [
      { category: 'mention', enabled: true },
      { category: 'assignment', enabled: true },
    ];
    mount();
    await waitFor(() => expect(box('mention').checked).toBe(true));
    expect(box('assignment').checked).toBe(true);
  });
});
