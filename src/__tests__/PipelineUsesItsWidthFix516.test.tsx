import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import AddrGroup from '../components/Dashboard/AddrGroup';
import type { StageCount } from '../lib/pipelineDistribution';

import dashSrc from '../pages/Dashboard.tsx?raw';
import addrSrc from '../components/Dashboard/AddrGroup.tsx?raw';

// ===========================================================================
// fix-516 (P-183 · P-206) — THE PIPELINE USES ITS WIDTH
// ===========================================================================
//
// §A decides how much width a card gets; §B decides how the card spends it.
// Sizing the header before the lane widths settle would price a lever against a
// component about to move — the mistake that voided two briefs on 09-09
// ([[do-not-brief-a-layout-that-is-still-being-redesigned]]).

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// §A — one sizing rule for all four lanes
// ---------------------------------------------------------------------------

describe('fix-516 §A — whatever is open shares the row', () => {
  const c = code(dashSrc);

  it('★★★ ONE rule: folded to a spine, or `1 1 0%`. No third branch.', () => {
    // ★★★ §A0: the ceiling was `flex: 0 0 264px` on Approved and Issued, via a
    //     `narrow` prop — a fixed basis with NO GROW AND NO SHRINK, against
    //     `1 1 0%` on the other two. The exception goes rather than moving,
    //     because §A's ask is the general rule and not a wider number.
    expect(c).toContain("flex: collapsed ? '0 0 ' + GROUP_SPINE_W + 'px' : '1 1 0%'");
  });

  it('★★★ nothing named `narrow` survives — prop, branch, attribute or constant', () => {
    expect(c).not.toContain('GROUP_NARROW_W');
    expect(c).not.toMatch(/\bnarrow\b\s*[?:=]/);
    expect(c).not.toContain('data-narrow');
    expect(c).not.toContain('narrow?: boolean');
  });

  it('★★★ …and 264 is not hiding anywhere as a replacement ceiling', () => {
    // §A0's warning, from fix-508's `TEAM_GRID_CHAT_MIN = 150`: a judgement
    // dressed as a measurement. 264 was a mock-up pixel, filed under
    // `/** Folded widths */` while governing the OPEN state.
    expect(c).not.toContain('264');
    // ★ Scoped to the LANE section — the search input above the row keeps its
    //   own `max-w-[360px]`, which is a different control entirely.
    const group = c.slice(c.indexOf('function PipelineGroup'));
    expect(group).not.toMatch(/maxWidth|max-w-\[/);
  });

  it('★★ folding is untouched — every lane still folds to the SAME spine', () => {
    // Folded was never the complaint: 44px and full height, which is what
    // fix-324 §5 made the four siblings for.
    expect(c).toContain('const GROUP_SPINE_W = 44');
    expect(c).toContain('const SUB_SPINE_W = 38');
  });

  it('★★★ the sizing rule is stated ONCE, so a fifth lane inherits it', () => {
    // The regression this replaces: two call sites passing a prop that meant
    // "size me differently". A single expression in `PipelineGroup` cannot be
    // opted out of without editing the component.
    const matches = c.match(/flex: collapsed \?/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §B — the card header
// ---------------------------------------------------------------------------

/** The four-chip case: `2450 3rd Ave W` in Bobby's screenshot. */
const DIST: StageCount[] = [
  { stage: 'de', count: 3 },
  { stage: 'pm', count: 1 },
  { stage: 'ap', count: 1 },
  { stage: 'is', count: 2 },
];

function renderCard(over: {
  address?: string;
  juris?: string | null;
  distribution?: StageCount[];
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <AddrGroup
      address={over.address ?? '2450 3rd Ave W'}
      juris={over.juris === undefined ? 'Seattle' : over.juris}
      projectId="p1"
      permits={[]}
      stage="de"
      cyclesByPermit={new Map()}
      reviewersByPermit={new Map()}
      keyDateLabel="Target Submit"
      getKeyDate={() => null}
      isOpen={false}
      isHighlighted={false}
      distribution={over.distribution ?? DIST}
      onToggle={() => {}}
      onCountClick={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fix-516 §B — the address stops truncating', () => {
  it('★★★ four chips render in a TWO-column grid', () => {
    // Bobby: *"stack the buckets vertically two — if there's only one, or if
    // there's three, it just kind of fills in."* Four chips in one row is four
    // chip-widths of header; four in a 2×2 is two. That is the width the
    // address gets back.
    renderCard();
    const chips = screen.getByTestId('addr-counts-de');
    expect(chips.dataset.chipColumns).toBe('2');
    expect(chips.style.gridTemplateColumns).toBe('1fr 1fr');
    expect(within(chips).getAllByRole('button')).toHaveLength(4);
  });

  it('★★★ three chips land 2+1 — the grid decides, not the container', () => {
    renderCard({
      distribution: [
        { stage: 'de', count: 3 },
        { stage: 'pm', count: 1 },
        { stage: 'ap', count: 1 },
      ],
    });
    const chips = screen.getByTestId('addr-counts-de');
    expect(chips.dataset.chipColumns).toBe('2');
    expect(within(chips).getAllByRole('button')).toHaveLength(3);
  });

  it('★★ ONE chip stays one column — it does not shout', () => {
    // fix-383's rule: a stage with no cards renders NOTHING, not a "0", and 74
    // of 174 projects sit in a single bucket.
    renderCard({ distribution: [{ stage: 'de', count: 3 }] });
    const chips = screen.getByTestId('addr-counts-de');
    expect(chips.dataset.chipColumns).toBe('1');
    expect(within(chips).getAllByRole('button')).toHaveLength(1);
  });

  it('★★★ the jurisdiction is on its OWN line, under the address', () => {
    renderCard();
    const juris = screen.getByTestId('addr-juris-de');
    const name = screen.getByTestId('addr-name-de');
    // Same parent — the left column — and the address comes first.
    expect(juris.parentElement).toBe(name.parentElement);
    const kids = Array.from(name.parentElement!.children);
    expect(kids.indexOf(name)).toBeLessThan(kids.indexOf(juris));
    // ★ …and the left column is a COLUMN, which is what puts them on two lines.
    expect(name.parentElement!.className).toContain('flex-col');
  });

  it('★★ a project with no jurisdiction renders no empty chip', () => {
    renderCard({ juris: null });
    expect(screen.queryByTestId('addr-juris-de')).toBeNull();
    expect(screen.getByTestId('addr-name-de')).toBeInTheDocument();
  });

  it('★★★ the address takes the freed width and carries its full text', () => {
    // jsdom cannot measure a truncation, so the assertion is the one that
    // actually decides it: the address owns the flexible column, and the chips
    // and the caret are the only things that do not.
    renderCard();
    const name = screen.getByTestId('addr-name-de');
    expect(name.textContent).toBe('2450 3rd Ave W');
    // ★ The full string is also on `title`, so a genuinely narrow lane still
    //   discloses it on hover rather than losing it.
    expect(name.getAttribute('title')).toBe('2450 3rd Ave W');
    const column = name.parentElement!;
    expect(column.className).toContain('flex-1');
    expect(column.className).toContain('min-w-0');
    expect(screen.getByTestId('addr-counts-de').className).toContain('flex-shrink-0');
  });

  it('★★★ ALL FOUR CHIPS KEEP EQUAL WEIGHT — pins Bobby\'s 2026-09-10 ruling', () => {
    // ⏸ The open question was whether the chip for the lane you are looking at
    //    should be de-emphasised, since that one IS redundant with the rows
    //    below. Bobby: *"i need to think about this more."* So nothing here
    //    dims, greys, outlines or reorders any of them, and this is what would
    //    fail if somebody tried.
    renderCard();
    const chips = within(screen.getByTestId('addr-counts-de')).getAllByRole('button');
    const shape = chips.map((b) => ({
      cls: b.className,
      bg: b.style.background,
      border: b.style.border,
      radius: b.style.borderRadius,
      pad: b.style.padding,
      opacity: b.style.opacity,
    }));
    for (const s of shape) {
      expect(s).toEqual(shape[0]);
    }
    // ★ The COLOUR still varies by stage — that is fix-383's vocabulary, not
    //   emphasis, and it is the same on every card.
    expect(new Set(chips.map((b) => b.style.color)).size).toBeGreaterThan(1);
  });

  it('★★ the chips are still CLICKABLE and still stop the row toggling', () => {
    // fix-383's rule: a targeted click must not become the broad one.
    const c = code(addrSrc);
    expect(c).toContain('e.stopPropagation();');
    expect(c).toContain('onCountClick(c.stage)');
  });

  it('★★★ the chips were MOVED, not deleted — they are the project\'s whole footprint', () => {
    // ⚠️ Bobby: *"we don't need to put the permits there because it clearly
    //    shows the permit types and the permit numbers already."* True WITHIN a
    //    lane and false ACROSS them: the same project appears in several lanes
    //    at once and each instance's rows show only THAT lane's permits.
    renderCard();
    const chips = within(screen.getByTestId('addr-counts-de')).getAllByRole('button');
    expect(chips.map((b) => b.dataset.countStage)).toEqual(['de', 'pm', 'ap', 'is']);
  });
});

// ---------------------------------------------------------------------------
// Vocabulary — the check the brief asked for while I was in here
// ---------------------------------------------------------------------------

describe('fix-516 — the chip abbreviations and P-190', () => {
  it('★ the chips abbreviate the Pipeline\'s own words, from ONE map', () => {
    // fix-508 §E gave the permits rail its phase groups using the Pipeline's
    // words; these chips abbreviate the same source rather than a second list.
    const c = code(addrSrc);
    expect(c).toContain('STAGE_PILL_LABEL[c.stage]');
    expect(c).toContain('STAGE_FULL_LABEL[c.stage]');
  });
});
