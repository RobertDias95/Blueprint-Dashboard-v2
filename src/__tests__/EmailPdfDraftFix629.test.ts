import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlanDraft,
  DraftStepError,
  draftBody,
  draftHtmlBody,
  draftSubject,
  GRAPH_BASE,
  nextRangeStart,
  OUTLOOK_DRAFT_APP,
  SMALL_ATTACHMENT_LIMIT,
  toBase64,
  UPLOAD_CHUNK_BYTES,
} from '../lib/outlookDraft';

// ===========================================================================
// fix-629 (P-324) — "Email PDF" opens an Outlook draft with the plan attached
// ===========================================================================
//
// Graph and MSAL are mocked: CI cannot sign in as a Blueprint user, so the
// live round-trip is Bobby's click (see the PR).

const PDF_URL = 'https://example.supabase.co/storage/v1/object/sign/plan-thumbnails/x/source.pdf?token=t';
const UPLOAD_URL = 'https://outlook.office.com/api/v2.0/Users/x/Messages/m1/AttachmentSessions/s1?authtoken=abc';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fake Graph that records every call and answers like the real one. */
function fakeGraph(pdfBytes: number, opts: { putStatus?: number; skipRanges?: boolean } = {}) {
  const calls: Call[] = [];
  const received: number[] = [];
  const pdf = new Uint8Array(pdfBytes).map((_, i) => i % 251);
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    if (url === PDF_URL) return new Response(pdf, { status: 200 });
    if (url === `${GRAPH_BASE}/me/messages`) {
      return new Response(JSON.stringify({ id: 'm1', webLink: 'https://outlook.office.com/owa/?ItemID=m1' }), { status: 201 });
    }
    if (url.endsWith('/attachments/createUploadSession')) {
      return new Response(JSON.stringify({ uploadUrl: UPLOAD_URL, nextExpectedRanges: ['0-'] }), { status: 201 });
    }
    if (url.endsWith('/attachments')) return new Response('{}', { status: 201 });
    if (url === UPLOAD_URL) {
      if (opts.putStatus) return new Response('{}', { status: opts.putStatus });
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(headers['Content-Range'] ?? '')!;
      const [, s, e, t] = range.map(Number);
      received.push(e - s + 1);
      if (e + 1 >= t) return new Response('{}', { status: 201 });
      return new Response(JSON.stringify({ nextExpectedRanges: [`${e + 1}-`] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  return { fetch: f as unknown as typeof fetch, calls, received, pdf };
}

const REQ = {
  pdfUrl: PDF_URL,
  fileName: '3505 - Marketing - External.pdf',
  subject: draftSubject('3505 Densmore Ave N', 'Marketing · External'),
  // ★ fix-630: the body is HTML now (it may carry the private link).
  htmlBody: draftHtmlBody('3505 Densmore Ave N', 'Marketing · External', null),
};
const deps = (f: typeof fetch) => ({ getToken: async () => 'graph-token', fetch: f });

afterEach(() => vi.restoreAllMocks());

describe('fix-629: the app registration IT built', () => {
  it('★★★ the exact IDs, the exact redirect URI, and NO Mail.Send', () => {
    expect(OUTLOOK_DRAFT_APP.clientId).toBe('527eef68-4817-491d-b54b-3ba14b89fb48');
    expect(OUTLOOK_DRAFT_APP.tenantId).toBe('6db456fa-8448-4c61-bb16-2a343232044c');
    expect(OUTLOOK_DRAFT_APP.redirectUri).toBe('https://blueprint-dashboard-v2.onrender.com');
    expect([...OUTLOOK_DRAFT_APP.scopes]).toEqual(['Mail.ReadWrite', 'User.Read']);
  });
  it('★ subject and body', () => {
    expect(REQ.subject).toBe('3505 Densmore Ave N — Marketing · External');
    expect(draftBody('3505 Densmore Ave N', 'Marketing · External')).toBe('Attached: the Marketing · External plan set for 3505 Densmore Ave N.');
    expect(REQ.htmlBody).toBe('<p>Attached: the Marketing · External plan set for 3505 Densmore Ave N.</p>');
  });
});

describe('fix-629: the draft and its attachment', () => {
  it('★★★ under 3 MB → ONE attachments POST, base64, and no upload session', async () => {
    const g = fakeGraph(200 * 1024);
    const r = await createPlanDraft(REQ, deps(g.fetch));
    expect(r).toMatchObject({ id: 'm1', path: 'small', webLink: 'https://outlook.office.com/owa/?ItemID=m1' });
    const create = g.calls.find((c) => c.url === `${GRAPH_BASE}/me/messages`)!;
    expect(create.method).toBe('POST');
    expect(create.headers.Authorization).toBe('Bearer graph-token');
    const msg = JSON.parse(String(create.body));
    expect(msg).toEqual({ subject: REQ.subject, body: { contentType: 'HTML', content: REQ.htmlBody } });
    const attach = g.calls.find((c) => c.url.endsWith('/messages/m1/attachments'))!;
    const a = JSON.parse(String(attach.body));
    expect(a['@odata.type']).toBe('#microsoft.graph.fileAttachment');
    expect(a.name).toBe('3505 - Marketing - External.pdf');
    expect(a.contentType).toBe('application/pdf');
    expect(a.contentBytes).toBe(toBase64(g.pdf));
    expect(g.calls.some((c) => c.url.includes('createUploadSession'))).toBe(false);
  });

  it('★★★ 3 MB or more → an upload session, ordered chunks under 4 MB, last PUT 201', async () => {
    const size = Math.round(18.6 * 1024 * 1024); // the largest set on file
    const g = fakeGraph(size);
    const r = await createPlanDraft(REQ, deps(g.fetch));
    expect(r.path).toBe('upload-session');
    const session = g.calls.find((c) => c.url.endsWith('/createUploadSession'))!;
    expect(JSON.parse(String(session.body))).toEqual({
      AttachmentItem: { attachmentType: 'file', name: REQ.fileName, size, contentType: 'application/pdf' },
    });
    const puts = g.calls.filter((c) => c.url === UPLOAD_URL);
    expect(puts.length).toBe(Math.ceil(size / UPLOAD_CHUNK_BYTES));
    // in order, contiguous, each under 4 MB
    let expectStart = 0;
    for (const p of puts) {
      const [, s, e, t] = /bytes (\d+)-(\d+)\/(\d+)/.exec(p.headers['Content-Range'])!.map(Number);
      expect(s).toBe(expectStart);
      expect(t).toBe(size);
      expect(e - s + 1).toBeLessThan(4 * 1000 * 1000);
      expectStart = e + 1;
    }
    expect(expectStart).toBe(size);
    expect(g.received.reduce((a, b) => a + b, 0)).toBe(size);
  });

  it('★★★ the upload PUTs carry NO Authorization header', async () => {
    const g = fakeGraph(5 * 1024 * 1024);
    await createPlanDraft(REQ, deps(g.fetch));
    const puts = g.calls.filter((c) => c.url === UPLOAD_URL);
    expect(puts.length).toBeGreaterThan(0);
    for (const p of puts) {
      expect(Object.keys(p.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    }
  });

  it('★★★ it BRANCHES at exactly 3 MB (a session under 3 MB is refused by Graph)', async () => {
    const under = fakeGraph(SMALL_ATTACHMENT_LIMIT - 1);
    expect((await createPlanDraft(REQ, deps(under.fetch))).path).toBe('small');
    const at = fakeGraph(SMALL_ATTACHMENT_LIMIT);
    expect((await createPlanDraft(REQ, deps(at.fetch))).path).toBe('upload-session');
  });

  it('★★ nextExpectedRanges is followed', () => {
    expect(nextRangeStart(['3932160-'])).toBe(3932160);
    expect(nextRangeStart(['12-20', '40-'])).toBe(12);
    expect(nextRangeStart([])).toBeNull();
    expect(nextRangeStart(undefined)).toBeNull();
  });

  it('★★ each failure names its step', async () => {
    const signIn = createPlanDraft(REQ, { getToken: async () => { throw new Error('x'); }, fetch: fakeGraph(10).fetch });
    await expect(signIn).rejects.toMatchObject({ step: 'sign-in' });

    const badPdf = fakeGraph(10);
    const f404 = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) =>
      String(u) === PDF_URL ? new Response('', { status: 403 }) : badPdf.fetch(u, i),
    ) as unknown as typeof fetch;
    await expect(createPlanDraft(REQ, deps(f404))).rejects.toMatchObject({ step: 'download' });

    const put = fakeGraph(4 * 1024 * 1024, { putStatus: 500 });
    const e = await createPlanDraft(REQ, deps(put.fetch)).catch((x) => x);
    expect(e).toBeInstanceOf(DraftStepError);
    expect(e.step).toBe('attach');
    expect(e.message).toBe('Outlook refused part of the PDF (500).');
  });
});

// ---------------------------------------------------------------------------
describe('fix-629: Microsoft sign-in (MSAL mocked)', () => {
  it('★★★ silent when an account exists, the popup otherwise; one sentence when it fails', async () => {
    const silent = vi.fn().mockResolvedValue({ accessToken: 'silent-token' });
    const popup = vi.fn().mockResolvedValue({ accessToken: 'popup-token', account: { homeAccountId: 'a' } });
    let accounts: unknown[] = [];
    class InteractionRequiredAuthError extends Error {}
    vi.doMock('@azure/msal-browser', () => ({
      InteractionRequiredAuthError,
      PublicClientApplication: class {
        config: unknown;
        constructor(c: unknown) {
          this.config = c;
        }
        initialize = async () => {};
        getActiveAccount = () => null;
        getAllAccounts = () => accounts;
        acquireTokenSilent = silent;
        acquireTokenPopup = popup;
        setActiveAccount = vi.fn();
      },
    }));
    vi.resetModules();
    const auth = await import('../lib/outlookAuth');
    // first press: no account → the popup
    expect(await auth.getOutlookToken()).toBe('popup-token');
    expect(popup).toHaveBeenCalledWith({ scopes: ['Mail.ReadWrite', 'User.Read'] });
    // later press: an account → silent
    accounts = [{ homeAccountId: 'a' }];
    expect(await auth.getOutlookToken()).toBe('silent-token');
    expect(auth.hasOutlookAccount()).toBe(true);
    // a blocked popup → one plain sentence, as a sign-in step failure
    accounts = [];
    popup.mockRejectedValueOnce(Object.assign(new Error('popup'), { errorCode: 'popup_window_error' }));
    await expect(auth.getOutlookToken()).rejects.toMatchObject({
      step: 'sign-in',
      message: 'Your browser blocked the Microsoft sign-in window — allow pop-ups for this site, then try again.',
    });
    vi.doUnmock('@azure/msal-browser');
  });

  it('★★ the sign-in popup returning to this origin is recognised, and nothing else is', async () => {
    const { isOutlookSignInPopup, signInFailureSentence } = await import('../lib/outlookAuth');
    const at = (hash: string, opener: unknown = {}) =>
      ({ opener, location: { hash } }) as unknown as Pick<Window, 'opener' | 'location'>;
    expect(isOutlookSignInPopup(at('#code=abc&state=xyz&session_state=q'))).toBe(true);
    expect(isOutlookSignInPopup(at('#error=access_denied&state=xyz'))).toBe(true);
    expect(isOutlookSignInPopup(at('#code=abc&state=xyz', null))).toBe(false); // not a popup
    expect(isOutlookSignInPopup(at('#/projects/1'))).toBe(false);
    expect(signInFailureSentence({ errorCode: 'user_cancelled' })).toBe('Microsoft sign-in was cancelled.');
    expect(signInFailureSentence({ message: 'AADSTS50011: redirect mismatch' })).toMatch(/not set up for this address/);
  });
});

// ---------------------------------------------------------------------------
describe('fix-630: the body carries the private link', () => {
  it('★★★ attachment line, then "View online" with a real anchor and the expiry', () => {
    expect(
      draftHtmlBody('3505 Densmore Ave N', 'Marketing · External', {
        url: 'https://blueprint-dashboard-v2.onrender.com/s/a7Kd92xQrTvB',
        expiresOn: 'Nov 06, 2026',
      }),
    ).toBe(
      '<p>Attached: the Marketing · External plan set for 3505 Densmore Ave N.</p>' +
        '<p>View online: <a href="https://blueprint-dashboard-v2.onrender.com/s/a7Kd92xQrTvB">' +
        'https://blueprint-dashboard-v2.onrender.com/s/a7Kd92xQrTvB</a> (link expires Nov 06, 2026)</p>',
    );
  });
  it('★★★ no link → no line; never an empty or non-http anchor', () => {
    const only = '<p>Attached: the Site Plan plan set.</p>';
    expect(draftHtmlBody(null, 'Site Plan', null)).toBe(only);
    expect(draftHtmlBody(null, 'Site Plan', { url: '', expiresOn: 'Nov 06, 2026' })).toBe(only);
    expect(draftHtmlBody(null, 'Site Plan', { url: 'javascript:alert(1)', expiresOn: '' })).toBe(only);
  });
  it('★ addresses and names are escaped', () => {
    expect(draftHtmlBody('1 <b>A</b> & Co', 'Set "X"', null)).toBe(
      '<p>Attached: the Set &quot;X&quot; plan set for 1 &lt;b&gt;A&lt;/b&gt; &amp; Co.</p>',
    );
  });
  it('★★ one expiry formatter for the /s/ page and the email', async () => {
    const { planShareExpiryDate, planShareExpiryNote } = await import('../lib/planShare');
    expect(planShareExpiryDate('2026-11-06T17:00:00Z')).toBe('Nov 06, 2026');
    expect(planShareExpiryNote('2026-11-06T17:00:00Z')).toBe('This link works until Nov 06, 2026 and needs no login.');
    expect(planShareExpiryDate(null)).toBe('');
  });
});
