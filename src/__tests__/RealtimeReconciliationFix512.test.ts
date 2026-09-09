import { describe, it, expect } from 'vitest';
import { REALTIME_TABLES } from '../lib/queryKeys';

// ===========================================================================
// fix-512 §C (P-205) — THE REALTIME INVARIANT, CHECKED IN BOTH DIRECTIONS
// ===========================================================================
//
// Two tickets found the same invariant broken, one from each end, eight days
// apart, and neither test could have caught the other's bug:
//
//   fix-336 / fix-393  A table in `REALTIME_TABLES` that is NOT in the
//                      publication. The channel joins, the handler registers,
//                      and it never fires. fix-393 banked the rule —
//                      *"adding a key here is half the job"* — and asserted it.
//
//   fix-511            A table in the publication with NO `REALTIME_TABLES`
//                      entry. Postgres emits every change to a channel nobody
//                      is on. `da_time_blocks` sat like that and surfaced,
//                      eleven days later, as an OCC bug on the draw schedule:
//                      a second tab never learned the token its own neighbour
//                      row had already learned.
//
// ★★★ AN INVARIANT WITH TWO DIRECTIONS MUST BE CHECKED IN BOTH. A one-way
// assertion does not half-protect you — it protects you fully against the half
// somebody happened to think of first, and silently not at all against the
// other, which is why the second direction went eleven days undetected under a
// test suite that already had 8,000 assertions in it.
//
// ---------------------------------------------------------------------------
// ★★ WHY THE MEMBERSHIP IS RECORDED HERE RATHER THAN QUERIED
// ---------------------------------------------------------------------------
// The brief asks this to assert against prod's real membership rather than a
// copy that drifts. **CI has no database** ([[project_no_live_db_test_mirror]]),
// so a live query is not available to it, and this is the same answer fix-153
// settled on: a recorded read, dated, with the exact SQL that produced it, so
// refreshing it is mechanical and reviewable rather than remembered.
//
// ★ The drift this leaves is real and worth naming: this list going stale is
//   now the failure mode, in place of the invariant going unchecked. It is the
//   better of the two — a stale list fails LOUD the moment a key is added on
//   either side, where the old state failed silent forever — but the next
//   person to touch realtime should re-run the query below rather than trust
//   the date.
//
// READ FROM PROD `eibnmwthkcuumyclyxoe` ON 2026-09-09:
//
//   select c.relname
//   from pg_publication_rel pr
//   join pg_publication p on p.oid = pr.prpubid
//   join pg_class c on c.oid = pr.prrelid
//   join pg_namespace n on n.oid = c.relnamespace
//   where p.pubname = 'supabase_realtime' and n.nspname = 'public'
//   order by 1;
//
// 42 rows.

/** Members of `supabase_realtime` on prod, 2026-09-09. See the SQL above. */
export const PUBLICATION_MEMBERS_2026_09_09 = [
  'app_config',
  'audit_log',
  'board_item_reads',
  'da_time_blocks',
  'dm_da_groups',
  'draw_schedule',
  'draw_schedule_quarter_layout',
  'error_reports',
  'external_team_directory',
  'intake_records',
  'jurisdictions',
  'legacy_app_config',
  'legacy_builders',
  'legacy_draw_schedule',
  'legacy_draw_schedule_blocks',
  'legacy_intake_data',
  'legacy_project_data',
  'legacy_task_templates',
  'message_reactions',
  'notes',
  'permit_conditions',
  'permit_cycle_reviewers',
  'permit_cycles',
  'permit_holds',
  'permit_milestone_acks',
  'permit_schedule_overrides',
  'permit_task_auto_closures',
  'permit_tasks',
  'permit_types',
  'permits',
  'post_requests',
  'project_documents',
  'project_holds',
  'project_messages',
  'projects',
  'task_subtasks',
  'task_template_subtasks',
  'task_templates',
  'team_members',
  'vendor_report_state',
  'whats_new_entries',
  'whats_new_reads',
] as const;

