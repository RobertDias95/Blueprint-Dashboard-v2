import type { PublicClientApplication } from '@azure/msal-browser';
import { DraftStepError, OUTLOOK_DRAFT_APP } from './outlookDraft';

// ===========================================================================
// fix-629 (P-324) — signing in to Microsoft for the Outlook draft
// ===========================================================================
//
// ★★ LOADED ON DEMAND. MSAL is only needed by the people who press Email PDF,
//    so it is a dynamic import — it stays out of the main bundle. The share
//    menu PREFETCHES it when it opens, so by the time the item is pressed the
//    client is ready and the sign-in popup still counts as part of the click
//    (a popup opened long after a click is blocked).
//
// ★★ A POPUP, then silent. The first press opens Microsoft's sign-in window
//    (admin consent is granted company-wide, so nobody sees a consent screen);
//    later presses get the token silently.
//
// ★ sessionStorage, MSAL's default, on purpose: a token that can write to a
//   mailbox should not outlive the tab. The cost is one quick popup per tab.

let pcaPromise: Promise<PublicClientApplication> | null = null;
let pcaReady: PublicClientApplication | null = null;

/** Load + initialise the client once. Safe to call repeatedly. */
export function loadOutlookAuth(): Promise<PublicClientApplication> {
  if (!pcaPromise) {
    pcaPromise = (async () => {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const pca = new PublicClientApplication({
        auth: {
          clientId: OUTLOOK_DRAFT_APP.clientId,
          authority: `https://login.microsoftonline.com/${OUTLOOK_DRAFT_APP.tenantId}`,
          redirectUri: OUTLOOK_DRAFT_APP.redirectUri,
        },
        cache: { cacheLocation: 'sessionStorage' },
      });
      await pca.initialize();
      pcaReady = pca;
      return pca;
    })();
    // ★ A failed load must not poison every later press.
    pcaPromise.catch(() => {
      pcaPromise = null;
    });
  }
  return pcaPromise;
}

/** True when a Microsoft account is already signed in for this tab — the
 *  caller may then open the draft's tab synchronously on the click. */
export function hasOutlookAccount(): boolean {
  return !!pcaReady && pcaReady.getAllAccounts().length > 0;
}

/** One plain sentence for a sign-in that did not finish. Never a stack trace. */
export function signInFailureSentence(e: unknown): string {
  const code = (e as { errorCode?: string } | null)?.errorCode ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  if (code === 'popup_window_error' || code === 'empty_window_error') {
    return 'Your browser blocked the Microsoft sign-in window — allow pop-ups for this site, then try again.';
  }
  if (code === 'user_cancelled') return 'Microsoft sign-in was cancelled.';
  if (code === 'interaction_in_progress') {
    return 'A Microsoft sign-in window is already open — finish it, then try again.';
  }
  if (/AADSTS50011/.test(msg)) {
    return 'Microsoft sign-in is not set up for this address — ask IT to check the Outlook drafts app.';
  }
  return 'Microsoft sign-in did not finish.';
}

/** A Graph token for Mail.ReadWrite + User.Read: silent when possible,
 *  otherwise the sign-in popup. Failures come back as DraftStepError('sign-in'). */
export async function getOutlookToken(): Promise<string> {
  try {
    const pca = await loadOutlookAuth();
    const scopes = [...OUTLOOK_DRAFT_APP.scopes];
    const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
    if (account) {
      try {
        const r = await pca.acquireTokenSilent({ scopes, account });
        return r.accessToken;
      } catch (e) {
        const { InteractionRequiredAuthError } = await import('@azure/msal-browser');
        if (!(e instanceof InteractionRequiredAuthError)) throw e;
        // fall through to the popup
      }
    }
    const r = await pca.acquireTokenPopup({ scopes });
    if (r.account) pca.setActiveAccount(r.account);
    return r.accessToken;
  } catch (e) {
    throw new DraftStepError('sign-in', signInFailureSentence(e));
  }
}

/**
 * ★★★ THE SIGN-IN POPUP COMES BACK TO THIS APP. IT registered the bare origin
 * as the redirect URI, so Microsoft returns the popup to
 * `https://blueprint-dashboard-v2.onrender.com/#code=…&state=…`, which would
 * load the whole app inside the popup. MSAL (4.x) reads the answer by polling
 * the popup's address, so nothing in the popup has to run — and nothing
 * should: booting the app there could rewrite that address first (Supabase
 * inspects the URL for its own sign-in). `main.tsx` asks this and, when it is
 * true, renders one line and stops.
 */
export function isOutlookSignInPopup(
  w: Pick<Window, 'opener' | 'location'> = window,
): boolean {
  if (!w.opener) return false;
  const h = w.location.hash ?? '';
  return /[#&]state=/.test(h) && /[#&](code|error)=/.test(h);
}
