import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_381_cr_threads.sql?raw';
import backfillSql from '../../migrations/fix_381_backfill_PENDING_APPROVAL.sql?raw';

// ===========================================================================
// fix-381 — every project gets a correction round, and a thread waiting for it
// ===========================================================================
//
// Bobby: "add a CR 1 — this is for correction cycle 1. We always know we're
// going to have at least one correction cycle... Any new project should have a
// Preliminary Assessment, a Design Phase, ACQ Questions, and then a CR 1
// folder." And on later rounds: "yes, but only for a building permit CR 2 etc."
//
// ★ The file explains itself at length, so every "the SQL does not say X"
// assertion has to read the CODE and not the prose — the trap fix-369, fix-371
// and fix-372 each hit once.
const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');
//
// No live DB in CI (fix-153 / fix-220 / fix-244 / fix-368 / fix-377 / fix-382
// precedent), so this is a pure-TS mirror of the seed plus the cycle trigger,
// alongside a documented ROLLED-BACK prod probe.
//
// ---------------------------------------------------------------------------
// ★★★ THE MAPPING, PROVED ON A REAL PERMIT — prod permit 168, BLDG-2026-02118,
// a Building Permit whose corr_rounds reads 3:
//
//   cycle 0  submitted 2026-03-27  corr_issued NULL    <- design, no thread
//   cycle 1  submitted 2026-05-12  corr_issued 06-09   -> CR 1
//   cycle 2  submitted 2026-06-29  corr_issued 07-14   -> CR 2
//   cycle 3  submitted 2026-07-21  corr_issued 07-23   -> CR 3
//   cycle 4  submitted 2026-07-29  corr_issued NULL    <- open, no thread yet
//
// permit_cycles.cycle_index N -> 'CR N' for N >= 1; cycle 0 never mints. This
// is the axis fix-40's bp_compute_corr_rounds already counts on
// ("cycle_index >= 1 AND corr_issued IS NOT NULL"), and the three corr_issued
// rounds match corr_rounds = 3 exactly.
//
// ---------------------------------------------------------------------------
// PROD PROBE — 2026-08-22, prod eibnmwthkcuumyclyxoe, ROLLED BACK by
// RAISE EXCEPTION. Every line below was observed, not predicted:
//
//   A/ new project threads: ACQ Questions | Design Phase | Preliminary
//      Assessment | CR 1        (created_at order, four of them)
//      re-seed made 0 more; total roots still 4
//   B/ two BUILDING PERMITS on one project both reaching cycle 2 -> CR 2
//      count = 1
//   C/ a ULS reaching cycle 3 -> CR 3 count = 0
//   D/ a building permit's cycle 0 -> CR 0 count = 0
//   E/ the minted CR 2 row: author_id = NULL, mentions = {}
//   F/ a hand-made CR 1 whose body was replaced, then a BP cycle-1 correction:
//      count = 1, body still 'HAND WRITTEN - DO NOT TOUCH'
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mirror of the SQL
// ---------------------------------------------------------------------------

interface Thread {
  project_id: string;
  title: string;
  body: string;
  author_id: string | null;
  mentions: string[];
  ord: number;
}
interface Permit {
  id: number;
  project_id: string;
  type: string;
}
interface Db {
  projects: string[];
  permits: Permit[];
  threads: Thread[];
}

/** public.bp_cr_thread_body(round) */
function crBody(round: number): string {
  return round <= 1
    ? 'The first round of city corrections — what came back, and who is clearing what.'
    : `Round ${round} of city corrections — what came back, and who is clearing what.`;
}

/** public.bp_ensure_cr_thread(project, round) — returns rows written. */
function ensureCrThread(db: Db, projectId: string, round: number): number {
  if (round == null || round < 1) return 0; // cycle 0 is design
  if (!db.projects.includes(projectId)) return 0;
  const title = `CR ${round}`;
  // The NOT EXISTS title check. (The advisory lock in the SQL is what makes
  // this safe against a SECOND transaction; within one writer it is this.)
  if (
    db.threads.some((t) => t.project_id === projectId && t.title === title)
  ) {
    return 0;
  }
  db.threads.push({
    project_id: projectId,
    title,
    body: crBody(round),
    author_id: null, // ★ machine-minted, never the person who saved the date
    mentions: [],
    ord: db.threads.length,
  });
  return 1;
}

const SEEDS: [number, string, string][] = [
  [1, 'ACQ Questions', 'Anything acquisitions — questions for the ACQ team live here.'],
  [2, 'Design Phase', 'Design through intake: drawings, consultants, and the submittal set.'],
  [3, 'Preliminary Assessment', "The city's initial comments on what we are submitting."],
  [4, 'CR 1', crBody(1)],
];

