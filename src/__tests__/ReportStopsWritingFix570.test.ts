import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

// ===========================================================================
// ★★★ fix-570 (P-275) — THE REPORT STOPS WRITING THE NOTE NOBODY READS
// ===========================================================================
//
// Bobby, 2026-09-15: *"remove the permit level note, we only need a tasks level
// note."* fix-559 removed three mounts, fix-569 the fourth, and fix-569's own
// hook-scoped grep found a fifth — the Weekly Updates report's add/edit surface
// — and REPORTED it rather than removing it unasked. P-275 is Bobby's answer:
// **option 1, remove the writer.**
//
// ---------------------------------------------------------------------------
// ⚠️⚠️ THE OPTION HE DID NOT TAKE, AND IT IS THE TRAP IN THIS TICKET
// ---------------------------------------------------------------------------
//
// Option 2 was retiring the Weekly Updates report entirely — tidier and larger,
// since the report IS those notes grouped and the notes are gone. He declined it
// in as many words:
//
//     *"1 - we will revise the weekly da concept in the future."*
//
// ★★★ A REVISION IS NOT A RETIREMENT. A revision needs something standing to
//     revise. ⛔ If this ticket ends with a report that no longer exists it is
//     wrong even though the notes are gone — so the route, the nav entry, the
//     builtin-report registration and the read path are each asserted BY NAME
//     below, not left implied.
//
// ---------------------------------------------------------------------------
// §A — RE-MEASURED ON PROD 2026-09-29, because the brief was 15 days old
// ---------------------------------------------------------------------------
//
//   live rows in `notes` ................................. 0    (brief: 0 ✓)
//   permit-level rows .................................... 0    (brief: 0 ✓)
//   rows written since fix-559 emptied it ................ 0    ★ see below
//   backup `notes_deleted_fix559` ........................ 107  (brief: 107 ✓)
//   copies in General (`project_messages.source_note_id`)  107  (brief: 107 ✓)
//   `permit_tasks.notes` — the level that SURVIVES ....... **43** (brief: 27)
//
// ★★★ ONE NUMBER MOVED, AND IT MOVED THE RIGHT WAY. Task notes are 43 of 2,106
//     rows, up from 27 of 1,810 when the brief was written. The level the ruling
//     KEPT is in active use; the level it removed has had nothing written to it.
//
// ★★ "ZERO SINCE fix-559" IS MEASURED, NOT ASSUMED: `max(created_at)` on `notes`
//    is NULL, so the table holds no row of any age. Nobody has typed into this
//    surface once since it was emptied — **removing it takes nothing from
//    anyone**, which is the thing to say out loud when deleting an editor.

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

/** ★ Source with comment lines stripped — the gravestone trap, seventh time in
 *  this repo. An assertion that a thing is GONE must not be satisfied by the
 *  note explaining its removal. */
