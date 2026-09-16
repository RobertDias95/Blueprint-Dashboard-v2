import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  occCall,
  occInsertKey,
  occPendingRows,
  occRowKey,
  occSerialize,
  __resetOccQueue,
} from '../lib/occQueue';
import { OCCConflictError, isOCCConflict } from '../lib/occ';

// ===========================================================================
// ★★★ fix-584 (P-286) — ONE TOKEN MECHANISM, AND A QUIETER TRIAGE
// ===========================================================================
//
// §B IS THE FOURTH INSTANCE OF ONE DEFECT:
//
//   fix-532 §B  Unit Dimensions editor  Gena          2026-09-11
//   fix-580     team tasks (/board)     Brittani      2026-09-16
//   fix-581     DA time blocks          Miles, Dave   2026-09-16
//   fix-584     Unit Dimensions AGAIN   Cam           2026-09-16
//
// Prod #736 carries the SAME FINGERPRINT as Gena's #717 (`ccf423f3`), on the
// surface fix-532 §B already fixed, five days later.
//
// ★★★ WHY READING THE CACHE WAS NEVER ENOUGH. Both previous fixes read the
//     token from the React Query cache at send time — strictly better than a
//     render snapshot, and **only correct once the previous write has
//     RETURNED**, because the cache is written in `onSuccess`. With three
//     writes in flight it is stale for the second and the third. fix-532's own
//     header predicted it — *"Two is survivable… Three is not"* — and Cam's
//     392-row backfill made three routine.
//
// So: serialize per row. The tests below are the two directions that matter.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** A controllable write: resolve/reject it by hand so several can be in
 *  flight at once — which is the only way to reproduce Cam's case. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => __resetOccQueue());
afterEach(() => __resetOccQueue());

// ---------------------------------------------------------------------------
// §B1 · THE BURST — Cam's case
// ---------------------------------------------------------------------------

describe('fix-584 §B — three writes in flight on ONE row', () => {
  it('★★★ each posts the token the PREVIOUS one minted, and all three land', async () => {
    const KEY = occRowKey('projects', 'p-1');
    const posted: Array<string | null> = [];
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];

    // ★★★ ALL THREE ARE COMPOSED BEFORE ANY OF THEM RETURNS, and all three are
    //     seeded with the SAME stale token — exactly what a per-field editor
    //     does, and exactly what the cache read cannot rescue because the cache
    //     has not been written yet.
    const runs = gates.map((g, i) =>
      occSerialize(KEY, 'T0', async (expected) => {
        posted.push(expected);
        const token = await g.promise;
        return { value: `write${i}`, token };
      }),
    );

    // Only the first may be in flight; the other two are queued behind it.
    expect(posted).toEqual(['T0']);

    gates[0]!.resolve('T1');
    await runs[0];
    expect(posted).toEqual(['T0', 'T1']);

    gates[1]!.resolve('T2');
    await runs[1];
    expect(posted).toEqual(['T0', 'T1', 'T2']);

    gates[2]!.resolve('T3');
    await expect(Promise.all(runs)).resolves.toEqual(['write0', 'write1', 'write2']);

    // ★ The assertion is the TOKENS, not the absence of a toast. Before this,
    //   all three posted `T0` and the second and third were refused.
    expect(posted).toEqual(['T0', 'T1', 'T2']);
    expect(occPendingRows()).toBe(0);
  });

  it('★★★ a THIRD write composed in the same tick chains off the SECOND', async () => {
    // ⚠️ The subtle one: the queue registers BEFORE its first `await`, so three
    //    writes form a chain of three rather than two both waiting on the first.
    //    Without that, two of the three post the same token — the bug with an
    //    extra step.
    const KEY = occRowKey('projects', 'p-2');
    const posted: Array<string | null> = [];
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const runs = gates.map((g) =>
      occSerialize(KEY, 'S0', async (expected) => {
        posted.push(expected);
        return { value: null, token: await g.promise };
      }),
    );
    gates[0]!.resolve('S1');
    await runs[0];
    gates[1]!.resolve('S2');
    await runs[1];
    gates[2]!.resolve('S3');
    await runs[2];
    expect(posted).toEqual(['S0', 'S1', 'S2']);
    expect(new Set(posted).size).toBe(3);
  });

  it('★★ two DIFFERENT rows never wait on each other', async () => {
    // ★ A 392-row backfill must stay as parallel as it was. The queue is per
    //   row, not per table.
    const a = deferred<string>();
    const b = deferred<string>();
    const started: string[] = [];
    const ra = occSerialize(occRowKey('projects', 'p-a'), 'A0', async () => {
      started.push('a');
      return { value: 'a', token: await a.promise };
    });
    const rb = occSerialize(occRowKey('projects', 'p-b'), 'B0', async () => {
      started.push('b');
      return { value: 'b', token: await b.promise };
    });
    expect(started).toEqual(['a', 'b']); // both in flight at once
    a.resolve('A1');
    b.resolve('B1');
    await Promise.all([ra, rb]);
  });

  it('★★ an INSERT never queues — it has no prior row to be stale against', async () => {
    const started: string[] = [];
    const g1 = deferred<string>();
    const g2 = deferred<string>();
    const r1 = occSerialize(occInsertKey('projects'), null, async () => {
      started.push('i1');
      return { value: 1, token: await g1.promise };
    });
    const r2 = occSerialize(occInsertKey('projects'), null, async () => {
      started.push('i2');
      return { value: 2, token: await g2.promise };
    });
    expect(started).toEqual(['i1', 'i2']);
    g1.resolve('X');
    g2.resolve('Y');
    await Promise.all([r1, r2]);
  });
});

