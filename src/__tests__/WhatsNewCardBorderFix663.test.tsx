import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WhatsNewEntry } from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-663 (P-346) — What's New cards keep their left border
// ===========================================================================
//
// Bobby, 2026-10-13: "the boxes around the topics, the left hand side of the
// box appears to be missing the borders." A read card drew its left edge as a
// 3px TRANSPARENT border, so it had three sides. The left edge is now the same
// 1px border as the others; the unread stripe is an inset box-shadow, so the
// text does not move when a card turns read.

const state = vi.hoisted(() => ({
  admin: false,
  entries: [] as WhatsNewEntry[],
  reads: [] as string[],
  marks: [] as string[][],
  saved: null as Record<string, unknown> | null,
  hits: null as null | { id: string; rank: number; snippet: string }[],
  query: '',
}));

vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => state.admin,
}));
vi.mock('../hooks/useWhatsNew', () => ({
  useWhatsNewEntries: () => ({ data: state.entries, isLoading: false }),
  useWhatsNewReads: () => ({ data: state.reads, isLoading: false }),
  useMarkWhatsNewRead: () => ({
    mutate: (ids: string[]) => {
      state.marks.push(ids);
      // The real mutation invalidates the reads, so a read row lands.
      state.reads = [...state.reads, ...ids];
    },
    isPending: false,
  }),
  useUpsertWhatsNewEntry: () => ({
    mutate: (d: Record<string, unknown>, o?: { onSuccess?: () => void }) => {
      state.saved = d;
      o?.onSuccess?.();
    },
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useWhatsNewGuide', () => ({
  useWhatsNewAreas: () => [
    'Projects', 'Project Overview', 'Permits & Reviews', 'Corrections',
    'Chat & Notifications', 'Draw Schedule', 'My Tasks & Board', 'Reports',
    'Library', 'Settings', 'Email',
  ],
  useWhatsNewSearch: (q: string) => {
    state.query = q;
    const active = q.trim().length >= 2;
    return { data: active ? state.hits ?? [] : undefined, active, pending: false, settledQuery: q };
  },
}));

import WhatsNew from '../pages/WhatsNew';

function e(over: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: 'e1',
    published_on: '2026-10-12',
    kind: 'new',
    title: 'A thing',
    body: 'It does a thing. And then some more detail.',
    sort_order: 0,
    go_href: null,
    how_to: null,
    summary: null,
    area: null,
    keywords: null,
    media_url: null,
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/whats-new']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/whats-new" element={<WhatsNew />} />
      <Route path="/project/:id" element={<div data-testid="stub-project">project</div>} />
    </Routes>,
    { wrapper },
  );
}

beforeEach(() => {
  state.admin = false;
  state.entries = [];
  state.reads = [];
  state.marks = [];
  state.saved = null;
  state.hits = null;
  state.query = '';
});

function card(id: string) {
  return screen.getByTestId(`whats-new-entry-${id}`) as HTMLElement;
}

/** The card's left edge must come from the same class as the other three
 *  sides — no inline left-border override, and certainly not a transparent one. */
function expectFourEqualSides(el: HTMLElement) {
  expect(el.style.borderLeft).toBe('');
  expect(el.style.borderLeftColor).not.toBe('transparent');
  expect(el.style.borderLeftWidth).toBe('');
  expect(el.className).toMatch(/(^|\s)border(\s|$)/);
  expect(el.className).toContain('border-border/70');
}

describe('fix-663: the card edge', () => {
  beforeEach(() => {
    state.entries = [
      e({ id: 'r1', title: 'Old news' }),
      e({ id: 'u1', title: 'Fresh news' }),
    ];
    state.reads = ['r1'];
  });

  it('★★★ a READ card has a visible left border, like its other three sides', () => {
    renderPage();
    const el = card('r1');
    expect(el.dataset.unread).toBe('false');
    expectFourEqualSides(el);
    expect(el.style.boxShadow).toBe('');
  });

  it('★★★ an UNREAD card keeps the 3px blue stripe, drawn inside the border', () => {
    renderPage();
    const el = card('u1');
    expect(el.dataset.unread).toBe('true');
    expect(el.style.boxShadow).toBe('inset 3px 0 0 var(--color-de)');
    // ★ Same border + same padding as a read card, so the text does not shift
    //   sideways when it turns read.
    expectFourEqualSides(el);
    const read = card('r1');
    expect(el.className.replace('bg-de-bg', 'X')).toBe(read.className.replace('bg-surface', 'X'));
  });

  it('★★ hover/focus still turn the WHOLE border blue (no inline left side to beat it)', () => {
    renderPage();
    for (const id of ['r1', 'u1']) {
      const el = card(id);
      expect(el.className).toContain('hover:border-de');
      expect(el.className).toContain('focus-visible:border-de');
      expect(el.style.borderLeft).toBe('');
      expect(el.style.borderColor).toBe('');
    }
  });

  it('★★ search results use the same card and the same edge', () => {
    state.hits = [
      { id: 'r1', rank: 1, snippet: 'Old «news»' },
      { id: 'u1', rank: 0.5, snippet: 'Fresh «news»' },
    ];
    renderPage();
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'news' } });
    const results = screen.getByTestId('whats-new-results');
    const r = results.querySelector('[data-testid="whats-new-entry-r1"]') as HTMLElement;
    const u = results.querySelector('[data-testid="whats-new-entry-u1"]') as HTMLElement;
    expectFourEqualSides(r);
    expectFourEqualSides(u);
    expect(u.style.boxShadow).toBe('inset 3px 0 0 var(--color-de)');
  });
});
