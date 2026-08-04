import { describe, it, expect } from 'vitest';
import {
  buildEmlFile,
  buildVendorEmailHtml,
  buildVendorEmailSubject,
  encodeBase64Utf8,
  emlFilename,
  esc,
  formatAddressList,
  missingRecipientEmails,
  readVendorRecipients,
} from '../lib/vendorReportEmail';
import type {
  VendorCorrectionRow,
  VendorScheduleRow,
  VendorTransmitRow,
} from '../lib/vendorReport';

// fix-265: the email side. Two things matter here — the HTML must survive
// Outlook (tables + inline styles, never flexbox/grid/external CSS), and the
// .eml must open as an EDITABLE UNSENT DRAFT from Bobby's own account.

function row(over: Partial<VendorScheduleRow> & { projectId: string }): VendorScheduleRow {
  return {
    address: '100 A St',
    juris: 'Seattle',
    startWeek: '2026-08-10',
    targetSend: '2026-09-18',
    status: 'Scheduled',
    bucket: 'new',
    overdue: false,
    previous: null,
    reuseFromAddress: null,
    reuseNotes: null,
    holdReason: null,
    ...over,
  };
}

function correction(
  over: Partial<VendorCorrectionRow> & { taskId: string },
): VendorCorrectionRow {
  return {
    projectId: 'p1',
    address: '100 A St',
    juris: 'Seattle',
    permit: 'Building Permit',
    sent: '2026-07-27',
    expectedBack: '2026-08-14',
    firm: 'SSS',
    ...over,
  };
}

const EMPTY_SECTIONS = { newRows: [], changedRows: [], pipelineRows: [] };

function html(over: Partial<Parameters<typeof buildVendorEmailHtml>[0]> = {}) {
  return buildVendorEmailHtml({
    sections: EMPTY_SECTIONS,
    transmitted: [],
    corrections: [],
    vendorLabel: 'SSS Engineering',
    weekOf: '2026-08-03',
    ...over,
  });
}

function transmit(
  over: Partial<VendorTransmitRow> & { taskId: string },
): VendorTransmitRow {
  return {
    projectId: 'p1',
    address: '100 A St',
    juris: 'Seattle',
    sent: '2026-07-27',
    expectedBack: '2026-08-14',
    ...over,
  };
}

