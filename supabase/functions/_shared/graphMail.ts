import {
  BRIDGE_SENDER,
  BRIDGE_SENDER_NAME,
  ENV_CLIENT_SECRET,
  MS_CLIENT_ID,
  MS_GRAPH_SCOPE,
  MS_SENDMAIL_URL,
  MS_TOKEN_URL,
} from './msGraphConfig.ts';

// ===========================================================================
// ★★★ fix-628 §B (P-092) — ONE SHARED SENDER, FOR EVERY BRIDGE EMAIL
// ===========================================================================
//
// No SMTP: Microsoft turns off Basic SMTP AUTH at the end of December 2026, so
// an SMTP integration shipped now would be dead within months. No third-party
// sender and no DNS work either — Graph with client credentials uses the mailbox
// IT has already provisioned and authorised.
//
// ★★★ THIS FILE IS FREE OF DENO AND OF A REAL `fetch` — the fix-436 split, the
//     same discipline `plan-share/handler.ts` keeps. Everything arrives through
//     `GraphDeps`, so CI (which has neither a Deno runtime nor a network) drives
//     the whole decision tree, including every error class.
//
// ---------------------------------------------------------------------------
// ★★★ WHY MIME AND NOT GRAPH'S JSON `message` OBJECT
// ---------------------------------------------------------------------------
// §C asks for BOTH HTML and plain text. Graph's JSON sendMail has ONE `body`
// with ONE `contentType` ('HTML' or 'Text') — it cannot carry both, so the JSON
// shape would have silently dropped half the requirement.
//
// ★★ So this posts a base64 MIME message instead (`Content-Type: text/plain` on
//    the request, which is Graph's documented MIME mode). That gives a real
//    `multipart/alternative`, which is what a text-only client and a spam filter
//    both want from a password-reset mail — and `multipart/mixed` wraps it when
//    the later tickets start attaching files.
//
// ★ EVERY PART IS base64, bodies included. Quoted-printable would mean worrying
//   about line length, trailing whitespace and `=` escaping in a message whose
//   whole purpose is to carry six digits intact.

/** Everything the sender needs from the outside world. */
export interface GraphDeps {
  fetch: typeof fetch;
  /** ms since epoch — injected so the token cache is testable without waiting. */
  now: () => number;
  /** ★ `undefined` when the env var is absent, which is a FIRST-CLASS error
   *  below, not a reason to send nothing and return ok. */
  clientSecret: string | undefined;
}

export interface MailAttachment {
  name: string;
  contentType: string;
  /** base64, already encoded — the caller owns the bytes. */
  contentBase64: string;
}

export interface SendMailInput {
  to: string | string[];
  cc?: string | string[];
  replyTo?: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

export type SendMailResult =
  | { ok: true; requestId: string | null }
  | { ok: false; error: string; requestId: string | null };

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------
// ★★ An Edge Function isolate serves several invocations, so caching the token
//    turns two round trips per email into one. The margin matters more than the
//    saving: a token used at the instant it expires fails the send, and the
//    person on the other end is locked out of their account.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  /** absolute ms — already includes the margin */
  goodUntil: number;
}
let cached: CachedToken | null = null;

/** ★ Tests only. Module state would otherwise leak between cases and the second
 *  test would pass because the first one warmed the cache. */
export function __resetGraphTokenCache(): void {
  cached = null;
}

/** ★ Tests only — proves a cache HIT happened rather than inferring it from a
 *  fetch count the test also controls. */
export function __graphTokenCacheState(): { cached: boolean; goodUntil: number | null } {
  return { cached: cached !== null, goodUntil: cached?.goodUntil ?? null };
}

/**
 * ★★★ EVERY FAILURE HERE IS NAMED. "Could not send email" tells whoever is
 *     reading `email_outbox.error` nothing they can act on; these say which
 *     thing is wrong and therefore who fixes it.
 */