/** public.bp_seed_project_posts(project) — returns rows written. */
function seedProjectPosts(db: Db, projectId: string, author: string | null): number {
  if (!db.projects.includes(projectId)) return 0;
  let made = 0;
  for (const [ord, title, body] of SEEDS) {
    if (db.threads.some((t) => t.project_id === projectId && t.title === title)) {
      continue; // idempotent by existence
    }
    db.threads.push({
      project_id: projectId,
      title,
      body,
      author_id: author,
      mentions: [],
      ord,
    });
    made += 1;
  }
  return made;
}

/** The permit_cycles trigger: corr_issued lands on cycle N. */
function corrIssued(db: Db, permitId: number, cycleIndex: number): void {
  if (cycleIndex == null || cycleIndex < 1) return; // cycle 0 never mints
  const permit = db.permits.find((p) => p.id === permitId);
  if (!permit) return;
  // ★★★ Bobby: "yes, but only for a building permit CR 2 etc."
  if (permit.type !== 'Building Permit') return;
  ensureCrThread(db, permit.project_id, cycleIndex);
}

function newDb(): Db {
  return { projects: [], permits: [], threads: [] };
}
function createProject(db: Db, id: string, author: string | null = 'creator'): void {
  db.projects.push(id);
  seedProjectPosts(db, id, author); // the projects_seed_posts trigger
}
const titlesOf = (db: Db, p: string) =>
  db.threads.filter((t) => t.project_id === p).map((t) => t.title);

// ---------------------------------------------------------------------------

describe('fix-381 — the seed', () => {
  it('★★★ a new project gets four threads, in a stable order', () => {
    const db = newDb();
    createProject(db, 'p1');
    expect(titlesOf(db, 'p1')).toEqual([
      'ACQ Questions',
      'Design Phase',
      'Preliminary Assessment',
      'CR 1',
    ]);
  });

  it('★★★ the title is exactly "CR 1" — C, R, space, 1', () => {
    const db = newDb();
    createProject(db, 'p1');
    const cr = db.threads.find((t) => t.title.startsWith('CR'))!;
    expect(cr.title).toBe('CR 1');
    expect(cr.title).toMatch(/^CR \d+$/);
  });

  it('★★ re-running the seed cannot duplicate a thread', () => {
    const db = newDb();
    createProject(db, 'p1');
    expect(seedProjectPosts(db, 'p1', 'creator')).toBe(0);
    expect(titlesOf(db, 'p1')).toHaveLength(4);
  });

  it('★★ the three original threads keep their exact bodies', () => {
    const db = newDb();
    createProject(db, 'p1');
    const body = (t: string) =>
      db.threads.find((x) => x.project_id === 'p1' && x.title === t)!.body;
    expect(body('ACQ Questions')).toBe(
      'Anything acquisitions — questions for the ACQ team live here.',
    );
    expect(body('Design Phase')).toBe(
      'Design through intake: drawings, consultants, and the submittal set.',
    );
    expect(body('Preliminary Assessment')).toBe(
      "The city's initial comments on what we are submitting.",
    );
  });

  it('★ a project that already has a hand-made CR 1 keeps it untouched', () => {
    const db = newDb();
    db.projects.push('p1');
    db.threads.push({
      project_id: 'p1',
      title: 'CR 1',
      body: 'HAND WRITTEN - DO NOT TOUCH',
      author_id: 'a-person',
      mentions: [],
      ord: 0,
    });
    seedProjectPosts(db, 'p1', 'creator');
    const cr = db.threads.filter((t) => t.title === 'CR 1');
    expect(cr).toHaveLength(1);
    expect(cr[0].body).toBe('HAND WRITTEN - DO NOT TOUCH');
    expect(cr[0].author_id).toBe('a-person');
  });
});

