import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import Step3Permits from '../components/wizard/Step3Permits';
import {
  makeEmptyWizardState,
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from '../components/wizard/wizardState';

// fix-22-final: DA list now sourced from team_members (role='da' AND
// active=true) so members like Cam + Shire — who aren't on a draw-
// schedule lane yet — still appear. Replaces the previous
// useDmDaGroups source.

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      // ENT: Bobby has both legacy + lead variants — dedup'd to one entry.
      { id: '1a', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '1b', name: 'Bobby', role: 'ent_lead', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '2', name: 'Alex', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '3', name: 'Jade', role: 'dm', active: true, former: false, email: null, notes: null, updated_at: '' },
      // DAs from the active roster: Cam + Shire included even though no
      // dm_da_groups lane exists for them yet.
      { id: 'da-trevor', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-cam', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-shire', name: 'Shire', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-old', name: 'OldDa', role: 'da', active: false, former: true, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));

function permit(type: string, partial: Partial<WizardPermit> = {}): WizardPermit {
  return {
    rowId: newPermitRowId(),
    type,
    selected: true,
    ent_lead: '',
    dm: '',
    da: '',
    dual_da: '',
    architect: '',
    num: '',
    expected_issue: '',
    taskTemplateIds: [],
    ...partial,
  };
}

/** Controlled wrapper — Step3Permits' useEffect appends the BP row via
 *  onChange; without a stateful host that patch would never persist and
 *  the BP-related tests would never see it. */
function ControlledHost({ initial }: { initial: WizardState }) {
  const [state, setState] = useState(initial);
  return (
    <Step3Permits
      value={state}
      onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
    />
  );
}

function setup(initial: WizardState = makeEmptyWizardState()) {
  const onChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = render(<Step3Permits value={initial} onChange={onChange} />, {
    wrapper,
  });
  return { ...utils, onChange };
}

function setupControlled(initial: WizardState) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ControlledHost initial={initial} />, { wrapper });
}

