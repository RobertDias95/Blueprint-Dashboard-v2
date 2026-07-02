import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Project } from '../lib/database.types';
import type { ReuseSource } from '../components/wizard/reuseSourceHelpers';

// fix-216: ReuseEditor — badge + set/change/clear on the Project Overview.

const updateMutate = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutate: updateMutate, isPending: false }),
}));

// Mock the picker to a single button that fires onSelect with a canned source,
// so the editor's copy/confirm/clear logic is tested in isolation.
const CANNED: ReuseSource = {
  id: 'src',
  address: '500 Pike St',
  juris: 'Seattle',
  zone: 'LR2',
  lot_width: 20,
  lot_depth: 30,
  product_types: ['SFR'],
  unit_types: [{ label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1, stories: 2 }],
  primaryDa: 'Fisk',
};
vi.mock('../components/wizard/ReuseSourcePicker', () => ({
  default: ({ onSelect }: { onSelect: (s: ReuseSource) => void }) => (
    <button data-testid="mock-pick" onClick={() => onSelect(CANNED)}>
      pick
    </button>
  ),
}));

import ReuseEditor from '../components/ProjectDetail/ReuseEditor';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    address: '9 Cedar Ave',
    juris: 'Seattle',
    archived: false,
    unit_types: null,
    reused_from_project_id: null,
    updated_at: '2026-06-15T12:00:00Z',
    ...over,
  } as unknown as Project;
}

const SOURCE_PROJECT = project({ id: 'src', address: '500 Pike St' });

function renderEditor(p: Project, all: Project[] = [p]) {
  return render(
    <MemoryRouter>
      <ReuseEditor project={p} allProjects={all} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  updateMutate.mockClear();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('ReuseEditor', () => {
  it('renders a "Reuse of <address>" badge linking to the source', () => {
    const p = project({ reused_from_project_id: 'src' });
    renderEditor(p, [p, SOURCE_PROJECT]);
    const link = screen.getByTestId('pd-reuse-source-link');
    expect(link.textContent).toMatch(/Reuse of 500 Pike St/);
    expect(link.getAttribute('href')).toBe('/project/src');
  });

  it('set on a project with NO units copies product_types + unit_types + link (no confirm)', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const p = project({ unit_types: [] });
    renderEditor(p);
    fireEvent.click(screen.getByTestId('pd-reuse-set'));
    fireEvent.click(screen.getByTestId('mock-pick'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0].patch).toEqual({
      reused_from_project_id: 'src',
      product_types: ['SFR'],
      unit_types: [{ label: 'Type A', width_ft: 20, depth_ft: 30, qty: 1, stories: 2 }],
    });
  });

  it('set on a project WITH existing units confirms before clobbering; declining aborts', () => {
    const confirmSpy = vi.fn(() => false); // user declines
    vi.stubGlobal('confirm', confirmSpy);
    const p = project({
      unit_types: [{ label: 'Custom', width_ft: 40, depth_ft: 60, qty: 2, stories: 3 }],
    });
    renderEditor(p);
    fireEvent.click(screen.getByTestId('pd-reuse-set'));
    fireEvent.click(screen.getByTestId('mock-pick'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateMutate).not.toHaveBeenCalled(); // declined → no clobber
  });

  it('set WITH existing units + confirm proceeds with the copy', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const p = project({
      unit_types: [{ label: 'Custom', width_ft: 40, depth_ft: 60, qty: 2, stories: 3 }],
    });
    renderEditor(p);
    fireEvent.click(screen.getByTestId('pd-reuse-set'));
    fireEvent.click(screen.getByTestId('mock-pick'));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0].patch.reused_from_project_id).toBe('src');
  });

  it('clear removes the LINK only (keeps current data)', () => {
    const p = project({ reused_from_project_id: 'src' });
    renderEditor(p, [p, SOURCE_PROJECT]);
    fireEvent.click(screen.getByTestId('pd-reuse-clear'));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0].patch).toEqual({
      reused_from_project_id: null,
    });
  });

  it('shows a "reused by N" indicator when other projects template off this one', () => {
    const p = project({ id: 'p-1' });
    const child1 = project({ id: 'c1', reused_from_project_id: 'p-1' });
    const child2 = project({ id: 'c2', reused_from_project_id: 'p-1' });
    renderEditor(p, [p, child1, child2]);
    expect(screen.getByTestId('pd-reused-by').textContent).toMatch(/reused by 2/);
  });
});
