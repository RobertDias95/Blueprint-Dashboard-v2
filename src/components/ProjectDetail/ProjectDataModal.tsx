import { useMemo, useState } from 'react';
import OriginLink from '../OriginLink';
import type { ReactNode } from 'react';
import {
  DDPhaseEditor,
  KeyDatesSection,
  SiteEditor,
  UnitDimensions,
} from './ProjectDataEditors';
import ReuseEditor from './ReuseEditor';
import ReuseRedesignDdEditor from './ReuseRedesignDdEditor';
import { ConsultantBand } from './ConsultantBand';
import { ProjectHoldPanel } from './ProjectHold';
import { usePlanOfRecord } from '../../hooks/usePlanOfRecord';
import { projectInternalTeam } from '../../lib/projectTeam';
import { TEAM_INTERNAL_ROWS } from '../../lib/overviewCardLayout';
import { formatUsDate } from '../../lib/dateUtils';
import {
  PROJECT_DATA_TABS,
  type ProjectDataTab,
} from '../../lib/projectDataTabs';
import type { PermitWithCycles, Project } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §G (P-140) — PROJECT DATA
// ===========================================================================
//
// Bobby's ruling: *"Overview is read-only; every project field is edited in
// Project Data — the button that replaces ⚙ Project Settings."*
//
// ★★★ EVERY EDITOR IN HERE IS THE ONE THAT WAS ON THE OVERVIEW, MOVED. The
//     brief is explicit — *"Every write goes through the SAME hooks the
//     overview uses today: no new RPC, same OCC tokens, same toasts"* — and
//     `ProjectDataEditors` is where they now live, unchanged in body. A modal
//     that re-implemented eighteen fields would be a second write path for each
//     of them, which is the fix-415 defect class (three write paths for one
//     site field, one bypassing every server-side rule) applied to a whole card
//     at once.
//
// ★★★ AND `ProjectSettingsModal` IS **NOT** RETIRED. The brief allows it —
//     *"Retire it only if every consumer is the overview; otherwise leave it
//     and route the overview to the new modal"* — and the deciding fact is what
//     it holds that these tabs do not: **Address, Jurisdiction, the permit
//     rows, Product Types and the roster assignment**, each with its own
//     atomic `bp_update_project_with_permits` save. Rebuilding those here would
//     be a second 1,400-line form against the same RPC. So Project Data owns
//     the eighteen fields that were on the overview, and hands off to Project
//     Settings — one click, no stacking — for the five it does not.
//
// ★★ THE TAB IS IN THE URL (`?data=units`), because §H's Library links point at
//    it and a link that only works from inside the app is not a link. Same rule
//    fix-362 §2 set for `?msg=` and `?chat=`: if you cannot paste it and get
//    the same result, it is not done.

interface Props {
  project: Project;
  permits: PermitWithCycles[];
  bp: PermitWithCycles | null;
  /** fix-126's redesign list on the Actions tab reads this project's children
   *  out of the already-cached project list. */
  allProjects?: readonly Project[];
  initialTab?: ProjectDataTab;
  onClose: () => void;
  /** Address · Jurisdiction · permits · Product Types · the roster — the five
   *  things Project Settings still owns. */
  onOpenSettings: () => void;
  onSpawnRedesign?: () => void;
  onReassignDa?: () => void;
  canReassignDa?: boolean;
  onDelete?: () => void;
}

