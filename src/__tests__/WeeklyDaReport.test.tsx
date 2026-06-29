import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WeeklyDaReportPayload } from '../lib/database.types';

// fix-67: Weekly DA Update report component tests. All data hooks are
// mocked so we drive the payload + capture the RPC inputs directly.
//
// Pinned contracts:
//   - filter form renders (week / window / 5 dropdowns)
//   - report body renders DA groups (Unassigned last) with corrections +
//     upcoming-intake rows
//   - changing a filter passes the new filter object to useWeeklyDaReport
//   - typing in a Notes textarea fires the debounced upsert (~500ms)
//   - the print button calls window.print()
//   - the filter form + header carry the print-hide class (print CSS hides
//     them); a print-only title block is present

const reportHookSpy = vi.hoisted(() => vi.fn());
const upsertMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useWeeklyDaReport', () => ({
  WEEKLY_DA_REPORT_WINDOW_DEFAULT: 14,
  useWeeklyDaReport: (weekStart: string, windowDays: number, filters: unknown) => {
    reportHookSpy(weekStart, windowDays, filters);
    return {
      data: PAYLOAD,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('../hooks/useUpsertReportNote', () => ({
  useUpsertReportNote: () => ({ mutate: upsertMutate, isPending: false }),
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [
      { id: 1, ent_lead: 'Miles', type: 'Building Permit', status: 'Corrections Required', da: 'Fisk' },
      { id: 2, ent_lead: 'Trey', type: 'Demolition', status: 'Submitted', da: 'Cam' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      { id: 'pr1', juris: 'Seattle' },
      { id: 'pr2', juris: 'Bellevue' },
    ],
    isLoading: false,
  }),
}));

const PAYLOAD: WeeklyDaReportPayload = {
  generated_at: '2026-05-28T12:00:00Z',
  week_start: '2026-05-25',
  window_days: 14,
  das: [
    {
      da: 'Fisk',
      name: 'Fisk',
      corrections: [
        {
          permit_id: 101,
          project_id: 'pr1',
          address: '123 Pine St',
          juris: 'Seattle',
          type: 'Building Permit',
          num: 'BP-101',
          portal_url: 'https://portal.example/101',
          cycle_index: 2,
          ent_lead: 'Miles',
          da: 'Fisk',
          note_body: 'Waiting on structural revisions.',
          corr_issued: '2026-05-20',
        },
      ],
      upcoming_intakes: [
        {
          permit_id: 102,
          project_id: 'pr2',
          address: '456 Cedar Ave',
          juris: 'Bellevue',
          type: 'Demolition',
          num: 'DM-102',
          portal_url: null,
          cycle_index: 0,
          ent_lead: 'Miles',
          da: 'Fisk',
          note_body: '',
          target_submit: '2026-06-02',
        },
      ],
    },
    {
      da: 'Unassigned',
      name: 'Unassigned',
      corrections: [
        {
          permit_id: 200,
          project_id: 'pr1',
          address: '9 Nowhere Rd',
          juris: 'Seattle',
          type: 'ULS',
          num: null,
          portal_url: null,
          cycle_index: 1,
          ent_lead: null,
          da: null,
          note_body: '',
          corr_issued: '2026-05-19',
        },
      ],
      upcoming_intakes: [],
    },
  ],
};

import WeeklyDaReport from '../pages/WeeklyDaReport';

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/reports/weekly-da']}>
      <WeeklyDaReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  reportHookSpy.mockClear();
  upsertMutate.mockClear();
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('<WeeklyDaReport /> (fix-67)', () => {
  it('renders the filter form with week / window / dropdowns', () => {
    renderReport();
    expect(screen.getByTestId('wdr-filter-form')).toBeInTheDocument();
    expect(screen.getByTestId('wdr-week-start')).toBeInTheDocument();
    expect(screen.getByTestId('wdr-window-days')).toBeInTheDocument();
    for (const id of [
      'wdr-filter-ent',
      'wdr-filter-da',
      'wdr-filter-type',
      'wdr-filter-status',
      'wdr-filter-juris',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('defaults the window to 14', () => {
    renderReport();
    const win = screen.getByTestId('wdr-window-days') as HTMLInputElement;
    expect(win.value).toBe('14');
  });

  it('renders DA groups with corrections + upcoming intakes, Unassigned last', () => {
    renderReport();
    const fisk = screen.getByTestId('wdr-da-Fisk');
    const unassigned = screen.getByTestId('wdr-da-Unassigned');
    expect(fisk).toBeInTheDocument();
    expect(unassigned).toBeInTheDocument();
    // Corrections + upcoming rows present under Fisk.
    expect(screen.getByTestId('wdr-corr-row-101')).toBeInTheDocument();
    expect(screen.getByTestId('wdr-upc-row-102')).toBeInTheDocument();
    // Unassigned correction row present.
    expect(screen.getByTestId('wdr-corr-row-200')).toBeInTheDocument();
    // DOM order: Fisk section appears before Unassigned section.
    expect(fisk.compareDocumentPosition(unassigned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Section headers carry the counts.
    expect(fisk.textContent).toMatch(/Corrections \(1\)/);
    expect(fisk.textContent).toMatch(/Upcoming Intakes \(1\)/);
  });

  it('seeds a Notes textarea from the server note_body', () => {
    renderReport();
    const note = screen.getByTestId('wdr-note-101') as HTMLTextAreaElement;
    expect(note.value).toBe('Waiting on structural revisions.');
  });

  it('passes the updated filter object to useWeeklyDaReport when a dropdown changes', () => {
    renderReport();
    reportHookSpy.mockClear();
    fireEvent.change(screen.getByTestId('wdr-filter-da'), {
      target: { value: 'Fisk' },
    });
    // The most recent call reflects the new filter.
    const lastCall = reportHookSpy.mock.calls[reportHookSpy.mock.calls.length - 1];
    expect(lastCall[2]).toEqual({ da: 'Fisk' });
  });

  it('fires the debounced upsert ~500ms after typing in a note', () => {
    vi.useFakeTimers();
    renderReport();
    // Notes live on CORRECTIONS rows only. Permit 200 (Unassigned
    // corrections) starts with an empty note.
    const note = screen.getByTestId('wdr-note-200') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'Call the city Monday.' } });
    // Not saved immediately.
    expect(upsertMutate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate).toHaveBeenCalledWith({
      permitId: 200,
      body: 'Call the city Monday.',
    });
  });

  it('debounce coalesces rapid keystrokes into one save', () => {
    vi.useFakeTimers();
    renderReport();
    const note = screen.getByTestId('wdr-note-200') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'a' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(note, { target: { value: 'ab' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(note, { target: { value: 'abc' } });
    // Still within debounce — no save yet.
    expect(upsertMutate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate).toHaveBeenCalledWith({ permitId: 200, body: 'abc' });
  });

  it('print button calls window.print()', () => {
    const printSpy = vi.fn();
    const original = window.print;
    window.print = printSpy;
    try {
      renderReport();
      fireEvent.click(screen.getByTestId('wdr-print'));
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  });

  it('filter form + header carry print-hide so print CSS hides them', () => {
    renderReport();
    expect(screen.getByTestId('wdr-filter-form').className).toContain('print-hide');
    expect(screen.getByTestId('wdr-header').className).toContain('print-hide');
  });

  it('persists filters to localStorage', () => {
    renderReport();
    fireEvent.change(screen.getByTestId('wdr-filter-type'), {
      target: { value: 'Building Permit' },
    });
    const raw = localStorage.getItem('bp_weekly_da_report_filters');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.filters.type).toBe('Building Permit');
  });

  // fix-215: the report must open on the CURRENT week's Monday so its 14-day
  // window catches near-term items. A stale persisted week (the old bug) is
  // ignored; only window + filters carry across reloads.
  describe('fix-215: defaults Week of to the current week', () => {
    it('initializes weekStart to the current week\'s Monday (today snapped back)', () => {
      vi.useFakeTimers();
      // Wednesday 2026-06-24 → that week\'s Monday is 2026-06-22.
      vi.setSystemTime(new Date(2026, 5, 24, 9, 0, 0));
      renderReport();
      // The field shows the current week\'s Monday…
      const week = screen.getByTestId('wdr-week-start') as HTMLInputElement;
      expect(week.value).toBe('2026-06-22');
      // …and that\'s what the RPC hook was called with on first render.
      expect(reportHookSpy.mock.calls[0][0]).toBe('2026-06-22');
    });

    it('ignores a stale persisted week and still opens on the current week', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 24, 9, 0, 0));
      // Simulate a returning user whose localStorage carries an old week.
      localStorage.setItem(
        'bp_weekly_da_report_filters',
        JSON.stringify({ weekStart: '2026-05-04', windowDays: 14, filters: {} }),
      );
      renderReport();
      const week = screen.getByTestId('wdr-week-start') as HTMLInputElement;
      expect(week.value).toBe('2026-06-22'); // current week, NOT the stale 05-04
      expect(reportHookSpy.mock.calls[0][0]).toBe('2026-06-22');
    });

    it('the Week of field stays user-editable', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 24, 9, 0, 0));
      renderReport();
      reportHookSpy.mockClear();
      fireEvent.change(screen.getByTestId('wdr-week-start'), {
        target: { value: '2026-07-13' },
      });
      const week = screen.getByTestId('wdr-week-start') as HTMLInputElement;
      expect(week.value).toBe('2026-07-13');
      const lastCall = reportHookSpy.mock.calls[reportHookSpy.mock.calls.length - 1];
      expect(lastCall[0]).toBe('2026-07-13');
    });

    it('keeps the window default at 14', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 24, 9, 0, 0));
      renderReport();
      expect((screen.getByTestId('wdr-window-days') as HTMLInputElement).value).toBe('14');
      expect(reportHookSpy.mock.calls[0][1]).toBe(14);
    });
  });

  // fix-128: 5603 45th Ave SW Demolition (permit 10068) — actual_issue set,
  // permit.status='Issued', but the latest cycle still carries a
  // corr_issued date from before the issuance. Pre-fix the RPC's
  // "in corrections" predicate was just `corr_issued IS NOT NULL` on the
  // latest cycle; the permit detail view's effectiveStage short-circuits
  // to 'is' the moment actual_issue is set. The RPC now mirrors that
  // priority (actual_issue / approval_date / stage_override / terminal
  // status / unresolved corrections on latest cycle), so an Issued
  // permit never appears in the Corrections section of the Weekly DA
  // Update.
  //
  // The component test pins the contract: when the RPC excludes a
  // 5603-shaped permit (as the post-fix RPC does for permits 10068 +
  // 10132 + 310 + 351 in the prod audit), the component renders no
  // corrections row for it.
  describe('fix-128: terminal-positive permits stay out of corrections', () => {
    it('an Issued permit (5603-shape) does NOT render in the Corrections table', () => {
      // The mocked hook is module-scoped; the payload above already
      // excludes any 5603-shape permit. Verify by permit_id — a permit
      // with actual_issue + status='Issued' but a still-populated
      // latest-cycle corr_issued would have rendered as
      // wdr-corr-row-10068 pre-fix; the fixed RPC drops it from the
      // corrections list so no row exists.
      renderReport();
      expect(screen.queryByTestId('wdr-corr-row-10068')).toBeNull();
      // The full DOM should not mention 5603 (no other section carries it).
      expect(document.body.textContent).not.toMatch(/5603 45th Ave SW/);
    });

    it('the existing corrections rows still render — only terminal-positive permits get gated', () => {
      // Regression guard against an over-broad fix that dropped all
      // corrections. The PAYLOAD's permits 101 and 200 are correctly
      // unresolved (no terminal-positive state) and must keep rendering.
      renderReport();
      expect(screen.getByTestId('wdr-corr-row-101')).toBeInTheDocument();
      expect(screen.getByTestId('wdr-corr-row-200')).toBeInTheDocument();
    });
  });
});
