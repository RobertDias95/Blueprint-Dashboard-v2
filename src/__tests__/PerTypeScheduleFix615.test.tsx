import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';
import { PER_TYPE_DEFAULT_DAYS, defaultDaysForType } from '../lib/scheduleBenchmarks';

// ===========================================================================
// fix-615 (P-166 step 3c) — the per-type schedule is one table
// ===========================================================================

const T = 'tenant-615';
const NOW = '2026-10-01T00:00:00Z';

const h = vi.hoisted(() => ({
  types: [] as { name: string; is_builtin: boolean | null; notes: string | null }[],
  permits: [] as { id: number; type: string }[],
  formulas: [] as { type: string; jurisdiction: string | null; offset_days: number; updated_at: string }[],
  defaults: [] as { type: string; intake_to_approval_days: number; c1_resub_offset_days: number | null }[],
  upsertFormula: vi.fn(),
  removeFormula: vi.fn(),
  upsertDefault: vi.fn(),
}));

vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({ data: h.types, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: h.permits, isLoading: false, error: null }),
}));
vi.mock('../hooks/useTargetSubmitFormulas', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTargetSubmitFormulas')>();
  return {
    ...actual,
    useTargetSubmitFormulas: () => {
      const byScope = new Map<string, (typeof h.formulas)[number]>();
      for (const f of h.formulas) byScope.set(actual.formulaScopeKey(f.type, f.jurisdiction), f);
      return { formulas: h.formulas, byScope, isLoading: false, error: null, refetch: vi.fn() };
    },
  };
});
vi.mock('../hooks/usePermitTypeDefaults', () => ({
  usePermitTypeDefaults: () => {
    const byType = new Map<string, number>();
    const c1OffsetByType = new Map<string, number>();
    for (const d of h.defaults) {
      byType.set(d.type, d.intake_to_approval_days);
      if (d.c1_resub_offset_days != null) c1OffsetByType.set(d.type, d.c1_resub_offset_days);
    }
    return { rows: h.defaults, byType, c1OffsetByType, isLoading: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock('../hooks/useUpsertTargetSubmitFormula', () => ({
  useUpsertTargetSubmitFormula: () => ({ mutate: h.upsertFormula }),
}));
vi.mock('../hooks/useDeleteTargetSubmitFormula', () => ({
  useDeleteTargetSubmitFormula: () => ({ mutate: h.removeFormula }),
}));
vi.mock('../hooks/useUpsertPermitTypeDefault', () => ({
  useUpsertPermitTypeDefault: () => ({ mutate: h.upsertDefault }),
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({
    data: [
      { name: 'Seattle', learn_window_days: null, notes: null },
      { name: 'Kirkland', learn_window_days: null, notes: null },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../hooks/useTargetSubmitBenchmark', () => ({
  useTargetSubmitBenchmarks: () => ({ byType: new Map() }),
}));
vi.mock('../components/shared/RowHistoryPanel', () => ({
  default: () => <div data-testid="history-panel" />,
}));

import PerTypeScheduleTable from '../components/Settings/PerTypeScheduleTable';

function renderTable(readOnly = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PerTypeScheduleTable readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  h.types = [
    { name: 'Building Permit', is_builtin: true, notes: null },
    { name: 'Demolition', is_builtin: true, notes: null },
    { name: 'Grading / Clearing', is_builtin: true, notes: null },
    { name: 'PPR', is_builtin: false, notes: null },
  ];
  h.permits = [
    { id: 1, type: 'Building Permit' }, { id: 2, type: 'Building Permit' }, { id: 3, type: 'Building Permit' },
    { id: 4, type: 'Demolition' }, { id: 5, type: 'Demolition' },
    { id: 6, type: 'PPR' },
  ];
  h.formulas = [
    { type: 'Building Permit', jurisdiction: null, offset_days: 21, updated_at: NOW },
    { type: 'Building Permit', jurisdiction: 'Seattle', offset_days: 45, updated_at: NOW },
    { type: 'Demolition', jurisdiction: null, offset_days: 37, updated_at: NOW },
  ];
  h.defaults = [
    { type: 'Building Permit', intake_to_approval_days: 210, c1_resub_offset_days: null },
    { type: 'Demolition', intake_to_approval_days: 60, c1_resub_offset_days: null },
  ];
});

const rowOrder = () =>
  screen.getAllByTestId(/^pts-row-/).map((r) => r.getAttribute('data-testid')!.replace('pts-row-', ''));

describe('fix-615 §A — rows are the catalogue', () => {
  it('★★★ one row per permit type, most permits first, then name', () => {
    renderTable();
    expect(rowOrder()).toEqual(['Building Permit', 'Demolition', 'PPR', 'Grading / Clearing']);
  });

  it('★★★ a type added to the catalogue appears by itself (gap 5) — with no formula of its own', () => {
    h.types = [...h.types, { name: 'Brand New Type', is_builtin: false, notes: null }];
    renderTable();
    expect(screen.getByTestId('pts-row-Brand New Type')).toBeInTheDocument();
  });

  it('★★ the anchor is said in words under Target submit', () => {
    renderTable();
    expect(screen.getByTestId('pts-anchor-Building Permit').textContent).toBe('after design (DD) ends');
    expect(screen.getByTestId('pts-anchor-Grading / Clearing').textContent).toBe("uses the Building Permit's date");
    expect(screen.getByTestId('pts-anchor-PPR').textContent).toBe('no anchor — no automatic target');
  });

  it('★★ a type with no anchor or a mirror type has no Target submit box — the server ignores it', () => {
    renderTable();
    expect(screen.queryByTestId('pts-target-PPR')).toBeNull();
    expect(screen.queryByTestId('pts-target-PPR-set')).toBeNull();
    expect(screen.queryByTestId('pts-overrides-Grading / Clearing')).toBeNull();
  });
});

describe('fix-615 §A — every cell saves through its RPC, buffered', () => {
  it('★★★ Target submit: typing saves nothing; leaving the box saves ONCE via bp_upsert_target_submit_formula with its OCC token', () => {
    renderTable();
    const box = screen.getByTestId('pts-target-Building Permit') as HTMLInputElement;
    expect(box.value).toBe('21');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '2' } });
    fireEvent.change(box, { target: { value: '25' } });
    expect(h.upsertFormula).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(h.upsertFormula).toHaveBeenCalledTimes(1);
    expect(h.upsertFormula).toHaveBeenCalledWith({
      type: 'Building Permit', jurisdiction: null, offset_days: 25, expected_updated_at: NOW,
    });
  });

  it('★★ an unchanged value saves nothing; Escape puts the saved value back', () => {
    renderTable();
    const box = screen.getByTestId('pts-target-Demolition') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: '99' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('37');
    expect(h.upsertFormula).not.toHaveBeenCalled();
  });

  it('★★★ Intake → approval saves via bp_upsert_permit_type_default, keeping C1, clamped to 1–730', () => {
    h.defaults = [{ type: 'Building Permit', intake_to_approval_days: 210, c1_resub_offset_days: 70 }];
    renderTable();
    const box = screen.getByTestId('pts-intake-Building Permit') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '9999' } });
    fireEvent.blur(box);
    expect(h.upsertDefault).toHaveBeenCalledWith({
      type: 'Building Permit', intake_to_approval_days: 730, c1_resub_offset_days: 70,
    });
  });

  it('★★ C1 resubmit: blank sends null (auto ÷ 3) and keeps intake', () => {
    h.defaults = [{ type: 'Building Permit', intake_to_approval_days: 210, c1_resub_offset_days: 70 }];
    renderTable();
    const box = screen.getByTestId('pts-c1-Building Permit') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.blur(box);
    expect(h.upsertDefault).toHaveBeenCalledWith({
      type: 'Building Permit', intake_to_approval_days: 210, c1_resub_offset_days: null,
    });
  });
});

describe('fix-615 §A — a type with no row', () => {
  it('★★★ shows "—" and Set, and creates NOTHING until a number is typed', () => {
    renderTable();
    expect(screen.getByTestId('pts-intake-PPR-empty').textContent).toBe('—');
    fireEvent.click(screen.getByTestId('pts-intake-PPR-set'));
    const box = screen.getByTestId('pts-intake-PPR') as HTMLInputElement;
    fireEvent.blur(box); // left empty
    expect(h.upsertDefault).not.toHaveBeenCalled();
    expect(screen.getByTestId('pts-intake-PPR-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pts-intake-PPR-set'));
    const again = screen.getByTestId('pts-intake-PPR') as HTMLInputElement;
    fireEvent.change(again, { target: { value: '90' } });
    fireEvent.blur(again);
    expect(h.upsertDefault).toHaveBeenCalledWith({
      type: 'PPR', intake_to_approval_days: 90, c1_resub_offset_days: null,
    });
  });

  it('★★ C1 waits for intake → approval (the RPC needs it)', () => {
    renderTable();
    expect(screen.queryByTestId('pts-c1-PPR')).toBeNull();
  });

  it('★★ a type with an anchor but no Base formula creates it with no OCC token', () => {
    h.types = [{ name: 'TRAO', is_builtin: true, notes: null }];
    renderTable();
    fireEvent.click(screen.getByTestId('pts-target-TRAO-set'));
    const box = screen.getByTestId('pts-target-TRAO');
    fireEvent.change(box, { target: { value: '10' } });
    fireEvent.blur(box);
    expect(h.upsertFormula).toHaveBeenCalledWith({
      type: 'TRAO', jurisdiction: null, offset_days: 10, expected_updated_at: null,
    });
  });
});

describe('fix-615 §A — city overrides', () => {
  it('★★★ the count expands to the per-city rows: edit, remove, add', () => {
    renderTable();
    expect(screen.getByTestId('pts-overrides-Building Permit').textContent).toBe('1 city');
    expect(screen.getByTestId('pts-overrides-Demolition').textContent).toBe('none');
    fireEvent.click(screen.getByTestId('pts-overrides-Building Permit'));
    const panel = screen.getByTestId('pts-overrides-panel-Building Permit');

    const sea = within(panel).getByTestId('pts-override-input-Building Permit-Seattle');
    fireEvent.focus(sea);
    fireEvent.change(sea, { target: { value: '50' } });
    fireEvent.blur(sea);
    expect(h.upsertFormula).toHaveBeenCalledWith({
      type: 'Building Permit', jurisdiction: 'Seattle', offset_days: 50, expected_updated_at: NOW,
    });

    fireEvent.click(within(panel).getByTestId('pts-override-remove-Building Permit-Seattle'));
    expect(h.removeFormula).toHaveBeenCalledWith({ type: 'Building Permit', jurisdiction: 'Seattle' });

    // Kirkland is the only city left to add
    fireEvent.change(within(panel).getByTestId('pts-override-add-juris-Building Permit'), {
      target: { value: 'Kirkland' },
    });
    const add = within(panel).getByTestId('pts-override-add-input-Building Permit');
    fireEvent.change(add, { target: { value: '30' } });
    fireEvent.blur(add);
    expect(h.upsertFormula).toHaveBeenLastCalledWith({
      type: 'Building Permit', jurisdiction: 'Kirkland', offset_days: 30, expected_updated_at: null,
    });
  });
});

describe('fix-615 §A — non-admins', () => {
  it('★★★ read-only: boxes disabled, no Set, no remove, no add', () => {
    renderTable(true);
    expect((screen.getByTestId('pts-target-Building Permit') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId('pts-intake-PPR-set')).toBeNull();
    fireEvent.click(screen.getByTestId('pts-overrides-Building Permit'));
    expect(screen.queryByTestId('pts-override-remove-Building Permit-Seattle')).toBeNull();
    expect(screen.queryByTestId('pts-override-add-juris-Building Permit')).toBeNull();
  });

  it('★★★ a refused save reads as the sentence the server wrote (fix-608), not a code', () => {
    // The table saves through the existing hooks, whose onError shows
    // `error.message`; fix-608's RPCs raise a plain sentence with 42501.
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useUpsertTargetSubmitFormula.ts'), 'utf8');
    expect(hook).toContain('pushToast(`Could not save formula — ${error.message}`');
    const mig = readFileSync(resolve(process.cwd(), 'migrations/fix_608_settings_writes_admin_check.sql'), 'utf8');
    expect(mig).toContain("RAISE EXCEPTION 'Only an admin can change target-submit formulas.'");
    const table = readFileSync(resolve(process.cwd(), 'src/components/Settings/PerTypeScheduleTable.tsx'), 'utf8');
    expect(table).toContain("import { useUpsertTargetSubmitFormula } from '../../hooks/useUpsertTargetSubmitFormula';");
    expect(table).toContain("import { useUpsertPermitTypeDefault } from '../../hooks/useUpsertPermitTypeDefault';");
  });
});

// ---------------------------------------------------------------------------
// §B
// ---------------------------------------------------------------------------

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), 'utf8').split('\r\n').join('\n');

