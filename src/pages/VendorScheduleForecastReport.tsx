import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import { useAppConfig } from '../hooks/useAppConfig';
import { useWaitingOnTasks } from '../hooks/useWaitingOnTasks';
import {
  useAllProjectHolds,
  activeHoldByProjectId,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import {
  useVendorReportState,
  useMarkVendorReportSent,
} from '../hooks/useVendorReportState';
import { useVendorReportExtras } from '../hooks/useVendorReportExtras';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  VENDOR_KEY_STRUCTURAL,
  buildVendorScheduleRows,
  splitVendorSections,
  buildVendorCorrectionRows,
  buildVendorTransmitRows,
  transmitStartedProjectIds,
  allPermitsDoneProjectIds,
  vendorSentPayload,
  lastSentAt,
  type VendorCorrectionRow,
  type VendorScheduleRow,
  type VendorTransmitRow,
} from '../lib/vendorReport';
import { usePermits } from '../hooks/usePermits';
import {
  buildEmlFile,
  buildVendorEmailHtml,
  buildVendorEmailSubject,
  emlFilename,
  formatWeekOf,
  missingRecipientEmails,
  readVendorRecipients,
} from '../lib/vendorReportEmail';
import type { Project } from '../lib/database.types';

// fix-265: Vendor Schedule Forecast — the weekly note Blueprint owes SSS, built
// from the draw schedule instead of hand-typed off old feasibility docs.
//
// Four sections in a fixed order (Option A, chosen by Gena and Brittani):
//   1. New to the schedule   — in the pipeline, never sent
//   2. Schedule changes      — sent before, but a fact moved (shows OLD → NEW)
//   3. Upcoming pipeline     — the RUNNING LIST, always everything
//   4. Corrections with you  — live tasks waiting on this vendor
//
// COMPOSE ≠ SEND. "Compose email" builds a .eml draft and writes NOTHING. Only
// "Mark as sent" touches the ledger. Bobby previews drafts he does not send; a
// compose that silently marked things sent would make those projects vanish from
// next week's email. That separation is the single most important behavioural
// rule in this feature and is regression-locked by tests.

