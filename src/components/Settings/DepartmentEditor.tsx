import { useMemo } from 'react';
import { useSetTeamDepartment } from '../../hooks/useSetTeamDepartment';
import {
  foldRosterToPeople,
  peopleWithNoDepartment,
  viewerOverlap,
  type DepartmentPerson,
} from '../../lib/department';
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  ROLE_TITLE,
  departmentLabel,
  NO_DEPARTMENT_LABEL,
} from '../../lib/roleLabels';
import type { Department, TeamMember } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-461 §B (P-045 prereq) — THE DEPARTMENT AXIS
// ===========================================================================
//
// Bobby, 2026-08-26, final: **Policy · Design & Entitlements · Acquisitions ·
// Underwriting.** He offered *"accounting, which is like EJ, Greg and them"*
// first and then settled on Underwriting; newest-first applies, so Accounting is
// not one of the four.
//
// ★★★ AMENDED 2026-08-31 (fix-464) — SIX, NOT FOUR. Bobby classified 32 of 35
// people with this panel and found three it could not fit: Darin, Eric and
// Keenan. *"eric and darin are president and ceo, so they need a department.
// keenan is investor relations/IT so he needs a department too."* Two new
// departments rather than one, so IT is its own function and not filed under the
// CEO. ★ Accounting is still not one of them — only the count changed.
//
// Why it exists — Bobby: *"[Lucas is] a director, like Dave, but two different
// departments."* `role` mixes discipline with seniority; it can say "director"
// and it can say "schematic", but it cannot say "director of Policy".
//
// ★★★ THIS PANEL ASSIGNS NOBODY BY ITSELF. Every one of the 46 roster rows holds
// NULL the day this ships. Bobby classifies people here, one at a time, exactly
// as he is filling fix-458's fifteen entitlement leads.
//
// ★★ SAME SHAPE AS ITS TWO NEIGHBOURS, deliberately — fix-457's "active DA with
// no routing row" and fix-458's lead-less permits. This is the fourth
// roster-gap surface on this tab and a fourth visual language for the same idea
// would make the screen harder to read than the gaps it reports.

interface Props {
  /** The WHOLE roster, passed in from the tab's query — not fetched here, so
   *  the panel works in a provider-less suite (the fix-442 trap). */
  members: readonly TeamMember[];
  readOnly: boolean;
}

