import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { occToken, isOCCConflict } from '../lib/occ';
import { useAuthStore } from '../stores/authStore';
import {
  BADGE_ERROR_STATUSES,
  type ErrorGroupStatus,
} from '../hooks/useErrorReports';

// ===========================================================================
// ★★★ fix-580 (P-285) — AN EMPTY STRING IS NOT A TIMESTAMP
// ===========================================================================
//
// PROD ROWS 731 AND 732, 2026-09-16 00:53:00 and 00:53:09 UTC, brittani@:
//
//   invalid input syntax for type timestamp with time zone: ""
//   { url: "/board", kind: "mutation", fields: [text, discipline, start_date,
//     target_date, assigned_to, completion_status, priority, notes] }
//
// Nine seconds apart — a retry, not two edits — and **zero `team_tasks` rows
// were created or updated after 2026-09-15 17:11 UTC.** Her work never landed.
//
// ---------------------------------------------------------------------------
// ★★★ WHICH STATE PRODUCED THE `""`. REPRODUCED, NOT READ OFF THE CODE.
// ---------------------------------------------------------------------------
//
// The brief offered two candidates: a NEW task with no prior row, or an EDIT
// whose token was lost through a re-render. **It is neither.**
//
//   ❌ NEW TASK — `useUpsertTeamTask` has always sent a real `null` on an
//      insert (`isInsert ? null : …`). The insert path cannot produce this.
//   ❌ TOKEN LOST IN A RE-RENDER — nothing ever held one to lose.
//   ✅ AN EDIT WHOSE TOKEN WAS NEVER FETCHED. `TaskDetailEditor`'s team-task
//      branch shipped the literal `updated_at: ''`, with a comment calling it
//      "a deliberate last-write-wins on a panel only one person has open".
//
// ★★★ AND THE DISCRIMINATOR IS THE `fields` LIST, NOT THE PROSE. Rows 731/732
//     carry exactly the eight keys of that one object, in that order.
//     `TeamTaskComposer` — the only other caller — sends four different keys
//     (text, discipline, assigned_to, target_date, agenda) and inserts. The
//     evidence names the line.
//
// ★★★ MEASURED CONSEQUENCE: **the UPDATE branch of `bp_upsert_team_task` has
//     never succeeded once.** Four team tasks exist on prod; the only two ever
//     updated went to `Resolved`, which is `bp_set_team_task_status` — a
//     different RPC with no OCC guard at all.
//
// ---------------------------------------------------------------------------
// ⚠️ AND WHY THE NORMALISER ALONE IS NOT THE FIX
// ---------------------------------------------------------------------------
//
// `''` → `null` stops the 400, and then `WHERE tt.updated_at = null` matches no
// row: the write comes back `conflict: true` and the same edit is still lost,
// more quietly. A normaliser makes a bad token LEGIBLE; it cannot invent a good
// one. So the panel carries a real token as well — §A2 below.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Comments are where this repo explains itself, and they are FULL of the very
 *  strings these tests assert on. Strip them before asserting on code — the
 *  trap this file would otherwise fall into for the seventh time. */
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = read(
  'migrations/fix_580_empty_string_timestamp_PENDING_APPROVAL.sql',
);

// ---------------------------------------------------------------------------
// §A1 · THE NORMALISER
// ---------------------------------------------------------------------------

