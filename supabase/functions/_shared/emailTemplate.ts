import {
  BLUEPRINT_OFFICES,
  UNMONITORED_FOOTER,
} from './msGraphConfig.ts';
import { BLUEPRINT_LOGO, BRIDGE_LOGO, type EmailImage } from './emailAssets.ts';
import type { InlineImage } from './graphMail.ts';

// ===========================================================================
// ★★★ fix-631 §A (P-326) — ONE BRANDED SHELL, FOR EVERY bridge@ EMAIL
// ===========================================================================
//
// Bobby, 2026-10-10: *"can we make the email from the bridge more professional?
// Blueprint: the Bridge. logo for the bridge instead of a B. we add a signature
// to the bottom to include the office phone numbers and the logo."*
//
// fix-628 shipped the sending; it sent its first real email on 2026-10-08 and
// it arrives looking like a plain-text note from nobody in particular. This file
// is the wrapper that makes it look like it came from Blueprint — and it takes
// the MESSAGE as content, so the reset code today and P-323's mention emails
// later get the same header, divider and signature without either knowing how
// the other is built.
//
// ---------------------------------------------------------------------------
// ★★★ EMAIL HTML IS NOT WEB HTML, AND THE RULES ARE NOT PREFERENCES
// ---------------------------------------------------------------------------
//  · TABLES, not flexbox or grid. Outlook renders through Word, which has no
//    layout engine worth the name. A `<div style="display:flex">` signature
//    collapses into a vertical pile there.
//  · INLINE STYLES only. `<style>` blocks are stripped by Gmail's web client
//    and several others, so a class is a style that some readers will not see.
//  · NO EXTERNAL CSS, NO WEB FONTS, NO REMOTE IMAGES. The images are embedded
//    (`cid:`) because Outlook blocks remote ones by default.
//  · IT MUST READ WITH IMAGES OFF. Both logos carry alt text, and every word
//    that matters — the code, the phone numbers, the footer — is live text, not
//    pixels. A reset code baked into an image would be unreadable to the person
//    who most needs it.
//  · WIDTH 600px, the long-standing safe maximum, and `max-width:100%` so a
//    phone does not scroll sideways.

/** Blueprint's blue, taken from the logo artwork itself. */
const BLUE = '#5a6bb0';
const INK = '#111111';
const MUTED = '#666666';
const RULE = '#e2e5ee';
const SANS =
  "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface BrandedEmailInput {
  /** The message itself, as email-safe HTML. The shell adds everything else. */
  bodyHtml: string;
  /** The same message as plain text. ★ Not a courtesy: see below. */
  bodyText: string;
}

export interface BrandedEmail {
  html: string;
  text: string;
  /** ★ What the caller must hand to `sendGraphMail`, or the `cid:` references
   *  in the HTML point at nothing and both logos arrive broken. */
  inlineImages: InlineImage[];
}

function imgTag(image: EmailImage): string {
  // ★ WIDTH AND HEIGHT AS ATTRIBUTES, not only in the style. Outlook ignores CSS
  //   dimensions on images and would otherwise draw these at their encoded @2x
  //   size — twice as big as intended.
  return (
    `<img src="cid:${image.cid}" alt="${image.alt}" ` +
    `width="${image.displayWidth}" height="${image.displayHeight}" ` +
    `style="display:block;border:0;outline:none;text-decoration:none;` +
    `width:${image.displayWidth}px;height:${image.displayHeight}px" />`
  );
}

function toInline(image: EmailImage): InlineImage {
  return {
    cid: image.cid,
    fileName: image.fileName,
    contentType: image.contentType,
    contentBase64: image.contentBase64,
  };
}

/** The three offices as one line of `tel:` links. */
function officeLineHtml(): string {
  return BLUEPRINT_OFFICES.map(
    (o) =>
      `<span style="white-space:nowrap">${o.city} ` +
      `<a href="tel:${o.tel}" style="color:${BLUE};text-decoration:none">${o.phone}</a>` +
      '</span>',
  ).join(' &nbsp;·&nbsp; ');
}

/** The same three, for the text part. */
export function officeLineText(): string {
  return BLUEPRINT_OFFICES.map((o) => `${o.city} ${o.phone}`).join(' · ');
}

/**
 * Wrap a message in the Bridge header and the Blueprint signature.
 *
 * ★★ THE TEXT PART IS NOT A FALLBACK NOBODY READS. It is what a screen reader,
 *    a watch, a text-only client and — more to the point — a spam filter see. A
 *    message that is one big image and an empty text part scores badly, and a
 *    password reset that lands in junk is the bug this whole line of tickets is
 *    about.
 */
export function renderBrandedEmail(input: BrandedEmailInput): BrandedEmail {
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
    '</head>' +
    `<body style="margin:0;padding:0;background:#f4f5f8">` +
    // ★ The outer table is the background; the inner one is the 600px card.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:#f4f5f8;margin:0;padding:0">` +
    '<tr><td align="center" style="padding:24px 12px">' +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${RULE};` +
    `border-radius:8px">` +
    // --- header -----------------------------------------------------------
    `<tr><td style="padding:28px 32px 20px 32px">${imgTag(BRIDGE_LOGO)}</td></tr>` +
    // --- body -------------------------------------------------------------
    `<tr><td style="padding:0 32px 8px 32px;font-family:${SANS};font-size:15px;` +
    `line-height:1.5;color:${INK}">` +
    input.bodyHtml +
    '</td></tr>' +
    // --- divider ----------------------------------------------------------
    `<tr><td style="padding:24px 32px 0 32px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="border-top:1px solid ${RULE};font-size:0;line-height:0">&nbsp;</td></tr>` +
    '</table></td></tr>' +
    // --- signature --------------------------------------------------------
    `<tr><td style="padding:20px 32px 28px 32px;font-family:${SANS};font-size:12px;` +
    `line-height:1.6;color:${MUTED}">` +
    `<div style="padding-bottom:10px">${imgTag(BLUEPRINT_LOGO)}</div>` +
    `<div style="color:${INK};font-size:12px;padding-bottom:6px">${officeLineHtml()}</div>` +
    `<div>${UNMONITORED_FOOTER}</div>` +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  const text =
    'BLUEPRINT: THE BRIDGE\n' +
    '\n' +
    `${input.bodyText}\n` +
    '\n' +
    '--\n' +
    'Blueprint\n' +
    `${officeLineText()}\n` +
    `${UNMONITORED_FOOTER}\n`;

  // ★ Header first, signature second — the order they appear. A reader that
  //   lists unreferenced parts as attachments then lists them the right way up.
  return { html, text, inlineImages: [toInline(BRIDGE_LOGO), toInline(BLUEPRINT_LOGO)] };
}
