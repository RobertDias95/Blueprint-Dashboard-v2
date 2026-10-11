import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// fix-637 — "Seattle intake warning goes to" (a multi-select of people) and the
// `?tab=intake` link both deliveries use.

const mocks = vi.hoisted(() => ({
  chosen: ['Miles', 'Briana'] as string[],
  saved: [] as { key: string; value: unknown }[],
}));

vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map<string, unknown>([['seattleIntakeWarningRecipients', mocks.chosen]]) }),
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) => {
    const v = map.get(key);
    return Array.isArray(v) ? (v as string[]) : [];
  },
}));
vi.mock('../hooks/useSetAppConfigKey', () => ({
  useSetAppConfigKey: () => ({
    mutate: (input: { key: string; value: unknown }) => mocks.saved.push(input),
    isPending: false,
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      { name: 'Miles', role: 'ent', active: true, former: false, email: 'm@x.com' },
      { name: 'Miles', role: 'acq', active: true, former: false, email: 'm@x.com' },
      { name: 'Briana', role: 'ent', active: true, former: false, email: 'b@x.com' },
      { name: 'Jeremy', role: 'da', active: true, former: false, email: null },
      { name: 'Nidhi', role: 'da', active: false, former: true, email: 'n@x.com' },
      { name: 'Guest', role: 'viewer', active: true, former: false, email: 'g@x.com' },
    ],
  }),
}));
// DrawSchedule's heavy children are not what this checks.
vi.mock('../components/DrawScheduleGrid', () => ({ default: () => <div data-testid="grid-stub" /> }));
vi.mock('../components/IntakeTracker', () => ({ default: () => <div data-testid="tracker-stub" /> }));
vi.mock('../components/DrawSchedule/StatusLegend', () => ({ default: () => null }));

import IntakeWarningRecipientsEditor from '../components/Settings/IntakeWarningRecipientsEditor';
import DrawSchedule from '../pages/DrawSchedule';

beforeEach(() => {
  mocks.chosen = ['Miles', 'Briana'];
  mocks.saved = [];
});

describe('fix-637: Settings — Seattle intake warning goes to', () => {
  it('shows the chosen people (seeded Miles and Briana)', () => {
    render(<IntakeWarningRecipientsEditor readOnly={false} />);
    const chosen = screen.getByTestId('settings-intake-warning-chosen');
    expect(within(chosen).getByText('Miles')).toBeInTheDocument();
    expect(within(chosen).getByText('Briana')).toBeInTheDocument();
  });

  it('★ the dropdown offers current people only — once each, never former or viewers', () => {
    render(<IntakeWarningRecipientsEditor readOnly={false} />);
    const options = [...(screen.getByTestId('settings-intake-warning-add') as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(['', 'Jeremy']);
  });

  it('★ adding saves the whole list; removing saves it without that person', () => {
    render(<IntakeWarningRecipientsEditor readOnly={false} />);
    fireEvent.change(screen.getByTestId('settings-intake-warning-add'), { target: { value: 'Jeremy' } });
    fireEvent.click(screen.getByTestId('settings-intake-warning-remove-Briana'));
    expect(mocks.saved).toEqual([
      { key: 'seattleIntakeWarningRecipients', value: ['Miles', 'Briana', 'Jeremy'] },
      { key: 'seattleIntakeWarningRecipients', value: ['Miles'] },
    ]);
  });

  it('a person with no roster email is flagged — they would get no email', () => {
    mocks.chosen = ['Jeremy'];
    render(<IntakeWarningRecipientsEditor readOnly={false} />);
    expect(screen.getByTestId('settings-intake-warning-person-Jeremy').getAttribute('title')).toMatch(/no email/i);
  });

  it('read-only (non-admin): no add, no remove', () => {
    render(<IntakeWarningRecipientsEditor readOnly />);
    expect(screen.queryByTestId('settings-intake-warning-add')).toBeNull();
    expect(screen.queryByTestId('settings-intake-warning-remove-Miles')).toBeNull();
  });
});

describe('fix-637: /draw-schedule?tab=intake opens Seattle Intakes', () => {
  it('★ the link both deliveries use lands on the tracker', () => {
    render(<MemoryRouter initialEntries={['/draw-schedule?tab=intake']}><DrawSchedule /></MemoryRouter>);
    expect(screen.getByTestId('tracker-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('grid-stub')).toBeNull();
  });

  it('without it, the page still opens on the Draw Schedule', () => {
    render(<MemoryRouter initialEntries={['/draw-schedule']}><DrawSchedule /></MemoryRouter>);
    expect(screen.getByTestId('grid-stub')).toBeInTheDocument();
  });
});
