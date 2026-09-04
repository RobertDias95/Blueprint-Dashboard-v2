import type {
  VendorCorrectionRow,
  VendorScheduleRow,
  VendorSections,
  VendorTransmitRow,
} from './vendorReport';
// ★★ fix-367 §2: the SAME two formatters the on-screen report calls. Imported
// as values, not types — one definition of how units and product types read,
// so the report and the message SSS receives cannot drift apart.
import { formatProductTypes, formatUnits } from './vendorReport';

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

// ===========================================================================
// ★★★ fix-499 §B — WHERE THE RECIPIENTS COME FROM, AND SAYING SO
// ===========================================================================
//
// Settings → Reporting holds a `vendorReportRecipients` blob keyed by vendor.
// It has exactly ONE key today (`structural`), because until this ticket there
// was one report. Six more disciplines now have one, and none of them has a
// Settings entry — so a Civil forecast would have opened with "No recipients
// are configured", which is true and useless when the directory has held that
// firm's contact address all along.
//
// ★★ SO THE DIRECTORY IS THE DEFAULT, NOT A REPLACEMENT. Settings wins whenever
//    it names anybody: it is the deliberate list, with a Cc and a label. The
//    directory fills the gap, and the page SAYS WHICH ONE IT USED — a draft
//    addressed from a source the sender did not choose is how the wrong person
//    gets a schedule.
//
// ★ Inactive firms are skipped here, and only here. `firm_active` is a flag not
//   a delete (fix-474), so an inactive firm still NAMES the work it did — but
//   it should not receive new mail by default.

export type RecipientSource = 'settings' | 'directory' | 'none';

export interface ResolvedRecipients extends VendorRecipients {
  /** Which of the two lists this came from, for the line the page shows. */
  source: RecipientSource;
}

/** A directory firm, structurally typed so this module needs no import from the
 *  database types it does not otherwise use. */
export interface DirectoryFirmLike {
  discipline: string;
  name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  active?: boolean | null;
}

