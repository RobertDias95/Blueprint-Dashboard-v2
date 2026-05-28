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
});
