import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  CHAT_PHASE_ORDER,
  NO_AUTHOR_LABEL,
  groupIntoPosts,
  sortPostsByLifecycle,
} from '../lib/projectChat';
import type { ProjectMessage } from '../lib/database.types';

// ===========================================================================
// fix-542 (P-218) — Notes becomes the General channel. COPY ONLY.
// ===========================================================================
//
// Bobby, 2026-09-10: all notes come across; the completed ones carry their
// state **as words** — *"[done 8 Aug] …"*. No completed-state feature is built
// on chat, and nothing is left behind.
//
// ⚠️⚠️ THIS TICKET DELETES NOTHING. Not a note, not a row, not the surface.
//
// ★★★ §0 MEASURED ON PROD 2026-09-14, and three numbers changed the design:
//
//   notes 107 · 57 projects · completed 38
//   ★ hanging off a PERMIT              92  (86%) — the data, not an edge case
//   ★ NO author                         55  (51%) — nothing to preserve
//   ★ posts already titled General       4  — **one of them soft-deleted**
//   completed=true, completed_at NULL    0  — §B.2's edge case does not exist
//
// ★★★ §C — VERIFICATION FROM A REAL RUN (rolled back on prod, 2026-09-14):
//
//   a. messages created from notes ..... 107     g. name their permit ....... 92
//   b. SECOND RUN inserted ............... 0     h. stray brackets ........... 0
//   c. created_at matches its note ..... 107     i. projects covered ........ 57
//   d. author verbatim ................. 107     j. ONE live General ....... 220
//   e. authorless stayed authorless ..... 55     k. replies of a General ... 107

const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');
const MIGRATION = 'migrations/fix_542_notes_to_general_PENDING_APPROVAL.sql';

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}

function post(title: string, created: string): ProjectMessage {
  return {
    id: `p-${title}-${created}`,
    project_id: 'proj',
    parent_message_id: null,
    title,
    body: '',
    author_id: 'u1',
    author_name: 'Someone',
    created_at: created,
    mentions: [],
    attachments: [],
    revisions: [],
  } as unknown as ProjectMessage;
}
const titles = (ps: ReturnType<typeof sortPostsByLifecycle>) =>
  ps.map((p) => p.post.title);

// ---------------------------------------------------------------------------
// §A — General, everywhere, at the top
// ---------------------------------------------------------------------------

