// ★★ fix-337 §2 — "a person looking at a completed task should be able to tell
// it was cleared by the system because the permit moved on."
//
// ★ The BOT badge (fix-155) says why a task was CREATED and explicitly promises
// that auto-tasks are "NEVER auto-completed". That promise has an exception
// now, and it needs its own mark rather than a second meaning bolted onto the
// first — a task can carry both, and they say different things: 🤖 the scraper
// raised this, ⏱ the system closed it.
//
// ★ It renders on RESOLVED rows only, because that is the only state in which
// the sentence is true. Nothing else in the app writes the column.

// ★★★ fix-364 §1 — EVERY REASON, NOT JUST THE FIRST ONE.
//
// Found while checking the readers for the rename: this map had ONE entry, so
// all five of fix-355's `superseded_*` closures fell through to the generic
// "Closed automatically by the system." The badge never blanked — the fallback
// saw to that — but it also never said anything, which is the quieter version
// of the same failure and would have survived the rename unnoticed.
//
// ★ The wording is fix-355's own evidence sentence, in the tooltip's register:
// the rule that fired, in terms of what the CITY did, so a reader can check the
// judgement rather than take it.
const REASON_LABEL: Record<string, string> = {
  permit_issued:
    'Closed automatically: the permit was issued, so this work no longer applies. Nobody ticked it — reopen it if it still matters.',
  // ★★ fix-364 §1: RENAMED from `superseded_intake_accepted`, which described
  // the EVIDENCE and read like the rule Bobby excluded from fix-355 ("build it,
  // minus intake_accepted" — a different rule, which would have closed tasks
  // whose own job is intake_accepted). Two things, near-identical names, side
  // by side in one feed. One concept, one term.
  superseded_by_intake_acceptance:
    'Closed automatically: the city has since accepted intake on this permit, so this check has been overtaken. Reopen it if it still applies.',
  superseded_next_cycle:
    'Closed automatically: the permit has moved to a later review cycle. Reopen it if it still applies.',
  superseded_resubmitted:
    'Closed automatically: the city recorded our resubmission, so this round is done. Reopen it if it still applies.',
  superseded_status_matched:
    'Closed automatically: the dashboard now shows what the portal showed, so there is nothing left to reconcile.',
  superseded_number_present:
    'Closed automatically: the permit number is on file and the city has a submitted record of it.',
  // ★★ fix-395: the chase task's own two deaths. Both are the negation of its
  // mint gate — it is never minted into a condition that is already dead, so
  // these only ever fire on something that changed AFTER the task appeared.
  superseded_city_responded:
    'Closed automatically: the city has responded, so there is nothing left to chase. Reopen it if you still need to call them.',
  superseded_target_changed:
    'Closed automatically: the city moved its review target, so the date this task was chasing no longer exists. A new one is raised if the new target also passes.',
};

export default function AutoClosedBadge({
  taskId,
  reason,
}: {
  taskId: string;
  reason?: string | null;
}) {
  if (!reason) return null;
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5 flex-shrink-0"
      style={{
        background: 'var(--color-s2)',
        color: 'var(--color-muted)',
        border: '1px solid var(--color-border)',
      }}
      title={REASON_LABEL[reason] ?? 'Closed automatically by the system.'}
      data-testid={`auto-closed-badge-${taskId}`}
      data-reason={reason}
    >
      ⏱ SYSTEM
    </span>
  );
}
