import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  buildReuseSources,
  filterReuseSources,
  reuseContextLine,
  type ReuseSource,
} from '../components/wizard/reuseSourceHelpers';
import { resolveUnitTypesForSave } from '../lib/unitTypeNaming';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-216: REUSE source picker — pure helpers + the copy-on-select behavior.

function project(over: Partial<Project>): Project {
  return {
    id: 'p',
    address: '100 Main St',
    juris: 'Seattle',
    archived: false,
    zone: 'LR2',
    lot_width: 20,
    lot_depth: 30,
    product_types: ['SFR'],
    unit_types: null,
    ...over,
  } as unknown as Project;
}

function permit(over: Partial<PermitWithCycles>): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p',
    type: 'Building Permit',
    da: null,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

describe('buildReuseSources', () => {
  it('excludes archived projects and derives primary DA from the Building Permit', () => {
    const projects = [
      project({ id: 'a', address: '1 A St' }),
      project({ id: 'b', address: '2 B St', archived: true }),
    ];
    const byProject = new Map<string, PermitWithCycles[]>([
      ['a', [permit({ id: 10, project_id: 'a', type: 'Building Permit', da: 'Fisk' })]],
    ]);
    const out = buildReuseSources(projects, byProject);
    expect(out.map((s) => s.id)).toEqual(['a']); // archived b dropped
    expect(out[0].primaryDa).toBe('Fisk');
  });

  it('canonicalizes unit_types via parseUnitTypes (v1 {w,d} → {width_ft,depth_ft})', () => {
    const projects = [
      project({ id: 'a', unit_types: [{ label: 'Type A', w: 20, d: 30 }] as unknown as Project['unit_types'] }),
    ];
    const out = buildReuseSources(projects, new Map());
    expect(out[0].unit_types).toEqual([
      { label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1, stories: null },
    ]);
  });
});

describe('filterReuseSources', () => {
  const sources: ReuseSource[] = [
    {
      id: 'a', address: '500 Pike St', juris: 'Seattle', zone: 'LR2',
      lot_width: 20, lot_depth: 30, product_types: ['SFR'], unit_types: [], primaryDa: 'Fisk',
    },
    {
      id: 'b', address: '90 Bellevue Way', juris: 'Bellevue', zone: 'R-4',
      lot_width: 40, lot_depth: 60, product_types: ['Cottages'], unit_types: [], primaryDa: 'Cam',
    },
  ];

  it('blank query returns all', () => {
    expect(filterReuseSources(sources, '   ').map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('matches on address', () => {
    expect(filterReuseSources(sources, 'pike').map((s) => s.id)).toEqual(['a']);
  });
  it('matches on DA', () => {
    expect(filterReuseSources(sources, 'cam').map((s) => s.id)).toEqual(['b']);
  });
  it('matches on juris', () => {
    expect(filterReuseSources(sources, 'bellevue').map((s) => s.id)).toEqual(['b']);
  });
  it('is multi-token AND', () => {
    expect(filterReuseSources(sources, 'seattle sfr').map((s) => s.id)).toEqual(['a']);
    expect(filterReuseSources(sources, 'seattle cottages')).toEqual([]);
  });
});

describe('reuseContextLine', () => {
  it('renders Library-style context', () => {
    const line = reuseContextLine({
      id: 'a', address: 'x', juris: 'Seattle', zone: 'LR2', lot_width: 20, lot_depth: 30,
      product_types: ['SFR'], unit_types: [], primaryDa: 'Fisk',
    });
    expect(line).toBe('Seattle · LR2 · 20×30 lot · DA Fisk · SFR');
  });
});

// Component: typeahead filters, selecting copies product_types + unit_types.
const projectsData = [
  project({
    id: 'src', address: '500 Pike St', juris: 'Seattle', product_types: ['SFR'],
    unit_types: [{ label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1, stories: 2 }] as unknown as Project['unit_types'],
  }),
  project({ id: 'other', address: '9 Cedar Ave', juris: 'Bellevue', product_types: ['Cottages'] }),
];

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsData, isLoading: false }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [permit({ id: 1, project_id: 'src', type: 'Building Permit', da: 'Fisk' })],
    isLoading: false,
  }),
}));

import ReuseSourcePicker from '../components/wizard/ReuseSourcePicker';

describe('<ReuseSourcePicker />', () => {
  it('filters results as you type and copies product_types + unit_types on select', () => {
    const onSelect = vi.fn();
    render(<ReuseSourcePicker onSelect={onSelect} />);
    // No results shown until the user types.
    expect(screen.queryByTestId('reuse-source-results')).toBeNull();
    fireEvent.change(screen.getByTestId('reuse-source-search'), {
      target: { value: 'pike' },
    });
    expect(screen.getByTestId('reuse-source-option-src')).toBeInTheDocument();
    expect(screen.queryByTestId('reuse-source-option-other')).toBeNull();
    fireEvent.click(screen.getByTestId('reuse-source-option-src'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const s = onSelect.mock.calls[0][0] as ReuseSource;
    expect(s.id).toBe('src');
    expect(s.product_types).toEqual(['SFR']);
    expect(s.unit_types).toEqual([
      { label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1, stories: 2 },
    ]);
  });

  it('fix-212: copied units still resolve their label against the copied product types', () => {
    // The source carries a single product type ['SFR'] with a legacy "Type A"
    // label. Copy-once preserves the raw rows; resolveUnitTypesForSave (run by
    // both editors) makes the single product type authoritative → "SFR".
    const src = buildReuseSources(
      [projectsData[0]],
      new Map(),
    )[0];
    const saved = resolveUnitTypesForSave(src.unit_types, src.product_types);
    expect(saved[0].label).toBe('SFR');
  });
});
