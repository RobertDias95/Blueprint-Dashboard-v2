// ===========================================================================
// fix-629 (P-324) — "EMAIL PDF" OPENS AN OUTLOOK DRAFT WITH THE PLAN ATTACHED
// ===========================================================================
//
// Bobby, 2026-09-11: *"if i clicked email pdf, it would open the email as we
// discussed, with the pdf in the email."* · *"i dont think we need a link, just
// a pdf."*
//
// ★★★ THE APP NEVER SENDS. It asks Microsoft Graph for a DRAFT in the person's
//     own mailbox (`Mail.ReadWrite`), attaches the plan PDF, and opens that
//     draft in Outlook on the web. The person picks the recipient and presses
//     Send themselves. There is no `Mail.Send` scope anywhere, and IT did not
//     grant one (Entra app "Outlook drafts", ticket #437491).
//
// ★★★ THE ATTACHMENT HAS TWO PATHS, AND IT MUST BRANCH:
//     · under 3 MB → one `POST /me/messages/{id}/attachments` (base64);
//     · 3 MB or more → an upload session, then the bytes in ordered chunks
//       under 4 MB each, following `nextExpectedRanges`, the last PUT → 201.
//     An upload session for a file under 3 MB is refused by Graph
//     (`ErrorAttachmentSizeShouldNotBeLessThanMinimumSize`), and a single POST
//     over 3 MB is refused the other way. The largest set on file is 18.6 MB.
//
// ★★ THE UPLOAD URL CARRIES ITS OWN AUTHORISATION. The PUTs to it must NOT
//    send our bearer token — Graph's docs say so, and sending it fails the
//    request. A test pins the absent header.
//
// This module is pure: sign-in and `fetch` are handed in, so every rule above
// is unit-tested without Microsoft or a browser.

/** Not secrets: an SPA app registration has no secret, and these identify it. */
export const OUTLOOK_DRAFT_APP = {
  clientId: '527eef68-4817-491d-b54b-3ba14b89fb48',
  tenantId: '6db456fa-8448-4c61-bb16-2a343232044c',
  /** ★★★ EXACTLY the URI IT registered — the origin, no path, no slash. A
   *  different one fails sign-in with AADSTS50011. */
  redirectUri: 'https://blueprint-dashboard-v2.onrender.com',
  scopes: ['Mail.ReadWrite', 'User.Read'],
} as const;

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** At or above this, the attachment goes through an upload session. */
export const SMALL_ATTACHMENT_LIMIT = 3 * 1024 * 1024;

/** Upload-session chunk: 12 × 320 KiB = 3.75 MiB — a multiple of 320 KiB (as
 *  Graph asks) and under its 4 MB per-request ceiling. */
export const UPLOAD_CHUNK_BYTES = 12 * 320 * 1024;

export type DraftStep = 'sign-in' | 'download' | 'create' | 'attach' | 'open';

/** What the person reads — one sentence per step, never a stack trace. */
export const STEP_WORDS: Readonly<Record<DraftStep, string>> = {
  'sign-in': 'signing in to Microsoft',
  download: 'getting the PDF',
  create: 'creating the Outlook draft',
  attach: 'attaching the PDF',
  open: 'opening the draft',
};

export class DraftStepError extends Error {
  readonly step: DraftStep;
  constructor(step: DraftStep, message: string) {
    super(message);
    this.name = 'DraftStepError';
    this.step = step;
  }
}

export interface DraftDeps {
  /** A Graph access token for OUTLOOK_DRAFT_APP.scopes. */
  getToken: () => Promise<string>;
  fetch: typeof fetch;
}

export interface DraftRequest {
  /** A short-lived URL for the PDF — the one Download PDF uses. */
  pdfUrl: string;
  /** The attachment's name, e.g. `3505 - Marketing - External.pdf`. */
  fileName: string;
  subject: string;
  /** ★ fix-630: HTML — the "View online" line is a real anchor. */
  htmlBody: string;
}

export interface DraftResult {
  id: string;
  webLink: string;
  bytes: number;
  path: 'small' | 'upload-session';
}

/** `<address> — <plan set name>` */
export function draftSubject(address: string | null | undefined, setName: string): string {
  const a = (address ?? '').trim();
  return a ? `${a} — ${setName}` : setName;
}