function classifyTokenError(status: number, bodyText: string): string {
  // AADSTS7000222 — the client secret has EXPIRED. The single most likely
  // failure a year from now, and the one with the clearest remedy, so it is
  // named outright rather than left as "invalid_client".
  if (bodyText.includes('AADSTS7000222')) {
    return `${ENV_CLIENT_SECRET} has EXPIRED (AADSTS7000222). A new secret must be ` +
      'created on the "Bridge sender" app registration and set in Supabase ' +
      'Edge Function secrets.';
  }
  // AADSTS7000215 — wrong secret. Usually a paste that lost a character, or the
  // secret VALUE confused with the secret ID.
  if (bodyText.includes('AADSTS7000215')) {
    return `${ENV_CLIENT_SECRET} is INVALID (AADSTS7000215) — check it is the ` +
      'secret VALUE, not the secret ID, and that it was pasted whole.';
  }
  if (bodyText.includes('AADSTS700016') || bodyText.includes('unauthorized_client')) {
    return 'The "Bridge sender" app registration was not found in this tenant ' +
      '(AADSTS700016) — check MS_CLIENT_ID and MS_TENANT_ID in msGraphConfig.ts.';
  }
  return `Microsoft token endpoint returned ${status}: ${truncate(bodyText, 400)}`;
}

function classifySendError(status: number, bodyText: string): string {
  if (status === 403) {
    return 'Microsoft Graph refused the send with 403. Either the Mail.Send ' +
      'application permission lost admin consent, or the ApplicationAccessPolicy ' +
      `no longer grants this app access to ${BRIDGE_SENDER}. ` +
      truncate(bodyText, 300);
  }
  if (status === 401) {
    return 'Microsoft Graph returned 401 for a token it had just issued — the ' +
      'token was rejected, not missing. ' + truncate(bodyText, 300);
  }
  if (status === 413) {
    return 'The message was too large for Microsoft Graph (the mailbox limit is ' +
      '150 MB). ' + truncate(bodyText, 200);
  }
  if (status === 429) {
    return 'Microsoft Graph throttled the send (429). ' + truncate(bodyText, 200);
  }
  if (status >= 500) {
    return `Microsoft Graph server error ${status}: ${truncate(bodyText, 300)}`;
  }
  return `Microsoft Graph returned ${status}: ${truncate(bodyText, 400)}`;
}

function truncate(s: string, n: number): string {
  const t = (s ?? '').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

/** ★ Graph returns its correlation id under either header depending on the
 *  endpoint; MS support accepts both, so take whichever is present. */
function requestIdOf(res: { headers: Headers }): string | null {
  return (
    res.headers.get('request-id') ??
    res.headers.get('client-request-id') ??
    res.headers.get('x-ms-request-id') ??
    null
  );
}

/**
 * A client-credentials access token, cached until shortly before it expires.
 *
 * ★★★ A MISSING SECRET THROWS BEFORE ANY NETWORK CALL. §B's rule: *"a missing
 *     env var must fail loudly, never send silently."* Returning ok with nothing
 *     sent is the behaviour that let P-092 live for months.
 */
export async function getGraphToken(deps: GraphDeps): Promise<string> {
  if (!deps.clientSecret || deps.clientSecret.trim() === '') {
    throw new Error(
      `${ENV_CLIENT_SECRET} is not set on this Edge Function. No email can be ` +
        'sent until it is added in Supabase → Edge Functions → Secrets.',
    );
  }

  const now = deps.now();
  if (cached && now < cached.goodUntil) return cached.token;

  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    client_secret: deps.clientSecret,
    grant_type: 'client_credentials',
    scope: MS_GRAPH_SCOPE,
  });

  const res = await deps.fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(classifyTokenError(res.status, text));

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(
      `Microsoft token endpoint returned ${res.status} with a body that is not ` +
        `JSON: ${truncate(text, 200)}`,
    );
  }
  if (!parsed.access_token) {
    throw new Error('Microsoft token endpoint returned no access_token.');
  }

  // ★ `expires_in` is seconds. A response without it is treated as a SHORT life
  //   rather than a long one — guessing high here means sending with a dead
  //   token later.
  const lifetimeMs = (parsed.expires_in ?? 300) * 1000;
  cached = {
    token: parsed.access_token,
    goodUntil: now + Math.max(0, lifetimeMs - TOKEN_EXPIRY_MARGIN_MS),
  };
  return parsed.access_token;
}

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter((s) => s !== '');
}

/** UTF-8 → base64, working the same in Deno and in Node (so the tests mean
 *  something). ★ Chunked because `String.fromCharCode(...bytes)` blows the call
 *  stack on a large attachment. */
export function base64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 wrapped at 76 characters, as RFC 2045 requires. */
function wrap76(b64: string): string {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join('\r\n');
}

/** ★ A header value that may contain non-ASCII is RFC 2047 encoded. A subject is
 *  the one header here that carries human text. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${base64Utf8(value)}?=`;
}

function addressList(label: string, addrs: string[]): string {
  return addrs.length === 0 ? '' : `${label}: ${addrs.join(', ')}\r\n`;
}

/**
 * ★★ Built as a string rather than with a MIME library, because the shape is
 *    small, fixed and fully asserted by the tests next door — and a dependency
 *    in an Edge Function is a supply-chain surface for the sake of 40 lines.
 */
