import { useMemo, useState } from 'react';
import { useDaTeamRouting, type DaTeamRoutingRow } from '../../hooks/useDaTeamRouting';
import { useUpsertDaRouting, useDeleteDaRouting } from '../../hooks/useDaRoutingWrite';
import { useJurisdictions } from '../../hooks/useJurisdictions';
import {
  groupRoutingByDa,
  unroutedActiveDas,
  removeRuleConsequence,
  type DaRoutingGroup,
} from '../../lib/daRouting';
import type { TeamMember } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-457 (P-007) — ROUTING A DA TO THEIR LEAD STOPS NEEDING SQL
// ===========================================================================
//
// fix-72 built `da_team_routing` in May 2026 with four RLS policies and NO
// EDITOR. Eight surfaces read it; nothing in Settings ever wrote it, so every
// change since has been a hand-written INSERT. This is the door.
//
// ★★★ IT FIXES NO ROWS, AND THAT IS WORTH SAYING. Measured on prod 2026-08-30:
// 14 rows, 11 distinct DAs, **11 active DAs and none without a rule**, no row
// pointing at an inactive or unknown person. The table is healthy. What was
// missing was the ability to keep it that way without Claude.
//
// ★★ THE DROPDOWNS ARE ROSTER-SOURCED, NEVER FREE TEXT. `team_members.name` is
// a text join key across ~1,850 references and is frozen; `da_team_routing.da`
// and `.ent_lead` are two of the eleven columns holding one. A typed name that
// differs by a space is a rule that silently never matches.
//
// ★ The ENT list comes in as `ents`, which useTeamMembers already dedupes BY
// PERSON — Miles and Briana each hold two roster rows (`ent` and `ent_lead`),
// and a raw role filter would offer each of them twice.

interface Props {
  /** Active DAs, from the tab's roster query. Passed IN rather than fetched so
   *  this panel keeps working in a provider-less suite (the fix-442 trap). */
  activeDas: readonly TeamMember[];
  /** Current entitlement leads, deduped by person by useTeamMembers. */
  ents: readonly TeamMember[];
  readOnly: boolean;
}

const EMPTY_DRAFT = { da: '', jurisdiction: '', ent_lead: '' };

