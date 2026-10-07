import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BRIDGE_SENDER,
  ENV_CLIENT_SECRET,
  MS_CLIENT_ID,
  MS_SENDMAIL_URL,
  MS_TENANT_ID,
  MS_TOKEN_URL,
  UNMONITORED_FOOTER,
} from '../../supabase/functions/_shared/msGraphConfig';
import {
  __graphTokenCacheState,
  __resetGraphTokenCache,
  base64Utf8,
  buildMimeMessage,
  getGraphToken,
  redactSubject,
  sendGraphMail,
  type GraphDeps,
  type SendMailInput,
} from '../../supabase/functions/_shared/graphMail';
import {
  parseWebhookSecret,
  timingSafeEqual,
  verifyStandardWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
} from '../../supabase/functions/_shared/standardWebhooks';
import {
  codeFor,
  handleSendEmail,
  recipientFor,
  renderAuthEmail,
  type Deps,
  type OutboxRow,
  type SendEmailHookPayload,
} from '../../supabase/functions/auth-send-email/handler';

// ===========================================================================
// ★★★ fix-628 (P-092) — the Bridge sends its own email, from bridge@
// ===========================================================================
//
// Every email the Bridge sends today goes through Supabase's demo sender and
// almost never arrives, so a password reset never lands. Lucas was locked out on
// 2026-10-06 and had to be let back in by hand in the SQL editor.
//
// ★★★ §0, MEASURED READ-ONLY ON PROD 2026-10-07: `recovery` is the ONLY auth
//     email this project has ever sent. FOUR users have a `recovery_sent_at`
//     (newest 2026-10-06 17:42:14Z) — and that column keeps only the latest per
//     user, so four is a FLOOR on the emails rather than a count of them.
//     0 invites, 0 confirmations, 0 email changes, and all 37 users are already
//     `email_confirmed` because `admin-create-user` passes `email_confirm: true`
//     precisely BECAUSE no confirmation mail could arrive. Once the hook is on,
//     though, EVERY type routes here — so every type is rendered and tested.
//
// ★ These handlers are deliberately free of Deno, of `fetch` and of the Supabase
//   client (the fix-436 split), which is what lets CI drive every branch.

// ---------------------------------------------------------------------------
// §B — the shared Graph sender
// ---------------------------------------------------------------------------

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function graphDeps(over: Partial<GraphDeps> = {}): GraphDeps {
  return {
    fetch: vi.fn(),
    now: () => 1_000_000,
    clientSecret: 'a-fake-secret-for-tests',
    ...over,
  };
}

beforeEach(() => {
  __resetGraphTokenCache();
});

