import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScraperActivityRow } from '../lib/database.types';
import ActivityProjectGroup from '../components/activity/ActivityProjectGroup';

// fix-61: focused tests for the Open-Project header control. The full-
// page integration tests live in ActivityPage.test.tsx; this file
// targets edge cases of the group header directly — chiefly that the
// Open-Project link is suppressed when no row in the group resolves to
// a project_id (RPC LEFT JOIN miss).

function mkRow(over: Partial<ScraperActivityRow> = {}): ScraperActivityRow {
  return {
    id: 1,
    created_at: '2026-05-18T18:00:00Z',
    action: 'scrape_change_applied',
    row_id: '100',
    changes: {},
    permit_num: '7101215-DM',
    permit_type: 'Demolition',
    address: '3670 Interlake Ave N',
    juris: 'Seattle',
    cycle_index: null,
    ent_lead: 'Bobby',
    portal_url: null,
    project_id: null,
    ...over,
  };
}

function renderGroup(rows: ScraperActivityRow[], address: string) {
  return render(
    <MemoryRouter>
      <ActivityProjectGroup
        address={address}
        isUnknown={false}
        rows={rows}
        summariesById={new Map(rows.map((r) => [r.id, [] as string[]]))}
        readIds={new Set<number>()}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('<ActivityProjectGroup /> fix-61', () => {
  it('renders Open Project link with /project/<uuid> when project_id present', () => {
    const rows = [
      mkRow({
        id: 10,
        address: '123 Pine St',
        project_id: '11111111-2222-3333-4444-555555555555',
      }),
    ];
    renderGroup(rows, '123 Pine St');
    const link = screen.getByTestId(
      'activity-group-open-project-123 Pine St',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      '/project/11111111-2222-3333-4444-555555555555',
    );
    expect(link.textContent).toBe('Open Project');
  });

  it('hides Open Project when no row resolves to a project_id', () => {
    const rows = [
      mkRow({ id: 20, address: '999 Nowhere St', project_id: null }),
      mkRow({ id: 21, address: '999 Nowhere St', project_id: null }),
    ];
    renderGroup(rows, '999 Nowhere St');
    expect(
      screen.queryByTestId('activity-group-open-project-999 Nowhere St'),
    ).toBeNull();
  });

  it('picks the first non-null project_id across the group rows', () => {
    // First row's project_id is null (audit_log row that didn't resolve);
    // second row carries the project_id. The header should still surface
    // the Open Project link routed to the second row's id.
    const rows = [
      mkRow({ id: 30, address: '456 Cedar St', project_id: null }),
      mkRow({
        id: 31,
        address: '456 Cedar St',
        project_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    ];
    renderGroup(rows, '456 Cedar St');
    const link = screen.getByTestId(
      'activity-group-open-project-456 Cedar St',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      '/project/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
  });
});