/** Today as YYYY-MM-DD (local). Isolated so the pure builders stay testable. */
function todayIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function VendorScheduleForecastReport() {
  const vendorKey = VENDOR_KEY_STRUCTURAL;

  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const drawQ = useDrawSchedule();
  const holdsQ = useAllProjectHolds();
  const ledgerQ = useVendorReportState(vendorKey);
  const extrasQ = useVendorReportExtras();
  const configQ = useAppConfig();
  const waitingQ = useWaitingOnTasks({ includeCompleted: false });
  const markSent = useMarkVendorReportSent();

  const [copied, setCopied] = useState(false);

  const today = useMemo(() => todayIso(), []);

  const cancelledIds = useMemo(
    () => cancelledProjectIds(holdsQ.data),
    [holdsQ.data],
  );
  const holdsByProject = useMemo(
    () => activeHoldByProjectId(holdsQ.data),
    [holdsQ.data],
  );

  // Merge the separately-fetched reuse columns onto the shared project rows.
  // (useProjects' select deliberately does not carry them — see
  // useVendorReportExtras for why.)
  const projects = useMemo<Project[]>(() => {
    const extras = extrasQ.data;
    const base = projectsQ.data ?? [];
    if (!extras) return base;
    return base.map((p) => ({
      ...p,
      reused_from_project_id:
        extras.reusedFromProjectId.get(p.id) ?? p.reused_from_project_id ?? null,
      reuse_notes: extras.reuseNotes.get(p.id) ?? null,
    }));
  }, [projectsQ.data, extrasQ.data]);

  // fix-268: projects whose permits have all issued — finished, whatever the
  // draw block still says.
  const allPermitsDoneIds = useMemo(
    () => allPermitsDoneProjectIds(permitsQ.data ?? []),
    [permitsQ.data],
  );

  // fix-268: section 4 — the design-phase handoff. Built BEFORE the schedule
  // rows, because a started transmit moves its project out of the pipeline.
  const transmitted = useMemo(
    () =>
      buildVendorTransmitRows(
        waitingQ.data ?? [],
        projects,
        vendorKey,
        cancelledIds,
      ),
    [waitingQ.data, projects, vendorKey, cancelledIds],
  );
  const transmitStartedIds = useMemo(
    () => transmitStartedProjectIds(transmitted),
    [transmitted],
  );

  const rows = useMemo(
    () =>
      buildVendorScheduleRows({
        draw: drawQ.data ?? [],
        projects,
        ledger: ledgerQ.data ?? [],
        cancelledIds,
        holdsByProject,
        allPermitsDoneIds,
        transmitStartedIds,
        todayIso: today,
      }),
    [
      drawQ.data,
      projects,
      ledgerQ.data,
      cancelledIds,
      holdsByProject,
      allPermitsDoneIds,
      transmitStartedIds,
      today,
    ],
  );

  const sections = useMemo(() => splitVendorSections(rows), [rows]);

  const corrections = useMemo(
    () =>
      buildVendorCorrectionRows(
        waitingQ.data ?? [],
        projects,
        vendorKey,
        cancelledIds,
      ),
    [waitingQ.data, projects, vendorKey, cancelledIds],
  );

  const recipients = useMemo(
    () => readVendorRecipients(configQ.map.get('vendorReportRecipients'), vendorKey),
    [configQ.map, vendorKey],
  );
  const missingEmails = useMemo(
    () => missingRecipientEmails(recipients),
    [recipients],
  );

  const emailHtml = useMemo(
    () =>
      buildVendorEmailHtml({
        sections,
        transmitted,
        corrections,
        vendorLabel: recipients.label,
        weekOf: today,
      }),
    [sections, transmitted, corrections, recipients.label, today],
  );

  const subject = buildVendorEmailSubject(recipients.label, today);
  const sentAt = lastSentAt(ledgerQ.data ?? []);

  const error =
    projectsQ.error ?? drawQ.error ?? ledgerQ.error ?? waitingQ.error;
  const isLoading =
    projectsQ.isLoading || drawQ.isLoading || ledgerQ.isLoading;

  /** COMPOSE — builds a draft file. Writes NOTHING. See the header comment. */
  function composeEmail() {
    const eml = buildEmlFile({
      to: recipients.to,
      cc: recipients.cc,
      subject,
      html: emailHtml,
    });
    const blob = new Blob([eml], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = emlFilename(vendorKey, today);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Fallback for anyone whose Outlook does not pick up .eml. Also writes nothing. */
  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(emailHtml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context) — leave the button
      // idle rather than throwing; Compose is the primary path anyway.
    }
  }

  /** SEND — the ONLY ledger write. Records the PIPELINE rows: after a send the
   *  vendor knows the current state of everything on the list, not just the
   *  rows that were called out as new or changed. */
  function markAsSent() {
    markSent.mutate({
      vendorKey,
      rows: vendorSentPayload(sections.pipelineRows),
    });
  }

  if (error) {
    return (
      <QueryError
        title="Vendor schedule forecast failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          drawQ.refetch();
          ledgerQ.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="vendor-forecast-report">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <Link
            to="/reports"
            className="text-[12px] text-de hover:underline"
            data-testid="vsf-back"
          >
            ← Reports
          </Link>
          <h1 className="text-lg font-display font-extrabold text-text mt-1">
            Vendor Schedule Forecast
            {recipients.label ? ` — ${recipients.label}` : ''}
          </h1>
          <p className="text-[11px] text-muted">
            Week of {formatWeekOf(today)}.{' '}
            {sentAt ? (
              <span data-testid="vsf-last-sent">
                Last sent {new Date(sentAt).toLocaleString('en-US')}.
              </span>
            ) : (
              <span data-testid="vsf-never-sent">Never sent.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={composeEmail}
            disabled={recipients.to.length === 0}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-de text-white border border-de hover:opacity-90 transition disabled:opacity-40"
            data-testid="vsf-compose"
          >
            ✉ Compose email
          </button>
          <button
            type="button"
            onClick={copyHtml}
            className="px-3 py-1.5 rounded-md text-xs font-bold border text-text hover:opacity-90 transition"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="vsf-copy"
          >
            {copied ? '✓ Copied' : 'Copy as HTML'}
          </button>
          <button
            type="button"
            onClick={markAsSent}
            disabled={markSent.isPending || sections.pipelineRows.length === 0}
            className="px-3 py-1.5 rounded-md text-xs font-bold border text-text hover:opacity-90 transition disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="vsf-mark-sent"
          >
            {markSent.isPending ? 'Marking…' : 'Mark as sent'}
          </button>
        </div>
      </div>

      {extrasQ.data?.migrationPending ? (
        <Banner testid="vsf-migration-pending" tone="warn">
          The fix-265 migration has not been applied yet — reuse notes and the
          per-block exclusion switch are unavailable, so those columns render
          blank. Everything else on this page is live.
        </Banner>
      ) : null}

      {recipients.to.length === 0 ? (
        <Banner testid="vsf-no-recipients" tone="warn">
          No recipients are configured for this vendor. Add them in Settings →
          Reporting before composing.
        </Banner>
      ) : null}

      {missingEmails.length > 0 ? (
        <Banner testid="vsf-missing-emails" tone="warn">
          No email address on file for {missingEmails.join(', ')} — they will be
          left off the draft until it is filled in.
        </Banner>
      ) : null}

      {isLoading ? (
        <SkeletonRows count={8} rowClassName="h-7" />
      ) : (
        <>
          {/* fix-268: five sections, and an EMPTY ONE IS OMITTED ENTIRELY.
              Most weeks two or three are empty — TRANSMITTED stays empty until
              the DAs work a cycle — and a run of headers over blank space reads
              as broken. The screen and the email drop the same sections. */}
          <Section
            title="New to the schedule"
            count={sections.newRows.length}
            testid="vsf-new"
          >
            <ScheduleTable rows={sections.newRows} showDelta={false} idPrefix="new" />
          </Section>

          <Section
            title="Schedule changes"
            count={sections.changedRows.length}
            testid="vsf-changed"
          >
            <ScheduleTable
              rows={sections.changedRows}
              showDelta
              idPrefix="changed"
            />
          </Section>

          <Section
            title="Upcoming pipeline"
            count={sections.pipelineRows.length}
            testid="vsf-pipeline"
          >
            <ScheduleTable
              rows={sections.pipelineRows}
              showDelta={false}
              idPrefix="pipeline"
            />
          </Section>

          <Section
            title="Transmitted — with you now"
            count={transmitted.length}
            testid="vsf-transmitted"
          >
            <TransmittedTable rows={transmitted} />
          </Section>

          <Section
            title="Corrections — permitting phase"
            count={corrections.length}
            testid="vsf-corrections"
          >
            <CorrectionsTable rows={corrections} />
          </Section>

          {sections.newRows.length === 0 &&
          sections.changedRows.length === 0 &&
          sections.pipelineRows.length === 0 &&
          transmitted.length === 0 &&
          corrections.length === 0 ? (
            <p className="text-[12px] text-dim italic" data-testid="vsf-all-empty">
              Nothing to report this week.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Banner({
  children,
  testid,
  tone,
}: {
  children: React.ReactNode;
  testid: string;
  tone: 'warn';
}) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-[12px]"
      style={{
        borderColor: 'var(--color-border)',
        background: tone === 'warn' ? 'var(--color-s2)' : 'transparent',
      }}
      data-testid={testid}
    >
      {children}
    </div>
  );
}

/** fix-268: renders nothing at all when the section is empty — heading, count
 *  and body together. A stray header over blank space reads as a broken report,
 *  and on a quiet week most of these are empty. */
function Section({
  title,
  count,
  testid,
  children,
}: {
  title: string;
  count: number;
  testid: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section data-testid={testid}>
      <h2 className="text-[13px] font-display font-extrabold text-text mb-1.5">
        {title}{' '}
        <span className="text-[11px] font-bold text-dim" data-testid={`${testid}-count`}>
          ({count})
        </span>
      </h2>
      {children}
    </section>
  );
}

/** A cell that shows an explicit blank. The data behind this report is thin on
 *  purpose and we deliberately do not backfill it — the visible gap is what
 *  prompts the data entry. */
function Blank() {
  return <span className="text-dim">—</span>;
}

function Cell({ value }: { value: string | null | undefined }) {
  const t = (value ?? '').trim();
  return t === '' ? <Blank /> : <>{t}</>;
}

/** OLD → NEW. Tawny needs the delta to re-plan — that is the whole reason the
 *  Changes section exists, so an unchanged-looking value is never enough. */
function Delta({ from, to }: { from: string | null; to: string | null }) {
  const a = (from ?? '').trim();
  const b = (to ?? '').trim();
  if (a === b) return <Cell value={b} />;
  return (
    <span>
      <span className="line-through text-dim">{a === '' ? '(blank)' : a}</span>{' '}
      → <strong>{b === '' ? '(blank)' : b}</strong>
    </span>
  );
}

const TH = 'text-left px-2 py-1 text-[11px] font-bold';
const TD = 'px-2 py-1 text-[12px] align-top';

function ScheduleTable({
  rows,
  showDelta,
  idPrefix,
}: {
  rows: VendorScheduleRow[];
  showDelta: boolean;
  idPrefix: string;
}) {
  return (
    <table className="w-full border-collapse mb-4">
      <thead>
        <tr style={{ background: 'var(--color-s2)' }}>
          <th className={TH}>Start week</th>
          <th className={TH}>Address</th>
          <th className={TH}>Jurisdiction</th>
          <th className={TH}>DD end</th>
          <th className={TH}>Reuse</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.projectId}
            className="border-t"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`vsf-${idPrefix}-row-${r.projectId}`}
          >
            <td className={TD}>
              {showDelta && r.previous ? (
                <Delta from={r.previous.startWeek} to={r.startWeek} />
              ) : (
                <Cell value={r.startWeek} />
              )}
            </td>
            <td className={TD}>
              {r.address}
              {r.holdReason ? (
                <span
                  className="ml-1 text-[10px] font-bold"
                  style={{ color: 'var(--color-hold-text, #8a6d00)' }}
                  data-testid={`vsf-hold-${r.projectId}`}
                >
                  [ON HOLD — {r.holdReason}]
                </span>
              ) : null}
              {showDelta &&
              r.previous &&
              (r.previous.status ?? '') !== (r.status ?? '') ? (
                <div className="text-[11px] text-muted mt-0.5">
                  Status: <Delta from={r.previous.status} to={r.status} />
                </div>
              ) : null}
            </td>
            <td className={TD}>
              <Cell value={r.juris} />
            </td>
            <td className={TD}>
              {showDelta && r.previous ? (
                <Delta from={r.previous.ddEnd} to={r.ddEnd} />
              ) : (
                <Cell value={r.ddEnd} />
              )}
            </td>
            <td className={TD}>
              {r.reuseFromAddress || r.reuseNotes ? (
                [r.reuseFromAddress, r.reuseNotes].filter(Boolean).join(' · ')
              ) : (
                <Blank />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** fix-268: section 4 — sent, awaiting return. No permit column: a transmit is a
 *  project-level design handoff, not permit-scoped work. */
function TransmittedTable({ rows }: { rows: VendorTransmitRow[] }) {
  return (
    <table className="w-full border-collapse mb-4">
      <thead>
        <tr style={{ background: 'var(--color-s2)' }}>
          <th className={TH}>Address</th>
          <th className={TH}>Jurisdiction</th>
          <th className={TH}>Sent</th>
          <th className={TH}>Expected back</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.taskId}
            className="border-t"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`vsf-transmitted-row-${r.projectId}`}
          >
            <td className={TD}>
              <Cell value={r.address} />
            </td>
            <td className={TD}>
              <Cell value={r.juris} />
            </td>
            <td className={TD}>
              <Cell value={r.sent} />
            </td>
            <td className={TD}>
              <Cell value={r.expectedBack} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CorrectionsTable({ rows }: { rows: VendorCorrectionRow[] }) {
  return (
    <table className="w-full border-collapse mb-4">
      <thead>
        <tr style={{ background: 'var(--color-s2)' }}>
          <th className={TH}>Address</th>
          <th className={TH}>Permit</th>
          <th className={TH}>What&apos;s needed</th>
          <th className={TH}>Sent</th>
          <th className={TH}>Expected back</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.taskId}
            className="border-t"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`vsf-correction-row-${r.taskId}`}
          >
            <td className={TD}>
              <Cell value={r.address} />
            </td>
            <td className={TD}>
              <Cell value={r.permit} />
            </td>
            <td className={TD}>
              <Cell value={r.need} />
            </td>
            <td className={TD}>
              <Cell value={r.sent} />
            </td>
            <td className={TD}>
              <Cell value={r.expectedBack} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
