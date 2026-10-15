import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import MIGRATION from '../../migrations/fix_670_guide_sections.sql?raw';
import SEED from './fixtures/guide_seed.json';
import {
  GUIDE_AUDIENCES,
  audiencesForRoles,
  boldRuns,
  guideHref,
  isGuideMediaPath,
  isYourChapter,
  moveSection,
  parseBlocks,
  sortSections,
  tableToText,
  textToTable,
  type GuideBlock,
  type GuideSection,
} from '../lib/guide';
import { isAppPath, type WhatsNewEntry } from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-670 (P-056) — the training guide lives in What's New → Guide
// ===========================================================================
//
// Bobby, 2026-10-14: "i want the training guide to be a live document in the
// bridge … a complete guide for any new hires in any role so they can see
// their roles, their responsibilities."

const TENANT = '11111111-1111-4111-8111-111111111111';
const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD_GONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const state = vi.hoisted(() => ({
  admin: false,
  entries: [] as WhatsNewEntry[],
  reads: [] as string[],
  marks: [] as string[][],
  hits: null as null | { id: string; rank: number; snippet: string }[],
  sections: [] as GuideSection[],
  guideHits: [] as { id: string; slug: string; title: string; rank: number; snippet: string }[],
  guideError: false,
  roles: [] as string[],
  saved: null as Record<string, unknown> | null,
  reordered: null as null | { id: string; part: number; sort_order: number }[],
  uploadPath: '',
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
      state.reads = [...state.reads, ...ids];
    },
    isPending: false,
  }),
  useUpsertWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useDeleteWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useWhatsNewGuide', () => ({
  useWhatsNewAreas: () => ['Projects', 'Corrections'],
  useWhatsNewSearch: (q: string) => {
    const active = q.trim().length >= 2;
    return { data: active ? state.hits ?? [] : undefined, active, pending: false, settledQuery: q };
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
  const mutation = (onCall: (v: unknown) => unknown) => () => ({
    mutate: (v: unknown, o?: { onSuccess?: (r: unknown) => void }) => {
      const r = onCall(v);
      o?.onSuccess?.(r);
    },
    isPending: false,
    isError: false,
    error: null,
  });
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
    useSaveGuideSection: mutation((v) => {
      state.saved = v as Record<string, unknown>;
    }),
    useReorderGuideSections: mutation((v) => {
      state.reordered = v as { id: string; part: number; sort_order: number }[];
    }),
    useDeleteGuideSection: mutation(() => undefined),
    useUploadGuideMedia: mutation(() => state.uploadPath),
    useSignedGuideMediaUrl: (p: string | null) => ({ data: p ? `https://signed.example/${p}` : null }),
    removeGuideMedia: async () => undefined,
  };
});

import WhatsNew from '../pages/WhatsNew';

function entry(over: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: CARD_A,
    published_on: '2026-10-12',
    kind: 'tip',
    title: 'Resubmit-by date on every correction round',
    body: 'Every correction round shows when it is due back. More.',
    sort_order: 0,
    go_href: null,
    how_to: null,
    summary: null,
    area: 'Corrections',
    keywords: null,
    media_url: null,
    ...over,
  };
}

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

/** The 17-section fixture, as Cowork will insert it: card titles resolve to
 *  ids at insert time, so the fixture's `titles` blocks get a fake id here. */
function seedSections(): GuideSection[] {
  const raw = SEED as unknown as { sections: (Omit<GuideSection, 'id'> & { blocks: unknown[] })[] };
  return raw.sections.map((s, i) => ({
    ...s,
    id: `seed-${i}`,
    reviewed_on: null,
    blocks: s.blocks.map((b) => {
      const bb = b as { t: string };
      return bb.t === 'cards' ? { t: 'cards', ids: [CARD_A] } : b;
    }),
  })) as GuideSection[];
}

function OriginEcho() {
  const loc = useLocation();
  const navigate = useNavigate();
  const from = (loc.state as { from?: string } | null)?.from ?? '';
  return (
    <div>
      <div data-testid="stub-origin">{from}</div>
      <button type="button" data-testid="stub-previous" onClick={() => navigate(from)}>
        ← Previous
      </button>
    </div>
  );
}

function renderPage(url = '/whats-new') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/whats-new" element={<WhatsNew />} />
      <Route path="*" element={<OriginEcho />} />
    </Routes>,
    { wrapper },
  );
}

