import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

// ===========================================================================
// ★★★ fix-569 — THE LAST PERMIT-LEVEL NOTE BOX
// ===========================================================================
//
// ★★★ THIS CLOSES A RESIDUE fix-559 REPORTED RATHER THAN REMOVED. fix-559 took
//     out three mounts of the permit/project note surface; the Weekly DA
//     report's editable note box (fix-notes-4) survived because it sits in a
//     report rather than on a project screen, and the brief had not named it.
//     It was reported in that PR instead of being removed unasked.
//
// ★★★ AND THAT LEFT IT STRICTLY WORSE THAN BEFORE. Cowork applied fix-559's
//     delete on 2026-09-15 — measured today: `public.notes` is **0 rows**,
//     `notes_deleted_fix559` holds all **107**, and all **107** are in the
//     General channel. So the box displayed nothing, and anything typed into it
//     wrote a row **no surface in the product reads** — precisely the defect
//     P-257 described, recreated in the one place the sweep did not reach.
//     Bobby ruled it out.
//
// ★★★ AND THE TASK NOTES ARE UNTOUCHED: `permit_tasks.notes` still holds **27**
//     non-empty of **1,810**, rendered by fix-559's three readers.

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}
/** Source with comment lines stripped — the gravestone trap. An assertion that
 *  a thing is GONE must not be satisfied by the note explaining its removal. */
function code(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}

const WRITE_HOOKS = ['useAddNote', 'useUpdateNote'] as const;
const ALL_NOTE_HOOKS = [
  'useAllNotes',
  'useAddNote',
  'useUpdateNote',
  'useProjectNoteSearchIndex',
] as const;