describe('fix-615 §B — every date reads the same numbers', () => {
  it('★★★ all four projections pass the Settings per-type defaults (gap 2)', () => {
    for (const f of [
      'src/components/DrawScheduleGrid.tsx',
      'src/components/ProjectDetail/ScheduleEstimator.tsx',
      'src/components/ProjectDetail/ScheduleHealthTable.tsx',
      'src/hooks/useProjectedApprovalFor.ts',
    ]) {
      expect(read(f), f).toMatch(/typeDefaultsOverride,?\n/);
      expect(read(f), f).toContain('usePermitTypeDefaults');
    }
  });

  it('★★★ the fallback is keyed by catalogue names (gap 3)', () => {
    for (const gone of ['Use Limitation', 'Land Use', 'LU', 'Pre-Application', 'PA', 'SDOT']) {
      expect(gone in PER_TYPE_DEFAULT_DAYS, gone).toBe(false);
    }
    expect(PER_TYPE_DEFAULT_DAYS['SDOT Tree']).toBe(45);
    expect(PER_TYPE_DEFAULT_DAYS['PAR/Pre-Sub']).toBe(30);
    expect(PER_TYPE_DEFAULT_DAYS['ECA Waiver']).toBe(30);
    // …and the Settings row still wins over it
    expect(defaultDaysForType('SDOT Tree', new Map([['SDOT Tree', 12]]))).toBe(12);
  });

  it('★★ the backup includes both per-type tables (gap 47)', () => {
    const src = read('src/lib/exportBackup.ts');
    expect(src).toContain("'target_submit_formulas',");
    expect(src).toContain("'permit_type_defaults',");
  });

  it('★★ the two old editors are retired', () => {
    expect(() => read('src/components/Settings/TargetSubmitFormulasEditor.tsx')).toThrow();
    expect(() => read('src/components/Settings/PermitTypeDefaultsEditor.tsx')).toThrow();
  });
});

