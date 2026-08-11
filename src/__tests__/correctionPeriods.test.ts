import { describe, it, expect } from 'vitest';
import {
  PLAUSIBLE_FROM,
  commentsForLabel,
  comparePrevalence,
  countComments,
  dateSanity,
  isPlausibleLetterDate,
  plausibleRows,
  precedingPeriod,
  resolvePeriod,
  rowsInPeriod,
} from '../lib/correctionPeriods';
import type { CorrectionReportRow } from '../lib/correctionsReport';

// fix-281: periods, the preceding-period comparison, and the ten dates that
// are not real.

const TODAY = '2026-08-11';

let seq = 0;
function row(over: Partial<CorrectionReportRow> = {}): CorrectionReportRow {
  seq += 1;
  return {
    id: `ci-${seq}`, project_id: 'p1', permit_id: null, building: null,
    discipline: 'Zoning', cycle: 1, letter_date: '2026-05-01', reviewer: 'A',
    item_no: seq, subject: `s${seq}`, body: `b${seq}`, codes: null,
    category: 'Parking / access / curb cut', theme: 'Access & ROW',
    source_file: 'f.pdf', address: '1 Main St', juris: 'Seattle',
    architect: null, permit_type: null, permit_da: null,
    ...over,
  };
}

// ----------------------------------------------------------- date sanity ---

describe('fix-281 implausible dates', () => {
  it('a future date is not plausible', () => {
    expect(isPlausibleLetterDate('2026-12-24', TODAY)).toBe(false);
  });

  it('a pre-2025 date is not plausible', () => {
    expect(isPlausibleLetterDate('2022-06-04', TODAY)).toBe(false);
    expect(PLAUSIBLE_FROM).toBe('2025-01-01');
  });

  it('the boundaries are inclusive on both ends', () => {
    expect(isPlausibleLetterDate('2025-01-01', TODAY)).toBe(true);
    expect(isPlausibleLetterDate(TODAY, TODAY)).toBe(true);
    expect(isPlausibleLetterDate('2024-12-31', TODAY)).toBe(false);
    expect(isPlausibleLetterDate('2026-08-12', TODAY)).toBe(false);
  });

  it('a missing date is not plausible either', () => {
    expect(isPlausibleLetterDate(null, TODAY)).toBe(false);
  });

  it('counts the production shape: 5 future and 5 too old out of 2,194', () => {
    const rows = [
      ...Array.from({ length: 2184 }, () => row({ letter_date: '2026-05-01' })),
      // all five from `5603 - Zoning Corr 1.pdf`
      ...Array.from({ length: 5 }, () => row({ letter_date: '2026-12-24' })),
      // all five from `SFR 2 - LU Corr 1 - SUMMARY.pdf`
      ...Array.from({ length: 5 }, () => row({ letter_date: '2022-06-04' })),
    ];
    const s = dateSanity(rows, TODAY);
    expect(s.total).toBe(2194);
    expect(s.future).toBe(5);
    expect(s.tooOld).toBe(5);
    expect(s.implausible).toBe(10);
    expect(s.plausible).toBe(2184);
  });

  it('plausibleRows drops exactly the implausible ones', () => {
    const rows = [
      row({ letter_date: '2026-05-01' }),
      row({ letter_date: '2026-12-24' }),
      row({ letter_date: '2022-06-04' }),
    ];
    expect(plausibleRows(rows, TODAY)).toHaveLength(1);
  });

  it('nothing is ever rewritten — the bad dates survive on their rows', () => {
    // A wrong date guessed into a plausible one is worse than a visible outlier.
    const bad = row({ letter_date: '2026-12-24' });
    dateSanity([bad], TODAY);
    plausibleRows([bad], TODAY);
    expect(bad.letter_date).toBe('2026-12-24');
  });
});

// --------------------------------------------------------------- periods ---

describe('fix-281 period presets', () => {
  it('2026 YTD runs from 1 January to today, never into the future', () => {
    const p = resolvePeriod('ytd2026', TODAY);
    expect(p.from).toBe('2026-01-01');
    expect(p.to).toBe(TODAY);
    expect(p.label).toBe('2026 YTD');
  });

  it('last 90 days is 90 days inclusive of today', () => {
    const p = resolvePeriod('last90', TODAY);
    expect(p.from).toBe('2026-05-14');
    expect(p.to).toBe(TODAY);
  });

  it('last 12 months is 365 days inclusive', () => {
    const p = resolvePeriod('last12m', TODAY);
    expect(p.from).toBe('2025-08-12');
    expect(p.to).toBe(TODAY);
  });

  it('all time has no lower bound but still stops at today', () => {
    const p = resolvePeriod('all', TODAY);
    expect(p.from).toBe('');
    expect(p.to).toBe(TODAY);
  });

  it('2026 YTD selects the 1,617 comments dated this year so far', () => {
    // The brief quotes 1,622. That figure counts letter_date >= 2026-01-01 with
    // NO upper bound, which includes the five 2026-12-24 rows. A window running
    // into the future contradicts the ticket's own date-sanity rule, so YTD is
    // 1 Jan -> today and reads 1,617.
    const rows = [
      ...Array.from({ length: 1617 }, () => row({ letter_date: '2026-05-01' })),
      ...Array.from({ length: 5 }, () => row({ letter_date: '2026-12-24' })),
      ...Array.from({ length: 567 }, () => row({ letter_date: '2025-06-01' })),
      ...Array.from({ length: 5 }, () => row({ letter_date: '2022-06-04' })),
    ];
    expect(rows).toHaveLength(2194);
    const ytd = rowsInPeriod(rows, resolvePeriod('ytd2026', TODAY), TODAY);
    expect(ytd).toHaveLength(1617);
  });

  it('a window never admits an implausible date, even when it falls inside', () => {
    // 2022-06-04 sits inside "all time" by date, but it is not a real date.
    const rows = [row({ letter_date: '2022-06-04' }), row({ letter_date: '2026-05-01' })];
    expect(rowsInPeriod(rows, resolvePeriod('all', TODAY), TODAY)).toHaveLength(1);
  });
});