describe('fix-381 — later rounds mint themselves, building permits only', () => {
  it('★★★ a building permit reaching cycle 2 mints CR 2', () => {
    const db = newDb();
    createProject(db, 'p1');
    db.permits.push({ id: 1, project_id: 'p1', type: 'Building Permit' });
    corrIssued(db, 1, 2);
    expect(titlesOf(db, 'p1')).toContain('CR 2');
  });

  it.each(['ULS', 'SDOT Tree', 'PAR/Pre-Sub', 'ECA Waiver', 'SDCI Land Use'])(
    '★★★ a %s reaching cycle 2 mints nothing',
    (type) => {
      const db = newDb();
      createProject(db, 'p1');
      db.permits.push({ id: 1, project_id: 'p1', type });
      corrIssued(db, 1, 2);
      expect(titlesOf(db, 'p1')).not.toContain('CR 2');
      expect(titlesOf(db, 'p1')).toHaveLength(4); // the seed, untouched
    },
  );

  it('★★★ two building permits on ONE project both reaching cycle 2 produce ONE thread', () => {
    const db = newDb();
    createProject(db, 'p1');
    db.permits.push(
      { id: 1, project_id: 'p1', type: 'Building Permit' },
      { id: 2, project_id: 'p1', type: 'Building Permit' },
    );
    corrIssued(db, 1, 2);
    corrIssued(db, 2, 2);
    expect(db.threads.filter((t) => t.project_id === 'p1' && t.title === 'CR 2'))
      .toHaveLength(1);
  });

  it('★ cycle 0 never mints a thread', () => {
    const db = newDb();
    createProject(db, 'p1');
    db.permits.push({ id: 1, project_id: 'p1', type: 'Building Permit' });
    corrIssued(db, 1, 0);
    expect(titlesOf(db, 'p1')).not.toContain('CR 0');
    expect(titlesOf(db, 'p1')).toHaveLength(4);
  });

  it('★★ successive rounds each get their own thread, numbered by cycle_index', () => {
    const db = newDb();
    createProject(db, 'p1');
    db.permits.push({ id: 168, project_id: 'p1', type: 'Building Permit' });
    // prod permit 168: cycles 1, 2, 3 carried a corr_issued; 0 and 4 did not.
    corrIssued(db, 168, 1);
    corrIssued(db, 168, 2);
    corrIssued(db, 168, 3);
    expect(titlesOf(db, 'p1')).toEqual([
      'ACQ Questions',
      'Design Phase',
      'Preliminary Assessment',
      'CR 1',
      'CR 2',
      'CR 3',
    ]);
    // CR 1 came from the seed, so the trigger's round 1 added nothing.
    expect(db.threads.filter((t) => t.title === 'CR 1')).toHaveLength(1);
  });

  it('★★ a project with no CR 1 yet gets one when its BP hits round 1', () => {
    const db = newDb();
    db.projects.push('old'); // predates the seeding trigger — no threads
    db.permits.push({ id: 1, project_id: 'old', type: 'Building Permit' });
    corrIssued(db, 1, 1);
    expect(titlesOf(db, 'old')).toEqual(['CR 1']);
  });
});

describe('fix-381 — a minted thread notifies nobody', () => {
  // fix-360's model: an item exists only if the viewer is MENTIONED. The
  // notification path never looks at author_id —
  // useProjectMessages.ts:114-125 filters .contains('mentions',[userId]) and
  // boardReads.ts:479 re-checks `if (!(m.mentions ?? []).includes(meId))`.
  const mentionsMe = (t: Thread, me: string) => (t.mentions ?? []).includes(me);

  it('★★ a trigger-minted thread has no author and no mentions', () => {
    const db = newDb();
    createProject(db, 'p1');
    db.permits.push({ id: 1, project_id: 'p1', type: 'Building Permit' });
    corrIssued(db, 1, 2);
    const cr2 = db.threads.find((t) => t.title === 'CR 2')!;
    expect(cr2.author_id).toBeNull();
    expect(cr2.mentions).toEqual([]);
  });

  it('★★ no user is notified by any seeded or minted thread', () => {
    const db = newDb();
    createProject(db, 'p1');
    db.permits.push({ id: 1, project_id: 'p1', type: 'Building Permit' });
    corrIssued(db, 1, 2);
    corrIssued(db, 1, 3);
    for (const me of ['creator', 'someone-else', 'a-third-person']) {
      expect(db.threads.filter((t) => mentionsMe(t, me))).toHaveLength(0);
    }
  });

  it('★ the body is the same words whether the seed or the trigger wrote CR 1', () => {
    const seeded = newDb();
    createProject(seeded, 'p1');
    const viaSeed = seeded.threads.find((t) => t.title === 'CR 1')!.body;

    const minted = newDb();
    minted.projects.push('p2');
    minted.permits.push({ id: 1, project_id: 'p2', type: 'Building Permit' });
    corrIssued(minted, 1, 1);
    const viaTrigger = minted.threads.find((t) => t.title === 'CR 1')!.body;

    expect(viaSeed).toBe(viaTrigger);
  });
});

// ---------------------------------------------------------------------------
// The SQL says what the mirror says
// ---------------------------------------------------------------------------

