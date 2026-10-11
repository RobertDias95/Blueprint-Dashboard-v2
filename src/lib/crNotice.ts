import { crNoticeHeadline } from './projectChat';

// ===========================================================================
// ★★★ fix-643 (P-338) — WHEN CORRECTIONS COME OUT, THE BRIDGE TAGS THE TEAM
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-11: *"when the bridge creates a correction cycle post, can
// it tag the DM, DA, ENT, Dave, Lucas, Gena, Brit, Bobby each time, so they
// know corrections are out?"*
//
// ★★★ THE RULE RUNS IN THE DATABASE (`bp_post_cr_notice` and the patched
//     `bp_trg_notify_mentions`, migrations/fix_643_correction_notices.sql). This
//     file is its MIRROR so CI can test every branch without a database (the
//     fix-153 pattern); `CorrectionNoticesFix643.test.ts` pins the SQL text to
//     each clause the mirror assumes, and the SQL itself was run on prod inside
//     a rolled-back transaction.

/** ★★★ News, not history: measured on prod, every fresh corr_issued write
 *  landed within 3 days and every backfill was 15+ days late. */
export const CR_NOTICE_FRESH_DAYS = 14;

/** The fixed half of the audience is this tag's members, edited in Settings. */
export const CORRECTIONS_TAG = 'Corrections';

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export interface CycleWrite {
  permitId: number;
  permitType: string | null;
  cycleIndex: number | null;
  corrIssued: string | null;
}

/** MIRROR of bp_post_cr_notice's gates, before the ledger. */
export function noticeEligible(w: CycleWrite, today: string): boolean {
  if (w.cycleIndex == null || w.cycleIndex < 1) return false;
  if (!w.corrIssued) return false;
  if (w.corrIssued < addDays(today, -CR_NOTICE_FRESH_DAYS) || w.corrIssued > today) return false;
  return w.permitType === 'Building Permit';
}

/** MIRROR of the ledger: once per permit per round, whatever the date does. */
export function ledgerKey(w: Pick<CycleWrite, 'permitId' | 'cycleIndex'>): string {
  return `${w.permitId}|${w.cycleIndex}`;
}

export interface Person {
  userId: string;
  /** The chip text — bp_mentionable_people's name for this login. */
  name: string;
}

export interface NoticeInput {
  permitNum: string | null;
  permitType: string;
  round: number;
  corrIssued: string;
  /** DM, DA, ENT in that order; null = no single active login (skipped). */
  roles: readonly { role: 'DM' | 'DA' | 'ENT'; name: string | null; person: Person | null }[];
  /** null when the tenant has no Corrections tag. */
  tag: { name: string; memberIds: readonly string[] } | null;
}

export interface Notice {
  body: string;
  mentions: string[];
  /** "DA Alex", "the Corrections tag" — RAISEd as a WARNING, never fatal. */
  missing: string[];
}

/** MIRROR of bp_post_cr_notice's body and mentions. */
export function buildNotice(n: NoticeInput): Notice {
  const ids: string[] = [];
  const tokens: string[] = [];
  const missing: string[] = [];
  for (const r of n.roles) {
    if (!r.name || r.name.trim() === '') continue;
    if (!r.person) {
      missing.push(`${r.role} ${r.name.trim()}`);
      continue;
    }
    if (ids.includes(r.person.userId)) continue;
    ids.push(r.person.userId);
    const t = `@${r.person.name}`;
    if (!tokens.includes(t)) tokens.push(t);
  }
  if (!n.tag) {
    missing.push(`the ${CORRECTIONS_TAG} tag`);
  } else {
    for (const id of n.tag.memberIds) if (!ids.includes(id)) ids.push(id);
    tokens.push(`@${n.tag.name.trim()}`);
  }
  const headline = crNoticeHeadline(n.permitNum, n.permitType, n.round, n.corrIssued);
  return {
    body: tokens.length ? `${headline}\n${tokens.join(' ')}` : headline,
    mentions: ids,
    missing,
  };
}

/** MIRROR of bp_trg_notify_mentions' first gate: may this message email? */
export function messageMayEmail(m: { authorId: string | null; isLedgeredNotice: boolean; deleted?: boolean }): boolean {
  if (m.deleted) return false;
  if (m.authorId === null) return m.isLedgeredNotice;
  return true;
}

/** MIRROR of the notice branch of the queueing: one row per address, opt-outs
 *  dropped (the mention switch). */
export function noticeQueue(
  mentions: readonly string[],
  emailOf: (id: string) => string | null,
  mentionOptOut: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const id of new Set(mentions)) {
    const e = (emailOf(id) ?? '').trim().toLowerCase();
    if (!e || mentionOptOut.has(id) || out.includes(e)) continue;
    out.push(e);
  }
  return out;
}
