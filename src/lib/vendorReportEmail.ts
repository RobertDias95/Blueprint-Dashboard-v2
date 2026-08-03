import type {
  VendorCorrectionRow,
  VendorScheduleRow,
  VendorSections,
  VendorTransmitRow,
} from './vendorReport';

// fix-265: the email side of the Vendor Schedule Forecast.
//
// Bobby sends this himself and wants it to come FROM him — a noreply@ sender
// would look wrong to SSS and risk the spam folder — so there is deliberately NO
// automated sending and NO third-party mail provider here. The primary action
// builds a .eml file that Outlook opens as a ready-to-send draft (To/Cc/Subject
// prefilled, full table formatting, his own signature and Sent Items). "Copy as
// HTML" is the fallback.
//
// OUTLOOK CONSTRAINTS drive every styling choice below: Word is the render
// engine, so it is tables with inline styles all the way down — no flexbox, no
// CSS grid, no external stylesheet, no <style> block worth trusting.
//
// NOTHING IN THIS FILE WRITES THE LEDGER. Composing is a pure function of the
// rows. Marking sent is a separate, explicit action (see useVendorReportState) —
// Bobby previews drafts he does not send, and a compose that silently marked
// things sent would make projects vanish from next week's email.

export interface VendorRecipient {
  name: string;
  email: string;
}

export interface VendorRecipients {
  label: string;
  to: VendorRecipient[];
  cc: VendorRecipient[];
}

const EMPTY_RECIPIENTS: VendorRecipients = { label: '', to: [], cc: [] };

/** Read the recipient list for a vendor out of the app_config blob. Shape:
 *  { "<vendor_key>": { label, to: [{name,email}], cc: [...] } }. Anything
 *  malformed degrades to empty rather than throwing — the page renders a
 *  "no recipients configured" warning and the Compose button stays disabled. */
export function readVendorRecipients(
  value: unknown,
  vendorKey: string,
): VendorRecipients {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_RECIPIENTS;
  }
  const entry = (value as Record<string, unknown>)[vendorKey];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return EMPTY_RECIPIENTS;
  }
  const e = entry as Record<string, unknown>;
  const people = (v: unknown): VendorRecipient[] => {
    if (!Array.isArray(v)) return [];
    const out: VendorRecipient[] = [];
    for (const raw of v) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      const email = typeof r.email === 'string' ? r.email.trim() : '';
      if (!name && !email) continue;
      out.push({ name, email });
    }
    return out;
  };
  return {
    label: typeof e.label === 'string' ? e.label : '',
    to: people(e.to),
    cc: people(e.cc),
  };
}

/** Configured people with no email address yet. The page surfaces these so a
 *  silently-undeliverable draft is impossible — the worst failure mode for a
 *  vendor-facing email is one that looks sent and never arrived. */
export function missingRecipientEmails(r: VendorRecipients): string[] {
  return [...r.to, ...r.cc]
    .filter((p) => p.email.trim() === '')
    .map((p) => p.name || '(unnamed)');
}

/** RFC 5322 address list: `Name <a@b.com>`, comma-joined. People without an
 *  address are dropped from the header (they are reported separately). */
