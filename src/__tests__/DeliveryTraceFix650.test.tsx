import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import migrationSource from '../../migrations/fix_650_notification_delivery_trace.sql?raw';
import driverSource from '../hooks/useDesktopAlerts.ts?raw';
import chromeSource from '../components/Chrome.tsx?raw';
import routerSource from '../router.tsx?raw';
import errorsSource from '../pages/Errors.tsx?raw';

// ===========================================================================
// fix-650 (P-203) — make notification delivery traceable
// ===========================================================================
//
// Brittani: "it shows in my notification tab but not in the bell or on the
// app." Bobby: "we need to know and ensure peoples notifications are reaching
// them." A receipt when an item reaches the bell, presence while the Bridge is
// visible, an hourly check that files a gap into Error triage once, and an
// admin report beside it.

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));

const rt = vi.hoisted(() => ({ status: 'SUBSCRIBED' as string }));
vi.mock('../stores/realtimeStore', () => ({
  useRealtimeStore: { getState: () => ({ status: rt.status }) },
}));

const report = vi.hoisted(() => ({ data: undefined as unknown, isLoading: false, isError: false }));
vi.mock('../hooks/useNotificationDeliveryReport', () => ({
  useNotificationDeliveryReport: () => report,
}));

import {
  __resetDeliveryReceipts,
  flushDeliveries,
  planReceipts,
  presenceDue,
  recordDeliveries,
  touchPresence,
  PRESENCE_MIN_GAP_MS,
  RECEIPT_BATCH_MAX,
} from '../lib/deliveryReceipts';
import {
  formatMinutes,
  gapFingerprint,
  gapItemHref,
  isDeliveryGap,
  mapDeliveryReport,
  newTriageFingerprints,
  ofTotal,
  reportTotals,
} from '../lib/notificationDelivery';
import { unseenItems, type NewItem } from '../lib/boardReads';
import NotificationDeliveryPage from '../pages/NotificationDelivery';

const ME = 'user-1';

function item(key: string, source: NewItem['source'] = 'mention'): NewItem {
  return {
    key,
    source,
    title: 't',
    subtitle: null,
    where: 'w',
    at: '2026-10-12T16:00:00Z',
    permitId: null,
    projectId: null,
  };
}

/** Strip SQL comments and collapse whitespace, so pins match the code. */
function sqlCode(src: string): string {
  return src
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}
const SQL = sqlCode(migrationSource);

beforeEach(() => {
  __resetDeliveryReceipts();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
  rt.status = 'SUBSCRIBED';
});

// ---------------------------------------------------------------------------
// A · receipts
// ---------------------------------------------------------------------------
describe('fix-650 A — a receipt once per item and surface', () => {
  it('plans one receipt per item per surface, deduped inside a pass', () => {
    const plan = planReceipts([item('mention:a'), item('mention:a'), item('task:b', 'task')], 'bell', ME, new Set());
    expect(plan).toEqual([
      { key: 'mention:a', kind: 'mention', surface: 'bell' },
      { key: 'task:b', kind: 'task', surface: 'bell' },
    ]);
  });

  it('plans nothing without a signed-in user', () => {
    expect(planReceipts([item('mention:a')], 'bell', null, new Set())).toEqual([]);
  });

  it('writes the receipt once — a second pass over the same item sends nothing', async () => {
    recordDeliveries([item('mention:a')], 'bell', ME);
    await flushDeliveries();
    recordDeliveries([item('mention:a')], 'bell', ME);
    await flushDeliveries();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bp_record_notification_deliveries', {
      p_items: [{ key: 'mention:a', kind: 'mention', surface: 'bell' }],
      p_realtime_status: 'SUBSCRIBED',
      p_build: expect.any(String),
    });
  });

  it('the desktop surface is a separate receipt for the same item', async () => {
    recordDeliveries([item('mention:a')], 'bell', ME);
    recordDeliveries([item('mention:a')], 'desktop', ME);
    await flushDeliveries();
    const sent = rpc.mock.calls.flatMap((c) => (c[1] as { p_items: unknown[] }).p_items);
    expect(sent).toEqual([
      { key: 'mention:a', kind: 'mention', surface: 'bell' },
      { key: 'mention:a', kind: 'mention', surface: 'desktop' },
    ]);
  });

  it('records the realtime status at the moment the item arrived, not at flush', async () => {
    rt.status = 'CHANNEL_ERROR';
    recordDeliveries([item('mention:a')], 'bell', ME);
    rt.status = 'SUBSCRIBED';
    await flushDeliveries();
    expect(rpc.mock.calls[0][1].p_realtime_status).toBe('CHANNEL_ERROR');
  });

  it('nothing is written for an item that was already read', async () => {
    const items = [item('mention:read'), item('mention:new')];
    const unseen = unseenItems(items, new Set(['mention:read']));
    recordDeliveries(unseen, 'bell', ME);
    await flushDeliveries();
    const keys = rpc.mock.calls.flatMap((c) =>
      (c[1] as { p_items: Array<{ key: string }> }).p_items.map((p) => p.key),
    );
    expect(keys).toEqual(['mention:new']);
  });

  it('a failed send is forgotten so the next pass retries it', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    recordDeliveries([item('mention:a')], 'bell', ME);
    await flushDeliveries();
    recordDeliveries([item('mention:a')], 'bell', ME);
    await flushDeliveries();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('never throws when the RPC rejects', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    recordDeliveries([item('mention:a')], 'bell', ME);
    await expect(flushDeliveries()).resolves.toBeUndefined();
  });

  it('a batch never exceeds the server cap', async () => {
    const many = Array.from({ length: RECEIPT_BATCH_MAX + 5 }, (_, i) => item(`task:${i}`, 'task'));
    recordDeliveries(many, 'bell', ME);
    await flushDeliveries();
    for (const c of rpc.mock.calls) {
      expect((c[1] as { p_items: unknown[] }).p_items.length).toBeLessThanOrEqual(RECEIPT_BATCH_MAX);
    }
    const total = rpc.mock.calls.reduce((n, c) => n + (c[1] as { p_items: unknown[] }).p_items.length, 0);
    expect(total).toBe(RECEIPT_BATCH_MAX + 5);
  });

  it('the shell driver writes bell receipts from the unseen list and desktop receipts only for what was announced', () => {
    expect(driverSource).toMatch(/recordDeliveries\(unseen, 'bell'/);
    expect(driverSource).toMatch(/recordDeliveries\(announcedOnDesktop, 'desktop'/);
  });
});

