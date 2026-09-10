import { useMemo, useState } from 'react';
import {
  CONSULTANT_PILL_COMPACT_MIN,
  consultantRowSplit,
} from '../../lib/projectCardLayout';
import BufferedDateInput from '../BufferedDateInput';
import { useExternalTeamDirectory } from '../../hooks/useExternalTeamDirectory';
import {
  useAddProjectConsultant,
  useConsultantRounds,
  useProjectConsultants,
  useSetConsultantDate,
  useSetConsultantFirm,
  useRemoveProjectConsultant,
  useSetConsultantPhase,
  useSetConsultantStatus,
} from '../../hooks/useProjectConsultants';
import {
  CONSULTANT_DATE_LABEL,
  CONSULTANT_DATE_SLOTS,
  FIXED_DISCIPLINES,
  nextStatus,
  consultantHasNothingToClear,
  seedConsultantDates,
  transitionAppends,
  type ConsultantCurrent,
  type ConsultantDateField,
  type ConsultantStatus,
} from '../../lib/consultants';
import type { PermitWithCycles } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-475 (P-116) — THE CONSULTANTS COLUMN
// ===========================================================================
//
// Bobby: *"are the consultants complete? are we waiting on consultants?"* —
// for ACQUISITIONS. Schedule Health answers "is the permit late"; nothing
// answered this, and it is what a land person asks before committing.
//
// The approved design is `overview_consultants_v6.html`. Bobby on the pill:
// *"literally just the type of consultant, the consultant name, the status,
// and two dates."*
//
// ---------------------------------------------------------------------------
// ★★★ THE ONE PLACE THIS DEPARTS FROM THE MOCK, AND IT IS MEASURED
// ---------------------------------------------------------------------------
// The mock draws the two dates SIDE BY SIDE. They stack here, because the mock
// draws them as plain text boxes it can size freely and the app cannot: every
// server-committing date goes through `BufferedDateInput`, which renders a
// native `<input type="date">` (fix-073's rule).
//
//     native date input @ 10.5px   103px      (harness/consultant-column-floor)
//     the mock's text box          140px      — a control the app does not ship
//
// Side by side the pair alone costs **252px of floor** against the **190px**
// `builder` vacates, and §3's rule is that `OVERVIEW_ROW_MIN_WIDTH` must not
// increase. Stacked, the floor is **144px** and the row minimum FALLS from 1218
// to 1172. Every ruled requirement survives — *"always two, always editable,
// same two slots on every pill"* says nothing about their arrangement — and the
// trade is height, which a list-shaped card has, for width, which the row has
// none of. See `overviewCardLayout.CONSULTANT_CARD_MIN_WIDTH`.

/** ★★ THE STATUS TINT. The only coloured object in the column — the mock is
 *  explicit that the pill's west edge carries no colour. Values are the app's
 *  own tokens, not the mock's inline hexes. */
const STATUS_STYLE: Record<ConsultantStatus, { bg: string; fg: string; bd: string }> = {
  Scheduled: { bg: 'var(--color-co-bg)', fg: 'var(--color-wa)', bd: 'var(--color-co-border)' },
  Pending: { bg: 'var(--color-de-bg)', fg: 'var(--color-de)', bd: 'var(--color-de-border)' },
  Received: { bg: 'var(--color-pm-bg)', fg: 'var(--color-ok)', bd: 'var(--color-pm-border)' },
};

// ===========================================================================
// ★★★ fix-506 §F (P-139, P-133) — THE CONSULTANTS CARD BECOMES A BAND
// ===========================================================================
//
// §A retires this as a CARD; its pills become a grid across the foot of the
// Team card. Bobby's rules, in order:
//
//   · **minimum four slots always** — an absent discipline shows an empty slot,
//     not a shorter grid.
//   · **Surveyor · Arborist · Structural · Civil are the first four, in that
//     order, left to right, top to bottom.** 5–8 are whatever the project has.
//   · odd counts **stretch the bottom row**: 5 goes 3+2, 7 goes 4+3.
//
// ★★★ THE PILL IS COMPACT NOW, AND THAT IS A MEASUREMENT, NOT A STYLE CHOICE.
//     fix-475 sized a pill for a 144px COLUMN — one per line, as many lines as
//     there are consultants — and stacked the two dates because two
//     `BufferedDateInput`s side by side cost 252px against a 190px budget. A
//     grid four across in a ~290px Team card gives each pill ~70px, so the
//     stacked-date pill cannot be the grid pill either. See
//     `lib/projectCardLayout` for the arithmetic.
//
// ★★★ SO THE DATES PRINT, AND EDIT IN A FLOATING PANEL. Bobby's exception to
//     the read-only overview is *"a consultant's status and two dates stay
//     editable on the overview"* — it is about the FIELDS, not the control. A
//     printed `05/01` is 36px; the panel that edits it is anchored to the pill
//     and sized independently, so `BufferedDateInput` keeps its honest 103px
//     and fix-073's rule (no raw `onChange` on a server-committing date) is
//     untouched.
//
// ★ AND THE STATUS IS A BUTTON, not the `<select>` it was. P-164 made the click
//   open a confirm; a `<select>` whose every option opens the same dialog is a
//   menu pretending to be a menu.

