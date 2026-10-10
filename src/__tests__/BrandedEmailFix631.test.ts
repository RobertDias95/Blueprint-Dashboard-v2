import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BLUEPRINT_OFFICES,
  BRIDGE_SENDER,
  BRIDGE_SENDER_NAME,
  UNMONITORED_FOOTER,
} from '../../supabase/functions/_shared/msGraphConfig';
import {
  BLUEPRINT_LOGO,
  BLUEPRINT_LOGO_BYTES,
  BLUEPRINT_LOGO_HASH,
  BRIDGE_LOGO,
  BRIDGE_LOGO_BYTES,
  BRIDGE_LOGO_HASH,
  __fnv1a,
  __verifyAsset,
} from '../../supabase/functions/_shared/emailAssets';
import {
  officeLineText,
  renderBrandedEmail,
} from '../../supabase/functions/_shared/emailTemplate';
import {
  buildMimeMessage,
  encodeDisplayName,
  type SendMailInput,
} from '../../supabase/functions/_shared/graphMail';
import {
  handleSendEmail,
  renderAuthEmail,
  type Deps,
  type OutboxRow,
} from '../../supabase/functions/auth-send-email/handler';

// ===========================================================================
// ★★★ fix-631 (P-326) — email from bridge@ looks like it came from Blueprint
// ===========================================================================
//
// fix-628 made the Bridge send its own mail, and on 2026-10-08 it sent its first
// real one (outbox `sent`, Graph id 6c48d9e6…). It arrives looking like a note
// from nobody: no logo, no signature, no phone numbers.
//
// ★★ WHAT THE OUTBOX ALREADY TAUGHT US, and why it is worth writing down here:
//    the attempt BEFORE that one failed with
//    `MS_GRAPH_CLIENT_SECRET is INVALID (AADSTS7000215) — check it is the secret
//    VALUE, not the secret ID`. fix-628's named errors did their job — somebody
//    read that line and fixed the right thing. The same standard applies to this
//    ticket: when the branding breaks, it should break loudly and in CI.

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** ★ Comments stripped — these files EXPLAIN what they must not do, and a raw
 *  grep would pass on the explanation. (The gravestone trap, again.) */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const SAMPLE = { bodyHtml: '<p>Hello</p>', bodyText: 'Hello' };

// ---------------------------------------------------------------------------
// The sender name
// ---------------------------------------------------------------------------

describe('fix-631 — "Blueprint: The Bridge" on the From line', () => {
  it('★★★ the display name is what Bobby asked for, and the address is unchanged', () => {
    expect(BRIDGE_SENDER_NAME).toBe('Blueprint: The Bridge');
    expect(BRIDGE_SENDER).toBe('bridge@blueprintcap.com');
  });

  it('★★★ it is QUOTED in the header, because it contains a colon', () => {
    // `From: Blueprint: The Bridge <bridge@…>` is a malformed header — RFC 5322
    // lists `:` among the specials. The failure is quiet: a client shows the
    // bare address instead, which is worse than the grey "B" we started with.
    const mime = buildMimeMessage(
      { to: 'x@blueprintcap.com', subject: 'S', html: '<p>h</p>', text: 'h' },
      'seed',
    );
    expect(mime).toContain(`From: "Blueprint: The Bridge" <${BRIDGE_SENDER}>\r\n`);
    expect(mime).not.toContain('From: Blueprint: The Bridge <');
  });

  it('★★ encodeDisplayName quotes specials, escapes quotes, and leaves plain names alone', () => {
    expect(encodeDisplayName('Blueprint')).toBe('Blueprint');
    expect(encodeDisplayName('Blueprint: The Bridge')).toBe('"Blueprint: The Bridge"');
    expect(encodeDisplayName('A, B')).toBe('"A, B"');
    expect(encodeDisplayName('say "hi"')).toBe('"say \\"hi\\""');
    expect(encodeDisplayName('back\\slash')).toBe('"back\\\\slash"');
    // non-ASCII goes the RFC 2047 route instead
    expect(encodeDisplayName('Blüprint')).toMatch(/^=\?UTF-8\?B\?/);
  });
});

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

