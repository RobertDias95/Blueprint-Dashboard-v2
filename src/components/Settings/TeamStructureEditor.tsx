import { useMemo, useState } from 'react';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import {
  describeDmMove,
  useDmMovePreview,
  useSetDmForDa,
} from '../../hooks/useSetDmForDa';
import { useOpenTaskCounts } from '../../hooks/useOpenTaskCounts';
import { unmappedActiveDas } from '../../lib/dmCoAssign';
import type { TeamMember, DmDaGroupRow } from '../../lib/database.types';

// Q7.3.b: DM/DA grouping editor. Each DM gets a card showing the DAs
// currently assigned, with a "move to..." dropdown per DA + remove button.
// Also a free DA picker at the bottom of each card. Mirrors v1's
// renderTeamStructureAdmin (index.html 6752-6827).
//
// Unassigned DAs (warning row) and former-DA cleanup live in AdminTeamTab,
// not here — this component is just the (DM × DAs) matrix.
//
// ★★★ fix-346 §2: THIS TABLE NOW ROUTES TASKS, NOT JUST DRAW-SCHEDULE COLUMNS.
// A task assigned to a DA listed here is automatically co-assigned to the DM
// whose card they sit on (`bp_trg_task_coassign_dm`). A DA who is on nobody's
// card gets no co-assignee — Bobby's call: "skip them", never invent a manager.
//
// ★★ THE CONDITION WAS THAT THE SKIP MUST NOT BE SILENT, and this is where it
// is said. The unassigned row below was already here counting a different cost
// (no draw-schedule column); it now also names what the missing mapping costs
// in tasks, with each person's OPEN TASK COUNT — because "Cam is unassigned"
// and "Cam is unassigned and holds 17 open tasks nobody's manager is seeing"
// are different sentences, and only the second one gets acted on.
//
// ===========================================================================
// ===========================================================================
// ★★★ fix-617 — AND NOW THE DRAW SCHEDULE FOLLOWS
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-01: **"Settings decides; the Draw Schedule follows."**
//
// Everything the fix-401 header below describes was true and is now fixed at the
// source: a move here writes `dm_da_groups` AND sets `group_label` on that DA's
// layout rows for the current quarter and every later one, in ONE server call
// (`bp_set_dm_for_da`). Past quarters are history and stay as they were.
//
// ★★ THE OTHER EDITOR NO LONGER OFFERS THE CHOICE AT ALL. The Draw Schedule
//    Layout editor shows a DA column's group read-only, with a link back here —
//    so there is one place to answer "who manages this person", which is what
//    makes the two stop disagreeing.
//
// ★ The move is confirmed, with counts, because it is not only an org chart
//   edit: fix-379's trigger derives `permits.dm` from this list and fix-346's
//   adds the DM as a task co-assignee. The dialog says so in plain words.
//
// ---------------------------------------------------------------------------
// ★★★ fix-401 — TWO EDITORS ON THIS TAB LOOK LIKE THEY MOVE A DA. THEY DO NOT
// ===========================================================================
//
// Bobby, 2026-08-25: *"The settings UI is not rendering accurately,
// specifically our draw schedule. Eric has now moved teams to Derry and no
// longer under Jade."* Measured that day, the two tables DISAGREED:
//
//   draw_schedule_quarter_layout (2026-Q3, pos 6)   Erick → group 'Derry'
//   dm_da_groups                                    Erick → 'Jade'
//
// ★★★ THIS EDITOR IS THE ONE THAT MATTERS, and it is not the one that looks
// like the draw schedule. `dm_da_groups` is what fix-379 derives `permits.dm`
// from, what fix-365's board lens groups by, what fix-346/368 co-assign from,
// and what the wizard routes on. `QuarterLayoutEditor` — sitting a few sections
// above, titled "Draw Schedule Layout" — writes
// `draw_schedule_quarter_layout`, which is COLUMN ORDER AND LABELS for one
// quarter's grid and reaches none of that.
//
// ★★ So moving somebody in the layout editor renames a column heading and
// changes nothing about who manages them. Both edits are legitimate; they
// answer different questions, and the layout one is the one you reach for when
// you are thinking about the draw schedule. fix-401 fixed Erick's mapping here
// and left the layout alone — it already said Derry.
//
// ★ THE NEXT TEAM MOVE STARTS HERE, not there. If a future ticket wants one
// action to do both, that is a product decision about which table is the
// source of truth — not a wiring fix.

