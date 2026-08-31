import { useMemo } from 'react';
import OriginLink from '../OriginLink';
import { useVendorReportState } from '../../hooks/useVendorReportState';
import { useAppConfig } from '../../hooks/useAppConfig';
import { readVendorRecipients, formatAddressList } from '../../lib/vendorReportEmail';
import { lastSentAt } from '../../lib/vendorReport';

// ===========================================================================
// ★★★ fix-463 §C (P-108) — THE SSS CARD IS A SURFACING JOB, NOT A REBUILD
// ===========================================================================
//
// The Structural Schedule Forecast already exists in full: the report screen,
// `vendorReportEmail.ts`, and fix-269's sent-ledger. ★★ THIS CARD ADDS A DOOR,
// NEVER A COPY (§C4) — the Settings → Reporting path keeps working unchanged,
// and both doors lead to the same one workflow.
//
// ---------------------------------------------------------------------------
// ★★★ §C3 — PREVIEW AND DOWNLOAD RECORD NOTHING. ONLY "MARK AS SENT" MOVES THE
//     LEDGER. THIS IS THE MOST IMPORTANT SENTENCE ON THE CARD.
// ---------------------------------------------------------------------------
// [[STRUCTURAL_FORECAST_HANDOFF]]: *"Composing a draft deliberately does not
// record anything, so previewing is free. Only Mark as sent tells the tool what
// Tawny now knows."*
//
// Collapsing these into one button silently corrupts the ledger: a preview would
// mark everything as sent, and the following week's "what has changed since"
// would show nothing new — the report would quietly stop being useful and
// nobody would get an error. So they stay four separate actions, and the
// sentence stays ON the card where the person pressing the buttons reads it.
//
// ★★ HOW PREVIEW AND DOWNLOAD ARE WIRED, AND WHY THAT IS THE RIGHT SHAPE.
// Building the email needs seven queries and ~100 lines of assembly
// (`splitVendorSections`, `transmitted`, `corrections`, the reuse-extras merge).
// Reproducing that here would be the REBUILD the brief forbids — so both
// buttons open the report screen, which is the one place it is assembled. The
// download fires on arrival via `?compose=1`. A second implementation of the
// email is exactly how two doors start producing two different drafts.

const VENDOR_KEY = 'sss';

export default function SssCard() {
  const ledgerQ = useVendorReportState(VENDOR_KEY);
  const configQ = useAppConfig();

  const recipients = useMemo(
    () => readVendorRecipients(configQ.map, VENDOR_KEY),
    [configQ.map],
  );
  const sentAt = useMemo(() => lastSentAt(ledgerQ.data ?? []), [ledgerQ.data]);

  return (
    <section
      className="rounded border"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="sss-card"
    >
      <header
        className="px-2.5 py-1.5 border-b flex flex-wrap items-baseline gap-2"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        <span className="text-[11px] font-bold text-text">
          Structural Schedule Forecast → {recipients.label}
        </span>
        {/* ★ "Due" — it goes out Wednesday, with the meeting. The Monday-preview
            idea in P-034 is dropped. */}
        <span
          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: 'var(--color-co-bg)', color: 'var(--color-co)' }}
        >
          Due
        </span>
      </header>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 text-[10.5px]">
        <p data-testid="sss-last-sent">
          {sentAt ? (
            <>
              Last recorded send <strong>{sentAt.slice(0, 10)}</strong>.
            </>
          ) : (
            <>
              <strong>Not sent this week.</strong> No send has been recorded for
              this vendor yet.
            </>
          )}
        </p>

        <p className="text-dim" data-testid="sss-recipients">
          To {formatAddressList(recipients.to) || '—'}
          {recipients.cc.length > 0 && <> · Cc {formatAddressList(recipients.cc)}</>}
        </p>

        {/* ★★★ §C3's sentence, on the card, in the handoff's own words. It is
            here rather than in a comment because the person who needs it is the
            one deciding which button to press. */}
        <p
          className="rounded px-2 py-1"
          style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
          data-testid="sss-ledger-note"
        >
          Composing a draft deliberately does not record anything, so previewing
          is free. <strong>Only “Mark as sent” tells the tool what{' '}
          {recipients.label} now knows.</strong>
        </p>

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {/* ★ PREVIEW — opens the report. Writes nothing. */}
          <OriginLink
            to="/reports/vendor-forecast"
            className="text-[10.5px] px-2 py-0.5 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="sss-preview"
          >
            Preview report
          </OriginLink>
          {/* ★ DOWNLOAD — opens the report and composes the .eml on arrival.
              Writes nothing. The assembly lives there, not here. */}
          <OriginLink
            to="/reports/vendor-forecast?compose=1"
            className="text-[10.5px] px-2 py-0.5 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="sss-download"
          >
            Download email draft
          </OriginLink>
          {/* ★★★ MARK AS SENT — THE ONLY ACTION THAT MOVES THE LEDGER, and it
              deliberately does NOT fire from here. The ellipsis says so: it
              opens the report, where the button sits directly under the rows it
              is about to record.
              ★★ Two reasons, and both are the handoff's. Recording a send from a
              summary card, without seeing its contents, is how a ledger gains a
              week it never had — and the payload needs `vendorSentPayload(
              sections.pipelineRows)`, which only exists after the assembly this
              card deliberately does not duplicate. */}
          <OriginLink
            to="/reports/vendor-forecast"
            title="Opens the report, where Mark as sent sits under the rows it will record"
            className="text-[10.5px] px-2 py-0.5 rounded border font-bold"
            style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
            data-testid="sss-mark-sent"
          >
            Mark as sent…
          </OriginLink>
          <OriginLink
            to="/settings/reporting"
            className="text-[10.5px] px-2 py-0.5 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="sss-recipients-edit"
          >
            Edit recipients
          </OriginLink>
        </div>
      </div>
    </section>
  );
}