// fix-274: the email stacks three DIFFERENT table shapes, and each one used to
// auto-size its columns from its own content — so nothing lined up when read one
// after another. Every named column now has ONE width wherever it appears, and
// Address absorbs the remainder.
describe('fix-274 column widths line up across the three table shapes', () => {
  const FULL = html({
    sections: {
      newRows: [row({ projectId: 'p1' })],
      changedRows: [],
      pipelineRows: [row({ projectId: 'p2' })],
    },
    transmitted: [transmit({ taskId: 't1' })],
    corrections: [correction({ taskId: 'c1' })],
  });

  /** Header cells of the Nth <table>, as [label, widthPct] pairs. */
  function headerWidths(doc: string, tableIndex: number): [string, number][] {
    const head = doc.split('<table').slice(1)[tableIndex];
    const out: [string, number][] = [];
    const re = /<th style="([^"]*)">([^<]*)<\/th>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(head)) !== null) {
      const w = /width:(\d+(?:\.\d+)?)%/.exec(m[1]);
      out.push([m[2], w ? Number(w[1]) : NaN]);
    }
    return out;
  }

  // Section order is New, Upcoming, Transmitted, Corrections (Changes is empty
  // and therefore omitted), so the schedule shape is tables 0 and 1.
  const SCHEDULE = 0;
  const UPCOMING = 1;
  const TRANSMITTED = 2;
  const CORRECTIONS = 3;

  function widthOf(tableIndex: number, label: string): number {
    const found = headerWidths(FULL, tableIndex).find(([l]) => l === label);
    if (!found) throw new Error(`no "${label}" column in table ${tableIndex}`);
    return found[1];
  }

  it('renders exactly the three expected shapes', () => {
    expect(headerWidths(FULL, SCHEDULE).map(([l]) => l)).toEqual([
      'Start week', 'Address', 'Jurisdiction', 'Target send', 'Reuse',
    ]);
    expect(headerWidths(FULL, TRANSMITTED).map(([l]) => l)).toEqual([
      'Address', 'Jurisdiction', 'Sent', 'Expected back',
    ]);
    expect(headerWidths(FULL, CORRECTIONS).map(([l]) => l)).toEqual([
      'Address', 'Jurisdiction', 'Permit type', 'Sent', 'Expected back',
    ]);
  });

  it('EVERY header cell in EVERY table carries a width', () => {
    for (const i of [SCHEDULE, UPCOMING, TRANSMITTED, CORRECTIONS]) {
      for (const [label, w] of headerWidths(FULL, i)) {
        expect(Number.isFinite(w), `table ${i} "${label}" has no width`).toBe(true);
      }
    }
  });

  it('JURISDICTION is identical in all three shapes', () => {
    const a = widthOf(SCHEDULE, 'Jurisdiction');
    expect(widthOf(TRANSMITTED, 'Jurisdiction')).toBe(a);
    expect(widthOf(CORRECTIONS, 'Jurisdiction')).toBe(a);
  });

  it('EVERY DATE COLUMN is the same width, in every shape', () => {
    // Start week / Target send / Sent / Expected back read as one column type to
    // the eye — these are the ones that look broken when they drift.
    const d = widthOf(SCHEDULE, 'Start week');
    expect(widthOf(SCHEDULE, 'Target send')).toBe(d);
    expect(widthOf(TRANSMITTED, 'Sent')).toBe(d);
    expect(widthOf(TRANSMITTED, 'Expected back')).toBe(d);
    expect(widthOf(CORRECTIONS, 'Sent')).toBe(d);
    expect(widthOf(CORRECTIONS, 'Expected back')).toBe(d);
  });

  it('the two schedule tables (New and Upcoming) are identical', () => {
    expect(headerWidths(FULL, UPCOMING)).toEqual(headerWidths(FULL, SCHEDULE));
  });

  it('each table sums to exactly 100%', () => {
    for (const i of [SCHEDULE, UPCOMING, TRANSMITTED, CORRECTIONS]) {
      const total = headerWidths(FULL, i).reduce((s, [, w]) => s + w, 0);
      expect(total, `table ${i} widths sum`).toBe(100);
    }
  });

  it('ADDRESS is the column that flexes — deliberately', () => {
    // Different column counts mean something must absorb the remainder. Address
    // holds the longest, most variable content, so a difference there is far
    // less noticeable than dates failing to line up. If this test starts failing
    // because someone equalised Address, they have inverted the fix.
    const s = widthOf(SCHEDULE, 'Address');
    const t = widthOf(TRANSMITTED, 'Address');
    const c = widthOf(CORRECTIONS, 'Address');
    expect(new Set([s, t, c]).size).toBeGreaterThan(1);
    // Transmitted has the fewest columns, so its Address is the widest.
    expect(t).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(s);
  });

  it('uses table-layout:fixed — without it the widths are advisory', () => {
    expect(FULL).toContain('table-layout:fixed');
  });

  it('widths are PERCENTAGES, never pixels, so reading-pane width does not matter', () => {
    expect(FULL).toMatch(/width:\d+%/);
    expect(FULL).not.toMatch(/width:\d+px/);
  });

  it('no colgroup — Word supports it inconsistently', () => {
    expect(FULL).not.toContain('<colgroup');
    expect(FULL).not.toContain('<col ');
  });
});

