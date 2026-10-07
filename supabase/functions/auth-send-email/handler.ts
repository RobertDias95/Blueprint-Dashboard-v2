import { UNMONITORED_FOOTER } from '../_shared/msGraphConfig.ts';
import { redactSubject, type SendMailInput, type SendMailResult } from '../_shared/graphMail.ts';
import { verifyStandardWebhook } from '../_shared/standardWebhooks.ts';

// ===========================================================================
// ★★★ fix-628 §C (P-092) — THE SEND EMAIL HOOK
// ===========================================================================
//
// Supabase Auth hands every auth email to this function instead of sending it
// itself; we render it and send it through Graph as bridge@. A 200 with an empty
// JSON body means sent. A non-200 with `{ error: { http_code, message } }` makes
// Auth REPORT the failure instead of telling the person their mail is on its way.
//
// ★★★ WHICH IS THE WHOLE POINT, AND THE REASON P-092 LASTED SO LONG. Supabase's
//     demo sender accepted everything and delivered almost nothing, so the app
//     said "check your email" and was wrong, silently, for months. Lucas was
//     locked out on 2026-10-06 and had to be let back in by hand. This function
//     either sends or says it didn't, in two places: the HTTP status Auth sees,
//     and a row in `email_outbox` a human can read later.
//
// ★★★ DELIBERATELY FREE OF DENO AND OF A REAL `fetch` — the fix-436 split that
//     `plan-share/handler.ts` keeps. CI has no Deno and no network, so every
//     branch below (bad signature, each action type, a Graph failure) is driven
//     through `Deps` in `src/__tests__/BridgeSendsEmailFix628.test.ts`.

/** The hook payload. ★ Field names are Supabase's, not ours — see the §0 note in
 *  the test about `token_new` / `token_hash_new` for `email_change`. */
export interface SendEmailHookPayload {
  user?: { email?: string | null; new_email?: string | null } | null;
  email_data?: {
    token?: string | null;
    token_hash?: string | null;
    redirect_to?: string | null;
    email_action_type?: string | null;
    site_url?: string | null;
    token_new?: string | null;
    token_hash_new?: string | null;
  } | null;
}

export interface OutboxRow {
  kind: string;
  to_email: string;
  subject: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  graph_request_id: string | null;
  attempts: number;
}

export interface Deps {
  sendMail: (input: SendMailInput) => Promise<SendMailResult>;
  /** ★ Writing the row must never be able to fail the send that already
   *  happened, so the caller swallows its own errors and reports them here. */
  recordOutbox: (row: OutboxRow) => Promise<void>;
  hookSecret: string | undefined;
  nowSeconds: () => number;
}

export interface HookRequest {
  rawBody: string;
  headers: { id: string | null; timestamp: string | null; signature: string | null };
}

export interface HookResponse {
  status: number;
  body: unknown;
}

/** ★ The documented failure shape. Auth surfaces `message`, so it is written for
 *  the person who will read it in the dashboard, not for a log parser. */