/** Every non-test source file, walked once. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(ent.name)) {
        out.push(full);
      }
    }
  };
  walk(resolve(__dirname, '..'));
  return out;
}

describe('fix-569 §A — the Weekly DA report loses its note box', () => {
  it('★★★ the editor component is gone', () => {
    expect(code(read('pages/WeeklyDaReport.tsx'))).not.toContain('function NoteEditor');
    expect(code(read('pages/WeeklyDaReport.tsx'))).not.toContain('<NoteEditor');
  });

  it('★★★ the Weekly DA report imports NO note-writing hook — the import graph', () => {
    // ★★★ THE BRIEF'S RULE: *"assert on the import graph, not on a rendered
    //     string."* A rendered-string test passes against a hook that is still
    //     imported and merely unused — which is how a writer comes back.
    const src = code(read('pages/WeeklyDaReport.tsx'));
    for (const h of WRITE_HOOKS) {
      expect(src).not.toContain(h);
    }
    expect(src).not.toContain("from '../hooks/useNotes'");
  });

  it('★★★ EXACTLY ONE write surface remains, and it is named', () => {
    // ★★★ THE BRIEF SAID *"one writer survived"* — the Weekly DA box. Grepping
    //     the hooks, which §A asked for, found a SECOND: the Weekly Updates
    //     report has a full add/edit surface of its own (fix-notes-3 built it
    //     editable on purpose). §A removed the one it named; this one is
    //     REPORTED rather than removed, because §B is explicit — *"Report, do
    //     not improvise"* — and it is not the same defect: that report READS
    //     `notes` as well as writing them, so a note added there is visible
    //     there. An island, not a hole.
    //
    // ★★ Asserted as an exact list so the next sweep starts from the truth
    //    rather than from the brief's premise.
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      if (f.endsWith(`hooks${sep}useNotes.ts`)) continue;
      const body = code(readFileSync(f, 'utf8'));
      for (const h of WRITE_HOOKS) {
        if (new RegExp(`\\b${h}\\b`).test(body)) offenders.push(f);
      }
    }
    const files = [...new Set(offenders.map((f) => f.split(/[\\/]/).pop()))];
    expect(files).toEqual(['WeeklyUpdatesReport.tsx']);
  });

  it('★★ …and that report SAYS a note added there goes no further', () => {
    // ★ The honest half of leaving it: the banner explains both facts — where
    //   the 107 went, and that anything typed here is visible only here.
    const src = read('pages/WeeklyUpdatesReport.tsx');
    expect(src).toContain('visible only in this report');
  });

  it('★★ the rest of the report is untouched — a neighbouring column still renders', () => {
    // ★ The brief: *"assert a neighbouring field still renders."*
    const src = code(read('pages/WeeklyDaReport.tsx'));
    expect(src).toContain('<Th>Corr Issued</Th>');
    expect(src).toContain('<PermitTypeNum row={row} />');
    // ★ …and the now-empty `Notes` column header went with its editor, rather
    //   than leaving a blank column on every row.
    expect(src).not.toContain('<Th>Notes</Th>');
  });
});

describe('fix-569 §B — the two readers say why they are empty', () => {
  it('★★★ the Weekly Updates report carries a standing explanation', () => {
    // ★★★ STANDING, not only in the empty-state branch: the "only with notes"
    //     filter DEFAULTS OFF, so the usual render lists projects with blank
    //     note sections and never reaches that branch at all.
    const src = read('pages/WeeklyUpdatesReport.tsx');
    expect(src).toContain('weekly-updates-notes-moved');
    expect(src).toContain('General channel');
  });

  it('★★★ its empty state stops implying the notes might come back', () => {
    const src = code(read('pages/WeeklyUpdatesReport.tsx'));
    expect(src).not.toContain('No projects have active notes right now.');
    expect(src).toContain('now live in each project');
  });

  it('★★★ Project View stops PROMISING notes in its search placeholder', () => {
    // ★★★ The search has no empty state of its own — it silently stops
    //     matching — so the placeholder was the thing that made it look broken:
    //     it advertised a capability that had gone.
    const src = code(read('pages/ProjectList.tsx'));
    expect(src).not.toContain('Search address, tags, notes');
    expect(src).toContain('Search address, tags');
    expect(src).toContain('General channel');
  });

  it('★★★ NEITHER reader was re-pointed at chat or at task notes', () => {
    // ⚠️ §B: *"Do NOT point them at chat or at task notes on your own — that is
    //    a product decision Bobby has not made."* The hooks and the index are
    //    left exactly as they were; only the wording changed.
    const updates = code(read('pages/WeeklyUpdatesReport.tsx'));
    const list = code(read('pages/ProjectList.tsx'));
    expect(updates).toContain('useAllNotes');
    expect(list).toContain('useProjectNoteSearchIndex');
    for (const src of [updates, list]) {
      expect(src).not.toContain('project_messages');
      expect(src).not.toContain('permit_tasks');
    }
  });

  it('★★ the reader hooks SURVIVE — §B forbids deleting what they need', () => {
    const hooks = code(read('hooks/useNotes.ts'));
    for (const h of ALL_NOTE_HOOKS) {
      expect(hooks).toContain(`export function ${h}`);
    }
  });
});

describe('fix-569 — fix-559 task notes are unaffected', () => {
  it('★★★ all three task-note readers still render', () => {
    // ★★★ 27 task notes on 1,810 rows, measured today. This ticket removes a
    //     PERMIT-level box; the task note is the surface that replaced it and
    //     must not be caught by the sweep.
    expect(code(read('components/MyTasks/TaskCard.tsx'))).toContain('mytasks-note-');
    expect(code(read('pages/MyTasks.tsx'))).toContain('mytasks-note-');
    expect(code(read('components/ProjectDetail/PermitDetailV2.tsx'))).toContain('task-note-');
  });

  it('★★★ the task-note WRITER still writes', () => {
    const src = code(read('components/TaskDetailEditor.tsx'));
    expect(src).toContain('patch({ notes: next })');
    expect(src).toContain('patch({ clearNotes: true, notes: null })');
  });

  it('★★ the task note is a different column from the one that emptied', () => {
    // ★ `permit_tasks.notes` / `team_tasks.notes` — never `public.notes`.
    const hook = code(read('hooks/useTaskTree.ts'));
    expect(hook).toContain('p_notes: input.notes ?? null');
    expect(hook).not.toContain(".from('notes')");
  });
});