describe('fix-265 email HTML — Outlook safety', () => {
  it('uses tables with inline styles and no layout CSS Outlook cannot render', () => {
    const out = html({
      sections: { newRows: [row({ projectId: 'p1' })], changedRows: [], pipelineRows: [row({ projectId: 'p1' })] },
      corrections: [correction({ taskId: 't1' })],
    });
    expect(out).toContain('<table');
    expect(out).toContain('border-collapse');
    // Word is the render engine — these silently collapse the layout.
    expect(out).not.toMatch(/display\s*:\s*flex/i);
    expect(out).not.toMatch(/display\s*:\s*grid/i);
    expect(out).not.toContain('<link');
    expect(out).not.toContain('<style');
    expect(out).not.toMatch(/class=/);
  });

  // fix-268: empty sections are OMITTED. Most weeks two or three of the five
  // are empty (TRANSMITTED until the DAs work a cycle), and a run of headings
  // over blank space reads as a broken email.
  it('emits the five sections in the agreed order when all are populated', () => {
    const out = html({
      sections: {
        newRows: [row({ projectId: 'p1' })],
        changedRows: [
          row({
            projectId: 'p2',
            previous: { startWeek: '2026-08-10', targetSend: null, status: 'Scheduled' },
          }),
        ],
        pipelineRows: [row({ projectId: 'p3' })],
      },
      transmitted: [transmit({ taskId: 't1' })],
      corrections: [correction({ taskId: 'c1' })],
    });
    const order = [
      'New to the schedule',
      'Schedule changes',
      'Upcoming pipeline',
      'Transmitted',
      'Corrections',
    ];
    let cursor = -1;
    for (const heading of order) {
      const at = out.indexOf(heading);
      expect(at, `${heading} present`).toBeGreaterThan(-1);
      expect(at, `${heading} in order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('omits an empty section entirely — no stray heading', () => {
    const out = html({
      sections: { newRows: [row({ projectId: 'p1' })], changedRows: [], pipelineRows: [] },
    });
    expect(out).toContain('New to the schedule');
    expect(out).not.toContain('Schedule changes');
    expect(out).not.toContain('Upcoming pipeline');
    expect(out).not.toContain('Transmitted');
    expect(out).not.toContain('Corrections');
  });

  it('says so once when every section is empty', () => {
    const out = html();
    expect(out).toContain('Nothing to report this week.');
    expect(out).not.toContain('New to the schedule');
    expect(out).not.toContain('Corrections');
  });

  it('renders TRANSMITTED with address / jurisdiction / sent / expected back', () => {
    const out = html({
      transmitted: [
        transmit({
          taskId: 't1',
          address: '554 N 75th St',
          juris: 'Seattle',
          sent: '2026-09-18',
          expectedBack: '2026-10-02',
        }),
      ],
    });
    expect(out).toContain('Transmitted');
    expect(out).toContain('554 N 75th St');
    expect(out).toContain('2026-09-18');
    expect(out).toContain('2026-10-02');
  });

  it('a transmitted row with no expected-back date still renders, blank', () => {
    const out = html({
      transmitted: [transmit({ taskId: 't1', expectedBack: null })],
    });
    expect(out).toContain('&mdash;');
  });

  it('renders BOTH old and new in the changes section', () => {
    const out = html({
      sections: {
        newRows: [],
        pipelineRows: [],
        changedRows: [
          row({
            projectId: 'p1',
            startWeek: '2026-08-24',
            previous: { startWeek: '2026-08-10', targetSend: '2026-09-18', status: 'Scheduled' },
          }),
        ],
      },
    });
    expect(out).toContain('2026-08-10'); // old
    expect(out).toContain('2026-08-24'); // new
    expect(out).toContain('line-through'); // struck-through old value
    expect(out).toContain('&rarr;');
  });

  it('shows a status move as its own labelled delta', () => {
    const out = html({
      sections: {
        newRows: [],
        pipelineRows: [],
        changedRows: [
          row({
            projectId: 'p1',
            status: 'Under Review',
            previous: { startWeek: '2026-08-10', targetSend: '2026-09-18', status: 'Scheduled' },
          }),
        ],
      },
    });
    expect(out).toContain('Status:');
    expect(out).toContain('Under Review');
  });

  it('renders a missing value as a visible blank, not an omitted cell', () => {
    const out = html({
      sections: {
        newRows: [row({ projectId: 'p1', targetSend: null, juris: null })],
        changedRows: [],
        pipelineRows: [],
      },
    });
    expect(out).toContain('&mdash;');
  });

  // fix-269: the overdue marker must survive Outlook. Word strips or mangles
  // colour, classes and backgrounds — a signal the vendor cannot see is worse
  // than none — so it is TEXT.
  it('the OVERDUE marker is text, with no class and no colour', () => {
    const out = html({
      sections: {
        newRows: [],
        changedRows: [],
        pipelineRows: [
          row({ projectId: 'p1', overdue: true, targetSend: '2026-03-27' }),
        ],
      },
    });
    expect(out).toContain('OVERDUE');
    expect(out).toContain('target send was 2026-03-27');
    expect(out).toContain('not yet sent');
    // No class hooks anywhere in the document, and no colour on the marker.
    expect(out).not.toMatch(/class=/);
    const marker = out.slice(out.indexOf('OVERDUE') - 120, out.indexOf('OVERDUE'));
    expect(marker).not.toMatch(/color\s*:/i);
    expect(marker).not.toMatch(/background/i);
    // <strong> is the only emphasis Word renders reliably.
    expect(out).toContain('<strong>[OVERDUE');
  });

  it('an on-time row carries no marker', () => {
    const out = html({
      sections: { newRows: [], changedRows: [], pipelineRows: [row({ projectId: 'p1' })] },
    });
    expect(out).not.toContain('OVERDUE');
  });

  it('the date column is labelled Target send, not DD end', () => {
    const out = html({
      sections: { newRows: [row({ projectId: 'p1' })], changedRows: [], pipelineRows: [] },
    });
    expect(out).toContain('Target send');
    expect(out).not.toContain('DD end');
  });

  it('labels a held project so the vendor knows it is parked', () => {
    const out = html({
      sections: {
        newRows: [row({ projectId: 'p1', holdReason: 'Waiting on survey' })],
        changedRows: [],
        pipelineRows: [],
      },
    });
    expect(out).toContain('ON HOLD');
    expect(out).toContain('Waiting on survey');
  });

  it('joins reuse address and notes in one cell', () => {
    const out = html({
      sections: {
        newRows: [
          row({ projectId: 'p1', reuseFromAddress: '13515 27th Ave NE', reuseNotes: 'W/O GAR' }),
        ],
        changedRows: [],
        pipelineRows: [],
      },
    });
    expect(out).toContain('13515 27th Ave NE');
    expect(out).toContain('W/O GAR');
  });

  it('escapes HTML in project data', () => {
    const out = html({
      sections: {
        newRows: [row({ projectId: 'p1', address: '<script>alert(1)</script>' })],
        changedRows: [],
        pipelineRows: [],
      },
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('esc covers the four dangerous characters', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    expect(esc(null)).toBe('');
  });
});

describe('fix-265 recipients', () => {
  const CONFIG = {
    structural: {
      label: 'SSS Engineering',
      to: [{ name: 'Tawny Glenn', email: 't.glenn@ssseng.com' }],
      cc: [
        { name: 'Brittani Ard', email: 'brittani@example.com' },
        { name: 'Shire Mahdi', email: '' },
      ],
    },
  };

  it('reads the configured list for a vendor', () => {
    const r = readVendorRecipients(CONFIG, 'structural');
    expect(r.label).toBe('SSS Engineering');
    expect(r.to).toHaveLength(1);
    expect(r.cc).toHaveLength(2);
  });

  it('degrades to empty for a missing vendor or malformed config', () => {
    expect(readVendorRecipients(CONFIG, 'civil').to).toEqual([]);
    expect(readVendorRecipients(null, 'structural').to).toEqual([]);
    expect(readVendorRecipients('nope', 'structural').to).toEqual([]);
    expect(readVendorRecipients({ structural: [] }, 'structural').to).toEqual([]);
  });

  it('reports people with no address rather than silently dropping them', () => {
    // A vendor-facing email that looks sent and never arrived is the worst
    // failure mode; the page surfaces this as a banner.
    expect(missingRecipientEmails(readVendorRecipients(CONFIG, 'structural'))).toEqual([
      'Shire Mahdi',
    ]);
  });

  it('formats an RFC 5322 address list and omits the address-less', () => {
    const r = readVendorRecipients(CONFIG, 'structural');
    expect(formatAddressList(r.to)).toBe('Tawny Glenn <t.glenn@ssseng.com>');
    expect(formatAddressList(r.cc)).toBe('Brittani Ard <brittani@example.com>');
  });
});

describe('fix-265 .eml draft', () => {
  const to = [{ name: 'Tawny Glenn', email: 't.glenn@ssseng.com' }];
  const cc = [{ name: 'Brittani Ard', email: 'brittani@example.com' }];

  function eml(body = '<p>hi</p>') {
    return buildEmlFile({ to, cc, subject: 'Test subject', html: body });
  }

  it('carries To / Cc / Subject', () => {
    const out = eml();
    expect(out).toContain('To: Tawny Glenn <t.glenn@ssseng.com>');
    expect(out).toContain('Cc: Brittani Ard <brittani@example.com>');
    expect(out).toContain('Subject: Test subject');
  });

  it('sets X-Unsent so Outlook opens an editable draft with a Send button', () => {
    expect(eml()).toContain('X-Unsent: 1');
  });

  it('omits From entirely so the mail comes from Bobby, not a noreply@ sender', () => {
    // The whole reason there is no automated sending: a noreply@ From would look
    // wrong to SSS and risk the spam folder. Outlook fills in the sending account.
    expect(eml()).not.toMatch(/^From:/m);
  });

  it('is a UTF-8 HTML part, base64-encoded, CRLF-delimited', () => {
    const out = eml();
    expect(out).toContain('MIME-Version: 1.0');
    expect(out).toContain('Content-Type: text/html; charset=utf-8');
    expect(out).toContain('Content-Transfer-Encoding: base64');
    expect(out).toContain('\r\n\r\n');
  });

  it('round-trips the body, em dashes and arrows included', () => {
    const body = '<p>DD end &mdash; moved &rarr; 2026-09-18 — ok</p>';
    const out = buildEmlFile({ to, cc, subject: 's', html: body });
    const b64 = out.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(body);
  });

  it('wraps the base64 body at 76 characters', () => {
    const out = buildEmlFile({ to, cc, subject: 's', html: '<p>' + 'x'.repeat(500) + '</p>' });
    const bodyLines = out.split('\r\n\r\n')[1].trim().split('\r\n');
    expect(bodyLines.length).toBeGreaterThan(1);
    for (const line of bodyLines) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('encodeBase64Utf8 matches btoa for ASCII and handles multi-byte', () => {
    expect(encodeBase64Utf8('hello')).toBe(btoa('hello'));
    expect(encodeBase64Utf8('ab')).toBe(btoa('ab')); // padding
    expect(encodeBase64Utf8('a')).toBe(btoa('a'));
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encodeBase64Utf8('— Ã¼nÃ¯code â†’')), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe('— Ã¼nÃ¯code â†’');
  });

  it('drops a Cc header entirely when nobody has an address', () => {
    const out = buildEmlFile({ to, cc: [{ name: 'Nobody', email: '' }], subject: 's', html: '<p/>' });
    expect(out).not.toMatch(/^Cc:/m);
  });
});

describe('fix-265 subject + filename', () => {
  it('subject is ASCII-only so the header needs no RFC 2047 encoding', () => {
    const s = buildVendorEmailSubject('SSS Engineering', '2026-08-03');
    expect(s).toBe('SSS Engineering schedule forecast - week of Aug 3, 2026');
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(s)).toBe(true);
  });

  it('survives an unset vendor label', () => {
    expect(buildVendorEmailSubject('', '2026-08-03')).toBe(
      'schedule forecast - week of Aug 3, 2026',
    );
  });

  it('filename carries the vendor and the week', () => {
    expect(emlFilename('structural', '2026-08-03')).toBe(
      'structural-schedule-forecast-2026-08-03.eml',
    );
  });
});

