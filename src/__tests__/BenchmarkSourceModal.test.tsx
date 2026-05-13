import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BenchmarkSourceModal from '../components/Reports/BenchmarkSourceModal';
import type { BenchmarkSourcePermit } from '../lib/scheduleBenchmarks';

// Q9.5.f-fix-3 4.B: source-modal smoke tests.

function makeSource(over: Partial<BenchmarkSourcePermit> = {}): BenchmarkSourcePermit {
  return {
    permitId: 1,
    projectId: 'p1',
    address: '100 Pike St',
    type: 'Building Permit',
    num: 'BP-2026-1',
    submitted: '2026-01-15',
    approval: '2026-04-20',
    cycleCount: 2,
    inRecentWindow: true,
    cycles: [
      { index: 1, cr: 28, co: 7 },
      { index: 2, cr: 14, co: null },
    ],
    ...over,
  };
}

function renderModal(sources: BenchmarkSourcePermit[], onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <BenchmarkSourceModal
        type="Building Permit"
        juris="Seattle"
        sources={sources}
        onClose={onClose}
      />
    </MemoryRouter>,
  );
}

describe('<BenchmarkSourceModal />', () => {
  it('renders empty state when there are no contributing permits', () => {
    renderModal([]);
    expect(screen.getByTestId('benchmark-source-body').textContent).toMatch(
      /no contributing permits/i,
    );
    expect(screen.getByTestId('benchmark-source-count').textContent).toBe(
      '0 permits contributing',
    );
  });

  it('renders one row per source permit with address linked to project', () => {
    const a = makeSource({ permitId: 1, address: '100 Pike St', projectId: 'p1' });
    const b = makeSource({ permitId: 2, address: '200 Cedar Ave', projectId: 'p2', inRecentWindow: false });
    renderModal([a, b]);
    expect(screen.getByTestId('benchmark-source-count').textContent).toBe(
      '2 permits contributing',
    );
    const linkA = screen.getByTestId('benchmark-source-row-1') as HTMLAnchorElement;
    expect(linkA.getAttribute('href')).toBe('/project/p1');
    expect(linkA.textContent).toBe('100 Pike St');
    const linkB = screen.getByTestId('benchmark-source-row-2') as HTMLAnchorElement;
    expect(linkB.getAttribute('href')).toBe('/project/p2');
  });

  it('shows a "RECENT" chip when the source is within the learning window', () => {
    const recent = makeSource({ permitId: 1, inRecentWindow: true });
    const old = makeSource({ permitId: 2, inRecentWindow: false });
    renderModal([recent, old]);
    const body = screen.getByTestId('benchmark-source-body').textContent ?? '';
    // One RECENT chip total (matches the single in-window permit).
    expect(body.match(/RECENT/g)?.length).toBe(1);
  });

  it('fires onClose when the Close button is clicked', () => {
    const onClose = vi.fn();
    renderModal([makeSource()], onClose);
    fireEvent.click(screen.getByTestId('benchmark-source-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal([makeSource()], onClose);
    fireEvent.click(screen.getByTestId('benchmark-source-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
