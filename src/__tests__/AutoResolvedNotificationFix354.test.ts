import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_354_auto_closed_notification.sql?raw';
import FIX337 from '../../migrations/fix_337_stale_work.sql?raw';
import TASK_TEAM_SRC from '../lib/taskTeam.ts?raw';
import {
  acknowledgeableItems,
  buildNewItems,
  keyForAutoClosed,
  keyForTask,
  unseenCount,
  unseenItems,
  type AutoClosureItemInput,
  type NewItem,
} from '../lib/boardReads';
import {
  ROLE_SENIORITY,
  ROLE_TITLE,
  ROLE_TITLE_PLURAL,
  primaryRoles,
  rosterRoleTitle,
} from '../lib/roleLabels';
import type { TeamRole } from '../lib/database.types';

// ===========================================================================
// fix-354 — the machine closed 103 tasks and told nobody
// ===========================================================================
//
// Register #100, Bobby: *"maybe it checks off that milestone but then gives a
// notification back to that entitlement lead that says, hey, as an FYI,
// milestone was marked complete because the permit has progressed."*
//
// ★★★ AND THE WARNING BESIDE IT: *"Do not ship the auto-completion without the
// notification — they are one feature."* fix-337 shipped the writer alone.
//
// ★★ MEASURED ON PROD 2026-08-19, BEFORE ANYTHING WAS BUILT:
//
//   tasks auto-closed 'permit_issued'   103   over 58 permits, 36 projects
//   …with no assignee at all             91
//   …with a ROLE string, not a person     6   (Entitlements 4, DM 1, Arch 1)
//   …unroutable under the rule below      0
//   notifications those 103 would make   61   (58 permits; 3 split by recipient)
//
// ★ CLOSE-FIRST, WHICH SUPERSEDES REGISTER #105. Asked whether the machine
// should close-and-tell or only propose, Bobby chose "close it, and make it a
// notification". The task is closed when the machine decides — fix-337's
// behaviour, unchanged — and this is a REPORT. There is no propose-then-ack
// flow here and there must not be one added.

const SQL = MIGRATION.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');

const EPOCH_OK = '2026-08-20T10:00:00Z';

function closure(over: Partial<AutoClosureItemInput> = {}): AutoClosureItemInput {
  return {
    id: 'c1',
    permit_id: 900,
    project_id: 'p1',
    address: '3626 164th Pl SE',
    permit_label: '7112264-DM · Building Permit',
    reason: 'permit_issued',
    // ★ fix-355 added the sentence. Null here, because fix-354's rows report
    // a FACT — the permit issued — and have nothing to justify.
    detail: null,
    recipient: 'Miles',
    task_count: 6,
    closed_at: EPOCH_OK,
    ...over,
  };
}

const BASE = {
  flips: [],
  tasks: [],
  acks: [],
  permits: [],
  projects: [],
  viewerName: 'Miles',
};

function itemsFor(viewerName: string | null, autoClosures: AutoClosureItemInput[]): NewItem[] {
  return buildNewItems({ ...BASE, viewerName, autoClosures });
}

// ---------------------------------------------------------------------------
// §2 — the notification
// ---------------------------------------------------------------------------