// ---------------------------------------------------------------------------
// B · presence
// ---------------------------------------------------------------------------
describe('fix-650 B — presence at most every 5 minutes, only while visible', () => {
  it('is never due for a hidden window', () => {
    expect(presenceDue(1_000_000, 0, false)).toBe(false);
  });
  it('is due on the first visible beat, then not again for 5 minutes', () => {
    const t0 = 10_000_000;
    expect(touchPresence(t0, true)).toBe(true);
    expect(touchPresence(t0 + 60_000, true)).toBe(false);
    expect(touchPresence(t0 + PRESENCE_MIN_GAP_MS, true)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('bp_touch_presence');
  });
  it('a hidden window writes nothing', () => {
    expect(touchPresence(10_000_000, false)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('is mounted once, in the shell', () => {
    expect(chromeSource).toMatch(/usePresenceHeartbeat\(\);/);
  });
});

// ---------------------------------------------------------------------------
// C · the gap rule and the triage write
// ---------------------------------------------------------------------------
describe('fix-650 C — a gap only when the person was there', () => {
  const NOW = Date.parse('2026-10-12T20:00:00Z');
  const c = { user_id: ME, item_key: 'mention:x', created_at: '2026-10-12T17:00:00Z' };
  const active = { last_active_at: '2026-10-12T19:30:00Z', active_since: '2026-10-12T16:00:00Z' };

  it('flags an unread, unreceipted item for a person who was in the Bridge afterwards', () => {
    expect(isDeliveryGap(c, active, false, false, NOW)).toBe(true);
  });
  it('no gap when the person was never in the Bridge after it was sent', () => {
    expect(isDeliveryGap(c, { last_active_at: '2026-10-12T17:03:00Z', active_since: '2026-10-12T16:00:00Z' }, false, false, NOW)).toBe(false);
    expect(isDeliveryGap(c, undefined, false, false, NOW)).toBe(false);
  });
  it('no gap when the bell receipted it, or it was read', () => {
    expect(isDeliveryGap(c, active, false, true, NOW)).toBe(false);
    expect(isDeliveryGap(c, active, true, false, NOW)).toBe(false);
  });
  it('no gap for an item younger than an hour', () => {
    expect(isDeliveryGap({ ...c, created_at: '2026-10-12T19:30:00Z' }, active, false, false, NOW)).toBe(false);
  });
  it('no gap for somebody who opened the app seconds ago (their bell is still loading)', () => {
    expect(isDeliveryGap(c, { last_active_at: '2026-10-12T19:59:50Z', active_since: '2026-10-12T19:59:30Z' }, false, false, NOW)).toBe(false);
  });
  it('a gap is filed once: an existing fingerprint is never written again', () => {
    const fp = gapFingerprint(ME, 'mention:x');
    expect(newTriageFingerprints([c, c], new Set())).toEqual([fp]);
    expect(newTriageFingerprints([c], new Set([fp]))).toEqual([]);
  });

  it('the SQL rule is the TS rule (pins)', () => {
    expect(SQL).toContain("c.created_at <= p_now - interval '1 hour'");
    expect(SQL).toContain("up.last_active_at >= c.created_at + interval '5 minutes'");
    expect(SQL).toContain("up.active_since <= p_now - interval '2 minutes'");
    expect(SQL).toMatch(/NOT EXISTS \( SELECT 1 FROM public\.board_item_reads r/);
    expect(SQL).toMatch(/d\.surface = 'bell'/);
    // ★ one triage row per new fingerprint, never repeated
    expect(SQL).toContain("'notification_delivery:' || g.user_id::text || ':' || g.item_key");
    expect(SQL).toMatch(/WHERE NOT EXISTS \( SELECT 1 FROM public\.error_reports e/);
    expect(SQL).toContain("'notification_delivery', 'warning'");
    // ★ the two server-derivable kinds and the fix-307 epoch
    expect(SQL).toContain("'mention:' || m.id::text");
    expect(SQL).toContain("'task:' || t.id::text");
    expect(SQL).toContain("'2026-08-14T00:00:00Z'");
    // ★ weekdays 7 AM–6 PM Pacific, hourly
    expect(SQL).toContain("extract(hour FROM v_local) < 7 OR extract(hour FROM v_local) > 18");
    expect(SQL).toContain("'bp-notification-delivery-check', '5 * * * *'");
  });

  it('receipts are insert-only and per person (RLS + grants)', () => {
    expect(SQL).toContain('UNIQUE (user_id, item_key, surface)');
    expect(SQL).toMatch(/CREATE POLICY notification_deliveries_insert .* user_id = auth\.uid\(\)/);
    expect(SQL).not.toMatch(/notification_deliveries FOR (UPDATE|DELETE)/);
    expect(SQL).toContain('GRANT SELECT, INSERT ON TABLE public.notification_deliveries TO authenticated');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.bp_notification_delivery_check(boolean) TO service_role');
  });
});

// ---------------------------------------------------------------------------
// D · the report
// ---------------------------------------------------------------------------
const RAW = {
  from: '2026-10-12T18:00:00Z',
  days: 30,
  delivery_epoch: '2026-10-12T18:00:00Z',
  rows: [
    {
      user_id: 'u-b', person: 'Brittani', notified: 10, reached_bell: 9, median_bell_min: 0.4,
      read: 9, median_read_min: 17, gaps: 1, last_active_at: '2026-10-12T19:00:00Z',
      gap_items: [{
        id: 7, flagged_at: '2026-10-12T20:05:00Z', status: 'new', item_key: 'mention:m1',
        kind: 'mention', created_at: '2026-10-12T18:30:00Z', address: '2601 E Galer St',
        project_id: 'p1', permit_id: null, message: 'x',
      }],
    },
    {
      user_id: 'u-m', person: 'Miles', notified: 4, reached_bell: 4, median_bell_min: 2,
      read: 3, median_read_min: 90, gaps: 0, gap_items: [], last_active_at: null,
    },
  ],
};

describe('fix-650 D — the report counts', () => {
  it('maps and totals', () => {
    const r = mapDeliveryReport(RAW);
    expect(r.rows).toHaveLength(2);
    expect(reportTotals(r.rows)).toEqual({ notified: 14, reached_bell: 13, read: 12, gaps: 1 });
  });
  it('words counts and times', () => {
    expect(ofTotal(9, 10)).toBe('9 of 10 (90%)');
    expect(ofTotal(0, 0)).toBe('0');
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(0.4)).toBe('<1 min');
    expect(formatMinutes(17)).toBe('17 min');
    expect(formatMinutes(90)).toBe('1.5 h');
    expect(formatMinutes(60 * 72)).toBe('3 d');
  });
  it('a gap item opens the message that was missed', () => {
    expect(gapItemHref(RAW.rows[0].gap_items[0] as never)).toBe('/project/p1?msg=m1');
  });
  it('renders one row per person and expands the gaps', () => {
    report.data = mapDeliveryReport(RAW);
    render(
      <MemoryRouter>
        <NotificationDeliveryPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('nd-row-u-b').textContent).toContain('9 of 10 (90%)');
    expect(screen.getByTestId('nd-row-u-m').textContent).toContain('4 of 4 (100%)');
    expect(screen.queryByTestId('nd-gap-items-u-b')).toBeNull();
    fireEvent.click(screen.getByTestId('nd-gaps-u-b'));
    expect(screen.getByTestId('nd-gap-items-u-b').textContent).toContain('2601 E Galer St');
    expect(screen.getByTestId('notification-delivery-window').textContent).toContain('13 of 14');
  });
  it('lives beside Error triage, admin-gated', () => {
    expect(routerSource).toMatch(/path: 'settings\/notification-delivery',\s*element: <AdminRoute><NotificationDeliveryPage \/><\/AdminRoute>/);
    expect(errorsSource).toContain('to="/settings/notification-delivery"');
    expect(errorsSource).toContain("notification_delivery: 'Delivery'");
  });
});
