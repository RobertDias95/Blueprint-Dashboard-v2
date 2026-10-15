// ===========================================================================
// ★★★ fix-670 §C (P-351) — the welcome email
// ===========================================================================
//
// Bobby: *"its a nice welcoming, a link to the bridge, and maybe some high
// level info and guiding to how to navigate etc."* The copy is his, approved
// 2026-10-14 (revision 2): `Brain/briefs/fix670_welcome_email_APPROVED_draft.html`.
//
// ★★★ WHERE THE APPROVED WORDS WERE CHANGED, AND WHY (each one is a fact the
//     draft could not know):
//   1. "This button works for 24 hours" — there is no link to expire. fix-426
//      learned that a reset LINK is spent by mail scanners before the person
//      clicks it, so the Login page takes a CODE. The button opens the sign-in
//      page at the code step; the code is printed in the email; the sentence
//      states the code's real lifetime (WELCOME_CODE_VALID_HOURS).
//   2. The viewer access line said "join project chats". On prod a non-admin
//      can REPLY in a project chat but not start a post (project_messages
//      insert policy: `parent_message_id IS NOT NULL OR is_tenant_admin`), so
//      it says "reply in project chats".
//   3. The closing line said "post in any project's chat" — the same fact, so
//      it says "ask in any project's chat".
//
// ★★ PURE. No Deno, no fetch, no Supabase client — CI renders it (fix-436's
//    split). And it cannot import from `src/`, so the area catalogue below is a
//    deliberate copy whose labels a twin test checks against `lib/ribbonNav`.

import { renderBrandedEmail } from '../_shared/emailTemplate.ts';
import type { InlineImage } from '../_shared/graphMail.ts';

/** ★ The Bridge's address — the same constant notify-send carries. */
export const BRIDGE_APP_ORIGIN = 'https://blueprint-dashboard-v2.onrender.com';

/**
 * ★★★ HOW LONG THE CODE WORKS. Supabase Auth's "Email OTP Expiration" — the
 *     recovery code from `generateLink` is checked against it. The Login page
 *     already tells people codes are "good for about an hour" (fix-426), and
 *     Supabase's default is 3600 s. A test pins the email's sentence to this
 *     number, so changing the Auth setting means changing this one line.
 */
export const WELCOME_CODE_VALID_HOURS = 1;

/** The sign-in page, opened at the code step for this address. ★ The address
 *  rides in the FRAGMENT, which the browser never sends to a server — so it is
 *  in no access log and no Referer. */
export function welcomeSignInUrl(email: string): string {
  return `${BRIDGE_APP_ORIGIN}/login#welcome=${encodeURIComponent(email)}`;
}

/** ★ Which version of the email: people from other departments who view, or
 *  people who work in the Bridge. Decided by roster role, not by access. */
export type WelcomeAudience = 'viewer' | 'works';

export const WELCOME_AREA_KEYS = [
  'my_board',
  'projects',
  'draw_schedule',
  'library',
  'chat',
] as const;
export type WelcomeAreaKey = (typeof WELCOME_AREA_KEYS)[number];

/** ★★ The approved one-line descriptions, per version. Which of these a person
 *  is SHOWN is decided by the client from `lib/ribbonNav` (what they can open);
 *  this table only holds the words. */
export const WELCOME_AREA_COPY: Record<
  WelcomeAreaKey,
  { label: string; viewer: string; works: string }
> = {
  my_board: {
    label: 'My Board',
    viewer: "your tasks, what's due, and what you're waiting on — start here each morning.",
    works: "your tasks, what's due, and what you're waiting on — start here each morning.",
  },
  projects: {
    label: 'Projects',
    viewer: 'every active project, its permits, and where each one stands with the city.',
    works: 'every active project, its permits, and where each one stands with the city.',
  },
  draw_schedule: {
    label: 'Draw Schedule',
    viewer:
      'who is designing what, week by week, and when each project is due to submit.',
    works: 'who is designing what, week by week.',
  },
  library: {
    label: 'Library',
    viewer: 'unit types, plans and marketing sets for each project.',
    works: 'unit types, plans and marketing sets for each project.',
  },
  chat: {
    label: 'Chat',
    viewer:
      "open any project and use its chat to ask the team a question. Type @ and a name to get someone's attention.",
    works:
      "each project has its own chat. Type @ and a name to bring someone in; you'll see your mentions on My Board.",
  },
};

export const ACCESS_LINE: Record<WelcomeAudience, string> = {
  viewer:
    'View access — you can see every project and reply in project chats. The project team makes the edits.',
  works: 'Editor access — you can update the projects and tasks you work on.',
};

export interface WelcomeInput {
  audience: WelcomeAudience;
  /** The recipient's first name. */
  firstName: string;
  /** The first name of the admin who added them; null when unknown. */
  adderFirstName: string | null;
  /** "Greg · Underwriting" — computed by the client, the same string the Add
   *  Person dialog previewed. Escaped here. */
  plate: string;
  email: string;
  code: string;
  areas: readonly WelcomeAreaKey[];
}