// ---------------------------------------------------------------------------
// §B · THE OTHER DIRECTION — a real conflict is still refused
// ---------------------------------------------------------------------------
//
// ⚠️⚠️ CHAINING YOUR OWN WRITES IS CORRECT; SWALLOWING SOMEBODY ELSE'S IS DATA
//    LOSS. The chain only ever propagates tokens minted by THIS client's own
//    writes, so a second person's write still invalidates it.

describe('fix-584 §B — a genuine second client is still refused', () => {
  it('★★★ a second writer during my burst makes my NEXT write conflict', async () => {
    // ★★★ THE OVERLAP IS THE WHOLE TEST. My #2 must be composed while my #1 is
    //     still in flight — that is the window the queue owns, and the only one
    //     where a chained token is used at all. (Once #1 returns, `onSuccess`
    //     has written the cache and #2's own seed is authoritative; see §B3.)
    const KEY = occRowKey('projects', 'p-shared');
    const gate = deferred<string>();
    const posted: Array<string | null> = [];

    // ── My #1, in flight. The server will mint M1 for it. ──
    const first = occSerialize(KEY, 'T0', async (expected) => {
      posted.push(expected);
      return { value: 'mine-1', token: await gate.promise };
    });

    // ── My #2, composed NOW, queued behind #1. ──
    //
    // ── Meanwhile SOMEBODY ELSE writes the row from another tab. They have
    //    their own queue and their own cache; nothing about their write reaches
    //    mine, so the server's stamp moves past M1 without my chain knowing.
    const serverStamp = 'OTHER';
    const second = occSerialize(KEY, 'T0', async (expected) => {
      posted.push(expected);
      if (expected !== serverStamp) {
        throw new OCCConflictError(0, 'Unit Dimensions', {
          rowId: 'p-shared',
          expected,
          actual: serverStamp,
        });
      }
      return { value: 'mine-2', token: serverStamp };
    });

    gate.resolve('M1');
    await first;
    await expect(second).rejects.toThrow(/changed since you loaded it/);

    // ★ My #2 posted the token MY #1 minted — and was refused, because the
    //   other person's write had already superseded it. The queue removed a tab's
    //   ability to refuse ITSELF and removed nothing else.
    expect(posted).toEqual(['T0', 'M1']);
  });

  it('★★★ …and the refusal is a REAL OCCConflictError, carrying both sides', async () => {
    // fix-579's instrument must survive: the next occurrence still has to be
    // diagnosable from the report alone.
    const KEY = occRowKey('projects', 'p-detail');
    let caught: unknown;
    await occSerialize(KEY, 'T0', async (expected) => {
      throw new OCCConflictError(0, 'Unit Dimensions', {
        rowId: 'p-detail',
        expected,
        actual: 'SERVER',
      });
    }).catch((e) => {
      caught = e;
    });
    expect(isOCCConflict(caught)).toBe(true);
    expect((caught as OCCConflictError).detail?.expected).toBe('T0');
    expect((caught as OCCConflictError).detail?.actual).toBe('SERVER');
  });

  it('★★★ a refusal hands the SERVER\'S stamp to the follower, not the doomed one', async () => {
    // ★ So one person's burst recovers by itself instead of refusing all the
    //   way down — and the follower is posting a token the server gave, which
    //   is still subject to the guard.
    const KEY = occRowKey('projects', 'p-recover');
    const posted: Array<string | null> = [];
    const first = occSerialize(KEY, 'STALE', async (expected) => {
      posted.push(expected);
      throw new OCCConflictError(0, 'Unit Dimensions', {
        rowId: 'p-recover',
        expected,
        actual: 'REAL',
      });
    });
    const second = occSerialize(KEY, 'STALE', async (expected) => {
      posted.push(expected);
      return { value: 'ok', token: 'REAL2' };
    });
    await first.catch(() => undefined);
    await expect(second).resolves.toBe('ok');
    expect(posted).toEqual(['STALE', 'REAL']);
  });

  it('★★ a predecessor that FAILS does not reject its followers', async () => {
    const KEY = occRowKey('projects', 'p-boom');
    const first = occSerialize(KEY, 'T0', async () => {
      throw new Error('network');
    });
    const second = occSerialize(KEY, 'T0', async (expected) => ({
      value: expected,
      token: 'T1',
    }));
    await expect(first).rejects.toThrow('network');
    // ★ A non-OCC failure teaches nothing about the row, so the follower keeps
    //   its own seed rather than inheriting a guess.
    await expect(second).resolves.toBe('T0');
  });

  it('★★ a write that cannot learn the new stamp leaves the follower its own seed', async () => {
    // `token: undefined` is "I do not know" and is NOT `null`. Publishing
    // `null` would make the follower post null and be refused.
    const KEY = occRowKey('draw_schedule', 'p-unknown');
    await occSerialize(KEY, 'A', async () => ({ value: 1, token: undefined }));
    const posted: Array<string | null> = [];
    await occSerialize(KEY, 'B', async (expected) => {
      posted.push(expected);
      return { value: 2, token: undefined };
    });
    expect(posted).toEqual(['B']);
  });

  it('★★ occCall is the same queue, in its thin form', async () => {
    const KEY = occRowKey('project_consultants', 'c-1');
    const posted: Array<string | null> = [];
    const gate = deferred<void>();
    // Overlapping, as above — the second is composed while the first is open.
    const a = occCall(
      KEY,
      'C0',
      async (expected) => {
        posted.push(expected);
        await gate.promise;
        return { ok: true };
      },
      () => 'C1',
    );
    const b = occCall(KEY, 'C0', async (expected) => {
      posted.push(expected);
      return { ok: true };
    });
    gate.resolve();
    await Promise.all([a, b]);
    expect(posted).toEqual(['C0', 'C1']);
  });
});

