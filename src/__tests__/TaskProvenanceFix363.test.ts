import { describe, it, expect } from 'vitest';
import {
  buildProvenance,
  provenanceLine,
  assignedSubtitle,
  type TaskProvenanceRow,
} from '../lib/taskProvenance';
import { buildNewItems, type NewItem } from '../lib/boardReads';
import migrationSql from '../../migrations/fix_363_task_provenance.sql?raw';

// ===========================================================================
// fix-363 — who gave me this, and who closed it
// ===========================================================================
//
// Bobby: "In the task, who created it, assigned it… you should be able to open
// up the task and see who created it and who assigned it to you, because you
// want to be able to reach out to that person… And then who marked it complete,
// kind of like a timestamp."
//
// ★★★ MEASURED BEFORE ANYTHING WAS WRITTEN, and it decided the ticket's shape.
// Prod, 2026-08-20: 1,361 tasks, 737 with any audit row (capture began
// 2026-08-04), 636 with none and never will have. AND `assigned_to` was not in
// the audit at all — so the headline sentence could not be built from anything
// stored. Recording it IS §1; this file tests the rule that follows.
//
// ★★★ THE RULE: what you DON'T KNOW must look different from what DIDN'T
// HAPPEN. Three states, three renderings, and never a plausible name in place
// of an honest gap — nobody checks a name that looks right.

const AUG12 = '2026-08-12T09:00:00Z';
const AUG14 = '2026-08-14T09:00:00Z';
const AUG19 = '2026-08-19T09:00:00Z';

