import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  currentEdition,
  editionReadKey,
  editionAgeDays,
  shiftDayKey,
} from '../lib/weeklyEdition';
import {
  visibleRows,
  sortRows,
  filterRows,
  backlogBreakdown,
  compareRows,
  SNAPSHOT_SECTIONS,
  TOP_N,
  type SnapshotRow,
  type SortState,
} from '../lib/weeklySnapshot';

// ===========================================================================
// ★★★ fix-463 (P-108) — THE WEEKLY UPDATE
// ===========================================================================
//
// Bobby, on why a login cannot be the trigger:
//   *"the tool is, like, always logged in… if they don't ever restart their PC,
//    then they're technically not logging in. Is there a way that this can fire
//    automatically, like Wednesday at midnight, so that when they wake up their
//    computer that's the first thing that they see on the bridge until they
//    acknowledge it?"*
//
// MEASURED ON PROD, re-derived 2026-08-31 and matching the brief exactly:
//   269 live permits · A 4 · B 101 · C 17 (CYCLE 0) · D 30 · E 56
//   ★ C read off the LATEST cycle returns 179 — two-thirds of the pipeline,
//     which is the tell that a definition is broken rather than a finding.

// ---------------------------------------------------------------------------
// ★★★ §B1 — THE EDITION BOUNDARY IS WEDNESDAY 00:00 **PACIFIC**
// ---------------------------------------------------------------------------
describe('fix-463 §B1 — the edition fires on a Pacific clock', () => {
  it('★★★ a UTC-evening Tuesday does NOT publish Wednesday early', () => {
    // ★ THE TEST THE BRIEF ASKS FOR, and the one a naive implementation fails.
    //   2026-09-02 is a Wednesday. At 02:00 UTC on that date it is still only
    //   19:00 PACIFIC ON TUESDAY 1 September — the meeting has not happened and
    //   the people it is for are still working through Tuesday.
    //   A UTC week boundary would publish here. This must not.
    expect(currentEdition(new Date('2026-09-02T02:00:00Z'))).toBe('2026-08-26');

    // …and seven hours later, at 07:00 UTC, it IS Wednesday 00:00 Pacific.
    expect(currentEdition(new Date('2026-09-02T07:00:00Z'))).toBe('2026-09-02');
  });

  it('★★ the edition holds all week and rolls on the next Wednesday', () => {
    // Wednesday itself, late in the Pacific day.
    expect(currentEdition(new Date('2026-09-03T06:00:00Z'))).toBe('2026-09-02');
    // Friday.
    expect(currentEdition(new Date('2026-09-04T18:00:00Z'))).toBe('2026-09-02');
    // The following Tuesday — still last Wednesday's edition.
    expect(currentEdition(new Date('2026-09-08T18:00:00Z'))).toBe('2026-09-02');
    // The following Wednesday, after midnight Pacific.
    expect(currentEdition(new Date('2026-09-09T08:00:00Z'))).toBe('2026-09-09');
  });

  it('★ the acknowledgement key is namespaced and per edition', () => {
    expect(editionReadKey('2026-09-02')).toBe('weekly-update:2026-09-02');
    // Two editions are two keys, so acknowledging one cannot silence the next.
    expect(editionReadKey('2026-09-02')).not.toBe(editionReadKey('2026-09-09'));
  });

  it('★ age is days into the edition, never negative', () => {
    expect(editionAgeDays('2026-09-02', new Date('2026-09-02T18:00:00Z'))).toBe(0);
    expect(editionAgeDays('2026-09-02', new Date('2026-09-04T18:00:00Z'))).toBe(2);
  });

  it('★ shiftDayKey crosses a month boundary correctly', () => {
    expect(shiftDayKey('2026-09-02', -7)).toBe('2026-08-26');
    expect(shiftDayKey('2026-09-01', -1)).toBe('2026-08-31');
  });
});

// ---------------------------------------------------------------------------
// The five sections
// ---------------------------------------------------------------------------
let seq = 0;
function row(over: Partial<SnapshotRow> = {}): SnapshotRow {
  seq += 1;
  return {
    bucket: 'b',
    permit_id: seq,
    project_id: `proj-${seq}`,
    address: `${seq} Main St`,
    num: `70000${seq}-CN`,
    type: 'Building Permit',
    ent_lead: 'Miles',
    da: 'Cam',
    status: 'Reviews In Process',
    on_date: '2026-08-01',
    age_days: seq,
    ...over,
  };
}

