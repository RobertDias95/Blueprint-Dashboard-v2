import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-258: end-to-end regression at the actual bug site.
//
// Miles's recording, 2026-07-28: editing an intake date on Seattle Intakes, the
// "Week of Aug 3-7" group dropped 4 -> 3 and permit 7133442-CN (3921 43rd Ave S)
// vanished from the whole list. intake_records id=46 went 2026-08-04 ->
// 2026-07-04: the native date input fired onChange on the transient
// month-decremented value, InlineDate committed it, and July 4 falls outside
// the displayed week. The mutation's refetch then re-synced the controlled
// input and snapped the picker shut.
//
// These assertions fail on the pre-fix component.

const mutate = vi.fn();

const fixtures = {
  intakes: [
    {
      id: 46,
      project_id: null,
      permit_id: 900,
      address: '3921 43rd Ave S',
      permit_num: '7133442-CN',
      permit_type: 'Building Permit',
      intake_date: '2026-08-04',
      is_placeholder: false,
      portal_url: null,
      link: null,
      created_at: null,
      updated_at: '2026-07-28T20:00:00Z',
    },
  ],
  permits: [] as unknown[],
};

vi.mock('../hooks/useIntakeRecords', () => ({
  useIntakeRecords: () => ({
    data: fixtures.intakes,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [{ name: 'Building Permit', is_builtin: true, notes: null }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useUpsertIntakeRecord', () => ({
  useUpsertIntakeRecord: () => ({ mutate }),
}));
vi.mock('../hooks/useDeleteIntakeRecord', () => ({
  useDeleteIntakeRecord: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useSwapIntakeDates', () => ({
  useSwapIntakeDates: () => ({ mutate: vi.fn() }),
}));

import IntakeTracker from '../components/IntakeTracker';

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntakeTracker />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mutate.mockClear();
  useAuthStore.setState({ activeTenantId: 'tenant-0' });
});

describe('IntakeTracker intake date — fix-258', () => {
  it('typing through an intermediate date fires NO mutation', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    // Every one of these fired a save on the pre-fix code.
    fireEvent.change(input, { target: { value: '2026-07-04' } });
    fireEvent.change(input, { target: { value: '2026-07-14' } });
    fireEvent.change(input, { target: { value: '2026-08-14' } });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('the 7133442-CN scenario commits only the final date', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    fireEvent.change(input, { target: { value: '2026-07-04' } }); // the corruption
    fireEvent.change(input, { target: { value: '2026-08-11' } }); // what Miles meant
    fireEvent.blur(input);

    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0][0];
    expect(arg.patch.intake_date).toBe('2026-08-11');
    // The date that made the permit disappear never reached the server.
    const everySent = mutate.mock.calls.map(
      (c) => (c[0] as { patch: { intake_date: string } }).patch.intake_date,
    );
    expect(everySent).not.toContain('2026-07-04');
  });

  it('blurring without an edit fires no mutation', () => {
    renderIt();
    fireEvent.blur(screen.getByTestId('intake-date-46'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('re-typing back to the original value fires no mutation', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    fireEvent.change(input, { target: { value: '2026-07-04' } });
    fireEvent.change(input, { target: { value: '2026-08-04' } });
    fireEvent.blur(input);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('Escape reverts the draft and commits nothing', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-07-04' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('2026-08-04');
    fireEvent.blur(input);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('commits on Enter', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    fireEvent.change(input, { target: { value: '2026-08-18' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].patch.intake_date).toBe('2026-08-18');
  });
});
