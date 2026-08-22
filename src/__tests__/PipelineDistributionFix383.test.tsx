import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AddrGroup from '../components/Dashboard/AddrGroup';
// ★ The repo's idiom for asserting on source shape (fix-344 / fix-377 read
// their migrations the same way): a raw import, so no node types are needed.
import dashboardSource from '../pages/Dashboard.tsx?raw';
import addrGroupSource from '../components/Dashboard/AddrGroup.tsx?raw';
import {
  buildAddressDistribution,
  spansMultipleBuckets,
  STAGE_GROUP,
  STAGE_ORDER,
} from '../lib/pipelineDistribution';
import { pipelineSubKeyPrefix, pipelineGroupKey } from '../lib/pipelinePrefs';
import type { BucketedPermits } from '../lib/permitStage';
import type { Permit } from '../lib/database.types';

// ===========================================================================
// fix-383 — the pipeline shows a project four times and never says so
// ===========================================================================
//
// Bobby: "in the permit pills it would say, here's this project... okay,
// there's one in permitting, one in issued, two in design and engineering, one
// in correction. I would like the UI to bring that back."
//
// And the targeted click: "if you clicked the two in issued, it would then open
// that other expansion... because some people might have the expansions open or
// closed."
//
// ★★ MEASURED ON PROD 2026-08-21: of 174 projects, 100 (57%) have permits in
// more than one bucket. Counting only UNISSUED permits it looks like 8% — the
// issued ones are most of the value, which is the case Bobby described.

vi.mock('../hooks/useDashboardPermitCards', () => ({
  useDashboardPermitCards: () => ({ data: undefined }),
}));

const permit = (id: number, projectId = 'p1'): Permit =>
  ({
    id,
    project_id: projectId,
    type: 'Building Permit',
    num: `N-${id}`,
    target_submit: '2026-08-17',
  }) as unknown as Permit;

const emptyBuckets = (): BucketedPermits => ({
  deEarly: [],
  deLate: [],
  pm: [],
  co: [],
  ap: [],
  is: [],
});

// 233 31st Ave E — the project Bobby named, in the shape he described:
// two in D&E, one in permitting, one in correction, one issued.
function galerBuckets(): BucketedPermits {
  const b = emptyBuckets();
  b.deEarly = [permit(1)];
  b.deLate = [permit(2)];
  b.pm = [permit(3)];
  b.co = [permit(4)];
  b.is = [permit(5)];
  return b;
}
const ADDR = new Map([['p1', '233 31st Ave E']]);

// ---------------------------------------------------------------------------

describe('fix-383 — the distribution', () => {
  it('★★★ a project spread across four buckets reports all four', () => {
    const d = buildAddressDistribution(galerBuckets(), ADDR);
    expect(d.get('233 31st Ave E')).toEqual([
      { stage: 'de', count: 2 }, // deEarly + deLate collapse into one column
      { stage: 'pm', count: 1 },
      { stage: 'co', count: 1 },
      { stage: 'is', count: 1 },
    ]);
  });

  it('★★ ISSUED permits are counted — the majority of the value', () => {
    // A project whose only other bucket is Issued: the exact cross-bucket
    // case that looks like nothing if you only count unissued work.
    const b = emptyBuckets();
    b.pm = [permit(1)];
    b.is = [permit(2), permit(3)];
    const d = buildAddressDistribution(b, ADDR);
    expect(d.get('233 31st Ave E')).toEqual([
      { stage: 'pm', count: 1 },
      { stage: 'is', count: 2 },
    ]);
    expect(spansMultipleBuckets(d.get('233 31st Ave E'))).toBe(true);
  });

  it('★ a stage with no cards is omitted, never rendered as a zero', () => {
    const b = emptyBuckets();
    b.pm = [permit(1)];
    const counts = buildAddressDistribution(b, ADDR).get('233 31st Ave E');
    expect(counts).toEqual([{ stage: 'pm', count: 1 }]);
    expect(counts!.some((c) => c.count === 0)).toBe(false);
    expect(spansMultipleBuckets(counts)).toBe(false);
  });

  it('★ the order is the left-to-right pipeline order', () => {
    expect(STAGE_ORDER).toEqual(['de', 'pm', 'co', 'ap', 'is']);
    const d = buildAddressDistribution(galerBuckets(), ADDR);
    expect(d.get('233 31st Ave E')!.map((c) => c.stage)).toEqual(
      STAGE_ORDER.filter((s) => s !== 'ap'),
    );
  });

  it('★★ counting the BUCKETS is what makes every pill a real click target', () => {
    // The counts can only ever describe cards that are on the board, because
    // they ARE the cards on the board. A permit filtered out before bucketing
    // (fix-380 search, hold mode, self-scope) is not counted, so a pill can
    // never promise a card the click cannot reach.
    const b = emptyBuckets();
    b.pm = [permit(1)]; // the search left one permit behind
    const d = buildAddressDistribution(b, ADDR);
    expect(d.get('233 31st Ave E')).toEqual([{ stage: 'pm', count: 1 }]);
  });

  it('★ an address the map does not know is skipped, not crashed on', () => {
    const b = emptyBuckets();
    b.pm = [permit(1, 'unknown-project')];
    expect(buildAddressDistribution(b, new Map()).size).toBe(0);
  });

  it('★★ Corrections reveals through the Permitting column', () => {
    // `co` is a sub-column of Permitting, so a Corr click has to unfold `pm`.
    expect(STAGE_GROUP).toEqual({
      de: 'de',
      pm: 'pm',
      co: 'pm',
      ap: 'ap',
      is: 'is',
    });
  });
});

