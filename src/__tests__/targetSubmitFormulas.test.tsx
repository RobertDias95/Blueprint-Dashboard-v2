import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  formulaScopeKey,
  resolveTargetSubmitOffset,
} from '../hooks/useTargetSubmitFormulas';
import type { TargetSubmitFormula } from '../lib/database.types';

// fix-154: per-type × per-jurisdiction target_submit offset overrides.
//
// Resolution (per-juris → Base → null) is tested as a pure unit against
// resolveTargetSubmitOffset, the exact mirror of the SQL bp_target_submit_offset
// resolver (live-verified: Seattle BP override=45 wins, Kirkland falls to
// Base=21, unknown type → NULL). The Settings editor wiring (edit Base, add
// override, remove override) is tested against TargetSubmitFormulasEditor with
// the mutation hooks mocked.
//
// Server-side Base-delete refusal verified live: bp_delete_target_submit_formula
// ('Building Permit', NULL) returns 0 (the IF jurisdiction IS NULL guard fires
// before any delete) — and the editor never renders a remove button on a Base
// row, so the UI can't request it.

const NOW = '2026-06-10T12:00:00Z';

function fixtureMap(rows: TargetSubmitFormula[]): Map<string, TargetSubmitFormula> {
  const m = new Map<string, TargetSubmitFormula>();
  for (const r of rows) m.set(formulaScopeKey(r.type, r.jurisdiction), r);
  return m;
}

describe('resolveTargetSubmitOffset (fix-154 resolver)', () => {
  const rows: TargetSubmitFormula[] = [
    { type: 'Building Permit', jurisdiction: null, offset_days: 21, updated_at: NOW },
    { type: 'Building Permit', jurisdiction: 'Seattle', offset_days: 45, updated_at: NOW },
    { type: 'Demolition', jurisdiction: null, offset_days: 37, updated_at: NOW },
  ];
  const map = fixtureMap(rows);

  it('returns Base when no per-juris override exists', () => {
    expect(resolveTargetSubmitOffset(map, 'Building Permit', 'Kirkland')).toBe(21);
    expect(resolveTargetSubmitOffset(map, 'Demolition', 'Seattle')).toBe(37);
    // Base view itself.
    expect(resolveTargetSubmitOffset(map, 'Building Permit', null)).toBe(21);
  });

  it('returns the per-juris offset when an override exists', () => {
    expect(resolveTargetSubmitOffset(map, 'Building Permit', 'Seattle')).toBe(45);
  });

  it('returns null when neither override nor Base exists (unknown type)', () => {
    expect(resolveTargetSubmitOffset(map, 'NoSuchType', 'Seattle')).toBeNull();
    expect(resolveTargetSubmitOffset(map, 'NoSuchType', null)).toBeNull();
  });
});

// ---- Settings editor wiring ----

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const NOW = '2026-06-10T12:00:00Z';
  const formulas = [
    { type: 'Building Permit', jurisdiction: null, offset_days: 21, updated_at: NOW },
    { type: 'Demolition', jurisdiction: null, offset_days: 37, updated_at: NOW },
    { type: 'Building Permit', jurisdiction: 'Seattle', offset_days: 45, updated_at: NOW },
  ];
  const byScope = new Map<string, (typeof formulas)[number]>();
  for (const f of formulas) byScope.set(`${f.type}||${f.jurisdiction ?? ''}`, f);
  return { formulas, byScope, NOW };
});

