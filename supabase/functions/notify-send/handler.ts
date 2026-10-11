import type { InlineImage, SendMailInput, SendMailResult } from '../_shared/graphMail.ts';
import { renderBrandedEmail } from '../_shared/emailTemplate.ts';

// ===========================================================================
// ★★★ fix-634 (P-323) — MENTION AND ASSIGNMENT EMAILS
// ===========================================================================
//
// ⚖️ Bobby, 2026-09-16: an email when you are @-mentioned or assigned a task —
//    immediate, on by default, opt-out per category, from bridge@ in the
//    fix-631 branded template, with the "not monitored" footer and no Reply-To.
//
// ★★★ THE DATABASE HAS ALREADY DECIDED WHO. `migrations/fix_634_…sql` resolves
//     recipients in the triggers (author excluded, opt-outs excluded, deduped by
//     email, roles never guessed) and queues rows. This handler only renders and
//     sends what `bp_notify_claim` hands it — plus the two checks that can change
//     in the seconds between queueing and sending (opt-out, a deleted message or
//     a finished task).
//
// ★★★ EVERY SEND WRITES ONE `email_outbox` ROW, success or failure, and every
//     queue row it covered is marked with that row's id. A failed send is
//     therefore visible in two places and silent in neither.
//
// ★★ DELIBERATELY FREE OF DENO AND OF A REAL `fetch` — the fix-436 split, so
//    `src/__tests__/MentionAssignmentEmailsFix634.test.ts` drives every branch.

/**
 * ★★ The app's public origin. A deliberate copy (functions cannot import
 *    `src/`), pinned to `OUTLOOK_DRAFT_APP.redirectUri` by a twin test.
 */
export const BRIDGE_APP_ORIGIN = 'https://blueprint-dashboard-v2.onrender.com';

/** ★ About 500 characters of the message, cut at a word, per the brief. */
export const MESSAGE_EXCERPT_CHARS = 500;

/** ★ fix-637: one due slot, as `bp_intake_warning_enqueue` froze it. */
export interface IntakeItem {
  slot_id: number;
  project_id: string | null;
  address: string;
  permit_num: string | null;
  permit_type: string | null;
  is_placeholder: boolean;
  intake_date: string;
  business_days_left: number;
  past_date: boolean;
}

/** ★ fix-637: the `notify:intake` payload. */
export interface IntakePayload {
  date: string;
  items: IntakeItem[];
}

/** One row of `bp_notify_claim`. */
export interface ClaimedRow {
  id: string;
  kind: 'notify:mention' | 'notify:assignment' | 'notify:intake';
  to_email: string;
  recipient_user_id: string;
  project_id: string | null;
  message_id: string | null;
  task_id: string | null;
  task_source: 'permit_tasks' | 'team_tasks' | null;
  opted_out: boolean;
  actor_name: string | null;
  project_address: string | null;
  post_title: string | null;
  message_body: string | null;
  message_deleted: boolean;
  task_text: string | null;
  task_done: boolean;
  task_due: string | null;
  /** ★ fix-637: set for `notify:intake` only. */
  payload?: IntakePayload | null;
}

export interface OutboxRow {
  kind: string;
  to_email: string;
  subject: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  graph_request_id: string | null;
  attempts: number;
}

export type QueueOutcome = 'sent' | 'failed' | 'skipped';

export interface Deps {
  sendMail: (input: SendMailInput) => Promise<SendMailResult>;
  /** Returns the new outbox row's id, or null when the insert itself failed. */
  recordOutbox: (row: OutboxRow) => Promise<string | null>;
  markQueue: (
    ids: string[],
    outcome: QueueOutcome,
    outboxId: string | null,
    note: string | null,
  ) => Promise<void>;
}