const code = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(ent.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

const WRITE_HOOKS = ['useAddNote', 'useUpdateNote'] as const;
const READ_HOOKS = ['useAllNotes', 'useProjectNoteSearchIndex'] as const;

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-570 §B — the writers, as an exact list', () => {
  it('★★★ ZERO write call sites of the note hooks, anywhere in the app', () => {
    // ★★★ THE ASSERTION THE BRIEF ASKS FOR, AND IT IS A LIST RATHER THAN A
    //     COUNT: *"asserted as an exact list, so the next sweep starts from a
    //     measurement rather than a premise."*
    //
    // ★★ Three sweeps in a row ended with "the hook grep found one more"
    //    (fix-559 → fix-569 → fix-570). An empty list is what ends that.
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const body = code(readFileSync(f, 'utf8'));
      for (const h of WRITE_HOOKS) {
        if (new RegExp(`\\b${h}\\b`).test(body)) offenders.push(f.split(sep).pop()!);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('★★★ …and the hooks themselves are deleted, not left exported', () => {
    // ★★★ P-275 IS LITERALLY *"one permit-level note WRITER survives"*. An
    //     exported mutation hook with no call site IS that writer, still
    //     standing and waiting for the next sweep to find it.
    //
    // ⚠️ §B's literal words were *"the mutation hook's call site"*, so this goes
    //    one step further and the PR says so. The licence is the Do-NOT list,
    //    which protects *"the hooks the READERS still use"* — a carve-out that
    //    only ever covered the two readers.
    const hooks = code(read('hooks/useNotes.ts'));
    for (const h of WRITE_HOOKS) {
      expect(hooks, h).not.toContain(`export function ${h}`);
    }
    expect(hooks).not.toContain('AddNoteInput');
    expect(hooks).not.toContain('UpdateNoteInput');
    // ★ and the imports they needed go with them, or lint fails on unused
    expect(hooks).not.toContain('useMutation');
    expect(hooks).not.toContain('useQueryClient');
  });

  it('★★★ the two READERS survive — the brief protects them by name', () => {
    // ⛔ *"Do NOT delete … the hooks the readers still use."*
    const hooks = code(read('hooks/useNotes.ts'));
    for (const h of READ_HOOKS) {
      expect(hooks, h).toContain(`export function ${h}`);
    }
  });

  it('★★★ `AddNoteBox` is gone — it existed only to serve the writer', () => {
    // §B: *"Anything that exists only to serve them."* The Weekly Updates report
    // was its ONLY consumer, so it dies with the add control rather than
    // lingering as a component nothing mounts.
    expect(existsSync(resolve(SRC, 'components/notes/AddNoteBox.tsx'))).toBe(false);
    const offenders = sourceFiles().filter((f) =>
      /\bAddNoteBox\b/.test(code(readFileSync(f, 'utf8'))),
    );
    expect(offenders.map((f) => f.split(sep).pop())).toEqual([]);
  });

  it('★★★ `NoteRow` SURVIVES, and is read-only', () => {
    // ★★ It is the read path's renderer. §C keeps the read path, so the row that
    //    renders a note stays — stripped of the two callbacks it used to write
    //    through. Deleting it would have been deleting a reader.
    const src = code(read('components/notes/NoteRow.tsx'));
    expect(src).toContain('export default function NoteRow');
    expect(src).not.toContain('onCommitBody');
    expect(src).not.toContain('onSetCompleted');
    // ★★★ NO EDITOR AND NO BUTTON. Both halves matter: a <button> that called
    //     nothing would still invite a click that silently does nothing.
    expect(src).not.toContain('<textarea');
    expect(src).not.toContain('<button');
    expect(src).not.toContain('useState');
    // ★ the completion MARKER stays — whether a note is done is information
    expect(src).toContain('note-complete-');
  });

  it('★★ the report no longer promises editing in its own copy', () => {
    const src = code(read('pages/WeeklyUpdatesReport.tsx'));
    expect(src).not.toContain('Edit, add, or complete a note');
    expect(src).toContain('Read-only.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-570 §C — the report still exists, and that is the ruling', () => {
  // ⛔ THE THING THIS TICKET PROTECTS. Retiring the report was option 2 and was
  //    declined: *"we will revise the weekly da concept in the future."* Each
  //    registration is asserted by name so an over-eager future sweep trips.

  it('★★★ the ROUTE still exists', () => {
    const src = code(read('router.tsx'));
    expect(src).toContain("path: 'reports/weekly-updates'");
    expect(src).toContain('<WeeklyUpdatesReport />');
  });

  it('★★★ the BUILTIN REPORT registration still exists', () => {
    // ★ The hub lists from `saved_reports`, seeded from this file — registering
    //   is what makes it appear at all (the fix-350 lesson).
    const src = code(read('lib/builtinReports.ts'));
    expect(src).toContain("route: '/reports/weekly-updates'");
    expect(src).toContain('component: WeeklyUpdatesReport');
  });

  it('★★★ the RIBBON NAV entry still exists', () => {
    expect(code(read('lib/ribbonNav.ts'))).toContain("path: '/reports/weekly-updates'");
  });

  it('★★★ the PREVIOUS-origin label still exists', () => {
    // fix-408: the origin is router state, and a page with no label reads as
    // "Previous" with nothing after it.
    expect(code(read('lib/previousOrigin.ts'))).toContain('Weekly Updates');
  });

  it('★★★ the page component still exists and still READS notes', () => {
    const src = code(read('pages/WeeklyUpdatesReport.tsx'));
    expect(src).toContain('export default function WeeklyUpdatesReport');
    expect(src).toContain('useAllNotes()');
    expect(src).toContain('data-testid="weekly-updates-report"');
  });

  it('★★★ the reader is NOT re-pointed at chat or at task notes', () => {
    // ⛔ §C: *"Do not re-point the reader at chat or at task notes. That is a
    //    product decision nobody has made."* It still reads `public.notes`, and
    //    it names where the notes went without going to get them.
    const src = code(read('pages/WeeklyUpdatesReport.tsx'));
    for (const forbidden of [
      'useProjectChat',
      'project_messages',
      'usePermitTasks',
      'permit_tasks',
      'useTasks',
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-570 §C — the empty state names where the notes went', () => {
  const src = code(read('pages/WeeklyUpdatesReport.tsx'));

  it('★★★ ONE constant, used by both empty branches', () => {
    // ★★ So the whole-report state and the per-project state cannot drift into
    //    saying different things about where a note went.
    expect(src).toContain('const NOTES_MOVED_EMPTY');
    expect((src.match(/NOTES_MOVED_EMPTY/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('★★★ it names BOTH destinations, which is what §C asks for', () => {
    // *"says the notes moved — to the project's General chat channel and to
    // task-level notes"*
    expect(src).toContain('General channel');
    expect(src).toContain('lives on the task');
  });

  it('★★★ it does NOT link — a link would be re-pointing', () => {
    const decl = src.slice(src.indexOf('const NOTES_MOVED_EMPTY'));
    const sentence = decl.slice(0, decl.indexOf(';'));
    expect(sentence).not.toContain('href');
    expect(sentence).not.toContain('OriginLink');
    expect(sentence).not.toContain('/project/');
  });

  it('★★ the standing banner survives and no longer promises a writer', () => {
    // fix-569 put it there because an empty report with no explanation reads as
    // a bug. It must outlive the writer it used to describe.
    expect(src).toContain('weekly-updates-notes-moved');
    expect(src).not.toContain('visible only in this report');
    expect(src).toContain('no longer takes them');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-570 — what this ticket must NOT have touched', () => {
  it('★★★ task notes still render on all three surfaces (43 rows on prod)', () => {
    // ⛔ *"Touch the General channel or `permit_tasks.notes`."* The task note is
    //    the level the ruling KEPT, and it is measurably in use: 43 non-empty of
    //    2,106 rows on 2026-09-29, up from 27 of 1,810 when the brief was written.
    expect(code(read('components/MyTasks/TaskCard.tsx'))).toContain('mytasks-note-');
    expect(code(read('pages/MyTasks.tsx'))).toContain('mytasks-note-');
    expect(code(read('components/ProjectDetail/PermitDetailV2.tsx'))).toContain('task-note-');
  });

  it('★★★ the task-note WRITER still writes — it is a different level', () => {
    // ★★★ THE SWEEP MUST NOT CATCH THIS. `permit_tasks.notes` is the surface that
    //     REPLACED the permit-level note; removing its writer would carry out the
    //     opposite of the ruling.
    const src = code(read('components/ProjectDetail/PermitDetailV2.tsx'));
    expect(src).toContain('task-note-');
    const anyWriter = sourceFiles().some((f) =>
      /notes:\s/.test(code(readFileSync(f, 'utf8'))) &&
      /permit_tasks|useUpsertTask|useUpdateTask/.test(code(readFileSync(f, 'utf8'))),
    );
    expect(anyWriter).toBe(true);
  });

  it('★★★ the `notes` TABLE and its backup are not dropped by this ticket', () => {
    // ⛔ *"Delete the `notes` table, the `notes_deleted_fix559` backup."*
    // This ticket ships NO migration at all — asserted by absence, because the
    // cheapest way to delete a table is to add a file nobody reads closely.
    const migrations = readdirSync(resolve(SRC, '..', 'migrations'));
    expect(migrations.filter((f) => /fix_570/i.test(f))).toEqual([]);
    const offenders = sourceFiles().filter((f) =>
      /DROP TABLE|notes_deleted_fix559/i.test(code(readFileSync(f, 'utf8'))),
    );
    expect(offenders.map((f) => f.split(sep).pop())).toEqual([]);
  });

  it('★★ the notes query keys survive — the readers still key off them', () => {
    const keys = code(read('lib/queryKeys.ts'));
    expect(keys).toContain('allNotes');
    expect(keys).toContain('projectNoteSearch');
  });
});
