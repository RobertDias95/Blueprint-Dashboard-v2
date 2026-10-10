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
//    render, at the cost of ~5 KB per email.
//
// Both are the artwork the app already ships, trimmed to their ink, flattened
// onto white, encoded at @2x of their display size and quantised to 8 colours —
// a flat wordmark needs no more, and at display size it is indistinguishable
// from the 32-colour version.

/**
 * ★★★ THE INTEGRITY CHECK, AND IT IS NOT THEORETICAL.
 *
 * The ONLY way these bytes reach production is that somebody transcribes the
 * base64 below into a deploy call — this project has no CLI deploy and an Edge
 * Function bundle carries source, not files. That transcription WAS corrupted
 * once while shipping fix-631: a mangled tail that still parsed as a perfectly
 * valid string and would have mailed a broken logo to every customer, silently.
 *
 * ★★ So the decoded length and hash are recorded at generation time and checked
 *    when this module loads. A corrupted asset now stops the function from
 *    starting, which the post-deploy probe catches in seconds — instead of
 *    looking exactly like a working deploy.
 */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Throws on a corrupted constant. ★ Named in the message so whoever reads the
 *  boot error knows which logo and what to do about it. */
function verify(name: string, b64: string, bytes: number, hash: number): string {
  const data = decode(b64);
  if (data.length !== bytes || fnv1a(data) !== hash) {
    throw new Error(
      `emailAssets: ${name} is corrupted (expected ${bytes} bytes / hash ` +
        `${hash}, got ${data.length} / ${fnv1a(data)}). The base64 in ` +
        'emailAssets.ts does not match the PNG it was generated from — ' +
        'regenerate it and redeploy; do not hand-edit it.',
    );
  }
  return b64;
}

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
 *  Encoded 380×66, shown at 190×33. 3531 bytes. */
const BRIDGE_LOGO_BASE64 =
  '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' +
  'QmCC';

/** The official Blueprint signature logo, from Dave's email signature.
 *  Encoded 280×55, shown at 140×28. 1741 bytes. */