export function ConsultantBand({
  projectId,
  bp,
  manage = false,
}: {
  projectId: string;
  /** For the two seed dates only — see `seedConsultantDates`. */
  bp: PermitWithCycles | null;
  /**
   * ★★★ fix-508 §F2/§I — WHICH SURFACE THIS IS.
   *
   * `false` (the default, and the Project Overview): the firm is read-only
   * text and there is no add control except the one an empty fixed slot
   * offers. fix-506 ruled the overview read-only apart from a consultant's
   * status and two dates; §F2 is that ruling finally reaching the firm.
   *
   * `true` (Project Data's Consultants tab): the firm is a picker and the tab
   * grows the `+ Add consultant` / remove controls P-181 is about. The modal's
   * caption has claimed *"type and firm are chosen here"* since fix-506; this
   * is the prop that makes it true.
   */
  manage?: boolean;
}) {
  const listQ = useProjectConsultants(projectId);
  const dirQ = useExternalTeamDirectory();
  const add = useAddProjectConsultant(projectId);
  const [adding, setAdding] = useState(false);

  // ★ Both memoised: a bare `?? []` is a NEW array every render, which makes
  //   the `useMemo` below re-run every time and is what the React Compiler
  //   lint rule is pointing at.
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const firms = useMemo(() => dirQ.data ?? [], [dirQ.data]);

  /** ★ Disciplines come from the DIRECTORY, never from a list typed here —
   *  fix-474's rule, so an eighth discipline needs no code change. Already-used
   *  ones drop out: one consultant per discipline is the DB's unique key, and
   *  offering a duplicate would just raise. */
  const available = useMemo(() => {
    const taken = new Set(rows.map((r) => r.discipline.toLowerCase()));
    const all = new Set(firms.filter((f) => f.active).map((f) => f.discipline));
    return [...all].filter((d) => !taken.has(d.toLowerCase())).sort();
  }, [firms, rows]);

  const seeds = useMemo(
    () =>
      seedConsultantDates({
        ddEnd: bp?.dd_end ?? null,
        targetSubmit: bp?.target_submit ?? null,
      }),
    [bp?.dd_end, bp?.target_submit],
  );

  /** ★ Bobby's fixed four, then everything else in discipline order. An
   *  absent fixed discipline holds its SLOT — that is what makes the grid
   *  readable at a glance across projects, which is the whole point of fixing
   *  the order. */
  const slots = useMemo(() => {
    const byDiscipline = new Map(rows.map((r) => [r.discipline.toLowerCase(), r]));
    const fixed = FIXED_DISCIPLINES.map((d) => byDiscipline.get(d.toLowerCase()) ?? null);
    const rest = rows
      .filter((r) => !FIXED_DISCIPLINES.some((d) => d.toLowerCase() === r.discipline.toLowerCase()))
      .sort((x, y) => x.discipline.localeCompare(y.discipline));
    const list: (ConsultantCurrent | null)[] = [...fixed, ...rest];
    // ★ `max(4, n)` — the minimum is four SLOTS, and a project with six real
    //   consultants gets six, not four.
    while (list.length < 4) list.push(null);
    return list;
  }, [rows]);

  const { top, bottom } = consultantRowSplit(slots.length);
  const lines = [slots.slice(0, top), slots.slice(top, top + bottom)];

  return (
    <div
      className="border-t"
      style={{ borderTopColor: 'var(--color-border)' }}
      data-testid="pd-consultant-band"
      data-slot-count={String(slots.length)}
      data-split={`${top}+${bottom}`}
    >
      {lines.map((line, li) =>
        line.length === 0 ? null : (
          <div
            key={li}
            className="flex flex-wrap"
            data-testid={`pd-consultant-row-${li}`}
          >
            {line.map((row, i) => (
              <div
                key={row ? row.consultant_id : `empty-${li}-${i}`}
                className="flex flex-col justify-center"
                // ★★ `flex: 1 1 <floor>` and NOT a grid of `repeat(k, 1fr)`:
                //    the ruled 3+2 / 4+3 split is the TARGET, and a grid of
                //    fixed track count CLIPS when the card is narrower than
                //    k pills. Flex with a declared basis renders the split
                //    wherever it fits and wraps to fewer per line where it does
                //    not — degrading to the one-per-line list fix-475 shipped.
                style={{ flex: `1 1 ${CONSULTANT_PILL_COMPACT_MIN}px`, minWidth: 0 }}
              >
                {row ? (
                  <ConsultantPill
                    projectId={projectId}
                    row={row}
                    firms={firms}
                    seeds={seeds}
                    manage={manage}
                  />
                ) : (
                  <EmptySlot
                    discipline={FIXED_DISCIPLINES[li * top + i] ?? null}
                    canAdd={available.length > 0}
                    onAdd={() => setAdding(true)}
                  />
                )}
              </div>
            ))}
          </div>
        ),
      )}

      {/* ★★★ fix-508 §I (P-181) — AN ADD CONTROL THAT DOES NOT NEED AN EMPTY
          SLOT. Bobby: he cannot add a fifth consultant.
          ★★★ STEP 0 DIAGNOSED IT BEFORE BUILDING, which is what §I asks for,
              and it is the first of the two cases: Project Data's Consultants
              tab renders `<ConsultantBand>` — the SAME component as the
              overview — so it shows all six of `233 31st Ave E`'s real
              consultants. **Nothing is hidden; the control is missing.**
          ★★★ AND THE REASON IS EXACT: `+ Add consultant` lived only inside
              `EmptySlot`, so it existed only while one of Bobby's fixed four
              (Surveyor · Arborist · Structural · Civil) was unfilled. Fill all
              four and the only way to add a fifth disappears — which is the
              state every mature project reaches.
          ★ It renders in `manage` mode only: the overview keeps the empty-slot
            affordance it has, because P-140 makes that surface read-only apart
            from a consultant's status and dates. */}
      {manage && !adding && available.length > 0 && (
        <div
          className="px-2 py-1.5 border-t"
          style={{ borderTopColor: 'var(--color-border)' }}
        >
          <button
            type="button"
            className="text-[11px] font-bold"
            style={{ color: 'var(--color-de)' }}
            onClick={() => setAdding(true)}
            data-testid="pd-consultant-add-open"
          >
            + Add consultant
          </button>
        </div>
      )}
      {/* ★ …and when every discipline the directory offers is already booked,
          the control says so rather than vanishing — a missing button is what
          P-181 was, and "nothing left to add" is a different sentence from
          "you cannot add". */}
      {manage && !adding && available.length === 0 && (
        <div
          className="px-2 py-1.5 border-t text-[10px] italic"
          style={{ borderTopColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          data-testid="pd-consultant-add-exhausted"
        >
          Every discipline in the firm directory is already on this project.
        </div>
      )}

      {adding && available.length > 0 && (
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 border-t"
          style={{ borderTopColor: 'var(--color-border)' }}
          data-testid="pd-consultant-add-row"
        >
          <select
            className="text-[11px] border rounded px-1.5 py-1 flex-1 min-w-0"
            style={{ borderColor: 'var(--color-border)' }}
            defaultValue=""
            onChange={(e) => {
              const discipline = e.target.value;
              if (!discipline) return;
              const firm = firms.find((f) => f.active && f.discipline === discipline);
              if (!firm) return;
              add.mutate(
                {
                  discipline,
                  firmId: firm.id,
                  estSend: seeds.est_send,
                  estRecd: seeds.est_recd,
                },
                { onSuccess: () => setAdding(false) },
              );
            }}
            data-testid="pd-consultant-add-discipline"
          >
            <option value="">Discipline…</option>
            {available.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-[11px] px-2 py-1"
            style={{ color: 'var(--color-muted)' }}
            onClick={() => setAdding(false)}
            data-testid="pd-consultant-add-cancel"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ★★ AN EMPTY SLOT NAMES THE DISCIPLINE IT IS WAITING FOR. The mock's copy is
 *    *"+ Add consultant (Project Data)"*; naming the discipline as well is what
 *    turns a hole into information — "no Arborist yet" rather than "something
 *    missing here".
 *
 * ★ It opens the add row on this band rather than the modal, because the band
 *   already owns `bp_add_project_consultant` and a control that sends you to a
 *   second surface to do what this one can do is a longer path, not a simpler
 *   one.
 */
function EmptySlot({
  discipline,
  canAdd,
  onAdd,
}: {
  discipline: string | null;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full h-full text-[9.5px] px-2 py-3 text-center disabled:cursor-default"
      style={{
        color: 'var(--color-muted)',
        background:
          'repeating-linear-gradient(45deg, transparent 0 6px, var(--color-s2) 6px 7px)',
      }}
      disabled={!canAdd}
      onClick={onAdd}
      data-testid={`pd-consultant-empty-${discipline ?? 'slot'}`}
    >
      {discipline ? `+ ${discipline}` : '+ Add consultant'}
    </button>
  );
}


// ---------------------------------------------------------------------------
// ONE PILL
// ---------------------------------------------------------------------------
function ConsultantPill({
  projectId,
  row,
  firms,
  seeds,
  manage,
}: {
  projectId: string;
  row: ConsultantCurrent;
  /** ★★★ fix-508 §F2 — WHERE THIS PILL IS. `false` (the overview) makes the
   *  firm read-only text; `true` (Project Data's Consultants tab) makes it the
   *  picker it has always been, and adds the remove control §I needs. */
  manage: boolean;
  firms: readonly { id: string; name: string; discipline: string; active: boolean }[];
  /** ★ fix-506 §F (P-164): the dates a NEW status would carry, so the confirm
   *  can show them before anything is written. Computed once by the card from
   *  the BP — the same `seedConsultantDates` "+ Add consultant" already uses,
   *  so a seeded date and a confirmed date can never disagree. */
  seeds: { est_send: string | null; est_recd: string | null };
}) {
  const setStatus = useSetConsultantStatus(projectId);
  const setDate = useSetConsultantDate(projectId);
  const setPhase = useSetConsultantPhase(projectId);
  const setFirm = useSetConsultantFirm(projectId);
  const removeConsultant = useRemoveProjectConsultant(projectId);
  const [open, setOpen] = useState(false);
  /** ★ fix-514 §D: the two-step remove. One click arms it, the second does it. */
  const [removing, setRemoving] = useState(false);
  const [firmPrompt, setFirmPrompt] = useState<string | null>(null);
  /** ★ fix-506 §F: the status the person clicked, awaiting Confirm. */
  const [statusPrompt, setStatusPrompt] = useState<ConsultantStatus | null>(null);
  /** ★ fix-506 §F: which date slot the person clicked. One flag, not one
   *  per slot — the panel shows BOTH dates, because they are the pair the
   *  status carries and editing one usually means checking the other. */
  const [dateEdit, setDateEdit] = useState<ConsultantDateField | null>(null);
  const roundsQ = useConsultantRounds(row.consultant_id, open);

  const status = (row.status ?? 'Scheduled') as ConsultantStatus;
  const slots = CONSULTANT_DATE_SLOTS[status];
  const tint = STATUS_STYLE[status];

  /** ★ The firms this discipline can be booked with. An INACTIVE firm that is
   *  already selected stays in the list — fix-474's rule: `active` stops a firm
   *  being offered for NEW work, it does not un-say who did the old work. */
  const options = useMemo(
    () =>
      firms.filter(
        (f) =>
          f.discipline.toLowerCase() === row.discipline.toLowerCase() &&
          (f.active || f.id === row.firm_id),
      ),
    [firms, row.discipline, row.firm_id],
  );

  /** ★ fix-508 §F2: the firm's NAME, for the read-only face. The view already
   *  flattens it (`firm_name`); the options list is the fallback for a row
   *  whose directory entry has not loaded yet. */
  const firmName =
    row.firm_name ?? options.find((f) => f.id === row.firm_id)?.name ?? null;

  /**
   * ★★★ fix-479 §C — THE PROMPT ONLY ASKS WHEN THERE IS SOMETHING TO LOSE.
   *
   * fix-475 asked on every firm change. On a consultant added a moment ago the
   * two answers are indistinguishable — one live round, `Scheduled`, four empty
   * dates, and `Clear` and `Keep` both leave exactly that — so the dialog was a
   * decision about nothing, with the red-edged button being the one that
   * performed the plain rename. Correcting a firm you have just picked is the
   * single most likely reason to change one at all.
   *
   * ★ THE PREDICATE IS SHARED (`consultantHasNothingToClear`), not inlined, so
   *   the rule and its reasoning live with the rest of the consultant
   *   vocabulary and a second caller cannot disagree with this one.
   *
   * ★★ WHEN IT SKIPS, IT SKIPS TO `clearRounds: false` — the conservative
   *    answer, and fix-475's own default. If this predicate is ever wrong, the
   *    failure is a kept empty round, not a voided real one.
   */
  function onPickFirm(nextFirmId: string) {
    if (nextFirmId === row.firm_id) return;
    if (consultantHasNothingToClear(row)) {
      setFirm.mutate({
        consultantId: row.consultant_id,
        firmId: nextFirmId,
        expectedUpdatedAt: row.updated_at,
        clearRounds: false,
      });
      return;
    }
    setFirmPrompt(nextFirmId);
  }

  // ===========================================================================
  // ★★★ fix-506 §F (P-164) — ADVANCING A STATUS ASKS FIRST
  // ===========================================================================
  //
  // ★★★ ONE CLICK USED TO WRITE. `onStatus` called the RPC straight from the
  //     `<select>`'s onChange, so a mis-click on a three-item list moved a
  //     consultant from Scheduled to Received — stamping `recd` — with no way
  //     back but another write. Bobby ruled it must ask.
  //
  // ★★ AND THE ASK SHOWS THE DATES, because that is what the answer depends on.
  //    A status change is not just a label: `bp_set_consultant_status` stamps
  //    `sent` on Pending and `recd` on Received, and the two visible slots
  //    change with it. The confirm renders the slots the NEW status will carry,
  //    pre-filled and editable, so "confirm" means "these dates", not "this
  //    word".
  //
  // ★ THE SELECT IS CONTROLLED ON `row.status`, so Cancel needs no revert: we
  //   simply never write, and the next render puts the old value back. A local
  //   "pending value" state would be a second source of truth for something the
  //   row already knows.
  function onStatus(next: ConsultantStatus) {
    if (next === status) return;
    setStatusPrompt(next);
  }

  /** The write, once the person has said yes. */
  function commitStatus(next: ConsultantStatus, dates: Partial<Record<ConsultantDateField, string>>) {
    // ★★ fix-474's RPC decides whether this appends a round; this only decides
    //    whether to OPEN the history so the person sees what happened. The
    //    prediction is never used as the write.
    const willAppend = transitionAppends(status, next);
    setStatus.mutate(
      {
        consultantId: row.consultant_id,
        status: next,
        expectedUpdatedAt: row.round_updated_at,
      },
      {
        onSuccess: () => {
          // ★★★ THE STATUS WRITE LANDS FIRST, THEN THE EDITED DATES. The RPC
          //     stamps `sent` / `recd` itself, so a date write sent alongside
          //     would race the stamp it is meant to sit beside. Only fields the
          //     person actually changed are written — an untouched slot must
          //     not overwrite what the RPC just stamped.
          for (const [field, value] of Object.entries(dates)) {
            setDate.mutate({
              consultantId: row.consultant_id,
              field: field as ConsultantDateField,
              value: value || null,
              expectedUpdatedAt: null,
            });
          }
          if (willAppend) setOpen(true);
        },
      },
    );
    setStatusPrompt(null);
  }

  return (
    <div
      className="border-r border-b h-full flex flex-col"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      data-testid={`pd-consultant-${row.discipline}`}
      data-status={status}
    >
      <div className="px-2 py-1.5 flex-1">
        {/* ★★★ fix-508 §F1 — LINE 1: TYPE AND STATUS, SIDE BY SIDE.
            fix-506 put the discipline on a line of its own and paired the FIRM
            with the status. Bobby's reason for moving it is a measurement:
            *"if you have six consultants you can't read their name because it
            gets cut off"* — the firm was sharing 134px with a 58px button, so
            on a six-consultant project it ellipsised to nothing. The status is
            a fixed-width chip and the discipline is a short closed vocabulary;
            they are the two things that CAN share a line. */}
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <span
            className="text-[8.5px] font-extrabold uppercase truncate min-w-0"
            style={{ letterSpacing: '0.06em', color: 'var(--color-text)' }}
            title={row.discipline}
            data-testid={`pd-consultant-discipline-${row.discipline}`}
          >
            {row.discipline}
          </span>

          {/* ★★★ A BUTTON, NOT A `<select>`. P-164 made every status change ask
              first, and a menu whose every option opens the same dialog is a
              menu pretending to be one. The click ADVANCES along the ladder —
              Scheduled → Pending → Received → Scheduled — and the confirm names
              where it is going, so nothing is written by picking. */}
          <button
            type="button"
            className="text-[8.5px] font-extrabold uppercase rounded-full px-1.5 py-0.5 border flex-none"
            style={{
              letterSpacing: '0.04em',
              background: tint.bg,
              color: tint.fg,
              borderColor: tint.bd,
            }}
            onClick={() => onStatus(nextStatus(status))}
            title={`${row.discipline} is ${status}. Click to move it to ${nextStatus(status)} — it will ask first.`}
            data-testid={`pd-consultant-status-${row.discipline}`}
          >
            {status}
          </button>
        </div>

        {/* ★★★ fix-508 §F1/§F2 — LINE 2: THE FIRM, FULL WIDTH AND READ-ONLY.
            Two changes, and the second one is a ruling being IMPLEMENTED rather
            than made: fix-506 ruled *"type and firm do not [edit on the
            overview]"* and the `<select>` fix-475 built was never taken out.
            STEP 0 confirmed it on the live app — six live, enabled dropdowns on
            `233 31st Ave E` — so this **never shipped**, it did not regress.
            The firm is chosen in Project Data's Consultants tab, where the type
            is; status and the two dates stay editable here, which is the
            exception Bobby carved and the only one.
            ★ Full width is what fixes Bobby's actual complaint. The name is
              still `truncate`d when it has to be, but it now has the whole pill
              to be long in instead of half of it. */}
        {manage ? (
          // ★★★ …EXCEPT IN PROJECT DATA, WHICH IS WHERE IT IS CHOSEN. fix-506's
          //     ruling is *"type and firm do not [edit on the overview]"* — the
          //     overview, not the app. The modal's own caption has always said
          //     *"type and firm are chosen here"*, and this is the control that
          //     makes that sentence true. Same component, same RPC, one prop:
          //     two copies of a firm picker is how they drift.
          <select
            className="text-[11px] font-bold rounded border w-full min-w-0 truncate px-0 py-0 my-0.5"
            style={{
              borderColor: 'transparent',
              background: 'transparent',
              color: 'var(--color-text)',
            }}
            value={row.firm_id}
            onChange={(e) => onPickFirm(e.target.value)}
            data-testid={`pd-consultant-firm-${row.discipline}`}
          >
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {!f.active ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <div
            className="text-[11px] font-bold truncate my-0.5"
            style={{ color: 'var(--color-text)' }}
            title={firmName ?? undefined}
            data-testid={`pd-consultant-firm-${row.discipline}`}
          >
            {firmName ?? <span className="text-dim italic font-normal">No firm yet</span>}
          </div>
        )}

        {/* ★★★ TWO DATES, SIDE BY SIDE, PRINTED — and editable in the panel
            below. See the file header for the measurement: a printed date is
            36px and a `BufferedDateInput` is 103, and four pills share a ~290px
            card. Same two slots on every pill; the STATUS decides which two. */}
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: '1fr 1fr' }}
          data-testid={`pd-consultant-dates-${row.discipline}`}
        >
          {slots.map((field) => {
            // ★ An EST slot is a guess and looks like one: dashed, muted. A
            //   stamped date is solid. The label comes from fix-474's one
            //   constant — this vocabulary has changed three times.
            const isEst = field === 'est_send' || field === 'est_recd';
            const value = (row[field] as string | null) ?? '';
            return (
              <button
                key={field}
                type="button"
                className="text-left min-w-0"
                onClick={() => setDateEdit((v) => (v ? null : field))}
                title={`${CONSULTANT_DATE_LABEL[field]} — click to edit`}
                data-testid={`pd-consultant-slot-${row.discipline}-${field}`}
              >
                <span
                  className="block text-[8px] font-extrabold uppercase truncate"
                  style={{ letterSpacing: '0.05em', color: 'var(--color-muted)' }}
                >
                  {CONSULTANT_DATE_LABEL[field]}
                </span>
                <span
                  className="block text-[9.5px] font-semibold font-mono tabular-nums"
                  style={{
                    color: isEst ? 'var(--color-muted)' : 'var(--color-text)',
                    borderBottom: isEst
                      ? '1px dashed var(--color-border)'
                      : '1px solid transparent',
                  }}
                  data-testid={`pd-consultant-date-${row.discipline}-${field}`}
                >
                  {value ? value.slice(5).replace('-', '/') : '—'}
                </span>
              </button>
            );
          })}
        </div>

        {/* ★★ THE EDITOR IS A PANEL, NOT AN INPUT IN THE CELL. A native
            `<input type="date">` is 103px and cannot reflow (fix-423); the pill
            is 140. Opening the pair below the pill — the shape
            `BuilderOwnerDisclosure` already uses on this row — keeps
            `BufferedDateInput` at its honest width AND keeps fix-073's rule
            that a server-committing date never sees a raw `onChange`. */}
        {dateEdit && (
          <div
            className="mt-1 pt-1 border-t flex flex-col gap-1"
            style={{ borderTopColor: 'var(--color-border)' }}
            role="group"
            aria-label={`Edit ${row.discipline} dates`}
            data-testid={`pd-consultant-date-editor-${row.discipline}`}
          >
            {slots.map((field) => (
              <label key={field} className="block">
                <span
                  className="block text-[8px] font-extrabold uppercase"
                  style={{ letterSpacing: '0.05em', color: 'var(--color-muted)' }}
                >
                  {CONSULTANT_DATE_LABEL[field]}
                </span>
                <BufferedDateInput
                  value={(row[field] as string | null) ?? ''}
                  onCommit={(v) =>
                    setDate.mutate({
                      consultantId: row.consultant_id,
                      field: field as ConsultantDateField,
                      value: v || null,
                      expectedUpdatedAt: row.round_updated_at,
                    })
                  }
                  className="w-full text-[10.5px] rounded px-1 py-0.5 border tabular-nums"
                  style={{ borderColor: 'var(--color-border)' }}
                  testId={`pd-consultant-date-input-${row.discipline}-${field}`}
                />
              </label>
            ))}
            <button
              type="button"
              className="text-[9px] font-bold self-end"
              style={{ color: 'var(--color-muted)' }}
              onClick={() => setDateEdit(null)}
              data-testid={`pd-consultant-date-close-${row.discipline}`}
            >
              Done
            </button>
          </div>
        )}

        {/* History, and — in manage mode — Remove. */}
        <div className="flex items-center justify-between gap-2 mt-1">
          {/* ★★★ fix-514 §D (P-181) — REMOVE, THE OTHER HALF OF fix-508 §I.
              `+ Add consultant` shipped; this never existed.
              ★★★ IT ASKS FIRST, AND SAYS WHAT SURVIVES. Removing is
                  destructive, and P-131 is the precedent — the confirm names
                  the round count because "removed" and "history deleted" are
                  two different promises and only the first one is being made.
              ★ `manage` only: the Overview band is read-only for structure
                (fix-508 §F2), and a remove control there would be the widest
                possible version of the thing that rule exists to prevent. */}
          {manage ? (
            removing ? (
              <span className="flex items-center gap-1.5 text-[9px]">
                <span style={{ color: 'var(--color-muted)' }}>
                  {row.round_count > 0
                    ? `Remove ${row.discipline}? ${row.round_count} round${row.round_count === 1 ? '' : 's'} kept as history.`
                    : `Remove ${row.discipline}?`}
                </span>
                <button
                  type="button"
                  className="font-bold"
                  style={{ color: 'var(--color-er)' }}
                  disabled={removeConsultant.isPending}
                  onClick={() =>
                    removeConsultant.mutate({
                      consultantId: row.consultant_id,
                      expectedUpdatedAt: row.updated_at ?? null,
                    })
                  }
                  data-testid={`pd-consultant-remove-confirm-${row.discipline}`}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="font-bold"
                  style={{ color: 'var(--color-muted)' }}
                  onClick={() => setRemoving(false)}
                  data-testid={`pd-consultant-remove-cancel-${row.discipline}`}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-[9px] font-bold"
                style={{ color: 'var(--color-muted)' }}
                onClick={() => setRemoving(true)}
                data-testid={`pd-consultant-remove-${row.discipline}`}
              >
                Remove
              </button>
            )
          ) : (
            <span />
          )}
          {row.round_count > 1 || open ? (
            <button
              type="button"
              className="text-right text-[9.5px] font-bold"
              style={{ color: 'var(--color-de)' }}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              data-testid={`pd-consultant-expand-${row.discipline}`}
            >
              {open ? 'Collapse ⌃' : `Expand · ${row.round_count} rounds ⌄`}
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>

      {open && (
        <div
          className="border-t px-2 py-1.5"
          style={{ borderTopColor: 'var(--color-border)', background: 'var(--color-s2)' }}
          data-testid={`pd-consultant-history-${row.discipline}`}
        >
          {/* ★ ROUND · SENT · RECEIVED only. The mock is explicit that the
              history is not a second copy of the pill. */}
          <table className="w-full text-[10px]">
            <thead>
              <tr style={{ color: 'var(--color-muted)' }}>
                <th className="text-left font-extrabold uppercase">Round</th>
                <th className="text-left font-extrabold uppercase">Sent</th>
                <th className="text-left font-extrabold uppercase">Received</th>
              </tr>
            </thead>
            <tbody>
              {(roundsQ.data ?? []).map((r) => (
                <tr key={r.id} data-testid={`pd-consultant-round-${row.discipline}-${r.round_index}`}>
                  <td className="pr-1 py-0.5">
                    {/* ★★ THE ROUND NAME IS EDITABLE FREE TEXT — *"in case
                        multiple cycles handle in one round"*, so `Cycle 1 & 2`
                        must be typeable. Only the LATEST round is editable:
                        fix-474's RPC writes the latest and nothing else, so an
                        input on an older row would silently rename the wrong
                        one. */}
                    {r.round_index === row.round_index ? (
                      <input
                        defaultValue={r.phase}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== r.phase) {
                            setPhase.mutate({
                              consultantId: row.consultant_id,
                              phase: v,
                              expectedUpdatedAt: row.round_updated_at,
                            });
                          }
                        }}
                        className="w-full rounded px-1 border bg-transparent text-[10px]"
                        style={{ borderColor: 'transparent', color: 'var(--color-text)' }}
                        data-testid={`pd-consultant-phase-${row.discipline}`}
                      />
                    ) : (
                      <span style={{ color: 'var(--color-muted)' }}>{r.phase}</span>
                    )}
                  </td>
                  <td className="pr-1 py-0.5 tabular-nums" style={{ color: 'var(--color-muted)' }}>
                    {r.sent ?? '—'}
                  </td>
                  <td className="py-0.5 tabular-nums" style={{ color: 'var(--color-muted)' }}>
                    {r.recd ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ★★★ THE FIRM-CHANGE PROMPT — fix-475's one new behaviour, ruled
          2026-09-01 and NOT in the mock.

          Bobby: *"maybe i selected the wrong firm at first and need to correct
          it… i could say firm a, but then we change to firm b partial way and
          cancel/delete any previous data."*

          ★★ THE DOMINANT CASE IS A CORRECTION, NOT A SUCCESSION — the wrong
          firm was picked and the record should never have said otherwise. But a
          genuine hand-off is real too, and **only the person doing it knows
          which**. So it is neither automatic nor silent: the app asks, and
          fix-475's RPC makes whichever answer atomic. */}
      {/* ===================================================================
          ★★★ fix-506 §F (P-164) — THE STATUS CONFIRM
          ===================================================================

          Bobby ruled that advancing a consultant's status must ask first. It
          shows the two date slots the NEW status will carry, pre-filled and
          editable, so Confirm means "these dates" rather than "this word".

          ★★ CANCEL WRITES NOTHING — not the status, not a date. That is the
             assertion that fails on origin/main, where the `<select>`'s
             onChange called the RPC directly.

          ★ It sits INSIDE the pill, like the firm prompt above it, rather than
            being a modal: the thing being changed has to stay on screen, and
            this card already has one in-place prompt whose shape people know. */}
      {statusPrompt && (
        <StatusConfirm
          discipline={row.discipline}
          from={status}
          to={statusPrompt}
          row={row}
          seeds={seeds}
          onCancel={() => setStatusPrompt(null)}
          onConfirm={(dates) => commitStatus(statusPrompt, dates)}
        />
      )}

      {firmPrompt && (
        <div
          className="border-t px-2 py-2"
          style={{ borderTopColor: 'var(--color-border)', background: 'var(--color-co-bg)' }}
          role="group"
          aria-label="Change firm"
          data-testid={`pd-consultant-firm-prompt-${row.discipline}`}
        >
          <p className="text-[10.5px] mb-1.5" style={{ color: 'var(--color-text)' }}>
            Keep the {row.round_count} round{row.round_count === 1 ? '' : 's'} already
            recorded, or clear them?
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="text-[10px] font-bold px-2 py-1 rounded border flex-1"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
              onClick={() => {
                setFirm.mutate({
                  consultantId: row.consultant_id,
                  firmId: firmPrompt,
                  expectedUpdatedAt: row.updated_at,
                  clearRounds: false,
                });
                setFirmPrompt(null);
              }}
              data-testid={`pd-consultant-firm-keep-${row.discipline}`}
            >
              Keep — a hand-off
            </button>
            <button
              type="button"
              className="text-[10px] font-bold px-2 py-1 rounded border flex-1"
              style={{
                borderColor: 'var(--color-er-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-er)',
              }}
              onClick={() => {
                setFirm.mutate({
                  consultantId: row.consultant_id,
                  firmId: firmPrompt,
                  expectedUpdatedAt: row.updated_at,
                  clearRounds: true,
                });
                setFirmPrompt(null);
              }}
              data-testid={`pd-consultant-firm-clear-${row.discipline}`}
            >
              Clear — wrong firm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ★★★ fix-506 §F (P-164) — "advancing a status asks first"
// ---------------------------------------------------------------------------
//
// ★★★ WHAT IT SHOWS IS THE POINT. `bp_set_consultant_status` stamps `sent` when
//     a round reaches Pending and `recd` when it reaches Received, and the two
//     visible slots change with the status (fix-474's CONSULTANT_DATE_SLOTS).
//     So the question "move this to Pending?" is really "move it to Pending
//     with THESE two dates?", and the dialog asks the real question.
//
// ★★ PRE-FILLED FROM THE ROW FIRST, THE SEED SECOND. A date somebody already
//    typed is the best answer; `seedConsultantDates` fills only what is still
//    blank — the same seed "+ Add consultant" uses, so the two paths cannot
//    disagree about what a fresh EST SEND is.
//
// ★★★ ONLY EDITED FIELDS ARE RETURNED. An untouched slot must not be written:
//     the RPC stamps `sent`/`recd` itself, and echoing a pre-filled value back
//     would overwrite the stamp it was meant to sit beside.
function StatusConfirm({
  discipline,
  from,
  to,
  row,
  seeds,
  onCancel,
  onConfirm,
}: {
  discipline: string;
  from: ConsultantStatus;
  to: ConsultantStatus;
  row: ConsultantCurrent;
  seeds: { est_send: string | null; est_recd: string | null };
  onCancel: () => void;
  onConfirm: (dates: Partial<Record<ConsultantDateField, string>>) => void;
}) {
  const slots = CONSULTANT_DATE_SLOTS[to];
  const initial: Partial<Record<ConsultantDateField, string>> = {};
  for (const f of slots) {
    const existing = (row[f] as string | null) ?? '';
    const seeded = f === 'est_send' ? seeds.est_send : f === 'est_recd' ? seeds.est_recd : null;
    initial[f] = existing || seeded || '';
  }
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<ConsultantDateField, boolean>>>({});

  return (
    <div
      className="border-t px-2 py-2"
      style={{ borderTopColor: 'var(--color-border)', background: 'var(--color-de-bg)' }}
      role="group"
      aria-label={`Change ${discipline} status`}
      data-testid={`pd-consultant-status-prompt-${discipline}`}
    >
      <p className="text-[10.5px] mb-1.5" style={{ color: 'var(--color-text)' }}>
        Move {discipline} from <b>{from}</b> to <b>{to}</b>?
      </p>

      {/* ★ The slots the NEW status carries — not the old one's. */}
      <div className="flex flex-col gap-1 mb-1.5">
        {slots.map((f) => (
          <label key={f} className="block" data-testid={`pd-consultant-confirm-slot-${discipline}-${f}`}>
            <span
              className="block text-[8.5px] font-extrabold uppercase mb-0.5"
              style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
            >
              {CONSULTANT_DATE_LABEL[f]}
            </span>
            <BufferedDateInput
              value={draft[f] ?? ''}
              onCommit={(v) => {
                setDraft((p) => ({ ...p, [f]: v }));
                setTouched((p) => ({ ...p, [f]: true }));
              }}
              testId={`pd-consultant-confirm-date-${discipline}-${f}`}
            />
          </label>
        ))}
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          className="text-[10px] font-bold px-2 py-1 rounded border flex-1"
          style={{
            borderColor: 'var(--color-de)',
            background: 'var(--color-de)',
            color: '#fff',
          }}
          onClick={() => {
            const edited: Partial<Record<ConsultantDateField, string>> = {};
            for (const f of slots) if (touched[f]) edited[f] = draft[f] ?? '';
            onConfirm(edited);
          }}
          data-testid={`pd-consultant-status-confirm-${discipline}`}
        >
          Confirm → {to.toUpperCase()}
        </button>
        <button
          type="button"
          className="text-[10px] font-bold px-2 py-1 rounded border flex-1"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
          onClick={onCancel}
          data-testid={`pd-consultant-status-cancel-${discipline}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