describe('fix-628 §B — the token, and its cache', () => {
  it('★★★ a MISSING secret fails loudly and never reaches the network', async () => {
    // §B's rule: "a missing env var must fail loudly, never send silently."
    // Sending nothing and returning ok is the behaviour that let P-092 live.
    const f = vi.fn();
    await expect(
      getGraphToken(graphDeps({ clientSecret: undefined, fetch: f as never })),
    ).rejects.toThrow(new RegExp(ENV_CLIENT_SECRET));
    await expect(
      getGraphToken(graphDeps({ clientSecret: '   ', fetch: f as never })),
    ).rejects.toThrow(/is not set/);
    expect(f).not.toHaveBeenCalled();
  });

  it('asks the right endpoint with client_credentials and the .default scope', async () => {
    const f = vi.fn().mockResolvedValue(
      tokenResponse({ access_token: 'tok-1', expires_in: 3600 }),
    );
    const token = await getGraphToken(graphDeps({ fetch: f as never }));
    expect(token).toBe('tok-1');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MS_TOKEN_URL);
    expect(url).toContain(MS_TENANT_ID);
    const body = String(init.body);
    expect(body).toContain(`client_id=${MS_CLIENT_ID}`);
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
  });

  it('★★ caches the token — a second call makes no request', async () => {
    const f = vi.fn().mockResolvedValue(
      tokenResponse({ access_token: 'tok-1', expires_in: 3600 }),
    );
    const deps = graphDeps({ fetch: f as never });
    await getGraphToken(deps);
    expect(__graphTokenCacheState().cached).toBe(true);
    await getGraphToken(deps);
    await getGraphToken(deps);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('★★★ re-asks shortly BEFORE expiry, not after', async () => {
    // A token used at the instant it expires fails the send, and the person on
    // the other end is locked out of their account. The margin is the point.
    const f = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: 'tok-1', expires_in: 120 }))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'tok-2', expires_in: 120 }));
    let clock = 1_000_000;
    const deps = graphDeps({ fetch: f as never, now: () => clock });
    expect(await getGraphToken(deps)).toBe('tok-1');
    // 59s later: still inside the 120s life AND inside the 60s margin → reused
    clock += 59_000;
    expect(await getGraphToken(deps)).toBe('tok-1');
    // 61s in: inside the token's life but INSIDE the margin → refreshed early
    clock += 2_000;
    expect(await getGraphToken(deps)).toBe('tok-2');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('★ a response with no expires_in is treated as SHORT-lived', async () => {
    // Guessing high means sending with a dead token later.
    // ★ a FRESH Response per call — a Response body can only be read once, so a
    //   single mockResolvedValue would fail on the second fetch for a reason that
    //   has nothing to do with the cache.
    const f = vi.fn(async () => tokenResponse({ access_token: 'tok-1' }));
    let clock = 0;
    const deps = graphDeps({ fetch: f as never, now: () => clock });
    await getGraphToken(deps);
    clock += 241_000; // past 300s - 60s margin
    await getGraphToken(deps);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('★★★ names each Microsoft failure instead of saying "could not send"', async () => {
    const cases: [string, RegExp][] = [
      ['AADSTS7000222: The provided client secret keys are expired', /EXPIRED \(AADSTS7000222\)/],
      ['AADSTS7000215: Invalid client secret provided', /INVALID \(AADSTS7000215\)/],
      ['AADSTS700016: Application not found in the directory', /app registration was not found/],
    ];
    for (const [body, expected] of cases) {
      __resetGraphTokenCache();
      const f = vi.fn().mockResolvedValue(new Response(body, { status: 401 }));
      await expect(getGraphToken(graphDeps({ fetch: f as never }))).rejects.toThrow(expected);
    }
  });

  it('a non-JSON token response says so rather than throwing a parse error', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));
    await expect(getGraphToken(graphDeps({ fetch: f as never }))).rejects.toThrow(
      /is not\s*\n?\s*JSON|not JSON/,
    );
  });
});