vi.mock('../hooks/useTargetSubmitFormulas', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useTargetSubmitFormulas')>()),
  useTargetSubmitFormulas: () => ({
    formulas: fixtures.formulas,
    byScope: fixtures.byScope,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertTargetSubmitFormula', () => ({
  useUpsertTargetSubmitFormula: () => ({ mutate: mocks.upsert }),
}));
vi.mock('../hooks/useDeleteTargetSubmitFormula', () => ({
  useDeleteTargetSubmitFormula: () => ({ mutate: mocks.remove }),
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [
      { name: 'Seattle', learn_window_days: 120, notes: null },
      { name: 'Kirkland', learn_window_days: 120, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import TargetSubmitFormulasEditor from '../components/Settings/TargetSubmitFormulasEditor';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderEditor(readOnly = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TargetSubmitFormulasEditor readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('<TargetSubmitFormulasEditor /> (fix-154)', () => {
  it('Base view lists one row per type with the Base offset and no remove button', () => {
    renderEditor();
    expect(screen.getByTestId('target-submit-formulas-section')).toBeInTheDocument();
    const bp = screen.getByTestId('tsf-offset-Building Permit-base') as HTMLInputElement;
    expect(bp.value).toBe('21');
    expect(screen.getByTestId('tsf-row-Demolition-base')).toBeInTheDocument();
    // Base rows are not removable.
    expect(
      screen.queryByTestId('tsf-remove-Building Permit-Seattle'),
    ).not.toBeInTheDocument();
  });

  it('editing a Base offset upserts the (type, NULL) row', () => {
    renderEditor();
    const input = screen.getByTestId('tsf-offset-Building Permit-base') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '28' } });
    fireEvent.blur(input);
    expect(mocks.upsert).toHaveBeenCalledWith({
      type: 'Building Permit',
      jurisdiction: null,
      offset_days: 28,
      expected_updated_at: fixtures.NOW,
    });
  });

  it('an unchanged Base offset does not fire an upsert', () => {
    renderEditor();
    const input = screen.getByTestId('tsf-offset-Demolition-base') as HTMLInputElement;
    fireEvent.blur(input); // value still 37
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('a per-juris view shows the override (editable + removable) and Base-inheriting rows', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('tsf-juris'), { target: { value: 'Seattle' } });
    // BP has a Seattle override (45) → editable + removable.
    const bp = screen.getByTestId('tsf-offset-Building Permit-Seattle') as HTMLInputElement;
    expect(bp.value).toBe('45');
    expect(
      screen.getByTestId('tsf-remove-Building Permit-Seattle'),
    ).toBeInTheDocument();
    // Demolition has no Seattle override → empty input with Base placeholder, no remove.
    const demo = screen.getByTestId('tsf-offset-Demolition-Seattle') as HTMLInputElement;
    expect(demo.value).toBe('');
    expect(demo.placeholder).toBe('Base: 37');
    expect(screen.queryByTestId('tsf-remove-Demolition-Seattle')).not.toBeInTheDocument();
  });

  it('adding a per-juris override upserts a new (type, juris) row', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('tsf-juris'), { target: { value: 'Seattle' } });
    const demo = screen.getByTestId('tsf-offset-Demolition-Seattle') as HTMLInputElement;
    fireEvent.change(demo, { target: { value: '50' } });
    fireEvent.blur(demo);
    expect(mocks.upsert).toHaveBeenCalledWith({
      type: 'Demolition',
      jurisdiction: 'Seattle',
      offset_days: 50,
      expected_updated_at: null, // brand-new override
    });
  });

  it('removing a per-juris override deletes that row only', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('tsf-juris'), { target: { value: 'Seattle' } });
    fireEvent.click(screen.getByTestId('tsf-remove-Building Permit-Seattle'));
    expect(mocks.remove).toHaveBeenCalledWith({
      type: 'Building Permit',
      jurisdiction: 'Seattle',
    });
  });

  it('read-only disables the offset inputs and hides remove buttons', () => {
    renderEditor(true);
    fireEvent.change(screen.getByTestId('tsf-juris'), { target: { value: 'Seattle' } });
    const bp = screen.getByTestId('tsf-offset-Building Permit-Seattle') as HTMLInputElement;
    expect(bp.disabled).toBe(true);
    expect(
      screen.queryByTestId('tsf-remove-Building Permit-Seattle'),
    ).not.toBeInTheDocument();
  });
});
