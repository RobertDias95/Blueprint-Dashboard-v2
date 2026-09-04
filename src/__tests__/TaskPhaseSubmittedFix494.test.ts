import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import migrationSql from '../../migrations/fix_494_task_default_bucket_submitted.sql?raw';
import {
  TASK_BUCKET_LABEL,
  defaultTaskBucket,
  permitIsSubmitted,
} from '../lib/permitPhase';
import type { PermitCycle } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-494 (P-155) — "SUBMITTED" MEANS ONE THING
// ===========================================================================
//
// Bobby, 2026-09-04, on `5811 Greenwood Ave N` / `7128829-CN` (permit 316):
// *"why did the task get created in the design bucket if the project is under
// corrections for the architect?"*
//
// ★★★ TWO DEFINITIONS OF "SUBMITTED", DISAGREEING:
//       the permit SCREEN   `c0.intake_accepted`   (fix-123)
//       the DB TRIGGER      `c0.submitted`         (fix-79)
//     …and the chat composer sent no bucket at all, so the trigger won.
//
// Permit 316 on prod: c0.submitted NULL · c0.intake_accepted 2026-06-26 ·
// c1.submitted 2026-06-25. Measured: **58 of 261 open permits** are in that
// shape (open = `actual_issue IS NULL`).

const cyc = (over: Partial<PermitCycle>): PermitCycle =>
  ({
    permit_id: 1,
    cycle_index: 0,
    submitted: null,
    intake_accepted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    ...over,
  }) as PermitCycle;

describe('fix-494: permitIsSubmitted — the four shapes', () => {
  it('★★★ THE BUG: c0.intake only, no c0.submitted → SUBMITTED', () => {
    // ★★★ This is what the screen already believed and the trigger did not.
    expect(
      permitIsSubmitted({
        permit_cycles: [cyc({ cycle_index: 0, intake_accepted: '2026-06-26' })],
      }),
    ).toBe(true);
  });

  it('★★★ THE BUG, THE OTHER HALF: a cycle-1 submittal alone → SUBMITTED', () => {
    // ★★ Permit 316 has BOTH of the above and neither was enough on its own
    //    under the old rule. A resubmittal means the city has it just as much
    //    as a cycle-0 submittal does.
    expect(
      permitIsSubmitted({
        permit_cycles: [
          cyc({ cycle_index: 0 }),
          cyc({ cycle_index: 1, submitted: '2026-06-25' }),
        ],
      }),
    ).toBe(true);
  });

  it('★★ c0.submitted alone → SUBMITTED (the OLD rule still holds)', () => {
    // ★ fix-494 WIDENS the predicate; it does not replace it. Anything the old
    //   rule called submitted is still submitted, so no permit changes the
    //   other way.
    expect(
      permitIsSubmitted({
        permit_cycles: [cyc({ cycle_index: 0, submitted: '2026-06-01' })],
      }),
    ).toBe(true);
  });

  it('★★★ none of the three → NOT submitted, and that is the D&E default', () => {
    expect(
      permitIsSubmitted({
        permit_cycles: [
          cyc({ cycle_index: 0 }),
          // ★ A cycle 1 that exists but has not been submitted is not a
          //   submittal — the row is created ahead of the event.
          cyc({ cycle_index: 1, city_target: '2026-09-15' }),
        ],
      }),
    ).toBe(false);
    // ★ …and neither is a permit with no cycles at all: nothing has been sent
    //   anywhere, which is exactly what 'de' means.
    expect(permitIsSubmitted({ permit_cycles: [] })).toBe(false);
    expect(permitIsSubmitted({})).toBe(false);
    expect(permitIsSubmitted(null)).toBe(false);
  });

  it('★★ the bucket, and the words the composer shows', () => {
    const submitted = {
      permit_cycles: [cyc({ cycle_index: 0, intake_accepted: '2026-06-26' })],
    };
    expect(defaultTaskBucket(submitted)).toBe('pm');
    expect(defaultTaskBucket({ permit_cycles: [] })).toBe('de');
    expect(TASK_BUCKET_LABEL.pm).toBe('Permitting');
    expect(TASK_BUCKET_LABEL.de).toBe('D&E');
  });

  it("★★★ permit 316's exact prod shape lands in Permitting", () => {
    // ★★ The reported case, reproduced from the real row rather than described.
    expect(
      defaultTaskBucket({
        permit_cycles: [
          cyc({ cycle_index: 0, submitted: null, intake_accepted: '2026-06-26' }),
          cyc({ cycle_index: 1, submitted: '2026-06-25' }),
        ],
      }),
    ).toBe('pm');
  });
});

// ---------------------------------------------------------------------------
// THE TS HELPER AND THE SQL FUNCTION ARE ONE RULE
// ---------------------------------------------------------------------------