describe('fix-463 §A — the five sections', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('★★ five sections, in the mock-up’s order and words', () => {
    expect(SNAPSHOT_SECTIONS.map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(SNAPSHOT_SECTIONS[0]!.title).toBe('Intake due in the next 14 days');
    expect(SNAPSHOT_SECTIONS[2]!.title).toBe('Submitted, intake fee not paid');
    // ★ The two variable column labels travel with the section, so a heading
    //   and its date column can never drift apart.
    expect(SNAPSHOT_SECTIONS[1]!.ageLabel).toBe('Days late');
    expect(SNAPSHOT_SECTIONS[3]!.dateLabel).toBe('Corrections issued');
  });

  it('★★★ §A4: 9 sorts before 103 — a string sort gets this wrong', () => {
    const rows = [row({ age_days: 103 }), row({ age_days: 9 }), row({ age_days: 21 })];
    const asc: SortState = { key: 'age_days', dir: 'asc' };
    expect(sortRows(rows, asc).map((r) => r.age_days)).toEqual([9, 21, 103]);
    // ★ …and the descending direction is its exact reverse.
    expect(
      sortRows(rows, { key: 'age_days', dir: 'desc' }).map((r) => r.age_days),
    ).toEqual([103, 21, 9]);
  });

  it('★★★ §A4: ISO dates sort chronologically', () => {
    const rows = [
      row({ on_date: '2026-01-02' }),
      row({ on_date: '2025-12-31' }),
      row({ on_date: '2026-01-10' }),
    ];
    expect(
      sortRows(rows, { key: 'on_date', dir: 'asc' }).map((r) => r.on_date),
    ).toEqual(['2025-12-31', '2026-01-02', '2026-01-10']);
  });

  it('★★ nulls sort LAST in both directions', () => {
    // A permit with no number is not "the smallest number" — it is an absence,
    // and floating it to the top would bury the rows the reader asked for.
    const rows = [row({ num: null }), row({ num: 'B' }), row({ num: 'A' })];
    expect(sortRows(rows, { key: 'num', dir: 'asc' }).map((r) => r.num))
      .toEqual(['A', 'B', null]);
    expect(sortRows(rows, { key: 'num', dir: 'desc' }).map((r) => r.num))
      .toEqual(['B', 'A', null]);
    expect(compareRows(row({ num: null }), row({ num: null }), { key: 'num', dir: 'asc' })).toBe(0);
  });

  it('★★★ §A3: RE-SORTING RE-PICKS THE TOP THREE', () => {
    // The interaction that is easy to build wrongly: slicing before sorting
    // looks identical until somebody clicks a header.
    const rows = [
      row({ age_days: 1, address: 'oldest-last' }),
      row({ age_days: 2 }),
      row({ age_days: 3 }),
      row({ age_days: 400, address: 'the worst one' }),
    ];
    const asc = visibleRows(rows, { key: 'age_days', dir: 'asc' }, '', false);
    expect(asc.shown.map((r) => r.age_days)).toEqual([1, 2, 3]);

    const desc = visibleRows(rows, { key: 'age_days', dir: 'desc' }, '', false);
    // ★ The 400-day permit is now in the preview. Had the slice happened first
    //   it would still be showing 1, 2, 3.
    expect(desc.shown[0]!.address).toBe('the worst one');
    expect(desc.shown).toHaveLength(TOP_N);
  });

  it('★★ §A2: collapsed shows three; expanded shows them all', () => {
    const rows = Array.from({ length: 40 }, () => row());
    const sort: SortState = { key: 'age_days', dir: 'desc' };
    expect(visibleRows(rows, sort, '', false).shown).toHaveLength(3);
    expect(visibleRows(rows, sort, '', true).shown).toHaveLength(40);
  });

  it('★★ §A5: search filters and reports n of N', () => {
    const rows = [
      row({ address: '215 31st Ave' }),
      row({ address: '4527 Corliss Ave N' }),
      row({ ent_lead: 'Briana', address: 'other' }),
    ];
    const sort: SortState = { key: 'age_days', dir: 'desc' };
    const hit = visibleRows(rows, sort, 'corliss', true);
    expect(hit.matched).toBe(1);
    expect(hit.total).toBe(3);
    // ★ Searching any visible column — somebody typing "Briana" means the ENT
    //   lead, and asking them which column is not a kindness.
    expect(filterRows(rows, 'briana')).toHaveLength(1);
    expect(filterRows(rows, '')).toHaveLength(3);
  });

  it('★★★ B’s backlog is stated, not dumped', () => {
    // Prod shape: 13 of 101 within 30 days, 88 over a month, 52 over three
    // months, 8 over a year.
    const rows = [
      ...Array.from({ length: 13 }, () => row({ age_days: 10 })),
      ...Array.from({ length: 36 }, () => row({ age_days: 60 })),
      ...Array.from({ length: 44 }, () => row({ age_days: 120 })),
      ...Array.from({ length: 8 }, () => row({ age_days: 400 })),
    ];
    const b = backlogBreakdown(rows);
    expect(b.overMonth).toBe(88);
    expect(b.overQuarter).toBe(52);
    expect(b.overYear).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// The section component
// ---------------------------------------------------------------------------
import SnapshotSection from '../components/WeeklyUpdate/SnapshotSection';

function renderSection(rows: SnapshotRow[], key: 'a' | 'b' = 'b') {
  const spec = SNAPSHOT_SECTIONS.find((s) => s.key === key)!;
  return render(
    <MemoryRouter>
      <SnapshotSection spec={spec} rows={rows} />
    </MemoryRouter>,
  );
}

describe('fix-463 §A — the rendered section', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('★★ collapsed shows three rows and the toggle names the total', () => {
    const { container } = renderSection(Array.from({ length: 40 }, () => row()));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getByTestId('snapshot-b-toggle').textContent).toBe('Show all 40');
    expect(screen.getByTestId('snapshot-b-count').textContent).toBe('40');
  });

  it('★★ expanding shows them all and the toggle inverts', () => {
    const { container } = renderSection(Array.from({ length: 40 }, () => row()));
    fireEvent.click(screen.getByTestId('snapshot-b-toggle'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(40);
    expect(screen.getByTestId('snapshot-b-toggle').textContent).toBe('Show top 3');
    expect(screen.getByTestId('snapshot-b').dataset.expanded).toBe('true');
  });

  it('★★★ §A5: searching auto-expands and reports "n of N shown"', () => {
    renderSection([
      row({ address: '215 31st Ave' }),
      ...Array.from({ length: 10 }, () => row({ address: 'somewhere else' })),
    ]);
    // Collapsed to begin with.
    expect(screen.getByTestId('snapshot-b').dataset.expanded).toBe('false');
    fireEvent.change(screen.getByTestId('snapshot-b-search'), {
      target: { value: '31st' },
    });
    // ★ A search that filtered a three-row preview would report "1 of 11" and
    //   show nothing. It expands instead.
    expect(screen.getByTestId('snapshot-b').dataset.expanded).toBe('true');
    expect(screen.getByTestId('snapshot-b-hits').textContent).toBe('1 of 11 shown');
  });

  it('★★★ §A3 rendered: clicking a header re-picks the visible three', () => {
    renderSection([
      row({ age_days: 1, address: 'least late' }),
      row({ age_days: 2, address: 'b' }),
      row({ age_days: 3, address: 'c' }),
      row({ age_days: 400, address: 'most late' }),
    ]);
    // Default is age desc, so the worst is already first.
    expect(screen.getByText('most late')).toBeTruthy();
    // Flip to ascending: the worst leaves the preview and the least-late enters.
    fireEvent.click(screen.getByTestId('snapshot-b-th-age_days'));
    expect(screen.queryByText('most late')).toBeNull();
    expect(screen.getByText('least late')).toBeTruthy();
  });

  it('★ §A6: every row opens its PERMIT, not just the project', () => {
    renderSection([row({ permit_id: 10096, project_id: 'proj-x' })]);
    const link = screen.getByTestId('snapshot-b-open-10096') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/project/proj-x?permit=10096');
  });

  it('★ a row with no project id renders as text, never a link to nowhere', () => {
    renderSection([row({ permit_id: 7, project_id: null, address: 'orphan' })]);
    expect(screen.queryByTestId('snapshot-b-open-7')).toBeNull();
    expect(screen.getByText('orphan')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ★★★ §B — the modal, its audience, and its acknowledgement
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  isMember: true,
  reads: [] as string[],
  readsSuccess: true,
  marked: [] as string[][],
}));

vi.mock('../hooks/useAgendaMember', () => ({
  useIsAgendaMember: () => state.isMember,
  useAgendaMemberNames: () => [],
  useSetAgendaMember: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: state.reads, isSuccess: state.readsSuccess }),
  useMarkBoardItemsRead: () => ({
    mutate: (keys: string[]) => state.marked.push(keys),
  }),
}));
vi.mock('../hooks/useWeeklySnapshot', () => ({
  useWeeklySnapshot: () => ({ data: { today: '2026-09-02', rows: [] }, isLoading: false }),
}));
vi.mock('../hooks/useVendorReportState', () => ({
  useVendorReportState: () => ({ data: [] }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: {} }),
  readAppConfigStringArray: () => [],
}));

import WeeklyUpdateModal from '../components/WeeklyUpdate/WeeklyUpdateModal';

function renderModal() {
  return render(
    <MemoryRouter>
      <WeeklyUpdateModal />
    </MemoryRouter>,
  );
}

describe('fix-463 §B — who sees the modal, and what closing it means', () => {
  beforeEach(() => {
    state.isMember = true;
    state.reads = [];
    state.readsSuccess = true;
    state.marked = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T18:00:00Z')); // Wednesday, Pacific morning
  });
  afterEach(() => vi.useRealTimers());

  it('★★★ §B4: a NON-MEMBER never sees it', () => {
    state.isMember = false;
    renderModal();
    expect(screen.queryByTestId('weekly-update-modal')).toBeNull();
  });

  it('★★ a member with an unacknowledged edition sees it', () => {
    renderModal();
    expect(screen.getByTestId('weekly-update-modal')).toBeTruthy();
    expect(screen.getByTestId('weekly-update-edition').textContent).toContain('2026-09-02');
  });

  it('★★★ §B3: acknowledging writes the per-edition key, server-side', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('weekly-update-close'));
    // ★ ONE key, namespaced and per edition — so it is per person (the table is
    //   own-rows-only) and per week, and a second machine reads the same row.
    expect(state.marked).toEqual([['weekly-update:2026-09-02']]);
  });

  it('★★★ an acknowledged edition does not show again — on ANY machine', () => {
    // The acknowledgement lives in `board_item_reads`, not localStorage: Bobby
    // works on more than one machine and a browser-local flag would re-show it.
    state.reads = ['weekly-update:2026-09-02'];
    renderModal();
    expect(screen.queryByTestId('weekly-update-modal')).toBeNull();
  });

  it('★★ …but the NEXT edition does', () => {
    state.reads = ['weekly-update:2026-08-26']; // last week's
    renderModal();
    expect(screen.getByTestId('weekly-update-modal')).toBeTruthy();
  });

  it('★★ it does not flash before the acknowledgement list has arrived', () => {
    // Showing it wrongly for 200ms every day would train people to dismiss it
    // without reading, which is the one outcome that defeats it.
    state.readsSuccess = false;
    renderModal();
    expect(screen.queryByTestId('weekly-update-modal')).toBeNull();
  });

  it('★★★ §B5: closing dismisses a REMINDER and claims nothing about reading', () => {
    renderModal();
    // The button says Close, not "Mark as read".
    expect(screen.getByTestId('weekly-update-close').textContent).toBe('Close');
    // …and the modal says the report is not going anywhere (§B4).
    expect(screen.getByTestId('weekly-update-permanence').textContent).toMatch(
      /stays on the Agenda screen/i,
    );
  });
});

// ---------------------------------------------------------------------------
// ★★★ §C — the SSS card records nothing unless you say so
// ---------------------------------------------------------------------------
import SssCard from '../components/WeeklyUpdate/SssCard';

describe('fix-463 §C — preview and download write nothing', () => {
  it('★★★ §C3: four separate actions, and the sentence is ON the card', () => {
    render(
      <MemoryRouter>
        <SssCard />
      </MemoryRouter>,
    );
    // Four, not three: collapsing preview into "mark as sent" silently corrupts
    // the ledger and makes everything show as new the following week.
    expect(screen.getByTestId('sss-preview')).toBeTruthy();
    expect(screen.getByTestId('sss-download')).toBeTruthy();
    // ★ Mark as sent does NOT fire from the card — it opens the report where
    //   the button sits under the rows it will record. The ellipsis says so.
    const mark = screen.getByTestId('sss-mark-sent') as HTMLAnchorElement;
    expect(mark.textContent).toMatch(/Mark as sent…/);
    expect(mark.getAttribute('href')).toBe('/reports/vendor-forecast');
    expect(screen.getByTestId('sss-recipients-edit')).toBeTruthy();

    expect(screen.getByTestId('sss-ledger-note').textContent).toMatch(
      /previewing is free/i,
    );
    expect(screen.getByTestId('sss-ledger-note').textContent).toMatch(
      /Only .Mark as sent./i,
    );
  });

  it('★★★ preview and download NAVIGATE — neither calls a ledger writer', () => {
    // The card imports no mutation at all, which is the strongest form of "it
    // records nothing": there is nothing there to call.
    render(
      <MemoryRouter>
        <SssCard />
      </MemoryRouter>,
    );
    const preview = screen.getByTestId('sss-preview') as HTMLAnchorElement;
    const download = screen.getByTestId('sss-download') as HTMLAnchorElement;
    expect(preview.getAttribute('href')).toBe('/reports/vendor-forecast');
    expect(download.getAttribute('href')).toBe('/reports/vendor-forecast?compose=1');
  });
});