export default function ProjectDataModal({
  project,
  permits,
  bp,
  allProjects = [],
  initialTab = 'site',
  onClose,
  onOpenSettings,
  onSpawnRedesign,
  onReassignDa,
  canReassignDa = false,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<ProjectDataTab>(initialTab);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      // ★★★ fix-440 (P-057): the backdrop does nothing, and neither does
      //     Escape. Bobby's narrowed ruling — of sixteen overlays, only the
      //     ones that HOLD UNSAVED INPUT stop closing on an outside click. Half
      //     the tabs in here are live per-field editors with a date input
      //     mid-edit, so a stray click would throw away a value somebody was
      //     part-way through typing. The exits are the × and Done, both
      //     explicit. ★ And no keydown handler: fix-440 found that
      //     `onKeyDown` on a non-focusable div is DEAD, so an Escape handler
      //     here would look present and do nothing.
      data-testid="project-data-modal"
      data-tab={tab}
    >
      <div
        className="rounded-lg shadow-xl w-[760px] max-h-[90vh] overflow-hidden flex flex-col"
        style={{ background: 'var(--color-surface)' }}
      >
        <header
          className="px-4 py-2 border-b flex items-center justify-between"
          style={{
            background: 'var(--color-s2)',
            borderBottomColor: 'var(--color-border)',
          }}
        >
          <span className="text-[12px] font-extrabold uppercase tracking-wider text-text">
            Project Data
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title="Close"
            data-testid="project-data-close"
          >
            ✕
          </button>
        </header>

        {/* ★ The tab strip scrolls rather than wrapping: eight tabs at 760px is
            tight, and a strip that reflows to two lines moves every tab under
            the pointer the moment one label changes length. */}
        <nav
          className="flex gap-0.5 px-2 pt-2 overflow-x-auto flex-none border-b"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="project-data-tabs"
        >
          {PROJECT_DATA_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="text-[10.5px] font-bold px-2.5 py-1.5 rounded-t whitespace-nowrap"
              style={
                tab === t.key
                  ? {
                      background: 'var(--color-surface)',
                      color: 'var(--color-de)',
                      borderBottom: '2px solid var(--color-de)',
                    }
                  : { color: 'var(--color-muted)' }
              }
              aria-current={tab === t.key ? 'page' : undefined}
              data-testid={`project-data-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="project-data-body">
          {tab === 'site' && (
            <SiteTab project={project} onOpenSettings={onOpenSettings} />
          )}
          {tab === 'dates' && (
            <DatesTab project={project} bp={bp} permits={permits} />
          )}
          {tab === 'units' && (
            <TabPanel
              caption="Each field saves as you leave it — there is no Save button, and there never was on the overview these moved from."
            >
              {/* ★ fix-412 §C1's guarantee: this editor keeps a HEADING of its
                  own rather than being a nameless block of inputs — Bobby has
                  to be able to point at it. The tab label is one half; this is
                  the other, and it is the same words the retired
                  `OverviewSection title="Unit dimensions"` carried. */}
              <p
                className="text-[9px] font-bold uppercase tracking-wide"
                style={{ color: 'var(--color-dim)' }}
              >
                Unit dimensions
              </p>
              <UnitDimensions project={project} />
            </TabPanel>
          )}
          {tab === 'builder' && (
            <TabPanel caption="Builder and owner details are edited in Project Settings, where they save with the rest of the project in one write.">
              <HandOff onOpenSettings={onOpenSettings} what="Builder / Owner" />
            </TabPanel>
          )}
          {tab === 'team' && <TeamTab project={project} bp={bp} onOpenSettings={onOpenSettings} />}
          {tab === 'consultants' && (
            <TabPanel caption="Adding, removing, re-firming and advancing a consultant all write through bp_set_consultant_* — the same RPCs the overview band uses.">
              {/* ★★★ fix-508 §F2/§I — `manage` IS WHAT MAKES THIS TAB'S OWN
                  CAPTION TRUE. It has claimed since fix-506 that type and firm
                  are chosen here; the firm picker was on the OVERVIEW instead,
                  and the add control existed only while a fixed slot was
                  empty. One prop, one component, both fixed. */}
              <ConsultantBand projectId={project.id} bp={bp} manage />
            </TabPanel>
          )}
          {tab === 'plan' && <PlanTab projectId={project.id} />}
          {tab === 'actions' && (
            <ActionsTab
              project={project}
              allProjects={allProjects}
              onSpawnRedesign={onSpawnRedesign}
              onReassignDa={onReassignDa}
              canReassignDa={canReassignDa}
              onDelete={onDelete}
            />
          )}
        </div>

        <footer
          className="px-4 py-2 border-t flex justify-end"
          style={{ borderTopColor: 'var(--color-border)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-bold px-3 py-1.5 rounded border"
            style={{
              borderColor: 'var(--color-de)',
              background: 'var(--color-de)',
              color: '#fff',
            }}
            data-testid="project-data-done"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * ★★★ EVERY TAB SAYS HOW IT SAVES, AND THAT IS THE BRIEF'S OWN RULE: *"if a
 *     tab has per-field commits today, keep them and say so in the tab's
 *     caption."* These editors have always committed on blur; a modal with a
 *     Save button in the corner would promise a transaction it does not have.
 */
function TabPanel({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
        {caption}
      </p>
      {children}
    </div>
  );
}

/** ★ The hand-off to Project Settings. It CLOSES this modal and opens that one
 *  — never both at once, which is the rule fix-331 §4 set when it made the page
 *  own the single instance of each dialog. */
function HandOff({
  onOpenSettings,
  what,
}: {
  onOpenSettings: () => void;
  what: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpenSettings}
      className="text-[11px] font-bold px-3 py-1.5 rounded border self-start"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-s2)',
        color: 'var(--color-de)',
      }}
      data-testid="project-data-open-settings"
    >
      {what} in Project Settings →
    </button>
  );
}

function SiteTab({
  project,
  onOpenSettings,
}: {
  project: Project;
  onOpenSettings: () => void;
}) {
  return (
    <TabPanel caption="Each field saves as you leave it. Address and Jurisdiction are part of Project Settings' single atomic save and are read-only here.">
      <div className="flex flex-col gap-1">
        <ReadOnly label="Address" value={project.address} />
        <ReadOnly label="Jurisdiction" value={project.juris} />
        <HandOff onOpenSettings={onOpenSettings} what="Address & Jurisdiction" />
      </div>
      <div className="border-t pt-2" style={{ borderTopColor: 'var(--color-border)' }}>
        <SiteEditor project={project} />
      </div>
      {/* ★ P-141: the Reuse-of picker the overview's Reuse row points at. */}
      <div className="border-t pt-2" style={{ borderTopColor: 'var(--color-border)' }}>
        <ReuseEditor project={project} allProjects={[]} />
      </div>
    </TabPanel>
  );
}

function DatesTab({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  const cycle0 = (bp?.permit_cycles ?? []).find((c) => c.cycle_index === 0);
  return (
    <TabPanel caption="Each date saves as you leave it. Accepted and Approved come from the Building Permit and are read-only.">
      {/* ★★ KEY DATES IS RENDERED BY `DDPhaseEditor` ITSELF — it always was,
          which is why the order of GO / Closing is *"stated once in
          KeyDatesSection"* in that file. Rendering it here as well put TWO
          `pd-go-date` rows on the tab, and the fix-311 suite caught it. It is
          rendered explicitly only on the two no-BP branches, where there is no
          `DDPhaseEditor` to carry it — which is exactly what the retired
          `DDPhaseCell` did. */}
      {bp ? (
        <DDPhaseEditor project={project} bp={bp} permits={permits} />
      ) : project.redesign_of_project_id && project.redesign_reuses_original_permit ? (
        <>
          <KeyDatesSection project={project} />
        // ★ fix-145's branch, kept: a reuse-redesign has no BP but DOES carry a
        //   draw_schedule lane, so the inline lane editor is the right control.
          <ReuseRedesignDdEditor project={project} />
        </>
      ) : (
        <>
          <KeyDatesSection project={project} />
          <p className="text-[11px] text-dim">
          No building permit — the DD window, target submit and intake dates
            hang off one.
          </p>
        </>
      )}
      {/* ★★ READ-ONLY, AND CAPTIONED WITH WHY. These two are scraped from the
          portal; an editable box would invite somebody to correct the city. */}
      <div className="border-t pt-2 flex flex-col gap-1" style={{ borderTopColor: 'var(--color-border)' }}>
        <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-dim)' }}>
          From the Building Permit
        </p>
        <ReadOnly
          label="Accepted"
          value={bp?.intake_date ? formatUsDate(bp.intake_date) : null}
          testId="project-data-accepted"
        />
        <ReadOnly
          label="Approved"
          value={
            bp?.approval_date
              ? formatUsDate(bp.approval_date)
              : bp?.actual_issue
                ? formatUsDate(bp.actual_issue)
                : null
          }
          testId="project-data-approved"
        />
        {/* ★ The intake-accepted value the Milestones card used to print, kept
            visible because 190 permits carry it and 3 disagree with
            `intake_date` — a reader chasing a discrepancy needs both. */}
        {cycle0?.intake_accepted && (
          <ReadOnly
            label="Cycle 0 accepted"
            value={formatUsDate(cycle0.intake_accepted)}
            testId="project-data-cycle0-accepted"
          />
        )}
      </div>
    </TabPanel>
  );
}

function TeamTab({
  project,
  bp,
  onOpenSettings,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  onOpenSettings: () => void;
}) {
  // ★★★ fix-347 §3's ONE DEFINITION — `projectInternalTeam`, the same
  //     computation the Team card and the `@project` smart tag read. A second
  //     lookup here is exactly how a tab and a card come to disagree about who
  //     is on a project.
  const internal = useMemo(() => projectInternalTeam(project, bp), [project, bp]);
  const values: Record<string, string | null> = {
    acq: project.acq_lead ?? null,
    ent: internal.ent,
    sd: internal.sd.length > 0 ? internal.sd.join(', ') : null,
    dm: internal.dm,
    da: internal.da,
    ca: internal.ca,
  };
  return (
    <TabPanel caption="Roles are assigned in Project Settings, where they save with the rest of the project in one write.">
      <div className="flex flex-col gap-1">
        {TEAM_INTERNAL_ROWS.map((r) => (
          <ReadOnly
            key={r.key}
            label={r.title}
            value={values[r.key] ?? null}
            testId={`project-data-role-${r.key}`}
          />
        ))}
      </div>
      <HandOff onOpenSettings={onOpenSettings} what="Internal team" />
    </TabPanel>
  );
}

function PlanTab({ projectId }: { projectId: string }) {
  const q = usePlanOfRecord(projectId);
  const row = q.data ?? null;
  return (
    <TabPanel caption="The plan of record is chosen by the file indexer from the share. Nothing here is editable — the share is the source of truth.">
      {!row ? (
        <p className="text-[11px] text-dim">No plan of record indexed yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <ReadOnly label="Set" value={row.set_type} />
          <ReadOnly label="File" value={row.file_name} />
          <ReadOnly label="Modified" value={row.modified_at?.slice(0, 10) ?? null} />
          {/* ★ fix-295's rule: the UNC path stays VISIBLE and selectable — it
              is how a person actually opens the file, and fix-289 established
              that a browser will not navigate to one. */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-dim)' }}>
              Path
            </span>
            <code
              className="text-[10px] break-all select-all p-1.5 rounded"
              style={{ background: 'var(--color-s2)', color: 'var(--color-text)' }}
              data-testid="project-data-plan-path"
            >
              {row.unc_path}
            </code>
          </div>
        </div>
      )}
    </TabPanel>
  );
}

function ActionsTab({
  project,
  allProjects,
  onSpawnRedesign,
  onReassignDa,
  canReassignDa,
  onDelete,
}: {
  project: Project;
  allProjects: readonly Project[];
  onSpawnRedesign?: () => void;
  onReassignDa?: () => void;
  canReassignDa: boolean;
  onDelete?: () => void;
}) {
  return (
    <TabPanel caption="Each action takes effect immediately or opens its own confirmation — none of them waits on a Save.">
      <ProjectHoldPanel projectId={project.id} />
      {/* ★ The three page-owned dialogs, handed in as callbacks exactly as
          fix-331 §4 handed them to Project Settings — so the PAGE still owns
          the one instance of each and two overlays never stack. */}
      <div className="flex flex-col gap-2 border-t pt-2" style={{ borderTopColor: 'var(--color-border)' }}>
        {onReassignDa && (
          <ActionRow
            label="Reassign DA"
            // ★ fix-225's rule, unchanged: ownership reassignment is admin-only.
            disabled={!canReassignDa}
            note={
              canReassignDa
                ? 'Moves this project and its open work to another Design Associate.'
                : 'Admins only.'
            }
            onClick={onReassignDa}
            testId="project-data-reassign-da"
          />
        )}
        {onSpawnRedesign && (
          <ActionRow
            label="Spawn redesign"
            note="Opens the wizard seeded from this project."
            onClick={onSpawnRedesign}
            testId="project-data-spawn-redesign"
          />
        )}
        {/* ★★★ fix-126's "Redesigns (N)" LIST, which came here with the action
            that creates them. It was a subsection of the overview's Proposal
            block; §C retires that block, and a list of this project's children
            belongs beside "Spawn redesign" rather than nowhere. ★ Hidden
            entirely at zero — an empty state here is noise, which is fix-126's
            own rule. */}
        <RedesignList projectId={project.id} allProjects={allProjects} />
        {onDelete && (
          <ActionRow
            label="Delete project"
            danger
            note="Asks first, and lists what goes with it."
            onClick={onDelete}
            testId="project-data-delete"
          />
        )}
      </div>
    </TabPanel>
  );
}

function ActionRow({
  label,
  note,
  onClick,
  danger,
  disabled,
  testId,
}: {
  label: string;
  note: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-text">{label}</div>
        <div className="text-[9.5px]" style={{ color: 'var(--color-muted)' }}>
          {note}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="text-[10.5px] font-bold px-2.5 py-1 rounded border flex-none disabled:opacity-40"
        style={{
          borderColor: danger ? 'var(--color-er-border)' : 'var(--color-border)',
          background: 'var(--color-surface)',
          color: danger ? 'var(--color-er)' : 'var(--color-text)',
        }}
        data-testid={testId}
      >
        {label}
      </button>
    </div>
  );
}

function ReadOnly({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline gap-2" data-testid={testId}>
      <span
        className="text-[9px] font-bold uppercase tracking-wide flex-none w-28"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
      </span>
      <span className="text-[11px] text-text min-w-0 truncate">
        {value ? value : <span className="text-dim">—</span>}
      </span>
    </div>
  );
}

/**
 * ★ This project's descendant redesigns, sorted by `created_at` ascending so
 *  "Redesign #1" is the first one spawned — fix-126's ordering, unchanged.
 */
function RedesignList({
  projectId,
  allProjects,
}: {
  projectId: string;
  allProjects: readonly Project[];
}) {
  const children = useMemo(
    () =>
      allProjects
        .filter((p) => p.redesign_of_project_id === projectId)
        .sort((a, b) => {
          const aT = a.created_at ?? '';
          const bT = b.created_at ?? '';
          if (aT !== bT) return aT.localeCompare(bT);
          return a.id.localeCompare(b.id);
        }),
    [allProjects, projectId],
  );
  const [open, setOpen] = useState(false);
  if (children.length === 0) return null;
  return (
    <div
      className="pt-1 border-t"
      style={{ borderTopColor: 'var(--color-border)' }}
      data-testid="pd-redesigns-section"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-bold text-co hover:opacity-80 transition"
        aria-expanded={open}
        data-testid="pd-redesigns-toggle"
      >
        <span className="font-mono">{open ? '▾' : '▸'}</span>
        Redesigns ({children.length})
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5" data-testid="pd-redesigns-list">
          {children.map((r, i) => (
            <li
              key={r.id}
              data-testid={`pd-redesign-row-${r.id}`}
              className="flex items-baseline justify-between gap-2 text-[10px]"
            >
              <OriginLink
                to={`/project/${r.id}`}
                className="font-display font-bold text-de hover:underline truncate"
              >
                Redesign #{i + 1}
              </OriginLink>
              <span className="text-dim font-mono truncate">
                {r.redesign_trigger ?? '—'}
                {r.redesign_reuses_original_permit === true
                  ? ' · reuse'
                  : r.redesign_reuses_original_permit === false
                    ? ' · new permits'
                    : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