describe('fix-628 §B — the sendMail request', () => {
  const INPUT: SendMailInput = {
    to: 'robertd@blueprintcap.com',
    subject: 'Your Bridge reset code: 123456',
    html: '<p>hello</p>',
    text: 'hello',
  };

  function okFetch() {
    return vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(
        new Response('', { status: 202, headers: { 'request-id': 'req-abc' } }),
      );
  }

  it('★★★ posts base64 MIME to the ONE permitted mailbox, with the bearer token', async () => {
    const f = okFetch();
    const res = await sendGraphMail(graphDeps({ fetch: f as never }), INPUT, 'seed');
    expect(res).toEqual({ ok: true, requestId: 'req-abc' });
    const [url, init] = f.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(MS_SENDMAIL_URL);
    expect(url).toContain(BRIDGE_SENDER);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    // ★ Graph's MIME mode. `application/json` would make it expect the `message`
    //   object and reject this body.
    expect((init.headers as Record<string, string>)['content-type']).toBe('text/plain');
    // the body is base64 of a MIME document
    const mime = Buffer.from(String(init.body), 'base64').toString('utf8');
    expect(mime).toContain('multipart/alternative');
  });

  it('★★★ carries BOTH text and html — Graph\'s JSON body cannot, which is why MIME', async () => {
    const mime = buildMimeMessage(INPUT, 'seed');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="alt_seed"');
    expect(mime).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(mime).toContain('Content-Type: text/html; charset="utf-8"');
    // both bodies present, base64
    expect(mime).toContain(base64Utf8('hello'));
    expect(mime).toContain(base64Utf8('<p>hello</p>'));
    expect(mime).toContain(`From: Blueprint Bridge <${BRIDGE_SENDER}>`);
    expect(mime).toContain('To: robertd@blueprintcap.com');
  });

  it('★★ cc and replyTo appear as headers — later tickets need them', async () => {
    const mime = buildMimeMessage(
      { ...INPUT, cc: ['owner@blueprintcap.com'], replyTo: 'owner@blueprintcap.com' },
      'seed',
    );
    expect(mime).toContain('Cc: owner@blueprintcap.com');
    expect(mime).toContain('Reply-To: owner@blueprintcap.com');
  });

  it('★★ an attachment wraps the alternative in multipart/mixed', async () => {
    const mime = buildMimeMessage(
      {
        ...INPUT,
        attachments: [
          { name: 'set.pdf', contentType: 'application/pdf', contentBase64: 'QUJD' },
        ],
      },
      'seed',
    );
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="mix_seed"');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="alt_seed"');
    expect(mime).toContain('Content-Disposition: attachment; filename="set.pdf"');
    expect(mime).toContain('--mix_seed--');
  });

  it('★ a non-ASCII subject is RFC 2047 encoded', () => {
    const mime = buildMimeMessage({ ...INPUT, subject: 'Rés umé' }, 'seed');
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).not.toContain('Subject: Rés umé');
  });

  it('★★★ classifies a Graph 403 as consent / access-policy, not "failed"', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('ErrorAccessDenied', { status: 403 }));
    const res = await sendGraphMail(graphDeps({ fetch: f as never }), INPUT);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error).toMatch(/403/);
    expect(res.error).toMatch(/admin consent|ApplicationAccessPolicy/);
    expect(res.error).toContain(BRIDGE_SENDER);
  });

  it('classifies 401, 413, 429 and 5xx distinctly', async () => {
    for (const [status, pattern] of [
      [401, /401 for a token it had just issued/],
      [413, /too large/],
      [429, /throttled/],
      [503, /server error 503/],
    ] as [number, RegExp][]) {
      __resetGraphTokenCache();
      const f = vi
        .fn()
        .mockResolvedValueOnce(tokenResponse({ access_token: 'tok', expires_in: 3600 }))
        .mockResolvedValueOnce(new Response('x', { status }));
      const res = await sendGraphMail(graphDeps({ fetch: f as never }), INPUT);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(pattern);
    }
  });

  it('★★ never THROWS on a send failure — the caller always has a row to write', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const res = await sendGraphMail(graphDeps({ fetch: f as never }), INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/EXPIRED|INVALID|ECONNRESET|Microsoft/);
  });

  it('refuses an empty recipient before asking for a token', async () => {
    const f = vi.fn();
    const res = await sendGraphMail(graphDeps({ fetch: f as never }), { ...INPUT, to: '  ' });
    expect(res).toEqual({ ok: false, error: 'No recipient address.', requestId: null });
    expect(f).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The redaction — where the brief's two requirements collided
// ---------------------------------------------------------------------------
describe('fix-628 §A — the subject is stored redacted', () => {
  it('★★★ the recovery subject loses its code', () => {
    expect(redactSubject('Your Bridge reset code: 123456')).toBe(
      'Your Bridge reset code: ••••••',
    );
    // ★ and the result carries no digits at all, which is what the table's CHECK
    //   constraint (`subject !~ '[0-9]{6}'`) is there to enforce independently.
    expect(/\d{6}/.test(redactSubject('Your Bridge reset code: 123456'))).toBe(false);
  });

  it('★★ masks a longer token too — the bar is not set to today\'s length', () => {
    expect(redactSubject('code 98765432')).toBe('code ••••••••');
    expect(/\d{4,}/.test(redactSubject('code 98765432'))).toBe(false);
  });

  it('★ leaves short numbers alone, and masks a bare year deliberately', () => {
    expect(redactSubject('Bridge 12 of 99')).toBe('Bridge 12 of 99');
    expect(redactSubject('Q4 2026 plan')).toBe('Q4 •••• plan');
  });
});

// ---------------------------------------------------------------------------
// §C — the signature
// ---------------------------------------------------------------------------

async function signPayload(secretB64: string, id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    parseWebhookSecret(secretB64) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${ts}.${body}`) as unknown as ArrayBuffer,
  );
  return Buffer.from(new Uint8Array(mac)).toString('base64');
}

const SECRET = `v1,whsec_${Buffer.from('a-test-signing-key').toString('base64')}`;

describe('fix-628 §C — the Standard Webhooks signature is the authentication', () => {
  const BODY = '{"hello":"world"}';
  const ID = 'msg_1';
  const NOW = 1_760_000_000;

  it('★★★ accepts a correctly signed request', async () => {
    const sig = await signPayload(SECRET, ID, String(NOW), BODY);
    const r = await verifyStandardWebhook({
      rawBody: BODY,
      headers: { id: ID, timestamp: String(NOW), signature: `v1,${sig}` },
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: true });
  });

  it('★★ tolerates the bare and the v1-prefixed secret forms', async () => {
    const bare = SECRET.replace('v1,', '');
    const sig = await signPayload(bare, ID, String(NOW), BODY);
    for (const s of [SECRET, bare]) {
      const r = await verifyStandardWebhook({
        rawBody: BODY,
        headers: { id: ID, timestamp: String(NOW), signature: `v1,${sig}` },
        secret: s,
        nowSeconds: NOW,
      });
      expect(r.ok).toBe(true);
    }
  });

  it('★★ accepts one of SEVERAL offered signatures — that is what rotation needs', async () => {
    const sig = await signPayload(SECRET, ID, String(NOW), BODY);
    const r = await verifyStandardWebhook({
      rawBody: BODY,
      headers: { id: ID, timestamp: String(NOW), signature: `v1,AAAA v1,${sig}` },
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('★★★ rejects a tampered body, a wrong secret and a bad signature', async () => {
    const sig = await signPayload(SECRET, ID, String(NOW), BODY);
    const base = {
      headers: { id: ID, timestamp: String(NOW), signature: `v1,${sig}` },
      secret: SECRET,
      nowSeconds: NOW,
    };
    expect((await verifyStandardWebhook({ ...base, rawBody: '{"hello":"mars"}' })).ok).toBe(false);
    expect(
      (await verifyStandardWebhook({
        ...base,
        rawBody: BODY,
        secret: `v1,whsec_${Buffer.from('other-key').toString('base64')}`,
      })).ok,
    ).toBe(false);
    expect(
      (await verifyStandardWebhook({
        ...base,
        rawBody: BODY,
        headers: { ...base.headers, signature: 'v1,notasignature' },
      })).ok,
    ).toBe(false);
  });

  it('★★★ a MISSING secret is a refusal, never a pass', async () => {
    // Falling through to "send" with no secret configured would make this a
    // public open relay with Blueprint's DKIM on it.
    const r = await verifyStandardWebhook({
      rawBody: BODY,
      headers: { id: ID, timestamp: String(NOW), signature: 'v1,x' },
      secret: undefined,
      nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'SEND_EMAIL_HOOK_SECRET is not set' });
  });

  it('★★ rejects a replay outside the tolerance window', async () => {
    const old = NOW - WEBHOOK_TOLERANCE_SECONDS - 1;
    const sig = await signPayload(SECRET, ID, String(old), BODY);
    const r = await verifyStandardWebhook({
      rawBody: BODY,
      headers: { id: ID, timestamp: String(old), signature: `v1,${sig}` },
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'webhook-timestamp outside the tolerance window' });
  });

  it('rejects missing headers and a non-numeric timestamp', async () => {
    const base = { rawBody: BODY, secret: SECRET, nowSeconds: NOW };
    expect(
      (await verifyStandardWebhook({ ...base, headers: { id: null, timestamp: '1', signature: 'v1,x' } })).ok,
    ).toBe(false);
    expect(
      (await verifyStandardWebhook({ ...base, headers: { id: ID, timestamp: 'soon', signature: 'v1,x' } })),
    ).toEqual({ ok: false, reason: 'webhook-timestamp is not a number' });
  });

  it('★ timingSafeEqual is length-safe and value-correct', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C — rendering and the handler
// ---------------------------------------------------------------------------

describe('fix-628 §C — what each email says', () => {
  it('★★★ recovery keeps fix-426\'s live wording, and adds the footer', () => {
    const r = renderAuthEmail('recovery', '123456');
    expect(r.subject).toBe('Your Bridge reset code: 123456');
    expect(r.html).toContain('Enter this code in the Bridge to reset your password:');
    expect(r.html).toContain("If you didn't request a password reset, you can ignore this email.");
    expect(r.html).toContain('123456');
    // the code large and letter-spaced, as the live template has it
    expect(r.html).toMatch(/font-size:32px/);
    expect(r.html).toMatch(/letter-spacing:8px/);
    // ⚖️ Bobby 2026-09-11: it must say the mailbox isn't monitored
    expect(r.html).toContain(UNMONITORED_FOOTER);
    expect(r.text).toContain('Enter this code in the Bridge to reset your password:');
    expect(r.text).toContain('123456');
    expect(r.text).toContain(UNMONITORED_FOOTER);
  });

  it('★★ every action type renders a usable, code-bearing email', () => {
    for (const t of [
      'recovery', 'signup', 'invite', 'magiclink',
      'email_change', 'email_change_new', 'reauthentication',
      'some_type_supabase_adds_in_2027',
    ]) {
      const r = renderAuthEmail(t, '654321');
      expect(r.subject, t).toContain('654321');
      expect(r.html, t).toContain('654321');
      expect(r.text, t).toContain('654321');
      expect(r.html, t).toContain(UNMONITORED_FOOTER);
      expect(r.text, t).toContain(UNMONITORED_FOOTER);
    }
  });

  it('★ html-escapes the code rather than interpolating it raw', () => {
    const r = renderAuthEmail('recovery', '<script>x</script>');
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
  });
});

describe('fix-628 §C — email_change: the token-naming trap the docs warn about', () => {
  function payload(type: string): SendEmailHookPayload {
    return {
      user: { email: 'old@blueprintcap.com', new_email: 'new@blueprintcap.com' },
      email_data: {
        email_action_type: type,
        token: 'OLD111',
        token_hash: 'h-old',
        token_new: 'NEW222',
        token_hash_new: 'h-new',
      },
    };
  }

  it('★★★ email_change_new uses token_new and the NEW address', () => {
    // Using `token` there would mail the new address a code that only works for
    // the old one, and the person would be told their code is wrong.
    expect(codeFor(payload('email_change_new'))).toBe('NEW222');
    expect(recipientFor(payload('email_change_new'))).toBe('new@blueprintcap.com');
  });

  it('★★ email_change uses token and the OLD address', () => {
    expect(codeFor(payload('email_change'))).toBe('OLD111');
    expect(recipientFor(payload('email_change'))).toBe('old@blueprintcap.com');
  });

  it('★ falls back to token when token_new is absent', () => {
    const p = payload('email_change_new');
    p.email_data!.token_new = null;
    expect(codeFor(p)).toBe('OLD111');
  });

  it('recovery uses token and the account address', () => {
    expect(codeFor(payload('recovery'))).toBe('OLD111');
    expect(recipientFor(payload('recovery'))).toBe('old@blueprintcap.com');
  });
});

describe('fix-628 §C — the handler', () => {
  const NOW = 1_760_000_000;

  function recoveryPayload(over: Record<string, unknown> = {}) {
    return JSON.stringify({
      user: { email: 'robertd@blueprintcap.com' },
      email_data: { email_action_type: 'recovery', token: '123456', ...over },
    });
  }

  function mkDeps(over: Partial<Deps> = {}) {
    const rows: OutboxRow[] = [];
    const sent: SendMailInput[] = [];
    const deps: Deps = {
      sendMail: async (input) => {
        sent.push(input);
        return { ok: true, requestId: 'req-1' };
      },
      recordOutbox: async (row) => {
        rows.push(row);
      },
      hookSecret: SECRET,
      nowSeconds: () => NOW,
      ...over,
    };
    return { deps, rows, sent };
  }

  async function signedReq(body: string) {
    const id = 'msg_1';
    const ts = String(NOW);
    const sig = await signPayload(SECRET, id, ts, body);
    return { rawBody: body, headers: { id, timestamp: ts, signature: `v1,${sig}` } };
  }

  it('★★★ a BAD signature is 401 and NOTHING is sent or recorded', async () => {
    const { deps, rows, sent } = mkDeps();
    const res = await handleSendEmail(deps, {
      rawBody: recoveryPayload(),
      headers: { id: 'msg_1', timestamp: String(NOW), signature: 'v1,wrong' },
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { http_code: 401 } });
    expect(sent).toHaveLength(0);
    // ★★ and no row: an outbox row here would let anybody on the internet write
    //    to our table by posting junk.
    expect(rows).toHaveLength(0);
  });

  it('★★★ recovery: right recipient, right subject, and the outbox row has NO token', async () => {
    const { deps, rows, sent } = mkDeps();
    const res = await handleSendEmail(deps, await signedReq(recoveryPayload()));
    expect(res).toEqual({ status: 200, body: {} });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('robertd@blueprintcap.com');
    expect(sent[0].subject).toBe('Your Bridge reset code: 123456');
    expect(sent[0].text).toContain('123456');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'auth:recovery',
      to_email: 'robertd@blueprintcap.com',
      status: 'sent',
      error: null,
      graph_request_id: 'req-1',
      attempts: 1,
    });
    // ★★★ THE ROW CARRIES NO CODE, anywhere in it.
    expect(JSON.stringify(rows[0])).not.toContain('123456');
    expect(rows[0].subject).toBe('Your Bridge reset code: ••••••');
  });

  it('★★★ a Graph failure is a non-200 AND a failed row', async () => {
    const { deps, rows } = mkDeps({
      sendMail: async () => ({ ok: false, error: 'Graph said 403', requestId: 'req-9' }),
    });
    const res = await handleSendEmail(deps, await signedReq(recoveryPayload()));
    // Returning 200 here would reproduce P-092: the app says "check your email",
    // nothing comes, and nobody finds out for a day.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { http_code: 500, message: 'Graph said 403' } });
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: 'Graph said 403',
      graph_request_id: 'req-9',
    });
  });

  it('★★★ NEVER sends an email with a blank code', async () => {
    const { deps, rows, sent } = mkDeps();
    const res = await handleSendEmail(deps, await signedReq(recoveryPayload({ token: '' })));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
    // ★ but it IS recorded, because a reset that produced no email is exactly the
    //   thing somebody will come asking about.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', subject: null });
    expect(rows[0].error).toMatch(/carried no token/);
  });

  it('refuses a payload with no recipient, and a body that is not JSON', async () => {
    const { deps, sent } = mkDeps();
    const noTo = await signedReq(
      JSON.stringify({ user: {}, email_data: { email_action_type: 'recovery', token: '1' } }),
    );
    expect((await handleSendEmail(deps, noTo)).status).toBe(400);
    const notJson = await signedReq('not json');
    expect((await handleSendEmail(deps, notJson)).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('★★ an unknown action type still sends, and is namespaced in the outbox', async () => {
    const { deps, rows, sent } = mkDeps();
    const body = JSON.stringify({
      user: { email: 'x@blueprintcap.com' },
      email_data: { email_action_type: 'brand_new_type', token: '424242' },
    });
    const res = await handleSendEmail(deps, await signedReq(body));
    expect(res.status).toBe(200);
    expect(sent[0].subject).toBe('Your Bridge code: 424242');
    expect(rows[0].kind).toBe('auth:brand_new_type');
    expect(rows[0].subject).toBe('Your Bridge code: ••••••');
  });
});

// ---------------------------------------------------------------------------
// The wiring, and the things that must stay true of the repo
// ---------------------------------------------------------------------------
describe('fix-628 — the deploy shape and the secret discipline', () => {
  const ROOT = resolve(__dirname, '../..');
  const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

  // ★★★ THE GRAVESTONE TRAP, ELEVENTH RECORDING IN THIS REPO. These files are
  //     heavily commented, and several comments NAME the very thing they warn
  //     against — index.ts explains in prose why `await req.json()` would be
  //     wrong. A negative assertion over the raw text would therefore fail on the
  //     comment, and a positive one would stay green over a deleted line. So
  //     every assertion about BEHAVIOUR below reads `code()`, comments stripped.
  const code = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
  const codeOf = (p: string) => code(read(p));
  const sqlCodeOf = (p: string) =>
    read(p)
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');

  it('★★★ NO SECRET VALUE IS IN THE REPOSITORY — only the env var NAMES', () => {
    for (const f of [
      'supabase/functions/_shared/msGraphConfig.ts',
      'supabase/functions/_shared/graphMail.ts',
      'supabase/functions/_shared/standardWebhooks.ts',
      'supabase/functions/auth-send-email/handler.ts',
      'supabase/functions/auth-send-email/index.ts',
      'migrations/fix_628_email_outbox.sql',
    ]) {
      const src = read(f);
      // the two secrets are only ever read from the environment
      expect(src, f).not.toMatch(/whsec_[A-Za-z0-9+/=]{10,}/);
      // an Entra client secret looks like a 30+ char high-entropy string with
      // the ~ or . that Microsoft's generator uses; assert none is present
      expect(src, f).not.toMatch(/client_secret\s*[:=]\s*['"][^'"]{8,}['"]/);
    }
  });

  it('★★ the IDs IT gave us are the ones in the config', () => {
    expect(MS_TENANT_ID).toBe('6db456fa-8448-4c61-bb16-2a343232044c');
    expect(MS_CLIENT_ID).toBe('0d35e1bc-cdf7-449b-a822-217dff8967d5');
    expect(BRIDGE_SENDER).toBe('bridge@blueprintcap.com');
  });

  it('★★★ index.ts records the --no-verify-jwt requirement and why', () => {
    // Deployed with verify_jwt ON, Auth's unauthenticated call is rejected with a
    // 401 before the function runs — and the symptom is "resets still do not
    // arrive", which is indistinguishable from the bug being fixed.
    // ★ These first two ARE doc assertions, on the raw text, deliberately: the
    //   flag is not expressible in code — it lives in a deploy command — so the
    //   comment IS the artefact being pinned.
    const idx = read('supabase/functions/auth-send-email/index.ts');
    expect(idx).toContain('--no-verify-jwt');
    expect(idx).toMatch(/an-edge-function-ships-only-when-redeployed/);
    // ★★ These two are behaviour, so they read the code: index.ts's own comment
    //    explains why `await req.json()` would be wrong, and would satisfy a raw
    //    negative match merely by discussing it.
    const idxCode = codeOf('supabase/functions/auth-send-email/index.ts');
    expect(idxCode).toMatch(/await req\.text\(\)/);
    expect(idxCode).not.toMatch(/await req\.json\(\)/);
  });

  it('★★ the handler is free of Deno, fetch and the Supabase client (fix-436 split)', () => {
    for (const f of [
      'supabase/functions/auth-send-email/handler.ts',
      'supabase/functions/_shared/graphMail.ts',
      'supabase/functions/_shared/standardWebhooks.ts',
    ]) {
      const src = codeOf(f);
      expect(src, f).not.toMatch(/\bDeno\./);
      expect(src, f).not.toMatch(/createClient/);
    }
    // ★ graphMail takes `fetch` through Deps and never reaches for the global
    const gm = codeOf('supabase/functions/_shared/graphMail.ts');
    expect(gm).toMatch(/deps\.fetch\(/);
  });

  it('★★★ the migration writes no data and keeps anon out', () => {
    const sql = sqlCodeOf('migrations/fix_628_email_outbox.sql');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.email_outbox/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FOR ALL TO service_role/);
    // no anon, no authenticated policy — the table is unreadable with a user JWT
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*TO authenticated/);
    // fix-157: `FROM public, anon`, never `FROM anon` alone
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.email_outbox FROM public, anon, authenticated;/);
    // the admin read path is gated in the body, because definer bypasses RLS
    expect(sql).toMatch(/bp_is_admin_anywhere\(\)/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bp_email_outbox_recent\(integer\) TO authenticated;/);
    // and the redaction guard
    expect(sql).toMatch(/subject !~ '\[0-9\]\{6\}'/);
    // no DML at all
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\./);
  });
});
