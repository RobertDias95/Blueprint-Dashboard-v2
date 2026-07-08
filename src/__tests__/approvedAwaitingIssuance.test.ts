import { describe, it, expect } from 'vitest';
import { buildApprovedAwaitingRows } from '../lib/approvedAwaitingIssuance';
import type { Permit, Project } from '../lib/database.types';

// fix-221: the "Approved – Awaiting Issuance" report row builder.

function permit(over: Partial<Permit>): Permit {
  return {
    id: 0,
    project_id: 'p1',
    type: 'Building Permit',
    num: null,
    da: null,
    status: null,
    approval_date: null,
    actual_issue: null,
    parent_permit_id: null,
    ...over,
  } as Permit;
}

function project(over: Partial<Project>): Project {
  return { id: 'p1', address: null, juris: null, ...over } as Project;
}

const projectsById = new Map<string, Project>([
  ['p1', project({ id: 'p1', address: '500 Pike St', juris: 'Seattle' })],
  ['p2', project({ id: 'p2', address: '750 Oak Way', juris: 'Bellevue' })],
]);

const TODAY = '2026-07-07';

describe('buildApprovedAwaitingRows', () => {
  it('includes only approved-not-issued permits, joined to their project', () => {
    const rows = buildApprovedAwaitingRows(
      [
        // approved-not-issued (Demolition, waiting a while)
        permit({ id: 1, project_id: 'p1', type: 'Demolition', num: 'D-1', da: 'Trevor', approval_date: '2026-06-01', status: 'Ready for Issuance' }),
        // actually issued → excluded
        permit({ id: 2, project_id: 'p2', approval_date: '2026-05-01', actual_issue: '2026-05-15' }),
        // in review → excluded
        permit({ id: 3, project_id: 'p1', status: 'Reviews In Process' }),
        // sub-permit approved-not-issued → excluded (fix-194)
        permit({ id: 4, project_id: 'p2', approval_date: '2026-06-20', parent_permit_id: 1 }),
      ],
      projectsById,
      TODAY,
    );
    expect(rows.map((r) => r.permitId)).toEqual([1]);
    const r = rows[0];
    expect(r.address).toBe('500 Pike St');
    expect(r.juris).toBe('Seattle');
    expect(r.type).toBe('Demolition');
    expect(r.num).toBe('D-1');
    expect(r.da).toBe('Trevor');
    expect(r.approvalDate).toBe('2026-06-01');
  });

  it('computes days-since-approval as of today', () => {
    const rows = buildApprovedAwaitingRows(
      [permit({ id: 1, project_id: 'p1', approval_date: '2026-06-07' })],
      projectsById,
      TODAY, // 2026-07-07 → 30 days
    );
    expect(rows[0].daysSinceApproval).toBe(30);
  });

  it('sorts by days-since-approval DESC (longest-waiting first)', () => {
    const rows = buildApprovedAwaitingRows(
      [
        permit({ id: 1, project_id: 'p1', approval_date: '2026-06-30' }), // 7d
        permit({ id: 2, project_id: 'p2', approval_date: '2026-05-01' }), // 67d
        permit({ id: 3, project_id: 'p1', approval_date: '2026-06-15' }), // 22d
      ],
      projectsById,
      TODAY,
    );
    expect(rows.map((r) => r.permitId)).toEqual([2, 3, 1]);
    expect(rows.map((r) => r.daysSinceApproval)).toEqual([67, 22, 7]);
  });
});
