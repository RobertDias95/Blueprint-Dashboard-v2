import { supabase } from './supabase';
import { BUILD_SHA } from './buildInfo';
import { useRealtimeStore } from '../stores/realtimeStore';
import type { NewItem } from './boardReads';

// ===========================================================================
// ★★★ fix-650 (P-203) — DID IT REACH THE BELL, AND WHEN?
// ===========================================================================
//
// Brittani, 2026-09-09: *"it shows in my notification tab but not in the bell
// or on the app."* The database could say she READ all 45 of her mentions; it
// could not say whether any of them ever lit the bell, because notifications
// are derived HERE, in the browser (fix-336), and nothing here wrote anything
// down.
//
// Two facts are recorded now, and both are fire-and-forget:
//
//   A · a RECEIPT the first time an item enters the bell's unseen list
//       (surface 'bell') and when a desktop banner or ding fires for it
//       (surface 'desktop'), via `bp_record_notification_deliveries`.
//   B · PRESENCE — at most every 5 minutes while the Bridge is open AND
//       VISIBLE, via `bp_touch_presence`.
//
// The server (bp_notification_delivery_check, hourly) joins the two: somebody
// who was visibly here after a mention was sent, and whose bell never
// receipted it and who never read it, is a gap in Error triage.
//
// ⚠️ NEVER A DEPENDENCY. Every call swallows its own failure, nothing awaits
//    it, and nothing about the bell depends on it. If the RPC is missing or
//    the network is down the bell is exactly as correct as before.

export type DeliverySurface = 'bell' | 'desktop';

export interface ReceiptItem {
  key: string;
  kind: string;
  surface: DeliverySurface;
}

/** ★ The server caps a call at 200; one batch never exceeds it. */
export const RECEIPT_BATCH_MAX = 200;
/** ★ Items arrive in bursts (a refetch lands ten at once); one call per burst. */
export const RECEIPT_FLUSH_MS = 2_000;
/** ★ The brief: presence at most every 5 minutes. */
export const PRESENCE_MIN_GAP_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// The pure part — what to send
// ---------------------------------------------------------------------------

function sentKey(userId: string, surface: DeliverySurface, key: string): string {
  return `${userId}|${surface}|${key}`;
}

/**
 * The receipts this pass owes: one per item × surface not already sent by
 * this document for this person.
 *
 * ★★ ONLY UNSEEN ITEMS EVER REACH HERE. The caller passes the bell's own
 *    `unseen` list, which has read items removed by `unseenItems` — so an
 *    item somebody already read never produces a receipt. That is the rule,
 *    and it holds by construction rather than by a second filter.
 * ★ `sent` is not mutated; the caller decides when a send counts as done.
 */
export function planReceipts(
  items: ReadonlyArray<Pick<NewItem, 'key' | 'source'>>,
  surface: DeliverySurface,
  userId: string | null,
  sent: ReadonlySet<string>,
): ReceiptItem[] {
  if (!userId) return [];
  const out: ReceiptItem[] = [];
  const seenThisPass = new Set<string>();
  for (const i of items) {
    if (!i.key) continue;
    const k = sentKey(userId, surface, i.key);
    if (sent.has(k) || seenThisPass.has(k)) continue;
    seenThisPass.add(k);
    out.push({ key: i.key, kind: i.source, surface });
  }
  return out;
}

/** ★ Presence is due when the window is visible and the last write is at
 *  least PRESENCE_MIN_GAP_MS old. A hidden tab is not "somebody is here". */
export function presenceDue(
  now: number,
  lastAt: number,
  visible: boolean,
): boolean {
  if (!visible) return false;
  return lastAt === 0 || now - lastAt >= PRESENCE_MIN_GAP_MS;
}

// ---------------------------------------------------------------------------
// The batcher — module state, one per document
// ---------------------------------------------------------------------------

interface Pending extends ReceiptItem {
  realtime: string;
}

let sent = new Set<string>();
let queue: Array<Pending & { sentKey: string }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastPresenceAt = 0;

/** Test seam. */
export function __resetDeliveryReceipts(): void {
  sent = new Set();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  lastPresenceAt = 0;
}

function realtimeNow(): string {
  try {
    return useRealtimeStore.getState?.().status ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Queue receipts for these items on this surface. Deduped against everything
 * this document has already sent or queued for the person. Never throws.
 */
export function recordDeliveries(
  items: ReadonlyArray<Pick<NewItem, 'key' | 'source'>>,
  surface: DeliverySurface,
  userId: string | null,
): void {
  try {
    const plan = planReceipts(items, surface, userId, sent);
    if (plan.length === 0) return;
    // ★ "the realtime status at that moment" — read now, not at flush time.
    const realtime = realtimeNow();
    for (const r of plan) {
      const k = sentKey(userId!, surface, r.key);
      sent.add(k);
      queue.push({ ...r, realtime, sentKey: k });
    }
    if (queue.length >= RECEIPT_BATCH_MAX) {
      void flushDeliveries();
    } else if (!timer) {
      timer = setTimeout(() => void flushDeliveries(), RECEIPT_FLUSH_MS);
    }
  } catch {
    /* A receipt is evidence, never a dependency. */
  }
}

/** Send everything queued. Exported for the test and for a page unload. */
export async function flushDeliveries(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;
  // ★ One call per realtime status, at most RECEIPT_BATCH_MAX items each.
  const groups = new Map<string, typeof batch>();
  for (const p of batch) {
    const g = groups.get(p.realtime);
    if (g) g.push(p);
    else groups.set(p.realtime, [p]);
  }
  for (const [realtime, group] of groups) {
    for (let i = 0; i < group.length; i += RECEIPT_BATCH_MAX) {
      const chunk = group.slice(i, i + RECEIPT_BATCH_MAX);
      try {
        if (typeof supabase?.rpc !== 'function') continue;
        const { error } = await supabase.rpc('bp_record_notification_deliveries', {
          p_items: chunk.map(({ key, kind, surface }) => ({ key, kind, surface })),
          p_realtime_status: realtime,
          p_build: BUILD_SHA,
        });
        if (error) throw error;
      } catch (err) {
        // ★★ FORGET THE SEND so the next pass tries again. A lost receipt is a
        //    false gap in Error triage; a repeated one costs nothing (the
        //    server ignores duplicates).
        for (const p of chunk) sent.delete(p.sentKey);
        if (import.meta.env.DEV) {
          console.warn('[deliveryReceipts] bp_record_notification_deliveries failed', err);
        }
      }
    }
  }
}

/**
 * Write presence if it is due. Never throws, never awaited on a hot path.
 * Returns whether a write was attempted (for the test).
 */
export function touchPresence(
  now: number = Date.now(),
  visible: boolean = typeof document === 'undefined'
    ? false
    : document.visibilityState === 'visible',
): boolean {
  if (!presenceDue(now, lastPresenceAt, visible)) return false;
  lastPresenceAt = now;
  try {
    if (typeof supabase?.rpc !== 'function') return true;
    void Promise.resolve(supabase.rpc('bp_touch_presence'))
      .then((res) => {
        if (res && (res as { error?: unknown }).error) lastPresenceAt = 0;
      })
      .catch(() => {
        // ★ Try again on the next beat rather than in five minutes.
        lastPresenceAt = 0;
      });
  } catch {
    lastPresenceAt = 0;
  }
  return true;
}
