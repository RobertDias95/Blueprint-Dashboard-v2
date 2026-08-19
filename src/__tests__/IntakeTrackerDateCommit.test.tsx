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
//
// ★★ fix-349 REPAIR — THE FIXTURE WAS PINNED TO A DATE THAT EXPIRED.
//
// intake_date was the literal '2026-08-04'. IntakeTracker renders future weeks
// plus "Recent Submissions (last 10 business days)", so on 2026-08-19 that row
// fell out of BOTH and every assertion here failed with "unable to find
// intake-date-46" — the row was not on screen at all. Nothing about the
// component or fix-258's contract changed; the calendar did.
//
// ★ This failure was already on origin/main before fix-349 branched, and is
// repaired here rather than left red because a red main blocks every merge.
// The dates are now RELATIVE to today, so the suite cannot expire again:
//
//     ORIGINAL   a week out — a future week, always rendered, which is also
//                what "Week of Aug 3-7" was on the day Miles recorded it
//     CORRUPT    31 days earlier — stands in for the transient
//                month-decremented value the native picker fires mid-typing,
//                and is outside the displayed week exactly as 2026-07-04 was
//     CORRECTED  two weeks out — "what Miles meant"
//     ON_ENTER   eight days out — a distinct third value for the Enter case

const mutate = vi.fn();

/** A YYYY-MM-DD date `n` days from today, at UTC noon so it never drifts. */
function isoDaysFromToday(n: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ORIGINAL = isoDaysFromToday(7);
const CORRUPT = isoDaysFromToday(-24);
const CORRECTED = isoDaysFromToday(14);
const ON_ENTER = isoDaysFromToday(8);

const fixtures = {
  intakes: [
    {
      id: 46,
      project_id: null,
      permit_id: 900,
      address: '3921 43rd Ave S',
      permit_num: '7133442-CN',
      permit_type: 'Building Permit',
      intake_date: ORIGINAL,
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
    fireEvent.change(input, { target: { value: CORRUPT } });
    fireEvent.change(input, { target: { value: isoDaysFromToday(-14) } });
    fireEvent.change(input, { target: { value: CORRECTED } });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('the 7133442-CN scenario commits only the final date', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    fireEvent.change(input, { target: { value: CORRUPT } });   // the corruption
    fireEvent.change(input, { target: { value: CORRECTED } }); // what Miles meant
    fireEvent.blur(input);

    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0][0];
    expect(arg.patch.intake_date).toBe(CORRECTED);
    // The date that made the permit disappear never reached the server.
    const everySent = mutate.mock.calls.map(
      (c) => (c[0] as { patch: { intake_date: string } }).patch.intake_date,
    );
    expect(everySent).not.toContain(CORRUPT);
  });

  it('blurring without an edit fires no mutation', () => {
    renderIt();
    fireEvent.blur(screen.getByTestId('intake-date-46'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('re-typing back to the original value fires no mutation', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    fireEvent.change(input, { target: { value: CORRUPT } });
    fireEvent.change(input, { target: { value: ORIGINAL } });
    fireEvent.blur(input);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('Escape reverts the draft and commits nothing', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46') as HTMLInputElement;
    fireEvent.change(input, { target: { value: CORRUPT } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe(ORIGINAL);
    fireEvent.blur(input);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('commits on Enter', () => {
    renderIt();
    const input = screen.getByTestId('intake-date-46');
    fireEvent.change(input, { target: { value: ON_ENTER } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].patch.intake_date).toBe(ON_ENTER);
  });
});