// ---------------------------------------------------------------------------
// §B2 · THE CENSUS — what makes this the last time
// ---------------------------------------------------------------------------

/** Every hook that posts an OCC token on the wire. */
function occWriteHooks(): string[] {
  const dir = resolve(process.cwd(), 'src/hooks');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => /\boccToken\(/.test(readFileSync(resolve(dir, f), 'utf8')))
    .sort();
}

describe('fix-584 §B2 — every OCC write goes through the registry', () => {
  it('★★ the census finds the hooks at all (it would pass vacuously otherwise)', () => {
    // 37 when this was written. A floor, not an equality: a new OCC hook must
    // not have to edit this number, only satisfy the rule below.
    expect(occWriteHooks().length).toBeGreaterThanOrEqual(35);
  });

  it('★★★ …and every one of them imports the queue', () => {
    // ★★★ THIS IS THE ASSERTION THAT MAKES IT THE LAST TIME. Four surfaces have
    //     been fixed four different ways; a fifth patch would be a promise to be
    //     here again. An OCC write added outside the registry fails HERE, on the
    //     day it is written — proved by adding one, see the test below.
    const offenders = occWriteHooks().filter(
      (f) => !/from '\.\.\/lib\/occQueue'/.test(
        readFileSync(resolve(process.cwd(), 'src/hooks', f), 'utf8'),
      ),
    );
    expect(offenders, 'OCC writes outside the registry').toEqual([]);
  });

  it('★★★ …and every one of them actually CALLS it, not just imports it', () => {
    // ★ An unused import satisfies a grep and nothing else.
    const offenders = occWriteHooks().filter((f) => {
      const src = strip(readFileSync(resolve(process.cwd(), 'src/hooks', f), 'utf8'));
      return !/occSerialize\(|occCall\(/.test(src);
    });
    expect(offenders, 'imports the queue but never uses it').toEqual([]);
  });

  it('★★★ the census FAILS on a write added outside the registry — proved, not assumed', () => {
    // ★★★ A guard nobody has seen fail is a guard nobody knows works. This
    //     synthesises the exact file a future ticket would add: an OCC token on
    //     the wire, no queue.
    const rogue = `
      import { occToken } from '../lib/occ';
      export function useWriteSomethingNew() {
        return supabase.rpc('bp_upsert_whatever_row', {
          p_id: id, p_expected_updated_at: occToken(row.updated_at),
        });
      }`;
    const importsQueue = /from '\.\.\/lib\/occQueue'/.test(rogue);
    const usesQueue = /occSerialize\(|occCall\(/.test(strip(rogue));
    const isOccWrite = /\boccToken\(/.test(rogue);
    expect(isOccWrite).toBe(true);
    expect(importsQueue).toBe(false);
    expect(usesQueue).toBe(false);
    // …so it would land in `offenders` in both tests above.
  });

  it('★★ the three previously-patched surfaces are among them', () => {
    const hooks = occWriteHooks();
    for (const f of [
      'useUpdateProject.ts', // fix-532 §B / fix-584 — Gena and Cam
      'useTeamTasks.ts', // fix-580 — Brittani
      'useUpsertDaTimeBlock.ts', // fix-581 — Miles and Dave
    ]) {
      expect(hooks, f).toContain(f);
    }
  });
});

// ---------------------------------------------------------------------------
// §B3 · THE EARLIER CACHE READS ARE KEPT, DELIBERATELY
// ---------------------------------------------------------------------------
//
// ★★★ THEY ARE NOW A SECOND BELT, NOT THE BUCKLE — and they are kept rather
//     than removed, which is a choice and is stated as one:
//
//     · The cache read is what makes the SEED right, and the seed is what the
//       FIRST write of a burst posts. The queue has nothing to hand it.
//     · It is also what a follower falls back to when its predecessor publishes
//       `undefined` (an RPC that returns counts, not a row).
//
//     Removing them would leave both of those on a render-captured prop, which
//     is the bug fix-532 §B and fix-581 were written to remove.

describe('fix-584 §B3 — the cache reads stay, as the seed', () => {
  it('★★★ fix-532 §B\'s reader is still there and still feeds the seed', () => {
    const src = strip(read('src/hooks/useUpdateProject.ts'));
    expect(src).toContain('freshestProjectToken(');
    expect(src).toMatch(/occSerialize\(\s*occRowKey\('projects', input\.projectId\),\s*token,/);
  });

  it('★★★ fix-581\'s reader is still there and still feeds the seed', () => {
    const src = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(src).toContain('currentBlockToken(');
    expect(src).toContain('occSerialize(');
  });

  it('★★ no server guard moved — no RPC body is touched by this ticket', () => {
    // fix-73's rule: the guard is right about the row and wrong about the cause.
    const src = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(src).toContain('bp_upsert_da_time_block_row');
    expect(src).not.toContain('p_force');
  });
});

// ---------------------------------------------------------------------------
// §A · A VALIDATION MESSAGE IS NOT AN ERROR
// ---------------------------------------------------------------------------

const toastMocks = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('../lib/errorLogger', async (importActual) => {
  const actual = await importActual<typeof import('../lib/errorLogger')>();
  return { ...actual, logError: toastMocks.logError };
});

import { pushToast, pushValidationToast, useToastStore } from '../stores/toastStore';

describe('fix-584 §A — classified at the throw site, never by message text', () => {
  beforeEach(() => {
    toastMocks.logError.mockClear();
    useToastStore.getState().clear();
  });

  it('★★★ a validation refusal shows a toast and reports NOTHING', () => {
    // Prod #737's exact message, Cam, /library.
    pushValidationToast('Unit size: enter a whole number between 0 and 2147483647.');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(toastMocks.logError).not.toHaveBeenCalled();
  });

  it('★★★ …and a REAL failure still reports — the other direction', () => {
    // ⚠️ A rule that suppressed both would hide the defects triage exists for.
    pushToast('Could not save project — Failed to fetch', 'error');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(toastMocks.logError).toHaveBeenCalledTimes(1);
  });

  it('★★★ the rule does not read the MESSAGE — identical text, opposite outcomes', () => {
    // ★★★ THE POINT OF CLASSIFYING AT THE THROW SITE. The same string reported
    //     through the two paths behaves differently, so nothing here can rot
    //     when somebody rewords a label.
    const SAME = 'Unit size: enter a whole number between 0 and 2147483647.';
    pushValidationToast(SAME);
    expect(toastMocks.logError).not.toHaveBeenCalled();
    pushToast(SAME, 'error');
    expect(toastMocks.logError).toHaveBeenCalledTimes(1);
  });

  it('★★ the three deliberate client refusals use it', () => {
    for (const [file, n] of [
      ['src/components/LibraryEditCell.tsx', 2],
      ['src/components/ProjectDetail/PlanOfRecordCard.tsx', 1],
    ] as const) {
      const src = strip(read(file));
      expect((src.match(/pushValidationToast\(/g) ?? []).length, file).toBe(n);
    }
  });

  it('★★ fix-165\'s mechanism is reused, not replaced', () => {
    // `{ log: false }` and SQLSTATE 22008 both still work; this names the
    // client half so the next validator does not have to remember an options
    // bag. The chronology rows it suppresses stopped on 2026-06-15 and there
    // are zero since — measured on prod 2026-09-16.
    const src = strip(read('src/stores/toastStore.ts'));
    expect(src).toContain("{ log: false }");
    expect(src).toContain('export function pushValidationToast');
  });
});