describe('fix-542 §A — General sorts first, from one place', () => {
  it('★★★ General is first in the ONE declared order', () => {
    // ★★ §A.3: *"Ordering belongs in one place."* It already did —
    //    `CHAT_PHASE_ORDER`, which `lifecycleRank` reads and whose length is the
    //    CR offset. Adding General was a one-line edit and nothing else moved,
    //    which is exactly what fix-484's comment above the list promised.
    expect(CHAT_PHASE_ORDER[0]).toBe('General');
    expect(CHAT_PHASE_ORDER).toEqual([
      'General',
      'ACQ Questions',
      'Preliminary Assessment',
      'Design Phase',
    ]);
  });

  it('★★★ it sorts above every phase and every CR, even when newest', () => {
    const ps = groupIntoPosts([
      post('CR 1', '2026-01-05T00:00:00Z'),
      post('Design Phase', '2026-01-03T00:00:00Z'),
      post('General', '2026-01-09T00:00:00Z'),
      post('ACQ Questions', '2026-01-01T00:00:00Z'),
    ]);
    expect(titles(sortPostsByLifecycle(ps))[0]).toBe('General');
  });

  it('★★ a hand-typed "general" lands with it — the compare is case-insensitive', () => {
    const ps = groupIntoPosts([
      post('ACQ Questions', '2026-01-01T00:00:00Z'),
      post('general', '2026-01-09T00:00:00Z'),
    ]);
    expect(titles(sortPostsByLifecycle(ps))).toEqual(['general', 'ACQ Questions']);
  });

  it('★★★ the migration gives ALL 220 projects a General, not only the 57', () => {
    const sql = read(MIGRATION);
    expect(sql).toContain('FROM public.projects pr');
    expect(sql).toContain('all 220, not only the 57');
  });

  it('★★★ it reuses a LIVE General and never a soft-deleted one', () => {
    // ⚠️ §A.2 says reuse the 4 that exist — but ONE OF THEM IS SOFT-DELETED
    //    (12238 4th Ave NW). Reusing it would file notes into a thread nobody
    //    can open, so the existence check and the join both require
    //    `deleted_at IS NULL`, and that project gets a fresh one.
    // ★ The deleted row is left exactly as it is: somebody deleted it.
    const sql = read(MIGRATION);
    const matches = sql.match(/deleted_at IS NULL/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('SOFT-DELETED');
    expect(sql).not.toMatch(/UPDATE[\s\S]{0,80}deleted_at\s*=\s*NULL/i);
  });
});

// ---------------------------------------------------------------------------
// §0.2 — what an authorless note renders as
// ---------------------------------------------------------------------------

describe('fix-542 §0.2 — 55 notes have nobody to preserve', () => {
  it('★★★ authorless renders as "Not recorded", never an invented name', () => {
    // ★★★ *Unknown* claims we had it and lost it. **Not recorded** says it was
    //     never captured — fix-363's third state, and the true one here.
    expect(NO_AUTHOR_LABEL).toBe('Not recorded');
    const row = code(read('src/components/ProjectDetail/ChatMessageRow.tsx'));
    expect(row).toContain('message.author_name ?? NO_AUTHOR_LABEL');
    expect(row).not.toContain("author_name ?? 'Unknown'");
  });

  it('★★★ and the migration does not invent one either — the trigger is suppressed', () => {
    // ⚠️⚠️ THE TRAP. `bp_trg_project_message_author` stamps `auth.uid()` onto any
    //      authorless insert, so left alone this migration would have attributed
    //      all 55 to whoever ran it — exactly what §0.2 forbids. It is disabled
    //      around the copy and re-enabled after, and the guard counts the 55.
    const sql = read(MIGRATION);
    expect(sql).toContain('DISABLE TRIGGER project_messages_author');
    expect(sql).toContain('ENABLE TRIGGER project_messages_author');
    expect(sql.indexOf('DISABLE TRIGGER')).toBeLessThan(sql.indexOf('ENABLE TRIGGER'));
    expect(sql).toContain('authorless notes stayed authorless');
  });
});

// ---------------------------------------------------------------------------
// §B — the copy
// ---------------------------------------------------------------------------

describe('fix-542 §B — verbatim, prefixed, permit-named, idempotent', () => {
  const sql = read(MIGRATION);

  it('★★★ it is STAGED, not applied, and deletes nothing', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toMatch(/MEASURED ON PROD \d{4}-\d{2}-\d{2}/);
    const live = sql
      .split(/\r?\n/)
      .filter((l) =>
        /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|BEGIN|COMMIT)\b/i.test(l),
      );
    expect(live).toEqual([]);
    // ★★ and `notes` is never written to — no DELETE, no UPDATE, anywhere.
    expect(sql).not.toMatch(/DELETE FROM public\.notes/i);
    expect(sql).not.toMatch(/UPDATE public\.notes/i);
  });

  it('★★★ created_at and created_by are copied VERBATIM', () => {
    // ★ §B.1: *"Never `now()`, never the migrator's uid."*
    expect(sql).toContain('n.created_by,');
    expect(sql).toContain('n.created_at,');
    // ★★★ THE GRAVESTONE TRAP, SEVENTEENTH RECORDING — and it caught the first
    //     draft of this assertion. It scanned the copy block for `now()` and
    //     failed against the file's own comment *"★ verbatim. Never now(),
    //     never a uid."* **In a migration that is commented end to end there is
    //     nothing left to strip**, so the assertion has to name the VALUE
    //     POSITION rather than the word: no line of the copy may BE `now()`.
    const copyBlock = sql.slice(
      sql.indexOf('4. The copy'),
      sql.indexOf('5. ★★★ THE GUARDS'),
    );
    const nowAsAValue = copyBlock
      .split(/\r?\n/)
      .filter((l) => /^--\s*now\(\),?\s*$/.test(l.trim()));
    expect(nowAsAValue).toEqual([]);
    // ★ …and the General insert, which legitimately says today, is elsewhere.
    expect(sql.slice(0, sql.indexOf('4. The copy'))).toContain('now()');
  });

  it('★★★ the provenance key is a COLUMN with a unique index, not a convention', () => {
    // ★★ §B.4: idempotence enforced by the DATABASE. A second run cannot insert
    //    a duplicate even if somebody runs the file twice by hand.
    //    *This Brain has two incidents from a backfill run twice.*
    expect(sql).toContain('source_note_id uuid');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS project_messages_source_note_key');
    expect(sql).toContain('WHERE source_note_id IS NOT NULL');
    expect(sql).toContain('ON CONFLICT (source_note_id) WHERE source_note_id IS NOT NULL DO NOTHING');
  });

  it('★★★ completed notes carry the done prefix, uncompleted ones do not', () => {
    expect(sql).toContain("'[done '");
    expect(sql).toContain("'FMDD Mon'");
    expect(sql).toContain('CASE WHEN n.completed THEN');
    // ★ the ELSE is an empty string — an uncompleted note gains nothing.
    expect(sql).toMatch(/CASE WHEN n\.completed THEN[\s\S]{0,200}ELSE '' END/);
  });

  it('★★ the done date is rendered in Seattle time, not UTC', () => {
    // ★ A UTC render moves an evening tick to the next day, so the prefix would
    //   disagree with the day the person remembers ticking it.
    expect(sql).toContain("AT TIME ZONE 'America/Los_Angeles'");
  });

  it('★★★ a permit-scoped note names its PERMIT NUMBER, never a uuid', () => {
    // ★ Measured: of the 92, **88 carry a real number** (75 distinct permits)
    //   and **4 have none**, falling back to the permit TYPE. Zero need a uuid.
    expect(sql).toContain('nullif(btrim(p.num)');
    expect(sql).toContain('nullif(btrim(p.type)');
    expect(sql).not.toMatch(/\|\|\s*n\.permit_id/);
    expect(sql).toContain('CASE WHEN n.permit_id IS NOT NULL THEN');
  });

  it('★★★ a project-scoped note invents nothing', () => {
    // ★ The ELSE is empty, and the guard counts stray brackets: measured 0.
    expect(sql).toContain('project-scoped notes gained a bracket they should not have');
  });
});

