import { describe, it, expect } from 'vitest';
import { shouldRunSweep } from '../hooks/useNumberEntrySweep';

// fix-155: client-side once/day guard for the number-entry sweep. The RPC
// self-guards per tenant per day server-side; this guard just avoids redundant
// RPC calls on every Dashboard mount within the same browser-day.

describe('shouldRunSweep (fix-155)', () => {
  const TODAY = '2026-06-12';

  it('runs when never run before (null last-run)', () => {
    expect(shouldRunSweep(null, TODAY)).toBe(true);
  });

  it('runs when last run was a previous day', () => {
    expect(shouldRunSweep('2026-06-11', TODAY)).toBe(true);
  });

  it('does NOT run again the same day (second mount is a no-op)', () => {
    expect(shouldRunSweep(TODAY, TODAY)).toBe(false);
  });

  it('treats undefined last-run as never-run', () => {
    expect(shouldRunSweep(undefined, TODAY)).toBe(true);
  });
});
