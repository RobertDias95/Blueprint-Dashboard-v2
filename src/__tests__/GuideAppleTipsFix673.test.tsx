import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import SEED from './fixtures/guide_seed.json';
import {
  GUIDE_FILTERS,
  guideClips,
  guideCountLine,
  guideStats,
  highlightRuns,
  highlightWords,
  inGuideFilter,
  sortSections,
  type GuideSection,
} from '../lib/guide';
import { useAuthStore } from '../stores/authStore';
import type { WhatsNewEntry } from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-673 (P-355) — the Guide reads like Apple's Tips
// ===========================================================================
//
// Bobby, 2026-10-14: "maybe you can filter the view a little bit … maybe
// there's a search bar within the guide … It'd be nice if they were all paused
// and then you clicked on one and it expanded it and played it … Think of,
// like, Apple and how they've done their tips."

const TENANT = '11111111-1111-4111-8111-111111111111';
const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const state = vi.hoisted(() => ({
  entries: [] as WhatsNewEntry[],
  reads: [] as string[],
  sections: [] as GuideSection[],
  guideHits: [] as { id: string; slug: string; title: string; rank: number; snippet: string }[],
  guideError: false,
  roles: [] as string[],
}));

vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => false }));
vi.mock('../hooks/useWhatsNew', () => ({
  useWhatsNewEntries: () => ({ data: state.entries, isLoading: false }),
  useWhatsNewReads: () => ({ data: state.reads, isLoading: false }),
  useMarkWhatsNewRead: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useDeleteWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useWhatsNewGuide', () => ({
  useWhatsNewAreas: () => ['Projects'],
  useWhatsNewSearch: (q: string) => {
    const active = q.trim().length >= 2;
    return { data: active ? [] : undefined, active, pending: false, settledQuery: q };
  },
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.roles.length ? 'Someone' : null, roles: state.roles, notes: null, department: null, scope: 'all' },
    userId: 'u1',
    isLoading: false,
  }),
}));
vi.mock('../hooks/useGuide', () => {
  class GuideConflictError extends Error {}
  const mutation = () => () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null });
  return {
    GuideConflictError,
    useGuideSections: () => ({ data: state.sections, isLoading: false }),
    useGuideSearch: (q: string) => {
      const active = q.trim().length >= 2;
      return {
        data: active && !state.guideError ? state.guideHits : undefined,
        isError: active && state.guideError,
        active,
      };
    },
    useSaveGuideSection: mutation(),
    useReorderGuideSections: mutation(),
    useDeleteGuideSection: mutation(),
    useUploadGuideMedia: mutation(),
    useSignedGuideMediaUrl: (p: string | null) => ({ data: p ? `https://signed.example/${p}` : null }),
    removeGuideMedia: async () => undefined,
  };
});

import WhatsNew from '../pages/WhatsNew';

function section(over: Partial<GuideSection>): GuideSection {
  return {
    id: 's1',
    part: 1,
    sort_order: 10,
    slug: 'welcome',
    title: 'Welcome to the Bridge',
    summary: 'What the Bridge is.',
    audience: ['everyone'],
    show_me: null,
    blocks: [{ t: 'p', text: 'The Bridge is **where projects live**.' }],
    reviewed_on: null,
    updated_at: '2026-10-14T00:00:00+00:00',
    ...over,
  };
}

/** The 17-section fixture, its `titles` cards resolved to a fake id. */
function seedSections(): GuideSection[] {
  const raw = SEED as unknown as { sections: (Omit<GuideSection, 'id'> & { blocks: unknown[] })[] };
  return raw.sections.map((s, i) => ({
    ...s,
    id: `seed-${i}`,
    reviewed_on: null,
    blocks: s.blocks.map((b) => ((b as { t: string }).t === 'cards' ? { t: 'cards', ids: [CARD_A] } : b)),
  })) as GuideSection[];
}

const step = (title: string, media: string | null, who: 'tool' | 'you' = 'you') => ({
  t: 'step',
  who,
  title,
  text: `About ${title}.`,
  show_me: null,
  media,
});

/** Three chapters with clips: an everyone one (two clips), a design one (one
 *  video clip), a permitting one (one GIF clip). */
