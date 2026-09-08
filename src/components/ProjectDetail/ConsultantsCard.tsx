import { useMemo, useState } from 'react';
import { OverviewCard, OverviewSection } from './OverviewCard';
import BufferedDateInput from '../BufferedDateInput';
import { useExternalTeamDirectory } from '../../hooks/useExternalTeamDirectory';
import {
  useAddProjectConsultant,
  useConsultantRounds,
  useProjectConsultants,
  useSetConsultantDate,
  useSetConsultantFirm,
  useSetConsultantPhase,
  useSetConsultantStatus,
} from '../../hooks/useProjectConsultants';
import {
  CONSULTANT_DATE_LABEL,
  CONSULTANT_DATE_SLOTS,
  CONSULTANT_STATUSES,
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

export default function ConsultantsCard({
  projectId,
  bp,
}: {
  projectId: string;
  /** For the two seed dates only — see `seedConsultantDates`. */
  bp: PermitWithCycles | null;
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

  return (
    <OverviewCard title="Consultants" testId="pd-consultants-card">
      <OverviewSection testId="pd-consultants-body">
        {/* ★★ THE EMPTY STATE IS THE BUTTON AND NOTHING ELSE. No placeholder
            text, no seeded disciplines — Bobby ruled 2026-09-01 not to seed
            from `external_team` at all, so a project with no consultants has
            genuinely nothing to say and says nothing. */}
        {rows.map((row) => (
          <ConsultantPill
            key={row.consultant_id}
            projectId={projectId}
            row={row}
            firms={firms}
            seeds={seeds}
          />
        ))}

        {adding && available.length > 0 && (
          <div
            className="flex items-center gap-1.5 mb-1.5"
            data-testid="pd-consultant-add-row"
          >
            <select
              className="text-[11px] border rounded px-1.5 py-1 flex-1 min-w-0"
              style={{ borderColor: 'var(--color-border)' }}
              defaultValue=""
              onChange={(e) => {
                const discipline = e.target.value;
                if (!discipline) return;
                const firm = firms.find(
                  (f) => f.active && f.discipline === discipline,
                );
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

        {available.length > 0 && !adding && (
          <button
            type="button"
            className="w-full text-[11px] font-bold px-2 py-1.5 rounded border border-dashed"
            style={{
              borderColor: 'var(--color-border)',
              // ★ fix-467's measurement: `--color-muted` on white is 5.48:1.
              //   Not `--color-dim`, which is 2.82:1.
              color: 'var(--color-muted)',
            }}
            onClick={() => setAdding(true)}
            data-testid="pd-consultant-add"
          >
            + Add consultant
          </button>
        )}
      </OverviewSection>
    </OverviewCard>
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
}: {
  projectId: string;
  row: ConsultantCurrent;
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
  const [open, setOpen] = useState(false);
  const [firmPrompt, setFirmPrompt] = useState<string | null>(null);
  /** ★ fix-506 §F: the status the person clicked, awaiting Confirm. */
  const [statusPrompt, setStatusPrompt] = useState<ConsultantStatus | null>(null);
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
      className="rounded border mb-1.5 overflow-hidden"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      data-testid={`pd-consultant-${row.discipline}`}
      data-status={status}
    >
      <div className="px-2 py-1.5">
        <div
          className="text-[8.5px] font-extrabold uppercase mb-0.5"
          style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
        >
          {row.discipline}
        </div>

        {/* Firm */}
        <select
          className="w-full text-[11.5px] font-bold rounded px-1 py-0.5 border min-w-0"
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

        {/* Status — the only coloured object in the column */}
        <select
          className="w-full text-[9.5px] font-extrabold uppercase rounded-full px-2 py-0.5 border mt-1"
          style={{
            letterSpacing: '0.04em',
            background: tint.bg,
            color: tint.fg,
            borderColor: tint.bd,
          }}
          value={status}
          onChange={(e) => onStatus(e.target.value as ConsultantStatus)}
          data-testid={`pd-consultant-status-${row.discipline}`}
        >
          {CONSULTANT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* ★★★ TWO DATES, STACKED — see the note at the top of this file for the
            measurement that put them one above the other rather than side by
            side. Same two slots on every pill; the STATUS decides which two. */}
        <div className="flex flex-col gap-1 mt-1.5" data-testid={`pd-consultant-dates-${row.discipline}`}>
          {slots.map((field) => {
            // ★ An EST slot is a guess and looks like one: dashed, muted. A
            //   stamped date is solid. The label comes from fix-474's one
            //   constant — this vocabulary has changed three times.
            const isEst = field === 'est_send' || field === 'est_recd';
            return (
              <label key={field} className="block" data-testid={`pd-consultant-slot-${row.discipline}-${field}`}>
                <span
                  className="block text-[8.5px] font-extrabold uppercase mb-0.5"
                  style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
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
                  style={{
                    borderColor: 'var(--color-border)',
                    borderStyle: isEst ? 'dashed' : 'solid',
                    background: isEst ? 'var(--color-s2)' : 'var(--color-surface)',
                    color: isEst ? 'var(--color-muted)' : 'var(--color-text)',
                  }}
                  testId={`pd-consultant-date-${row.discipline}-${field}`}
                />
              </label>
            );
          })}
        </div>

        {/* History */}
        {row.round_count > 1 || open ? (
          <button
            type="button"
            className="w-full text-right text-[9.5px] font-bold mt-1"
            style={{ color: 'var(--color-de)' }}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            data-testid={`pd-consultant-expand-${row.discipline}`}
          >
            {open ? 'Collapse ⌃' : `Expand · ${row.round_count} rounds ⌄`}
          </button>
        ) : null}
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