/** "Attached: the <plan set name> plan set for <address>." */
export function draftBody(address: string | null | undefined, setName: string): string {
  const a = (address ?? '').trim();
  return a
    ? `Attached: the ${setName} plan set for ${a}.`
    : `Attached: the ${setName} plan set.`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ★ fix-630: the plan's private link, as the draft states it. */
export interface DraftLink {
  url: string;
  /** "Nov 06, 2026" — from the link's REAL expiry (planShareExpiryDate). */
  expiresOn: string;
}

/**
 * ★★★ fix-630 (P-324) — Bobby, 2026-10-07: *"when you email, it attaches the
 * pdf but also provides the private link."*
 *
 *   Attached: the <set> plan set for <address>.
 *   View online: <a href="/s/<token>">/s/<token></a> (link expires <date>)
 *
 * ★★ NO LINK → NO LINE. If the link could not be minted the draft still
 *    carries the PDF and simply says nothing about a link — never a broken or
 *    empty anchor. Only an http(s) URL is ever written into an href.
 */
export function draftHtmlBody(
  address: string | null | undefined,
  setName: string,
  link: DraftLink | null,
): string {
  const first = `<p>${escapeHtml(draftBody(address, setName))}</p>`;
  if (!link || !/^https?:\/\//i.test(link.url)) return first;
  const url = escapeHtml(link.url);
  const exp = link.expiresOn ? ` (link expires ${escapeHtml(link.expiresOn)})` : '';
  return `${first}<p>View online: <a href="${url}">${url}</a>${exp}</p>`;
}

/** Base64 of raw bytes, chunked so a large array never blows the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** The start of the first range Graph still expects (`"3932160-"` → 3932160). */
export function nextRangeStart(ranges: unknown): number | null {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  const first = String(ranges[0]);
  const start = Number(first.split('-')[0]);
  return Number.isFinite(start) ? start : null;
}

async function graphJson(
  deps: DraftDeps,
  token: string,
  step: DraftStep,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await deps.fetch(`${GRAPH_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new DraftStepError(step, `Could not reach Outlook while ${STEP_WORDS[step]}.`);
  }
  if (!res.ok) {
    throw new DraftStepError(step, `Outlook refused while ${STEP_WORDS[step]} (${res.status}).`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Create the draft and attach the PDF. Returns the draft's `webLink`; the
 * caller opens it (a tab is a browser concern, kept out of here).
 */
export async function createPlanDraft(req: DraftRequest, deps: DraftDeps): Promise<DraftResult> {
  // 1 · sign in (silently when we can — the caller's getToken decides)
  let token: string;
  try {
    token = await deps.getToken();
  } catch (e) {
    if (e instanceof DraftStepError) throw e;
    throw new DraftStepError('sign-in', 'Microsoft sign-in did not finish.');
  }

  // 2 · the PDF, exactly as Download PDF gets it
  let bytes: Uint8Array;
  try {
    const res = await deps.fetch(req.pdfUrl);
    if (!res.ok) throw new Error(String(res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new DraftStepError('download', 'Could not get the PDF for this set.');
  }
  if (bytes.length === 0) throw new DraftStepError('download', 'The PDF for this set is empty.');

  // 3 · the draft — To left empty on purpose: the person picks the recipient
  const msg = await graphJson(deps, token, 'create', '/me/messages', {
    subject: req.subject,
    body: { contentType: 'HTML', content: req.htmlBody },
  });
  const id = typeof msg.id === 'string' ? msg.id : '';
  const webLink = typeof msg.webLink === 'string' ? msg.webLink : '';
  if (!id || !webLink) {
    throw new DraftStepError('create', 'Outlook created the draft but did not say where it is.');
  }
  const msgPath = `/me/messages/${encodeURIComponent(id)}`;

  // 4 · the attachment — and it MUST branch on size
  if (bytes.length < SMALL_ATTACHMENT_LIMIT) {
    await graphJson(deps, token, 'attach', `${msgPath}/attachments`, {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: req.fileName,
      contentType: 'application/pdf',
      contentBytes: toBase64(bytes),
    });
    return { id, webLink, bytes: bytes.length, path: 'small' };
  }

  const session = await graphJson(deps, token, 'attach', `${msgPath}/attachments/createUploadSession`, {
    AttachmentItem: {
      attachmentType: 'file',
      name: req.fileName,
      size: bytes.length,
      contentType: 'application/pdf',
    },
  });
  const uploadUrl = typeof session.uploadUrl === 'string' ? session.uploadUrl : '';
  if (!uploadUrl) throw new DraftStepError('attach', 'Outlook did not open an upload for the PDF.');

  const total = bytes.length;
  let start = nextRangeStart(session.nextExpectedRanges) ?? 0;
  // ★ A hard ceiling on PUTs, so a server that keeps answering "the same
  //   range again" cannot loop forever.
  const maxPuts = Math.ceil(total / UPLOAD_CHUNK_BYTES) + 5;
  for (let put = 0; put < maxPuts; put++) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, total) - 1;
    let res: Response;
    try {
      // ★★★ NO Authorization header — the upload URL is pre-authorised.
      res = await deps.fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${end}/${total}`,
        },
        body: bytes.slice(start, end + 1),
      });
    } catch {
      throw new DraftStepError('attach', 'The connection dropped while attaching the PDF.');
    }
    if (res.status === 201) {
      return { id, webLink, bytes: total, path: 'upload-session' };
    }
    if (!res.ok) {
      throw new DraftStepError('attach', `Outlook refused part of the PDF (${res.status}).`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const next = nextRangeStart(json.nextExpectedRanges);
    start = next ?? end + 1;
    if (start >= total) {
      throw new DraftStepError('attach', 'Outlook did not confirm the PDF was attached.');
    }
  }
  throw new DraftStepError('attach', 'Attaching the PDF did not finish.');
}
