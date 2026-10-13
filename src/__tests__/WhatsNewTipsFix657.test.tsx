import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import MIGRATION from '../../migrations/fix_657_whats_new_tips.sql?raw';
import {
  DEFAULT_WHATS_NEW_AREAS,
  areaCounts,
  areaSlug,
  cardSummary,
  howToSteps,
  inArea,
  isSafeMediaUrl,
  mediaKind,
  relatedEntries,
  snippetParts,
  type WhatsNewEntry,
} from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-657 (P-342) — What's New becomes a Tips-style guide
// ===========================================================================
//
// Bobby, 2026-10-12: "a highlevel summary of what the TIP is, then you click it
// for more info, and details of how to use it if so. think of apples tip app"
// … "a categorical function to this, and a smart search … the words do not
// need to be 1:1".

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

// ---------------------------------------------------------------------------
describe('fix-657: what a card says', () => {
  it('★★ the written summary wins; otherwise the first sentence of the details', () => {
    expect(cardSummary({ summary: 'One line.', body: 'Long body. More.' })).toBe('One line.');
    expect(cardSummary({ summary: null, body: 'First sentence here. Second one.' })).toBe(
      'First sentence here.',
    );
    expect(cardSummary({ summary: '   ', body: 'Only this' })).toBe('Only this');
  });

  it('★ "7 a.m. on weekdays" is not cut at the abbreviation', () => {
    expect(cardSummary({ summary: null, body: 'At 7 a.m. on weekdays it emails you. Then more.' })).toBe(
      'At 7 a.m. on weekdays it emails you.',
    );
  });

  it('★ a very long first sentence is cut at a word, with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end.`;
    const s = cardSummary({ summary: null, body: long });
    expect(s.length).toBeLessThanOrEqual(158);
    expect(s.endsWith('…')).toBe(true);
    expect(s).not.toMatch(/wor…$/);
  });

  it('★★ the card renders the fallback, and NOTHING is written back', () => {
    state.entries = [e({ id: 'a', body: 'Short first. Longer second sentence.' })];
    renderPage();
    expect(screen.getByTestId('whats-new-summary-a').textContent).toBe('Short first.');
    expect(state.saved).toBeNull();
  });
});

describe('fix-657: how-to steps', () => {
  it('★ one step per line; hand numbering and bullets are stripped; blanks dropped', () => {
    expect(howToSteps('1. Open a project\n2) Click Site Data\n\n- Click Drone footage\n• Done')).toEqual([
      'Open a project',
      'Click Site Data',
      'Click Drone footage',
      'Done',
    ]);
    expect(howToSteps(null)).toEqual([]);
  });
});

describe('fix-657: areas', () => {
  const areas = ['Projects', 'Email'];

  it('★★ counts per area in the list order, plus "Not yet sorted" for the rest', () => {
    const list = [e({ area: 'Email' }), e({ area: 'Email' }), e({ area: null }), e({ area: 'Gone' })];
    expect(areaCounts(list, areas)).toEqual([
      { area: 'Projects', count: 0 },
      { area: 'Email', count: 2 },
      { area: null, count: 2 },
    ]);
    expect(inArea(e({ area: 'Gone' }), null, areas)).toBe(true);
    expect(inArea(e({ area: 'Email' }), 'Email', areas)).toBe(true);
  });

  it('★ the default list is the seeded one, in the same order', () => {
    const seeded = /'(\[[^']*\])'::jsonb/.exec(MIGRATION)?.[1] ?? '[]';
    expect(JSON.parse(seeded)).toEqual([...DEFAULT_WHATS_NEW_AREAS]);
    expect(areaSlug('Permits & Reviews')).toBe('permits-reviews');
    expect(areaSlug(null)).toBe('unsorted');
  });

  it('★ related = same area, newest first, never itself, at most 3; no area → none', () => {
    const all = [
      e({ id: 'x', area: 'Email', published_on: '2026-10-01' }),
      e({ id: 'y', area: 'Email', published_on: '2026-10-05' }),
      e({ id: 'z', area: 'Email', published_on: '2026-10-03' }),
      e({ id: 'w', area: 'Email', published_on: '2026-09-01' }),
      e({ id: 'p', area: 'Projects' }),
    ];
    expect(relatedEntries(all[0]!, all).map((r) => r.id)).toEqual(['y', 'z', 'w']);
    expect(relatedEntries(e({ area: null }), all)).toEqual([]);
  });
});

