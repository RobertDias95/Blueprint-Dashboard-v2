import { describe, it, expect } from 'vitest';
import { activeMemberNamesOf } from '../hooks/useTeamMembers';
import type { TeamMember } from '../lib/database.types';

// fix-233: the task assignee dropdowns (primary + co-assignee) source their
// roster from activeMemberNamesOf — CURRENT team members only. Departed staff
// (active=false) must never appear as selectable options.

function m(over: Partial<TeamMember> & Pick<TeamMember, 'name' | 'role'>): TeamMember {
  return {
    id: `m-${over.name}-${over.role}`,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-01-01T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

describe('activeMemberNamesOf (fix-233)', () => {
  // Prod ground truth: Alex/Chad/Nidhi ended 2026-Q1 (active=false, former=false);
  // Gena is a current DA (active=true); Miles holds ent + ent_lead (active).
  const roster: TeamMember[] = [
    m({ name: 'Chad', role: 'da', active: false }),
    m({ name: 'Nidhi', role: 'da', active: false }),
    m({ name: 'Alex', role: 'da', active: false }),
    m({ name: 'Gena', role: 'da', active: true }),
    m({ name: 'Miles', role: 'ent', active: true }),
    m({ name: 'Miles', role: 'ent_lead', active: true }),
    m({ name: 'Priya', role: 'da', active: true, former: true }), // former → excluded
  ];

  it('excludes inactive (active=false) people — Chad / Nidhi / Alex are gone', () => {
    const names = activeMemberNamesOf(roster);
    expect(names).not.toContain('Chad');
    expect(names).not.toContain('Nidhi');
    expect(names).not.toContain('Alex');
  });

  it('includes a CURRENT person (Gena)', () => {
    expect(activeMemberNamesOf(roster)).toContain('Gena');
  });

  it('excludes former members even when active', () => {
    expect(activeMemberNamesOf(roster)).not.toContain('Priya');
  });

  it('dedupes a multi-role person (Miles: ent + ent_lead) to one entry, sorted A→Z', () => {
    const names = activeMemberNamesOf(roster);
    expect(names.filter((n) => n === 'Miles')).toEqual(['Miles']);
    expect(names).toEqual(['Gena', 'Miles']); // only the two current people, sorted
  });

  it('treats a missing `active` flag as active (defensive) and drops blanks', () => {
    const names = activeMemberNamesOf([
      { id: 'x', name: 'NoFlag', role: 'da' } as TeamMember,
      m({ name: '', role: 'da', active: true }),
    ]);
    expect(names).toEqual(['NoFlag']);
  });

  it('handles null / empty input', () => {
    expect(activeMemberNamesOf(null)).toEqual([]);
    expect(activeMemberNamesOf([])).toEqual([]);
  });
});