// ---------------------------------------------------------------------------
// ★★★ THE ALLOW-LIST — PUBLISHED ON PURPOSE, SUBSCRIBED BY NOBODY
// ---------------------------------------------------------------------------
//
// Every entry needs a REASON, not just a name. An allow-list without reasons is
// a list somebody appends to in order to make a test go green, which is how
// `da_time_blocks` would have got in.
//
// ★★ THE TWO GROUPS ARE NOT THE SAME KIND OF FINE.
//
//   (a) NO CLIENT READER AT ALL — publishing these is pure wire noise, exactly
//       fix-393's `builders` finding ("publishing events nobody consumes is the
//       same lie in the other direction"). Nothing can go stale because nothing
//       reads them. The right end state is UNPUBLISHING, not subscribing.
//
//   (b) A READER, BUT NOTHING THAT CARRIES A TOKEN. These are registries and
//       templates: read once at mount, edited by an admin in Settings, and
//       nothing derived from them is written back under an OCC check. Staleness
//       here costs a refresh, not an edit. `da_time_blocks` was NOT this — the
//       grid reads an `updated_at` off its rows and hands it back to the
//       server, which is what turned eleven quiet days into a refused save.
//
// ★ So the question to ask of any new entry is not "does this change often?"
//   but **"does anything read a value off this row and send it back?"**
const PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE: Record<string, string> = {
  // --- (a) no client reader ------------------------------------------------
  permit_schedule_overrides:
    'No reader. The schedule cycle override lives in `permits.extras.scheduleCycleOverride` — this table is named only in useDeletePermit’s cascade comment.',
  project_documents:
    'No reader. Named only in useDeleteProject’s cascade comment; the plan of record is fetched through its own path.',
  task_subtasks:
    'No reader and no query key. Appears once in src, in exportBackup’s table list.',

  // --- (b) a reader, but nothing that carries a token -----------------------
  app_config:
    'Registry (useAppConfig). Admin-edited in Settings, read at mount; nothing writes a value read off it back under OCC.',
  jurisdictions: 'Registry (useJurisdictions). Same shape as app_config.',
  permit_types: 'Registry (usePermitTypes). Same shape as app_config.',
  task_templates:
    'Settings-owned templates (useTaskTemplates). A stale template costs a refresh before minting tasks, not a refused save.',
  task_template_subtasks: 'The child rows of task_templates, same reasoning.',

  // --- P-036 ---------------------------------------------------------------
  // ★ SEEN IN THE SAME READ AND NOT THIS TICKET'S JOB. Seven `legacy_*` backup
  //   tables are in the publication, replicating for nobody — WAL traffic and a
  //   replica-identity obligation for tables the app has not read since the
  //   import. Noted in the fix-512 PR for
  //   [[P-036-prod-housekeeping-backup-tables]]; unpublishing them is a prod
  //   write and is not in scope here.
  legacy_app_config: 'P-036 backup table.',
  legacy_builders: 'P-036 backup table.',
  legacy_draw_schedule: 'P-036 backup table.',
  legacy_draw_schedule_blocks: 'P-036 backup table.',
  legacy_intake_data: 'P-036 backup table.',
  legacy_project_data: 'P-036 backup table.',
  legacy_task_templates: 'P-036 backup table.',
};

const subscribed = Object.keys(REALTIME_TABLES);
const published: readonly string[] = PUBLICATION_MEMBERS_2026_09_09;

describe('fix-512 §C — REALTIME_TABLES and supabase_realtime reconcile', () => {
  it('the two sets were actually read (neither is empty or a stub)', () => {
    expect(subscribed.length).toBeGreaterThan(20);
    expect(published.length).toBe(42);
    expect(new Set(published).size).toBe(published.length);
  });

  it('★★★ DIRECTION 1 (fix-393): every subscribed table is published', () => {
    // A subscription to an unpublished table raises no error and logs nothing:
    // the channel joins, the handler registers, and it never fires.
    const missing = subscribed.filter((t) => !published.includes(t));
    expect(
      missing,
      `subscribed but NOT in supabase_realtime — these handlers can never fire: ${missing.join(', ')}. Add "ALTER PUBLICATION supabase_realtime ADD TABLE" in the SAME PR.`,
    ).toEqual([]);
  });

  it('★★★ DIRECTION 2 (fix-511): every published table is subscribed, or allow-listed WITH A REASON', () => {
    // This is the direction that had no test. `da_time_blocks` sat here for
    // eleven days and surfaced as an OCC bug, not as a freshness complaint.
    const orphans = published.filter(
      (t) => !subscribed.includes(t) && !(t in PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE),
    );
    expect(
      orphans,
      `published to supabase_realtime with NO REALTIME_TABLES entry — Postgres is emitting these to nobody: ${orphans.join(', ')}. Either add a key in lib/queryKeys, or add it to PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE with a reason. Ask: does anything read a value off this row and send it back?`,
    ).toEqual([]);
  });

  it('★★★ …and `da_time_blocks` is the regression this direction exists for', () => {
    // The exact table fix-511 found. It must be on BOTH sides and must NOT be
    // allow-listed — the grid reads an `updated_at` off its rows and hands it
    // back to the server, which is the property the allow-list must never cover.
    expect(published).toContain('da_time_blocks');
    expect(subscribed).toContain('da_time_blocks');
    expect(PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE).not.toHaveProperty('da_time_blocks');
  });

  it('★★ the allow-list carries no dead entries', () => {
    // An allow-list that outlives its tables is how the next real orphan gets
    // waved through by a name nobody recognises.
    for (const t of Object.keys(PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE)) {
      expect(published, `${t} is allow-listed but is not in the publication`).toContain(t);
      expect(
        subscribed,
        `${t} is allow-listed AND subscribed — remove it from the allow-list`,
      ).not.toContain(t);
    }
  });

  it('★★ every allow-list entry gives a reason, not just a name', () => {
    for (const [t, why] of Object.entries(PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE)) {
      expect(why.length, `${t} has no reason`).toBeGreaterThan(15);
    }
  });

  it('★ the seven P-036 legacy tables are named, so the housekeeping is not lost', () => {
    const legacy = published.filter((t) => t.startsWith('legacy_'));
    expect(legacy).toHaveLength(7);
    for (const t of legacy) {
      expect(PUBLISHED_BUT_UNSUBSCRIBED_ON_PURPOSE[t]).toContain('P-036');
    }
  });
});