// ===========================================================================
// ★★★ fix-407 — THE CHIPS SAID EVERY MAPPED DA WAS CURRENT
// ===========================================================================
//
// Bobby, 2026-08-26, on this exact screen: *"why are these DA's under jade?
// they arent active anymore? and they arent on the drawschedule anymore. this
// is what i meant by a wholistic clean, organization, and revamp of the
// settings to ensure our ecosystem is update to date and aligned."*
//
// ★★★ THE CHIPS RENDER `dm_da_groups` ROWS, NOT ROSTER MEMBERS. That is the
// whole bug in one sentence. `addableDas` has always been `activeDas`, so no
// retired DA could be ADDED — but the rows already there were drawn from the
// mapping table with no reference to the roster at all, in the same amber chip
// as everyone else. Alex and Nidhi (both `former`) sat under Jade looking
// exactly as current as Erick.
//
// ★★ THEY ARE FLAGGED, NOT HIDDEN. Dropping a retired DA's chip would make the
// mapping look absent while `bp_trg_task_coassign_dm` still routes off it, and
// the row would never get cleaned up because nobody could see it. fix-321's
// rule, restated: CHOOSING is current-only, SHOWING is whatever is recorded.
//
// ★ The mapping row itself is NOT touched by this ticket. Who inherits Alex's
// and Nidhi's slots is a people decision; fix-407 reports it and Bobby rules.

interface Props {
  /** ★ fix-407: CURRENT DMs only (the hook now filters). Used for the cards and
   *  for the move-to dropdown, both of which are offers. */
  dms: TeamMember[];
  activeDas: TeamMember[];
  /** ★★ fix-407: names the roster explicitly says are retired — from
   *  `formerMemberNames`, so a name that is merely UNKNOWN to the roster (a
   *  legacy mapping, someone never added) is left alone rather than being
   *  flagged as departed. */
  retiredNames?: ReadonlySet<string>;
  readOnly?: boolean;
}

