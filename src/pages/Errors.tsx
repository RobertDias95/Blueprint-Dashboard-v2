import { useState } from 'react';
import {
  useErrorGroups,
  useUpdateErrorGroupStatus,
  type ErrorGroup,
  type ErrorGroupStatus,
} from '../hooks/useErrorReports';
import { pushToast } from '../stores/toastStore';
import MissedScrapeTriageEntry from '../components/MissedScrapeTriageEntry';

// fix-87: Settings → Errors page. Three tabs (Active / Resolved / All); the
// row list groups occurrences by server-computed fingerprint so the same
// bug across multiple users/sessions collapses into one actionable row.
// Per-row actions: queue for fix (sets status='queued' and optionally
// captures a backlog slug), mark resolved, dismiss. Click anywhere on
// the row expands a panel with the full sample context + first/last
// seen + a copy-bug-report button.

type Tab = 'active' | 'resolved' | 'all';

const TAB_STATUSES: Record<Tab, ErrorGroupStatus[]> = {
  active: ['new', 'queued', 'in_progress'],
  resolved: ['resolved', 'dismissed'],
  all: ['new', 'queued', 'in_progress', 'resolved', 'dismissed'],
};

const SOURCE_LABEL: Record<ErrorGroup['source'], string> = {
  frontend_toast: 'Toast',
  frontend_exception: 'JS',
  backend_rpc: 'RPC',
  scraper: 'Scraper',
};

const SOURCE_CLASS: Record<ErrorGroup['source'], string> = {
  frontend_toast: 'bg-co-bg text-co border-co-border',
  frontend_exception: 'bg-co-bg/60 text-co border-co-border',
  backend_rpc: 'bg-jv-bg text-jv border-jv-border',
  scraper: 'bg-de-bg text-de border-de-border',
};

