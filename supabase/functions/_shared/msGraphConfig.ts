// ===========================================================================
// ★★★ fix-628 (P-092) — THE NON-SECRET HALF OF SENDING AS bridge@
// ===========================================================================
//
// IT finished the Microsoft side on 2026-09-16 (Sentry #437491). These are
// facts, confirmed by IT, not assumptions:
//
//   · the mailbox `bridge@blueprintcap.com` exists; DKIM is on; a "not
//     monitored" auto-reply is active; max send size 150 MB;
//   · the Entra app "Bridge sender" holds the **Application** permission
//     Microsoft Graph `Mail.Send` with admin consent granted;
//   · an ApplicationAccessPolicy restricts that app to `bridge@blueprintcap.com`
//     ONLY — IT tested it: bridge@ is granted, every other mailbox is denied.
//
// ★★★ WHICH IS WHY THESE THREE STRINGS ARE NOT SECRETS AND LIVE IN CODE. A
//     tenant id, a client id and a mailbox address identify; they do not
//     authorise. Holding all three and no client secret gets you nothing. Put
//     them in env instead and the first symptom of a typo is a 401 at 2am with
//     nothing in the repo to compare against.
//
// ⛔ THE CLIENT SECRET IS NOT HERE AND MUST NEVER BE. It arrives only as the
//    Edge Function secret `MS_GRAPH_CLIENT_SECRET`, which Bobby sets in the
//    Supabase dashboard. Nothing in this repository has ever held its value.

/** Entra tenant (Blueprint Capital). */
export const MS_TENANT_ID = '6db456fa-8448-4c61-bb16-2a343232044c';

/** The "Bridge sender" app registration's Application (client) ID. */
export const MS_CLIENT_ID = '0d35e1bc-cdf7-449b-a822-217dff8967d5';

/**
 * ★★★ THE ONLY MAILBOX THIS APP CAN SEND AS, and that is enforced on
 *     Microsoft's side by the ApplicationAccessPolicy, not here. If this string
 *     is ever changed to another address the send will fail with a Graph 403,
 *     which is the correct outcome: the policy is the authority, and this
 *     constant only has to agree with it.
 */
export const BRIDGE_SENDER = 'bridge@blueprintcap.com';

/** Display name on the From line. */
export const BRIDGE_SENDER_NAME = 'Blueprint Bridge';

/** Client-credentials token endpoint. */
export const MS_TOKEN_URL =
  `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`;

/** ★ `.default` is the client-credentials scope: it means "every Application
 *  permission already consented for this app", which is exactly `Mail.Send`. */
export const MS_GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/** sendMail for the one permitted mailbox. */
export const MS_SENDMAIL_URL =
  `https://graph.microsoft.com/v1.0/users/${BRIDGE_SENDER}/sendMail`;

/** The env var names. ★ Named here so a missing one can be reported BY NAME —
 *  "a secret is missing" is not an error message somebody can act on. */
export const ENV_CLIENT_SECRET = 'MS_GRAPH_CLIENT_SECRET';
export const ENV_HOOK_SECRET = 'SEND_EMAIL_HOOK_SECRET';

/**
 * ★★ The footer every machine-sent Bridge email carries.
 *
 * ⚖️ Bobby, 2026-09-11: alerts, notifications and reset codes come *from*
 *    bridge@ and SAY THE MAILBOX ISN'T MONITORED. The mailbox has an auto-reply
 *    saying so too, but an auto-reply arrives after somebody has already typed a
 *    question and waited — the sentence belongs in the original email.
 *
 * ★ Person-facing email (later tickets) additionally CCs the Blueprint owner and
 *   sets them as Reply-To. That is a different shape and not this constant's
 *   job; `sendGraphMail` already takes `cc` and `replyTo` for it.
 */
export const UNMONITORED_FOOTER =
  "This mailbox isn't monitored. Questions? Ask your Blueprint contact.";