export interface WelcomeEmail {
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The code's lifetime as words — "1 hour", "2 hours". */
export function codeLifetimeWords(hours = WELCOME_CODE_VALID_HOURS): string {
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function renderWelcomeEmail(input: WelcomeInput): WelcomeEmail {
  const first = input.firstName.trim();
  const adder = (input.adderFirstName ?? '').trim() || 'Your Blueprint admin';
  const asker = (input.adderFirstName ?? '').trim() || 'your Blueprint admin';
  const url = welcomeSignInUrl(input.email);
  const lifetime = codeLifetimeWords();
  const areas = WELCOME_AREA_KEYS.filter((k) => input.areas.includes(k));

  const MUTED = '#666666';
  const BLUE = '#5a6bb0';
  const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const intro =
    `${adder} has set you up on the Bridge — Blueprint's home for every project ` +
    `we're designing and permitting, from the first drawing to the issued permit.`;
  const codeLine =
    `You'll sign in with ${input.email}. The code works for ${lifetime} — after ` +
    `that, use Forgot password? on the sign-in page.`;
  const guide =
    "New here? Open What's New in the left menu. It has a short guide to every area, " +
    'and each tip has a Show me → button that takes you straight there.';
  const closing = `Questions about the Bridge? Ask ${asker}, or ask in any project's chat.`;

  const areaRows = areas
    .map(
      (k) =>
        '<tr><td style="padding:0 0 10px 0;vertical-align:top">' +
        `<strong>${esc(WELCOME_AREA_COPY[k].label)}</strong> — ` +
        `${esc(WELCOME_AREA_COPY[k][input.audience])}</td></tr>`,
    )
    .join('');

  const bodyHtml =
    `<p style="margin:0 0 14px 0;font-size:20px;font-weight:600">Welcome to the Bridge, ${esc(first)}.</p>` +
    `<p style="margin:0 0 14px 0">${esc(intro)}</p>` +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
    'style="width:100%;background:#f4f5f8;border:1px solid #e2e5ee;border-radius:6px">' +
    '<tr><td style="padding:12px 16px;font-size:14px;line-height:1.5">' +
    `<div style="color:${MUTED};font-size:11px;letter-spacing:.06em;text-transform:uppercase">How you'll appear</div>` +
    `<div style="font-weight:600;padding-top:2px" data-welcome="plate">${esc(input.plate)}</div>` +
    `<div style="color:${MUTED}">${esc(ACCESS_LINE[input.audience])}</div>` +
    '</td></tr></table>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 8px 0">' +
    `<tr><td style="background:${BLUE};border-radius:6px"><a href="${esc(url)}" ` +
    `style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:15px;` +
    'font-weight:600;color:#ffffff;text-decoration:none">Set your password and sign in</a></td></tr></table>' +
    `<p style="margin:8px 0 4px 0;font-size:13px;color:${MUTED}">Enter this code on the sign-in page, then choose your password:</p>` +
    '<p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:4px 0 12px 0;' +
    `font-family:ui-monospace,SFMono-Regular,Menlo,monospace" data-welcome="code">${esc(input.code)}</p>` +
    `<p style="margin:0 0 22px 0;font-size:13px;color:${MUTED}" data-welcome="expiry">You'll sign in with ` +
    `<strong style="color:#111111">${esc(input.email)}</strong>. The code works for ${esc(lifetime)} — ` +
    'after that, use <em>Forgot password?</em> on the sign-in page.</p>' +
    '<p style="margin:0 0 10px 0;font-weight:600">Where to look first</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
    `style="width:100%;font-size:14px;line-height:1.5" data-welcome="areas">${areaRows}</table>` +
    '<p style="margin:14px 0 0 0;font-size:14px"><strong>New here?</strong> Open <strong>What\'s New</strong> ' +
    'in the left menu. It has a short guide to every area, and each tip has a <em>Show me →</em> ' +
    'button that takes you straight there.</p>' +
    `<p style="margin:14px 0 0 0;font-size:14px">${esc(closing)}</p>`;

  const bodyText = [
    `Welcome to the Bridge, ${first}.`,
    '',
    intro,
    '',
    "HOW YOU'LL APPEAR",
    input.plate,
    ACCESS_LINE[input.audience],
    '',
    `Set your password and sign in: ${url}`,
    '',
    'Enter this code on the sign-in page, then choose your password:',
    '',
    input.code,
    '',
    codeLine,
    '',
    'WHERE TO LOOK FIRST',
    ...areas.map((k) => `- ${WELCOME_AREA_COPY[k].label} — ${WELCOME_AREA_COPY[k][input.audience]}`),
    '',
    guide,
    '',
    closing,
  ].join('\n');

  const branded = renderBrandedEmail({ bodyHtml, bodyText });
  return {
    subject: `Welcome to the Bridge, ${first}`,
    html: branded.html,
    text: branded.text,
    inlineImages: branded.inlineImages,
  };
}