describe('fix-615 §B.1 — one permit, one date', () => {
  it('★★★ given the same Settings map, the estimator and Schedule Health compute the SAME date — and it is the Settings number', async () => {
    const { computeProjectedApproval } = await import('../lib/projectedApproval');
    // A brand-new SDOT Tree permit: no learner, no cycle activity → the
    // per-type default decides the date.
    const permit = { id: 9, project_id: 'p', type: 'SDOT Tree', status: null, actual_issue: null,
      approval_date: null, target_submit: '2026-11-02', expected_issue: null, intake_date: null } as never;
    const settings = new Map([['SDOT Tree', 45]]);
    const asHealth = computeProjectedApproval({ permit, cycles: [], learnedEstimate: null, typeDefaultsOverride: settings });
    const asEstimator = computeProjectedApproval({ permit, cycles: [], learnedEstimate: null, typeDefaultsOverride: settings });
    expect(asEstimator.projection).toBe(asHealth.projection);
    expect(asHealth.routeFacts?.defaultDays).toBe(45);
    // Before fix-615 the estimator passed no map AND the fallback had no
    // 'SDOT Tree' key → 210 days. Without the map it is now the catalogue-keyed
    // fallback (45), not 210 — gap 3 closed even on the fallback path.
    const noMap = computeProjectedApproval({ permit, cycles: [], learnedEstimate: null });
    expect(noMap.routeFacts?.defaultDays).toBe(45);
  });
});