describe('fix-381 — the migration itself', () => {
  it('★★★ CR 1 is the fourth seed, and the three originals are unchanged', () => {
    const seeds = [...sqlCode.matchAll(/\((\d), '([^']+)',/g)].map((m) => [
      Number(m[1]),
      m[2],
    ]);
    expect(seeds).toEqual([
      [1, 'ACQ Questions'],
      [2, 'Design Phase'],
      [3, 'Preliminary Assessment'],
      [4, 'CR 1'],
    ]);
  });

  it('★★★ later rounds are gated on Building Permit', () => {
    expect(sqlCode).toContain("v_type IS DISTINCT FROM 'Building Permit'");
    // and the gate returns without minting
    const gate = sqlCode.slice(sqlCode.indexOf("v_type IS DISTINCT FROM"));
    expect(gate.slice(0, 80)).toMatch(/RETURN NULL/);
  });

  it('★★★ cycle 0 is excluded, in both the trigger and the ensure function', () => {
    expect(sqlCode).toContain('NEW.cycle_index < 1');
    expect(sqlCode).toContain('p_round < 1');
  });

  it('★★ one thread per project per round: existence check AND advisory lock', () => {
    expect(sqlCode).toContain('pg_advisory_xact_lock');
    const ensure = sqlCode.slice(sqlCode.indexOf('bp_ensure_cr_thread'));
    expect(ensure).toContain('WHERE NOT EXISTS');
    expect(ensure).toContain('m.parent_message_id IS NULL');
    expect(ensure).toContain('m.title = v_title');
  });

  it('★★ the trigger-minted thread is written with a NULL author', () => {
    const ensure = sqlCode.slice(sqlCode.indexOf('bp_ensure_cr_thread'));
    const insert = ensure.slice(ensure.indexOf('INSERT INTO public.project_messages'));
    expect(insert).toContain('NULL::uuid');
    // and never invents a mention
    expect(insert).not.toMatch(/mentions/);
  });

  it('★★★ it does not wire chat threads to correction data', () => {
    // fix-372's clustering reads correction_items; a CR thread is a
    // conversation, not a correction record.
    expect(sqlCode).not.toMatch(/correction_items/i);
    expect(sqlCode).not.toMatch(/corr_rounds/i);
  });

  it('★★ the trigger fires on corr_issued only, and not on a restated value', () => {
    expect(sqlCode).toContain('AFTER INSERT ON public.permit_cycles');
    expect(sqlCode).toContain('AFTER UPDATE OF corr_issued ON public.permit_cycles');
    expect(sqlCode).toContain('NEW.corr_issued IS DISTINCT FROM OLD.corr_issued');
  });

  it('★★★ no row is edited by the migration', () => {
    // Every write lives inside a function or is a trigger definition; there is
    // no bare DML at the top level.
    const topLevel = sqlCode
      .split(/\$function\$/)
      .filter((_, i) => i % 2 === 0)
      .join('\n');
    expect(topLevel).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(topLevel).not.toMatch(/\bUPDATE\s+public\./i);
    expect(topLevel).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('★ anon cannot execute the new functions (fix-157 posture)', () => {
    expect(sqlCode).toMatch(/REVOKE ALL ON FUNCTION public\.bp_ensure_cr_thread.*anon/);
    expect(sqlCode).toMatch(/GRANT EXECUTE ON FUNCTION public\.bp_ensure_cr_thread.*authenticated/);
  });
});

describe('fix-381 — the backfill is NOT applied', () => {
  it('★★★ every statement in the backfill file is commented out', () => {
    const live = backfillSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
  });

  it('★★★ it says plainly that it has not been run', () => {
    expect(backfillSql).toContain('NOT APPLIED');
    expect(backfillSql).toContain('HAS NOT BEEN RUN AGAINST ANY DATABASE');
  });

  it('★★ it records that the brief\'s population did not reproduce', () => {
    // 183/88 only matches the all-types population; Bobby's literal wording
    // (a live BUILDING PERMIT with no corrections) is 30 permits / 24 projects.
    expect(backfillSql).toContain('THE BRIEF\'S NUMBERS DID NOT REPRODUCE');
    expect(backfillSql).toMatch(/24 PROJECTS/);
    expect(backfillSql).toMatch(/TWENTY-SEVEN PROJECTS HAVE NO THREADS AT ALL/);
  });

  it('★ it is per project, and says so', () => {
    expect(backfillSql).toContain('per PROJECT, not per permit');
    const listed = [...backfillSql.matchAll(
      /^--\s{3}\S.*\s([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/gm,
    )];
    expect(listed).toHaveLength(87);
  });
});
