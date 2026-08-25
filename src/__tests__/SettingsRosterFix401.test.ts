import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_401_publish_roster_realtime.sql?raw';
import adminTeamSource from '../components/Settings/AdminTeamTab.tsx?raw';
import adminProjectsSource from '../components/Settings/AdminProjectsTab.tsx?raw';
import queryKeysSource from '../lib/queryKeys.ts?raw';
import teamStructureSource from '../components/Settings/TeamStructureEditor.tsx?raw';
import upsertHookSource from '../hooks/useUpsertDmDaGroup.ts?raw';
import quarterLayoutHookSource from '../hooks/useQuarterLayout.ts?raw';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';
import { allRealtimeKeys } from '../hooks/useRealtimeInvalidation';
import { ACQ_ROLES, isCurrentMember } from '../lib/roster';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// fix-401 — the settings screen rendered a roster the rest of the app
//           stopped believing
// ===========================================================================
//
// Bobby, 2026-08-25:
//
//   "The settings UI is not rendering accurately, specifically our draw
//    schedule. Eric has now moved teams to Derry and no longer under Jade. So I
//    don't know if our UI is updating when we're making these updates back to
//    the settings … I noticed that acquisitions is only showing like Kiley and
//    Jesse. It's not showing Dom, Jason, Scott, any of them … we just really
//    want to make sure that this thing is holistically and globally reflecting
//    as a true ecosystem."
//
// ★★★ TWO INDEPENDENT ASYMMETRIES, both measured on prod 2026-08-25:
//
//   1. THE ACQUISITIONS LIST asked a NARROWER question than the app it
//      configures. Settings read `role === 'acq'` (2 people: Jessie, Keelie —
//      exactly the two he could see) while every picker that offers
//      acquisitions reads `acq` ∪ `acq_lead` (8 people; Dom, Jason and Scott
//      are all `acq_lead`). The data was never wrong.
//
//   2. THE ROSTER TABLES REACHED NOBODY. Thirty files read `dm_da_groups`, and
//      none of the three roster tables was in REALTIME_TABLES — so a team move
//      invalidated one query key in one tab, and the fallback poll could not
//      cover it either, because `allRealtimeKeys()` is DERIVED from that map.

// ---------------------------------------------------------------------------
// §1 · THE ACQUISITIONS LIST
// ---------------------------------------------------------------------------

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: 'm-1',
    name: 'Someone',
    role: 'acq_lead',
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '',
    ...over,
  } as unknown as TeamMember;
}

/** The exact selector `useTeamMembers` now applies to build `acqs`. Asserted
 *  here rather than through the hook so the RULE is pinned without mounting a
 *  QueryClient — the hook is a thin wrapper over this one line. */
const acqsOf = (all: TeamMember[]) =>
  all.filter((m) => ACQ_ROLES.has(m.role) && isCurrentMember(m));

describe('fix-401 §1: Acquisitions renders the roster, not one role string', () => {
  it('★★★ the prod shape — Dom, Jason and Scott appear beside Jessie and Keelie', () => {
    // The real roster on 2026-08-25: 2 `acq`, 6 `acq_lead` (one inactive).
    const roster = [
      member({ id: '1', name: 'Jessie', role: 'acq' }),
      member({ id: '2', name: 'Keelie', role: 'acq' }),
      member({ id: '3', name: 'Dom', role: 'acq_lead' }),
      member({ id: '4', name: 'Jason', role: 'acq_lead' }),
      member({ id: '5', name: 'Scott', role: 'acq_lead' }),
      member({ id: '6', name: 'Jake', role: 'acq_lead' }),
      member({ id: '7', name: 'Jeremy', role: 'acq_lead' }),
      member({ id: '8', name: 'Caleb', role: 'acq_lead', active: false }),
    ];
    const names = acqsOf(roster).map((m) => m.name).sort();
    // ★ The three Bobby named, by name — the whole complaint in one line.
    expect(names).toContain('Dom');
    expect(names).toContain('Jason');
    expect(names).toContain('Scott');
    // ★ ...and the two he could already see are still there.
    expect(names).toContain('Jessie');
    expect(names).toContain('Keelie');
    // ★★ Caleb is inactive and stays out — `isCurrentMember` is the ONE
    // membership rule (fix-321), the same one activeDas and every picker use.
    expect(names).not.toContain('Caleb');
    expect(names).toHaveLength(7);
  });

  it('★★★ a NEW active acq_lead appears with no code change', () => {
    const before = acqsOf([member({ id: '1', name: 'Jessie', role: 'acq' })]);
    const after = acqsOf([
      member({ id: '1', name: 'Jessie', role: 'acq' }),
      member({ id: '9', name: 'Brand New', role: 'acq_lead' }),
    ]);
    expect(before.map((m) => m.name)).toEqual(['Jessie']);
    expect(after.map((m) => m.name)).toContain('Brand New');
  });

  it('★★ the set is the SAME one the pickers use — not a third variation', () => {
    expect([...ACQ_ROLES].sort()).toEqual(['acq', 'acq_lead']);
  });

  it('★★★ and the WRITE widened with the read — or the buttons would lie', () => {
    // Widening the read alone would leave `hardDelete('acq', 'Dom')` looking up
    // role `acq`, finding nothing, and silently doing nothing: a button that
    // appears to work and does not. That is the same asymmetry one layer down,
    // which is exactly the class of bug this ticket is about.
    //
    // ★ fix-403 GENERALISED the lookup — the ENT family joined it, so the row
    //   filter now reads `family.has(m.role)` where the family is chosen from
    //   the role. The CLAIM is unchanged and is still what is asserted: the
    //   write path resolves through the acq FAMILY, not through one role
    //   string. (fix-403's own suite covers the ENT half and the dedupe.)
    expect(adminTeamSource).toContain('ACQ_ROLES.has(role)');
    expect(adminTeamSource).toContain('family.has(m.role)');
  });
});

