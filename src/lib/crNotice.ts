import { crNoticeHeadline } from './projectChat';
import { resolveTagUserIds } from './mentionTags';

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

/** One role of the chat's project team (`bp_project_team_names`). */
export interface TeamRole {
  role: 'ENT' | 'DM' | 'DA';
  name: string;
  /** null = no single active login (skipped, and reported). */
  userId: string | null;
}

export interface NoticeInput {
  permitNum: string | null;
  permitType: string;
  round: number;
  corrIssued: string;
  /** The project's ENT · DM · DA — the `@project` rule. */
  team: readonly TeamRole[];
  /** null when the tenant has no Corrections tag. */
  tag: { name: string; memberIds: readonly string[]; includeProjectTeam: boolean } | null;
}

export interface Notice {
  body: string;
  mentions: string[];
  /** "DA Alex", "the Corrections tag" — RAISEd as a WARNING, never fatal. */
  missing: string[];
}

/**
 * MIRROR of bp_post_cr_notice.
 *
 * ★★★ fix-643b — ONE RULE: the notice reaches exactly who a person typing
 * @Corrections in that project's chat reaches (`resolveTagUserIds`, the mirror
 * of `bp_resolve_mention_tag`), and its body shows the single @Corrections
 * chip. With no Corrections tag it still reaches the project team.
 */
export function buildNotice(n: NoticeInput): Notice {
  const teamIds = n.team.filter((r) => r.userId).map((r) => r.userId!);
  const missing: string[] = [];
  let mentions: string[];
  if (!n.tag) {
    missing.push(`the ${CORRECTIONS_TAG} tag`);
    mentions = [...new Set(teamIds)];
  } else {
    mentions = resolveTagUserIds(n.tag.memberIds, n.tag.includeProjectTeam, teamIds);
  }
  for (const r of n.team) if (!r.userId) missing.push(`${r.role} ${r.name}`);
  const headline = crNoticeHeadline(n.permitNum, n.permitType, n.round, n.corrIssued);
  return {
    body: n.tag ? `${headline}\n@${n.tag.name.trim()}` : headline,
    mentions,
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