export function formatAddressList(people: ReadonlyArray<VendorRecipient>): string {
  return people
    .filter((p) => p.email.trim() !== '')
    .map((p) => (p.name ? `${p.name} <${p.email}>` : p.email))
    .join(', ');
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** Escape for HTML text/attribute context. */
export function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A blank cell that READS as blank. The data behind this report is thin on
 *  purpose (dd_end is unset on most blocks, task dates are sparse) and the brief
 *  is explicit that we do not backfill or default it — the visible gap in an
 *  email going to an outside engineer is what prompts someone to fill it in. */
const BLANK = '<span style="color:#999;">&mdash;</span>';

function cell(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  return t === '' ? BLANK : esc(t);
}

const TD = 'padding:6px 10px;border:1px solid #ddd;font-size:13px;vertical-align:top;';
const TH =
  'padding:6px 10px;border:1px solid #ddd;font-size:12px;text-align:left;' +
  'background:#f4f4f4;font-weight:bold;';
const TABLE =
  'border-collapse:collapse;width:100%;margin:0 0 18px 0;' +
  'font-family:Segoe UI,Arial,sans-serif;';
const H2 = 'font-family:Segoe UI,Arial,sans-serif;font-size:15px;margin:22px 0 8px 0;';

/** OLD → NEW for one fact. Unchanged facts render as the plain value so the eye
 *  goes straight to what actually moved. */
function delta(oldV: string | null, newV: string | null): string {
  const a = (oldV ?? '').trim();
  const b = (newV ?? '').trim();
  if (a === b) return cell(b);
  return (
    `<span style="color:#b00020;text-decoration:line-through;">${
      a === '' ? '(blank)' : esc(a)
    }</span>` +
    ` &rarr; <strong>${b === '' ? '(blank)' : esc(b)}</strong>`
  );
}

function holdSuffix(row: VendorScheduleRow): string {
  if (!row.holdReason) return '';
  // Held projects are reported, not hidden (Bobby: "if they are on the list with
  // them, then yes") — labelled so the vendor knows it is parked rather than
  // wondering why it went quiet.
  return ` <span style="color:#8a6d00;font-size:12px;">[ON HOLD &mdash; ${esc(
    row.holdReason,
  )}]</span>`;
}

function reuseCell(row: VendorScheduleRow): string {
  const parts: string[] = [];
  if (row.reuseFromAddress) parts.push(esc(row.reuseFromAddress));
  if (row.reuseNotes) parts.push(esc(row.reuseNotes));
  return parts.length ? parts.join(' &middot; ') : BLANK;
}

function scheduleTable(
  rows: ReadonlyArray<VendorScheduleRow>,
  opts: { showDelta: boolean },
): string {
  const head =
    `<tr>` +
    `<th style="${TH}">Start week</th>` +
    `<th style="${TH}">Address</th>` +
    `<th style="${TH}">Jurisdiction</th>` +
    `<th style="${TH}">DD end</th>` +
    `<th style="${TH}">Reuse</th>` +
    `</tr>`;
  const body = rows
    .map((r) => {
      const prev = r.previous;
      const start =
        opts.showDelta && prev ? delta(prev.startWeek, r.startWeek) : cell(r.startWeek);
      const ddEnd =
        opts.showDelta && prev ? delta(prev.ddEnd, r.ddEnd) : cell(r.ddEnd);
      // Status only earns a column in the Changes section, where it moved.
      const statusNote =
        opts.showDelta && prev && (prev.status ?? '') !== (r.status ?? '')
          ? `<div style="font-size:12px;color:#555;margin-top:2px;">Status: ${delta(
              prev.status,
              r.status,
            )}</div>`
          : '';
      return (
        `<tr>` +
        `<td style="${TD}">${start}</td>` +
        `<td style="${TD}">${cell(r.address)}${holdSuffix(r)}${statusNote}</td>` +
        `<td style="${TD}">${cell(r.juris)}</td>` +
        `<td style="${TD}">${ddEnd}</td>` +
        `<td style="${TD}">${reuseCell(r)}</td>` +
        `</tr>`
      );
    })
    .join('');
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0" border="0">${head}${body}</table>`;
}

function correctionsTable(rows: ReadonlyArray<VendorCorrectionRow>): string {
  const head =
    `<tr>` +
    `<th style="${TH}">Address</th>` +
    `<th style="${TH}">Permit</th>` +
    `<th style="${TH}">What's needed</th>` +
    `<th style="${TH}">Sent</th>` +
    `<th style="${TH}">Expected back</th>` +
    `</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="${TD}">${cell(r.address)}</td>` +
        `<td style="${TD}">${cell(r.permit)}</td>` +
        `<td style="${TD}">${cell(r.need)}</td>` +
        `<td style="${TD}">${cell(r.sent)}</td>` +
        `<td style="${TD}">${cell(r.expectedBack)}</td>` +
        `</tr>`,
    )
    .join('');
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0" border="0">${head}${body}</table>`;
}

/** fix-268: TRANSMITTED — packages sent, awaiting return. Four columns; no
 *  permit column, because a transmit is a project-level design handoff rather
 *  than permit-scoped work. */
function transmittedTable(rows: ReadonlyArray<VendorTransmitRow>): string {
  const head =
    `<tr>` +
    `<th style="${TH}">Address</th>` +
    `<th style="${TH}">Jurisdiction</th>` +
    `<th style="${TH}">Sent</th>` +
    `<th style="${TH}">Expected back</th>` +
    `</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="${TD}">${cell(r.address)}</td>` +
        `<td style="${TD}">${cell(r.juris)}</td>` +
        `<td style="${TD}">${cell(r.sent)}</td>` +
        `<td style="${TD}">${cell(r.expectedBack)}</td>` +
        `</tr>`,
    )
    .join('');
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0" border="0">${head}${body}</table>`;
}

export interface VendorEmailInput {
  sections: VendorSections;
  /** fix-268: section 4 — sent, awaiting return. */
  transmitted: ReadonlyArray<VendorTransmitRow>;
  corrections: ReadonlyArray<VendorCorrectionRow>;
  /** Human label for the vendor, e.g. "SSS Engineering". */
  vendorLabel: string;
  /** Week-of date the email is anchored to (YYYY-MM-DD). */
  weekOf: string;
}

