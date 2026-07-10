import { describe, it, expect } from 'vitest';
import {
  nextCheckboxStatus,
  checkboxVisual,
  statusLabel,
  applyDoneTrigger,
  TASK_STATUS_OPTIONS,
  type TaskStatus,
} from '../lib/taskStatus';

// fix-235: shared status-transition helper used by BOTH controls (row checkbox
// + detail-pane dropdown). applyDoneTrigger is the pure TS mirror of the
// bp_trg_task_done_at DB trigger (migrations/fix_235_task_done_sync.sql) — this
// suite is the CI stand-in for the trigger since there's no live DB in CI.

describe('nextCheckboxStatus — forward-only checkbox advance', () => {
  it('Open → In Progress', () => {
    expect(nextCheckboxStatus('Open')).toBe('In Progress');
  });
  it('In Progress → Resolved', () => {
    expect(nextCheckboxStatus('In Progress')).toBe('Resolved');
  });
  it('Resolved is terminal — no forward move (null)', () => {
    expect(nextCheckboxStatus('Resolved')).toBeNull();
  });
});

describe('checkboxVisual — 3-state box', () => {
  it('Open → empty', () => expect(checkboxVisual('Open')).toBe('empty'));
  it('In Progress → partial', () =>
    expect(checkboxVisual('In Progress')).toBe('partial'));
  it('Resolved → checked', () =>
    expect(checkboxVisual('Resolved')).toBe('checked'));
});

describe('dropdown options', () => {
  it('offers all three statuses, with Open labeled "Not started"', () => {
    expect(TASK_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'Open',
      'In Progress',
      'Resolved',
    ]);
    expect(statusLabel('Open')).toBe('Not started');
    expect(statusLabel('In Progress')).toBe('In Progress');
    expect(statusLabel('Resolved')).toBe('Resolved');
  });
});

describe('applyDoneTrigger — write-path unification of done/done_at', () => {
  const NOW = '2026-07-10T12:00:00.000Z';

  it('advancing into Resolved sets done=true and stamps done_at=now', () => {
    expect(
      applyDoneTrigger({
        prevStatus: 'In Progress',
        nextStatus: 'Resolved',
        prevDoneAt: null,
        now: NOW,
      }),
    ).toEqual({ done: true, done_at: NOW });
  });

  it('re-saving an already-Resolved task preserves the original done_at', () => {
    const original = '2026-01-01T00:00:00.000Z';
    expect(
      applyDoneTrigger({
        prevStatus: 'Resolved',
        nextStatus: 'Resolved',
        prevDoneAt: original,
        now: NOW,
      }),
    ).toEqual({ done: true, done_at: original });
  });

  it('moving Resolved → In Progress clears done and done_at', () => {
    expect(
      applyDoneTrigger({
        prevStatus: 'Resolved',
        nextStatus: 'In Progress',
        prevDoneAt: '2026-01-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ done: false, done_at: null });
  });

  it('moving Resolved → Open clears done and done_at', () => {
    expect(
      applyDoneTrigger({
        prevStatus: 'Resolved',
        nextStatus: 'Open',
        prevDoneAt: '2026-01-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ done: false, done_at: null });
  });

  it('Open and In Progress are always done=false with no done_at', () => {
    const cases: TaskStatus[] = ['Open', 'In Progress'];
    for (const s of cases) {
      expect(
        applyDoneTrigger({
          prevStatus: null,
          nextStatus: s,
          prevDoneAt: null,
          now: NOW,
        }),
      ).toEqual({ done: false, done_at: null });
    }
  });

  it('full checkbox cycle Open → In Progress → Resolved lands done=true', () => {
    let status: TaskStatus = 'Open';
    let doneAt: string | null = null;
    // click 1
    status = nextCheckboxStatus(status)!;
    let r = applyDoneTrigger({ prevStatus: 'Open', nextStatus: status, prevDoneAt: doneAt, now: NOW });
    expect(r).toEqual({ done: false, done_at: null });
    doneAt = r.done_at;
    // click 2
    const prev = status;
    status = nextCheckboxStatus(status)!;
    r = applyDoneTrigger({ prevStatus: prev, nextStatus: status, prevDoneAt: doneAt, now: NOW });
    expect(status).toBe('Resolved');
    expect(r).toEqual({ done: true, done_at: NOW });
    // click 3 — terminal, no further advance
    expect(nextCheckboxStatus(status)).toBeNull();
  });
});
