import { describe, it, expect } from 'vitest';
import { passesHoldFilter, HOLD_FILTER_DEFAULT } from '../lib/holdFilter';

// fix-178 Part B: the three-way hold filter predicate (All / Only / Exclude).

describe('passesHoldFilter', () => {
  it("default is 'all'", () => {
    expect(HOLD_FILTER_DEFAULT).toBe('all');
  });

  it("'all' shows everything (held and not held)", () => {
    expect(passesHoldFilter(true, 'all')).toBe(true);
    expect(passesHoldFilter(false, 'all')).toBe(true);
  });

  it("'only' shows held items only", () => {
    expect(passesHoldFilter(true, 'only')).toBe(true);
    expect(passesHoldFilter(false, 'only')).toBe(false);
  });

  it("'exclude' hides held items", () => {
    expect(passesHoldFilter(true, 'exclude')).toBe(false);
    expect(passesHoldFilter(false, 'exclude')).toBe(true);
  });
});