describe('fix-657: media and snippets are never HTML', () => {
  it('★★ media must be https or an app path', () => {
    expect(isSafeMediaUrl('https://x.test/a.gif')).toBe(true);
    expect(isSafeMediaUrl('/help/a.png')).toBe(true);
    for (const bad of ['http://x.test/a.png', '//evil.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,xx']) {
      expect(isSafeMediaUrl(bad)).toBe(false);
    }
    expect(mediaKind('https://x/a.mp4')).toBe('video');
    expect(mediaKind('https://x/a.gif')).toBe('image');
  });

  it('★ « » become marked runs; everything else is plain text', () => {
    expect(snippetParts('the «drone» footage <b>x</b>')).toEqual([
      { text: 'the ', mark: false },
      { text: 'drone', mark: true },
      { text: ' footage <b>x</b>', mark: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-657: the detail panel', () => {
  it('★★★ opens on a click only, and shows each section only when it has content', () => {
    state.entries = [e({ id: 'a', title: 'Bare', area: null })];
    renderPage();
    expect(screen.queryByTestId('whats-new-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    const d = screen.getByTestId('whats-new-detail');
    expect(within(d).getByTestId('whats-new-detail-body')).toBeInTheDocument();
    expect(within(d).queryByTestId('whats-new-detail-summary')).toBeNull();
    expect(within(d).queryByTestId('whats-new-how-a')).toBeNull();
    expect(within(d).queryByTestId('whats-new-go-a')).toBeNull();
    expect(within(d).queryByTestId('whats-new-media-a')).toBeNull();
    expect(within(d).queryByTestId('whats-new-related')).toBeNull();
  });

  it('★★★ a full entry shows summary, numbered how-to, Show me, media and related', () => {
    state.entries = [
      e({
        id: 'a',
        title: 'Map and drone footage links in Site Data',
        summary: 'Open the map or the drone folder from Site Data.',
        how_to: 'Open a project.\nClick Drone footage.',
        go_href: '/project/p1',
        media_url: 'https://x.test/drone.gif',
        area: 'Project Overview',
      }),
      e({ id: 'b', title: 'Sibling', area: 'Project Overview', published_on: '2026-10-01' }),
    ];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    const d = screen.getByTestId('whats-new-detail');
    expect(within(d).getByTestId('whats-new-detail-summary').textContent).toBe(
      'Open the map or the drone folder from Site Data.',
    );
    expect(within(d).getByTestId('whats-new-how-a').querySelectorAll('li')).toHaveLength(2);
    expect(within(d).getByTestId('whats-new-media-a').querySelector('img')?.getAttribute('src')).toBe(
      'https://x.test/drone.gif',
    );
    expect(within(d).getByTestId('whats-new-related-b')).toBeInTheDocument();
    // ★ Show me navigates in-app.
    fireEvent.click(within(d).getByTestId('whats-new-go-a'));
    expect(screen.getByTestId('stub-project')).toBeInTheDocument();
  });

  it('★★ an unsafe media URL renders nothing', () => {
    state.entries = [e({ id: 'a', media_url: 'javascript:alert(1)' })];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    expect(screen.queryByTestId('whats-new-media-a')).toBeNull();
  });

  it('★★★ opening marks that entry read and clears its dot — the others keep theirs', () => {
    state.entries = [e({ id: 'a' }), e({ id: 'b', title: 'Other' })];
    const view = renderPage();
    expect(screen.getByTestId('whats-new-dot-a')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    expect(state.marks).toEqual([['a']]);
    // The landed read row re-renders the page, as the real invalidation would.
    view.rerender(<Routes><Route path="/whats-new" element={<WhatsNew />} /></Routes>);
    expect(screen.queryByTestId('whats-new-dot-a')).toBeNull();
    expect(screen.getByTestId('whats-new-dot-b')).toBeInTheDocument();
  });

  it('★ an already-read entry is not marked again', () => {
    state.entries = [e({ id: 'a' })];
    state.reads = ['a'];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    expect(state.marks).toEqual([]);
  });

  it('★ Escape and Close both close it', () => {
    state.entries = [e({ id: 'a' })];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('whats-new-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('whats-new-entry-a'));
    fireEvent.click(screen.getByTestId('whats-new-detail-close'));
    expect(screen.queryByTestId('whats-new-detail')).toBeNull();
  });

  it('★ the card opens from the keyboard too', () => {
    state.entries = [e({ id: 'a' })];
    renderPage();
    fireEvent.keyDown(screen.getByTestId('whats-new-entry-a'), { key: 'Enter' });
    expect(screen.getByTestId('whats-new-detail')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('fix-657: Browse by area', () => {
  beforeEach(() => {
    state.entries = [
      e({ id: 'm1', area: 'Email', kind: 'new', title: 'Email a plan as a PDF' }),
      e({ id: 'm2', area: 'Email', kind: 'tip', title: 'Tag and task emails are off for now' }),
      e({ id: 'p1', area: 'Projects', kind: 'improved', title: 'Deleted projects can be restored' }),
      e({ id: 'u1', area: null, kind: 'new', title: 'Unsorted one' }),
    ];
  });

  it('★★ one tile per area with its count, plus "Not yet sorted"', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-tab-browse'));
    expect(screen.getByTestId('whats-new-area-count-email').textContent).toBe('2 entries');
    expect(screen.getByTestId('whats-new-area-count-projects').textContent).toBe('1 entry');
    expect(screen.getByTestId('whats-new-area-count-library').textContent).toBe('0 entries');
    expect(screen.getByTestId('whats-new-area-count-unsorted').textContent).toBe('1 entry');
  });

  it('★★ clicking a tile shows that area’s cards; the kind chips still apply', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-tab-browse'));
    fireEvent.click(screen.getByTestId('whats-new-area-tile-email'));
    expect(screen.getByTestId('whats-new-entry-m1')).toBeInTheDocument();
    expect(screen.getByTestId('whats-new-entry-m2')).toBeInTheDocument();
    expect(screen.queryByTestId('whats-new-entry-p1')).toBeNull();
    fireEvent.click(screen.getByTestId('whats-new-filter-tip'));
    expect(screen.queryByTestId('whats-new-entry-m1')).toBeNull();
    expect(screen.getByTestId('whats-new-entry-m2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('whats-new-area-back'));
    expect(screen.getByTestId('whats-new-area-tiles')).toBeInTheDocument();
  });

  it('★ Latest keeps the date groups — "know what has recently dropped"', () => {
    renderPage();
    expect(screen.getByTestId('whats-new-day-2026-10-12')).toBeInTheDocument();
    expect(screen.getByTestId('whats-new-tab-latest').getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
describe('fix-657: search', () => {
  beforeEach(() => {
    state.entries = [
      e({ id: 'm1', area: 'Email', title: 'Email a plan as a PDF' }),
      e({ id: 'p1', area: 'Projects', title: 'Deleted projects can be restored', kind: 'improved' }),
    ];
  });

  it('★★ results come back in rank order with the highlighted snippet', () => {
    state.hits = [
      { id: 'p1', rank: 1.6, snippet: '«Deleting» a «project» no longer erases it.' },
      { id: 'm1', rank: 0.5, snippet: 'The share menu…' },
    ];
    renderPage();
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'restore deleted project' } });
    const results = screen.getByTestId('whats-new-results');
    const ids = [...results.querySelectorAll('[data-testid^="whats-new-entry-"]')].map((n) =>
      n.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['whats-new-entry-p1', 'whats-new-entry-m1']);
    const marks = screen.getByTestId('whats-new-summary-p1').querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['Deleting', 'project']);
  });

  it('★★ the kind chip filters search results too', () => {
    state.hits = [
      { id: 'p1', rank: 1.6, snippet: 'x' },
      { id: 'm1', rank: 0.5, snippet: 'y' },
    ];
    renderPage();
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'project' } });
    fireEvent.click(screen.getByTestId('whats-new-filter-improved'));
    expect(screen.getByTestId('whats-new-entry-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('whats-new-entry-m1')).toBeNull();
  });

  it('★★★ no match says so, and offers the area tiles', () => {
    state.hits = [];
    renderPage();
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'asdfgh' } });
    const nm = screen.getByTestId('whats-new-no-match');
    expect(nm.textContent).toContain('No match — try another word');
    fireEvent.click(within(nm).getByTestId('whats-new-area-tile-email'));
    expect((screen.getByTestId('whats-new-search') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('whats-new-entry-m1')).toBeInTheDocument();
  });

  it('★ it works from the Browse tab as well', () => {
    state.hits = [{ id: 'm1', rank: 1, snippet: 'email' }];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-tab-browse'));
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'email' } });
    expect(screen.getByTestId('whats-new-entry-m1')).toBeInTheDocument();
    expect(screen.queryByTestId('whats-new-area-tiles')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fix-657: the admin editor gains the new fields', () => {
  it('★★★ saves summary, area, keywords and media alongside the rest', () => {
    state.admin = true;
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-add'));
    fireEvent.change(screen.getByTestId('whats-new-editor-title'), { target: { value: 'Email a plan as a PDF' } });
    fireEvent.change(screen.getByTestId('whats-new-editor-body'), { target: { value: 'The share menu offers Email PDF.' } });
    fireEvent.change(screen.getByTestId('whats-new-editor-summary'), { target: { value: 'Send a plan from its card.' } });
    expect(screen.getByTestId('whats-new-editor-summary-count').textContent).toBe('26/120');
    fireEvent.change(screen.getByTestId('whats-new-editor-area'), { target: { value: 'Email' } });
    const kw = screen.getByTestId('whats-new-editor-keywords');
    fireEvent.change(kw, { target: { value: 'send' } });
    fireEvent.keyDown(kw, { key: 'Enter' });
    fireEvent.change(kw, { target: { value: 'outlook,attach,' } });
    expect(screen.getByTestId('whats-new-editor-keyword-send')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('whats-new-editor-media'), { target: { value: 'https://x.test/a.gif' } });
    fireEvent.click(screen.getByTestId('whats-new-editor-save'));
    expect(state.saved).toMatchObject({
      summary: 'Send a plan from its card.',
      area: 'Email',
      keywords: ['send', 'outlook', 'attach'],
      media_url: 'https://x.test/a.gif',
    });
  });

  it('★★ an unsafe media URL blocks Save and says why', () => {
    state.admin = true;
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-add'));
    fireEvent.change(screen.getByTestId('whats-new-editor-title'), { target: { value: 'T' } });
    fireEvent.change(screen.getByTestId('whats-new-editor-body'), { target: { value: 'B' } });
    fireEvent.change(screen.getByTestId('whats-new-editor-media'), { target: { value: '//evil.com/a.gif' } });
    expect(screen.getByTestId('whats-new-editor-media-error')).toBeInTheDocument();
    expect((screen.getByTestId('whats-new-editor-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('★ a summary over the target turns the counter to a warning but still saves', () => {
    state.admin = true;
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-add'));
    fireEvent.change(screen.getByTestId('whats-new-editor-title'), { target: { value: 'T' } });
    fireEvent.change(screen.getByTestId('whats-new-editor-body'), { target: { value: 'B' } });
    fireEvent.change(screen.getByTestId('whats-new-editor-summary'), { target: { value: 'x'.repeat(130) } });
    expect(screen.getByTestId('whats-new-editor-summary-count').className).toContain('text-wa');
    expect((screen.getByTestId('whats-new-editor-save') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The migration — read as text (no live DB in CI; the ranking was measured on
// prod in a rolled-back transaction, recorded in the PR).
// ---------------------------------------------------------------------------
const SQL = MIGRATION.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');

describe('fix-657: the migration', () => {
  it('★★★ four NULLABLE columns, no defaults — no existing row changes', () => {
    for (const col of ['summary text', 'area text', 'keywords text[]', 'media_url text']) {
      expect(SQL).toContain(`ADD COLUMN IF NOT EXISTS ${col.split(' ')[0]}`);
    }
    expect(SQL).not.toMatch(/ADD COLUMN[^;\n]*(DEFAULT|NOT NULL)/i);
    expect(SQL).not.toMatch(/UPDATE\s+public\.whats_new_entries/i);
    expect(SQL).not.toMatch(/DELETE\s+FROM/i);
  });

  it('★★ the only data write is the area list, once, never overwriting', () => {
    const inserts = SQL.match(/INSERT INTO\s+public\.(\w+)/gi) ?? [];
    expect(inserts).toEqual(['INSERT INTO public.app_config']);
    expect(SQL).toMatch(/'whatsNewAreas'/);
    expect(SQL).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    expect(SQL).toMatch(/tenant_id/);
  });

  it('★★★ the search reads through the caller’s RLS, and anon cannot call it', () => {
    expect(SQL).toMatch(/SECURITY INVOKER/);
    expect(SQL).not.toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.bp_search_whats_new\(text\) FROM PUBLIC, anon/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.bp_search_whats_new\(text\) TO authenticated/);
  });

  it('★★ the ranking: weighted full text + trigram typos + keywords as synonyms', () => {
    expect(SQL).toMatch(/setweight\(to_tsvector\('english', e\.title\), 'A'\)/);
    expect(SQL).toMatch(/array_to_string\(e\.keywords, ' '\), ''\)\), 'B'\)/);
    expect(SQL).toMatch(/e\.how_to, ''\)\), 'C'\)/);
    expect(SQL).toMatch(/e\.body\), 'D'\)/);
    expect(SQL).toMatch(/extensions\.word_similarity/);
    // Keywords sit in the "head" text the trigram scores like the title.
    expect(SQL).toMatch(/coalesce\(array_to_string\(e\.keywords, ' '\), ''\)\) AS head/);
    // Matches are marked with « » for the page, never with HTML.
    expect(SQL).toMatch(/StartSel=«, StopSel=»/);
  });

  it('★ media_url and summary are constrained in the database too', () => {
    expect(SQL).toMatch(/whats_new_entries_media_url_safe/);
    expect(SQL).toMatch(/whats_new_entries_summary_one_line/);
  });
});