describe('fix-580 §A1 — an empty token becomes null, a real one is untouched', () => {
  it('★★★ "" and "   " become null — the two values PostgREST refuses', () => {
    expect(occToken('')).toBeNull();
    expect(occToken('   ')).toBeNull();
    expect(occToken('\t\n ')).toBeNull();
  });

  it('★★★ a real timestamp passes through UNCHANGED, byte for byte', () => {
    // ★ Not trimmed, not reformatted, not re-parsed. The OCC comparison is an
    //   equality test against a stamp the server minted; anything this function
    //   "helpfully" normalises is a conflict it invents.
    const t = '2026-09-15T17:11:04.475968+00:00';
    expect(occToken(t)).toBe(t);
    expect(occToken('2026-09-16 00:53:00.404315+00')).toBe(
      '2026-09-16 00:53:00.404315+00',
    );
  });

  it('★★ null and undefined are already the honest answer', () => {
    expect(occToken(null)).toBeNull();
    expect(occToken(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §A2 · THE CENSUS — every OCC call site, not just the one that broke
// ---------------------------------------------------------------------------
//
// ★★★ 45 RPCs on prod take a `timestamptz`, and in every one of them it is the
//     OCC guard. Fixing the one call site that failed is a promise to hit this
//     again on the other 44, so the rule is enforced by enumeration rather than
//     by a list of files somebody has to remember to extend.

/** Every `p_*expected*` argument name that carries a timestamptz on prod.
 *  ★ FIVE, not the three the brief named — `p_expected_b` and
 *    `p_project_expected_updated_at` are real and a grep for
 *    `p_expected_updated_at` alone would have missed both. */
const OCC_ARGS = [
  'p_expected_updated_at',
  'p_expected_a',
  'p_expected_b',
  'p_anchor_expected_updated_at',
  'p_project_expected_updated_at',
];

function hookFiles(): string[] {
  const dir = resolve(process.cwd(), 'src/hooks');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => resolve(dir, f));
}

/** Every line in src/hooks that POSTS an OCC token, with its file — and the
 *  set of local names that file derived FROM `occToken`, so a two-step hook
 *  (normalise, then maybe go and fetch a real stamp) is not a false positive.
 *  ★ The derivation has to be in the SAME file, which is what keeps this a
 *    syntactic rule rather than a judgement call. */
function occCallSites(): Array<{
  file: string;
  line: string;
  n: number;
  derived: Set<string>;
}> {
  const out: Array<{
    file: string;
    line: string;
    n: number;
    derived: Set<string>;
  }> = [];
  for (const file of hookFiles()) {
    const src = strip(read(file));
    const derived = new Set(
      [...src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*[^=][^;\n]*occToken\(/g)].map(
        (m) => m[1]!,
      ),
    );
    src.split('\n').forEach((line, i) => {
      if (OCC_ARGS.some((a) => new RegExp(`\\b${a}\\s*:`).test(line))) {
        out.push({ file, line: line.trim(), n: i + 1, derived });
      }
    });
  }
  return out;
}

describe('fix-580 §A2 — every OCC token on the wire goes through occToken', () => {
  it('★★ the census finds the call sites at all (it would pass vacuously otherwise)', () => {
    // 49 sites across 37 hooks when this was written. Asserted as a floor, not
    // an exact number: a new OCC hook must not have to edit this line.
    expect(occCallSites().length).toBeGreaterThanOrEqual(45);
  });

  it('★★★ …and each one either calls occToken or posts a literal null', () => {
    // ★ A literal `null` is already the honest value for "no prior row", which
    //   is what every insert branch posts. Everything else — a variable, a
    //   property, a ternary — is a string that could be `""`, and must be
    //   normalised. This is the assertion that covers the other 44 RPCs.
    const offenders = occCallSites()
      .filter((s) => {
        if (/occToken\(/.test(s.line)) return false;
        if (/:\s*null\b/.test(s.line)) return false;
        // A local this file already ran through occToken — useUpsertTeamTask
        // normalises first and then fetches a real stamp if what it had was
        // empty, so the value reaching the wire is two steps from the call.
        const m = s.line.match(/:\s*([A-Za-z_$][\w$]*)\s*,?\s*$/);
        return !(m && s.derived.has(m[1]!));
      })
      .map((s) => `${s.file.split(/[\\/]/).pop()}:${s.n}: ${s.line}`);
    expect(offenders, 'OCC tokens posted raw').toEqual([]);
  });

  it('★★★ the 46th surface — the token carried INSIDE jsonb — is normalised too', () => {
    // ★★★ `bp_update_project_with_permits` reads each permit's token as
    //     `(v_elem->>'expected_updated_at')::timestamptz`. That is the SAME
    //     cast that refused 731/732, reached through jsonb instead of through
    //     PostgREST's argument coercion — and grepping for
    //     `p_expected_updated_at` would never have found it.
    const src = strip(read('src/hooks/useUpdateProjectWithPermits.ts'));
    expect(src).toMatch(/expected_updated_at:\s*occToken\(/);
  });
});

// ---------------------------------------------------------------------------
// §A3 · THE LINE THAT LOST THE EDIT
// ---------------------------------------------------------------------------

describe('fix-580 §A3 — the panel no longer invents a token', () => {
  const panel = strip(read('src/components/TaskDetailEditor.tsx'));

  it('★★★ the literal empty token is GONE from the team-task write', () => {
    expect(panel).not.toMatch(/updated_at:\s*['"]\s*['"]/);
  });

  it('★★★ …replaced by the row\'s real stamp, advanced on every save', () => {
    // ★ Each field on this panel commits separately and the invalidation that
    //   would refresh `task` lands AFTER the next click, so a second edit in the
    //   same second would post the stamp the first one just replaced. The ref is
    //   what makes that impossible rather than merely unlikely.
    expect(panel).toMatch(/updated_at:\s*teamTokenRef\.current/);
    expect(panel).toMatch(/teamTokenRef\.current\s*=\s*row\.updated_at/);
  });

  it('★★ and it states its clears, because §B stops null meaning "clear"', () => {
    for (const flag of [
      'clear_start_date',
      'clear_target_date',
      'clear_assigned_to',
      'clear_notes',
    ]) {
      expect(panel, flag).toContain(flag);
    }
  });
});

// ---------------------------------------------------------------------------
// §A4 · THE WRITER — what actually reaches the RPC
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const rpcFn = vi.fn();
  const rowFn = vi.fn();
  return {
    rpcFn,
    rowFn,
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => rpcFn(name, args),
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, val: unknown) => ({
            maybeSingle: () => rowFn(table, cols, col, val),
          }),
        }),
      }),
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

// The mock above must be hoisted before this import — vi.mock handles that.
import { useUpsertTeamTask } from '../hooks/useTeamTasks';

const T = 'test-tenant-uuid';

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** The row `bp_upsert_team_task` returns on a successful write. */
const okRow = (id: string, updated_at: string) => ({
  data: [{ out_id: id, updated_at, conflict: false }],
  error: null,
});

async function run(
  input: Parameters<ReturnType<typeof useUpsertTeamTask>['mutate']>[0],
  expectThrow = false,
) {
  const qc = newClient();
  const { result } = renderHook(() => useUpsertTeamTask(), {
    wrapper: wrapperFor(qc),
  });
  let out: { id: string; updated_at: string } | undefined;
  let err: unknown;
  await act(async () => {
    try {
      out = await result.current.mutateAsync(input);
    } catch (e) {
      err = e;
      if (!expectThrow) throw e;
    }
  });
  return { out, err, args: mocks.rpcFn.mock.calls.at(-1)?.[1] as Record<string, unknown> };
}

beforeEach(() => {
  mocks.rpcFn.mockReset();
  mocks.rowFn.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-580 §A4 — a brand-new task with an empty start date SAVES', () => {
  it('★★★ the row comes back, and the token on the wire is null — not ""', async () => {
    mocks.rpcFn.mockResolvedValue(okRow('tt-new', '2026-09-16T01:00:00Z'));
    const { out, args } = await run({
      op: 'insert',
      patch: { text: 'Chase the ULS calendar', discipline: 'ent', start_date: '' },
    });
    // ★★★ THE ASSERTION IS THE ROW, NOT THE ABSENCE OF A TOAST. "No error
    //     appeared" is exactly what 731/732 looked like from the inside — the
    //     RPC refused and the mutation threw, and only the DB knew.
    expect(out).toEqual({ id: 'tt-new', updated_at: '2026-09-16T01:00:00Z' });
    expect(args.p_expected_updated_at).toBeNull();
    // ★ The empty date is left for the RPC to null — §C makes that safe. What
    //   matters here is that it does not become a timestamptz.
    expect(args.p_id).toBeNull();
  });
});

describe('fix-580 §A4 — an EDIT posts a real token', () => {
  it('★★★ the caller\'s token is sent unchanged when it has one', async () => {
    mocks.rpcFn.mockResolvedValue(okRow('tt-1', '2026-09-16T02:00:00Z'));
    const { args } = await run({
      op: 'update',
      id: 'tt-1',
      updated_at: '2026-09-15T17:11:04.475968+00:00',
      patch: { text: 'Edited' },
    });
    expect(args.p_expected_updated_at).toBe('2026-09-15T17:11:04.475968+00:00');
    // ★ No extra read: the caller had a token, so nothing was fetched.
    expect(mocks.rowFn).not.toHaveBeenCalled();
  });

  it('★★★ an EMPTY token is not posted — the stamp is FETCHED instead', async () => {
    // ★★★ THIS IS THE REGRESSION TEST FOR 731/732. Before this ticket the panel
    //     posted `''` here and PostgREST refused the call. `occToken` alone
    //     would post `null` and the RPC would refuse it as a conflict — the same
    //     lost edit, quieter. The token has to be real.
    mocks.rowFn.mockResolvedValue({
      data: { updated_at: '2026-09-15T17:11:04.475968+00:00' },
      error: null,
    });
    mocks.rpcFn.mockResolvedValue(okRow('tt-1', '2026-09-16T02:00:00Z'));
    const { out, args } = await run({
      op: 'update',
      id: 'tt-1',
      updated_at: '',
      patch: { text: 'Edited' },
    });
    expect(mocks.rowFn).toHaveBeenCalledWith(
      'team_tasks',
      'updated_at',
      'id',
      'tt-1',
    );
    expect(args.p_expected_updated_at).toBe('2026-09-15T17:11:04.475968+00:00');
    expect(out?.id).toBe('tt-1');
  });

  it('★★ a whitespace-only token takes the same road', async () => {
    mocks.rowFn.mockResolvedValue({ data: { updated_at: 'X' }, error: null });
    mocks.rpcFn.mockResolvedValue(okRow('tt-1', 'Y'));
    const { args } = await run({
      op: 'update',
      id: 'tt-1',
      updated_at: '   ',
      patch: { text: 'Edited' },
    });
    expect(args.p_expected_updated_at).toBe('X');
  });

  it('★★★ a row that is GONE falls through to null, not to a lie', async () => {
    // ★ `maybeSingle` returns `data: null` for a deleted row. Posting null is a
    //   refusal, which is correct: the row this edit was aimed at is not there.
    mocks.rowFn.mockResolvedValue({ data: null, error: null });
    mocks.rpcFn.mockResolvedValue({
      data: [{ out_id: 'tt-1', updated_at: null, conflict: true }],
      error: null,
    });
    const { err, args } = await run(
      { op: 'update', id: 'tt-1', updated_at: '', patch: { text: 'Edited' } },
      true,
    );
    expect(args.p_expected_updated_at).toBeNull();
    expect(isOCCConflict(err)).toBe(true);
  });
});

describe('fix-580 §A4 — the conflict invariant, asserted in BOTH directions', () => {
  it('★★★ a genuine conflict still throws', async () => {
    mocks.rpcFn.mockResolvedValue({
      data: [{ out_id: 'tt-1', updated_at: '2026-09-16T03:00:00Z', conflict: true }],
      error: null,
    });
    const { err } = await run(
      {
        op: 'update',
        id: 'tt-1',
        updated_at: '2026-09-15T17:11:04.475968+00:00',
        patch: { text: 'Edited' },
      },
      true,
    );
    expect(isOCCConflict(err)).toBe(true);
  });

  it('★★★ …and a NON-conflict does not', async () => {
    // ★ The other direction, which is the one a "make it stop refusing" fix
    //   breaks silently: an invariant with two directions must be checked in
    //   both. This Brain has recorded that three times.
    mocks.rpcFn.mockResolvedValue(okRow('tt-1', '2026-09-16T03:00:00Z'));
    const { out, err } = await run({
      op: 'update',
      id: 'tt-1',
      updated_at: '2026-09-15T17:11:04.475968+00:00',
      patch: { text: 'Edited' },
    });
    expect(err).toBeUndefined();
    expect(out).toEqual({ id: 'tt-1', updated_at: '2026-09-16T03:00:00Z' });
  });
});

// ---------------------------------------------------------------------------
// §B · THE PARTIAL PATCH
// ---------------------------------------------------------------------------
//
// ★★★ MEASURED BEFORE IT WAS CHANGED, as §B demanded. The UPDATE branch
//     assigned NINE columns unconditionally with no coalesce:
//
//       text, notes, assigned_to, discipline, start_date, due_date,
//       target_date, ref_project_id, ref_permit_id
//
//     …while completion_status, priority, sort_order and agenda DID coalesce.
//     That is only safe if every caller sends every one of those keys.
//
// ★★★ THE ANSWER IS: **PARTIAL.** There is exactly one update caller in the
//     repo and it sends eight keys, omitting `due_date`, `ref_project_id` and
//     `ref_permit_id` — so each of the three was being NULLed on every edit.
//     The path that proves it is `TaskDetailEditor`'s team branch, and the
//     proof is asserted below rather than described.

describe('fix-580 §B — the patch is partial, and the function stops assuming otherwise', () => {
  it('★★★ the one update caller sends EIGHT keys, not fourteen', () => {
    // ★ These eight, in this order, are `context.fields` on prod rows 731/732 —
    //   which is how the failing line was identified in the first place.
    const FIELDS_731 = [
      'text',
      'discipline',
      'start_date',
      'target_date',
      'assigned_to',
      'completion_status',
      'priority',
      'notes',
    ];
    const panel = strip(read('src/components/TaskDetailEditor.tsx'));
    const block = panel.slice(
      panel.indexOf('upsertTeam.mutate('),
      panel.indexOf('upsert.mutate({'),
    );
    expect(block.length).toBeGreaterThan(0);
    for (const f of FIELDS_731) expect(block, f).toContain(`${f}:`);
    // ★★★ THE THREE IT DOES NOT SEND — the columns that were being wiped.
    for (const f of ['due_date', 'ref_project_id', 'ref_permit_id']) {
      expect(block, `${f} is still not sent`).not.toContain(`${f}:`);
    }
  });

  it('★★★ so the migration coalesces all nine to the stored row', () => {
    for (const col of [
      'notes',
      'assigned_to',
      'start_date',
      'due_date',
      'target_date',
      'ref_project_id',
      'ref_permit_id',
    ]) {
      expect(MIGRATION, col).toMatch(
        new RegExp(`coalesce\\(v_[a-z_]+,\\s*tt\\.${col}\\)`),
      );
    }
    // discipline too — absent, it used to default to 'ent' and move an arch
    // task into the other lane.
    expect(MIGRATION).toMatch(/discipline\s*=\s*coalesce\(v_disc,\s*tt\.discipline\)/);
  });

  it('★★★ …and clearing a field STILL WORKS, through an explicit flag', () => {
    // ⚠️ A coalesce turns "clear this date" into a no-op. The flags are the
    //    price, and they are bp_upsert_permit_task's existing p_clear_* contract
    //    rather than a second invention.
    for (const flag of [
      'clear_notes',
      'clear_assigned_to',
      'clear_start_date',
      'clear_due_date',
      'clear_target_date',
      'clear_ref_project_id',
      'clear_ref_permit_id',
    ]) {
      expect(MIGRATION, flag).toContain(flag);
    }
    // The shape: flag wins, then the value, then the stored row.
    expect(MIGRATION).toMatch(
      /CASE WHEN v_c_start\s+THEN NULL ELSE coalesce\(v_start,\s+tt\.start_date\)\s+END/,
    );
  });

  it('★★ `text` is deliberately NOT given a clear flag', () => {
    // It cannot be lost — the function RAISES on an empty one rather than
    // storing it — so a clear flag for it would be inventing a way to break a
    // task rather than closing a hole.
    expect(MIGRATION).not.toContain('clear_text');
    expect(MIGRATION).toContain("RAISE EXCEPTION 'a task needs a description'");
  });

  it('★★ the client type carries the flags, so a caller can actually send them', () => {
    const t = read('src/hooks/useTeamTasks.ts');
    for (const flag of ['clear_notes', 'clear_assigned_to', 'clear_start_date']) {
      expect(t, flag).toContain(`${flag}?: boolean`);
    }
  });
});

// ---------------------------------------------------------------------------
// §C · THE UNGUARDED CASTS
// ---------------------------------------------------------------------------

describe('fix-580 §C — an empty string in a typed jsonb field stores NULL', () => {
  it('★★★ all three dates in bp_upsert_team_task are guarded', () => {
    for (const col of ['start_date', 'due_date', 'target_date']) {
      expect(MIGRATION, col).toContain(
        `(nullif(btrim(coalesce(p_data->>'${col}','')),''))::date`,
      );
    }
  });

  it('★★★ …and so are the boolean/integer/uuid reads a COALESCE does NOT protect', () => {
    // ⚠️ THE TRAP: `COALESCE((p_data->>'priority')::boolean, false)` still
    //    raises on `""`, because the cast runs BEFORE the coalesce sees it.
    for (const [col, type] of [
      ['priority', 'boolean'],
      ['sort_order', 'integer'],
      ['agenda', 'boolean'],
      ['ref_permit_id', 'integer'],
      ['ref_project_id', 'uuid'],
      ['source_message_id', 'uuid'],
    ] as const) {
      expect(MIGRATION, col).toContain(
        `(nullif(btrim(coalesce(p_data->>'${col}','')),''))::${type}`,
      );
    }
  });

  it('★★★ the sibling sweep names all NINE functions and all seventeen casts', () => {
    // ★ Measured against the LIVE bodies: every anchor matched 1 or 2 times,
    //   0 misses, and folding the substitution over those bodies leaves ZERO
    //   unguarded casts in any bp_upsert_* function.
    //
    // ★★★ THIS TEST SAID "EIGHT" AND LISTED NINE, and so did the migration and
    //     the PR. The §C block asserted `v_hits <> 8` over those nine names, so
    //     it raised and **the whole file was rolled back at apply time on
    //     2026-09-15**. Three statements of one miscount, none of which could
    //     catch the others — because all three were typed by hand from the same
    //     wrong reading of the same list.
    //
    //     fix-566 repaired it, and not by changing 8 to 9: the expected count is
    //     now derived from the job array the loop walks, so the assertion cannot
    //     disagree with the list it is asserting about. The literal below is the
    //     list itself, which is the only place a name can be added or removed.
    const FNS = [
      'bp_upsert_draw_schedule_row',
      'bp_upsert_intake_records_row',
      'bp_upsert_permit_cycle_row',
      'bp_upsert_permit_task_row',
      'bp_upsert_project_document_row',
      'bp_upsert_quarter_layout_row',
      'bp_upsert_task_template_row',
      'bp_upsert_task_template_subtask_row',
      'bp_upsert_team_member_row',
    ];
    // ★ NINE names, NINE rewritten. `bp_upsert_team_task` is NOT one of them —
    //   it is replaced wholesale in §B and never appears in this list, which is
    //   exactly the slip that produced "eight".
    expect(FNS).toHaveLength(9);
    for (const fn of FNS) expect(MIGRATION, fn).toContain(fn);
    expect(FNS).not.toContain('bp_upsert_team_task');
    // ★★★ AND THE COUNT IS DERIVED. No literal survives in the assertion.
    expect(MIGRATION).toMatch(/SELECT count\(DISTINCT v_jobs\[i\]\[1\]\) INTO v_expect/);
    expect(MIGRATION).toMatch(/IF v_hits <> v_expect THEN/);
    expect(MIGRATION).not.toMatch(/IF v_hits <> \d+ THEN/);
  });

  it('★★★ the anchor block RAISES when it matches nothing', () => {
    // fix-540's rule: a replacement that silently matches nothing looks exactly
    // like a success. This is the assertion that the file thought about it.
    expect(MIGRATION).toMatch(/IF v_new = v_src THEN[\s\S]{0,120}RAISE EXCEPTION/);
  });

  it('★★★ bp_upsert_da_time_block_row is NOT touched — P-283 is open on it', () => {
    // ⚠️ fix-579's instrumentation is waiting for a clean occurrence there.
    //    Changing that path now destroys the experiment.
    const statements = MIGRATION.slice(MIGRATION.indexOf('THE STATEMENTS'));
    expect(
      statements.split('bp_upsert_da_time_block_row').length - 1,
      'named only in the comment that says it is excluded',
    ).toBe(1);
    expect(MIGRATION).toContain('DELIBERATELY ABSENT');
  });

  it('★★ the verify query is CASE-INSENSITIVE, because the bodies mix NULLIF and nullif', () => {
    // ★ The case-sensitive version reports eleven GUARDED lines as unguarded —
    //   including every `NULLIF(p_data->>'dd_start','')::date`. It was written
    //   that way first and the false positives are what caught it.
    expect(MIGRATION).toContain("ln !~* 'nullif'");
    expect(MIGRATION).not.toContain("ln !~ 'nullif'");
  });
});

// ---------------------------------------------------------------------------
// §D · THE BADGE COUNTS WHAT THE LIST SHOWS
// ---------------------------------------------------------------------------
//
// Bobby, 2026-09-16: *"error triage shows 1 but has 3 items in it."*
//
// ★★★ THE MIRROR, BECAUSE CI HAS NO DATABASE (fix-153's pattern). The function
//     below is `bp_new_error_count`'s HAVING clause in TypeScript; the test
//     that keeps the two honest is the one asserting the migration text holds
//     the same three statuses.

interface Row {
  fingerprint: string;
  status: ErrorGroupStatus;
  created_at: string;
  id: number;
  source: string;
}

/** Mirror of bp_new_error_count: group by fingerprint, take the LATEST row's
 *  status (created_at DESC, id DESC — fix-338's tie-break, because `now()` is
 *  constant inside a transaction), count the groups that survive. */
function badgeCount(rows: Row[], statuses: readonly string[]): number {
  const byFp = new Map<string, Row>();
  for (const r of rows) {
    if (r.source === 'scraper') continue;
    const cur = byFp.get(r.fingerprint);
    const newer =
      !cur ||
      r.created_at > cur.created_at ||
      (r.created_at === cur.created_at && r.id > cur.id);
    if (newer) byFp.set(r.fingerprint, r);
  }
  return [...byFp.values()].filter((r) => statuses.includes(r.status)).length;
}

/** Mirror of the Active tab: the same grouping, filtered by the same list. */
function listItems(rows: Row[], statuses: readonly string[]): number {
  return badgeCount(rows, statuses);
}

const row = (o: Partial<Row> & Pick<Row, 'fingerprint' | 'status' | 'id'>): Row => ({
  created_at: `2026-09-16T00:0${o.id}:00Z`,
  source: 'backend_rpc',
  ...o,
});

describe('fix-580 §D — one signature is one item, on the badge and on the page', () => {
  const seed: Row[] = [
    // 1 `new` signature, TWO rows
    row({ fingerprint: 'aaa', status: 'new', id: 1 }),
    row({ fingerprint: 'aaa', status: 'new', id: 2 }),
    // 1 `queued` signature, TWO rows — this is 731/732
    row({ fingerprint: 'e3376008a7c69e5b6a37841ba957d34c', status: 'queued', id: 3 }),
    row({ fingerprint: 'e3376008a7c69e5b6a37841ba957d34c', status: 'queued', id: 4 }),
  ];

  it('★★★ badge reads 2 and the list shows 2 — four rows, two items', () => {
    expect(badgeCount(seed, BADGE_ERROR_STATUSES)).toBe(2);
    expect(listItems(seed, BADGE_ERROR_STATUSES)).toBe(2);
  });

  it('★★★ the OLD predicate is what Bobby saw: badge 1, list 2', () => {
    // ⚠️ PROVE THE BUG BEFORE CLAIMING THE FIX. `status = 'new'` counts one of
    //    these two signatures while the page renders both.
    expect(badgeCount(seed, ['new'])).toBe(1);
    expect(listItems(seed, BADGE_ERROR_STATUSES)).toBe(2);
  });

  it('★★★ a QUEUED signature stays visible — hiding it is what caused this', () => {
    expect(BADGE_ERROR_STATUSES).toContain('queued');
  });

  it('★★★ …and a RESOLVED signature counts on neither', () => {
    const closed = [
      ...seed,
      row({ fingerprint: 'zzz', status: 'resolved', id: 5 }),
      row({ fingerprint: 'yyy', status: 'dismissed', id: 6 }),
    ];
    expect(badgeCount(closed, BADGE_ERROR_STATUSES)).toBe(2);
  });

  it('★★ the LATEST row decides the group, not the first', () => {
    // fix-338's rule, kept: a signature triaged to `resolved` after two `new`
    // occurrences is resolved, and drops off both surfaces together.
    const triaged = [
      row({ fingerprint: 'bbb', status: 'new', id: 7 }),
      row({ fingerprint: 'bbb', status: 'resolved', id: 8 }),
    ];
    expect(badgeCount(triaged, BADGE_ERROR_STATUSES)).toBe(0);
  });

  it('★★ scraper rows are counted by neither (fix-438 C1)', () => {
    const noisy = [
      ...seed,
      row({ fingerprint: 'scr', status: 'new', id: 9, source: 'scraper' }),
    ];
    expect(badgeCount(noisy, BADGE_ERROR_STATUSES)).toBe(2);
  });
});

describe('fix-580 §D — the two predicates are ONE list, not two copies', () => {
  it('★★★ the page\'s Active tab IS BADGE_ERROR_STATUSES', () => {
    const page = strip(read('src/pages/Errors.tsx'));
    expect(page).toMatch(/active:\s*BADGE_ERROR_STATUSES/);
    // ★ …and it no longer spells the list out a second time.
    expect(page).not.toMatch(/active:\s*\[/);
  });

  it('★★★ the migration\'s HAVING clause holds the SAME three statuses', () => {
    // ★★★ THE MIRROR TEST. There is no live database in CI, so the server's
    //     predicate is checked against the file that will create it. Change one
    //     and this names the other.
    const having = MIGRATION.slice(MIGRATION.indexOf('HAVING (array_agg'));
    for (const s of BADGE_ERROR_STATUSES) {
      expect(having, s).toContain(`'${s}'`);
    }
    expect(having).not.toContain("'resolved'");
    expect(having).not.toContain("'dismissed'");
  });

  it('★★★ it still counts DISTINCT FINGERPRINTS, not rows', () => {
    // *A count is only a fact with its predicate.* The list groups by
    // signature, so two rows of one signature are ONE item on screen.
    expect(MIGRATION).toContain('GROUP BY fingerprint');
    // …and the tie-break survives, because now() is CONSTANT in a transaction.
    expect(MIGRATION).toContain('ORDER BY created_at DESC, id DESC');
  });
});