export default function DaRoutingEditor({ activeDas, ents, readOnly }: Props) {
  const routingQ = useDaTeamRouting();
  const jurisQ = useJurisdictions();
  const upsert = useUpsertDaRouting();
  const del = useDeleteDaRouting();

  const rows = useMemo(() => routingQ.data ?? [], [routingQ.data]);
  const groups = useMemo(() => groupRoutingByDa(rows), [rows]);
  const jurisOptions = jurisQ.data ?? [];

  const daNames = useMemo(() => activeDas.map((m) => m.name), [activeDas]);
  const unrouted = useMemo(
    () => unroutedActiveDas(daNames, rows),
    [daNames, rows],
  );

  /** The rule whose delete is awaiting confirmation. */
  const [confirmId, setConfirmId] = useState<number | null>(null);
  /** The "add a rule" draft, or null when the form is closed. */
  const [draft, setDraft] = useState<typeof EMPTY_DRAFT | null>(null);

  const busy = upsert.isPending || del.isPending;

  function openDraftFor(da: string) {
    setDraft({ ...EMPTY_DRAFT, da });
  }

  function submitDraft() {
    if (!draft || draft.da === '' || draft.ent_lead === '') return;
    upsert.mutate(
      {
        op: 'insert',
        patch: {
          da: draft.da,
          jurisdiction: draft.jurisdiction === '' ? null : draft.jurisdiction,
          ent_lead: draft.ent_lead,
        },
      },
      { onSuccess: () => setDraft(null) },
    );
  }

  function changeLead(row: DaTeamRoutingRow, ent_lead: string) {
    // ★ A row with no id/updated_at cannot be addressed or OCC-guarded. That
    //   only happens to a hand-built fixture, and refusing is safer than
    //   sending nulls the RPC would read as an insert.
    if (row.id == null || row.updated_at == null) return;
    if (ent_lead === '' || ent_lead === row.ent_lead) return;
    upsert.mutate({
      op: 'update',
      id: row.id,
      updated_at: row.updated_at,
      patch: {
        da: row.da,
        jurisdiction: row.jurisdiction,
        ent_lead,
      },
    });
  }

  function remove(row: DaTeamRoutingRow) {
    if (row.id == null || row.updated_at == null) return;
    del.mutate(
      { id: row.id, updated_at: row.updated_at },
      { onSuccess: () => setConfirmId(null) },
    );
  }

  if (routingQ.isLoading) {
    return (
      <div className="text-xs text-muted" data-testid="da-routing-loading">
        Loading routing…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="da-routing-editor">
      <p className="text-[11px] text-muted leading-relaxed">
        Which entitlement lead a Design Associate&apos;s work routes to. A{' '}
        <strong>default</strong> rule applies everywhere; a{' '}
        <strong>jurisdiction</strong> rule beats it in that jurisdiction only.
      </p>

      {/* ★★★ §A5 — THE GAP THE LIST OF RULES CANNOT SHOW.
          An active DA with no row is invisible among rows. It is also not
          harmless: bp_ent_lead_for_da returns NULL, the ENT cascade skips their
          permits (it carries `AND bp_ent_lead_for_da(...) IS NOT NULL`), and
          daHasRoutingFor makes them a DISABLED option in the New Project
          wizard. Measured on prod 2026-08-30 this list is EMPTY — all 11 active
          DAs have a rule — so it renders nothing today and appears the moment
          somebody joins. */}
      {unrouted.length > 0 && (
        <div
          className="rounded border px-3 py-2 flex flex-col gap-1.5"
          style={{
            borderColor: 'var(--color-co-border)',
            background: 'var(--color-co-bg)',
          }}
          data-testid="da-routing-unrouted"
        >
          <span className="text-[11px] font-bold" style={{ color: 'var(--color-co)' }}>
            {unrouted.length} active {unrouted.length === 1 ? 'DA has' : 'DAs have'}{' '}
            no routing rule
          </span>
          {/* ★★★ fix-497 (P-157): the second half of this sentence stopped
              being true. A DA with no routing row IS pickable now — Bobby's
              ruling is that Cam and Shire float across all three entitlement
              leads by design, so the missing row is the answer, not a gap.
              ★ The LIST stays: it still catches a genuine new joiner, and
                seeing who has no default is worth a glance either way. */}
          <span className="text-[10px] text-muted">
            Their permits&apos; entitlement lead is chosen by hand on each new
            project; the cascade leaves them alone.
          </span>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {unrouted.map((name) => (
              <button
                key={name}
                type="button"
                disabled={readOnly || busy}
                onClick={() => openDraftFor(name)}
                className="text-[10px] px-2 py-0.5 rounded border font-bold disabled:opacity-50"
                style={{ borderColor: 'var(--color-co-border)', color: 'var(--color-co)' }}
                data-testid={`da-routing-route-${name}`}
              >
                Route {name} →
              </button>
            ))}
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <div className="text-xs text-muted" data-testid="da-routing-empty">
          No routing rules yet.
        </div>
      )}

      {groups.map((g) => (
        <GroupBlock
          key={g.da}
          group={g}
          ents={ents}
          readOnly={readOnly}
          busy={busy}
          confirmId={confirmId}
          onConfirm={setConfirmId}
          onChangeLead={changeLead}
          onRemove={remove}
          onAddOverride={() => openDraftFor(g.da)}
        />
      ))}

      {/* Add a rule */}
      {!readOnly && (
        <div className="pt-1">
          {draft === null ? (
            <button
              type="button"
              onClick={() => setDraft({ ...EMPTY_DRAFT })}
              className="text-[11px] px-2 py-1 rounded border border-dashed text-dim"
              style={{ borderColor: 'var(--color-border)' }}
              data-testid="da-routing-add"
            >
              + Add routing rule
            </button>
          ) : (
            <div
              className="rounded border px-3 py-2 flex flex-wrap items-end gap-2"
              style={{ borderColor: 'var(--color-de)', background: 'var(--color-s2)' }}
              data-testid="da-routing-draft"
            >
              <Field label="Design Associate">
                <select
                  value={draft.da}
                  onChange={(e) => setDraft({ ...draft, da: e.target.value })}
                  className="text-[11px] border rounded px-1 py-0.5 bg-surface"
                  style={{ borderColor: 'var(--color-border)' }}
                  data-testid="da-routing-draft-da"
                >
                  <option value="">Select…</option>
                  {activeDas.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Jurisdiction">
                {/* ★ §A3: from the SAME registry the wizard uses
                    (useJurisdictions), not free text. Blank = the default rule,
                    which is why the empty option says so out loud. */}
                <select
                  value={draft.jurisdiction}
                  onChange={(e) =>
                    setDraft({ ...draft, jurisdiction: e.target.value })
                  }
                  className="text-[11px] border rounded px-1 py-0.5 bg-surface"
                  style={{ borderColor: 'var(--color-border)' }}
                  data-testid="da-routing-draft-juris"
                >
                  <option value="">(default — everywhere)</option>
                  {jurisOptions.map((j) => (
                    <option key={j.name} value={j.name}>
                      {j.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Entitlement lead">
                <select
                  value={draft.ent_lead}
                  onChange={(e) => setDraft({ ...draft, ent_lead: e.target.value })}
                  className="text-[11px] border rounded px-1 py-0.5 bg-surface"
                  style={{ borderColor: 'var(--color-border)' }}
                  data-testid="da-routing-draft-lead"
                >
                  <option value="">Select…</option>
                  {ents.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                disabled={busy || draft.da === '' || draft.ent_lead === ''}
                onClick={submitDraft}
                className="text-[11px] px-2 py-1 rounded border font-bold disabled:opacity-50"
                style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
                data-testid="da-routing-draft-save"
              >
                Add rule
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-[11px] px-2 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)' }}
                data-testid="da-routing-draft-cancel"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-wide text-dim">
        {label}
      </span>
      {children}
    </label>
  );
}

function GroupBlock({
  group,
  ents,
  readOnly,
  busy,
  confirmId,
  onConfirm,
  onChangeLead,
  onRemove,
  onAddOverride,
}: {
  group: DaRoutingGroup;
  ents: readonly TeamMember[];
  readOnly: boolean;
  busy: boolean;
  confirmId: number | null;
  onConfirm: (id: number | null) => void;
  onChangeLead: (row: DaTeamRoutingRow, lead: string) => void;
  onRemove: (row: DaTeamRoutingRow) => void;
  onAddOverride: () => void;
}) {
  return (
    <div
      className="rounded border px-3 py-2"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid={`da-routing-group-${group.da}`}
    >
      <div className="flex items-center justify-between gap-2 pb-1">
        <span className="text-[12px] font-display font-bold text-text">
          {group.da}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={onAddOverride}
            className="text-[10px] px-1.5 py-0.5 rounded border border-dashed text-dim"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`da-routing-add-for-${group.da}`}
          >
            + rule
          </button>
        )}
      </div>

      {/* ★★ §A2: the default FIRST as the group's baseline, overrides indented
          beneath it as exceptions — which is exactly bp_ent_lead_for_da's
          `ORDER BY (jurisdiction IS NULL) ASC`. The layout is the precedence. */}
      {group.default ? (
        <RuleRow
          row={group.default}
          label="Default — everywhere"
          group={group}
          ents={ents}
          readOnly={readOnly}
          busy={busy}
          confirmId={confirmId}
          onConfirm={onConfirm}
          onChangeLead={onChangeLead}
          onRemove={onRemove}
        />
      ) : (
        <div
          className="text-[10px] italic pl-1"
          style={{ color: 'var(--color-co)' }}
          data-testid={`da-routing-no-default-${group.da}`}
        >
          No default rule — {group.da} routes nowhere outside the jurisdictions
          below.
        </div>
      )}

      {group.overrides.length > 0 && (
        <div className="pl-4 pt-1 flex flex-col gap-1">
          {group.overrides.map((r) => (
            <RuleRow
              key={r.id ?? `${r.da}-${r.jurisdiction}`}
              row={r}
              label={r.jurisdiction ?? '(default)'}
              group={group}
              ents={ents}
              readOnly={readOnly}
              busy={busy}
              confirmId={confirmId}
              onConfirm={onConfirm}
              onChangeLead={onChangeLead}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleRow({
  row,
  label,
  group,
  ents,
  readOnly,
  busy,
  confirmId,
  onConfirm,
  onChangeLead,
  onRemove,
}: {
  row: DaTeamRoutingRow;
  label: string;
  group: DaRoutingGroup;
  ents: readonly TeamMember[];
  readOnly: boolean;
  busy: boolean;
  confirmId: number | null;
  onConfirm: (id: number | null) => void;
  onChangeLead: (row: DaTeamRoutingRow, lead: string) => void;
  onRemove: (row: DaTeamRoutingRow) => void;
}) {
  const addressable = row.id != null && row.updated_at != null;
  const confirming = addressable && confirmId === row.id;
  const isDefault =
    row.jurisdiction === null || (row.jurisdiction ?? '').trim() === '';

  return (
    <div className="flex flex-col gap-1" data-testid={`da-routing-rule-${row.id ?? 'x'}`}>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-dim min-w-[120px]">{label}</span>
        <span className="text-dim">→</span>
        {readOnly || !addressable ? (
          <span className="font-semibold text-text" data-testid={`da-routing-lead-${row.id ?? 'x'}`}>
            {row.ent_lead ?? '—'}
          </span>
        ) : (
          <select
            value={row.ent_lead ?? ''}
            disabled={busy}
            onChange={(e) => onChangeLead(row, e.target.value)}
            className="text-[11px] border rounded px-1 py-0.5 bg-surface disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`da-routing-lead-${row.id}`}
          >
            {/* ★ The stored lead is always offered even if they have left the
                roster, so an edit to another field cannot silently re-point the
                rule at somebody else. */}
            {row.ent_lead && !ents.some((m) => m.name === row.ent_lead) && (
              <option value={row.ent_lead}>{row.ent_lead}</option>
            )}
            {ents.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {!readOnly && addressable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(confirming ? null : row.id!)}
            className="text-[10px] px-1.5 py-0.5 rounded border text-dim disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`da-routing-remove-${row.id}`}
          >
            Remove
          </button>
        )}
      </div>

      {/* ★★★ §A4 — THE CONFIRM NAMES THE CONSEQUENCE, AND THE CONSEQUENCE IS
          NOT "falls back to Miles". There is no such rule: bp_ent_lead_for_da
          returns NULL for an unrouted DA and the cascade carries
          `AND bp_ent_lead_for_da(...) IS NOT NULL`, so it writes nothing. The
          text comes from removeRuleConsequence, which lives beside that
          reasoning so the two cannot drift. */}
      {confirming && (
        <div
          className="rounded border px-2 py-1.5 flex flex-wrap items-center gap-2"
          style={{
            borderColor: 'var(--color-de)',
            background: 'var(--color-de-bg, var(--color-s2))',
          }}
          data-testid={`da-routing-confirm-${row.id}`}
        >
          <span className="text-[10.5px]">
            {removeRuleConsequence(row.da, isDefault ? null : row.jurisdiction, group)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(row)}
            className="text-[10px] px-2 py-0.5 rounded border font-bold disabled:opacity-50"
            style={{ borderColor: 'var(--color-de)', color: 'var(--color-de)' }}
            data-testid={`da-routing-confirm-remove-${row.id}`}
          >
            Remove rule
          </button>
          <button
            type="button"
            onClick={() => onConfirm(null)}
            className="text-[10px] px-2 py-0.5 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`da-routing-confirm-cancel-${row.id}`}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