export default function DepartmentEditor({ members, readOnly }: Props) {
  const setDepartment = useSetTeamDepartment();

  // ★★★ §B2 — FOLDED TO PEOPLE BEFORE ANYTHING IS RENDERED. The roster is one
  //    row per (person, role) and six people carry two rows; a panel that
  //    rendered rows would show Dave twice with two dropdowns, and the obvious
  //    next thing that happens is that they disagree.
  const people = useMemo(() => foldRosterToPeople(members), [members]);
  const active = useMemo(() => people.filter((p) => p.active), [people]);
  const gap = useMemo(() => peopleWithNoDepartment(people), [people]);
  const viewers = useMemo(() => viewerOverlap(people), [people]);
  const splits = useMemo(() => people.filter((p) => p.split), [people]);

  // ★★ §B2: one entry per department, in DEPARTMENTS' order, plus the
  //    unclassified at the end. Built from the vocabulary rather than from the
  //    data, which is what makes an empty department render instead of vanish.
  const grouped = useMemo(() => {
    const out = DEPARTMENTS.map((d) => ({
      key: d as Department | null,
      label: DEPARTMENT_LABEL[d],
      people: active.filter((p) => p.department === d),
    }));
    const rest = active.filter((p) => p.department === null);
    if (rest.length > 0) {
      out.push({ key: null, label: NO_DEPARTMENT_LABEL, people: rest });
    }
    return out;
  }, [active]);

  function set(person: DepartmentPerson, value: string) {
    // ★ By NAME. The RPC updates every row the person holds, and the database
    //   trigger propagates besides — belt and braces, because a split is the
    //   one outcome this panel must not be able to produce.
    setDepartment.mutate({
      name: person.name,
      department: value === '' ? null : (value as Department),
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="department-editor">
      <p className="text-[11px] text-muted leading-relaxed">
        Which department each person belongs to. A department is{' '}
        <strong>not a permission</strong> — it does not change what anybody can
        see or do. It is set per <strong>person</strong>, so it applies to every
        role they hold.
      </p>

      {/* ★★★ §B2's alarm. The trigger makes this impossible going forward, so a
          row here means data that predates it — worth shouting about rather
          than silently resolving to whichever value sorted first. */}
      {splits.length > 0 && (
        <div
          className="rounded border px-3 py-2 flex flex-col gap-1"
          style={{ borderColor: 'var(--color-de)', background: 'var(--color-de-bg)' }}
          data-testid="department-split-warning"
        >
          <span className="text-[11px] font-bold" style={{ color: 'var(--color-de)' }}>
            ⚠ {splits.length}{' '}
            {splits.length === 1 ? 'person holds' : 'people hold'} two different
            departments
          </span>
          {splits.map((p) => (
            <span key={p.name} className="text-[10px] text-muted">
              <strong>{p.name}</strong> —{' '}
              {(p.split ?? []).map((d) => DEPARTMENT_LABEL[d]).join(' and ')}. Pick
              one below to settle it.
            </span>
          ))}
        </div>
      )}

      {/* ★★ §B3 — the gap, in the same warning shape as its two neighbours. */}
      {gap.length > 0 ? (
        <div
          className="rounded border px-3 py-2 flex flex-col gap-0.5"
          style={{
            borderColor: 'var(--color-co-border)',
            background: 'var(--color-co-bg)',
          }}
          data-testid="department-gap"
        >
          <span className="text-[11px] font-bold" style={{ color: 'var(--color-co)' }}>
            ⚠ {gap.length} {gap.length === 1 ? 'person has' : 'people have'} no
            department
          </span>
          <span className="text-[10px] text-muted">
            {gap.map((p) => p.name).join(', ')}
          </span>
        </div>
      ) : (
        // ★ A SENTENCE, NOT A BLANK. An empty warning box reads as a failure to
        //   load; this is the goal, so it says so.
        <div
          className="rounded border px-3 py-2 text-[11px] text-muted"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="department-gap-empty"
        >
          Everyone has a department.
        </div>
      )}

      {/* ★★★ fix-464 §B2 — GROUPED BY DEPARTMENT, INCLUDING THE EMPTY ONES.
          A department nobody is in yet must render as an empty group rather than
          vanish, so the option is visible BEFORE it is used — which is exactly
          the failure this ticket exists to correct: the picker had nothing that
          fitted Darin, Eric and Keenan, and there was no way to see that from
          the panel.
          ★ The unclassified group comes LAST and only when it has somebody: it
          is the work remaining, not a department. */}
      <div className="flex flex-col gap-2">
        {grouped.map(({ key, label, people: members }) => (
          <div key={key ?? 'none'} data-testid={`department-group-${key ?? 'none'}`}>
            <div className="flex items-baseline gap-2 pb-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-dim">
                {label}
              </span>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: 'var(--color-muted)' }}
                data-testid={`department-group-${key ?? 'none'}-count`}
              >
                {members.length}
              </span>
            </div>
            {members.length === 0 ? (
              <p
                className="text-[10px] text-dim italic pl-0.5 pb-1"
                data-testid={`department-group-${key ?? 'none'}-empty`}
              >
                Nobody yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {members.map((p) => (
          <div
            key={p.name}
            className="rounded border px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-[11px]"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid={`department-row-${p.name}`}
          >
            <span className="font-display font-bold text-text min-w-[110px]">
              {p.name}
            </span>
            {/* ★ Every role the person holds, so it is obvious this ONE control
                covers all of them — the visible half of "edit by person". */}
            <span className="text-dim">
              {p.roles.map((r) => ROLE_TITLE[r]).join(' · ')}
            </span>
            <span className="flex-1" />
            {readOnly ? (
              <span
                className={p.department ? 'font-semibold text-text' : 'text-dim italic'}
                data-testid={`department-value-${p.name}`}
              >
                {departmentLabel(p.department)}
              </span>
            ) : (
              <select
                value={p.department ?? ''}
                disabled={setDepartment.isPending}
                onChange={(e) => set(p, e.target.value)}
                className="text-[11px] border rounded px-1 py-0.5 bg-surface disabled:opacity-50"
                style={{
                  borderColor: p.department
                    ? 'var(--color-border)'
                    : 'var(--color-co-border)',
                }}
                data-testid={`department-select-${p.name}`}
              >
                {/* ★ "No department" is an OPTION, not a placeholder: Bobby must
                    be able to un-classify somebody he classified by mistake. */}
                <option value="">No department</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_LABEL[d]}
                  </option>
                ))}
              </select>
            )}
          </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ★★ §B4 — REPORTED, NOT ACTED ON. Seven active people carry
          `role='viewer'` as a stand-in for "unclassified", the CEO and the
          President among them. Once a department exists `viewer` may be
          redundant for some of them — that is Bobby's call, and this ticket
          changes no role. The count is stated so the question is visible. */}
      {viewers.length > 0 && (
        <p className="text-[10px] text-muted leading-relaxed">
          ★ {viewers.length} of these people currently hold the{' '}
          <strong>{ROLE_TITLE.viewer}</strong> role, which has been standing in
          for &ldquo;unclassified&rdquo; ({viewers.map((p) => p.name).join(', ')}).
          Now that a department exists, that role may be redundant for some of
          them — <strong>no role has been changed here</strong>; it is worth a
          look.
        </p>
      )}
    </div>
  );
}
