import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import Step4TaskReview from '../components/wizard/Step4TaskReview';
import {
  makeEmptyWizardState,
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from '../components/wizard/wizardState';

vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({
    templates: [
      {
        id: 'tpl-bp-1',
        permit_type: 'Building Permit',
        jurisdiction: 'Seattle',
        bucket: 'de',
        text: 'BP-Seattle DE task',
        cat: 'doc',
        default_assignee: null,
        default_target_offset: null,
        sort_order: 0,
        updated_at: '',
      },
      {
        id: 'tpl-bp-2',
        permit_type: 'Building Permit',
        jurisdiction: null,
        bucket: 'pm',
        text: 'BP base PM task',
        cat: null,
        default_assignee: null,
        default_target_offset: null,
        sort_order: 1,
        updated_at: '',
      },
      {
        id: 'tpl-bp-other',
        permit_type: 'Building Permit',
        jurisdiction: 'Phoenix',
        bucket: 'de',
        text: 'BP-Phoenix DE task',
        cat: null,
        default_assignee: null,
        default_target_offset: null,
        sort_order: 2,
        updated_at: '',
      },
      {
        id: 'tpl-par-1',
        permit_type: 'PAR/Pre-Sub',
        jurisdiction: null,
        bucket: 'de',
        text: 'PAR base DE task',
        cat: null,
        default_assignee: null,
        default_target_offset: null,
        sort_order: 0,
        updated_at: '',
      },
    ],
    subtasks: [],
    byScope: new Map(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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
    target_submit: '',
    taskTemplateIds: [],
    ...partial,
  };
}

function ControlledWrapper({ initial }: { initial: WizardState }) {
  const [state, setState] = useState(initial);
  return (
    <Step4TaskReview
      value={state}
      onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
    />
  );
}

function setup(initial: WizardState) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ControlledWrapper initial={initial} />, { wrapper });
}

describe('<Step4TaskReview />', () => {
  it('renders one section per selected permit', () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit'), permit('PAR/Pre-Sub')];
    setup(init);
    expect(
      screen.getByTestId(`wizard-task-section-${init.permits[0].rowId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`wizard-task-section-${init.permits[1].rowId}`),
    ).toBeInTheDocument();
  });

  it('only renders templates matching permit_type + (jurisdiction = juris OR NULL)', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    // Seattle + base templates render; Phoenix-only template does not.
    await waitFor(() => {
      expect(
        screen.getByTestId(`wizard-task-row-${row.rowId}-tpl-bp-1`),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`wizard-task-row-${row.rowId}-tpl-bp-2`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`wizard-task-row-${row.rowId}-tpl-bp-other`),
    ).toBeNull();
    // PAR template doesn't render on the BP row.
    expect(
      screen.queryByTestId(`wizard-task-row-${row.rowId}-tpl-par-1`),
    ).toBeNull();
  });

  it('auto-seeds taskTemplateIds with every applicable template on first render', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    // Both BP-applicable templates should be checked after seed.
    await waitFor(() => {
      const box = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
      ) as HTMLInputElement;
      expect(box.checked).toBe(true);
    });
    const box2 = screen.getByTestId(
      `wizard-task-checkbox-${row.rowId}-tpl-bp-2`,
    ) as HTMLInputElement;
    expect(box2.checked).toBe(true);
  });

  it('unchecking a task removes it from taskTemplateIds', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    const box = await screen.findByTestId(
      `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
    );
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    fireEvent.click(box);
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(false));
  });

  it('"Clear all" sets taskTemplateIds to []', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    // Wait for seed.
    await screen.findByTestId(`wizard-task-checkbox-${row.rowId}-tpl-bp-1`);
    fireEvent.click(screen.getByTestId(`wizard-task-clear-all-${row.rowId}`));
    await waitFor(() => {
      const b1 = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
      ) as HTMLInputElement;
      const b2 = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-2`,
      ) as HTMLInputElement;
      expect(b1.checked).toBe(false);
      expect(b2.checked).toBe(false);
    });
  });

  it('"Select all" restores the full applicable set', async () => {
    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit')];
    setup(init);
    const row = init.permits[0];
    await screen.findByTestId(`wizard-task-checkbox-${row.rowId}-tpl-bp-1`);
    fireEvent.click(screen.getByTestId(`wizard-task-clear-all-${row.rowId}`));
    fireEvent.click(screen.getByTestId(`wizard-task-select-all-${row.rowId}`));
    await waitFor(() => {
      const b1 = screen.getByTestId(
        `wizard-task-checkbox-${row.rowId}-tpl-bp-1`,
      ) as HTMLInputElement;
      expect(b1.checked).toBe(true);
    });
  });
});