describe('fix-354 §2: one notification per permit and closure, never per task', () => {
  it('★★★ six closed tasks on one permit are ONE item, and it says six', () => {
    // 103 tasks over 58 permits is 58 notifications, not 103. One row per task
    // would be a flood on day one, and a flood is how a bell gets ignored —
    // fix-307's lesson, which returns you to silence by a different route.
    const items = itemsFor('Miles', [closure({ task_count: 6 })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe('auto_closed');
    expect(items[0]!.title).toBe('6 tasks closed — the permit issued');
    expect(items[0]!.where).toContain('7112264-DM');
  });

  it('★ one task reads as one, not "1 tasks"', () => {
    const items = itemsFor('Miles', [closure({ task_count: 1 })]);
    expect(items[0]!.title).toBe('1 task closed — the permit issued');
  });

  it('★★ the words say WHY, and that it can be undone', () => {
    // ★ The deliverable people actually meet. "Marked done automatically" and
    // an explicit way back — an FYI that only reports is a shrug.
    const sub = itemsFor('Miles', [closure()])[0]!.subtitle ?? '';
    expect(sub).toMatch(/automatically/i);
    expect(sub).toMatch(/no longer applies/i);
    expect(sub).toMatch(/reopen/i);
    // ★ And it never leaks the column name at the reader.
    expect(sub).not.toMatch(/auto_closed_reason|permit_issued/);
    expect(items0Title()).not.toMatch(/auto_closed|_/);
  });

  function items0Title() {
    return itemsFor('Miles', [closure()])[0]!.title;
  }

  it('★★★ two recipients on one permit are two items, each with its own count', () => {
    // Measured: 3 of the 58 permits split like this. Grouping by permit ALONE
    // would either drop somebody's notice or hand them another person's tasks.
    const rows = [
      closure({ id: 'c-a', recipient: 'Miles', task_count: 4 }),
      closure({ id: 'c-b', recipient: 'Bobby', task_count: 2 }),
    ];
    expect(itemsFor('Miles', rows)).toHaveLength(1);
    expect(itemsFor('Miles', rows)[0]!.title).toContain('4 tasks');
    expect(itemsFor('Bobby', rows)).toHaveLength(1);
    expect(itemsFor('Bobby', rows)[0]!.title).toContain('2 tasks');
  });

  it('★★ the key is the ledger row\'s own id — stable across re-derivation', () => {
    // The key scheme's rule: "a key built from a date, a name or a status would
    // silently re-notify the moment that value changed." A task COUNT can grow;
    // a primary key cannot.
    expect(keyForAutoClosed('abc-123')).toBe('auto_closed:abc-123');
    const first = itemsFor('Miles', [closure({ task_count: 6 })])[0]!.key;
    const later = itemsFor('Miles', [closure({ task_count: 9 })])[0]!.key;
    expect(later).toBe(first);
  });

  it('★★ it is PERSONAL, not shared — nothing here is "satisfied"', () => {
    // fix-339's shared shape exists because one person acting satisfies a post
    // request. An FYI about your own work is not satisfied by anybody.
    const item = itemsFor('Miles', [closure()])[0]!;
    expect(item.audience).toBeUndefined(); // defaults to personal
    expect(acknowledgeableItems([item])).toHaveLength(1);
  });

  it('★ it links to the permit, so the closed work is one click away', () => {
    const item = itemsFor('Miles', [closure()])[0]!;
    expect(item.permitId).toBe(900);
    expect(item.projectId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('fix-354: routing — it never lands on nobody', () => {
  it('★★ it reaches the person the DATABASE routed it to, and no one else', () => {
    // ★ The recipient is resolved server-side, in the same transaction as the
    // close. The client only asks "is that me" — re-deriving it here would be a
    // second opinion about who owns the work, and a DIFFERENT one the moment
    // somebody is reassigned.
    const rows = [closure({ recipient: 'Briana' })];
    expect(itemsFor('Briana', rows)).toHaveLength(1);
    expect(itemsFor('Miles', rows)).toHaveLength(0);
  });

  it('★ the match is trim- and case-insensitive, like every other source', () => {
    expect(itemsFor('miles', [closure({ recipient: '  Miles ' })])).toHaveLength(1);
  });

  it('★★ the SQL twin resolves the same five role tokens as the client', () => {
    // fix-238's tokens. A twin, not a second opinion — if one side learns a new
    // role and the other does not, an FYI silently goes to the wrong person.
    for (const token of [
      'Design Associate',
      'Entitlements',
      'Design Manager',
      'Schematic Team',
      'Architecture',
    ]) {
      expect(SQL, `${token} missing from the SQL twin`).toContain(`'${token}'`);
      expect(TASK_TEAM_SRC, `${token} missing from the TS side`).toContain(`'${token}'`);
    }
  });

  it('★★★ and it falls through to ENT, then to the PROJECT — never to nobody', () => {
    // 91 of the 103 had no assignee at all; fix-308 already decided ENT is the
    // default owner of unowned work. And ONE of the 103 sits on a permit with
    // no ent_lead, no da and no dm — 215 31st Ave, whose PROJECT has Miles.
    // Without the fourth step that FYI had nowhere to go.
    expect(SQL).toMatch(/COALESCE\(NULLIF\(btrim\(p\.ent_lead\), ''\), NULLIF\(btrim\(pr\.entitlement_lead\), ''\)\)/);
    expect(SQL).toMatch(/RETURN NULLIF\(btrim\(COALESCE\(v_out, v_ent\)\), ''\);/);
    // The table refuses a null recipient outright, so "never nobody" is a
    // constraint and not a convention.
    expect(SQL).toMatch(/recipient\s+text NOT NULL CHECK \(btrim\(recipient\) <> ''\)/);
  });

  it('★ a recipient-less closure is dropped, never written half-formed', () => {
    expect(SQL).toMatch(/WHERE recipient IS NOT NULL/);
  });
});

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

describe('fix-354: read state is per person', () => {
  it('★★★ Bobby reading it does not clear it for Cam', () => {
    const rows = [
      closure({ id: 'c-a', recipient: 'Bobby' }),
      closure({ id: 'c-b', recipient: 'Cam' }),
    ];
    const bobby = itemsFor('Bobby', rows);
    const cam = itemsFor('Cam', rows);
    // Bobby reads his.
    const bobbyRead = new Set([keyForAutoClosed('c-a')]);
    expect(unseenCount(bobby, bobbyRead)).toBe(0);
    // Cam's is untouched — his read set is his own (RLS scopes the rows to
    // auth.uid(), so he never even sees Bobby's).
    expect(unseenCount(cam, new Set())).toBe(1);
    expect(unseenItems(cam, bobbyRead)).toHaveLength(1);
  });

  it('★ reading one closure does not clear another on the same permit', () => {
    const rows = [
      closure({ id: 'c-1', closed_at: '2026-08-20T10:00:00Z' }),
      closure({ id: 'c-2', closed_at: '2026-08-25T10:00:00Z' }),
    ];
    const items = itemsFor('Miles', rows);
    expect(items).toHaveLength(2);
    expect(unseenCount(items, new Set([keyForAutoClosed('c-1')]))).toBe(1);
  });

  it('★ it is acknowledgeable the ordinary way — a ✓, not a "Got it"', () => {
    const items = itemsFor('Miles', [closure()]);
    expect(acknowledgeableItems(items)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §4 — the anti-backfill
// ---------------------------------------------------------------------------

describe('fix-354 §4: the 103 already closed produce nothing', () => {
  it('★★★ the migration writes no ledger row for any existing closure', () => {
    // Bobby: "Leave them — start clean going forward." A naive implementation
    // deriving items from permit_tasks.auto_closed_reason would produce all 103
    // on first load, which is precisely what he declined.
    const inserts = [
      ...SQL.matchAll(/INSERT INTO public\.permit_task_auto_closures/gi),
    ];
    // Exactly one, and it is the one inside the closure function.
    expect(inserts).toHaveLength(1);
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_clear_tasks_for_issued_permit');
    expect(SQL.indexOf('INSERT INTO public.permit_task_auto_closures')).toBeGreaterThan(fnStart);
  });

  it('★★ and it never reads auto_closed_reason to find things to announce', () => {
    // The derivation is from the LEDGER, which is empty on day one. This is the
    // structural half of the promise; the assertion above is the textual one.
    expect(SQL).not.toMatch(/FROM public\.permit_tasks[\s\S]{0,200}auto_closed_reason/);
    expect(SQL).not.toMatch(/SELECT[\s\S]{0,120}auto_closed_reason\s*=\s*'permit_issued'/);
  });

  it('★ an empty ledger produces an empty board — the day-one state', () => {
    expect(itemsFor('Miles', [])).toEqual([]);
    expect(buildNewItems(BASE)).toEqual([]);
  });

  it('★ and the epoch still guards anything dated before the model existed', () => {
    const old = closure({ closed_at: '2026-08-13T00:00:00Z' });
    expect(itemsFor('Miles', [old])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §1/§3 — close-first, and one transaction
// ---------------------------------------------------------------------------

describe('fix-354 §1/§3: close first, tell in the same transaction', () => {
  it('★★★ the task is CLOSED, not proposed — #105 is superseded', () => {
    // There is no "pending" state, no proposal table, and no path that leaves
    // the task open waiting for an acknowledgement.
    expect(SQL).toMatch(/SET completion_status = 'Resolved',\s*\n\s*auto_closed_reason = 'permit_issued'/);
    expect(SQL).not.toMatch(/proposed|pending_ack|awaiting_ack/i);
  });

  it('★★★ the INSERT is inside the UPDATE\'s own statement', () => {
    // A close that commits while its notification fails is the bug this ticket
    // exists to fix, reappearing as a race. One statement: a CTE chain from the
    // UPDATE ... RETURNING straight into the ledger.
    const fn = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_clear_tasks_for_issued_permit'),
    );
    const body = fn.slice(0, fn.indexOf('$function$;'));
    expect(body).toMatch(/WITH closed AS \(\s*UPDATE public\.permit_tasks/);
    expect(body).toMatch(/RETURNING t\.id, t\.tenant_id, t\.permit_id, t\.assigned_to/);
    expect(body).toMatch(/logged AS \(\s*INSERT INTO public\.permit_task_auto_closures/);
    // No second statement that could be skipped.
    expect(body).not.toMatch(/PERFORM\s+.*insert/i);
  });

  it('★★ fix-337\'s closure behaviour is unchanged, results_ready included', () => {
    // The predicate is byte-for-byte what fix-337 shipped. This ticket adds a
    // report; it does not widen what gets closed.
    const predicate = /AND t\.auto_event IS DISTINCT FROM 'results_ready'/;
    expect(FIX337).toMatch(predicate);
    expect(SQL).toMatch(predicate);
    for (const clause of [
      "t.completion_status <> 'Resolved'",
      'COALESCE(t.done, false) = false',
      'p.actual_issue IS NOT NULL',
    ]) {
      expect(SQL).toContain(clause);
    }
  });

  it('★★ and the function still RETURNS a count of TASKS', () => {
    // fix-337's one-time backfill block reads this and reports "cleared N open
    // tasks". Returning notifications instead would silently change that line.
    expect(SQL).toMatch(/SELECT COALESCE\(\(SELECT sum\(task_count\) FROM grouped\), 0\)::integer INTO v_count/);
  });

  it('★ no NEW auto-close rule was added — §5 is a measurement', () => {
    // Building the notification does not entitle anything new to close tasks.
    expect(SQL).toMatch(/CHECK \(reason IN \('permit_issued'\)\)/);
    expect(SQL).not.toMatch(/corr_issued|intake_accepted|resubmitted|scrape_reconcile/);
  });

  it('★★ the ledger is written by the function alone — no write policy exists', () => {
    expect(SQL).toMatch(/CREATE POLICY permit_task_auto_closures_tenant_select[\s\S]*?FOR SELECT USING \(tenant_id = ANY \(public\.auth_tenant_ids\(\)\)\)/);
    expect(SQL).not.toMatch(/permit_task_auto_closures_\w*(insert|write|update|delete)/i);
    expect(SQL).toMatch(/GRANT SELECT ON public\.permit_task_auto_closures TO authenticated;/);
  });

  it('★ published to realtime — a bell that needs a reload is not a bell', () => {
    expect(SQL).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.permit_task_auto_closures/);
  });
});

// ---------------------------------------------------------------------------
// It reaches both surfaces
// ---------------------------------------------------------------------------

describe('fix-354: it reaches the bell and the board', () => {
  it('★★ both call sites feed it — the bell and My Board build items twice', async () => {
    // MyBoard re-derives the list rather than reading the hook's, so a source
    // added in one place and not the other is visible on one surface only.
    const bellSrc = (await import('../hooks/useBoardNotifications.ts?raw')).default as string;
    const boardSrc = (await import('../pages/MyBoard.tsx?raw')).default as string;
    expect(bellSrc).toContain('autoClosures:');
    expect(boardSrc).toContain('autoClosures:');
    expect(bellSrc).toContain('useAutoClosures');
    expect(boardSrc).toContain('useAutoClosures');
  });

  it('★ it files under Tasks in the notification centre, not a chip of its own', async () => {
    const centre = (await import('../pages/Notifications.tsx?raw')).default as string;
    expect(centre).toMatch(/auto_closed: 'task'/);
  });

  it('★ it sorts by when it happened, with everything else', () => {
    const items = buildNewItems({
      ...BASE,
      autoClosures: [
        closure({ id: 'older', closed_at: '2026-08-20T09:00:00Z' }),
        closure({ id: 'newer', closed_at: '2026-08-21T09:00:00Z' }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([
      keyForAutoClosed('newer'),
      keyForAutoClosed('older'),
    ]);
  });

  it('★ an unmapped viewer still gets nothing — the guard is untouched', () => {
    expect(itemsFor(null, [closure()])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 — Dave's title
// ---------------------------------------------------------------------------

const ALL_ROLES: TeamRole[] = [
  'da', 'dm', 'ent', 'ent_lead', 'acq', 'acq_lead', 'schematic', 'viewer', 'director',
  // ★ fix-487 (P-144): Construction Admin, the tenth role string and the sixth
  //   INTERNAL position. `ROLE_SENIORITY` is the list the compiler cannot
  //   check, so this is the assertion that made adding it safe.
  'ca',
];

describe('fix-354 §6: Dave is the Director, and still on the schematic team', () => {
  it('★★ ROLE_TITLE is total over TeamRole, with director added', () => {
    // A Record<TeamRole, …> makes a missing key a type error, which is the
    // mechanism that stops a half-added role. This is the other half: a key
    // with no role.
    for (const r of ALL_ROLES) {
      expect(ROLE_TITLE[r], r).toBeTruthy();
      expect(ROLE_TITLE_PLURAL[r], r).toBeTruthy();
    }
    expect(Object.keys(ROLE_TITLE).sort()).toEqual([...ALL_ROLES].sort());
    expect(ROLE_TITLE.director).toBe('Director');
  });

  it('★★ ROLE_SENIORITY covers every role — the one list the compiler cannot check', () => {
    // It is an array, not a Record, so an omitted role compiles and silently
    // sorts LAST via roleSeniorityRank's -1 guard.
    expect([...ROLE_SENIORITY].sort()).toEqual([...ALL_ROLES].sort());
  });

  it('★ director outranks the entitlements manager — over both halves', () => {
    expect(ROLE_SENIORITY.indexOf('director')).toBeLessThan(
      ROLE_SENIORITY.indexOf('ent_lead'),
    );
  });

  it('★★★ Dave reads "Director · Schematic Design" — two rows, both kept', () => {
    // ★ A SECOND ROSTER ROW, never a changed one. Derry and Lindsay each hold
    // dm AND schematic on prod, so this is the established shape — and changing
    // his schematic row would take him off the schematic team, which is not what
    // was asked: he genuinely does that work.
    expect(rosterRoleTitle(['director', 'schematic'])).toBe('Director · Schematic Design');
    expect(primaryRoles(['director', 'schematic'])).toEqual(['director', 'schematic']);
  });

  it('★★ and the order is deterministic under a shuffled input', () => {
    for (const roles of [
      ['director', 'schematic'],
      ['schematic', 'director'],
    ] as TeamRole[][]) {
      expect(rosterRoleTitle(roles)).toBe('Director · Schematic Design');
    }
  });

  it('★ director is its OWN family — it prints beside a role, never instead of it', () => {
    // In the `ent` family it would REPLACE ent_lead rather than print beside it,
    // and his is not a grade of entitlements — it is a job over both.
    expect(primaryRoles(['director', 'ent_lead'])).toEqual(['director', 'ent_lead']);
    expect(rosterRoleTitle(['director', 'ent_lead'])).toBe(
      'Director · Entitlements Manager',
    );
  });

  it('★ no roster row is written by this ticket', () => {
    // The row is a data change and is Bobby's to approve — the SQL is in the PR.
    expect(SQL).not.toMatch(/INSERT INTO public\.team_members/i);
    expect(SQL).not.toMatch(/director/i);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-354: prior contracts survive', () => {
  it('★ the other seven sources are untouched by an eighth', () => {
    const task = {
      id: 't1',
      permit_id: 900,
      project_id: 'p1',
      text: 'A task',
      assigned_to: 'Miles',
      co_assignees: [],
      created_at: EPOCH_OK,
      status: 'Open',
    };
    const items = buildNewItems({
      ...BASE,
      tasks: [task as never],
      autoClosures: [closure()],
    });
    expect(items.map((i) => i.source).sort()).toEqual(['auto_closed', 'task']);
    // fix-307's read model still applies to both.
    expect(unseenCount(items, new Set([keyForTask('t1')]))).toBe(1);
  });

  it('★ acknowledgeableItems still excludes only the shared kind', () => {
    const items = itemsFor('Miles', [closure()]);
    expect(acknowledgeableItems(items)).toHaveLength(1);
  });
});
