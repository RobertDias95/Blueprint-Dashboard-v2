import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TargetSubmitBenchmarkNote from '../components/ProjectDetail/TargetSubmitBenchmarkNote';
import type { TargetSubmitBenchmark } from '../lib/targetSubmitPolicy';

// fix-249 → ★ fix-680: the note under Target Submit says WHERE THE NUMBER CAME
// FROM — our own recent history (median of the last 5), or the Settings
// starting number while a city has no history — and marks projections.
// Each type's anchor comes from permit_types.ts_anchor (the catalogue rows).

const state: {
  benchmark: TargetSubmitBenchmark;
  isLoading: boolean;
} = {
  benchmark: {
    medianDays: 99,
    n: 5,
    minDays: 8,
    maxDays: 196,
    windowLabel: 'learned',
    totalSamples: 12,
  },
  isLoading: false,
};

vi.mock('../hooks/useTargetSubmitBenchmark', () => ({
  useTargetSubmitBenchmark: () => ({
    data: state.benchmark,
    isLoading: state.isLoading,
  }),
}));

// The catalogue as fix-680's backfill writes it (a sample of rows), plus a
// brand-new type that took the column default.
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'TRAO', is_builtin: true, notes: null, ts_anchor: 'go_date' },
      { name: 'IPR', is_builtin: true, notes: null, ts_anchor: 'bp_c1_resub' },
      { name: 'Grading / Clearing', is_builtin: true, notes: null, ts_anchor: 'mirror_bp' },
      { name: 'Vault', is_builtin: false, notes: null, ts_anchor: 'none' },
      { name: 'PPR', is_builtin: true, notes: null, ts_anchor: 'created' },
      { name: 'Brand New Type', is_builtin: false, notes: null, ts_anchor: 'go_date' },
    ],
    isLoading: false,
  }),
}));

beforeEach(() => {
  state.isLoading = false;
  state.benchmark = {
    medianDays: 99,
    n: 5,
    minDays: 8,
    maxDays: 196,
    windowLabel: 'learned',
    totalSamples: 12,
  };
});

describe('TargetSubmitBenchmarkNote (fix-680)', () => {
  it('a learned number says it is the median of our last submittals', () => {
    render(<TargetSubmitBenchmarkNote type="TRAO" juris="Seattle" />);
    const gap = screen.getByTestId('target-submit-benchmark-gap');
    expect(gap.textContent).toBe('learned: GO+99d (median of last 5)');
    expect(screen.getByTestId('target-submit-benchmark')).toHaveAttribute('data-tier', 'learned');
  });

  it('a city with no history says the starting number is in use', () => {
    state.benchmark = {
      medianDays: 3,
      n: 0,
      minDays: null,
      maxDays: null,
      windowLabel: 'starting',
      totalSamples: 0,
    };
    render(<TargetSubmitBenchmarkNote type="Brand New Type" juris="Seattle" />);
    expect(screen.getByTestId('target-submit-benchmark-gap').textContent).toBe(
      'starting number: GO+3d (no history in this city yet)',
    );
    expect(screen.getByTestId('target-submit-benchmark')).toHaveAttribute('data-tier', 'starting');
  });

  it('PPR counts from the day it was added to the Bridge', () => {
    state.benchmark = { medianDays: 0, n: 5, minDays: 0, maxDays: 14, windowLabel: 'learned', totalSamples: 5 };
    render(<TargetSubmitBenchmarkNote type="PPR" juris="Seattle" />);
    expect(screen.getByTestId('target-submit-benchmark-gap').textContent).toBe(
      'learned: created+0d (median of last 5)',
    );
  });

  it('marks a projected target visibly', () => {
    render(<TargetSubmitBenchmarkNote type="IPR" juris="Seattle" isProjected />);
    expect(screen.getByTestId('target-submit-benchmark-projected')).toHaveTextContent('projected');
    expect(screen.getByTestId('target-submit-benchmark')).toHaveAttribute('data-projected', 'true');
  });

  it('does not mark a manual date as projected — manual outranks the engine', () => {
    render(<TargetSubmitBenchmarkNote type="IPR" juris="Seattle" isProjected isManual />);
    expect(screen.queryByTestId('target-submit-benchmark-projected')).toBeNull();
  });

  it("★ fix-615 (gap 6): mirror types SAY they use the Building Permit's date", () => {
    render(<TargetSubmitBenchmarkNote type="Grading / Clearing" juris="Seattle" />);
    const note = screen.getByTestId('target-submit-benchmark');
    expect(note.textContent).toBe("uses the Building Permit's date");
    expect(note.getAttribute('data-anchor')).toBe('mirror_bp');
  });

  it('a type set to no anchor (Vault) says there is no automatic target', () => {
    render(<TargetSubmitBenchmarkNote type="Vault" juris="Seattle" />);
    const note = screen.getByTestId('target-submit-benchmark');
    expect(note.textContent).toBe('no anchor — no automatic target');
    expect(note.getAttribute('data-anchor')).toBe('none');
  });

  it('a type not in the catalogue at all gets no automatic target (the server COALESCE)', () => {
    render(<TargetSubmitBenchmarkNote type="Not A Type" juris="Seattle" />);
    expect(screen.getByTestId('target-submit-benchmark').getAttribute('data-anchor')).toBe('none');
  });
});
