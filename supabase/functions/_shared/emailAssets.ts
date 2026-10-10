// ===========================================================================
// ★★★ fix-631 (P-326) — THE LOGOS, AS BYTES
// ===========================================================================
//
// ⚠️ GENERATED FROM `_shared/assets/*.png`. Do not hand-edit the base64 — edit
//    the PNG and regenerate. `BrandedEmailFix631.test.ts` re-encodes the files
//    and asserts they still equal these constants, so a swapped logo that nobody
//    regenerated fails CI rather than mailing a broken image to a customer.
//
// ★★★ WHY BASE64 IN A MODULE AND NOT THE FILES. An Edge Function bundle is
//     text: there is no filesystem to read at runtime, and the deploy carries
//     source files. Base64 in a module is the only way these bytes reach Graph.
//
// ★★ AND WHY THEY ARE EMBEDDED (CID) RATHER THAN LINKED. Outlook blocks remote
//    images by default, so a `<img src="https://…">` signature arrives as two
//    empty boxes and a "click to download pictures" bar — which is exactly the
//    plain, broken look this ticket exists to remove. Embedded images always
//    render, at the cost of ~8 KB per email.
//
// Both are the artwork the app already ships, trimmed to their ink, flattened
// onto white and encoded at @2x of their display size.

export interface EmailImage {
  /** The `cid:` reference used in the HTML. */
  cid: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
  /** DISPLAY width in px — half the encoded width, because these are @2x. */
  displayWidth: number;
  displayHeight: number;
  alt: string;
}

/** The Bridge lockup (bridge graphic + "THE BRIDGE"), from
 *  `src/assets/brand/bridge-logo-2026.png` — the app's own header wordmark.
 *  Encoded 380×66, shown at 190×33. 6.1 KB. */
const BRIDGE_LOGO_BASE64 =
  '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' +
  'AABJRU5ErkJggg==';

/** The official Blueprint signature logo, from Dave's email signature.
 *  Encoded 280×55, shown at 140×28. 2.2 KB. */
const BLUEPRINT_LOGO_BASE64 =
  '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';

export const BRIDGE_LOGO: EmailImage = {
  cid: 'bridge-logo@blueprintcap.com',
  fileName: 'bridge-logo.png',
  contentType: 'image/png',
  contentBase64: BRIDGE_LOGO_BASE64,
  displayWidth: 190,
  displayHeight: 33,
  alt: 'The Bridge',
};

export const BLUEPRINT_LOGO: EmailImage = {
  cid: 'blueprint-logo@blueprintcap.com',
  fileName: 'blueprint-logo.png',
  contentType: 'image/png',
  contentBase64: BLUEPRINT_LOGO_BASE64,
  displayWidth: 140,
  displayHeight: 28,
  alt: 'Blueprint',
};
