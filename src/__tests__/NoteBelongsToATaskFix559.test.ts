import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ===========================================================================
// ★★★ fix-559 (P-218 + P-257) — A NOTE BELONGS TO A TASK
// ===========================================================================
//
// ★★★ THIS REVERSES fix-294, AND BOBBY RULED IT:
//     *"remove the permit level note, we only need a tasks level note. all
//     permit and project level notes either live in the task or can be managed
//     in the chat."*
//
//     fix-294 deleted the task-note box, migrated 19 notes onto permits and
//     left the write path out, warning: *"leaving the commit path here would be
//     a loaded gun — the next person to add a Notes field would find a working
//     writer for a column nothing reads."* **It was right at the time, and its
//     own reason is what changed:** §C gives the column three readers, so a
//     note written there is no longer invisible to everyone but its author.
//
// ★★★ MEASURED ON PROD 2026-09-15:
//
//       public.notes                             107 rows (92 permit · 15 project)
//         …with a General-channel copy (fix-542) 107   ← the guard, 0 orphans
//       permit_tasks                           1,810 rows
//         …with a non-empty `notes`                27   (19 human · 8 machine)
//         …of those, still open                     6
//       tasks whose permit has a note            532, across only 72 permits
//
// ★★★ **7.4 TASKS PER NOTED PERMIT** is the measurement that produced the
//     ruling: a permit-level note "shown on the task" would repeat itself down
//     seven rows. One note, one task, or it is not a task note.
//
// ★ No schema change. `permit_tasks.notes`, `team_tasks.notes`, `p_notes` and
//   `UpsertTaskInput.notes` all already existed — none of the seven
//   `useUpsertTask` callers had ever passed the field. §C wires the one that
//   should, which is why this ticket has a migration that only DELETES.

const SQL = resolve(
  __dirname,
  '../../migrations/fix_559_a_note_belongs_to_a_task_PENDING_APPROVAL.sql',
);

function sql(): string {
  return readFileSync(SQL, 'utf8');
}
function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}
/** Source with comment lines stripped — the gravestone trap. An assertion that
 *  a surface is GONE must not be satisfied by the note explaining its removal. */
function code(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}