function errorResponse(httpCode: number, message: string): HookResponse {
  return { status: httpCode, body: { error: { http_code: httpCode, message } } };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ★★ The code, big and letter-spaced — fix-426's live template wording, kept
 *  because people have already been told what the email looks like. */
function codeBlockHtml(code: string): string {
  return (
    '<p style="font-size:32px;font-weight:700;letter-spacing:8px;' +
    `margin:24px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(code)}</p>`
  );
}

function shell(innerHtml: string): string {
  return (
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:15px;line-height:1.5;color:#111">' +
    innerHtml +
    `<p style="font-size:12px;color:#666;margin-top:32px">${escapeHtml(UNMONITORED_FOOTER)}</p>` +
    '</div>'
  );
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * ★★★ EVERY `email_action_type` AUTH CAN SEND, because once the hook is on ALL of
 *     them come here and a type we did not think about must not produce a blank
 *     email. §0 measured which are live on this project: `recovery` only (4
 *     users have one recorded, newest 2026-10-06; 0 invites, 0 confirmations, 0
 *     email changes, and all 37 users already confirmed because
 *     `admin-create-user` sets `email_confirm: true`). The rest are built anyway
 *     — the cost of being wrong is somebody locked out.
 */
export function renderAuthEmail(type: string, code: string): RenderedEmail {
  switch (type) {
    // ★★★ THE ONE THAT MATTERS TODAY. Wording is the live Supabase template's,
    //     which fix-426 wrote and people have already been shown.
    case 'recovery':
      return {
        subject: `Your Bridge reset code: ${code}`,
        html: shell(
          '<p>Enter this code in the Bridge to reset your password:</p>' +
            codeBlockHtml(code) +
            "<p>If you didn't request a password reset, you can ignore this email.</p>",
        ),
        text:
          'Enter this code in the Bridge to reset your password:\n\n' +
          `${code}\n\n` +
          "If you didn't request a password reset, you can ignore this email.\n\n" +
          UNMONITORED_FOOTER,
      };

    case 'signup':
      return {
        subject: `Your Bridge confirmation code: ${code}`,
        html: shell(
          '<p>Enter this code in the Bridge to confirm your email address:</p>' +
            codeBlockHtml(code),
        ),
        text:
          'Enter this code in the Bridge to confirm your email address:\n\n' +
          `${code}\n\n${UNMONITORED_FOOTER}`,
      };

    case 'invite':
      return {
        subject: `Your Bridge invitation code: ${code}`,
        html: shell(
          '<p>You have been invited to the Bridge. Enter this code to get started:</p>' +
            codeBlockHtml(code),
        ),
        text:
          'You have been invited to the Bridge. Enter this code to get started:\n\n' +
          `${code}\n\n${UNMONITORED_FOOTER}`,
      };

    case 'magiclink':
      return {
        subject: `Your Bridge sign-in code: ${code}`,
        html: shell(
          '<p>Enter this code in the Bridge to sign in:</p>' + codeBlockHtml(code),
        ),
        text: `Enter this code in the Bridge to sign in:\n\n${code}\n\n${UNMONITORED_FOOTER}`,
      };

    // ★★ `email_change` and `email_change_new` share wording but NOT the token —
    //    see `codeFor` below, which is where the docs' warning actually bites.
    case 'email_change':
    case 'email_change_new':
      return {
        subject: `Your Bridge email-change code: ${code}`,
        html: shell(
          '<p>Enter this code in the Bridge to confirm your new email address:</p>' +
            codeBlockHtml(code),
        ),
        text:
          'Enter this code in the Bridge to confirm your new email address:\n\n' +
          `${code}\n\n${UNMONITORED_FOOTER}`,
      };

    case 'reauthentication':
      return {
        subject: `Your Bridge confirmation code: ${code}`,
        html: shell(
          '<p>Enter this code in the Bridge to confirm it is you:</p>' + codeBlockHtml(code),
        ),
        text: `Enter this code in the Bridge to confirm it is you:\n\n${code}\n\n${UNMONITORED_FOOTER}`,
      };

    // ★★★ A TYPE WE HAVE NEVER SEEN STILL GETS A USABLE EMAIL. Auth may add one;
    //     the person on the other end should get their code, not silence.
    default:
      return {
        subject: `Your Bridge code: ${code}`,
        html: shell('<p>Enter this code in the Bridge:</p>' + codeBlockHtml(code)),
        text: `Enter this code in the Bridge:\n\n${code}\n\n${UNMONITORED_FOOTER}`,
      };
  }
}

/**
 * ★★★ THE `email_change` NAMING TRAP, which the Supabase docs warn about and
 *     which is easy to get backwards.
 *
 * For an email change Auth sends TWO emails. `token` / `token_hash` belong to the
 * OLD address; `token_new` / `token_hash_new` belong to the NEW one. The
 * `email_change_new` email goes to the new address and must therefore carry
 * `token_new` — using `token` there would mail the new address a code that only
 * works for the old one, and the person would be told their code is wrong.
 */
export function codeFor(payload: SendEmailHookPayload): string | null {
  const d = payload.email_data ?? {};
  const type = d.email_action_type ?? '';
  const chosen = type === 'email_change_new' ? d.token_new ?? d.token : d.token;
  const code = (chosen ?? '').trim();
  return code === '' ? null : code;
}

/** Who the email goes to. ★ `email_change_new` is addressed to the NEW address,
 *  for the same reason it carries the new token. */
export function recipientFor(payload: SendEmailHookPayload): string | null {
  const type = payload.email_data?.email_action_type ?? '';
  const u = payload.user ?? {};
  const chosen = type === 'email_change_new' ? u.new_email ?? u.email : u.email;
  const to = (chosen ?? '').trim();
  return to === '' ? null : to;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export async function handleSendEmail(
  deps: Deps,
  req: HookRequest,
): Promise<HookResponse> {
  // ★★★ SIGNATURE FIRST, BEFORE THE BODY IS EVEN PARSED. This endpoint runs
  //     `--no-verify-jwt`, so the signature is the ONLY authentication. Parsing
  //     first would mean an unsigned caller could steer the code paths below.
  const verdict = await verifyStandardWebhook({
    rawBody: req.rawBody,
    headers: req.headers,
    secret: deps.hookSecret,
    nowSeconds: deps.nowSeconds(),
  });
  if (!verdict.ok) {
    // ★★ 401 and NOTHING SENT, NOTHING RECORDED. An outbox row here would let
    //    anybody on the internet write to our table by posting junk.
    return errorResponse(401, `Unauthorized: ${verdict.reason}`);
  }

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(req.rawBody) as SendEmailHookPayload;
  } catch {
    return errorResponse(400, 'Body is not JSON.');
  }

  const type = (payload.email_data?.email_action_type ?? '').trim() || 'unknown';
  const kind = `auth:${type}`;
  const to = recipientFor(payload);
  const code = codeFor(payload);

  if (!to) {
    return errorResponse(400, `No recipient address in the ${kind} payload.`);
  }

  // ★★★ NEVER SEND AN EMAIL WITH A BLANK CODE. §C's rule, and it is the kindest
  //     possible failure: an email containing an empty box teaches somebody the
  //     Bridge is broken and gives them nothing to do about it, whereas a
  //     reported failure makes them ask and get helped.
  if (!code) {
    const error = `The ${kind} payload carried no token, so no code could be sent.`;
    await deps.recordOutbox({
      kind, to_email: to, subject: null, status: 'failed',
      error, graph_request_id: null, attempts: 1,
    });
    return errorResponse(400, error);
  }

  const rendered = renderAuthEmail(type, code);
  const result = await deps.sendMail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  // ★★★ THE SUBJECT IS REDACTED ON THE WAY TO THE TABLE, never on the way to the
  //     inbox. `redactSubject` is in the shared module with its own test, and the
  //     table carries a CHECK constraint saying the same thing — so forgetting
  //     this line fails the insert instead of storing a live reset code.
  await deps.recordOutbox({
    kind,
    to_email: to,
    subject: redactSubject(rendered.subject),
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
    graph_request_id: result.requestId,
    attempts: 1,
  });

  if (!result.ok) {
    // ★★ 500, so Auth tells the person it failed. Returning 200 here would
    //    reproduce P-092 exactly: the app says "check your email", nothing comes,
    //    and nobody finds out for a day.
    return errorResponse(500, result.error);
  }

  // ★ 200 with an EMPTY JSON object is the documented "sent" answer.
  return { status: 200, body: {} };
}
