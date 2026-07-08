import { describe, it, expect } from 'vitest';
import {
  isApprovedNotIssued,
  effectiveIssuedDate,
  isEffectivelyIssued,
} from '../lib/effectiveIssued';

// fix-221: the shared "approved-not-issued" + "effective issued" predicate.
// Its SQL twin is the `apr` CTE in bp_get_weekly_da_report — keep in lockstep.

type P = Parameters<typeof isApprovedNotIssued>[0];
function permit(over: Partial<P> = {}): P {
  return {
    approval_date: null,
    actual_issue: null,
    status: null,
    parent_permit_id: null,
    ...over,
  };
}

describe('fix-221 isApprovedNotIssued', () => {
  it('true when approved, not issued, non-terminal status, not a sub-permit', () => {
    expect(
      isApprovedNotIssued(
        permit({ approval_date: '2026-04-15', status: 'Ready for Issuance' }),
      ),
    ).toBe(true);
    // null status also qualifies (the common "Awaiting Information" case has a
    // status, but a missing status must not exclude it).
    expect(isApprovedNotIssued(permit({ approval_date: '2026-04-15' }))).toBe(true);
    // status 'Approved' is awaiting issuance (NOT in the terminal set).
    expect(
      isApprovedNotIssued(permit({ approval_date: '2026-04-15', status: 'Approved' })),
    ).toBe(true);
  });

  it('false when actually issued', () => {
    expect(
      isApprovedNotIssued(
        permit({ approval_date: '2026-04-15', actual_issue: '2026-05-01' }),
      ),
    ).toBe(false);
  });

  it('false when never approved (in review)', () => {
    expect(
      isApprovedNotIssued(permit({ status: 'Reviews In Process' })),
    ).toBe(false);
  });

  it('false for terminal statuses (Issued/Withdrawn/Completed/Closed)', () => {
    for (const status of ['Issued', 'Withdrawn', 'Completed', 'Closed']) {
      expect(
        isApprovedNotIssued(permit({ approval_date: '2026-04-15', status })),
      ).toBe(false);
    }
  });

  it('false for a sub-permit even if approved-not-issued (fix-194 exclusion)', () => {
    expect(
      isApprovedNotIssued(
        permit({ approval_date: '2026-04-15', parent_permit_id: 99 }),
      ),
    ).toBe(false);
  });
});

describe('fix-221 effectiveIssuedDate / isEffectivelyIssued', () => {
  it('actually issued → bucketed by actual_issue', () => {
    const p = permit({ approval_date: '2026-04-15', actual_issue: '2026-05-01' });
    expect(effectiveIssuedDate(p)).toBe('2026-05-01');
    expect(isEffectivelyIssued(p)).toBe(true);
  });

  it('approved-not-issued → bucketed by approval_date', () => {
    const p = permit({ approval_date: '2026-04-15', status: 'Ready for Issuance' });
    expect(effectiveIssuedDate(p)).toBe('2026-04-15');
    expect(isEffectivelyIssued(p)).toBe(true);
  });

  it('in-review → null (not effectively issued)', () => {
    const p = permit({ status: 'Reviews In Process' });
    expect(effectiveIssuedDate(p)).toBeNull();
    expect(isEffectivelyIssued(p)).toBe(false);
  });

  it('withdrawn-but-approved → null (terminal, not awaiting issuance)', () => {
    const p = permit({ approval_date: '2026-04-15', status: 'Withdrawn' });
    expect(effectiveIssuedDate(p)).toBeNull();
    expect(isEffectivelyIssued(p)).toBe(false);
  });
});