export interface DrainSummary {
  emails: number;
  sent: number;
  failed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cut at a word boundary near `max`, with an ellipsis when anything was cut. */
export function excerpt(text: string, max = MESSAGE_EXCERPT_CHARS): string {
  const t = (text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // ★ Only back up to a space if it does not throw away most of the excerpt.
  const base = lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** Escaped text with its line breaks kept. */
function paragraphHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br />');
}

export function messageUrl(projectId: string, messageId: string): string {
  return `${BRIDGE_APP_ORIGIN}/project/${encodeURIComponent(projectId)}?msg=${encodeURIComponent(messageId)}`;
}

export function taskUrl(taskId: string): string {
  return `${BRIDGE_APP_ORIGIN}/board?task=${encodeURIComponent(taskId)}`;
}

export const SETTINGS_URL = `${BRIDGE_APP_ORIGIN}/settings/account#email-notifications`;

/**
 * ★★★ `email_outbox` REFUSES A SUBJECT WITH A 6-DIGIT RUN (fix-628's guard
 *     against a stored reset code). An address can carry one — "123456 NE 8th"
 *     — so runs of 6+ are masked for the TABLE only; the inbox gets the real
 *     subject. `redactSubject` is NOT used: it masks from 4 digits and would
 *     turn every house number in the outbox into dots.
 */
export function outboxSubject(subject: string): string {
  return subject.replace(/\d{6,}/g, (m) => '•'.repeat(m.length));
}

const BLUE = '#5a6bb0';
const MUTED = '#666666';
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** ★ A table-cell button: the only kind Outlook draws with a background. */
function buttonHtml(href: string, label: string): string {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px 0">' +
    `<tr><td style="background:${BLUE};border-radius:6px">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;` +
    `font-family:${SANS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">` +
    `${escapeHtml(label)}</a></td></tr></table>`
  );
}

function whyHtml(category: 'mention' | 'assignment'): string {
  const what = category === 'mention' ? 'mentioned in the Bridge' : 'assigned a task in the Bridge';
  return (
    `<p style="font-size:12px;color:${MUTED};margin:16px 0 0 0">` +
    `You're getting this because you were ${what}. ` +
    `<a href="${escapeHtml(SETTINGS_URL)}" style="color:${BLUE}">Turn these emails off</a> ` +
    'in Settings → My account → Email notifications.</p>'
  );
}

function whyText(category: 'mention' | 'assignment'): string {
  const what = category === 'mention' ? 'mentioned in the Bridge' : 'assigned a task in the Bridge';
  return `You're getting this because you were ${what}. Turn these emails off in ` +
    `Settings → My account → Email notifications: ${SETTINGS_URL}`;
}

export interface RenderedNotification {
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
}

function who(row: ClaimedRow): string {
  return (row.actor_name ?? '').trim() || 'Someone';
}

function addressOf(row: ClaimedRow): string | null {
  const a = (row.project_address ?? '').trim();
  return a === '' ? null : a;
}

export function renderMention(row: ClaimedRow): RenderedNotification {
  const actor = who(row);
  const address = addressOf(row);
  const subject = address ? `${actor} mentioned you · ${address}` : `${actor} mentioned you`;
  const body = excerpt(row.message_body ?? '');
  const title = (row.post_title ?? '').trim();
  const url = row.project_id && row.message_id
    ? messageUrl(row.project_id, row.message_id)
    : `${BRIDGE_APP_ORIGIN}/`;

  const bodyHtml =
    `<p style="margin:0 0 12px 0"><strong>${escapeHtml(actor)}</strong> mentioned you` +
    (address ? ` in the chat for <strong>${escapeHtml(address)}</strong>` : '') +
    '.</p>' +
    (title ? `<p style="margin:0 0 8px 0;color:${MUTED}">Post: <strong style="color:#111111">${escapeHtml(title)}</strong></p>` : '') +
    (body
      ? `<div style="border-left:3px solid ${BLUE};padding:8px 12px;margin:0;background:#f7f8fb">` +
        `${paragraphHtml(body)}</div>`
      : '') +
    buttonHtml(url, 'Open in the Bridge') +
    whyHtml('mention');

  const bodyText =
    `${actor} mentioned you${address ? ` in the chat for ${address}` : ''}.\n` +
    (title ? `Post: ${title}\n` : '') +
    (body ? `\n${body}\n` : '') +
    `\nOpen in the Bridge: ${url}\n\n${whyText('mention')}`;

  const branded = renderBrandedEmail({ bodyHtml, bodyText });
  return { subject, html: branded.html, text: branded.text, inlineImages: branded.inlineImages };
}

/** ★★ One email for one task, or one email listing a burst of them. */
export function renderAssignment(rows: ClaimedRow[]): RenderedNotification {
  const first = rows[0]!;
  const actors = [...new Set(rows.map(who))];
  const actor = actors.length === 1 ? actors[0]! : 'Your team';
  const addresses = [...new Set(rows.map(addressOf).filter((a): a is string => a !== null))];
  const oneAddress = addresses.length === 1 ? addresses[0]! : null;

  const subject = rows.length === 1
    ? (addressOf(first) ? `New task for you · ${addressOf(first)}` : 'New task for you')
    : (oneAddress ? `${rows.length} new tasks for you · ${oneAddress}` : `${rows.length} new tasks for you`);

  const item = (r: ClaimedRow) => {
    const text = excerpt(r.task_text ?? '(untitled task)', 200);
    const addr = addressOf(r);
    return { text, addr, due: r.task_due, url: taskUrl(r.task_id ?? '') };
  };

  let bodyHtml: string;
  let bodyText: string;
  if (rows.length === 1) {
    const i = item(first);
    bodyHtml =
      `<p style="margin:0 0 12px 0"><strong>${escapeHtml(actor)}</strong> assigned you a task` +
      (i.addr ? ` on <strong>${escapeHtml(i.addr)}</strong>` : '') + ':</p>' +
      `<div style="border-left:3px solid ${BLUE};padding:8px 12px;margin:0;background:#f7f8fb">` +
      `${paragraphHtml(i.text)}` +
      (i.due ? `<div style="font-size:13px;color:${MUTED};padding-top:4px">Due ${escapeHtml(i.due)}</div>` : '') +
      '</div>' +
      buttonHtml(i.url, 'Open in the Bridge') +
      whyHtml('assignment');
    bodyText =
      `${actor} assigned you a task${i.addr ? ` on ${i.addr}` : ''}:\n\n${i.text}\n` +
      (i.due ? `Due ${i.due}\n` : '') +
      `\nOpen in the Bridge: ${i.url}\n\n${whyText('assignment')}`;
  } else {
    const items = rows.map(item);
    bodyHtml =
      `<p style="margin:0 0 12px 0"><strong>${escapeHtml(actor)}</strong> assigned you ` +
      `${rows.length} tasks:</p>` +
      '<ul style="padding-left:20px;margin:0">' +
      items.map((i) =>
        '<li style="margin:0 0 8px 0">' +
        `<a href="${escapeHtml(i.url)}" style="color:${BLUE}">${escapeHtml(i.text)}</a>` +
        (i.addr ? ` <span style="color:${MUTED}">· ${escapeHtml(i.addr)}</span>` : '') +
        (i.due ? ` <span style="color:${MUTED}">· due ${escapeHtml(i.due)}</span>` : '') +
        '</li>').join('') +
      '</ul>' +
      buttonHtml(`${BRIDGE_APP_ORIGIN}/board`, 'Open in the Bridge') +
      whyHtml('assignment');
    bodyText =
      `${actor} assigned you ${rows.length} tasks:\n\n` +
      items.map((i) =>
        `- ${i.text}${i.addr ? ` · ${i.addr}` : ''}${i.due ? ` · due ${i.due}` : ''}\n  ${i.url}`,
      ).join('\n') +
      `\n\nOpen in the Bridge: ${BRIDGE_APP_ORIGIN}/board\n\n${whyText('assignment')}`;
  }

  const branded = renderBrandedEmail({ bodyHtml, bodyText });
  return { subject, html: branded.html, text: branded.text, inlineImages: branded.inlineImages };
}

// ---------------------------------------------------------------------------
// ★★★ fix-637 (P-180) — the daily Seattle intake warning
// ---------------------------------------------------------------------------
// ⚖️ Bobby, 10-11: "an email notication daily until resolved", 7 business days
// out, to the people Settings names (Miles and Brianna). The list was decided
// by `bp_intake_warning_due` — the same function the pop-up reads — and frozen
// into the payload at 7 AM. ★ A work alert: the mention/assignment switches do
// not cover it, so its footer says how it is actually stopped.

/** ★ A deliberate copy of `INTAKE_TRACKER_PATH` (functions cannot import src/). */
export const INTAKE_TRACKER_URL = `${BRIDGE_APP_ORIGIN}/draw-schedule?tab=intake`;

export function projectUrl(projectId: string): string {
  return `${BRIDGE_APP_ORIGIN}/project/${encodeURIComponent(projectId)}`;
}

/** M/D/YYYY. */
export function usDate(iso: string): string {
  const [y, m, d] = (iso ?? '').slice(0, 10).split('-').map(Number);
  return y && m && d ? `${m}/${d}/${y}` : iso;
}

/** ★ Mirrors `slotPermitLabel` in src/lib/intakeWarning.ts. */
export function intakePermitLabel(i: IntakeItem): string {
  if (i.is_placeholder) return 'Placeholder';
  const num = (i.permit_num ?? '').trim();
  const type = (i.permit_type ?? '').trim();
  if (num && type) return `${num} · ${type}`;
  return num || type || 'No permit linked';
}

/** ★ Mirrors `dueLabel` in src/lib/intakeWarning.ts. */
export function intakeDueLabel(i: IntakeItem): string {
  if (i.past_date) return 'Past date';
  const n = i.business_days_left;
  if (n <= 0) return 'Today';
  return `${n} business day${n === 1 ? '' : 's'} left`;
}

export function intakeSubject(count: number): string {
  return `Seattle intakes to reschedule · ${count} due`;
}

const INTAKE_WHY_TEXT =
  "You're getting this because you're on the Seattle intake warning list " +
  '(Settings → Teams → Seattle intake warning goes to). It comes each business ' +
  'day while anything is due, and is not affected by the mention/assignment email switches.';

export function renderIntake(row: ClaimedRow): RenderedNotification {
  const items = row.payload?.items ?? [];
  const subject = intakeSubject(items.length);
  const RED = '#b42318';
  const AMBER = '#b54708';
  const cell = 'padding:6px 10px 6px 0;border-top:1px solid #e5e7eb;vertical-align:top';

  const rowsHtml = items.map((i) => {
    const address = i.project_id
      ? `<a href="${escapeHtml(projectUrl(i.project_id))}" style="color:${BLUE}">${escapeHtml(i.address)}</a>`
      : escapeHtml(i.address);
    return '<tr>' +
      `<td style="${cell};font-weight:600">${address}</td>` +
      `<td style="${cell}">${escapeHtml(intakePermitLabel(i))}</td>` +
      `<td style="${cell};white-space:nowrap">${escapeHtml(usDate(i.intake_date))}</td>` +
      `<td style="${cell};white-space:nowrap;font-weight:600;color:${i.past_date ? RED : AMBER}">` +
      `${escapeHtml(intakeDueLabel(i))}</td>` +
      '</tr>';
  }).join('');

  const head = (t: string) =>
    `<th align="left" style="padding:0 10px 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${t}</th>`;

  const bodyHtml =
    `<p style="margin:0 0 12px 0">These Seattle intake slots are within <strong>7 business days</strong> ` +
    '(weekends skipped), or past their date and still open. Reschedule, swap or release ' +
    'each one in the Intake Tracker.</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
    `style="border-collapse:collapse;font-family:${SANS};font-size:14px;width:100%">` +
    `<tr>${head('Address')}${head('Permit')}${head('Intake')}${head('Left')}</tr>` +
    rowsHtml +
    '</table>' +
    buttonHtml(INTAKE_TRACKER_URL, 'Open in the Bridge') +
    `<p style="font-size:12px;color:${MUTED};margin:16px 0 0 0">${escapeHtml(INTAKE_WHY_TEXT)}</p>`;

  const bodyText =
    'These Seattle intake slots are within 7 business days (weekends skipped), or past ' +
    'their date and still open. Reschedule, swap or release each one in the Intake Tracker.\n\n' +
    items.map((i) =>
      `- ${i.address} · ${intakePermitLabel(i)} · intake ${usDate(i.intake_date)} · ${intakeDueLabel(i)}`,
    ).join('\n') +
    `\n\nOpen in the Bridge: ${INTAKE_TRACKER_URL}\n\n${INTAKE_WHY_TEXT}`;

  const branded = renderBrandedEmail({ bodyHtml, bodyText });
  return { subject, html: branded.html, text: branded.text, inlineImages: branded.inlineImages };
}

// ---------------------------------------------------------------------------
// The drain
// ---------------------------------------------------------------------------

/** Why a claimed row is not sent, or null when it should be. */
export function skipReason(row: ClaimedRow): string | null {
  if (row.opted_out) return 'recipient opted out';
  if (row.kind === 'notify:mention' && row.message_deleted) return 'message deleted before send';
  if (row.kind === 'notify:assignment' && row.task_done) return 'task done before send';
  if (row.kind === 'notify:intake' && (row.payload?.items?.length ?? 0) === 0) return 'nothing due';
  if ((row.to_email ?? '').trim() === '') return 'no recipient address';
  return null;
}

/**
 * ★★ Mentions and intake warnings: one email each. Assignments: one email PER RECIPIENT per drain,
 *    so a bulk reassignment arrives as one list rather than a pile.
 */
export function planEmails(rows: ClaimedRow[]): ClaimedRow[][] {
  const out: ClaimedRow[][] = [];
  const byRecipient = new Map<string, ClaimedRow[]>();
  for (const r of rows) {
    // ★ fix-637: an intake warning is already one email per person per day.
    if (r.kind === 'notify:mention' || r.kind === 'notify:intake') {
      out.push([r]);
    } else {
      const k = r.to_email.trim().toLowerCase();
      const g = byRecipient.get(k);
      if (g) g.push(r);
      else {
        const fresh = [r];
        byRecipient.set(k, fresh);
        out.push(fresh);
      }
    }
  }
  return out;
}

export async function drain(deps: Deps, rows: ClaimedRow[]): Promise<DrainSummary> {
  const summary: DrainSummary = { emails: 0, sent: 0, failed: 0, skipped: 0 };

  const live: ClaimedRow[] = [];
  for (const r of rows) {
    const why = skipReason(r);
    if (why) {
      await deps.markQueue([r.id], 'skipped', null, why);
      summary.skipped += 1;
    } else {
      live.push(r);
    }
  }

  for (const group of planEmails(live)) {
    const first = group[0]!;
    const ids = group.map((r) => r.id);
    let rendered: RenderedNotification;
    try {
      rendered =
        first.kind === 'notify:mention' ? renderMention(first)
        : first.kind === 'notify:intake' ? renderIntake(first)
        : renderAssignment(group);
    } catch (e) {
      // ★ A render bug still leaves a failed row, never nothing.
      const error = `Could not render the email: ${(e as Error).message}`;
      const outboxId = await deps.recordOutbox({
        kind: first.kind, to_email: first.to_email, subject: null, status: 'failed',
        error, graph_request_id: null, attempts: 1,
      });
      await deps.markQueue(ids, 'failed', outboxId, error);
      summary.emails += 1;
      summary.failed += 1;
      continue;
    }

    // ★★ No Reply-To and no CC (Bobby's 09-11 ruling for alerts).
    const result = await deps.sendMail({
      to: first.to_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      inlineImages: rendered.inlineImages,
    });

    const outboxId = await deps.recordOutbox({
      kind: first.kind,
      to_email: first.to_email,
      subject: outboxSubject(rendered.subject),
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
      graph_request_id: result.requestId,
      attempts: 1,
    });
    await deps.markQueue(ids, result.ok ? 'sent' : 'failed', outboxId, result.ok ? null : result.error);
    summary.emails += 1;
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