// ---------------------------------------------------------------------------
// §2 · THE ROSTER REACHES THE ECOSYSTEM
// ---------------------------------------------------------------------------

const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

/** ★ Strip TS/JSX comments. Several of these files EXPLAIN the very trap being
 *  asserted on and name the offending table to do it, so a raw-text assertion
 *  would match the explanation — the trap fix-387/390/397 all hit. */
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const ROSTER_TABLES = [
  'dm_da_groups',
  'team_members',
  'draw_schedule_quarter_layout',
] as const;

describe('fix-401 §2: a settings edit reaches every open tab', () => {
  it('★★★ all three roster tables are subscribed', () => {
    for (const t of ROSTER_TABLES) {
      expect(REALTIME_TABLES, t).toHaveProperty(t);
    }
  });

  it('★★★ each maps to the BARE prefix, so every scoped query under it refreshes', () => {
    // `useDmDaGroups` keys on ['dm_da_groups', tenantId]; the realtime handler
    // invalidates ['dm_da_groups'], which prefix-matches it and every other
    // consumer's scoped key. A tenant-scoped mapping here would refresh nothing.
    expect(REALTIME_TABLES.dm_da_groups).toEqual([queryKeys.dmDaGroupsAll]);
    expect(REALTIME_TABLES.team_members).toEqual([queryKeys.teamMembersAll]);
    expect(REALTIME_TABLES.draw_schedule_quarter_layout).toEqual([
      queryKeys.drawScheduleQuarterLayoutAll,
    ]);
    for (const t of ROSTER_TABLES) {
      expect(REALTIME_TABLES[t][0]!.length, `${t} must be a bare prefix`).toBe(1);
    }
  });

  it('★★★ …which ALSO puts them on fix-371\'s fallback poll', () => {
    // The half that made this look like a mystery rather than a gap:
    // `allRealtimeKeys()` is derived from REALTIME_TABLES, so a table missing
    // from the map was missing from the SLOW path too. There was no eventual
    // consistency to fall back on — only a reload fixed it.
    const all = allRealtimeKeys().map((k) => JSON.stringify(k));
    for (const t of ROSTER_TABLES) {
      expect(all, t).toContain(JSON.stringify(REALTIME_TABLES[t][0]));
    }
  });

  it('★★★ fix-393\'s lesson IN MIRROR IMAGE — check BOTH halves', () => {
    // fix-393: "adding a REALTIME_TABLES key is half the job; publish the table
    // too, because a subscription to an unpublished table is silent."
    //
    // Measured on prod 2026-08-25, the OTHER half had failed here:
    //   dm_da_groups                  published ✓  client key ✗
    //   team_members                  published ✓  client key ✗
    //   draw_schedule_quarter_layout  published ✗  client key ✗
    //
    // A publication with no listener is exactly as silent as a listener with no
    // publication, and neither side logs anything.
    expect(queryKeysSource).toContain('IN MIRROR IMAGE');
    // Only the one genuinely unpublished table needed DDL...
    expect(SQL).toContain(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.draw_schedule_quarter_layout',
    );
    // ...and the migration VERIFIES all three are members, not just the one it
    // added — the assertion that would have caught this in the first place.
    for (const t of ROSTER_TABLES) {
      expect(SQL, t).toContain(`('${t}')`);
    }
    expect(SQL).toContain('still missing from supabase_realtime');
  });

  it('★★ the migration is idempotent and writes no row', () => {
    expect(SQL).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_publication_tables/);
    const outside = SQL.replace(/AS \$function\$[\s\S]*?\$function\$;/g, ' ');
    expect(outside).not.toMatch(/\bINSERT INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/REPLICA IDENTITY/i);
  });
});

