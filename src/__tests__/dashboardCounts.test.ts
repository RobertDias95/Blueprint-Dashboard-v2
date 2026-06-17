import { describe, it, expect } from 'vitest';
import { distinctProjectCount } from '../lib/dashboardCounts';

// fix-178 Part A: bucket headers show "N projects · M permits". The permit count
// is the array length (existing); this pins the distinct-project side.

describe('distinctProjectCount', () => {
  it('counts distinct project_id across a bucket of permits', () => {
    // 5 permits spanning 3 projects → "3 projects · 5 permits".
    const permits = [
      { project_id: 'p1' },
      { project_id: 'p1' },
      { project_id: 'p2' },
      { project_id: 'p3' },
      { project_id: 'p3' },
    ];
    expect(distinctProjectCount(permits)).toBe(3);
    expect(permits.length).toBe(5);
  });

  it('is 0 for an empty bucket', () => {
    expect(distinctProjectCount([])).toBe(0);
  });

  it('counts a single project contributing many permits as 1', () => {
    expect(
      distinctProjectCount([
        { project_id: 'only' },
        { project_id: 'only' },
        { project_id: 'only' },
      ]),
    ).toBe(1);
  });
});