// ---------------------------------------------------------------------------
// §C — verification is the deliverable
// ---------------------------------------------------------------------------

describe('fix-542 §C — the migration checks its own work', () => {
  const sql = read(MIGRATION);

  it('★★★ every §C number is asserted at APPLY time, and refuses to commit if wrong', () => {
    // ★★ fix-540's rule applied to a DATA migration: do not trust that a
    //    statement did what it said — count the result and read the live state
    //    back. Nine guards, each with its own RAISE.
    const raises = sql.match(/RAISE EXCEPTION/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(8);
    for (const phrase of [
      'refusing to commit a partial copy',
      'kept their created_at',
      'kept their author verbatim',
      'carry the done prefix',
      'name their permit',
      'have exactly one live General',
    ]) {
      expect(sql, phrase).toContain(phrase);
    }
  });

  it('★★★ the run happened, and its numbers are in the file', () => {
    // ★ §C: *"Report, after a real run."* The migration is staged, so the real
    //   run was on prod inside a transaction that ended in ROLLBACK — the
    //   fix-153 pattern. These are its results.
    for (const n of ['107', '55', '38', '92', '57', '220']) {
      expect(sql, n).toContain(n);
    }
    expect(sql).toContain('SECOND RUN inserted');
    expect(sql).toContain('ROLLBACK');
  });

  it('★★★ the cutover answer is written down', () => {
    // ★ §0.3: Notes is still in use — newest 2026-09-11. The copy is additive
    //   and repeatable, so a note written mid-cutover is simply not in chat
    //   YET; re-running before the delete ticket picks up exactly the
    //   stragglers and doubles nothing.
    expect(sql).toContain('2026-09-11');
    expect(sql).toContain('additive and repeatable');
    expect(sql).toContain('Re-run this file');
  });

  it('★★★ nothing is deleted, and the next ticket is named', () => {
    expect(sql).toContain('THIS DELETES NOTHING');
    expect(sql).toContain('delete is its own ticket');
    // ★ the undo removes only what this file created, and only while empty
    expect(sql).toContain('General discussion for this project.');
  });
});