function row(over: Partial<TaskProvenanceRow>): TaskProvenanceRow {
  return {
    kind: 'created',
    at: AUG12,
    actor_uid: null,
    actor_name: null,
    detail: null,
    auto_mark: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §2 — the three sentences the brief asked for
// ---------------------------------------------------------------------------

describe('fix-363 §2: the wording, exactly as specified', () => {
  it('★★ the brief\'s own three lines', () => {
    const lines = buildProvenance([
      row({ kind: 'created', at: AUG12, actor_uid: 'u1', actor_name: 'Briana' }),
      row({
        kind: 'assigned',
        at: AUG14,
        actor_uid: 'u1',
        actor_name: 'Briana',
        detail: 'Cam',
      }),
      row({ kind: 'completed', at: AUG19, actor_uid: 'u2', actor_name: 'Cam' }),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Created by Briana · Aug 12, 2026',
      'Assigned to Cam by Briana · Aug 14, 2026',
      'Completed by Cam · Aug 19, 2026',
    ]);
    expect(lines.every((l) => l.state === 'person')).toBe(true);
  });

  it('★ they read in the order a task is lived, not the order they arrive', () => {
    const lines = buildProvenance([
      row({ kind: 'completed', at: AUG19, actor_name: 'Cam', actor_uid: 'u2' }),
      row({ kind: 'created', at: AUG12, actor_name: 'Briana', actor_uid: 'u1' }),
      row({ kind: 'coassigned', at: AUG14, detail: 'Derry', auto_mark: 'manual', actor_name: 'Briana', actor_uid: 'u1' }),
      row({ kind: 'assigned', at: AUG14, detail: 'Cam', actor_name: 'Briana', actor_uid: 'u1' }),
    ]);
    expect(lines.map((l) => l.kind)).toEqual([
      'created',
      'assigned',
      'coassigned',
      'completed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §3 — the rule the whole ticket turns on
// ---------------------------------------------------------------------------

describe('fix-363 §3: three states, and they are not the same state', () => {
  it('★★★ known / machine / not-recorded produce three different states', () => {
    const known = provenanceLine(
      row({ kind: 'completed', at: AUG19, actor_uid: 'u2', actor_name: 'Cam' }),
    );
    const machine = provenanceLine(
      row({ kind: 'completed', at: AUG19, auto_mark: 'permit_issued' }),
    );
    const gap = provenanceLine(row({ kind: 'completed', at: AUG19 }));

    expect([known.state, machine.state, gap.state]).toEqual([
      'person',
      'machine',
      'unrecorded',
    ]);
    // Three states, three sentences — no two of them alike.
    expect(new Set([known.text, machine.text, gap.text]).size).toBe(3);
  });

  it('★★★ the exact wording of all three', () => {
    expect(
      provenanceLine(row({ kind: 'completed', at: AUG19, actor_uid: 'u', actor_name: 'Cam' })).text,
    ).toBe('Completed by Cam · Aug 19, 2026');
    expect(
      provenanceLine(row({ kind: 'completed', at: AUG19, auto_mark: 'permit_issued' })).text,
    ).toBe('Closed automatically when the permit issued · Aug 19, 2026');
    expect(provenanceLine(row({ kind: 'completed', at: AUG19 })).text).toBe(
      'Completed Aug 19, 2026 · who is not recorded',
    );
  });

  it('★★★ "not recorded" is never blank, never "Unknown", never a name', () => {
    // The three ways this gets got wrong, each asserted directly.
    for (const kind of ['created', 'assigned', 'completed'] as const) {
      const line = provenanceLine(row({ kind, at: AUG19, detail: 'Cam' }));
      expect(line.state).toBe('unrecorded');
      expect(line.text.trim().length).toBeGreaterThan(10);
      expect(line.text).toMatch(/who is not recorded/);
      expect(line.text).not.toMatch(/unknown/i);
      // ★ AND NO ACTOR IS OFFERED. `actor` is what a caller would use to say
      // "go and ask this person"; it must be null when nobody was recorded.
      expect(line.actor).toBeNull();
    }
  });

  it('★★★ the creator is NEVER inferred from the assignee', () => {
    // "They are different people constantly, and a plausible wrong name is
    // worse than an honest gap." The creation row carries the task TEXT in
    // `detail`, and even a row that knows the assignee cannot borrow it.
    const created = provenanceLine(
      row({ kind: 'created', at: AUG12, detail: 'Send corrections' }),
    );
    expect(created.state).toBe('unrecorded');
    expect(created.actor).toBeNull();
    expect(created.text).toBe('Created Aug 12, 2026 · who is not recorded');
  });

  it('★★ a pre-2026-08-04 task: the WHEN survives, the WHO says so', () => {
    // The real shape of 636 tasks — the audit did not exist when they were
    // created, so `bp_task_provenance` returns their created_at with a null
    // actor and no machine mark.
    const lines = buildProvenance([
      row({ kind: 'created', at: '2026-06-01T12:00:00Z' }),
      row({ kind: 'completed', at: '2026-07-04T12:00:00Z' }),
    ]);
    expect(lines.map((l) => l.state)).toEqual(['unrecorded', 'unrecorded']);
    expect(lines[0].text).toContain('Jun 01, 2026');
    expect(lines[1].text).toContain('Jul 04, 2026');
    expect(lines.every((l) => l.actor === null)).toBe(true);
  });
});

describe('fix-363 §1: the machine is never a person', () => {
  it('★★ fix-355 closures attribute to the machine, with its own words', () => {
    for (const [reason, words] of [
      ['permit_issued', 'Closed automatically when the permit issued'],
      ['superseded_resubmitted', 'Closed automatically when the permit moved past it'],
      ['superseded_by_intake_acceptance', 'Closed automatically when the permit moved past it'],
    ] as const) {
      const line = provenanceLine(row({ kind: 'completed', at: AUG19, auto_mark: reason }));
      expect(line.state).toBe('machine');
      expect(line.actor).toBeNull();
      expect(line.text.startsWith(words)).toBe(true);
    }
  });

  it('★★ fix-346\'s co-assign is the trigger\'s doing, not a colleague\'s', () => {
    // "Who put my manager on this" has the same answer-shape as "who assigned
    // it to me" — and the same failure mode: a blank where a name goes sends
    // somebody to ask a person who never touched it.
    const line = provenanceLine(
      row({ kind: 'coassigned', at: AUG14, detail: 'Miles', auto_mark: 'dm_of_da' }),
    );
    expect(line.state).toBe('machine');
    expect(line.actor).toBeNull();
    expect(line.text).toBe(
      'Miles — Added automatically as the design manager · Aug 14, 2026',
    );
  });

  it('★★★ …but "manual" is a PERSON\'s choice and must not read as automatic', () => {
    // The join table records both values. Treating 'manual' as a machine mark
    // would attribute somebody's decision to a trigger — the same error as the
    // reverse, and just as wrong.
    const line = provenanceLine(
      row({
        kind: 'coassigned',
        at: AUG14,
        detail: 'Derry',
        auto_mark: 'manual',
        actor_uid: 'u1',
        actor_name: 'Briana',
      }),
    );
    expect(line.state).toBe('person');
    expect(line.text).toBe('Derry added by Briana · Aug 14, 2026');
    expect(line.text).not.toMatch(/automatic/i);
  });

  it('★ a bot-created task says the bot did it, and names the city event', () => {
    // 597 of 1,361 tasks. Knowable for every one of them whether or not the
    // audit was running, because the mark is a column on the task.
    expect(
      provenanceLine(row({ kind: 'created', at: AUG12, auto_mark: 'corr_issued' })).text,
    ).toBe('Created automatically by the task bot (corr_issued) · Aug 12, 2026');
    expect(
      provenanceLine(row({ kind: 'created', at: AUG12, auto_mark: 'bot' })).text,
    ).toBe('Created automatically by the task bot · Aug 12, 2026');
  });

  it('★★ a RECORDED PERSON beats a machine mark — the order of the tests is the rule', () => {
    // A person closing a task the bot raised is a person's act. Attribution
    // follows who did the thing, not who created the thing.
    const line = provenanceLine(
      row({
        kind: 'completed',
        at: AUG19,
        actor_uid: 'u2',
        actor_name: 'Cam',
        auto_mark: 'permit_issued',
      }),
    );
    expect(line.state).toBe('person');
    expect(line.text).toBe('Completed by Cam · Aug 19, 2026');
  });

  it('★★ an actorless ASSIGNMENT is unrecorded, never "automatic"', () => {
    // Nothing but a person writes assigned_to today. Claiming the machine did
    // it would be this ticket's own invention, pointed the other way.
    const line = provenanceLine(row({ kind: 'assigned', at: AUG14, detail: 'Cam' }));
    expect(line.state).toBe('unrecorded');
    expect(line.text).toBe('Assigned to Cam Aug 14, 2026 · who is not recorded');
  });
});

// ---------------------------------------------------------------------------
// The notification's sentence
// ---------------------------------------------------------------------------

describe('fix-363 §2: "Briana assigned you a task"', () => {
  it('★★ the title names the actor when it is known', () => {
    expect(assignedSubtitle('Briana', false)).toBe('Briana assigned you a task');
    expect(assignedSubtitle('Briana', true)).toBe(
      'Briana added you as a co-assignee',
    );
  });

  it('★★ …and degrades to today\'s wording when it is not', () => {
    // NEVER "Someone assigned you a task": that implies the tool knows a person
    // was involved when it does not.
    for (const empty of [null, undefined, '', '   ']) {
      expect(assignedSubtitle(empty, false)).toBe('Assigned to you');
      expect(assignedSubtitle(empty, true)).toBe('Added as co-assignee');
    }
  });

  it('★★★ the board item carries it end to end', () => {
    const task = {
      id: 'task-1',
      text: 'Send corrections to the consultants',
      assigned_to: 'Cam',
      co_assignees: [],
      created_at: '2026-08-19T10:00:00Z',
      permit_id: 1,
      project_id: 'p1',
      project_address: '233 31st Ave E',
      permit_type: 'SDOT Tree',
    };
    const withName = buildNewItems({
      flips: [],
      tasks: [task as never],
      acks: [],
      permits: [],
      viewerName: 'Cam',
      taskAssigners: [{ task_id: 'task-1', actor_name: 'Briana' }],
    }).find((i: NewItem) => i.source === 'task');
    expect(withName?.subtitle).toBe('Briana assigned you a task');

    // ★ The same task with nothing recorded — every task assigned before
    // 2026-08-20 — reads exactly as it did before fix-363.
    const without = buildNewItems({
      flips: [],
      tasks: [task as never],
      acks: [],
      permits: [],
      viewerName: 'Cam',
    }).find((i: NewItem) => i.source === 'task');
    expect(without?.subtitle).toBe('Assigned to you');
  });
});

// ---------------------------------------------------------------------------
// ★★ The migration's promises
// ---------------------------------------------------------------------------

describe('fix-363: the capture, and what it must not do', () => {
  it('★★★ NO BACKFILL — the migration writes no historical rows', () => {
    // "Inventing history is the one outcome this ticket must not produce."
    // 636 tasks have no history; the honest answer is to say so. Every
    // statement in the file is DDL.
    const body = migrationSql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    // ★ The four INSERTs in this file are all inside TRIGGER BODIES: they run
    // on a future write and never on the migration itself. So the bodies are
    // stripped and the assertion is made on what the migration actually
    // EXECUTES — which is the claim, and which a naive grep for "INSERT" would
    // get exactly backwards.
    const inserts = body.match(/INSERT INTO public\.permit_task_audit/g) ?? [];
    expect(inserts.length).toBe(4);
    const executed = body.replace(
      /AS \$function\$[\s\S]*?\$function\$;/g,
      'AS <trigger body>;',
    );
    expect(executed).not.toMatch(/INSERT INTO/);
    expect(executed).not.toMatch(/UPDATE public\./);
    expect(executed).not.toMatch(/DELETE FROM/);
    expect(executed).not.toMatch(/\bDO \$\$/);
    for (const fn of ['bp_audit_permit_task', 'bp_audit_task_assignee']) {
      expect(body).toMatch(new RegExp(`FUNCTION public\\.${fn}`));
    }
  });

  it('★★★ the assignment pair joins the guard AND all three ops', () => {
    // The capture that makes the whole feature possible. Without it in the
    // GUARD, an assignment change that touches nothing else writes no row at
    // all — the early return would swallow it.
    expect(migrationSql).toMatch(
      /NEW\.assigned_to\s+IS NOT DISTINCT FROM OLD\.assigned_to THEN/,
    );
    const written = migrationSql.match(/assigned_to_from, assigned_to_to\)/g) ?? [];
    expect(written.length).toBe(3); // INSERT, UPDATE, DELETE
  });

  it('★★ co-assignment is captured by a SECOND trigger, on the join table', () => {
    // fix-224 moved co-assignees off permit_tasks, so a row trigger there has
    // no OLD/NEW to compare. Not half-done — done where the fact lives.
    expect(migrationSql).toMatch(
      /CREATE TRIGGER permit_task_assignee_audit_trg[\s\S]*?ON public\.permit_task_assignees/,
    );
    expect(migrationSql).toMatch(/AFTER INSERT OR DELETE ON public\.permit_task_assignees/);
    // ★ And it carries the source, which is the machine's own mark.
    expect(migrationSql).toMatch(/v_row\.source/);
  });

  it('★★ fix-272\'s four existing pairs survive untouched', () => {
    // The whole risk of re-emitting a live trigger is dropping something it
    // already did.
    for (const pair of [
      'target_date_from, target_date_to',
      'start_date_from, start_date_to',
      'completion_status_from, completion_status_to',
      'waiting_on_from, waiting_on_to',
    ]) {
      expect(migrationSql).toContain(pair);
    }
    expect(migrationSql).toMatch(/SECURITY DEFINER/);
    expect(migrationSql).toMatch(/SET search_path TO 'public', 'pg_temp'/);
  });

  it('★ the reads are tenant-scoped and never granted to anon', () => {
    for (const fn of [
      /REVOKE ALL ON FUNCTION public\.bp_task_provenance\(uuid\) FROM PUBLIC, anon/,
      /REVOKE ALL ON FUNCTION public\.bp_task_assigners\(integer\) FROM PUBLIC, anon/,
    ]) {
      expect(migrationSql).toMatch(fn);
    }
    const scoped = migrationSql.match(/auth_tenant_ids\(\)/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(5);
  });

  it('★★ the assigner feed offers ONLY rows that carry an actor', () => {
    // An absent task must mean "not recorded" — so the query cannot return a
    // row with a null actor and let the client decide it is nobody.
    expect(migrationSql).toMatch(/x\.actor_uid IS NOT NULL/);
  });
});