function clipSections(): GuideSection[] {
  return [
    section({
      id: 'c1',
      slug: 'getting-around',
      title: 'Getting around',
      blocks: [step('Search by anything', `${TENANT}/search.mp4`), step('The back button', `${TENANT}/back.gif`, 'tool')],
    }),
    section({
      id: 'c2',
      part: 3,
      slug: 'role-design',
      title: 'Design',
      audience: ['design'],
      blocks: [step('Talk in the chat', `${TENANT}/chat.mp4`), step('Keep your block honest', null)],
    }),
    section({
      id: 'c3',
      part: 3,
      sort_order: 5,
      slug: 'role-permitting',
      title: 'Permitting',
      audience: ['permitting'],
      blocks: [step('Chase what has gone quiet', `${TENANT}/chase.gif`)],
    }),
  ];
}

function renderPage(url = '/whats-new?tab=guide') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/whats-new" element={<WhatsNew />} />
    </Routes>,
    { wrapper },
  );
}

const reading = () => screen.getByTestId('guide-reading');
const shownSlugs = () =>
  [...reading().querySelectorAll('section')].map((s) => s.getAttribute('data-testid')!.replace('guide-section-', ''));
const pressed = () =>
  GUIDE_FILTERS.filter((f) => screen.getByTestId(`guide-filter-${f}`).getAttribute('aria-pressed') === 'true');