const BLUEPRINT_LOGO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAARgAAAA3BAMAAAAlLUjoAAAAGFBMVEX////+///2+PyQnctebLBda69bbLBUY6vGtLexAAAG' +
  'cElEQVR42sVZzW8cRRb/ve4+rASeqhpHsoSEx/MhcSDBX+Gw2vWSDL4CkaL9szb8Bbt7xxtASBxCEhxtbpvYYxMuENwzA0hI' +
  'wExVt1ciEpl+e+jq7zYDe6D7Mq52vapfvY/fe6+aED8kjFxVEprnE6XRzOMmWMJt3fojXnq194y+U88aBSPDnTcOL/Effhp/' +
  'N9h6NpbNoPEsltf3IgAghTNniJE0TYBxAICCq3snyRvVOh12AjQGRvTeOJXpK5Kf3RSyKTAUDk4Km7c+7wVN+YxYe7m4N61c' +
  'mRvTiGYofHtaektPGlGNB4i1ccVDVjb8BlTjgMKa2KEnqhEHluq1mtBZGQZNgOHBaTrSOklL9Hnn949uj8L1dMC7wBkl5Jf6' +
  'jAKQ5s4cN8cJlTibBbCpiJDMy9vpJEz2QzJxYOokscT9xwaDWbzqyqspJ+tMGMi5dbwBF0Z5EWknFOTtdA5y2NnKemItJV96' +
  '6k9gbo7isWPXinGziVWS7ACAJBsAig1yp9OZiI5FFADowKrUTlcMA0BBp0oFPGSu8dyfgM7evxbE8SSsytvbAPR8AgDk7NxP' +
  'sDg7ZzCQ/WjEANFufNQjkww0jwBArm4A0LNJLNVfjADI1fVD+8N2BsBe2EoVw5O2jKb+jaDoHfE2z2/HxLN1PwW/fQYAbise' +
  '9SUALI4AADsEYBHTuNuXAJ7/Iz7b6vdx6bIz1gZwtw4BuLuAkYBHmyn9+u7V7ccwD2N4rRdslPHzDwC1r5aQ4OSH/IS7BurS' +
  '8J8AsHjxAFD7nUnB554InQxN+wB04yCpZ6wqXlk/ujQPTHxU7qb/8AFyr58sCczIzw3mE2BwWWoADvuA4w3fLcxe5MY+4MIH' +
  'vG5GbuHeqVoMbzlvlVOVAvhsbxlLkMoFFSlg7Fq3UwDPqERw4YY2WfA7UIDnTlIPJkiAUiIJOkl6MgxyIJbYidkUBqQSNjUM' +
  'Oi/NXnwj0rhkDReG4eR4VgKgr4VlAvqmIPx/8LFBYXEu/HPTVBNOzmdYGQB1KUkCMFiWrIhUkfry+KVJqdo+Z3sdU1d2JqsF' +
  '8RKmvJjWWl/lZYpgnaU2EClptuxKUkH3y2qbuxVle0JkYEz874oKegBdu7PMZ5wegLlJ3QD9hXU6DfS6o9L01oPhu6IEJnfg' +
  'xN9NETK5fwXw4+kS1UTtNuB8afXq9ECDKD5WsAtc2nyvdJhg5pTt5P0KR4xOgD46y0q/vgTwpRXpAX1plfntPjC7Ny0fxnfl' +
  'L4BhWRs4zD4wHvRGS6z0yOQYti8xu2uVefke3L3jSl/YejC8tVaqZ3IasAHZKZOeD4DeOfwNDOzcBeDb/fkIA1RvE2jmdEua' +
  'CThVhBEXRK8CMKZldqJ8RRVNkO2vMPYEl6VN4IqfLjITaRkAK6kfZ3WUYZByLgzpOgYucI6BOqnmWRYPhh9fyDMAwBUbXcwr' +
  'bhyChmtzg87ZhSNzvaYFmTnFNtqzORoAxJMFiNG1ln75izyVBlHOZnG5eCIDheDaHesaVLBTZV9ZYydqFc202EjnRGc3gTvC' +
  'ncZwxTRf3g44MIVal4V582/AIM29/AsXXiZ0bT1TsNO/V4pgxjcywP498KnciOoYuJccrAcAPAag/7ujne5KgtnpJZFX84iT' +
  '9rRGX3vRRYly1RxJI8MrU+vPaZrJMxj1AGAxYQTh9f1jd+sTW6JH7TYAnlccNYqd5s9VajBBOR1kNzPe9sggfN2+CJ8m/O3u' +
  'ImMwZxcA/gOAxb39XTweJ+rL18BUuY+aWWqQ32d+yOLhnwpgWmHGuEMyaO9NS5EdHSBlMOZ/2WABEBhIngccx/fd/LIHOV5w' +
  'PgSgg/djwaexYX7+MG6Ofkj6qA8YILm2LgGA12+9srF57G7atok3/l5wyLr7WGlQrlIufH7NLaEXnGcl72LUjo6Tjioy+fYU' +
  '+Y4u6QSNSvvZtBPTpVYvGQRp92bLYo18o0lSA17SaNoekRIs54fC1IQsV7rYur9rRJJXxR8u8ILDrc/qFaibuBKhrzbr6Pzy' +
  'tImbK6PrVHP+qWzksqg1FVXFXNHcyG1n8LRbUc358bSZq1dufdSpKMYXDV1KB+FGVPAQPv90yg1d13Prq82CUcLLc9HYh4zA' +
  'f5hDw+a121PT2Pcmlo+QVhba2bo/Fc2BQSAeLf5iebe/cv+4mW9fFgwH4jiS6GraxeOx39QXU8p/ve2i2a+3/wNxYNKRpzFW' +
  'HAAAAABJRU5ErkJggg==';

/** ★ Recorded at generation time by `f631b_gen_module.py`. */
export const BRIDGE_LOGO_BYTES = 3531;
export const BRIDGE_LOGO_HASH = 174459770;
export const BLUEPRINT_LOGO_BYTES = 1741;
export const BLUEPRINT_LOGO_HASH = 1747241624;

export const BRIDGE_LOGO: EmailImage = {
  cid: 'bridge-logo@blueprintcap.com',
  fileName: 'bridge-logo.png',
  contentType: 'image/png',
  contentBase64: verify(
    'bridge-logo.png', BRIDGE_LOGO_BASE64, BRIDGE_LOGO_BYTES, BRIDGE_LOGO_HASH,
  ),
  displayWidth: 190,
  displayHeight: 33,
  alt: 'The Bridge',
};

export const BLUEPRINT_LOGO: EmailImage = {
  cid: 'blueprint-logo@blueprintcap.com',
  fileName: 'blueprint-logo.png',
  contentType: 'image/png',
  contentBase64: verify(
    'blueprint-logo.png', BLUEPRINT_LOGO_BASE64, BLUEPRINT_LOGO_BYTES, BLUEPRINT_LOGO_HASH,
  ),
  displayWidth: 140,
  displayHeight: 28,
  alt: 'Blueprint',
};

/** ★ Exported for the test, which drives the failure path the deploy risks. */
export const __verifyAsset = verify;
export const __fnv1a = fnv1a;