describe('fix-281 the preceding period', () => {
  it('is the equal-length window immediately before', () => {
    const prev = precedingPeriod({ from: '2026-05-14', to: '2026-08-11', label: '' });
    expect(prev).toEqual({
      from: '2026-02-13', to: '2026-05-13', label: '2026-02-13 to 2026-05-13',
    });
  });

  it('abuts the current window with no gap and no overlap', () => {
    const cur = resolvePeriod('last90', TODAY);
    const prev = precedingPeriod(cur)!;
    expect(prev.to < cur.from).toBe(true);
    const dayAfter = new Date(`${prev.to}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    expect(dayAfter.toISOString().slice(0, 10)).toBe(cur.from);
  });

  it('YTD compares against the equally long window before 1 January', () => {
    // 2026-01-01..2026-08-11 is 223 days, so the previous window is the 223
    // days ending 2025-12-31 — NOT "the same months last year".
    const prev = precedingPeriod(resolvePeriod('ytd2026', TODAY))!;
    expect(prev.to).toBe('2025-12-31');
    expect(prev.from).toBe('2025-05-23');
  });

  it('the two windows are exactly the same number of days', () => {
    const days = (from: string, to: string) =>
      Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
                 / 86400000) + 1;
    for (const preset of ['ytd2026', 'last90', 'last12m'] as const) {
      const cur = resolvePeriod(preset, TODAY);
      const prev = precedingPeriod(cur)!;
      expect(days(prev.from, prev.to), preset).toBe(days(cur.from, cur.to));
    }
  });

  it('all time has no previous — null, not an invented window', () => {
    expect(precedingPeriod(resolvePeriod('all', TODAY))).toBeNull();
  });
});

// ------------------------------------------------------------ comparison ---

describe('fix-281 period comparison', () => {
  /** n projects in the window, `hit` of which carry the category. */
  function window_(n: number, hit: number, date: string) {
    const out: CorrectionReportRow[] = [];
    for (let i = 0; i < n; i += 1) {
      out.push(row({ project_id: `p${i}`, category: 'Other', letter_date: date }));
      if (i < hit) {
        out.push(row({
          project_id: `p${i}`, category: 'Parking / access / curb cut',
          letter_date: date,
        }));
      }
    }
    return out;
  }

  it('shows both counts and the point change', () => {
    const [c] = comparePrevalence(
      window_(20, 12, '2026-05-01'),
      window_(20, 8, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.current).toMatchObject({ projects: 12, denominator: 20, pct: 60 });
    expect(c.previous).toMatchObject({ projects: 8, denominator: 20, pct: 40 });
    expect(c.deltaPoints).toBe(20);
    expect(c.direction).toBe('up');
  });

  it('reports a fall as down', () => {
    const [c] = comparePrevalence(
      window_(20, 4, '2026-05-01'), window_(20, 12, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.deltaPoints).toBe(-40);
    expect(c.direction).toBe('down');
  });

  it('reports no movement as flat, not as missing', () => {
    const [c] = comparePrevalence(
      window_(20, 10, '2026-05-01'), window_(20, 10, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.deltaPoints).toBe(0);
    expect(c.direction).toBe('flat');
  });

  it('SUPPRESSES the delta when the current window is under 10 projects', () => {
    // 1-of-3 to 2-of-4 is +16.7 points and is noise wearing a percentage.
    const [c] = comparePrevalence(
      window_(3, 1, '2026-05-01'), window_(20, 8, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.deltaPoints).toBeNull();
    expect(c.direction).toBe('unknown');
  });

  it('suppresses it when the PREVIOUS window is too small too', () => {
    const [c] = comparePrevalence(
      window_(20, 8, '2026-05-01'), window_(4, 2, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.deltaPoints).toBeNull();
  });

  it('still returns both counts when the delta is suppressed', () => {
    // The counts are what let a reader see WHY it was suppressed.
    const [c] = comparePrevalence(
      window_(3, 1, '2026-05-01'), window_(4, 2, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.deltaPoints).toBeNull();
    expect(c.current).toMatchObject({ projects: 1, denominator: 3, lowConfidence: true });
    expect(c.previous).toMatchObject({ projects: 2, denominator: 4, lowConfidence: true });
  });

  it('exactly 10 projects a side is comparable', () => {
    const [c] = comparePrevalence(
      window_(10, 5, '2026-05-01'), window_(10, 4, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.deltaPoints).toBe(10);
  });

  it('a category absent from the previous window reads 0%, not missing', () => {
    const [c] = comparePrevalence(
      window_(20, 6, '2026-05-01'), window_(20, 0, '2026-01-01'),
      'category', ['Parking / access / curb cut'],
    );
    expect(c.previous.projects).toBe(0);
    expect(c.deltaPoints).toBe(30);
  });

  it('works at theme level', () => {
    const cur = [row({ theme: 'Access & ROW', project_id: 'a' })];
    const prev = [row({ theme: 'Other', project_id: 'a' })];
    const [c] = comparePrevalence(cur, prev, 'theme', ['Access & ROW']);
    expect(c.current.projects).toBe(1);
    expect(c.previous.projects).toBe(0);
  });
});

// ------------------------------------------------------------ drill-down ---

describe('fix-281 the comments behind a row', () => {
  const rows = [
    row({ id: 'a1', project_id: 'A', address: '1 A St', letter_date: '2026-01-10',
          category: 'Parking / access / curb cut', body: 'Sight triangle.' }),
    row({ id: 'a2', project_id: 'A', address: '1 A St', letter_date: '2026-06-10',
          category: 'Parking / access / curb cut', body: 'EV-ready stalls.' }),
    row({ id: 'b1', project_id: 'B', address: '2 B St', letter_date: '2026-03-10',
          category: 'Parking / access / curb cut', body: 'Curb cut closure.' }),
    row({ id: 'z1', project_id: 'C', address: '3 C St', letter_date: '2026-07-10',
          category: 'Something else', body: 'not this one' }),
  ];

  it('returns only the comments in that category', () => {
    const groups = commentsForLabel(rows, 'category', 'Parking / access / curb cut',
                                    'newest', TODAY);
    expect(countComments(groups)).toBe(3);
    expect(groups.flatMap((g) => g.comments).map((c) => c.id).sort())
      .toEqual(['a1', 'a2', 'b1']);
  });

  it('groups by project, most recent project first', () => {
    const groups = commentsForLabel(rows, 'category', 'Parking / access / curb cut',
                                    'newest', TODAY);
    // A's newest is 2026-06-10, B's is 2026-03-10.
    expect(groups.map((g) => g.projectId)).toEqual(['A', 'B']);
  });

  it('sorts newest first inside a project, and flips', () => {
    const newest = commentsForLabel(rows, 'category', 'Parking / access / curb cut',
                                    'newest', TODAY);
    expect(newest[0].comments.map((c) => c.id)).toEqual(['a2', 'a1']);
    const oldest = commentsForLabel(rows, 'category', 'Parking / access / curb cut',
                                    'oldest', TODAY);
    expect(oldest.map((g) => g.projectId)).toEqual(['B', 'A']);
    expect(oldest[1].comments.map((c) => c.id)).toEqual(['a1', 'a2']);
  });

  it('is stable for comments sharing a date', () => {
    const same = [
      row({ id: 'x', project_id: 'A', letter_date: '2026-04-01', source_file: 'b.pdf', item_no: 1 }),
      row({ id: 'y', project_id: 'A', letter_date: '2026-04-01', source_file: 'a.pdf', item_no: 2 }),
      row({ id: 'z', project_id: 'A', letter_date: '2026-04-01', source_file: 'a.pdf', item_no: 1 }),
    ];
    const order = () =>
      commentsForLabel(same, 'category', 'Parking / access / curb cut', 'newest', TODAY)[0]
        .comments.map((c) => c.id);
    // Same letter first, then item order — and the same every time.
    expect(order()).toEqual(['z', 'y', 'x']);
    expect(order()).toEqual(order());
  });

  it('keeps an implausibly dated comment but sorts it last, both ways', () => {
    // The drill-down is about reading the words; a bad date still has a letter
    // behind it. It just must not masquerade as the newest thing on the page.
    const withBad = [
      ...rows.slice(0, 3),
      row({ id: 'bad', project_id: 'D', address: '4 D St', letter_date: '2026-12-24',
            category: 'Parking / access / curb cut', body: 'future dated' }),
    ];
    for (const sort of ['newest', 'oldest'] as const) {
      const groups = commentsForLabel(withBad, 'category',
                                      'Parking / access / curb cut', sort, TODAY);
      expect(countComments(groups)).toBe(4);
      expect(groups[groups.length - 1].projectId).toBe('D');
    }
  });

  it('an empty category returns nothing rather than throwing', () => {
    expect(commentsForLabel(rows, 'category', 'Nothing here', 'newest', TODAY))
      .toEqual([]);
    expect(countComments([])).toBe(0);
  });

  it('works at theme level', () => {
    const groups = commentsForLabel(rows, 'theme', 'Access & ROW', 'newest', TODAY);
    expect(countComments(groups)).toBe(4);
  });
});
