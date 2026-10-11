import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IntakeWarningRow } from '../lib/intakeWarning';
import { settle } from '../test/settle';

// fix-637 §B (P-180) — the daily pop-up. The Weekly Update's pattern: a clock,
// one EXACT read key per day (fix-627), Close dismisses for today only.

const mocks = vi.hoisted(() => ({
  myName: 'Miles' as string | null,
  recipients: ['Miles', 'Briana'] as unknown,
  readKeysAsked: [] as (string | null)[],
  alreadyRead: false,
  marked: [] as string[][],
  rpcCalls: [] as { fn: string; args: unknown }[],
  rows: [] as IntakeWarningRow[],
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { id: 'u-miles' }, activeTenantId: 't1' }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({ identity: { name: mocks.myName }, userId: 'u-miles', isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    map: new Map<string, unknown>([['seattleIntakeWarningRecipients', mocks.recipients]]),
  }),
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) => {
    const v = map.get(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  },
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardItemRead: (key: string | null) => {
    mocks.readKeysAsked.push(key);
    return key ? { data: mocks.alreadyRead, isSuccess: true } : { data: undefined, isSuccess: false };
  },
  useMarkBoardItemsRead: () => ({ mutate: (keys: string[]) => mocks.marked.push(keys), isPending: false }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      mocks.rpcCalls.push({ fn, args });
      return { data: mocks.rows, error: null };
    },
  },
}));

import IntakeWarningModal from '../components/IntakeWarning/IntakeWarningModal';

const ROWS: IntakeWarningRow[] = [
  { slot_id: 205, tenant_id: 't1', project_id: 'proj-1', permit_id: null, address: '6605 57th Ave NE', permit_num: '7150289-CN', permit_type: 'Building Permit', is_placeholder: false, intake_date: '2026-10-15', business_days_left: 3, past_date: false },
  { slot_id: 82, tenant_id: 't1', project_id: null, permit_id: null, address: 'OPEN', permit_num: '6358597-CN', permit_type: 'Building Permit', is_placeholder: true, intake_date: '2026-10-13', business_days_left: 1, past_date: false },
];

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<IntakeWarningModal />, { wrapper });
}

/** Freeze only the clock: 10:00 Pacific on the given day. */
function at(isoUtc: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(isoUtc));
}

beforeEach(() => {
  mocks.myName = 'Miles';
  mocks.recipients = ['Miles', 'Briana'];
  mocks.readKeysAsked = [];
  mocks.alreadyRead = false;
  mocks.marked = [];
  mocks.rpcCalls = [];
  mocks.rows = ROWS;
  at('2026-10-12T17:00:00Z'); // Monday 10:00 PDT
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fix-637 §B: the daily pop-up', () => {
  it('★★ a recipient sees it on a business day: each slot, its permit or Placeholder, date and days left', async () => {
    renderModal();
    expect(await screen.findByTestId('intake-warning-modal')).toBeInTheDocument();
    expect(screen.getByTestId('intake-warning-count')).toHaveTextContent('2 due · 10/12/2026');
    expect(screen.getByTestId('intake-warning-row-205')).toHaveTextContent('6605 57th Ave NE');
    expect(screen.getByTestId('intake-warning-row-205')).toHaveTextContent('7150289-CN · Building Permit');
    expect(screen.getByTestId('intake-warning-row-205')).toHaveTextContent('10/15/2026');
    expect(screen.getByTestId('intake-warning-left-205')).toHaveTextContent('3 business days left');
    expect(screen.getByTestId('intake-warning-row-82')).toHaveTextContent('Placeholder');
    expect(screen.getByTestId('intake-warning-left-82')).toHaveTextContent('1 business day left');
  });

  it('★ it reads the database rule for TODAY in Pacific time', async () => {
    renderModal();
    await screen.findByTestId('intake-warning-modal');
    expect(mocks.rpcCalls).toEqual([{ fn: 'bp_intake_warning_due', args: { p_today: '2026-10-12' } }]);
  });

  it('★★★ fix-627: the day is asked for by ONE EXACT key', async () => {
    renderModal();
    await screen.findByTestId('intake-warning-modal');
    const asked = mocks.readKeysAsked.filter((k): k is string => k !== null);
    expect(new Set(asked)).toEqual(new Set(['intake-warning:2026-10-12']));
  });

  it('★★ Close marks today read (and only today)', async () => {
    renderModal();
    fireEvent.click(await screen.findByTestId('intake-warning-close'));
    expect(mocks.marked).toEqual([['intake-warning:2026-10-12']]);
  });

  it('★ already closed today → not shown, and the list is not even fetched', async () => {
    mocks.alreadyRead = true;
    renderModal();
    await waitFor(() => expect(mocks.readKeysAsked.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('intake-warning-modal')).toBeNull();
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it('★★ someone not on the list never sees it', async () => {
    mocks.myName = 'Bobby';
    renderModal();
    await settle();
    expect(screen.queryByTestId('intake-warning-modal')).toBeNull();
    expect(mocks.readKeysAsked.every((k) => k === null)).toBe(true);
  });

  it('★ not on a weekend', async () => {
    at('2026-10-10T17:00:00Z'); // Saturday
    renderModal();
    await settle();
    expect(screen.queryByTestId('intake-warning-modal')).toBeNull();
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it('nothing due → nothing shown', async () => {
    mocks.rows = [];
    renderModal();
    await waitFor(() => expect(mocks.rpcCalls).toHaveLength(1));
    expect(screen.queryByTestId('intake-warning-modal')).toBeNull();
  });

  it('links: the project, and the Intake Tracker tab', async () => {
    renderModal();
    await screen.findByTestId('intake-warning-modal');
    expect(screen.getByTestId('intake-warning-project-205').getAttribute('href')).toBe('/project/proj-1');
    expect(screen.queryByTestId('intake-warning-project-82')).toBeNull(); // a placeholder has no project
    expect(screen.getByTestId('intake-warning-open-tracker').getAttribute('href')).toBe('/draw-schedule?tab=intake');
  });
});