// ---------------------------------------------------------------------------

function renderGroup(
  props: Partial<React.ComponentProps<typeof AddrGroup>> = {},
) {
  return render(
    <MemoryRouter>
      <AddrGroup
        address="233 31st Ave E"
        juris="Seattle"
        projectId="p1"
        permits={[permit(3)]}
        stage="pm"
        cyclesByPermit={new Map()}
        reviewersByPermit={new Map()}
        keyDateLabel="City Target"
        getKeyDate={() => null}
        isOpen={false}
        isHighlighted={false}
        onToggle={() => {}}
        onHover={() => {}}
        onLeave={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('fix-383 — the row', () => {
  const dist = () =>
    buildAddressDistribution(galerBuckets(), ADDR).get('233 31st Ave E')!;

  it('★★★ a four-bucket project shows all four on its row', () => {
    renderGroup({ distribution: dist(), onCountClick: () => {} });
    // The short labels that already existed — no new vocabulary (fix-364).
    expect(screen.getByTestId('addr-count-pm-de')).toHaveTextContent('D&E 2');
    expect(screen.getByTestId('addr-count-pm-pm')).toHaveTextContent('Perm 1');
    expect(screen.getByTestId('addr-count-pm-co')).toHaveTextContent('Corr 1');
    expect(screen.getByTestId('addr-count-pm-is')).toHaveTextContent('Iss 1');
    expect(screen.queryByTestId('addr-count-pm-ap')).toBeNull();
  });

  it('★★★ clicking a count reports THAT stage, not the row toggle', () => {
    const onCountClick = vi.fn();
    const onToggle = vi.fn();
    renderGroup({ distribution: dist(), onCountClick, onToggle });

    fireEvent.click(screen.getByTestId('addr-count-pm-is'));
    expect(onCountClick).toHaveBeenCalledWith('is');
    // ★★ stopPropagation: the targeted click must not also fire the broad one.
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('★★ clicking the row itself still fires the broad toggle', () => {
    const onToggle = vi.fn();
    renderGroup({ distribution: dist(), onCountClick: () => {}, onToggle });
    fireEvent.click(screen.getByTestId('addr-group-toggle-pm'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('★ the header is still keyboard-operable after ceasing to be a <button>', () => {
    const onToggle = vi.fn();
    renderGroup({ onToggle });
    const header = screen.getByTestId('addr-group-toggle-pm');
    expect(header).toHaveAttribute('role', 'button');
    expect(header).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(header, { key: 'Enter' });
    fireEvent.keyDown(header, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('★★ a count button is never nested inside another button', () => {
    // Invalid HTML that browsers resolve by dropping one of the two — which
    // would silently un-click either the row or the counts.
    const { container } = renderGroup({
      distribution: dist(),
      onCountClick: () => {},
    });
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.closest('button')).toBe(btn);
    }
  });

  it('★ a single-bucket project shows one pill and does not shout', () => {
    const b = emptyBuckets();
    b.pm = [permit(3)];
    renderGroup({
      distribution: buildAddressDistribution(b, ADDR).get('233 31st Ave E'),
      onCountClick: () => {},
    });
    expect(screen.getByTestId('addr-count-pm-pm')).toHaveTextContent('Perm 1');
    expect(screen.queryByTestId('addr-count-pm-de')).toBeNull();
    expect(screen.queryByTestId('addr-count-pm-is')).toBeNull();
  });

  it('★ with no handler the pills are inert text, not buttons', () => {
    renderGroup({ distribution: dist() });
    expect(screen.queryByTestId('addr-count-pm-is')).toBeNull();
    expect(screen.getByText('Iss 1').tagName).toBe('SPAN');
  });

  it('★ without a distribution it falls back to this bucket alone', () => {
    // The pre-fix-383 behaviour, kept for a bare render of the component:
    // counts derived from the permits THIS group was handed.
    const { container } = renderGroup({ permits: [permit(3)] });
    const pills = [...container.querySelectorAll('span')]
      .map((el) => el.textContent ?? '')
      .filter((t) => /^(D&E|Perm|Corr|Appr|Iss) \d+$/.test(t));
    // One pill, counting the one permit it was handed — derived locally from
    // effectiveStage rather than from a distribution it was never given.
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatch(/ 1$/);
  });

  it('★ hold badges still render alongside the counts (fix-178 / fix-262)', () => {
    renderGroup({
      distribution: dist(),
      onCountClick: () => {},
      hold: { reason: 'Client', hold_start: '2026-08-01', note: null },
    });
    expect(screen.getByTestId('addr-group-hold-p1')).toBeTruthy();
    expect(screen.getByTestId('addr-count-pm-is')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ★★★ The scroll must stay component-local. Assert the PATTERN, not just the
// outcome — Q9.5.f-fix-1d took ten iterations to land it and the failure mode
// (a parent-imperative scroll measuring a stale scrollHeight) is silent.
// ---------------------------------------------------------------------------

/** ★ These files explain themselves at length, so a "the code does not say X"
 *  assertion has to read the CODE and not the prose — the trap fix-369,
 *  fix-371 and fix-372 each hit once. Dashboard.tsx's own comment records that
 *  `scrollAddrIntoView` was REMOVED, and that sentence would otherwise fail the
 *  assertion that the name is gone. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-383 — the scroll is still the group\'s own', () => {
  const dashboardSrc = stripComments(dashboardSource);
  const addrGroupSrc = stripComments(addrGroupSource);

  it('★★★ the Dashboard never scrolls a bucket itself', () => {
    expect(dashboardSrc).not.toMatch(/scrollIntoView/);
    expect(dashboardSrc).not.toMatch(/scrollTop\s*=/);
    expect(dashboardSrc).not.toMatch(/scrollAddrIntoView/);
    expect(dashboardSrc).not.toMatch(/data-scroll-bucket"\]\s*\)?\s*\.\s*forEach/);
  });

  it('★★★ AddrGroup scrolls from its OWN effect, keyed on isOpen AND the ticket', () => {
    expect(addrGroupSrc).toContain('}, [isOpen, revealNonce]);');
    // and it is a useEffect in this component, not a handler the parent calls
    const effect = addrGroupSrc.slice(
      addrGroupSrc.indexOf('const rootRef'),
      addrGroupSrc.indexOf('}, [isOpen, revealNonce]);'),
    );
    expect(effect).toContain('useEffect(');
    expect(effect).toContain('[data-scroll-bucket="true"]');
    expect(effect).toContain('requestAnimationFrame');
  });

  it('★★★ the parent passes the ticket as STATE, not as a call', () => {
    // revealTarget is data on the context; nothing hands AddrGroup a function
    // that performs a scroll.
    expect(dashboardSrc).toContain('revealTarget: { address: string; stage: Stage; nonce: number } | null;');
    expect(dashboardSrc).toContain('revealNonce={');
    expect(dashboardSrc).not.toMatch(/onScrollTo|scrollTo=\{/);
  });

  it('★★★ the effect re-fires for an already-open group', () => {
    // The whole reason the ticket exists: isOpen does NOT change when the
    // address is already open in the target bucket, so an effect keyed on
    // isOpen alone would not re-run and the click would do nothing visible.
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 0 as unknown as number);

    const inBucket = (nonce: number) => (
      <MemoryRouter>
        {/* the scrollable ancestor the effect walks up to find */}
        <div data-scroll-bucket="true">
          <AddrGroup
            address="233 31st Ave E"
            juris="Seattle"
            projectId="p1"
            permits={[permit(5)]}
            stage="is"
            cyclesByPermit={new Map()}
            reviewersByPermit={new Map()}
            keyDateLabel="Issued"
            getKeyDate={() => null}
            isOpen
            isHighlighted={false}
            revealNonce={nonce}
            onToggle={() => {}}
            onHover={() => {}}
            onLeave={() => {}}
          />
        </div>
      </MemoryRouter>
    );

    const { rerender } = render(inBucket(1));
    expect(raf.mock.calls.length).toBeGreaterThan(0); // the open scrolled once
    const before = raf.mock.calls.length;

    // isOpen stays true; only the ticket moves. The group scrolls again.
    rerender(inBucket(2));
    expect(raf.mock.calls.length).toBeGreaterThan(before);

    // A re-render that changes NEITHER does not re-scroll.
    const steady = raf.mock.calls.length;
    rerender(inBucket(2));
    expect(raf.mock.calls.length).toBe(steady);

    raf.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('fix-383 — reveal is ENSURE OPEN, never toggle', () => {
  const dashboardSrc = stripComments(dashboardSource);

  it('★★★ revealAddress only ever ADDS to openAddresses', () => {
    const fn = dashboardSrc.slice(
      dashboardSrc.indexOf('const revealAddress = useCallback('),
      dashboardSrc.indexOf('const dashCtx: DashContext'),
    );
    expect(fn).toContain('if (prev.has(addr)) return prev;');
    expect(fn).toContain('next.add(addr);');
    // ★ the trap: no delete, and it does not call the toggler.
    expect(fn).not.toMatch(/\.delete\(/);
    expect(fn).not.toMatch(/toggleAddress/);
  });

  it('★★★ a count click does not route through toggleAddress', () => {
    expect(dashboardSrc).toContain('onCountClick={(s) => ctx.revealAddress(g.address, s)}');
    expect(dashboardSrc).toContain('onToggle={() => ctx.toggleAddress(g.address)}');
  });

  it('★★★ it unfolds the destination column, or the reveal shows nothing', () => {
    // Approved and Issued default to COLLAPSED (fix-324b / #68), which is
    // exactly the "one was issued, click it" case Bobby described.
    const fn = dashboardSrc.slice(
      dashboardSrc.indexOf('const revealAddress = useCallback('),
      dashboardSrc.indexOf('const dashCtx: DashContext'),
    );
    expect(fn).toContain('pipelineGroupKey(group)');
    expect(fn).toContain('pipelineSubKeyPrefix(group)');
    expect(fn).toContain('STAGE_GROUP[stage]');
  });

  it('★ unfolding matches the group key and every sub key beneath it', () => {
    const collapsed = [
      pipelineGroupKey('is'),
      pipelineSubKeyPrefix('is') + 'active issued permits at this address',
      pipelineGroupKey('de'), // a different column, left folded
    ];
    const group = STAGE_GROUP.is;
    const next = collapsed.filter(
      (k) =>
        k !== pipelineGroupKey(group) && !k.startsWith(pipelineSubKeyPrefix(group)),
    );
    expect(next).toEqual([pipelineGroupKey('de')]);
  });

  it('★ the highlight is the existing one, not a second concept', () => {
    const fn = dashboardSrc.slice(
      dashboardSrc.indexOf('const revealAddress = useCallback('),
      dashboardSrc.indexOf('const dashCtx: DashContext'),
    );
    expect(fn).toContain('setHighlightedAddress(addr);');
  });
});