/** Settings first, the directory second, nothing third. */
export function resolveForecastRecipients(
  configValue: unknown,
  vendorKey: string,
  discipline: string,
  firms: ReadonlyArray<DirectoryFirmLike> | undefined,
): ResolvedRecipients {
  const configured = readVendorRecipients(configValue, vendorKey);
  if (configured.to.length > 0 || configured.cc.length > 0) {
    return { ...configured, source: 'settings' };
  }
  const to: VendorRecipient[] = [];
  const names: string[] = [];
  for (const f of firms ?? []) {
    if ((f.discipline ?? '').trim() !== discipline) continue;
    if (f.active === false) continue;
    const email = (f.contact_email ?? '').trim();
    if (email === '') continue;
    to.push({ name: (f.contact_name ?? '').trim(), email });
    names.push((f.name ?? '').trim());
  }
  if (to.length === 0) return { ...EMPTY_RECIPIENTS, source: 'none' };
  return {
    // The label is what the email greets and what the heading shows. One firm
    // names itself; several are joined, because a discipline with two firms on
    // the directory is a real state and picking one silently would be worse.
    label: names.filter((n) => n !== '').join(', '),
    to,
    cc: [],
    source: 'directory',
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
// fix-274: table-layout:fixed is what makes the widths below MEAN anything.
// Without it both browsers and Word silently re-auto-size a column the moment
// its content is wider than the declared width, which is exactly how three
// stacked tables end up ragged.
const TABLE =
  'border-collapse:collapse;width:100%;margin:0 0 18px 0;table-layout:fixed;' +
  'font-family:Segoe UI,Arial,sans-serif;';
const H2 = 'font-family:Segoe UI,Arial,sans-serif;font-size:15px;margin:22px 0 8px 0;';

// ---------------------------------------------------------------------------
// fix-274: column widths, shared across the three table shapes
// ---------------------------------------------------------------------------
//
// ★★★ fix-499 §C — THE ROW IS FIVE COLUMNS AND NOTHING ELSE. Bobby:
// *"There's not going to be any notes. It's like, here's your dates, here's
// your address, here's your unit, here's your unit type."*
//
//   schedule     Address · Units · Type · Target send · Expected back        (5)
//   transmitted  Address · Units · Type · Sent        · Expected back        (5)
//   corrections  Address · Jurisdiction · Permit type · Sent · Expected back (5)
//
// ★★ WHAT WENT, AND WHERE IT WENT INSTEAD. Start week and Jurisdiction are no
// longer columns. Start week still drives change detection and the ledger, so a
// start-week move is not lost — it renders as a sub-line under the address in
// the Changes section, exactly the way a status move already did. Losing the
// SIGNAL was never on the table; losing the column was the instruction.
//
// The three shapes finally line up, because the first three columns are now
// literally the same three in two of them.
//
// Each <table> auto-sized its own columns from its own content, so nothing lined
// up when read one after another. Every NAMED column now has ONE width used
// everywhere it appears: Jurisdiction is always 13%, every date column is always
// 15%, Permit type 14%, Reuse 18%.
//
// ★ ADDRESS ABSORBS THE REMAINDER, AND THAT IS DELIBERATE. The three shapes have
// different column counts, so something has to flex. Address is the right thing
// to flex: it holds the longest and most variable content, and a slightly
// different Address width between sections is far less noticeable than date
// columns that fail to line up. DO NOT "fix" this later by equalising Address
// and letting the dates float — that inverts the whole point of the change.
//
// Percentages, not pixels, so it survives whatever width the reading pane is.
const W_DATE = 15;
const W_JURIS = 13;
const W_PERMIT_TYPE = 14;
// ★★ fix-367 §2: the two scope columns. Units is a small integer and needs
// almost nothing; Type holds at most three short tokens ("SFR, ADU, DADU" is
// the widest real row on prod, of 44 multi-type projects).
const W_UNITS = 6;
const W_PRODUCT_TYPES = 12;
// Address = 100 - (everything else in that shape).
//
// ★ ADDRESS ABSORBS THE TWO NEW COLUMNS, which is what "Address absorbs the
// remainder" means when the shape grows: 39% → 21%. The alternative — shaving
// the date columns — would break the one invariant fix-274 exists to hold,
// that every date column is 15% everywhere it appears so the three tables line
// up when read one after another.
const W_ADDRESS_SCHEDULE =
  100 - W_UNITS - W_PRODUCT_TYPES - W_DATE - W_DATE; // 52
const W_ADDRESS_TRANSMITTED = W_ADDRESS_SCHEDULE; // same five columns
const W_ADDRESS_CORRECTIONS = 100 - W_JURIS - W_PERMIT_TYPE - W_DATE - W_DATE; // 43

/** fix-274: a header cell with its width INLINE.
 *
 *  Deliberately not <colgroup>: Word's rendering engine supports it
 *  inconsistently, and it is the classic way column widths silently do nothing
 *  in Outlook specifically while looking perfect in every browser you test. */
function th(label: string, widthPct: number): string {
  return `<th style="${TH}width:${widthPct}%;">${label}</th>`;
}

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

/** fix-269: the overdue marker. TEXT, deliberately — no colour, no class, no
 *  background. Outlook strips or mangles most of that, and a signal the vendor
 *  cannot see is worse than none. Bold is the only emphasis Word renders
 *  reliably, and the words carry the meaning on their own. */
function overdueMarker(row: VendorScheduleRow): string {
  if (!row.overdue) return '';
  return (
    ` <strong>[OVERDUE &mdash; target send was ${esc(row.targetSend ?? '')}` +
    `, not yet sent]</strong>`
  );
}

function scheduleTable(
  rows: ReadonlyArray<VendorScheduleRow>,
  opts: { showDelta: boolean },
): string {
  const head =
    `<tr>` +
    th('Address', W_ADDRESS_SCHEDULE) +
    // ★★★ fix-367 §2: THE SAME TWO COLUMNS THE SCREEN HAS, from the same two
    // formatters. A column that exists on screen and not here is worse than
    // neither — it makes the report and the message disagree about what was
    // sent, and fix-269's ledger already treats the email as what the
    // consultant knows.
    th('Units', W_UNITS) +
    th('Type', W_PRODUCT_TYPES) +
    // fix-269: dd_end is a TARGET SEND date — "when we are targeting to provide
    // documents to the external consultant" — so the column says so. It is a
    // commitment we are making, not a date we observed.
    th('Target send', W_DATE) +
    // ★ fix-499: the round's est_recd. Blank on nearly every row today, and it
    //   stays blank rather than being derived from a lead time.
    th('Expected back', W_DATE) +
    `</tr>`;
  const body = rows
    .map((r) => {
      const prev = r.previous;
      const ddEnd =
        opts.showDelta && prev
          ? delta(prev.targetSend, r.targetSend)
          : cell(r.targetSend);
      // ★★ fix-499: start week and status are no longer COLUMNS, so their
      //    deltas render as sub-lines under the address. The Changes section
      //    exists to show what moved; dropping a column must not drop a move.
      const moved: string[] = [];
      if (opts.showDelta && prev && (prev.startWeek ?? '') !== (r.startWeek ?? '')) {
        moved.push(`Start week: ${delta(prev.startWeek, r.startWeek)}`);
      }
      if (opts.showDelta && prev && (prev.status ?? '') !== (r.status ?? '')) {
        moved.push(`Status: ${delta(prev.status, r.status)}`);
      }
      const movedNote = moved.length
        ? `<div style="font-size:12px;color:#555;margin-top:2px;">${moved.join(
            ' &middot; ',
          )}</div>`
        : '';
      return (
        `<tr>` +
        `<td style="${TD}">${cell(r.address)}${overdueMarker(r)}${holdSuffix(r)}${movedNote}</td>` +
        // ★ `cell()` renders the same BLANK every absent value uses —
        // fix-269's rule, not a second convention.
        `<td style="${TD}">${cell(formatUnits(r.units))}</td>` +
        `<td style="${TD}">${cell(formatProductTypes(r.productTypes))}</td>` +
        `<td style="${TD}">${ddEnd}</td>` +
        `<td style="${TD}">${cell(r.expectedBack)}</td>` +
        `</tr>`
      );
    })
    .join('');
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0" border="0">${head}${body}</table>`;
}

/** fix-271: Address · Jurisdiction · Permit type · Sent · Expected back.
 *
 *  The old "What's needed" column carried the raw task text — the very string
 *  fix-271 stopped trusting to classify anything, and noise to a vendor who has
 *  no idea what our internal task names mean. Permit type replaces it: already
 *  to hand on a permit-scoped row, and it distinguishes a PPR or a Demolition
 *  from the Building Permit most rows will be. */
function correctionsTable(rows: ReadonlyArray<VendorCorrectionRow>): string {
  const head =
    `<tr>` +
    th('Address', W_ADDRESS_CORRECTIONS) +
    th('Jurisdiction', W_JURIS) +
    th('Permit type', W_PERMIT_TYPE) +
    th('Sent', W_DATE) +
    th('Expected back', W_DATE) +
    `</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="${TD}">${cell(r.address)}</td>` +
        `<td style="${TD}">${cell(r.juris)}</td>` +
        `<td style="${TD}">${cell(r.permit)}</td>` +
        `<td style="${TD}">${cell(r.sent)}</td>` +
        `<td style="${TD}">${cell(r.expectedBack)}</td>` +
        `</tr>`,
    )
    .join('');
  return `<table style="${TABLE}" cellpadding="0" cellspacing="0" border="0">${head}${body}</table>`;
}

/** TRANSMITTED — packages sent, awaiting return. No permit column, because a
 *  transmit is a project-level design handoff rather than permit-scoped work.
 *
 *  ★ fix-499 §C: the same five columns the schedule shape has, with `Sent` in
 *  place of `Target send` — the date that matters once it has gone out. */
function transmittedTable(rows: ReadonlyArray<VendorTransmitRow>): string {
  const head =
    `<tr>` +
    th('Address', W_ADDRESS_TRANSMITTED) +
    th('Units', W_UNITS) +
    th('Type', W_PRODUCT_TYPES) +
    th('Sent', W_DATE) +
    th('Expected back', W_DATE) +
    `</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="${TD}">${cell(r.address)}</td>` +
        `<td style="${TD}">${cell(formatUnits(r.units))}</td>` +
        `<td style="${TD}">${cell(formatProductTypes(r.productTypes))}</td>` +
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
 *  encoded-word — an em dash here renders as mojibake in some Outlook builds.
 *
 *  ★★ fix-499: the DISCIPLINE is in the subject. Seven of these reports now
 *  exist and a Civil firm and a Surveyor would otherwise receive two messages
 *  whose subject lines are indistinguishable in a mailbox. Optional so the
 *  pre-fix-499 two-argument call still reads the same. */
export function buildVendorEmailSubject(
  vendorLabel: string,
  weekOf: string,
  discipline?: string,
): string {
  const who = vendorLabel ? `${vendorLabel} ` : '';
  const what = (discipline ?? '').trim();
  return `${who}${what ? `${what} ` : ''}schedule forecast - week of ${formatWeekOf(
    weekOf,
  )}`;
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
