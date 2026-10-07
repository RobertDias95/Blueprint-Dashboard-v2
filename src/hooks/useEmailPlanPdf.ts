import { useCallback, useRef, useState } from 'react';
import { pdfDownloadName, signPlanPdfUrl } from '../lib/planOfRecordShare';
import {
  createPlanDraft,
  draftHtmlBody,
  draftSubject,
  DraftStepError,
  STEP_WORDS,
  type DraftLink,
} from '../lib/outlookDraft';
import { planShareExpiryDate } from '../lib/planShare';
import { getOutlookToken, hasOutlookAccount, loadOutlookAuth } from '../lib/outlookAuth';
import { pushToast } from '../stores/toastStore';

// ===========================================================================
// fix-629 (P-324) — the Email PDF item's behaviour, in one place
// ===========================================================================
//
// ★★★ NEVER A DEAD ITEM. While it works the item reads "Preparing email…" and
//     cannot be pressed twice; when it ends — either way — it is Email PDF
//     again. A failure is ONE sentence naming the step that failed, and says
//     Download PDF still works (it does: it shares nothing with this path but
//     the signed URL).
//
// ★★ THE DRAFT'S TAB. A tab opened long after a click is blocked by the
//    browser, and creating the draft takes seconds (an 18.6 MB set uploads in
//    chunks). So when the person is ALREADY signed in, a blank tab is opened
//    synchronously on the click and pointed at the draft when it exists. On
//    the first press the click is spent on Microsoft's sign-in window instead,
//    so the draft's tab is attempted afterwards — and if the browser blocks
//    it, the menu offers "Open the draft in Outlook", a real link the person
//    clicks. The draft is in their Drafts folder either way.

export type EmailPdfState =
  | { kind: 'idle' }
  | { kind: 'working' }
  /** ★ fix-630: `linkIncluded` false = the private link could not be minted,
   *  so the draft carries the PDF only (and the menu says so). */
  | { kind: 'ready'; webLink: string; opened: boolean; linkIncluded: boolean };

export interface EmailPdfInput {
  pdfPath: string;
  fileName: string | null;
  address: string | null;
  setName: string;
  /** ★ fix-630: this set's private link, through Copy link's own mint. */
  mintLink?: () => Promise<{ url: string; expiresAt: string }>;
}

export function useEmailPlanPdf(): {
  state: EmailPdfState;
  start: (input: EmailPdfInput) => Promise<void>;
  prefetch: () => void;
} {
  const [state, setState] = useState<EmailPdfState>({ kind: 'idle' });
  const busy = useRef(false);

  const prefetch = useCallback(() => {
    void loadOutlookAuth().catch(() => {
      /* the press will say so */
    });
  }, []);

  const start = useCallback(async (input: EmailPdfInput) => {
    if (busy.current) return;
    busy.current = true;

    // ★ Synchronously, inside the click — see the header.
    let tab: Window | null = null;
    if (hasOutlookAccount()) {
      tab = window.open('', '_blank');
      if (tab) {
        try {
          tab.opener = null;
          tab.document.title = 'Outlook draft';
          tab.document.body.textContent = 'Preparing your Outlook draft…';
        } catch {
          /* a blank tab we cannot write to is still a tab we can point */
        }
      }
    }
    setState({ kind: 'working' });

    try {
      // ★★ fix-630: the private link — and its failure never blocks the email.
      let link: DraftLink | null = null;
      if (input.mintLink) {
        try {
          const l = await input.mintLink();
          link = { url: l.url, expiresOn: planShareExpiryDate(l.expiresAt) };
        } catch {
          link = null;
        }
      }

      let pdfUrl: string;
      try {
        pdfUrl = await signPlanPdfUrl(input.pdfPath, input.fileName);
      } catch {
        throw new DraftStepError('download', 'Could not get the PDF for this set.');
      }
      const draft = await createPlanDraft(
        {
          pdfUrl,
          fileName: pdfDownloadName(input.fileName),
          subject: draftSubject(input.address, input.setName),
          htmlBody: draftHtmlBody(input.address, input.setName, link),
        },
        { getToken: getOutlookToken, fetch: (...args) => fetch(...args) },
      );

      let opened = false;
      try {
        if (tab && !tab.closed) {
          tab.location.href = draft.webLink;
          opened = true;
        } else {
          const w = window.open(draft.webLink, '_blank');
          if (w) {
            w.opener = null;
            opened = true;
          }
        }
      } catch {
        opened = false;
      }
      const linkIncluded = link !== null;
      setState({ kind: 'ready', webLink: draft.webLink, opened, linkIncluded });
      const carries = linkIncluded
        ? 'the PDF attached and its private link'
        : 'the PDF attached (the private link could not be created, so it is not in the email)';
      pushToast(
        opened
          ? `Draft opened in Outlook with ${carries} — add the recipient and press Send.`
          : `Your Outlook draft is ready with ${carries} — open the share menu and choose “Open the draft in Outlook”.`,
        linkIncluded ? 'success' : 'warn',
      );
    } catch (e) {
      try {
        tab?.close();
      } catch {
        /* nothing to close */
      }
      setState({ kind: 'idle' });
      const step = e instanceof DraftStepError ? e.step : 'create';
      const sentence = e instanceof DraftStepError ? e.message : 'Something went wrong.';
      pushToast(
        `Email PDF stopped while ${STEP_WORDS[step]}: ${sentence} Download PDF still works.`,
        'error',
      );
    } finally {
      busy.current = false;
    }
  }, []);

  return { state, start, prefetch };
}