describe('fix-559 §A — the permit-level note surface stops existing', () => {
  it('★★★ the component is deleted, not merely unmounted', () => {
    expect(existsSync(resolve(__dirname, '../components/ProjectDetail/NotesPanel.tsx')))
      .toBe(false);
  });

  it('★★★ NO file mounts it — all THREE mounts are gone', () => {
    // ★★★ The brief named two and asked for a third to be named if it existed.
    //     It did: the permit detail's running notes log (`PermitDetailV2`),
    //     beside Project Overview's card and the My Tasks pane's box.
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(ent.name) && !/Fix559/.test(ent.name)) {
          // ★★ MOUNTS AND IMPORTS, not the WORD. Two source files carry a
          //    gravestone comment naming `NotesPanel` to record what was
          //    removed and why — those must survive, and an assertion that
          //    matched its own explanation would delete the record.
          const body = code(readFileSync(full, 'utf8'));
          if (/<NotesPanel|import\s+NotesPanel|from ['"][^'"]*NotesPanel['"]/.test(body)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(resolve(__dirname, '..'));
    expect(offenders).toEqual([]);
  });

  it('★★★ `useProjectNotes` went with it — it had exactly one consumer', () => {
    expect(code(read('hooks/useNotes.ts'))).not.toContain('export function useProjectNotes');
  });

  it('★★★ …and the OTHER four hooks SURVIVE, because they are not note-taking', () => {
    // ★★★ THE BRIEF SAID "remove the component and its hook". Grepping the hook
    //     rather than the heading — which is what it asked for — found three
    //     more consumers that are not note surfaces at all:
    //       useAllNotes               → Weekly Updates report (the report IS
    //                                   these notes, grouped)
    //       useAddNote / useUpdateNote → Weekly Updates + the Weekly DA report
    //       useProjectNoteSearchIndex → Project View's note-body search
    //     Deleting them would delete two reports and a search filter, which the
    //     ruling does not ask for.
    const hooks = code(read('hooks/useNotes.ts'));
    for (const h of [
      'useAllNotes',
      'useAddNote',
      'useUpdateNote',
      'useProjectNoteSearchIndex',
    ]) {
      expect(hooks).toContain(`export function ${h}`);
    }
  });
});

describe('fix-559 §B — the delete is staged, and guarded', () => {
  it('★★★ every statement is commented out', () => {
    const live = sql()
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
  });

  it('★★★ THE GUARD: it refuses to delete unless every note is in General', () => {
    // ★★★ The brief's rule: *"assert all 107 resolve to a General message
    //     before removing any. If that count is not 0, delete nothing and
    //     report."* Re-derived at APPLY time, not trusted from write time.
    const s = sql();
    expect(s).toContain('source_note_id');
    expect(s).toContain('fix-559 STOP');
    expect(s).toContain('nothing deleted');
    // ★ and the guard must come BEFORE the delete in the file.
    expect(s.indexOf('fix-559 STOP')).toBeLessThan(s.indexOf('delete from public.notes'));
  });

  it('★★★ a BACKUP is taken before anything is removed', () => {
    const s = sql();
    expect(s).toContain('create table if not exists public.notes_deleted_fix559');
    expect(s.indexOf('notes_deleted_fix559')).toBeLessThan(
      s.indexOf('delete from public.notes'),
    );
  });

  it('★★★ the TABLE is not dropped — three readers still query it', () => {
    const s = sql();
    expect(s).not.toContain('drop table');
    expect(s).toContain('was DROPPED');
  });

  it('★★★ all 107 rows are snapshotted in the header', () => {
    // ★ The fix-537 pattern: project · permit · author · date · body.
    const rows = sql()
      .split(/\r?\n/)
      .filter((l) => /^--\s{3}\S.* \| .* \| .* \| 20\d\d-\d\d-\d\d \| /.test(l));
    expect(rows).toHaveLength(107);
  });

  it('★★ the neighbours are asserted unbroken — General and the task notes', () => {
    // fix-545's rule, and here the neighbour IS the point: fix-542's copies and
    // `permit_tasks.notes` must both be exactly as they were.
    const s = sql();
    expect(s).toContain('General copies moved');
    expect(s).toContain('permit_tasks.notes LOST rows');
  });

  it('★★★ it says what emptying the table also empties', () => {
    // ★★ Two reports and a search filter render empty afterwards. That is the
    //    thing to decide BEFORE applying, so it is in the header rather than in
    //    a support question later.
    const s = sql();
    expect(s).toContain('Weekly Updates report');
    expect(s).toContain('Weekly DA report');
    expect(s).toContain('note-body search');
  });

  it('★★★ it states that it reverses fix-294, and whose decision that was', () => {
    const s = sql();
    expect(s).toContain('REVERSES fix-294');
    expect(s).toContain('loaded gun');
    expect(s).toContain('Bobby');
  });
});

describe('fix-559 §C — the column gets a reader and a writer, with no RPC change', () => {
  it('★★★ the task detail panel WRITES `notes`, and clears with the flag', () => {
    const src = code(read('components/TaskDetailEditor.tsx'));
    expect(src).toContain('patch({ notes: next })');
    expect(src).toContain('patch({ clearNotes: true, notes: null })');
  });

  it('★★★ a TEAM task gets one too — `team_tasks.notes` exists and is carried', () => {
    const src = code(read('components/TaskDetailEditor.tsx'));
    // ★ fix-580 §B hoisted the value into a local so the write can also state
    //   `clear_notes` — the RULING is unchanged and asserted in both halves:
    //   the team patch still carries `notes`, and it still resolves to the
    //   edited value or the task's own, never to undefined.
    expect(src).toContain(
      "const notes = 'notes' in p ? (p.notes as string | null) : task.notes ?? null",
    );
    expect(src).toMatch(/patch: \{[\s\S]*?\n\s+notes,\n/);
  });

  it('★★★ THREE readers, so the column is no longer write-only', () => {
    // ★★★ This is precisely the condition fix-294 froze it for — *"nothing
    //     reads it back"* — and the reason its warning no longer applies.
    expect(code(read('components/MyTasks/TaskCard.tsx'))).toContain('mytasks-note-');
    expect(code(read('pages/MyTasks.tsx'))).toContain('mytasks-note-');
    expect(code(read('components/ProjectDetail/PermitDetailV2.tsx'))).toContain('task-note-');
  });

  it('★★★ every reader is ABSENT when the note is empty', () => {
    // ★★ 1,783 of 1,810 tasks have no note. A label or a zero on every row
    //    would be a worse product than the one this replaces.
    for (const f of [
      'components/MyTasks/TaskCard.tsx',
      'pages/MyTasks.tsx',
      'components/ProjectDetail/PermitDetailV2.tsx',
    ]) {
      expect(code(read(f))).toContain("(task.notes ?? '').trim() !== ''");
    }
  });

  it('★★★ newlines survive on every reader', () => {
    // ★ One of the 27 is multi-line and ends in a path. Not linkified — P-149.
    for (const f of [
      'components/MyTasks/TaskCard.tsx',
      'pages/MyTasks.tsx',
      'components/ProjectDetail/PermitDetailV2.tsx',
    ]) {
      expect(code(read(f))).toContain('whitespace-pre-wrap');
    }
  });

  it('★★★ NO second write path was added — the existing RPC field is used', () => {
    // ★★★ `bp_upsert_permit_task` already took `p_notes` and `UpsertTaskInput`
    //     already carried `notes`; none of the seven `useUpsertTask` callers
    //     had ever passed it. §C wires one. Nothing new was plumbed, and the
    //     migration contains no schema change at all.
    const hook = code(read('hooks/useTaskTree.ts'));
    expect(hook).toContain('p_notes: input.notes ?? null');
    expect(hook).toContain('p_clear_notes: input.clearNotes ?? false');
    const s = sql();
    expect(s).not.toContain('alter table public.permit_tasks');
    expect(s).not.toContain('create or replace function public.bp_upsert_permit_task');
  });

  it('★★ a bot-written note is MARKED and still editable', () => {
    // ★★ 8 of the 27 are the tool's plan-of-record sentence. Marked, because a
    //    machine sentence read as a colleague's is a support question later —
    //    and editable, because the tool rewrites it on its next run, so a lock
    //    would protect nothing and would leave somebody unable to correct it.
    const src = read('components/TaskDetailEditor.tsx');
    expect(src).toContain('task-detail-notes-bot');
    expect(code(src)).not.toContain('disabled={task.is_auto_generated}');
  });
});

describe('fix-559 §D — one Notes in the product', () => {
  it('★★★ no user-visible label calls a PERMIT or PROJECT note "Notes"', () => {
    // ★★★ P-257 existed because two different boxes were both called Notes and
    //     one of them wrote somewhere nobody read. With the permit-level box
    //     gone the collision is gone — asserted rather than assumed.
    expect(code(read('components/TaskDetailEditor.tsx'))).not.toContain(
      'Notes on this permit',
    );
  });

  it('★★ the task box is labelled `Note`, singular — it is one text column', () => {
    // ★ Not a thread: editing REPLACES, and the placeholder says so.
    const src = code(read('components/TaskDetailEditor.tsx'));
    expect(src).toContain('<FieldLabel>Note</FieldLabel>');
    expect(src).toContain('saving replaces what is here');
  });
});