const scrolled: string[] = [];
const paused = vi.fn();
beforeEach(() => {
  state.entries = [];
  state.reads = [];
  state.sections = [];
  state.guideHits = [];
  state.guideError = false;
  state.roles = [];
  scrolled.length = 0;
  paused.mockClear();
  window.sessionStorage.clear();
  useAuthStore.setState({ user: null });
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as unknown as Element['scrollIntoView'];
  // jsdom has no media pipeline: play/pause/load are stubs we can watch.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(paused);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('fix-673 §A: the role filter', () => {
  it('★★ the rule: All = every section; Everyone = everybody’s only; a role = its own + everybody’s', () => {
    const everyoneOnly = { audience: ['everyone'] as GuideSection['audience'] };
    const designOnly = { audience: ['design'] as GuideSection['audience'] };
    const shared = { audience: ['everyone', 'permitting'] as GuideSection['audience'] };
    expect([everyoneOnly, designOnly, shared].map((s) => inGuideFilter(s, 'all'))).toEqual([true, true, true]);
    expect([everyoneOnly, designOnly, shared].map((s) => inGuideFilter(s, 'everyone'))).toEqual([true, false, true]);
    expect([everyoneOnly, designOnly, shared].map((s) => inGuideFilter(s, 'design'))).toEqual([true, true, true]);
    expect([everyoneOnly, designOnly, shared].map((s) => inGuideFilter(s, 'acquisitions'))).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('★★★ pills read All · Everyone · Permitting · Design · Acquisitions · Construction Admin · Leadership', () => {
    state.sections = seedSections();
    renderPage();
    const group = screen.getByRole('group', { name: 'Show the guide for' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All',
      'Everyone',
      'Permitting',
      'Design',
      'Acquisitions',
      'Construction Admin',
      'Leadership',
    ]);
  });

  it('★★★ All shows all 17 sections, in guide order', () => {
    state.sections = seedSections();
    renderPage();
    expect(pressed()).toEqual(['all']);
    expect(shownSlugs()).toHaveLength(17);
    expect(shownSlugs()).toEqual(sortSections(state.sections).map((s) => s.slug));
  });

  it('★★★ Design shows `everyone` + `design` sections, in guide order', () => {
    state.sections = seedSections();
    renderPage();
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    const want = sortSections(state.sections)
      .filter((s) => s.audience.includes('everyone') || s.audience.includes('design'))
      .map((s) => s.slug);
    expect(shownSlugs()).toEqual(want);
    expect(shownSlugs()).toContain('role-design');
    expect(shownSlugs()).not.toContain('role-permitting');
    expect(shownSlugs()).toContain('welcome');
  });

  it('★★ Everyone hides every role chapter', () => {
    state.sections = seedSections();
    renderPage();
    fireEvent.click(screen.getByTestId('guide-filter-everyone'));
    expect(shownSlugs().some((s) => s.startsWith('role-'))).toBe(false);
    expect(shownSlugs()).toContain('stage-review');
  });

  it('★★ "You" comes from audiencesForRoles — Jade → Design only, once', () => {
    state.sections = seedSections();
    state.roles = ['da', 'dm', 'schematic'];
    renderPage();
    expect(screen.getAllByText('You')).toHaveLength(1);
    expect(screen.getByTestId('guide-filter-you-design')).toBeInTheDocument();
    // …and the chapter header keeps fix-670's "Your chapter".
    expect(screen.getByTestId('guide-mine-role-design')).toBeInTheDocument();
  });

  it('★★ Lucas (ent + viewer) → Permitting, not Leadership', () => {
    state.sections = seedSections();
    state.roles = ['ent', 'viewer'];
    renderPage();
    expect(screen.getByTestId('guide-filter-you-permitting')).toBeInTheDocument();
    expect(screen.queryByTestId('guide-filter-you-leadership')).toBeNull();
    expect(screen.getAllByText('You')).toHaveLength(1);
  });

  it('★★★ default is All on first open; the session’s pick comes back', () => {
    useAuthStore.setState({ user: { id: 'u1' } as User });
    state.sections = seedSections();
    const first = renderPage();
    expect(pressed()).toEqual(['all']);
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    first.unmount();
    renderPage();
    expect(pressed()).toEqual(['design']);
    // ★ sessionStorage, never localStorage — a new tab opens on All again.
    expect(window.localStorage.length).toBe(0);
  });

  it('★★ a fresh session opens on All whatever was picked before', () => {
    useAuthStore.setState({ user: { id: 'u1' } as User });
    state.sections = seedSections();
    const first = renderPage();
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    first.unmount();
    window.sessionStorage.clear();
    renderPage();
    expect(pressed()).toEqual(['all']);
  });

  it('★★ a deep link to a chapter the stored pick hides opens on All', () => {
    useAuthStore.setState({ user: { id: 'u1' } as User });
    state.sections = seedSections();
    const first = renderPage();
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    first.unmount();
    renderPage('/whats-new?tab=guide&s=role-permitting');
    expect(pressed()).toEqual(['all']);
    expect(scrolled).toContain('guide-section-role-permitting');
  });

  it('★★ the count line follows the filter', () => {
    state.sections = seedSections();
    renderPage();
    const all = guideStats(state.sections);
    expect(screen.getByTestId('guide-count').textContent).toBe(guideCountLine(all));
    expect(screen.getByTestId('guide-count').textContent).toMatch(/^17 chapters · \d+ steps · 0 clips$/);
    fireEvent.click(screen.getByTestId('guide-filter-everyone'));
    const ev = guideStats(state.sections.filter((s) => inGuideFilter(s, 'everyone')));
    expect(screen.getByTestId('guide-count').textContent).toBe(guideCountLine(ev));
  });

  it('★ the count line words', () => {
    expect(guideCountLine({ chapters: 13, steps: 44, clips: 10 })).toBe('13 chapters · 44 steps · 10 clips');
    expect(guideCountLine({ chapters: 1, steps: 1, clips: 1 })).toBe('1 chapter · 1 step · 1 clip');
    expect(guideCountLine({ chapters: 4, steps: 9, clips: 2 }, 'resubmit')).toBe('4 chapters match “resubmit”');
    expect(guideCountLine({ chapters: 1, steps: 9, clips: 2 }, 'resubmit')).toBe('1 chapter matches “resubmit”');
  });
});

// ---------------------------------------------------------------------------
describe('fix-673 §C: the part covers', () => {
  it('★★ a cover click scrolls to its part', () => {
    state.sections = seedSections();
    renderPage();
    expect(within(screen.getByTestId('guide-cover-2')).getByText('How a project moves')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('guide-cover-3'));
    expect(scrolled).toContain('guide-part-3');
  });

  it('★★ a part with nothing left in the filter has no cover and no heading', () => {
    state.sections = seedSections();
    renderPage();
    expect(screen.getByTestId('guide-cover-3')).toBeInTheDocument();
    // Part 3 is all role chapters — Everyone empties it.
    fireEvent.click(screen.getByTestId('guide-filter-everyone'));
    expect(screen.queryByTestId('guide-cover-3')).toBeNull();
    expect(screen.queryByTestId('guide-part-3')).toBeNull();
    expect(screen.getByTestId('guide-cover-1')).toBeInTheDocument();
  });

  it('★ the cover counts chapters in the filter', () => {
    state.sections = seedSections();
    renderPage();
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    expect(screen.getByTestId('guide-cover-3').textContent).toContain('1 chapter');
  });

  it('★ the header reads like the mockup', () => {
    state.sections = seedSections();
    renderPage();
    expect(screen.getByTestId('guide-heading').textContent).toBe('The Bridge Guide');
    expect(screen.getByText('What’s New · Guide')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('fix-673 §B: the Guide’s own search', () => {
  const hit = (s: GuideSection, snippet: string) => ({ id: s.id, slug: s.slug, title: s.title, rank: 1, snippet });

  it('★★★ the top search box is ABSENT on the Guide tab and PRESENT on Latest and Browse', () => {
    state.sections = seedSections();
    renderPage();
    expect(screen.getByTestId('guide-search')).toBeInTheDocument();
    expect(screen.getByTestId('guide-search').getAttribute('placeholder')).toBe('Search the guide');
    expect(screen.queryByTestId('whats-new-search')).toBeNull();
    fireEvent.click(screen.getByTestId('whats-new-tab-latest'));
    expect(screen.getByTestId('whats-new-search')).toBeInTheDocument();
    expect(screen.queryByTestId('guide-search')).toBeNull();
    fireEvent.click(screen.getByTestId('whats-new-tab-browse'));
    expect(screen.getByTestId('whats-new-search')).toBeInTheDocument();
  });

  it('★★★ it searches the guide only, inside the role filter, in guide order', () => {
    const seed = seedSections();
    state.sections = seed;
    const by = (slug: string) => seed.find((s) => s.slug === slug)!;
    // Ranked the "wrong" way round on purpose — the page shows guide order.
    state.guideHits = [
      hit(by('role-permitting'), 'keep the «Resubmit» by date'),
      hit(by('stage-review'), '«Resubmit» by'),
      hit(by('role-design'), 'keep the «Resubmit» by date'),
    ];
    renderPage();
    fireEvent.change(screen.getByTestId('guide-search'), { target: { value: 'resubmit' } });
    expect(shownSlugs()).toEqual(['stage-review', 'role-permitting', 'role-design']);
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    expect(shownSlugs()).toEqual(['stage-review', 'role-design']);
    expect(screen.getByTestId('guide-count').textContent).toBe('2 chapters match “resubmit”');
  });

  it('★★ matched words are <mark>ed — including the REAL word behind a typo', () => {
    const seed = seedSections();
    state.sections = seed;
    const review = seed.find((s) => s.slug === 'stage-review')!;
    state.guideHits = [hit(review, 'the «Resubmit» by date')];
    renderPage();
    fireEvent.change(screen.getByTestId('guide-search'), { target: { value: 'resubmitt' } });
    const marks = [...screen.getByTestId('guide-section-stage-review').querySelectorAll('mark')].map((m) =>
      m.textContent!.toLowerCase(),
    );
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks)).toEqual(new Set(['resubmit']));
  });

  it('★★★ <script> renders as text, inside a <mark>', () => {
    state.sections = [section({ blocks: [{ t: 'p', text: 'Never <script>alert(1)</script> here.' }] })];
    state.guideHits = [{ id: 's1', slug: 'welcome', title: 'Welcome', rank: 1, snippet: '«<script>»' }];
    renderPage();
    fireEvent.change(screen.getByTestId('guide-search'), { target: { value: '<script>' } });
    const sec = screen.getByTestId('guide-section-welcome');
    expect(sec.querySelector('script')).toBeNull();
    expect([...sec.querySelectorAll('mark')].map((m) => m.textContent)).toContain('<script>');
    expect(sec.textContent).toContain('Never <script>alert(1)</script> here.');
  });

  it('★★ ✕ clears it and the whole filter comes back', () => {
    const seed = seedSections();
    state.sections = seed;
    state.guideHits = [hit(seed.find((s) => s.slug === 'stage-review')!, '«Resubmit»')];
    renderPage();
    fireEvent.change(screen.getByTestId('guide-search'), { target: { value: 'resubmit' } });
    expect(shownSlugs()).toEqual(['stage-review']);
    fireEvent.click(screen.getByTestId('guide-search-clear'));
    expect((screen.getByTestId('guide-search') as HTMLInputElement).value).toBe('');
    expect(shownSlugs()).toHaveLength(17);
    expect(screen.queryByTestId('guide-search-clear')).toBeNull();
    expect(reading().querySelector('mark')).toBeNull();
  });

  it('★★ nothing found says so, in the brief’s words', () => {
    state.sections = seedSections();
    state.guideHits = [];
    renderPage();
    fireEvent.change(screen.getByTestId('guide-search'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('guide-no-match').textContent).toBe(
      'Nothing in the guide matches that. Try a shorter word, or switch to All.',
    );
    expect(screen.queryByTestId('guide-covers')).toBeNull();
  });

  it('★ a failing search says so and does not pretend nothing matched', () => {
    state.sections = seedSections();
    state.guideError = true;
    renderPage();
    fireEvent.change(screen.getByTestId('guide-search'), { target: { value: 'resubmit' } });
    expect(screen.getByTestId('guide-search-error')).toBeInTheDocument();
    expect(screen.queryByTestId('guide-no-match')).toBeNull();
  });

  it('★ highlight helpers: « » words + typed words; longest first; case kept', () => {
    expect(highlightWords(['a «Corrections» b', '«two words»'], 'corectons x')).toEqual([
      'corrections',
      'two',
      'words',
      'corectons',
    ]);
    expect(highlightRuns('Resubmittal or resubmit', ['resubmit', 'resubmittal'])).toEqual([
      { text: 'Resubmittal', mark: true },
      { text: ' or ', mark: false },
      { text: 'resubmit', mark: true },
    ]);
    expect(highlightRuns('a+b (c)', ['(c)'])).toEqual([
      { text: 'a+b ', mark: false },
      { text: '(c)', mark: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-673 §C: steps are cards', () => {
  it('★★ one clip in a chapter spans both columns; several share the row', () => {
    state.sections = clipSections();
    renderPage();
    // getting-around has two clips → each spans one column.
    expect(screen.getByTestId('guide-step-getting-around-0').dataset.wide).toBe('false');
    expect(screen.getByTestId('guide-step-getting-around-1').dataset.wide).toBe('false');
    // role-design has one → it spans both.
    expect(screen.getByTestId('guide-step-role-design-0').dataset.wide).toBe('true');
    expect(screen.getByTestId('guide-step-role-design-1').dataset.wide).toBe('false');
  });

  it('★ the tag is in words; the still sits above the card body', () => {
    state.sections = clipSections();
    renderPage();
    const card = screen.getByTestId('guide-step-getting-around-1');
    expect(within(card).getByTestId('guide-who-tool').textContent).toBe('THE BRIDGE');
    expect(card.firstElementChild!.getAttribute('aria-label')).toBe('Play: The back button');
  });
});

// ---------------------------------------------------------------------------
describe('fix-673 §D: clips stay still until clicked', () => {
  it('★★★ no <video autoplay> and no animating <img> in any card', () => {
    state.sections = clipSections();
    renderPage();
    const videos = [...reading().querySelectorAll('video')];
    expect(videos.length).toBe(2);
    for (const v of videos) {
      expect(v.autoplay).toBe(false);
      expect(v.hasAttribute('autoplay')).toBe(false);
      expect(v.getAttribute('preload')).toBe('metadata');
      expect(v.getAttribute('src')).toMatch(/#t=0\.1$/);
    }
    expect(reading().querySelectorAll('img')).toHaveLength(0);
    // Each still is ONE keyboard-focusable button with a play label.
    const stills = within(reading()).getAllByRole('button', { name: /^Play: / });
    expect(stills).toHaveLength(4);
    for (const b of stills) expect(within(b).getByText('Watch')).toBeInTheDocument();
  });

  it('★★★ a GIF step renders a canvas still, drawn once from the signed URL', async () => {
    const drawn: string[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 640;
      naturalHeight = 320;
      decoding = '';
      set src(v: string) {
        drawn.push(v);
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
    );
    state.sections = [clipSections()[2]!];
    renderPage();
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    expect(drawn).toEqual([`https://signed.example/${TENANT}/chase.gif`]);
    const still = screen.getByRole('button', { name: 'Play: Chase what has gone quiet' });
    const canvas = still.querySelector('canvas')!;
    expect(canvas.width).toBe(640);
    expect(still.querySelector('img')).toBeNull();
  });

  it('★★ when the canvas cannot draw, the <img> shows under the Watch pill', async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 640;
      naturalHeight = 320;
      decoding = '';
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    state.sections = [clipSections()[2]!];
    renderPage();
    const fallback = (await screen.findByTestId('guide-clip-fallback')) as HTMLImageElement;
    expect(fallback.src).toBe(`https://signed.example/${TENANT}/chase.gif`);
    const still = screen.getByRole('button', { name: 'Play: Chase what has gone quiet' });
    expect(still.querySelector('canvas')).toBeNull();
    expect(within(still).getByTestId('guide-clip-watch').textContent).toBe('Watch');
  });

  it('★★ an image that will not load falls back the same way', async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      decoding = '';
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    state.sections = [clipSections()[2]!];
    renderPage();
    expect(await screen.findByTestId('guide-clip-fallback')).toBeInTheDocument();
  });

  it('★★★ clicking a still opens the viewer with THAT clip, large and playing', () => {
    state.sections = clipSections();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Play: Talk in the chat' }));
    const viewer = screen.getByTestId('guide-viewer');
    expect(viewer.getAttribute('role')).toBe('dialog');
    expect(screen.getByTestId('guide-viewer-title').textContent).toBe('Talk in the chat');
    const v = screen.getByTestId('guide-viewer-video') as HTMLVideoElement;
    expect(v.getAttribute('src')).toBe(`https://signed.example/${TENANT}/chat.mp4`);
    expect(v.loop).toBe(true);
    expect(v.controls).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    // Guide order: getting-around (2 clips), role-permitting (sort 5), role-design.
    expect(screen.getByTestId('guide-viewer-count').textContent).toBe('Design · clip 4 of 4');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByTestId('guide-viewer-close'));
  });

  it('★★★ Next / Previous wrap within the FILTERED clips', () => {
    state.sections = clipSections();
    renderPage();
    fireEvent.click(screen.getByTestId('guide-filter-design'));
    // Design hides role-permitting: 3 clips.
    expect(guideClips(state.sections.filter((s) => inGuideFilter(s, 'design')))).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Play: Search by anything' }));
    expect(screen.getByTestId('guide-viewer-count').textContent).toBe('Getting around · clip 1 of 3');
    fireEvent.click(screen.getByTestId('guide-viewer-prev'));
    expect(screen.getByTestId('guide-viewer-title').textContent).toBe('Talk in the chat');
    expect(screen.getByTestId('guide-viewer-count').textContent).toBe('Design · clip 3 of 3');
    fireEvent.click(screen.getByTestId('guide-viewer-next'));
    expect(screen.getByTestId('guide-viewer-title').textContent).toBe('Search by anything');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByTestId('guide-viewer-title').textContent).toBe('The back button');
    expect(screen.getByTestId('guide-viewer-img').getAttribute('src')).toBe(`https://signed.example/${TENANT}/back.gif`);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByTestId('guide-viewer-title').textContent).toBe('Search by anything');
  });

  it('★★★ Esc closes, focus returns to the still, the video pauses and unloads', () => {
    state.sections = clipSections();
    renderPage();
    const still = screen.getByRole('button', { name: 'Play: Search by anything' });
    still.focus();
    fireEvent.click(still);
    const v = screen.getByTestId('guide-viewer-video') as HTMLVideoElement;
    expect(paused).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('guide-viewer')).toBeNull();
    expect(paused).toHaveBeenCalled();
    expect(v.hasAttribute('src')).toBe(false);
    expect(document.activeElement).toBe(still);
    expect(document.body.style.overflow).toBe('');
  });

  it('★★ Close ✕ and a click on the backdrop close it; a click on the clip does not', () => {
    state.sections = clipSections();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Play: Search by anything' }));
    fireEvent.mouseDown(screen.getByTestId('guide-viewer-video'));
    expect(screen.getByTestId('guide-viewer')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('guide-viewer'));
    expect(screen.queryByTestId('guide-viewer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play: Search by anything' }));
    fireEvent.click(screen.getByTestId('guide-viewer-close'));
    expect(screen.queryByTestId('guide-viewer')).toBeNull();
  });

  it('★ clips are counted in the line under the pills', () => {
    state.sections = clipSections();
    renderPage();
    expect(screen.getByTestId('guide-count').textContent).toBe('3 chapters · 5 steps · 4 clips');
  });
});

// ---------------------------------------------------------------------------
describe('fix-673 §E: the editor still takes every clip type', () => {
  it('★ gif/png/jpeg/webp/mp4/webm are still accepted', async () => {
    const { refuseGuideMedia } = await import('../lib/guide');
    for (const type of ['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']) {
      expect(refuseGuideMedia({ name: 'x', type, size: 10 })).toBeNull();
    }
  });
});