const STATUS_LABEL: Record<ErrorGroupStatus, string> = {
  new: 'New',
  queued: 'Queued',
  in_progress: 'In progress',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

const STATUS_CLASS: Record<ErrorGroupStatus, string> = {
  new: 'bg-co-bg text-co border-co-border',
  queued: 'bg-jv-bg text-jv border-jv-border',
  in_progress: 'bg-de-bg text-de border-de-border',
  resolved: 'bg-pm-bg text-pm border-pm-border',
  dismissed: 'bg-s2 text-dim border-border',
};

export default function ErrorsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const statuses = TAB_STATUSES[tab];
  const groupsQ = useErrorGroups(statuses);
  const groups = groupsQ.data ?? [];

  return (
    <div className="space-y-3" data-testid="errors-page">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-display font-extrabold text-text m-0">
            Error triage
          </h1>
          {/* ★★★ fix-438 C1: it is not "the app + scraper" any more. Bobby's
              ruling — Error Triage keeps BRIDGE errors. A scraper condition is
              one self-clearing row that reaches its ENT lead as a
              notification; scraper housekeeping reaches nobody. */}
          <p className="text-[11px] text-dim m-0 mt-0.5">
            Errors the Bridge itself hit, grouped by signature. Queue the ones
            worth fixing; dismiss the noise. Permit conditions are not errors —
            they reach the entitlement lead as a notification.
          </p>
        </div>
        {/* ★★★ fix-485 §B (P-137) — THIS IS NOT A TAB STRIP, AND IT USED TO
            SAY IT WAS.

            It carried `role="tablist"` / `role="tab"` / `aria-selected` while
            controlling **a filter over one view**, not which of several views
            is showing — and there is no `tabpanel` anywhere near it. To a
            screen reader that is a promise the app does not keep: "tab" says
            the content below is one of N panels you can switch between, and
            what actually happens is that one list re-filters.

            ★★ SO THE ROLE IS CORRECTED, NOT THE CONTROL. `role="group"` with
            `aria-pressed` buttons is what a set of filter chips is, and it is
            the vocabulary `HoldFilter` and fix-483's `ToggleChip` already use.
            Nothing moves on screen — not one class or colour changed.

            ★ AND IT IS DELIBERATELY NOT CONVERTED TO `TabStrip`. fix-483's
              inventory made the same call about the same family: a chip group
              choosing a filter is a different control from a strip choosing a
              sibling view, and forcing one into the other would be a
              consistency that costs meaning. */}
        <div
          className="flex gap-1"
          role="group"
          aria-label="Error status filter"
          data-testid="errors-tabs"
        >
          {(['active', 'resolved', 'all'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`text-[11px] font-display font-semibold px-3 py-1 rounded border transition ${
                tab === t
                  ? 'bg-surface border-de text-text'
                  : 'bg-transparent border-border text-muted hover:text-text'
              }`}
              data-testid={`errors-tab-${t}`}
            >
              {t === 'active' ? 'Active' : t === 'resolved' ? 'Resolved' : 'All'}
            </button>
          ))}
        </div>
      </header>

      {/* ★★★ fix-433 §C2 — ONE system-level entry, DERIVED, above the list.
          It is not a member of `groups` and never will be: there is no stored
          row behind it, so it has no fingerprint, no status and no actions.
          The list below — its rows, its grouping, its empty state — is
          untouched. Hidden on the Resolved tab because a condition that is
          currently TRUE has not been resolved by anyone. */}
      {tab !== 'resolved' && <MissedScrapeTriageEntry />}

      {groupsQ.isLoading ? (
        <div className="text-[11px] text-dim italic">Loading…</div>
      ) : groups.length === 0 ? (
        <div
          className="text-[11px] text-dim italic py-4 text-center bg-surface border border-border rounded-lg"
          data-testid="errors-empty"
        >
          No errors in this view. Quiet sky.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="errors-list">
          {groups.map((g) => (
            <ErrorGroupRow key={g.fingerprint} group={g} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorGroupRow({ group }: { group: ErrorGroup }) {
  const [expanded, setExpanded] = useState(false);
  const updateStatus = useUpdateErrorGroupStatus();

  function queueForFix() {
    const ref = window.prompt(
      'Backlog ref (e.g. fix-88) — optional, hit Cancel to skip',
      group.backlog_ref ?? '',
    );
    // window.prompt → null on Cancel, '' on empty submit. Cancel keeps
    // the current backlog_ref; empty string passes through as null so
    // the user can intentionally clear it.
    if (ref === null) {
      updateStatus.mutate({
        fingerprint: group.fingerprint,
        newStatus: 'queued',
      });
    } else {
      updateStatus.mutate({
        fingerprint: group.fingerprint,
        newStatus: 'queued',
        backlogRef: ref === '' ? null : ref,
      });
    }
  }
  function markResolved() {
    updateStatus.mutate({
      fingerprint: group.fingerprint,
      newStatus: 'resolved',
    });
  }
  function dismiss() {
    updateStatus.mutate({
      fingerprint: group.fingerprint,
      newStatus: 'dismissed',
    });
  }
  function copyReport() {
    const lines = [
      `### ${group.sample_message}`,
      ``,
      `- **Source:** ${SOURCE_LABEL[group.source]}`,
      `- **Level:** ${group.level}`,
      `- **Status:** ${STATUS_LABEL[group.status]}`,
      `- **Count:** ${group.count} occurrences across ${group.user_count} user(s)`,
      // ★ fix-338: a bug report that omits "this was fixed once and came back"
      // sends somebody to re-do the same investigation.
      ...(group.recurred
        ? [
            `- **★ Recurred:** yes — ${group.resolved_count} occurrence(s) already resolved, last on ${group.last_resolved_at ?? 'unknown'}`,
          ]
        : []),
      `- **First seen:** ${group.first_seen}`,
      `- **Last seen:** ${group.last_seen}`,
      `- **Fingerprint:** \`${group.fingerprint}\``,
      ``,
      `\`\`\`json`,
      JSON.stringify(group.sample_context ?? {}, null, 2),
      `\`\`\``,
    ];
    void navigator.clipboard
      ?.writeText(lines.join('\n'))
      .then(() => pushToast('Bug report copied to clipboard', 'success'))
      .catch(() => pushToast('Copy failed — see console', 'error'));
  }

  return (
    <li
      className="bg-surface border border-border rounded-lg"
      data-testid={`error-group-${group.fingerprint}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-s2 transition"
        aria-expanded={expanded}
        data-testid={`error-group-toggle-${group.fingerprint}`}
      >
        <span className="text-dim text-[10px] mt-0.5 select-none">
          {expanded ? '▾' : '▸'}
        </span>
        <span
          className={`text-[9px] font-display font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border ${SOURCE_CLASS[group.source]}`}
        >
          {SOURCE_LABEL[group.source]}
        </span>
        <span
          className={`text-[9px] font-display font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_CLASS[group.status]}`}
        >
          {STATUS_LABEL[group.status]}
        </span>
        {/* ★★ fix-338: "resolved before, and back again."
            Bobby said it days before anybody looked: "I just felt like they
            were already marked as resolved." He was right, and the page had no
            way to tell him — the resolved occurrences were filtered out before
            they could be counted. This is the difference between a new problem
            and a fix that did not hold, so it gets its own badge rather than a
            number somebody has to interpret. */}
        {group.recurred && (
          <span
            className="text-[9px] font-display font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-co-bg text-co border-co-border"
            title={
              group.last_resolved_at
                ? `Resolved ${relativeAgo(group.last_resolved_at)} and seen again since`
                : 'Resolved before and seen again since'
            }
            data-testid={`error-group-recurred-${group.fingerprint}`}
          >
            ↻ Recurred
          </span>
        )}
        <span className="flex-1 text-[12px] text-text leading-snug line-clamp-2">
          {group.sample_message}
        </span>
        {/* ★ fix-338: the count is now every occurrence, so when some of them
            were already triaged the split is shown rather than left implicit. */}
        <span
          className="text-[10px] font-mono text-dim whitespace-nowrap"
          data-testid={`error-group-counts-${group.fingerprint}`}
        >
          {group.count}×
          {group.resolved_count > 0 && ` (${group.resolved_count} resolved)`}
          {/* ★★★ fix-438 C2 — HOW MANY PERMITS, beside how many occurrences.
              The panel used to say "89 occurrences" over a sample naming ONE
              permit, and it was 89 permits once each: Bobby would have gone
              and investigated a permit that was never the problem. The two
              numbers together are the whole reading — 89× over 89 permits is a
              bad afternoon, 25× over 3 permits is three permits in trouble. */}
          {group.permit_count > 0 && (
            <span data-testid={`error-group-permits-${group.fingerprint}`}>
              {' · '}
              {group.permit_count === group.count && group.count > 1
                ? `${group.permit_count} permits, once each`
                : `${group.permit_count} permit${group.permit_count === 1 ? '' : 's'}`}
            </span>
          )}{' '}
          · {group.user_count}u · {relativeAgo(group.last_seen)}
        </span>
        {group.backlog_ref && (
          <span className="text-[10px] font-mono text-muted ml-1">
            {group.backlog_ref}
          </span>
        )}
      </button>
      {expanded && (
        <div
          className="border-t border-border px-3 py-2 flex flex-col gap-2"
          data-testid={`error-group-detail-${group.fingerprint}`}
        >
          <div className="text-[11px] text-muted whitespace-pre-wrap break-words">
            {group.sample_message}
          </div>
          <pre className="text-[10px] font-mono bg-bg border border-border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words m-0">
            {JSON.stringify(group.sample_context ?? {}, null, 2)}
          </pre>
          {/* ★★ fix-438 C2: the sample above is the FIRST occurrence now, not
              the newest — the newest is simply whichever permit the scraper
              reached last, which is the least representative row there is. So
              the dates say which is which rather than leaving the reader to
              assume. */}
          <div className="text-[10px] text-dim font-mono">
            sample is the first, {group.first_seen} · newest {group.last_seen}
          </div>
          <div className="flex gap-1.5 mt-1">
            <button
              type="button"
              onClick={queueForFix}
              disabled={updateStatus.isPending}
              className="text-[11px] px-2 py-1 rounded border border-jv-border bg-jv-bg/40 text-jv hover:opacity-90 disabled:opacity-50 transition"
              data-testid={`error-group-queue-${group.fingerprint}`}
            >
              Queue for fix
            </button>
            <button
              type="button"
              onClick={markResolved}
              disabled={updateStatus.isPending}
              className="text-[11px] px-2 py-1 rounded border border-pm-border bg-pm-bg/40 text-pm hover:opacity-90 disabled:opacity-50 transition"
              data-testid={`error-group-resolve-${group.fingerprint}`}
            >
              Mark resolved
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={updateStatus.isPending}
              className="text-[11px] px-2 py-1 rounded border border-border bg-s2 text-muted hover:text-text transition disabled:opacity-50"
              data-testid={`error-group-dismiss-${group.fingerprint}`}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={copyReport}
              className="text-[11px] px-2 py-1 rounded border border-border bg-transparent text-muted hover:text-text ml-auto transition"
              data-testid={`error-group-copy-${group.fingerprint}`}
            >
              Copy bug report
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** "3m" / "2h" / "5d" — compact relative time for the row strip. */
function relativeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
