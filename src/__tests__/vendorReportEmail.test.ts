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
import type { VendorCorrectionRow, VendorScheduleRow } from '../lib/vendorReport';

// fix-265: the email side. Two things matter here — the HTML must survive
// Outlook (tables + inline styles, never flexbox/grid/external CSS), and the
// .eml must open as an EDITABLE UNSENT DRAFT from Bobby's own account.

function row(over: Partial<VendorScheduleRow> & { projectId: string }): VendorScheduleRow {
  return {
    address: '100 A St',
    juris: 'Seattle',
    startWeek: '2026-08-10',
    ddEnd: '2026-09-18',
    status: 'Scheduled',
    bucket: 'new',
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
    permit: 'Building Permit',
    need: 'Structural backgrounds',
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
    corrections: [],
    vendorLabel: 'SSS Engineering',
    weekOf: '2026-08-03',
    ...over,
  });
}

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

  it('emits all four sections in the agreed order, even when empty', () => {
    const out = html();
    const order = ['New to the schedule', 'Schedule changes', 'Upcoming pipeline', 'Corrections'];
    let cursor = -1;
    for (const heading of order) {
      const at = out.indexOf(heading);
      expect(at, `${heading} present`).toBeGreaterThan(-1);
      expect(at, `${heading} in order`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // An empty section says so rather than vanishing — the vendor can tell an
    // empty week from a broken email.
    expect(out).toContain('No new projects this week.');
    expect(out).toContain('No corrections are currently with you.');
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
            previous: { startWeek: '2026-08-10', ddEnd: '2026-09-18', status: 'Scheduled' },
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
            previous: { startWeek: '2026-08-10', ddEnd: '2026-09-18', status: 'Scheduled' },
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
        newRows: [row({ projectId: 'p1', ddEnd: null, juris: null })],
        changedRows: [],
        pipelineRows: [],
      },
    });
    expect(out).toContain('&mdash;');
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
      Uint8Array.from(atob(encodeBase64Utf8('— ünïcode →')), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe('— ünïcode →');
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