describe('fix-494: the TypeScript twin and its SQL original agree', () => {
  it('★★★ the migration ships the same three signals', () => {
    // ★ The `?raw` guard (fix-406): assert the file arrived before trusting a
    //   "contains" check.
    expect(migrationSql.length).toBeGreaterThan(2000);
    expect(migrationSql).toContain('create or replace function public.bp_permit_is_submitted');
    // The three arms, in SQL.
    expect(migrationSql).toMatch(
      /c\.cycle_index = 0 and \(c\.intake_accepted is not null or c\.submitted is not null\)/,
    );
    expect(migrationSql).toMatch(/c\.cycle_index >= 1 and c\.submitted is not null/);
  });

  it('★★★ the TRIGGER calls the function — not a column read of its own', () => {
    // ★★★ THE WHOLE POINT. fix-79's trigger read `c0.submitted` inline, which
    //     is how it drifted from the screen. It now delegates, so there is one
    //     copy of the rule in SQL and one in TS, twinned by this file.
    const trigger = migrationSql.slice(
      migrationSql.indexOf('bp_trg_permit_task_default_bucket'),
    );
    expect(trigger).toContain('public.bp_permit_is_submitted(NEW.permit_id)');
    expect(trigger).not.toContain('v_c0_submitted');
  });

  it('★★ fix-79\'s other behaviours are untouched', () => {
    // ★ An explicit bucket still wins (that is how the permit screen's tabs
    //   keep working), 'auto' still means "you decide", 'de' is still the
    //   fallthrough, and it is still SECURITY DEFINER.
    expect(migrationSql).toContain("IF NEW.bucket IS NOT NULL AND NEW.bucket <> 'auto' THEN");
    expect(migrationSql).toContain("ELSE 'de'");
    expect(migrationSql).toContain('security definer');
  });

  it('★★★ NO BACKFILL — the migration never writes to permit_tasks', () => {
    // ★★★ A task's bucket may since have been corrected by hand and this
    //     cannot tell a misfiled row from a deliberate one. It changes what
    //     happens NEXT and nothing that already happened. Asserted rather than
    //     promised: there is no UPDATE/INSERT/DELETE anywhere in the file.
    expect(migrationSql).not.toMatch(/update\s+public\.permit_tasks/i);
    expect(migrationSql).not.toMatch(/insert\s+into\s+public\.permit_tasks/i);
    expect(migrationSql).not.toMatch(/delete\s+from\s+public\.permit_tasks/i);
  });

  it('★★ the function is granted to `authenticated` and NOT to anon', () => {
    // ★ fix-157's posture: anon can reach nothing but `auth_tenant_ids`.
    expect(migrationSql).toContain('revoke all on function public.bp_permit_is_submitted(integer) from public, anon');
    expect(migrationSql).toContain('grant execute on function public.bp_permit_is_submitted(integer) to authenticated');
  });
});

// ---------------------------------------------------------------------------
// THE THREE READERS
// ---------------------------------------------------------------------------

describe('fix-494: three readers, one rule', () => {
  const read = (rel: string) =>
    readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('★★★ the chat composer SENDS a bucket — it used to send nothing', () => {
    // ★★★ FAILS ON origin/main, where the payload has no `bucket` key at all
    //     and the trigger's (then-wrong) default decided.
    const modal = read('src/components/ProjectDetail/ProjectChatModal.tsx');
    expect(modal).toContain('defaultTaskBucket(');
    expect(modal).toMatch(/bucket: defaultTaskBucket\(/);

    // …and the hook carries it through to the RPC.
    const hook = read('src/hooks/useProjectMessages.ts');
    expect(hook).toMatch(/bucket\?: 'de' \| 'pm';/);
    expect(hook).toContain('bucket: task.bucket');
  });

  it('★★★ the permit screen opens from the SAME helper', () => {
    // ★★ It used `c0IntakeAccepted ? 'pm' : 'de'` — one of the three signals,
    //    and not the one the trigger used. Both now ask `permitIsSubmitted`.
    const screen = read('src/components/ProjectDetail/PermitDetailV2.tsx');
    expect(screen).toContain('permitIsSubmitted(permit)');
    expect(screen).toContain("isSubmitted ? 'pm' : 'de'");
    // ★★★ COMMENT-STRIPPED — the TENTH time this repo has met this trap. The
    //     note recording what the old default WAS has to quote it, so a raw
    //     grep finds the string in the very comment that documents its removal.
    expect(stripComments(screen)).not.toContain("c0IntakeAccepted ? 'pm' : 'de'");
  });

  it("★★★ fix-123's transition snap is NOT widened", () => {
    // ★★★ THE MUST-NOT-CHANGE, ASSERTED. The auto-snap is a TRANSITION
    //     detector on `c0.intake_accepted` null↔non-null, not a default. If it
    //     started watching the wider predicate, a user who had deliberately
    //     toggled to D&E would be yanked back the moment any cycle was
    //     submitted — which is the behaviour fix-123 exists to prevent.
    const screen = read('src/components/ProjectDetail/PermitDetailV2.tsx');
    expect(screen).toContain('}, [c0IntakeAccepted]);');
    expect(screen).toContain('const wasNull = prev === null;');
  });

  it('★★ the composer shows the phase before Send', () => {
    const fields = read('src/components/ProjectDetail/ChatTaskFields.tsx');
    expect(fields).toContain('TASK_BUCKET_LABEL[defaultTaskBucket(permit)]');
    expect(fields).toContain('-phase`');
  });
});

// ---------------------------------------------------------------------------
// §C — the fix-495 rider
// ---------------------------------------------------------------------------

describe('fix-494 §C: the fix-495 migration file is committed verbatim', () => {
  it('★★ it records that Cowork applied it, and stamps the tenant from the permit', () => {
    // ★ Committed, NOT re-applied — prod already carries it (checked with
    //   `pg_get_functiondef` and reported in the PR).
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/fix_495_autoadvance_tenant_from_permit.sql'),
      'utf8',
    );
    expect(sql).toContain('APPLIED TO PROD BY COWORK 2026-09-04');
    expect(sql).toContain('SELECT tenant_id INTO v_tenant FROM public.permits');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.bp_apply_cycle_autoadvance');
  });
});

/** ★ Line and block comments removed, string literals kept — see the
 *  "comment-stripped" note above for the trap it exists for. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}