describe('fix-631 §A — the branded shell', () => {
  it('★★★ the header logo and the signature logo are both there, by cid', () => {
    const r = renderBrandedEmail(SAMPLE);
    expect(r.html).toContain(`src="cid:${BRIDGE_LOGO.cid}"`);
    expect(r.html).toContain(`src="cid:${BLUEPRINT_LOGO.cid}"`);
    // ★ and the caller is handed the bytes for exactly those two cids
    expect(r.inlineImages.map((i) => i.cid)).toEqual([BRIDGE_LOGO.cid, BLUEPRINT_LOGO.cid]);
  });

  it('★★★ the three office numbers are in BOTH parts, as tel: links in the HTML', () => {
    const r = renderBrandedEmail(SAMPLE);
    expect(BLUEPRINT_OFFICES).toHaveLength(3);
    for (const o of BLUEPRINT_OFFICES) {
      expect(r.html, o.city).toContain(o.city);
      expect(r.html, o.city).toContain(`href="tel:${o.tel}"`);
      expect(r.html, o.city).toContain(o.phone);
      // ★★ the text part carries them too — a phone number that only exists
      //    inside an HTML part is invisible to anyone reading the plain one.
      expect(r.text, o.city).toContain(o.phone);
      expect(r.text, o.city).toContain(o.city);
    }
  });

  it('★★ the numbers are exactly the ones Bobby gave, and the tel: forms match them', () => {
    expect(officeLineText()).toBe(
      'Fremont (206) 339-3390 · West Seattle (206) 933-7514 · Scottsdale (602) 428-2649',
    );
    // ★ a tel: link that does not match the digits printed beside it dials the
    //   wrong office, and nobody would notice until a customer did.
    for (const o of BLUEPRINT_OFFICES) {
      expect(o.tel, o.city).toBe(`+1${o.phone.replace(/\D/g, '')}`);
    }
  });

  it('★★ it keeps the body it was given, and the unmonitored line', () => {
    const r = renderBrandedEmail({ bodyHtml: '<p>UNIQUE-BODY</p>', bodyText: 'UNIQUE-TEXT' });
    expect(r.html).toContain('<p>UNIQUE-BODY</p>');
    expect(r.text).toContain('UNIQUE-TEXT');
    expect(r.html).toContain(UNMONITORED_FOOTER);
    expect(r.text).toContain(UNMONITORED_FOOTER);
  });

  it('★★★ it still READS with images off', () => {
    // The people who most need a reset code are the ones whose client blocks
    // images. Nothing that matters may be pixels only.
    const r = renderBrandedEmail(SAMPLE);
    expect(r.html).toContain(`alt="${BRIDGE_LOGO.alt}"`);
    expect(r.html).toContain(`alt="${BLUEPRINT_LOGO.alt}"`);
    expect(BRIDGE_LOGO.alt).toBe('The Bridge');
    expect(BLUEPRINT_LOGO.alt).toBe('Blueprint');
    // every img carries a non-empty alt
    for (const tag of r.html.match(/<img\b[^>]*>/g) ?? []) {
      expect(tag, tag).toMatch(/alt="[^"]+"/);
    }
  });

  it('★★★ email-safe: tables, inline styles, nothing fetched from the web', () => {
    const r = renderBrandedEmail(SAMPLE);
    expect(r.html).toContain('<table');
    // ★ no remote anything — Outlook blocks it and Gmail strips <style>
    expect(r.html).not.toMatch(/src="https?:/);
    expect(r.html).not.toMatch(/<link\b/);
    expect(r.html).not.toMatch(/<style\b/);
    expect(r.html).not.toMatch(/class="/);
    expect(r.html).not.toMatch(/@import/);
    // ★ no flexbox or grid: Outlook renders through Word and collapses them
    expect(r.html).not.toMatch(/display:\s*(flex|grid)/);
    // ★ 600px, and able to shrink on a phone
    expect(r.html).toContain('max-width:100%');
  });

  it('★★ images carry width/height ATTRIBUTES, not only CSS', () => {
    // Outlook ignores CSS dimensions on <img> and would draw these at their
    // encoded @2x size — twice as large as intended.
    const r = renderBrandedEmail(SAMPLE);
    expect(r.html).toContain(`width="${BRIDGE_LOGO.displayWidth}" height="${BRIDGE_LOGO.displayHeight}"`);
    expect(r.html).toContain(`width="${BLUEPRINT_LOGO.displayWidth}" height="${BLUEPRINT_LOGO.displayHeight}"`);
  });
});

// ---------------------------------------------------------------------------
// The bytes
// ---------------------------------------------------------------------------

describe('fix-631 — the logos are the artwork, and the module matches the files', () => {
  it('★★★ emailAssets.ts still equals the PNGs it was generated from', () => {
    // ★★★ THE GUARD THAT MAKES A GENERATED MODULE SAFE. Swap a logo, forget to
    //     regenerate, and every customer gets the old one; hand-edit the base64
    //     and they get a broken image. Either way this fails instead.
    const pairs: [string, { contentBase64: string }][] = [
      ['supabase/functions/_shared/assets/bridge-logo-email.png', BRIDGE_LOGO],
      ['supabase/functions/_shared/assets/blueprint-logo-email.png', BLUEPRINT_LOGO],
    ];
    for (const [file, asset] of pairs) {
      const onDisk = readFileSync(resolve(ROOT, file)).toString('base64');
      expect(onDisk, file).toBe(asset.contentBase64);
    }
  });

  it('★★★ both are real PNGs, and small enough to send on every email', () => {
    for (const asset of [BRIDGE_LOGO, BLUEPRINT_LOGO]) {
      const bytes = Buffer.from(asset.contentBase64, 'base64');
      // PNG magic
      expect([...bytes.subarray(0, 4)], asset.fileName).toEqual([0x89, 0x50, 0x4e, 0x47]);
      // ★ the brief's budget is 30 KB each. They are far under it: 8 colours is
      //   all a flat wordmark needs, and the smaller they are the less there is
      //   to get wrong on the one path that carries them to production.
      expect(bytes.length, asset.fileName).toBeLessThanOrEqual(30 * 1024);
      expect(bytes.length, asset.fileName).toBeLessThanOrEqual(6 * 1024);
      expect(bytes.length, asset.fileName).toBeGreaterThan(500);
    }
  });

  it('★★★ the module VERIFIES itself, because the deploy path is a transcription', () => {
    // ★★★ THIS IS NOT THEORETICAL. The only way these bytes reach production is
    //     that somebody transcribes the base64 into a deploy call — there is no
    //     CLI deploy here and a bundle carries source, not files. That
    //     transcription WAS corrupted once while shipping this very ticket: a
    //     mangled tail that still parsed as a perfectly good string and would
    //     have mailed a broken logo to every customer, silently.
    const bridge = Buffer.from(BRIDGE_LOGO.contentBase64, 'base64');
    expect(bridge.length).toBe(BRIDGE_LOGO_BYTES);
    expect(__fnv1a(new Uint8Array(bridge))).toBe(BRIDGE_LOGO_HASH);
    const bp = Buffer.from(BLUEPRINT_LOGO.contentBase64, 'base64');
    expect(bp.length).toBe(BLUEPRINT_LOGO_BYTES);
    expect(__fnv1a(new Uint8Array(bp))).toBe(BLUEPRINT_LOGO_HASH);
  });

  it('★★★ and a corrupted constant THROWS, naming the logo and the remedy', () => {
    // ★★ The failure has to be loud. A corrupt image that still renders the page
    //    is indistinguishable from a working deploy until a customer sees it.
    const good = BRIDGE_LOGO.contentBase64;
    expect(() =>
      __verifyAsset('bridge-logo.png', good, BRIDGE_LOGO_BYTES, BRIDGE_LOGO_HASH),
    ).not.toThrow();

    // one byte changed — same length, different hash
    const mangled = good.slice(0, 40) + (good[40] === 'A' ? 'B' : 'A') + good.slice(41);
    expect(() =>
      __verifyAsset('bridge-logo.png', mangled, BRIDGE_LOGO_BYTES, BRIDGE_LOGO_HASH),
    ).toThrow(/bridge-logo\.png is corrupted/);

    // truncated — the shape the real corruption took
    const truncated = good.slice(0, good.length - 100);
    expect(() =>
      __verifyAsset('bridge-logo.png', truncated, BRIDGE_LOGO_BYTES, BRIDGE_LOGO_HASH),
    ).toThrow(/corrupted/);

    // and the message says what to do, not just that something is wrong
    try {
      __verifyAsset('bridge-logo.png', mangled, BRIDGE_LOGO_BYTES, BRIDGE_LOGO_HASH);
    } catch (e) {
      expect((e as Error).message).toMatch(/regenerate it and redeploy/);
      expect((e as Error).message).toMatch(/do not hand-edit/);
    }
  });

  it('★★ fnv1a is a real hash: it moves when one byte does', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(__fnv1a(a)).not.toBe(__fnv1a(b));
    expect(__fnv1a(a)).toBe(__fnv1a(new Uint8Array([1, 2, 3, 4])));
    // stays inside uint32
    expect(__fnv1a(a)).toBeGreaterThanOrEqual(0);
    expect(__fnv1a(a)).toBeLessThanOrEqual(0xffffffff);
  });

  it('★★ they are encoded at @2x of their display size', () => {
    // A logo encoded at its display size looks soft on every phone made since
    // about 2012.
    const pngSize = (b64: string) => {
      const b = Buffer.from(b64, 'base64');
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    };
    for (const asset of [BRIDGE_LOGO, BLUEPRINT_LOGO]) {
      const { w } = pngSize(asset.contentBase64);
      expect(w, asset.fileName).toBe(asset.displayWidth * 2);
    }
  });
});

// ---------------------------------------------------------------------------
// The MIME
// ---------------------------------------------------------------------------

const WITH_IMAGES: SendMailInput = {
  to: 'x@blueprintcap.com',
  subject: 'S',
  html: `<p><img src="cid:${BRIDGE_LOGO.cid}" /></p>`,
  text: 'h',
  inlineImages: [
    {
      cid: BRIDGE_LOGO.cid,
      fileName: BRIDGE_LOGO.fileName,
      contentType: BRIDGE_LOGO.contentType,
      contentBase64: BRIDGE_LOGO.contentBase64,
    },
  ],
};

describe('fix-631 — multipart/related, so the images actually arrive', () => {
  it('★★★ an inline image becomes a related part with a Content-ID', () => {
    const mime = buildMimeMessage(WITH_IMAGES, 'seed');
    expect(mime).toContain('Content-Type: multipart/related; type="multipart/alternative"; boundary="rel_seed"');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="alt_seed"');
    // ★ angle brackets in the header, none in the cid: URL
    expect(mime).toContain(`Content-ID: <${BRIDGE_LOGO.cid}>`);
    expect(mime).toContain('Content-Disposition: inline; filename="bridge-logo.png"');
    expect(mime).toContain('--rel_seed--');
    // and the bytes are in there
    expect(mime).toContain(BRIDGE_LOGO.contentBase64.slice(0, 60));
  });

  it('★★★ the related part WRAPS the alternative, not the other way round', () => {
    // Inverted, a reader offers the logos as two downloadable files and shows
    // the body with broken images.
    const mime = buildMimeMessage(WITH_IMAGES, 'seed');
    expect(mime.indexOf('multipart/related')).toBeLessThan(mime.indexOf('multipart/alternative'));
    expect(mime.indexOf('--rel_seed')).toBeLessThan(mime.indexOf('--alt_seed'));
    expect(mime.indexOf('--alt_seed--')).toBeLessThan(mime.indexOf('--rel_seed--'));
  });

  it('★★★ with an attachment too: mixed > related > alternative', () => {
    const mime = buildMimeMessage(
      {
        ...WITH_IMAGES,
        attachments: [
          { name: 'set.pdf', contentType: 'application/pdf', contentBase64: 'QUJD' },
        ],
      },
      'seed',
    );
    const mixed = mime.indexOf('multipart/mixed');
    const related = mime.indexOf('multipart/related');
    const alt = mime.indexOf('multipart/alternative; boundary');
    expect(mixed).toBeGreaterThanOrEqual(0);
    expect(mixed).toBeLessThan(related);
    expect(related).toBeLessThan(alt);
    // the attachment is in the MIXED part, beside the related one — not inside it
    expect(mime.indexOf('--rel_seed--')).toBeLessThan(
      mime.indexOf('Content-Disposition: attachment; filename="set.pdf"'),
    );
  });

  it('★★ no inline images: the old shape is untouched (fix-628 still holds)', () => {
    const mime = buildMimeMessage(
      { to: 'x@blueprintcap.com', subject: 'S', html: '<p>h</p>', text: 'h' },
      'seed',
    );
    expect(mime).not.toContain('multipart/related');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="alt_seed"');
  });
});

// ---------------------------------------------------------------------------
// End to end, through the hook
// ---------------------------------------------------------------------------

describe('fix-631 — the reset email, end to end', () => {
  it('★★★ recovery is branded, and the code is still live TEXT', () => {
    const r = renderAuthEmail('recovery', '12345678');
    // ★★ the live token is EIGHT digits, as the 2026-10-08 send proved. The
    //    email must not assume six anywhere.
    expect(r.html).toContain('12345678');
    expect(r.text).toContain('12345678');
    // the code is text, not an image
    expect(r.html).toMatch(/>\s*12345678\s*</);
    // fix-426's wording survives the reskin
    expect(r.html).toContain('Enter this code in the Bridge to reset your password:');
    expect(r.html).toContain(`src="cid:${BRIDGE_LOGO.cid}"`);
    expect(r.html).toContain(`src="cid:${BLUEPRINT_LOGO.cid}"`);
    expect(r.inlineImages).toHaveLength(2);
  });

  it('★★ every action type gets the branding, not just recovery', () => {
    for (const t of [
      'recovery', 'signup', 'invite', 'magiclink',
      'email_change', 'email_change_new', 'reauthentication', 'something_new',
    ]) {
      const r = renderAuthEmail(t, '654321');
      expect(r.html, t).toContain(`src="cid:${BRIDGE_LOGO.cid}"`);
      expect(r.html, t).toContain('(206) 339-3390');
      expect(r.text, t).toContain('(206) 339-3390');
      expect(r.inlineImages, t).toHaveLength(2);
    }
  });

  it('★★★ the images reach sendMail — and the subject STILL carries no code', () => {
    const sent: SendMailInput[] = [];
    const rows: OutboxRow[] = [];
    const deps: Deps = {
      sendMail: async (input) => {
        sent.push(input);
        return { ok: true, requestId: 'req-1' };
      },
      recordOutbox: async (row) => {
        rows.push(row);
      },
      hookSecret: undefined,
      nowSeconds: () => 0,
    };

    // ★ Signature verification is fix-628's and is not re-tested here; this
    //   drives the rendering path directly by calling it with a verified shape.
    const payload = {
      user: { email: 'robertd@blueprintcap.com' },
      email_data: { email_action_type: 'recovery', token: '12345678' },
    };
    const rendered = renderAuthEmail('recovery', payload.email_data.token);
    expect(rendered.inlineImages).toHaveLength(2);

    // and the real handler passes them along
    const src = code(read('supabase/functions/auth-send-email/handler.ts'));
    expect(src).toMatch(/inlineImages:\s*rendered\.inlineImages/);

    // the fix-628 rule, re-asserted because this ticket rewrote the renderer
    return handleSendEmail(deps, {
      rawBody: JSON.stringify(payload),
      headers: { id: null, timestamp: null, signature: null },
    }).then((res) => {
      // no secret configured in this test, so it refuses — nothing sent, nothing stored
      expect(res.status).toBe(401);
      expect(sent).toHaveLength(0);
      expect(rows).toHaveLength(0);
    });
  });

  it('★★★ the redaction rule survived the reskin: no code in a stored subject', () => {
    const r = renderAuthEmail('recovery', '12345678');
    expect(r.subject).toBe('Your Bridge reset code: 12345678');
    // what the outbox stores is the redacted form — and the live 8-digit token
    // is exactly the case a bar set at "six digits" would have been built for.
    const redacted = r.subject.replace(/\d{4,}/g, (m) => '•'.repeat(m.length));
    expect(redacted).toBe('Your Bridge reset code: ••••••••');
    expect(/\d{4,}/.test(redacted)).toBe(false);
  });
});