// ---------------------------------------------------------------------------
// §3 · THE PERMIT-TYPES NOTE
// ---------------------------------------------------------------------------

describe('fix-401 §3: the relocation note is gone', () => {
  it('★ the note and its section no longer render', () => {
    const stripped = adminProjectsSource
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toContain('permit-types-moved');
    expect(stripped).not.toContain('Permit types moved to');
    expect(stripped).not.toMatch(/<Section title="Permit Types">/);
  });

  it('★ the ruling is recorded where it was deleted', () => {
    // Bobby: "It's like we don't need to say that, just delete it."
    const prose = adminProjectsSource.replace(/\s+/g, ' ');
    expect(prose).toContain("we don't need to say that, just delete it");
    // ★ ...and fix-288's REASON for not duplicating the editor is preserved:
    // only the signpost went, not the rule behind it.
    expect(prose).toContain('deliberately NOT');
  });
});

// ---------------------------------------------------------------------------
// §4 · THE WIRING — WHICH EDITOR ACTUALLY MOVES A DA
// ---------------------------------------------------------------------------

describe('fix-401 §4: a team move lands in the table consumers read', () => {
  it('★★★ TeamStructureEditor writes dm_da_groups, through the OCC RPC', () => {
    // The write path Bobby's move needed to travel. useUpsertDmDaGroup calls
    // bp_upsert_dm_da_group_row with p_expected_updated_at, so a concurrent
    // edit conflicts rather than clobbering (fix-382's rule, already held here).
    expect(teamStructureSource).toContain("useUpsertDmDaGroup");
    expect(upsertHookSource).toContain("supabase.rpc('bp_upsert_dm_da_group_row'");
    expect(upsertHookSource).toContain('p_expected_updated_at');
    expect(upsertHookSource).toContain('queryKeys.dmDaGroups(tenantId)');
  });

  it('★★★ …and the OTHER draw-schedule editor writes a DIFFERENT table', () => {
    // ★★ THE TRAP, IN ONE ASSERTION. QuarterLayoutEditor is titled "Draw
    // Schedule Layout" and is the one you reach for when thinking about the
    // draw schedule — but it writes draw_schedule_quarter_layout, which is
    // column order and labels for one quarter. It reaches neither the dm
    // derivation nor the board lens nor co-assignment.
    //
    // Measured on prod 2026-08-25, the two tables disagreed about Erick:
    // the layout said 'Derry', dm_da_groups said 'Jade'.
    expect(quarterLayoutHookSource).toContain("from('draw_schedule_quarter_layout')");
    expect(quarterLayoutHookSource).not.toContain('dm_da_groups');
    // ★ Comment-stripped: the header ABOVE explains this very trap and names
    //   the table to do it. Asserting on the raw file would match the
    //   explanation — the same trap fix-387/390/397 all hit.
    expect(stripComments(teamStructureSource)).not.toContain(
      'draw_schedule_quarter_layout',
    );
    // ★ And the distinction is written down where somebody will hit it.
    expect(teamStructureSource).toContain('TWO EDITORS ON THIS TAB LOOK LIKE THEY MOVE A DA');
  });

  it('★★ the mapping edit now reaches consumers other than the editing tab', () => {
    // Before fix-401 the ONLY invalidation was the editor's own scoped key.
    // dm_da_groups is in REALTIME_TABLES now, so the socket carries it to every
    // other tab and user, and the fallback poll covers it if the socket is down.
    expect(REALTIME_TABLES).toHaveProperty('dm_da_groups');
    expect(allRealtimeKeys().map((k) => JSON.stringify(k))).toContain(
      JSON.stringify(queryKeys.dmDaGroupsAll),
    );
  });
});
