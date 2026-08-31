import { useMemo } from 'react';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { useAllPermitTasks } from '../../hooks/useAllPermitTasks';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { isTaskLive } from '../../lib/taskStatus';
import { buildMissingLeadRows, type MissingLeadRow } from '../../lib/unclaimedWork';
import type { TeamMember } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-458 §A (P-106) — "PERMITS WITH NO ENTITLEMENT LEAD"
// ===========================================================================
//
// Beside fix-457's DA-routing panel and TeamStructureEditor's "⚠ Unassigned DAs",
// in the same shape. ★ THAT IS DELIBERATE AND THE BRIEF IS RIGHT TO INSIST ON
// IT: this is the third roster-gap surface in Settings → Team, and a third
// visual language for the same idea would make the screen harder to read than
// the gap it reports.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THE OPEN-TASK COUNT IS THE POINT OF THE ROW
// ---------------------------------------------------------------------------
//
// Measured 2026-08-30: 15 permits of 651 carry no lead, and 14 of them are
// swallowing open work — 17 tasks that reach nobody, twelve of them
// `results_ready` ("Permit approved / issued — send out approved plans"). The
// oldest has been open since 2026-06-25 on a permit issued 2026-03-19.
//
// ★★ A lead-less permit with no work is housekeeping; one with three is a
// client waiting. The count is what tells those apart, so it is the column the
// sort is keyed on.
//
// ★ THIS PANEL WRITES ONE FIELD AND NOTHING ELSE. It does not close a task,
// reassign one, or touch `permit_tasks` at all — the tasks reappear on somebody's
// My Tasks the moment the lead resolves, because fix-230's fallback was always
// correct and was only ever resolving to nobody.

interface Props {
  /** Current entitlement leads, deduped by person by useTeamMembers. Passed IN
   *  rather than fetched, so the panel works in a provider-less suite. */
  ents: readonly TeamMember[];
  readOnly: boolean;
}

export default function PermitsMissingLeadPanel({ ents, readOnly }: Props) {
  const permitsQ = usePermits();
  const projectsQ = useProjects();
  const tasksQ = useAllPermitTasks();
  const update = useUpdatePermit();

  const addressById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projectsQ.data ?? []) m.set(p.id, p.address ?? '(no address)');
    return m;
  }, [projectsQ.data]);

  const rows = useMemo(
    () =>
      buildMissingLeadRows(
        permitsQ.data ?? [],
        (id) => addressById.get(id) ?? '(unknown project)',
        tasksQ.data ?? [],
        isTaskLive,
      ),
    [permitsQ.data, addressById, tasksQ.data],
  );

  const loading = permitsQ.isLoading || projectsQ.isLoading || tasksQ.isLoading;
  const swallowed = rows.reduce((n, r) => n + r.unclaimedCount, 0);

  function setLead(row: MissingLeadRow, name: string) {
    if (name === '' || !row.updatedAt) return;
    update.mutate({
      permitId: row.permitId,
      projectId: row.projectId,
      expectedUpdatedAt: row.updatedAt,
      patch: { ent_lead: name },
      fieldLabel: 'Entitlement lead',
    });
  }

  if (loading) {
    return (
      <div className="text-xs text-muted" data-testid="missing-lead-loading">
        Loading permits…
      </div>
    );
  }

  // ★★ §A5: empty is the GOAL, so it says so rather than looking like a
  //    failure to load. Same choice as the Unclaimed switch vanishing at zero.
  if (rows.length === 0) {
    return (
      <div
        className="text-xs text-muted rounded border px-3 py-2"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="missing-lead-empty"
      >
        Every permit has an entitlement lead.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="permits-missing-lead">
      <div
        className="rounded border px-3 py-2 flex flex-col gap-0.5"
        style={{
          borderColor: 'var(--color-co-border)',
          background: 'var(--color-co-bg)',
        }}
      >
        <span className="text-[11px] font-bold" style={{ color: 'var(--color-co)' }}>
          ⚠ {rows.length} permit{rows.length === 1 ? '' : 's'} with no entitlement
          lead
        </span>
        <span className="text-[10px] text-muted">
          {swallowed === 0
            ? 'None of them is holding open work right now.'
            : `Between them they are holding ${swallowed} open task${swallowed === 1 ? '' : 's'} that reaches nobody — on no board and in no one's My Tasks.`}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div
            key={r.permitId}
            className="rounded border px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-[11px]"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`missing-lead-row-${r.permitId}`}
          >
            {/* ★ The count first, because it is the reason the row is worth
                reading — and it is the sort key (§A3). */}
            <span
              className="font-bold tabular-nums px-1.5 py-0.5 rounded min-w-[24px] text-center"
              style={{
                background:
                  r.unclaimedCount > 0 ? 'var(--color-co-bg)' : 'var(--color-s2)',
                color:
                  r.unclaimedCount > 0 ? 'var(--color-co)' : 'var(--color-muted)',
              }}
              title={
                r.unclaimedCount > 0
                  ? `${r.unclaimedCount} open task${r.unclaimedCount === 1 ? '' : 's'} on this permit currently reach nobody`
                  : 'No open work is stuck on this permit'
              }
              data-testid={`missing-lead-count-${r.permitId}`}
            >
              {r.unclaimedCount}
            </span>

            <span className="font-display font-bold text-text truncate max-w-[220px]">
              {r.address}
            </span>
            {/* ★ "no number yet" is a real state — a Pre-Submittal permit has
                not been given one — so it is said rather than left blank. */}
            <span className="font-mono text-dim">
              {r.num ?? 'no number yet'}
            </span>
            <span className="text-dim">{r.type ?? '—'}</span>
            <span className="text-dim truncate max-w-[140px]">{r.status ?? '—'}</span>
            <span className="text-dim">
              DA {r.da ?? '—'}
            </span>

            <span className="flex-1" />

            {readOnly ? (
              <span className="text-dim italic">no lead</span>
            ) : (
              // ★★ §A4: a ROSTER DROPDOWN, never free text. `team_members.name`
              //    is the frozen join key across ~1,850 references; a typed name
              //    differing by a space is a lead that resolves to nobody, which
              //    is the bug this panel exists to end.
              <select
                defaultValue=""
                disabled={update.isPending || !r.updatedAt}
                onChange={(e) => setLead(r, e.target.value)}
                className="text-[11px] border rounded px-1 py-0.5 bg-surface disabled:opacity-50"
                style={{ borderColor: 'var(--color-de)' }}
                data-testid={`missing-lead-set-${r.permitId}`}
              >
                <option value="">Set lead…</option>
                {ents.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