/** fix-268: the five sections, in the agreed order. Each carries its own rows so
 *  the empty ones can be dropped by a single rule rather than four call sites. */
export function vendorEmailSections(
  input: VendorEmailInput,
): { heading: string; html: string; count: number }[] {
  const { sections, transmitted, corrections } = input;
  return [
    {
      heading: 'New to the schedule',
      count: sections.newRows.length,
      html: scheduleTable(sections.newRows, { showDelta: false }),
    },
    {
      heading: 'Schedule changes',
      count: sections.changedRows.length,
      html: scheduleTable(sections.changedRows, { showDelta: true }),
    },
    {
      heading: 'Upcoming pipeline',
      count: sections.pipelineRows.length,
      html: scheduleTable(sections.pipelineRows, { showDelta: false }),
    },
    {
      heading: 'Transmitted — with you now',
      count: transmitted.length,
      html: transmittedTable(transmitted),
    },
    {
      heading: 'Corrections — permitting phase',
      count: corrections.length,
      html: correctionsTable(corrections),
    },
  ];
}

/** fix-265/268: the email body. Outlook-safe by construction — tables with
 *  inline styles only.
 *
 *  fix-268: an EMPTY SECTION IS OMITTED ENTIRELY, heading and all. Most weeks
 *  two or three of the five are empty (TRANSMITTED will be empty until the DAs
 *  work a cycle), and a run of headings over blank space makes the email look
 *  broken to the vendor. If every section is empty the body says so once. */
export function buildVendorEmailHtml(input: VendorEmailInput): string {
  const { vendorLabel, weekOf } = input;
  const intro =
    `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;margin:0 0 16px 0;">` +
    `Hi ${esc(vendorLabel || 'team')}, here is this week's schedule forecast ` +
    `(week of ${esc(formatWeekOf(weekOf))}).</p>`;

  const present = vendorEmailSections(input).filter((s) => s.count > 0);

  const body = present.length
    ? present
        .map((s) => `<h2 style="${H2}">${esc(s.heading)}</h2>${s.html}`)
        .join('')
    : `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#666;margin:0 0 18px 0;">` +
      `Nothing to report this week.</p>`;

  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#222;">${intro}${body}</div>`;
}

/** "Aug 3, 2026" from an ISO date, or the input back if unparseable. */
export function formatWeekOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Subject line. Deliberately ASCII-only so the .eml header needs no RFC 2047
 *  encoded-word — an em dash here renders as mojibake in some Outlook builds. */
export function buildVendorEmailSubject(vendorLabel: string, weekOf: string): string {
  const who = vendorLabel ? `${vendorLabel} ` : '';
  return `${who}schedule forecast - week of ${formatWeekOf(weekOf)}`;
}

// ---------------------------------------------------------------------------
// .eml
// ---------------------------------------------------------------------------

/** UTF-8 → base64, without depending on Node's Buffer or a DOM-only btoa. */
export function encodeBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : CHARS[b2 & 63];
  }
  return out;
}

/** Base64 bodies must be wrapped; 76 chars is the MIME convention. */
function wrap76(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  return lines.join('\r\n');
}

export interface EmlInput {
  to: ReadonlyArray<VendorRecipient>;
  cc: ReadonlyArray<VendorRecipient>;
  subject: string;
  html: string;
}

/** fix-265: an RFC 5322 message Outlook opens as an editable, unsent draft.
 *
 *  `X-Unsent: 1` is the header that makes Outlook open the file in the compose
 *  window with a Send button rather than as a received message — without it the
 *  user gets a read-only item they cannot send. There is deliberately no `From`:
 *  omitting it lets Outlook fill in the sending account, which is the whole
 *  point (the email must come from Bobby, not a noreply@ address).
 *
 *  The body is base64 so the em dashes and arrows survive every Outlook build;
 *  CRLF line endings throughout, as the RFC requires. */
export function buildEmlFile(input: EmlInput): string {
  const headers: string[] = [];
  const to = formatAddressList(input.to);
  const cc = formatAddressList(input.cc);
  if (to) headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${input.subject}`);
  headers.push('X-Unsent: 1');
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/html; charset=utf-8');
  headers.push('Content-Transfer-Encoding: base64');
  return (
    `${headers.join('\r\n')}\r\n\r\n${wrap76(encodeBase64Utf8(input.html))}\r\n`
  );
}

/** Filename for the downloaded draft. */
export function emlFilename(vendorKey: string, weekOf: string): string {
  return `${vendorKey}-schedule-forecast-${weekOf}.eml`;
}