describe('<Step3Permits />', () => {
  it('auto-injects a Building Permit row via onChange when none exists', async () => {
    const init = makeEmptyWizardState();
    init.entitlement_lead = 'Bobby';
    init.design_manager = 'Jade';
    const { onChange } = setup(init);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const patch = onChange.mock.calls[0][0] as Partial<WizardState>;
    expect(patch.permits).toBeDefined();
    expect(
      patch.permits!.some((p) => p.type === 'Building Permit' && p.selected),
    ).toBe(true);
  });

  it('renders one row per selected permit', () => {
    const init = makeEmptyWizardState();
    init.permits = [
      permit('Building Permit', { ent_lead: 'Alex' }),
      permit('PAR/Pre-Sub', { ent_lead: 'Bobby' }),
      permit('Demolition', { selected: false }),
    ];
    setup(init);
    expect(screen.getByText('Building Permit')).toBeInTheDocument();
    expect(screen.getByText('PAR/Pre-Sub')).toBeInTheDocument();
    expect(screen.queryByText('Demolition')).toBeNull();
  });

  it('ENT dropdown lists ent+ent_lead, deduped by name', () => {
    const init = makeEmptyWizardState();
    init.permits = [permit('Building Permit', { ent_lead: 'Bobby' })];
    setup(init);
    const sel = screen.getByTestId(
      `wizard-perm-ent-${init.permits[0].rowId}`,
    ) as HTMLSelectElement;
    const names = [...sel.options].map((o) => o.value);
    expect(names).toContain('Bobby');
    expect(names).toContain('Alex');
    expect(names.filter((n) => n === 'Bobby')).toHaveLength(1);
  });

  it('DA dropdown is sourced from team_members (includes Cam + Shire)', () => {
    const init = makeEmptyWizardState();
    init.permits = [permit('Building Permit')];
    setup(init);
    const sel = screen.getByTestId(
      `wizard-perm-da-${init.permits[0].rowId}`,
    ) as HTMLSelectElement;
    const names = [...sel.options]
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(names).toContain('Cam');
    expect(names).toContain('Shire');
    expect(names).toContain('Trevor');
    // Inactive DA excluded.
    expect(names).not.toContain('OldDa');
  });

  it('DA dropdown is sorted alphabetically', () => {
    const init = makeEmptyWizardState();
    init.permits = [permit('Building Permit')];
    setup(init);
    const sel = screen.getByTestId(
      `wizard-perm-da-${init.permits[0].rowId}`,
    ) as HTMLSelectElement;
    const names = [...sel.options]
      .map((o) => o.value)
      .filter((v) => v !== '');
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('changing the per-permit ENT propagates a value.permits patch', () => {
    const init = makeEmptyWizardState();
    init.permits = [
      permit('Building Permit', { ent_lead: 'Alex' }),
      permit('PAR/Pre-Sub', { ent_lead: 'Alex' }),
    ];
    const { onChange } = setup(init);
    const sel = screen.getByTestId(
      `wizard-perm-ent-${init.permits[1].rowId}`,
    );
    fireEvent.change(sel, { target: { value: 'Bobby' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0] as Partial<WizardState>;
    expect(patch.permits!.find((p) => p.rowId === init.permits[1].rowId)!.ent_lead).toBe(
      'Bobby',
    );
    expect(patch.permits!.find((p) => p.rowId === init.permits[0].rowId)!.ent_lead).toBe(
      'Alex',
    );
  });

  it('setting ACQ Target Date updates expected_issue on the right permit (fix-25c)', () => {
    const init = makeEmptyWizardState();
    // Seed BP so the useEffect-driven auto-injection doesn't fire and
    // doesn't claim onChange.mock.calls[0].
    init.permits = [permit('Building Permit'), permit('PAR/Pre-Sub')];
    const par = init.permits[1];
    const { onChange } = setup(init);
    fireEvent.change(
      screen.getByTestId(`wizard-perm-target-${par.rowId}`),
      { target: { value: '2026-06-01' } },
    );
    // fix-25c: the input now lands on expected_issue (target ISSUE date),
    // not target_submit. Find the patch call that carries expected_issue.
    const targetCall = onChange.mock.calls.find((c) => {
      const patch = c[0] as Partial<WizardState>;
      return patch.permits?.some((p) => p.expected_issue === '2026-06-01');
    });
    expect(targetCall).toBeTruthy();
    const patch = targetCall![0] as Partial<WizardState>;
    expect(
      patch.permits!.find((p) => p.rowId === par.rowId)!.expected_issue,
    ).toBe('2026-06-01');
  });

  it('BP rowId is stable across re-renders (fixes scroll-jump on edit)', async () => {
    // Reproduces the scroll-jump root cause: the previous useMemo-based
    // BP injection generated a NEW rowId on every render. With the
    // useEffect-based persistence, the BP row gets inserted into state
    // exactly once — every subsequent render reads the same rowId.
    const init = makeEmptyWizardState();
    init.entitlement_lead = 'Bobby';
    const { container } = setupControlled(init);
    // Wait for the effect-driven BP insertion to settle.
    await waitFor(() => {
      const row = container.querySelector('[data-testid^="wizard-perm-row-"]');
      expect(row).toBeTruthy();
    });
    const firstRowEl = container.querySelector(
      '[data-testid^="wizard-perm-row-"]',
    ) as HTMLElement;
    const firstRowId = firstRowEl.getAttribute('data-testid');
    expect(firstRowId).toMatch(/^wizard-perm-row-wp-/);

    // Edit a field on the row. Previously this would have caused
    // re-render → new makeBpPermit() call → fresh rowId. Now stable.
    const entSelMatch = firstRowEl.querySelector('select');
    if (entSelMatch) fireEvent.change(entSelMatch, { target: { value: 'Alex' } });

    // After edit, the same rowId should still be present.
    const sameRowEl = container.querySelector(
      `[data-testid="${firstRowId}"]`,
    );
    expect(sameRowEl).toBeTruthy();
  });
});
