import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { useConsultantCurrent } from '../hooks/useConsultantCurrent';
import { useExternalTeamDirectory } from '../hooks/useExternalTeamDirectory';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import {
  FORECAST_DISCIPLINES,
  buildVendorScheduleRows,
  splitVendorSections,
  buildVendorCorrectionRows,
  buildVendorTransmitRows,
  consultantByProject,
  designPhaseProjectIds,
  allPermitsDoneProjectIds,
  resolveForecastDiscipline,
  vendorKeyForDiscipline,
  vendorSentPayload,
  lastSentAt,
  type VendorCorrectionRow,
  type VendorScheduleRow,
  type VendorTransmitRow,
  formatProductTypes,
  formatUnits,
} from '../lib/vendorReport';
import { usePermits } from '../hooks/usePermits';
import {
  buildEmlFile,
  buildVendorEmailHtml,
  buildVendorEmailSubject,
  emlFilename,
  formatWeekOf,
  missingRecipientEmails,
  resolveForecastRecipients,
} from '../lib/vendorReportEmail';

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
  // ★★★ fix-499 §B — THE DISCIPLINE IS A PARAMETER, AND ABSENT MEANS
  //     STRUCTURAL. Every link, bookmark and Weekly Update card that predates
  //     this ticket carries no `?discipline`, so all of them land exactly where
  //     they always did. An UNKNOWN value renders the empty state below with
  //     the seven as links — never a throw, because a mistyped URL is a typo,
  //     not an error condition.
  const [searchParams] = useSearchParams();
  const discipline = resolveForecastDiscipline(searchParams.get('discipline'));
  // ★★ The ledger key is the lower-cased discipline, so `Structural` stays
  //    `structural` and the six existing vendor_report_state rows keep their
  //    history. The ledger schema and its rows are untouched by this ticket.
  const vendorKey = vendorKeyForDiscipline(discipline ?? '');

  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const drawQ = useDrawSchedule();
  const holdsQ = useAllProjectHolds();
  const ledgerQ = useVendorReportState(vendorKey);
  const configQ = useAppConfig();
  const waitingQ = useWaitingOnTasks({ includeCompleted: false });
  // ★★★ fix-499 §A: THE MEMBERSHIP SIGNAL. A project is on this report because
  //     it has a consultant record for this discipline whose latest live round
  //     is not Received — not because somebody remembered to make a task.
  const consultantsQ = useConsultantCurrent();
  const directoryQ = useExternalTeamDirectory();
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

  // ★ fix-499 §C: `useVendorReportExtras` is GONE. It existed to fetch
  //   `reused_from_project_id` + `reuse_notes` for the Reuse column, and the
  //   Reuse column is not one of the five. Bobby: "There's not going to be any
  //   notes." Nothing else read the hook, so it went with the column — and the
  //   "migration pending" banner it powered went with it.
  // ★ Memoised on the query's own array so the four memos below keep a stable
  //   dependency. `projectsQ.data ?? []` inline would mint a new [] on every
  //   render whenever the query is still empty, which is what the exhaustive-
  //   deps rule warns about — and this page has four consumers of it.
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);

  // fix-268: projects whose permits have all issued — finished, whatever the
  // draw block still says.
  const allPermitsDoneIds = useMemo(
    () => allPermitsDoneProjectIds(permitsQ.data ?? []),
    [permitsQ.data],
  );

  // fix-271: the project's draw phase, not the task's name, decides whether a
  // structural task is a design handoff or a permitting correction.
  const designPhaseIds = useMemo(
    () => designPhaseProjectIds(drawQ.data ?? []),
    [drawQ.data],
  );

  // ★★★ fix-499: one consultant record per project for THIS discipline. Every
  //     section below reads it; a project absent from this map is absent from
  //     the report.
  const consultants = useMemo(
    () => consultantByProject(consultantsQ.data ?? [], discipline ?? ''),
    [consultantsQ.data, discipline],
  );

  // Section 4 — sent and awaiting return: the rounds sitting at Pending.
  const transmitted = useMemo(
    () => buildVendorTransmitRows(consultants, projects, cancelledIds),
    [consultants, projects, cancelledIds],
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
        consultants,
        todayIso: today,
      }),
    [
      drawQ.data,
      projects,
      ledgerQ.data,
      cancelledIds,
      holdsByProject,
      allPermitsDoneIds,
      consultants,
      today,
    ],
  );

  const sections = useMemo(() => splitVendorSections(rows), [rows]);

  // ★★ fix-499: SECTION 5 IS UNCHANGED AND STILL READS TASKS. A correction is
  //    post-submittal permitting work sitting with the firm — it is not a design
  //    round, it has no round to belong to, and fix-271's rule that design and
  //    permitting never blur survives this ticket intact. Only its firm lookup
  //    moved, from the deleted VENDOR_FIRM constant to the consultant record.
  const corrections = useMemo(
    () =>
      buildVendorCorrectionRows(
        waitingQ.data ?? [],
        projects,
        discipline ?? '',
        designPhaseIds,
        cancelledIds,
        consultants,
      ),
    [waitingQ.data, projects, discipline, designPhaseIds, cancelledIds, consultants],
  );

  const recipients = useMemo(
    () =>
      resolveForecastRecipients(
        configQ.map.get('vendorReportRecipients'),
        vendorKey,
        discipline ?? '',
        directoryQ.data,
      ),
    [configQ.map, vendorKey, discipline, directoryQ.data],
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

  const subject = buildVendorEmailSubject(
    recipients.label,
    today,
    discipline ?? '',
  );
  const sentAt = lastSentAt(ledgerQ.data ?? []);

  const error =
    projectsQ.error ??
    drawQ.error ??
    ledgerQ.error ??
    waitingQ.error ??
    consultantsQ.error;
  const isLoading =
    projectsQ.isLoading ||
    drawQ.isLoading ||
    ledgerQ.isLoading ||
    consultantsQ.isLoading;

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
  // ★★★ fix-463 §C2 — THE WEEKLY UPDATE'S "Download email draft" LANDS HERE.
  //
  // The card on the Agenda screen cannot build the email itself: assembling it
  // needs the seven queries and ~100 lines of memos above, and reproducing them
  // there would be the REBUILD the brief forbids (§C4: a second door to one
  // workflow, never a copy of it). So the card links here with `?compose=1` and
  // the draft is composed on arrival, by the one implementation.
  //
  // ★★★ IT STILL RECORDS NOTHING. `composeEmail` builds a file; only
  // `markAsSent` touches the ledger, and there is deliberately NO `?intent`
  // handler that presses it — recording a send from a link, without the person
  // seeing which rows are about to be written, is how a ledger gains a week it
  // never had. The mark-sent link opens this page so the button can be pressed
  // HERE, in front of the contents.
  const composedRef = useRef(false);
  const wantsCompose = searchParams.get('compose') === '1';
  useEffect(() => {
    // ★ Once per arrival, and only once the data it needs has actually loaded —
    //   composing from an empty pipeline would hand somebody a blank draft.
    if (!wantsCompose || composedRef.current || isLoading) return;
    if (sections.pipelineRows.length === 0) return;
    composedRef.current = true;
    composeEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCompose, isLoading, sections.pipelineRows.length]);

  function markAsSent() {
    markSent.mutate({
      vendorKey,
      rows: vendorSentPayload(sections.pipelineRows),
    });
  }

  // ★★★ fix-499 §B: an UNKNOWN ?discipline lands here, not in a throw. The
  //     seven are listed as links so a typo is one click from being fixed,
  //     which is the whole reason this is a parameter and not seven pages.
  if (discipline === null) {
    return (
      <div className="space-y-3" data-testid="vsf-unknown-discipline">
        <Link to="/reports" className="text-[12px] text-de hover:underline">
          ← Reports
        </Link>
        <h1 className="text-lg font-display font-extrabold text-text">
          Schedule Forecast
        </h1>
        <p className="text-[12px] text-muted">
          “{searchParams.get('discipline')}” is not one of the disciplines we
          track. Pick one:
        </p>
        <ul className="text-[12px] space-y-0.5">
          {FORECAST_DISCIPLINES.map((d) => (
            <li key={d}>
              <Link
                to={`/reports/vendor-forecast?discipline=${d}`}
                className="text-de hover:underline"
                data-testid={`vsf-discipline-link-${d}`}
              >
                {d} Schedule Forecast
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
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
          <h1
            className="text-lg font-display font-extrabold text-text mt-1"
            data-testid="vsf-heading"
          >
            {discipline} Schedule Forecast
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

      {/* ★★ fix-499 §B: SAY WHICH LIST THIS IS ADDRESSED FROM. Settings holds a
          recipient entry for `structural` only, so six of the seven forecasts
          fall back to the directory's contact address — and a draft addressed
          from a source the sender did not choose is how the wrong person gets a
          schedule. */}
      {recipients.source === 'directory' ? (
        <Banner testid="vsf-recipients-from-directory" tone="warn">
          Using the {discipline} contact from the External Team directory —
          Settings → Reporting has no recipient list for this discipline yet.
        </Banner>
      ) : null}

      {recipients.to.length === 0 ? (
        <Banner testid="vsf-no-recipients" tone="warn">
          No recipients are configured for this discipline, and no directory
          firm has a contact email. Add them in Settings → Reporting, or fill in
          the firm's contact in Settings → External Team.
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
  // ★★★ fix-499 §C — FIVE COLUMNS AND NOTHING ELSE. Bobby: *"here's your
  //     dates, here's your address, here's your unit, here's your unit type."*
  //     Start week and Jurisdiction stopped being columns; the Reuse column and
  //     its notes went entirely.
  // ★ Start week still drives change detection and the ledger, so a start-week
  //   move renders as a sub-line under the address — dropping a column must
  //   never drop a signal.
  return (
    <table className="w-full border-collapse mb-4">
      <thead>
        <tr style={{ background: 'var(--color-s2)' }}>
          <th className={TH}>Address</th>
          {/* ★★ fix-367 §2: the SCOPE, so the firm can plan against it rather
              than only knowing when it lands. Two columns, not one combined
              "Scope": an empty units and an empty type are different gaps, and
              merging them would hide whichever is missing. */}
          <th className={TH}>Units</th>
          <th className={TH}>Type</th>
          {/* fix-269: a TARGET SEND date — the date we are committing to hand
              documents over, not one we observed. ★ fix-499: the round's
              est_send when somebody stated one, the schedule's derived date
              when nobody has. */}
          <th className={TH}>Target send</th>
          {/* ★ fix-499: the round's est_recd. Blank stays blank. */}
          <th className={TH}>Expected back</th>
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
              {r.address}
              {/* fix-269: target send passed with nothing sent. Text marker, not
                  colour — it has to read the same in Outlook as it does here. */}
              {r.overdue ? (
                <span
                  className="ml-1 text-[10px] font-bold text-text"
                  data-testid={`vsf-overdue-${idPrefix}-${r.projectId}`}
                >
                  [OVERDUE — target send was {r.targetSend}, not yet sent]
                </span>
              ) : null}
              {r.holdReason ? (
                <span
                  className="ml-1 text-[10px] font-bold"
                  style={{ color: 'var(--color-hold-text, #8a6d00)' }}
                  data-testid={`vsf-hold-${r.projectId}`}
                >
                  [ON HOLD — {r.holdReason}]
                </span>
              ) : null}
              {/* ★★ fix-499: start week and status are no longer COLUMNS, so
                  their deltas live here. The Changes section exists to show
                  what moved. */}
              {showDelta &&
              r.previous &&
              (r.previous.startWeek ?? '') !== (r.startWeek ?? '') ? (
                <div
                  className="text-[11px] text-muted mt-0.5"
                  data-testid={`vsf-${idPrefix}-startweek-delta-${r.projectId}`}
                >
                  Start week:{' '}
                  <Delta from={r.previous.startWeek} to={r.startWeek} />
                </div>
              ) : null}
              {showDelta &&
              r.previous &&
              (r.previous.status ?? '') !== (r.status ?? '') ? (
                <div className="text-[11px] text-muted mt-0.5">
                  Status: <Delta from={r.previous.status} to={r.status} />
                </div>
              ) : null}
            </td>
            {/* ★ fix-367 §2. `Cell` already renders <Blank /> for null or '' —
                fix-269's rule: "the visible gap is what prompts someone to
                fill it in", never the word "Unknown". */}
            <td className={TD} data-testid={`vsf-${idPrefix}-units-${r.projectId}`}>
              <Cell value={formatUnits(r.units)} />
            </td>
            <td className={TD} data-testid={`vsf-${idPrefix}-types-${r.projectId}`}>
              <Cell value={formatProductTypes(r.productTypes)} />
            </td>
            <td className={TD}>
              {showDelta && r.previous ? (
                <Delta from={r.previous.targetSend} to={r.targetSend} />
              ) : (
                <Cell value={r.targetSend} />
              )}
            </td>
            <td
              className={TD}
              data-testid={`vsf-${idPrefix}-expected-${r.projectId}`}
            >
              <Cell value={r.expectedBack} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Section 4 — sent, awaiting return. No permit column: a transmit is a
 *  project-level design handoff, not permit-scoped work.
 *
 *  ★ fix-499 §C: the same five columns the schedule tables have, with `Sent`
 *  where they carry `Target send`. ★ The key is the PROJECT now, not a task id:
 *  the row comes from the project's one current round. */
function TransmittedTable({ rows }: { rows: VendorTransmitRow[] }) {
  return (
    <table className="w-full border-collapse mb-4">
      <thead>
        <tr style={{ background: 'var(--color-s2)' }}>
          <th className={TH}>Address</th>
          <th className={TH}>Units</th>
          <th className={TH}>Type</th>
          <th className={TH}>Sent</th>
          <th className={TH}>Expected back</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.projectId}
            className="border-t"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`vsf-transmitted-row-${r.projectId}`}
          >
            <td className={TD}>
              <Cell value={r.address} />
            </td>
            <td className={TD}>
              <Cell value={formatUnits(r.units)} />
            </td>
            <td className={TD}>
              <Cell value={formatProductTypes(r.productTypes)} />
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
        {/* fix-271: task text dropped — it is the string we stopped trusting,
            and it reads as noise to the vendor. Permit type replaces it. */}
        <tr style={{ background: 'var(--color-s2)' }}>
          <th className={TH}>Address</th>
          <th className={TH}>Jurisdiction</th>
          <th className={TH}>Permit type</th>
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
              <Cell value={r.juris} />
            </td>
            <td className={TD}>
              <Cell value={r.permit} />
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