export function buildMimeMessage(input: SendMailInput, boundarySeed: string): string {
  const alt = `alt_${boundarySeed}`;
  const mixed = `mix_${boundarySeed}`;
  const atts = input.attachments ?? [];

  const headers =
    `From: ${BRIDGE_SENDER_NAME} <${BRIDGE_SENDER}>\r\n` +
    addressList('To', asList(input.to)) +
    addressList('Cc', asList(input.cc)) +
    addressList('Reply-To', asList(input.replyTo)) +
    `Subject: ${encodeHeader(input.subject)}\r\n` +
    'MIME-Version: 1.0\r\n';

  const alternative =
    `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n` +
    `--${alt}\r\n` +
    'Content-Type: text/plain; charset="utf-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    `${wrap76(base64Utf8(input.text))}\r\n` +
    `--${alt}\r\n` +
    'Content-Type: text/html; charset="utf-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    `${wrap76(base64Utf8(input.html))}\r\n` +
    `--${alt}--\r\n`;

  if (atts.length === 0) return headers + alternative;

  const parts = atts
    .map(
      (a) =>
        `--${mixed}\r\n` +
        `Content-Type: ${a.contentType}; name="${a.name}"\r\n` +
        `Content-Disposition: attachment; filename="${a.name}"\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        `${wrap76(a.contentBase64)}\r\n`,
    )
    .join('');

  return (
    headers +
    `Content-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n` +
    `--${mixed}\r\n` +
    alternative +
    parts +
    `--${mixed}--\r\n`
  );
}

/**
 * Send one email as bridge@, through Microsoft Graph.
 *
 * ★★ IT NEVER THROWS FOR A SEND FAILURE — it returns `{ ok: false, error }`, so
 *    the caller always has something to write to `email_outbox`. A throw here
 *    would be the one path that produces no row, which is precisely the hole
 *    §A exists to close.
 */
export async function sendGraphMail(
  deps: GraphDeps,
  input: SendMailInput,
  boundarySeed = 'bridge',
): Promise<SendMailResult> {
  if (asList(input.to).length === 0) {
    return { ok: false, error: 'No recipient address.', requestId: null };
  }

  let token: string;
  try {
    token = await getGraphToken(deps);
  } catch (e) {
    return { ok: false, error: (e as Error).message, requestId: null };
  }

  const mime = buildMimeMessage(input, boundarySeed);

  let res: Response;
  try {
    res = await deps.fetch(MS_SENDMAIL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        // ★ Graph's MIME mode. With `application/json` it would expect the
        //   `message` object instead and reject this body.
        'content-type': 'text/plain',
      },
      body: base64Utf8(mime),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach Microsoft Graph: ${(e as Error).message}`,
      requestId: null,
    };
  }

  const requestId = requestIdOf(res);
  // ★ 202 Accepted is the documented success for sendMail; treat any 2xx as sent.
  if (res.ok) return { ok: true, requestId };

  // ★ No initialiser: both branches assign it, so an initial '' is a dead
  //   write — and lint says so.
  let text: string;
  try {
    text = await res.text();
  } catch {
    text = '(no response body)';
  }
  return { ok: false, error: classifySendError(res.status, text), requestId };
}

/**
 * ★★★ THE REDACTION, AND IT IS WHY `email_outbox.subject` IS SAFE TO STORE.
 *
 * §A wants a `subject` column and also says never to store the code. For
 * `recovery` the subject IS `Your Bridge reset code: 123456`, so those two
 * requirements collide — and the collision resolves here, before the row is
 * written, because this is the only layer that ever holds the token.
 *
 * ★★ Masks any run of 4 or more digits. Six is the token length today; masking
 *    from 4 means a longer or shorter token cannot slip through a bar set to
 *    exactly today's length. It does also mask a bare year — "2026" becomes
 *    "••••" — and that is accepted deliberately: no Bridge subject needs a bare
 *    year, and the only safe direction to be wrong in is "masked too much".
 *
 * ★ The database holds the SAME rule, one notch looser (its CHECK refuses a run
 *   of 6+), so this function is strictly stricter than the constraint and a
 *   caller that forgets to redact gets a refused row rather than a stored code.
 */
export function redactSubject(subject: string): string {
  return subject.replace(/\d{4,}/g, (m) => '•'.repeat(m.length));
}