const scrolled: string[] = [];
beforeEach(() => {
  state.admin = false;
  state.entries = [];
  state.reads = [];
  state.marks = [];
  state.hits = null;
  state.sections = [];
  state.guideHits = [];
  state.guideError = false;
  state.roles = [];
  state.saved = null;
  state.reordered = null;
  state.uploadPath = `${TENANT}/1-clip.gif`;
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as unknown as Element['scrollIntoView'];
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

// ---------------------------------------------------------------------------
describe('fix-670 §B: parseBlocks is tolerant', () => {
  const all: GuideBlock[] = [
    { t: 'p', text: 'A **para**.' },
    { t: 'list', items: ['one', 'two'] },
    { t: 'callout', tone: 'rule', title: 'Rule', text: 'Text' },
    { t: 'table', head: ['A', 'B'], rows: [['1', '2']] },
    { t: 'step', who: 'tool', title: 'It scrapes', text: 'Nightly', show_me: '/board?tab=tasks', media: `${TENANT}/x.gif` },
    { t: 'step', who: 'you', title: 'You file', text: '', show_me: null, media: 'https://cdn.example/a.mp4' },
    { t: 'cards', ids: [CARD_A] },
  ];

  it('★★ every block type round-trips', () => {
    expect(parseBlocks(JSON.parse(JSON.stringify(all)))).toEqual(all);
  });

  it('★★ an unknown type is dropped and the rest render', () => {
    expect(parseBlocks([{ t: 'video', src: 'x' }, { t: 'p', text: 'kept' }, 7, null, []])).toEqual([
      { t: 'p', text: 'kept' },
    ]);
  });

  it('★★ a bad show_me or media drops THAT FIELD, not the step', () => {
    const [step] = parseBlocks([
      { t: 'step', who: 'you', title: 'S', text: 'T', show_me: '//evil.com', media: 'javascript:alert(1)' },
    ]);
    expect(step).toEqual({ t: 'step', who: 'you', title: 'S', text: 'T', show_me: null, media: null });
    const [step2] = parseBlocks([{ t: 'step', title: 'S', media: '/\\evil.com', show_me: 'https://x.com' }]);
    expect(step2).toMatchObject({ show_me: null, media: null });
  });

  it('★ a missing required field drops the block', () => {
    expect(parseBlocks([{ t: 'p' }, { t: 'list' }, { t: 'step', text: 'no title' }, { t: 'cards', ids: ['nope'] }])).toEqual([]);
  });

  it('★★★ never throws on null, {}, a string, a number', () => {
    for (const bad of [null, undefined, {}, 'blocks', 42, true]) {
      expect(() => parseBlocks(bad)).not.toThrow();
      expect(parseBlocks(bad)).toEqual([]);
    }
  });

  it('★ the 17-section fixture parses: every step survives, title-only cards blocks drop until resolved', () => {
    const raw = SEED as unknown as { sections: { blocks: { t: string }[] }[] };
    expect(raw.sections).toHaveLength(17);
    let steps = 0;
    let rawSteps = 0;
    for (const s of raw.sections) {
      rawSteps += s.blocks.filter((b) => b.t === 'step').length;
      const parsed = parseBlocks(s.blocks);
      steps += parsed.filter((b) => b.t === 'step').length;
      expect(parsed.some((b) => b.t === 'cards')).toBe(false);
    }
    expect(steps).toBe(rawSteps);
    expect(steps).toBeGreaterThan(50);
  });

  it('★ a bucket path is tenant-first and cannot climb out', () => {
    expect(isGuideMediaPath(`${TENANT}/a.gif`)).toBe(true);
    expect(isGuideMediaPath(`${TENANT}/../x.gif`)).toBe(false);
    expect(isGuideMediaPath('/a.gif')).toBe(false);
    expect(isGuideMediaPath('not-a-uuid/a.gif')).toBe(false);
  });
});

describe('fix-670 §B: **bold** is the only markup', () => {
  it('★★ **a** b **c** → three runs', () => {
    expect(boldRuns('**a** b **c**')).toEqual([
      { text: 'a', bold: true },
      { text: ' b ', bold: false },
      { text: 'c', bold: true },
    ]);
  });

  it('★ an unmatched ** renders literally', () => {
    const runs = boldRuns('one ** two');
    expect(runs).toEqual([{ text: 'one ** two', bold: false }]);
    expect(boldRuns('**a** and ** left')).toEqual([
      { text: 'a', bold: true },
      { text: ' and ** left', bold: false },
    ]);
  });

  it('★★★ <script> renders as text', () => {
    state.sections = [section({ blocks: [{ t: 'p', text: '<script>window.x=1</script> **<b>hi</b>**' }] })];
    renderPage('/whats-new?tab=guide');
    const sec = screen.getByTestId('guide-section-welcome');
    expect(sec.querySelector('script')).toBeNull();
    expect(sec.querySelector('b')).toBeNull();
    expect(sec.textContent).toContain('<script>window.x=1</script>');
    expect(within(sec).getByText('<b>hi</b>').tagName).toBe('STRONG');
  });
});

describe('fix-670 §D.4: your chapter', () => {
  it('★★ Jade (da + dm + schematic) → design, once', () => {
    expect(audiencesForRoles(['da', 'dm', 'schematic'])).toEqual(['design']);
  });
  it('★★ Lucas (ent + viewer) → permitting only', () => {
    expect(audiencesForRoles(['ent', 'viewer'])).toEqual(['permitting']);
  });
  it('★ viewer-only → leadership; no roster row → nothing', () => {
    expect(audiencesForRoles(['viewer'])).toEqual(['leadership']);
    expect(audiencesForRoles([])).toEqual([]);
  });
  it('★ the rest of the map', () => {
    expect(audiencesForRoles(['ent_lead'])).toEqual(['permitting']);
    expect(audiencesForRoles(['director'])).toEqual(['design']);
    expect(audiencesForRoles(['acq', 'acq_lead'])).toEqual(['acquisitions']);
    expect(audiencesForRoles(['ca'])).toEqual(['construction_admin']);
    expect(audiencesForRoles(['ent', 'acq'])).toEqual(['permitting', 'acquisitions']);
  });
  it('★ "everyone" is never "your chapter"', () => {
    expect(isYourChapter({ audience: ['everyone'] }, ['design'])).toBe(false);
    expect(isYourChapter({ audience: ['everyone', 'design'] }, ['design'])).toBe(true);
  });

  it('★★ the page marks your chapters and keeps the order', () => {
    state.sections = seedSections();
    state.roles = ['da', 'dm', 'schematic'];
    renderPage('/whats-new?tab=guide');
    expect(screen.getByTestId('guide-toc-mine-role-design')).toBeInTheDocument();
    expect(screen.getByTestId('guide-toc-mine-stage-design')).toBeInTheDocument();
    expect(screen.queryByTestId('guide-toc-mine-role-permitting')).toBeNull();
    expect(screen.queryByTestId('guide-toc-mine-welcome')).toBeNull();
    expect(screen.getByTestId('guide-section-role-design').dataset.mine).toBe('true');
    const order = [...screen.getByTestId('guide-reading').querySelectorAll('section')].map((s) =>
      s.getAttribute('data-testid'),
    );
    expect(order).toEqual(sortSections(state.sections).map((s) => `guide-section-${s.slug}`));
  });

  it('★ no roster row → nothing marked', () => {
    state.sections = seedSections();
    renderPage('/whats-new?tab=guide');
    expect(screen.queryAllByTestId(/^guide-toc-mine-/)).toHaveLength(0);
    expect(screen.getByTestId('guide-section-role-design').dataset.mine).toBe('false');
  });
});

describe('fix-670 §D: the Guide tab', () => {
  it('★★★ hidden with zero sections — no "coming soon"', () => {
    state.entries = [entry({})];
    renderPage('/whats-new?tab=guide');
    expect(screen.queryByTestId('whats-new-tab-guide')).toBeNull();
    expect(screen.getByTestId('whats-new-tab-latest').getAttribute('aria-selected')).toBe('true');
  });

  it('★★ tabs read Guide · Latest · Browse', () => {
    state.sections = [section({})];
    renderPage();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Guide', 'Latest', 'Browse']);
  });

  it('★★ default: unread → Latest', () => {
    state.sections = [section({})];
    state.entries = [entry({})];
    renderPage();
    expect(screen.getByTestId('whats-new-tab-latest').getAttribute('aria-selected')).toBe('true');
  });

  it('★★ default: nothing unread → Guide', () => {
    state.sections = [section({})];
    state.entries = [entry({})];
    state.reads = [CARD_A];
    renderPage();
    expect(screen.getByTestId('whats-new-tab-guide').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('guide-tab')).toBeInTheDocument();
  });

  it('★★ the deep link opens the tab and scrolls to s=', () => {
    state.sections = seedSections();
    state.entries = [entry({})];
    renderPage(guideHref('stage-review'));
    expect(screen.getByTestId('whats-new-tab-guide').getAttribute('aria-selected')).toBe('true');
    expect(scrolled).toContain('guide-section-stage-review');
  });

  it('★★★ opening the guide and leaving does NOT mark cards read', () => {
    state.sections = [section({})];
    state.entries = [entry({})];
    const { unmount } = renderPage(guideHref());
    unmount();
    expect(state.marks).toEqual([]);
  });

  it('★ steps say who does it in WORDS; "Last checked" shows when set', () => {
    state.sections = [
      section({
        reviewed_on: '2026-10-14',
        blocks: [
          { t: 'step', who: 'tool', title: 'The portal is read', text: '' },
          { t: 'step', who: 'you', title: 'You file', text: '' },
        ],
      }),
    ];
    renderPage(guideHref());
    expect(screen.getByTestId('guide-who-tool').textContent).toBe('THE BRIDGE');
    expect(screen.getByTestId('guide-who-you').textContent).toBe('YOU');
    expect(screen.getByTestId('guide-reviewed-welcome').textContent).toBe('Last checked 14 Oct 2026');
  });

  it('★ step media: a bucket path is signed, alt = the step title', () => {
    state.sections = [
      section({ blocks: [{ t: 'step', who: 'you', title: 'Upload the plans', text: '', media: `${TENANT}/a.gif` }] }),
    ];
    renderPage(guideHref());
    const img = screen.getByTestId('guide-media-img') as HTMLImageElement;
    expect(img.alt).toBe('Upload the plans');
    expect(img.src).toBe(`https://signed.example/${TENANT}/a.gif`);
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});

describe('fix-670 §D.6: Show me → and ← Previous', () => {
  it('★★★ a step\'s Show me carries the origin, and Previous lands on that section', () => {
    state.sections = seedSections();
    renderPage(guideHref());
    // A STEP's Show me inside the Design chapter (not the section-level one).
    const sec = screen.getByTestId('guide-section-role-design');
    const go = sec.querySelector<HTMLButtonElement>('[data-testid^="guide-step-go-role-design-"]')!;
    expect(go.textContent).toBe('Show me →');
    fireEvent.click(go);
    expect(screen.getByTestId('stub-origin').textContent).toBe('/whats-new?tab=guide&s=role-design');
    scrolled.length = 0;
    fireEvent.click(screen.getByTestId('stub-previous'));
    expect(screen.getByTestId('whats-new-tab-guide').getAttribute('aria-selected')).toBe('true');
    expect(scrolled).toContain('guide-section-role-design');
  });

  it('★ a section-level show_me renders beside the title', () => {
    state.sections = [section({ show_me: '/dashboard' })];
    renderPage(guideHref());
    fireEvent.click(screen.getByTestId('guide-go-welcome'));
    expect(screen.getByTestId('stub-origin').textContent).toBe('/whats-new?tab=guide&s=welcome');
  });
});

describe('fix-670 §D.7: cards link, never copy', () => {
  it('★★ a missing id is skipped; clicking a card opens the DetailPanel', () => {
    state.entries = [entry({})];
    state.reads = [CARD_A];
    state.sections = [section({ blocks: [{ t: 'cards', ids: [CARD_GONE, CARD_A] }] })];
    renderPage(guideHref());
    const cards = screen.getByTestId('guide-cards');
    expect(within(cards).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByTestId(`guide-card-${CARD_A}`));
    expect(screen.getByTestId('whats-new-detail-title').textContent).toBe(
      'Resubmit-by date on every correction round',
    );
  });

  it('★ a cards block whose every id is gone renders nothing', () => {
    state.sections = [section({ blocks: [{ t: 'cards', ids: [CARD_GONE] }] })];
    renderPage(guideHref());
    expect(screen.queryByTestId('guide-cards')).toBeNull();
  });
});

describe('fix-670 §E: one search box, both sources', () => {
  it('★★ guide hits come FIRST, then the cards', () => {
    state.sections = seedSections();
    state.entries = [entry({})];
    state.hits = [{ id: CARD_A, rank: 1, snippet: '«resubmit» by' }];
    state.guideHits = [
      { id: 'seed-6', slug: 'stage-review', title: 'Review & corrections', rank: 1.5, snippet: 'when to «resubmit»' },
    ];
    renderPage();
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'resubmit' } });
    const results = screen.getByTestId('whats-new-results');
    const guide = within(results).getByTestId('whats-new-guide-results');
    const card = within(results).getByTestId(`whats-new-entry-${CARD_A}`);
    expect(guide.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(guide).getByText('In the guide')).toBeInTheDocument();
    // Clicking a guide hit opens the Guide at that section.
    fireEvent.click(screen.getByTestId('whats-new-guide-hit-stage-review'));
    expect(screen.getByTestId('whats-new-tab-guide').getAttribute('aria-selected')).toBe('true');
    expect(scrolled).toContain('guide-section-stage-review');
  });

  it('★★★ a failing guide RPC still shows the card hits', () => {
    state.sections = [section({})];
    state.entries = [entry({})];
    state.hits = [{ id: CARD_A, rank: 1, snippet: '«resubmit» by' }];
    state.guideError = true;
    renderPage();
    fireEvent.change(screen.getByTestId('whats-new-search'), { target: { value: 'resubmit' } });
    expect(screen.queryByTestId('whats-new-guide-results')).toBeNull();
    expect(screen.getByTestId(`whats-new-entry-${CARD_A}`)).toBeInTheDocument();
  });
});

describe('fix-670 §F: the editor', () => {
  it('★★ a non-admin sees no Edit', () => {
    state.sections = seedSections();
    renderPage(guideHref());
    expect(screen.queryByTestId('guide-edit-welcome')).toBeNull();
  });

  it('★★ move up/down rewrites sort_order', () => {
    const s = [
      section({ id: 'a', slug: 'a', part: 1, sort_order: 10 }),
      section({ id: 'b', slug: 'b', part: 1, sort_order: 10, title: 'Zed' }),
      section({ id: 'c', slug: 'c', part: 2, sort_order: 5 }),
    ];
    // Equal sort_orders: a swap would be a no-op — renumbering is the fix.
    // Only the rows whose number changed are written (b keeps its 10).
    expect(moveSection(s, 'b', -1)).toEqual([
      { id: 'a', part: 1, sort_order: 20 },
      { id: 'c', part: 2, sort_order: 30 },
    ]);
    // Up from the top of Part 2 = the end of Part 1.
    expect(moveSection(s, 'c', -1)).toEqual([
      { id: 'b', part: 1, sort_order: 20 },
      { id: 'c', part: 1, sort_order: 30 },
    ]);
    expect(moveSection(s, 'a', -1)).toEqual([]);

    state.admin = true;
    state.sections = s;
    renderPage(guideHref());
    fireEvent.click(screen.getByTestId('guide-edit-a'));
    fireEvent.click(screen.getByTestId('guide-editor-move-down'));
    expect(state.reordered).toEqual([
      { id: 'a', part: 1, sort_order: 20 },
      { id: 'c', part: 2, sort_order: 30 },
    ]);
  });

  it('★★ the table textarea round-trips', () => {
    const head = ['If your job is…', 'Read this chapter'];
    const rows = [['Design Associate', 'Design'], ['Acquisitions', 'Acquisitions']];
    expect(textToTable(tableToText(head, rows))).toEqual({ head, rows });

    state.admin = true;
    state.sections = [section({ blocks: [{ t: 'table', head, rows }] })];
    renderPage(guideHref());
    fireEvent.click(screen.getByTestId('guide-edit-welcome'));
    const ta = screen.getByTestId('guide-editor-table-0') as HTMLTextAreaElement;
    expect(ta.value).toBe('If your job is… | Read this chapter\nDesign Associate | Design\nAcquisitions | Acquisitions');
    fireEvent.change(ta, { target: { value: `${ta.value}\nCA | Construction Admin` } });
    fireEvent.click(screen.getByTestId('guide-editor-save'));
    expect((state.saved!.blocks as GuideBlock[])[0]).toEqual({
      t: 'table',
      head,
      rows: [...rows, ['CA', 'Construction Admin']],
    });
  });

  it('★★ upload sets media to the bucket path', () => {
    state.admin = true;
    state.sections = [section({ blocks: [{ t: 'step', who: 'you', title: 'File it', text: '' }] })];
    renderPage(guideHref());
    fireEvent.click(screen.getByTestId('guide-edit-welcome'));
    const file = new File(['gif'], 'clip.gif', { type: 'image/gif' });
    fireEvent.change(screen.getByTestId('guide-editor-step-file-0'), { target: { files: [file] } });
    expect(screen.getByTestId('guide-editor-step-preview-0')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('guide-editor-save'));
    expect((state.saved!.blocks as GuideBlock[])[0]).toMatchObject({ t: 'step', media: `${TENANT}/1-clip.gif` });
  });

  it('★ a bad show_me cannot be saved; delete confirms inside the page', () => {
    state.admin = true;
    state.sections = [section({})];
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage(guideHref());
    fireEvent.click(screen.getByTestId('guide-edit-welcome'));
    fireEvent.change(screen.getByTestId('guide-editor-show-me'), { target: { value: '//evil.com' } });
    expect(screen.getByTestId('guide-editor-show-me-error')).toBeInTheDocument();
    expect((screen.getByTestId('guide-editor-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('guide-editor-delete'));
    expect(screen.getByTestId('guide-editor-delete-confirm')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE MIGRATION. No live DB in CI (project rule), so the CHECKs are read
// out of the SQL and evaluated by a mirror; the same four rows were refused by
// the real constraints in a rolled-back prod probe (see the PR).
// ---------------------------------------------------------------------------
function constraint(name: string): string | null {
  const m = new RegExp(`CONSTRAINT ${name} CHECK \\(([\\s\\S]*?)\\)\\s*,\\r?\\n`).exec(MIGRATION);
  return m ? m[1]! : null;
}

/** Would the table accept this row? Each rule is read from the SQL — a CHECK
 *  that is not in the migration accepts everything. */
function tableAccepts(row: { slug?: string; audience?: string[]; blocks?: unknown; show_me?: string | null }): boolean {
  const slugCheck = constraint('guide_sections_slug_shape');
  if (slugCheck && row.slug !== undefined) {
    const re = /slug ~ '([^']+)'/.exec(slugCheck)![1]!;
    if (!new RegExp(re).test(row.slug)) return false;
  }
  const audCheck = constraint('guide_sections_audience_known');
  if (audCheck && row.audience !== undefined) {
    const allowed = [...audCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    if (row.audience.length === 0 || row.audience.some((a) => !allowed.includes(a))) return false;
  }
  const blocksCheck = constraint('guide_sections_blocks_is_array');
  if (blocksCheck && row.blocks !== undefined) {
    expect(blocksCheck).toContain("jsonb_typeof(blocks) = 'array'");
    if (!Array.isArray(row.blocks)) return false;
  }
  const showCheck = constraint('guide_sections_show_me_is_app_path');
  if (showCheck && row.show_me) {
    expect(showCheck).toContain("show_me ~ '^/($|[^/\\\\])'");
    expect(showCheck).toContain("position('\\' in show_me) = 0");
    if (!isAppPath(row.show_me)) return false;
  }
  return true;
}

describe('fix-670 §A: the migration', () => {
  it('★ a good row is accepted', () => {
    expect(
      tableAccepts({ slug: 'stage-review', audience: ['everyone', 'permitting'], blocks: [], show_me: '/board' }),
    ).toBe(true);
  });
  it('★★ a bad slug is refused', () => {
    expect(tableAccepts({ slug: 'Stage Review' })).toBe(false);
    expect(tableAccepts({ slug: 'x'.repeat(61) })).toBe(false);
  });
  it('★★ an unknown audience is refused', () => {
    expect(tableAccepts({ audience: ['wizards'] })).toBe(false);
    expect(tableAccepts({ audience: [] })).toBe(false);
  });
  it('★★ a non-array blocks value is refused', () => {
    expect(tableAccepts({ blocks: {} })).toBe(false);
  });
  it('★★★ //evil.com is refused as show_me', () => {
    expect(tableAccepts({ show_me: '//evil.com' })).toBe(false);
    expect(tableAccepts({ show_me: '/\\evil.com' })).toBe(false);
  });
  it('★ the audience CHECK and the TS list agree', () => {
    const allowed = [...(constraint('guide_sections_audience_known') ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual([...GUIDE_AUDIENCES]);
  });
  it('★★ it ships EMPTY, reads like whats_new_entries, and is published', () => {
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.guide_sections/);
    expect(MIGRATION).toContain('FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()))');
    expect(MIGRATION).toContain('FOR ALL USING (public.is_tenant_admin(tenant_id))');
    expect(MIGRATION).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.guide_sections');
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.bp_search_guide\(q text\)[\s\S]*SECURITY INVOKER/);
    expect(MIGRATION).toMatch(/'guide-media', 'guide-media', false, 15728640/);
  });
});
