import { useMemo, useState } from 'react';
import OriginLink from '../OriginLink';
import type { ReactNode } from 'react';
import {
  DDPhaseEditor,
  KeyDatesSection,
  SiteEditor,
  UnitDimensions,
  UnitSizeEditor,
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
import {
  PROJECT_DETAILS_SEARCH,
  searchEntries,
} from '../../lib/projectDetailsForm';
import {
  useProjectDetailsForm,
  type ProjectDetailsFormController,
} from '../../hooks/useProjectDetailsForm';
import { useReassignProjectSd } from '../../hooks/useProjectSdHandoffs';
import {
  BuilderOwnerFields,
  GoDateField,
  InternalTeamFields,
  PermitsFormSection,
  ProjectFlagFields,
  SiteIdentityFields,
  UnitCountAndProductTypes,
} from './ProjectDetailsForm';
import type { PermitWithCycles, Project } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §G (P-140) — PROJECT DATA · ★★★ fix-514 §A (P-191) — PROJECT DETAILS
// ===========================================================================
//
// ★★★ fix-514 §A: THE SURFACE IS `Project Details` AND `ProjectSettingsModal`
//     IS DELETED — not deprecated, not hidden, removed with its three test
//     files. Bobby: *"Project Data, Project Settings, all merged under one
//     house into Project Details, and anything that was editable in the
//     previous one needs to be editable here. So there's no more Project
//     Settings."*
//
// ★★★ AND THIS TICKET IS THE SECOND HALF OF fix-506, which recorded its own
//     deviation plainly: *"`ProjectSettingsModal` survives — Project Data is
//     the button users see; the old modal was not deleted in this ticket."*
//     A modal whose job was to tell you to open another modal is the seam that
//     produced P-191. The note below is fix-506's reasoning for keeping it, and
//     every clause of it is now false — kept as the record of why the hand-off
//     existed rather than deleted, because the next person to consider a
//     hand-off should be able to read how this one aged.
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
// ★★★ [SUPERSEDED BY fix-514 §A] AND `ProjectSettingsModal` IS **NOT** RETIRED. The brief allows it —
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
  onSpawnRedesign?: () => void;
  onReassignDa?: () => void;
  canReassignDa?: boolean;
  onDelete?: () => void;
}

