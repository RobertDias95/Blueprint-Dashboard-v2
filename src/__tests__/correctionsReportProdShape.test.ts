import { describe, it, expect } from 'vitest';
import { repeatRate, summarizeReport, type CorrectionReportRow } from '../lib/correctionsReport';

// fix-277: the repeat maths against a REAL production shape, not a fixture
// invented to suit the implementation.
//
// The rule — a topic raised in cycle N and again in N+1, with only topics from a
// cycle the project continued past counting as eligible — was first written as
// SQL to size the problem (whole corpus: 803 eligible, 124 repeated, 15.4%).
// This pins the TypeScript against an independent run of that SQL on one
// project, so the two implementations cannot drift apart silently.
//
// 403 W Dravus St was chosen because it exercises every branch: two cycles, 20
// eligible topics, 7 that came back, and 12 cycle-2-only topics that must NOT be
// counted either way. Verified 2026-08-11: eligible 20, repeated 7.
//
// Discipline and category names only — no reviewer names, no letter text.

// Every distinct (building, discipline, category, cycle) with its item count.
const TRIPLES =
  '~Addressing~Address assignment / display~1~1;~City Light~Missing / incorrect plan info~1~1;~City Light~Unclassified~1~6;~Drainage~Drainage plan detail~1~2;~Drainage~Flow control / detention~1~1;~ECA~Geotech report / analysis~1~4;~ECA~Missing / incorrect plan info~1~1;~Energy~Missing / incorrect plan info~1~1;~Energy~Response / resubmittal admin~1~1;~MHA~Unclassified~1~1;~OS~Egress / stairs / guards~1~2;~OS~Fire separation & rating~1~5;~OS~Response / resubmittal admin~1~1;~Reveg~Missing / incorrect plan info~1~2;~Reveg~Stormwater / detention~1~1;~Zoning~Parking / access / curb cut~1~2;~Zoning~Setbacks & yards~1~1;~Zoning~Streets / alleys / ROW~1~1;~Zoning~Use / density / units~1~2;~Zoning~Zoning – plan data missing~1~3;~ECA~Geotech report / analysis~2~2;~ECA~Grading / earthwork~2~1;~ECA~Missing / incorrect plan info~2~1;~MHA~Missing / incorrect plan info~2~1;~OS~Egress / stairs / guards~2~1;~OS~Missing / incorrect plan info~2~1;~Reveg~Unclassified~2~4;~Zoning~Lot coverage / FAR / area~2~2;~Zoning~Parking / access / curb cut~2~1;~Zoning~Setbacks & yards~2~1;~Zoning~Streets / alleys / ROW~2~1;~Zoning~Use / density / units~2~2';

let n = 0;
const rows: CorrectionReportRow[] = TRIPLES.split(';').flatMap((t) => {
  const [building, discipline, category, cycle, count] = t.split('~');
  return Array.from({ length: Number(count) }, () => {
    n += 1;
    return {
      id: `r${n}`,
      project_id: 'dravus',
      building: building || null,
      discipline: discipline || null,
      cycle: Number(cycle),
      letter_date: '2025-09-01',
      reviewer: null,
      item_no: n,
      subject: 's',
      body: 'b',
      codes: null,
      category: category || null,
      theme: 'T',
      source_file: 'f.pdf',
      address: '403 W Dravus St',
      juris: 'Seattle',
      architect: null,
    } satisfies CorrectionReportRow;
  });
});

describe('fix-277 repeat maths against the 403 W Dravus St production shape', () => {
  it('has the 57 items production holds', () => {
    expect(rows).toHaveLength(57);
  });

  it('matches the SQL: 20 eligible, 7 repeated, 35% repeat rate', () => {
    const r = repeatRate(rows);
    expect(r.eligible).toBe(20);
    expect(r.repeated).toBe(7);
    expect(r.pct).toBe(35);
  });

  it('names the seven topics that actually came back in cycle 2', () => {
    const r = repeatRate(rows);
    expect(
      r.repeatedTopics.map((t) => `${t.discipline}/${t.category}`).sort(),
    ).toEqual([
      'ECA/Geotech report / analysis',
      'ECA/Missing / incorrect plan info',
      'OS/Egress / stairs / guards',
      'Zoning/Parking / access / curb cut',
      'Zoning/Setbacks & yards',
      'Zoning/Streets / alleys / ROW',
      'Zoning/Use / density / units',
    ]);
  });

  it('cycle-2-only topics are not counted — nothing follows them', () => {
    const r = repeatRate(rows);
    // Reveg/Unclassified exists only in cycle 2.
    expect(r.repeatedTopics.some((t) => t.category === 'Unclassified' && t.discipline === 'Reveg')).toBe(false);
    // 20 cycle-1 topics are eligible; the 12 cycle-2 topics are not.
    expect(r.eligible).toBe(20);
  });

  it('summarizes to one project, two cycles', () => {
    const s = summarizeReport(rows);
    expect(s.projects).toBe(1);
    expect(s.cycles).toEqual([1, 2]);
    expect(s.items).toBe(57);
  });
});