export default function TeamStructureEditor({
  dms,
  activeDas,
  retiredNames,
  readOnly = false,
}: Props) {
  const groupsQ = useDmDaGroups();
  const setDm = useSetDmForDa();
  // ★ The move somebody has asked for and not yet confirmed. `null` = no dialog.
  //   `dmName: null` is the UNMAP case, which is a real choice and not "nothing
  //   chosen" — hence a tagged object rather than two pieces of state.
  const [pending, setPending] = useState<{
    daName: string;
    dmName: string | null;
  } | null>(null);
  const preview = useDmMovePreview(pending?.daName ?? null, pending?.dmName ?? null);

  // index: dm_name → DA assignments (rows from dm_da_groups)
  const rowsByDm = useMemo(() => {
    const m = new Map<string, DmDaGroupRow[]>();
    for (const row of groupsQ.rows) {
      const list = m.get(row.dm_name) ?? [];
      list.push(row);
      m.set(row.dm_name, list);
    }
    return m;
  }, [groupsQ.rows]);

  // index: da_name → DmDaGroupRow (so a single DA only appears in ONE DM's
  // card; if data has dupes, the first row wins and the rest are ignored).
  const rowByDa = useMemo(() => {
    const m = new Map<string, DmDaGroupRow>();
    for (const row of groupsQ.rows) {
      if (!m.has(row.da_name)) m.set(row.da_name, row);
    }
    return m;
  }, [groupsQ.rows]);

  const assignedDaNames = useMemo(
    () => new Set(rowByDa.keys()),
    [rowByDa],
  );

  // ★ fix-346: the SHARED predicate, so this row and the trigger disagree about
  // nobody. `unmappedActiveDas` matches names trimmed + case-folded exactly as
  // `dmForDa` / `bp_dm_for_da` do — a roster name differing only in spacing is
  // routed by the rule, so it must not be reported here as a gap.
  const unassignedNames = useMemo(
    () => unmappedActiveDas(activeDas.map((d) => d.name), groupsQ.rows),
    [activeDas, groupsQ.rows],
  );
  const unassigned = useMemo(
    () => activeDas.filter((da) => unassignedNames.includes(da.name)),
    [activeDas, unassignedNames],
  );
  const openCountsQ = useOpenTaskCounts(unassignedNames);

  const isRetired = (name: string) => retiredNames?.has(name) ?? false;

  /** ★★ fix-407: the cards to draw — every CURRENT DM, plus any DM who is not
   *  current but still holds mappings. Rendering only `dms` would silently drop
   *  a whole card the day a manager leaves, taking their DAs' mappings out of
   *  sight while the co-assign trigger kept using them. Measured on prod
   *  2026-08-25 no DM is inactive, so this draws nothing extra today — it is
   *  the same "flag, never hide" rule the chips follow, applied one level up. */
  const dmCards = useMemo(() => {
    const shown = new Set(dms.map((d) => d.name));
    const extra = [...rowsByDm.keys()]
      .filter((n) => !shown.has(n))
      .sort((a, b) => a.localeCompare(b));
    return [
      ...dms.map((d) => ({ key: d.id, name: d.name, current: true })),
      ...extra.map((n) => ({ key: `orphan-${n}`, name: n, current: false })),
    ];
  }, [dms, rowsByDm]);

  // ★★★ ONE WRITE PATH FOR ALL THREE VERBS. Add, move and remove were three
  //     different mutations (insert / update / delete) against one table; they
  //     are now one question — "who does this DA report to?" — asked of one
  //     server function. `null` is the answer "nobody", which is what remove
  //     means, so remove stops being a different kind of operation.
  //
  // ★★ AND NONE OF THEM WRITES DIRECTLY ANY MORE: each one opens the confirm
  //    dialog, because each one can move a permit's derived DM and a task's
  //    co-assignee. A silent org-chart edit with that reach is the thing §A.4
  //    exists to stop.
  function askMove(da: string, toDm: string | null) {
    if (!da) return;
    const existing = rowByDa.get(da);
    if (existing && (existing.dm_name ?? null) === toDm) return;
    setPending({ daName: da, dmName: toDm });
  }

  function confirmMove() {
    if (!pending) return;
    setDm.mutate(
      { daName: pending.daName, dmName: pending.dmName },
      { onSuccess: () => setPending(null) },
    );
  }

  return (
    <div className="space-y-3" data-testid="team-structure-editor">
      <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
        Team Structure — Draw Schedule Groups
      </div>
      <p className="text-xs text-muted">
        Assign DAs to DMs. Drives draw-schedule column grouping, automatic
        project assignment for new permits, and the DM co-assignee added to new
        tasks assigned to a DA listed here.
      </p>

      {dmCards.map((dm) => {
        const dmRows = rowsByDm.get(dm.name) ?? [];
        const addableDas = activeDas.filter(
          (da) => !dmRows.some((r) => r.da_name === da.name),
        );
        const retiredHere = dmRows.filter((r) => isRetired(r.da_name));
        return (
          <div
            key={dm.key}
            className="bg-surface-2 border border-border rounded-lg p-3"
            data-testid={`team-dm-card-${dm.name}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-display font-bold text-xs text-text">
                {dm.name}
              </span>
              {!dm.current && (
                <span
                  className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-surface border border-border text-muted"
                  title="This Design Manager is no longer on the active roster, but still holds DA mappings"
                  data-testid={`team-dm-card-inactive-${dm.name}`}
                >
                  Inactive
                </span>
              )}
              <span className="text-[10px] text-dim">
                {dmRows.length} DA{dmRows.length === 1 ? '' : 's'}
              </span>
              {retiredHere.length > 0 && (
                <span
                  className="text-[10px] text-muted"
                  data-testid={`team-dm-card-retired-count-${dm.name}`}
                >
                  · {retiredHere.length} inactive
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {dmRows.length === 0 && (
                <span className="text-[11px] text-dim italic">
                  No DAs assigned
                </span>
              )}
              {dmRows.map((row) => {
                const retired = isRetired(row.da_name);
                return (
                <span
                  key={row.id}
                  // ★★★ fix-407: the retired treatment is the ALUMNI PILL'S,
                  //   lifted verbatim from the "Former DAs" section a few
                  //   sections below — `bg-surface border-border text-muted`
                  //   against the live chip's amber. Extending the existing
                  //   visual rather than inventing a third state is the brief's
                  //   own instruction, and it means somebody who has learned
                  //   what a grey pill means downstairs already knows.
                  className={
                    retired
                      ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-border text-[11px]'
                      : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-co-bg border border-co-border text-[11px]'
                  }
                  data-testid={`team-da-chip-${row.da_name}`}
                  data-inactive={retired ? 'true' : undefined}
                >
                  <span
                    className={
                      retired
                        ? 'text-muted font-semibold line-through decoration-dim/60'
                        : 'text-co font-semibold'
                    }
                  >
                    {row.da_name}
                  </span>
                  {retired && (
                    // ★ The word, not only the colour. A greyed pill reads as
                    //   "disabled" or "not selected" as easily as "left the
                    //   company"; the label removes the guess, and the title
                    //   says what it costs to leave the row in place.
                    <span
                      className="text-[9px] uppercase tracking-wide font-bold text-muted"
                      title="No longer on the active roster — this mapping still routes draw-schedule grouping and DM co-assignment"
                      data-testid={`team-da-chip-inactive-${row.da_name}`}
                    >
                      Inactive
                    </span>
                  )}
                  {!readOnly && dms.length > 1 && (
                    <select
                      value={dm.current ? dm.name : ''}
                      onChange={(e) => askMove(row.da_name, e.target.value || null)}
                      className="text-[10px] bg-transparent border-none text-dim outline-none cursor-pointer"
                      title="Move to different DM"
                      data-testid={`team-da-move-${row.da_name}`}
                    >
                      {/* ★★ fix-407: an inactive DM's card can still hold rows,
                          and this select must show SOMETHING for it without
                          offering it as a destination — so the current card
                          gets a disabled placeholder and the options stay
                          current-only. */}
                      {!dm.current && (
                        <option value="" disabled>
                          {dm.name} (inactive)
                        </option>
                      )}
                      {dms.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {!readOnly && (
                    <button
                      onClick={() => askMove(row.da_name, null)}
                      className="text-dim hover:text-text text-sm leading-none pl-0.5"
                      title="Remove DA from group"
                      data-testid={`team-chip-remove-${row.da_name}`}
                    >
                      ×
                    </button>
                  )}
                </span>
                );
              })}
            </div>
            {retiredHere.length > 0 && (
              // ★★ fix-407: what the flag COSTS, said once per card. A chip
              //   that only looks different is a curiosity; a line naming what
              //   the row still drives is something somebody acts on.
              <div
                className="text-[10px] text-muted mb-2"
                data-testid={`team-dm-card-retired-note-${dm.name}`}
              >
                {retiredHere.map((r) => r.da_name).join(', ')}{' '}
                {retiredHere.length === 1 ? 'is' : 'are'} no longer on the active
                roster. The mapping still drives draw-schedule grouping and the
                Design Manager co-assignee — reassign or remove it once you have
                decided who inherits their work.
              </div>
            )}
            {!readOnly && addableDas.length > 0 && (
              <div className="flex gap-1.5">
                <select
                  className="text-xs px-2 py-1 border border-border rounded bg-bg text-text flex-1"
                  data-testid={`team-add-da-select-${dm.name}`}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      askMove(v, dm.name);
                      e.currentTarget.value = '';
                    }
                  }}
                >
                  <option value="">Add DA to {dm.name}…</option>
                  {addableDas.map((da) => (
                    <option key={da.id} value={da.name}>
                      {da.name}
                      {assignedDaNames.has(da.name) ? ' (move)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div
          className="px-3 py-2 text-[11px] text-co bg-co-bg/40 border border-co-border rounded-md space-y-1"
          data-testid="team-unassigned-warning"
        >
          <div>
            ⚠ Unassigned DAs (not on draw schedule):{' '}
            {unassigned.map((d) => d.name).join(', ')}
          </div>
          {/* ★★ fix-346 §2: the second cost of the same missing row, named with
              the number that makes it worth fixing. One line per person, so a
              name cannot hide in a list. */}
          <div data-testid="team-unmapped-coassign-warning">
            Their tasks get <strong>no Design Manager co-assignee</strong> —
            there is no manager to derive. Assign each to a DM above to turn it
            on (existing tasks are not changed):
            <ul className="mt-0.5 ml-3 list-disc">
              {unassigned.map((d) => {
                const n = openCountsQ.data?.[d.name];
                return (
                  <li key={d.id} data-testid={`team-unmapped-da-${d.name}`}>
                    {d.name}
                    {n === undefined
                      ? ''
                      : ` — ${n} open task${n === 1 ? '' : 's'}`}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      {/* ═══ ★★★ §A.4 — THE CONFIRM, AND WHY IT EXISTS ═══

          Moving a DA between managers is not only an org-chart edit. The
          fix-379 trigger derives `permits.dm` from this list, and fix-346’s
          adds the DM as a co-assignee on tasks assigned to that DA. So the
          move reaches work somebody is doing today, and the dialog says so
          with the counts rather than leaving it to be discovered.

          ★★ THE COUNTS COME FROM THE SERVER (`bp_preview_dm_move`), using the
             app’s own "open" definition — fix-245’s `isPermitDone` minus
             fix-264’s cancelled projects. A dialog that counted from a stale
             client cache would promise a number no other screen shows.

          ★ NO BACKDROP CLICK AND NO ESCAPE — fix-411 §1’s rule. This is a
            confirm, so the two exits are Cancel and the button that does it. */}
      {pending && (
        <div
          className="fixed inset-0 z-[9000] flex items-start justify-center pt-24 px-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          data-testid="dm-move-confirm"
        >
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-[460px] p-5">
            <h2 className="text-sm font-display font-extrabold text-text m-0 mb-2">
              {pending.dmName
                ? `Move ${pending.daName} to ${pending.dmName}?`
                : `Remove ${pending.daName} from their design manager?`}
            </h2>
            <p
              className="text-[12px] text-muted m-0 mb-3 leading-relaxed"
              data-testid="dm-move-consequence"
            >
              {preview.isLoading
                ? 'Checking what this moves…'
                : describeDmMove(preview.data ?? null)}
            </p>
            {setDm.error && (
              <p
                className="text-[11px] m-0 mb-3"
                style={{ color: 'var(--color-co)' }}
                data-testid="dm-move-error"
              >
                {setDm.error.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="text-[12px] px-3 py-1.5 rounded border border-border text-muted hover:text-text"
                data-testid="dm-move-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMove}
                disabled={setDm.isPending || preview.isLoading}
                className="text-[12px] px-3 py-1.5 rounded border border-de text-de font-semibold disabled:opacity-40"
                data-testid="dm-move-confirm-btn"
              >
                {setDm.isPending ? 'Moving…' : 'Move them'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