export default function ProjectDetailsModal({
  project,
  permits,
  bp,
  allProjects = [],
  initialTab = 'site',
  onClose,
  onSpawnRedesign,
  onReassignDa,
  canReassignDa = false,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<ProjectDataTab>(initialTab);
  // ★★★ fix-514 §A/§B — the atomic form Project Settings used to hold, now
  //     owned here. ONE controller for the whole modal, which is what makes
  //     §B's dirty flag true of the modal rather than of a tab.
  const ctl = useProjectDetailsForm(project, permits);
  const reassignSd = useReassignProjectSd();
  // ★★★ §C — search. `query` drives a dropdown of destinations; picking one
  //     switches tabs. State is local because a search is a way of GETTING
  //     somewhere, not a place you can be.
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchEntries(PROJECT_DETAILS_SEARCH, query), [query]);

  async function saveAndClose() {
    const ok = await ctl.save();
    if (ok) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      // ★★★ fix-440 (P-057) / fix-411 §1 (B3): the backdrop does nothing, and
      //     neither does Escape. Bobby's narrowed ruling — of sixteen overlays,
      //     only the ones that HOLD UNSAVED INPUT stop closing on an outside
      //     click. Half the tabs in here are live per-field editors with a date
      //     input mid-edit, so a stray click would throw away a value somebody
      //     was part-way through typing. The exits are the × and the footer
      //     button, both explicit. ★ And no keydown handler: fix-440 found that
      //     `onKeyDown` on a non-focusable div is DEAD, so an Escape handler
      //     here would look present and do nothing.
      //
      // ★★★ fix-514 §A/§B MAKE THAT RULE STRONGER, NOT WEAKER. This modal now
      //     holds the whole atomic project form that `ProjectSettingsModal`
      //     used to — address, jurisdiction, the roles, the permit rows — so a
      //     stray outside click would discard a draft rather than one date. §B
      //     is the other half of the same answer: the footer says `Save` when
      //     there is something to lose and `Exit` when there is not.
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
            Project Details
          </span>

          {/* ★★★ fix-514 §C (P-191) — SEARCH, RIGHT NEXT TO THE NAME.
              Bobby: *"right next to where it says Project Details, if there
              was a search — you type it in and it takes you to that tab, so
              you can see where that update actually lives."*
              ★ The matcher is generic (`searchEntries`) so
              [[P-166-settings-needs-categories-and-search]] inherits a working
              pattern rather than a second implementation. */}
          <div className="relative flex-1 max-w-[280px] ml-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a field…"
              className="w-full px-2 py-1 text-[11px] border rounded"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              data-testid="project-details-search"
            />
            {hits.length > 0 && (
              <ul
                className="absolute left-0 right-0 top-full mt-1 z-10 rounded border shadow-lg max-h-[240px] overflow-y-auto"
                style={{
                  background: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                }}
                data-testid="project-details-search-results"
              >
                {hits.map((h) => (
                  <li key={`${h.key}:${h.label}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setTab(h.key);
                        setQuery('');
                      }}
                      className="w-full text-left px-2 py-1 text-[11px] hover:bg-bg/60 flex items-baseline justify-between gap-2"
                      data-testid={`project-details-search-hit-${h.key}`}
                    >
                      <span className="text-text truncate">{h.label}</span>
                      <span className="text-[9px] text-dim flex-none uppercase tracking-wide">
                        {PROJECT_DATA_TABS.find((t) => t.key === h.key)?.label ?? h.key}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-dim hover:text-text text-[14px] leading-none"
            title={ctl.dirty ? 'Close without saving' : 'Close'}
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
          {tab === 'site' && <SiteTab project={project} ctl={ctl} />}
          {tab === 'dates' && (
            <DatesTab project={project} bp={bp} permits={permits} ctl={ctl} />
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
              {/* ★★★ fix-514 §E (P-215) — THE TYPED SQUARE FOOTAGE, below the
                  matrix rather than inside it. `UNIT_ROW_COLUMNS` drives the
                  PROJECT card's floor on the Overview, so a ninth column there
                  costs 76px of overview row minimum — fix-488 §B measured it
                  and reverted. This modal is 760px and owes that nothing. */}
              <div className="border-t pt-2" style={{ borderTopColor: 'var(--color-border)' }}>
                <p
                  className="text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: 'var(--color-dim)' }}
                >
                  Unit size (sf)
                </p>
                <UnitSizeEditor project={project} />
              </div>
              {/* ★★★ fix-514 §A: the unit COUNT and the product types, which
                  Project Settings owned and this tab could only display. */}
              <div className="border-t pt-2" style={{ borderTopColor: 'var(--color-border)' }}>
                <UnitCountAndProductTypes ctl={ctl} />
              </div>
            </TabPanel>
          )}
          {/* ★★★ fix-514 §A0 — THE PERMITS TAB. The one part of the leftover
              set no existing tab could absorb, and §G's per-permit ACQ date
              lands on the same rows. */}
          {tab === 'permits' && (
            <TabPanel caption="Permit rows save with the Save button — type, ENT, DA, number, portal URL, structure address and the ACQ target date all ride in one atomic write.">
              <PermitsFormSection ctl={ctl} />
            </TabPanel>
          )}
          {tab === 'builder' && (
            <TabPanel caption="The point of contact saves with the Save button. The builder themself is picked on the overview and edited in Settings → Builders & Owners.">
              <BuilderOwnerFields ctl={ctl} />
            </TabPanel>
          )}
          {tab === 'team' && <TeamTab project={project} bp={bp} ctl={ctl} canReassignDa={canReassignDa} onReassignSd={(n) => reassignSd.mutate({ projectId: project.id, toSd: n })} sdPending={reassignSd.isPending} />}
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
              ctl={ctl}
              onSpawnRedesign={onSpawnRedesign}
              onReassignDa={onReassignDa}
              canReassignDa={canReassignDa}
              onDelete={onDelete}
            />
          )}
        </div>

        {/* ★★★ fix-514 §B (P-191) — SAVE vs EXIT IS A DIRTY-STATE CONTRACT.
            Bobby: *"if you're making a change, then instead of clicking Done it
            says **Save**, and if you don't make a change you have the X at the
            top and it would say **Exit** versus Done."*

            ★★★ ONE FLAG FOR THE WHOLE MODAL, not one per tab — §B says so, and
                the reason is that a per-tab flag shows `Exit` while an unsaved
                edit sits on the tab you are not looking at.

            ★★ AND IT IS A COMPARISON AGAINST WHAT LOADED, not a touched-flag,
               so typing a character and deleting it again reads as clean.
               `lib/projectDetailsForm.projectDetailsFormIsDirty`. */}
        <footer
          className="px-4 py-2 border-t flex items-center justify-between gap-3"
          style={{ borderTopColor: 'var(--color-border)' }}
        >
          <span className="text-[9.5px]" style={{ color: 'var(--color-muted)' }}>
            {ctl.dirty
              ? 'Unsaved changes on this project.'
              : 'Per-field tabs save as you leave each box.'}
          </span>
          <button
            type="button"
            onClick={ctl.dirty ? () => void saveAndClose() : onClose}
            disabled={ctl.saving}
            className="text-[11px] font-bold px-3 py-1.5 rounded border disabled:opacity-50"
            style={{
              borderColor: 'var(--color-de)',
              background: ctl.dirty ? 'var(--color-de)' : 'var(--color-surface)',
              color: ctl.dirty ? '#fff' : 'var(--color-de)',
            }}
            data-testid="project-data-done"
            data-dirty={ctl.dirty ? 'true' : 'false'}
          >
            {ctl.saving ? 'Saving…' : ctl.dirty ? 'Save' : 'Exit'}
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

function SiteTab({
  project,
  ctl,
}: {
  project: Project;
  ctl: ProjectDetailsFormController;
}) {
  return (
    <TabPanel caption="Zone, lot and tags save as you leave each box. Address and Jurisdiction ride the Save button — they are part of the project's single atomic write.">
      {/* ★★★ fix-514 §A: these two were READ-ONLY here, under a caption that
          told you to open another modal. They are inputs now. */}
      <SiteIdentityFields ctl={ctl} />
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
  ctl,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
  ctl: ProjectDetailsFormController;
}) {
  const cycle0 = (bp?.permit_cycles ?? []).find((c) => c.cycle_index === 0);
  return (
    <TabPanel caption="Each date saves as you leave it, except the GO date, which rides the Save button. Accepted and Approved come from the Building Permit and are read-only.">
      {/* ★★★ fix-514 §A: the GO date was read-only here with a tooltip naming
          a page that no longer exists. */}
      <GoDateField ctl={ctl} />
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
  ctl,
  canReassignDa,
  onReassignSd,
  sdPending,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  ctl: ProjectDetailsFormController;
  canReassignDa: boolean;
  onReassignSd: (name: string | null) => void;
  sdPending: boolean;
}) {
  // ★★★ fix-347 §3's ONE DEFINITION — `projectInternalTeam`, the same
  //     computation the Team card and the `@project` smart tag read.
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
    <TabPanel caption="Roles ride the Save button, except the Schematic Designer — changing that moves their open tasks and saves immediately.">
      {/* ★★★ fix-514 §A: this tab printed six read-only rows and a button to
          another modal. The pickers are here now. The rows stay BELOW them,
          because they show what the project RESOLVES to — `projectInternalTeam`
          falls back through the BP when a project-level field is blank, so the
          picker and the resolved answer are two different facts. */}
      <InternalTeamFields
        ctl={ctl}
        canReassignDa={canReassignDa}
        onReassignSd={onReassignSd}
        sdPending={sdPending}
      />
      <div
        className="border-t pt-2 flex flex-col gap-1"
        style={{ borderTopColor: 'var(--color-border)' }}
      >
        <p
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--color-dim)' }}
        >
          Resolved on this project
        </p>
        {TEAM_INTERNAL_ROWS.map((r) => (
          <ReadOnly
            key={r.key}
            label={r.title}
            value={values[r.key] ?? null}
            testId={`project-data-role-${r.key}`}
          />
        ))}
      </div>
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
  ctl,
  onSpawnRedesign,
  onReassignDa,
  canReassignDa,
  onDelete,
}: {
  project: Project;
  allProjects: readonly Project[];
  ctl: ProjectDetailsFormController;
  onSpawnRedesign?: () => void;
  onReassignDa?: () => void;
  canReassignDa: boolean;
  onDelete?: () => void;
}) {
  return (
    <TabPanel caption="Each action takes effect immediately or opens its own confirmation. The two checkboxes are the exception — they ride the Save button.">
      <ProjectHoldPanel projectId={project.id} />
      {/* ★★★ fix-514 §A: Archived and Backfilled, the last two fields Project
          Settings owned. They stay QUIET and away from the board — fix-386's
          rule for the backfill flag, which must not become a lever for
          silencing milestones somebody would rather not look at. */}
      <div className="border-t pt-2" style={{ borderTopColor: 'var(--color-border)' }}>
        <ProjectFlagFields ctl={ctl} />
      </div>
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
