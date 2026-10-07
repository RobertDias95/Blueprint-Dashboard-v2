// ===========================================================================
// ★★★ fix-628 §C (P-092) — THE SIGNATURE *IS* THE AUTHENTICATION
// ===========================================================================
//
// The Send Email hook is deployed `--no-verify-jwt`, because Supabase Auth calls
// it without a user JWT. So this function is a PUBLIC endpoint, and the only
// thing standing between the internet and "send mail as bridge@" is the
// Standard Webhooks signature checked here.
//
// ★★★ WHICH MAKES THIS THE MOST SECURITY-SENSITIVE FILE IN THE TICKET. An
//     endpoint that renders a caller-supplied `token` into an email and sends it
//     to a caller-supplied address, with no signature check, is an open relay
//     with Blueprint's DKIM on it. `plan-share` is also `--no-verify-jwt` and
//     fix-523 wrote down why that was safe (the token is the credential, and it
//     derives every path itself); this is the equivalent note.
//
// ---------------------------------------------------------------------------
// The scheme (https://www.standardwebhooks.com, which Supabase implements)
// ---------------------------------------------------------------------------
//   headers:  webhook-id, webhook-timestamp (unix seconds), webhook-signature
//   signed:   `${webhook-id}.${webhook-timestamp}.${rawBody}`
//   with:     HMAC-SHA256, key = base64-decode(secret after the `whsec_` prefix)
//   header:   space-separated `v1,<base64>` entries — several, because a secret
//             rotation publishes both the old and the new signature for a while.
//
// ★ Supabase hands you the secret as `v1,whsec_…`. Both prefixes are tolerated
//   below, since which one lands in the env var depends on whether whoever
//   pasted it included the version.
//
// ★★ `crypto.subtle` is used rather than a dependency: it exists in Deno and in
//    Node 18+, so the SAME code runs in production and under vitest. A webhook
//    verifier that is only exercised through a mock is not verified at all.

/** Tolerance either side of `webhook-timestamp`. ★ A replay window, not a clock
 *  fix: 5 minutes is the Standard Webhooks default and is generous enough for
 *  ordinary drift while keeping a captured request from being useful tomorrow. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface VerifyInput {
  rawBody: string;
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  /** The configured secret, `v1,whsec_…` / `whsec_…` / bare base64. */
  secret: string | undefined;
  /** Unix SECONDS. Injected so the tolerance is testable. */
  nowSeconds: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** The raw HMAC key from whichever form of the secret arrived. */
export function parseWebhookSecret(secret: string): Uint8Array {
  let s = secret.trim();
  if (s.startsWith('v1,')) s = s.slice(3);
  if (s.startsWith('whsec_')) s = s.slice(6);
  return base64ToBytes(s);
}

/**
 * ★★★ CONSTANT-TIME COMPARISON. A `===` on a signature leaks, through timing,
 *     how many leading bytes an attacker guessed right, which turns forging one
 *     into a few thousand requests instead of 2^256. It costs nothing to do
 *     properly, so there is no trade-off to weigh.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStandardWebhook(input: VerifyInput): Promise<VerifyResult> {
  const { rawBody, headers, secret, nowSeconds } = input;

  // ★★★ A MISSING SECRET IS A REFUSAL, NEVER A PASS. If the env var is not set
  //     this endpoint must behave as though every request is unsigned — the
  //     alternative (fall through and send) is the open relay.
  if (!secret || secret.trim() === '') {
    return { ok: false, reason: 'SEND_EMAIL_HOOK_SECRET is not set' };
  }
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing webhook-id, webhook-timestamp or webhook-signature' };
  }

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'webhook-timestamp is not a number' };
  }
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'webhook-timestamp outside the tolerance window' };
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      parseWebhookSecret(secret) as unknown as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return { ok: false, reason: 'SEND_EMAIL_HOOK_SECRET is not valid base64' };
  }

  const signed = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signed) as unknown as ArrayBuffer,
  );
  const expected = bytesToBase64(new Uint8Array(mac));

  // ★ Several `v1,<sig>` entries, space separated. Any match passes — that is
  //   what makes a secret rotation possible without dropping live traffic.
  const offered = headers.signature.split(' ').filter((p) => p !== '');
  for (const part of offered) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    if (timingSafeEqual(value, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no v1 signature matched' };
}
