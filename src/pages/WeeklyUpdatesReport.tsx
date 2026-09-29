import { useMemo, useState } from 'react';
import OriginLink from '../components/OriginLink';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useAllNotes } from '../hooks/useNotes';
import {
  useAllProjectHolds,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import { excludeCancelled } from '../lib/projectViewHelpers';
import NoteRow from '../components/notes/NoteRow';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import type { Note, Permit, Project } from '../lib/database.types';
import { excludeDeleted } from '../lib/activeProject';

// fix-notes-3: Weekly Updates report — every project's running notes in one
// place for Bobby's Monday pass. Grouped by project: the holistic project
// note(s) first, then each permit's active notes (permit_order), newest first.
//
// ═════════════════════════════════════════════════════════════════════
// ★★★ fix-570 (P-275) — IT READS. IT NO LONGER WRITES.
// ═════════════════════════════════════════════════════════════════════
//
// fix-notes-3 built every note here editable, with an add box per scope. That
// was the fifth and last permit-level note writer in the app, and Bobby's
// 2026-09-15 ruling removes it: *"remove the permit level note, we only need a
// tasks level note."*
//
// ★★★ THE REPORT ITSELF STAYS, AND THAT IS THE POINT OF THE TICKET. Retiring
//     it was offered as option 2 and **explicitly declined**: *"1 - we will
//     revise the weekly da concept in the future."* A revision needs something
//     standing to revise. The route, the nav entry, the builtin-report
//     registration and the read path are all untouched.
//
// ★★ NOBODY LOSES ANYTHING. `public.notes` has held 0 rows since fix-559
//    emptied it, and `max(created_at)` is NULL — **not one row has ever been
//    written through this surface since**. The editor removed here had no users.
//
// ⛔ AND THE READER IS NOT RE-POINTED at chat or at task notes. It still reads
//    `public.notes` and will render nothing for ever. That is correct, and the
//    banner and the empty states below are what make it legible instead of
//    looking broken.

interface PermitScope {
  permit: Permit;
  notes: Note[];
}
interface ProjectGroup {
  project: Project;
  holistic: Note[];
  permits: PermitScope[];
  /** any ACTIVE (completed=false) note anywhere in this project group */
  hasActiveNotes: boolean;
}

function permitLabel(p: Permit): string {
  const base =
    p.type === 'Building Permit' && p.nickname
      ? `Building Permit — ${p.nickname}`
      : p.type ?? 'Permit';
  const parts = [base];
  if (p.num) parts.push(p.num);
  if (p.struct_address) parts.push(p.struct_address);
  return parts.join(' · ');
}

// ═════════════════════════════════════════════════════════════════════
// ★★★ fix-570 §C — THE EMPTY STATE, WRITTEN ONCE
// ═════════════════════════════════════════════════════════════════════
//
// §C: *"Give the emptied region a plain empty state that says the notes moved
// — to the project's General chat channel and to task-level notes — rather
// than leaving a blank panel that looks broken."*
//
// ★★ IT NAMES BOTH DESTINATIONS, and it is the same sentence in both places it
//    appears (the whole-report branch and the per-project branch) so the two
//    cannot drift into saying different things about where a note went.
//
// ⛔ IT DOES NOT LINK. A link would be re-pointing the reader, which §C forbids.
//    It says where to look; the reader walks there.
const NOTES_MOVED_EMPTY =
  'No notes here — project notes moved to the project\u2019s General channel, '
  + 'and a note about a task now lives on the task.';

function hasActive(notes: Note[]): boolean {
  return notes.some((n) => !n.completed);
}

export default function WeeklyUpdatesReport() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const notesQ = useAllNotes();
  // fix-264: this is Bobby's Monday "what's moving" pass — a cancelled project
  // has nothing moving, so it leaves the report the same way it leaves the
  // Dashboard. Its notes stay on the project page; this is a live-work view.
  const holdsQ = useAllProjectHolds();
  const cancelledIds = useMemo(
    () => cancelledProjectIds(holdsQ.data),
    [holdsQ.data],
  );
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);

  const groups = useMemo<ProjectGroup[]>(() => {
    // ★ fix-557: deleted is not the same rule as cancelled — both apply.
    const projects = excludeCancelled(
      excludeDeleted(projectsQ.data),
      cancelledIds,
    );
    const permits = permitsQ.data ?? [];
    const notes = notesQ.data ?? []; // already created_at DESC (newest first)

    const permitsByProject = new Map<string, Permit[]>();
    for (const pm of permits) {
      const list = permitsByProject.get(pm.project_id) ?? [];
      list.push(pm);
      permitsByProject.set(pm.project_id, list);
    }
    const notesByProjectHolistic = new Map<string, Note[]>();
    const notesByPermit = new Map<number, Note[]>();
    for (const n of notes) {
      if (n.permit_id == null) {
        const list = notesByProjectHolistic.get(n.project_id) ?? [];
        list.push(n);
        notesByProjectHolistic.set(n.project_id, list);
      } else {
        const list = notesByPermit.get(n.permit_id) ?? [];
        list.push(n);
        notesByPermit.set(n.permit_id, list);
      }
    }

    const out: ProjectGroup[] = projects
      .map((project) => {
        const order = Array.isArray(project.permit_order)
          ? project.permit_order
          : [];
        const permitList = [...(permitsByProject.get(project.id) ?? [])].sort(
          (a, b) => {
            const ia = order.indexOf(a.id);
            const ib = order.indexOf(b.id);
            const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
            const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
            return ra !== rb ? ra - rb : a.id - b.id;
          },
        );
        const holistic = notesByProjectHolistic.get(project.id) ?? [];
        const permitScopes: PermitScope[] = permitList.map((permit) => ({
          permit,
          notes: notesByPermit.get(permit.id) ?? [],
        }));
        const hasActiveNotes =
          hasActive(holistic) || permitScopes.some((s) => hasActive(s.notes));
        return { project, holistic, permits: permitScopes, hasActiveNotes };
      })
      .sort((a, b) => {
        // Projects with active notes first (Bobby's Monday attention), then the
        // rest — both alphabetical by address.
        if (a.hasActiveNotes !== b.hasActiveNotes) {
          return a.hasActiveNotes ? -1 : 1;
        }
        return a.project.address.localeCompare(b.project.address);
      });

    return onlyWithNotes ? out.filter((g) => g.hasActiveNotes) : out;
  }, [projectsQ.data, permitsQ.data, notesQ.data, onlyWithNotes, cancelledIds]);

  const error = projectsQ.error ?? permitsQ.error ?? notesQ.error;
  if (error) {
    return (
      <QueryError
        title="Weekly Updates failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
          notesQ.refetch();
        }}
      />
    );
  }
  const isLoading =
    projectsQ.isLoading || permitsQ.isLoading || notesQ.isLoading;

  const withNotesCount = groups.filter((g) => g.hasActiveNotes).length;

  return (
    <div className="space-y-4" data-testid="weekly-updates-report">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-display font-extrabold text-text">
            Weekly Updates
          </h1>
          {/* ★★★ fix-570: the old copy invited the reader to edit, add or
              complete a note here and said it wrote straight back. There is no
              writer any more, so that sentence would be the screen telling
              somebody to do something it cannot do. Read-only is stated, not
              implied.

              ⚠️ DESCRIBED, NOT QUOTED — for the same reason as the banner
                 below. A comment-stripping assertion only drops lines starting
                 `//` or `*`, so reproducing the retired sentence inside a JSX
                 block comment keeps the "it is gone" test green while the
                 shipped copy no longer says it. **Eighth time in this repo.** */}
          <p className="text-[11px] text-muted">
            Every project&apos;s running notes — holistic project notes plus each
            permit&apos;s active notes, newest first. Read-only.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-text cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyWithNotes}
            onChange={(e) => setOnlyWithNotes(e.target.checked)}
            data-testid="weekly-updates-only-with-notes"
          />
          Only projects with active notes
          {!isLoading && (
            <span className="text-dim">({withNotesCount})</span>
          )}
        </label>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ★★★ fix-569 §B — WHY THIS REPORT IS EMPTY, SAID ON THE REPORT
          ═══════════════════════════════════════════════════════════════

          This report IS the `public.notes` rows, grouped by project. fix-559
          deleted all 107 of them by Bobby's ruling (applied 2026-09-15; the
          backup holds them and every one is in the General channel), so every
          note section below is empty and will stay empty.

          ★★★ AN EMPTY REPORT WITH NO EXPLANATION READS AS A BUG and gets
              reported as one. One sentence, standing — not only in the
              empty-state branch, because the "only with notes" filter DEFAULTS
              OFF: the usual render lists projects with blank note sections and
              never reaches that branch at all.

          ⚠️ DELIBERATELY NOT RE-POINTED at chat or at task notes. That is a
             product decision Bobby has not made (fix-569 §B, fix-570 §C). This
             says where the notes went; it does not go and get them.

          ★★★ fix-570 REWORDED THE LAST SENTENCE, WHICH HAD BECOME FALSE.
              It used to say that anything added here went no further than this
              report — true while the add boxes existed, and a promise about a
              control that is now gone.

          ⚠️ THE OLD WORDING IS DESCRIBED, NOT QUOTED. fix-569 asserts the
             retired sentence is absent from this file, and its comment-stripper
             only drops lines beginning `//` or `*` — so reproducing the phrase
             inside THIS block comment would have kept that test green while the
             shipped copy no longer said it. It went green for exactly that
             reason once, and this is the fix. */}
      <div
        className="text-[11px] px-3 py-2 mb-3 rounded border"
        style={{
          background: 'var(--color-s2)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
        data-testid="weekly-updates-notes-moved"
      >
        The 107 project notes moved to each project&rsquo;s General channel, and
        a note about a task now lives on the task. This report reads notes; it
        no longer takes them.
      </div>

      {isLoading ? (
        <SkeletonRows count={5} rowClassName="h-20" />
      ) : groups.length === 0 ? (
        <div
          className="text-xs text-dim italic px-3 py-8 bg-s2 border border-border rounded text-center"
          data-testid="weekly-updates-empty"
        >
          {/* ★ fix-569 §B: "right now" implied this might fill up again. It
              will not — the notes moved. */}
          {onlyWithNotes
            ? NOTES_MOVED_EMPTY
            : 'No active projects.'}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <ProjectGroupCard key={g.project.id} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectGroupCard({ group }: { group: ProjectGroup }) {
  const { project, holistic, permits } = group;
  // ★★★ fix-570 §C — ONE EMPTY STATE PER PROJECT, NOT ONE PER SCOPE.
  //
  //     §C asks for *"a plain empty state that says the notes moved … rather
  //     than leaving a blank panel that looks broken"*. With the table
  //     permanently empty EVERY scope is empty, so the honest rendering of a
  //     project is one sentence — not a holistic scope plus one per permit,
  //     each repeating "No active notes." beneath its own heading.
  //
  //     ★★ THE SCOPES ARE NOT DELETED. If a note ever exists again the scopes
  //        render exactly as they did, which is what keeps the read path intact.
  //        This branch is reached only when the whole group is empty.
  const empty =
    holistic.length === 0 && permits.every(({ notes }) => notes.length === 0);
  return (
    <section
      className="bg-surface border border-border rounded-xl overflow-hidden"
      data-testid={`weekly-updates-project-${project.id}`}
    >
      <header
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <OriginLink
          to={`/project/${project.id}`}
          className="text-sm font-display font-bold text-text hover:text-de transition truncate"
        >
          {project.address}
        </OriginLink>
        {project.juris && (
          <span className="text-[10px] text-muted font-mono flex-shrink-0">
            {project.juris}
          </span>
        )}
      </header>

      <div className="p-3 space-y-3">
        {empty ? (
          <div
            className="text-[11px] text-dim italic"
            data-testid={`weekly-updates-moved-${project.id}`}
          >
            {NOTES_MOVED_EMPTY}
          </div>
        ) : (
          <>
        {/* Holistic project scope */}
        <NotesScope
          label="Project (holistic)"
          notes={holistic}
          testid={`wu-scope-project-${project.id}`}
        />
        {/* Per-permit scopes, in permit_order */}
        {permits.map(({ permit, notes }) => (
          <NotesScope
            key={permit.id}
            label={permitLabel(permit)}
            notes={notes}
            testid={`wu-scope-permit-${permit.id}`}
          />
        ))}
          </>
        )}
      </div>
    </section>
  );
}

function NotesScope({
  label,
  notes,
  testid,
}: {
  label: string;
  notes: Note[];
  testid: string;
}) {
  // ★★★ fix-570 — fix-569 REPORTED THIS WRITER; BOBBY RULED; IT IS GONE.
  //
  //     fix-569's brief said *"one writer survived"* — the Weekly DA report's
  //     note box, which it removed. Grepping the HOOKS (which its §A asked for)
  //     found a second: this scope's add box and inline editing. fix-569
  //     reported it rather than improvising, and P-275 is Bobby's answer:
  //     **option 1, remove the writer.**
  //
  // ★★ WHAT WENT: `useAddNote`, `useUpdateNote`, the `<AddNoteBox>` and the two
  //    callbacks `NoteRow` used to write through. Both hooks are deleted from
  //    `useNotes` — an exported mutation with no call site is still a writer.
  //
  // ⚠️ WHAT STAYED: everything that READS. The active/completed split, the
  //    newest-first order and the history toggle are all untouched, because the
  //    ruling removed the writer and not the report.
  const [showHistory, setShowHistory] = useState(false);

  const active = useMemo(() => notes.filter((n) => !n.completed), [notes]);
  const completed = useMemo(
    () =>
      [...notes.filter((n) => n.completed)].sort((a, b) =>
        (b.completed_at ?? b.created_at).localeCompare(
          a.completed_at ?? a.created_at,
        ),
      ),
    [notes],
  );

  return (
    <div
      className="border border-border rounded-lg p-2.5 space-y-2"
      style={{ background: 'var(--color-bg)' }}
      data-testid={testid}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-dim">
        {label}
      </div>

      {active.length === 0 ? (
        <div
          className="text-[11px] text-dim italic"
          data-testid={`${testid}-empty`}
        >
          {/* ★ Reached only when this ONE scope is empty while its project has
              notes elsewhere. A wholly empty project renders the group-level
              sentence instead — see `ProjectGroupCard`. */}
          No notes in this scope.
        </div>
      ) : (
        <ul className="flex flex-col gap-1" data-testid={`${testid}-active`}>
          {active.map((n) => (
            <NoteRow key={n.id} note={n} />
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[10px] font-bold text-dim hover:text-text transition"
            data-testid={`${testid}-history-toggle`}
          >
            {showHistory ? '▾' : '▸'} Completed / history ({completed.length})
          </button>
          {showHistory && (
            <ul
              className="flex flex-col gap-1 mt-1 opacity-70"
              data-testid={`${testid}-history`}
            >
              {completed.map((n) => (
                <NoteRow key={n.id} note={n} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
