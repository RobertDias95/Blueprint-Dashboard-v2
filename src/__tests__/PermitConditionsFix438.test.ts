import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_438_permit_conditions.sql?raw';
import {
  conditionCopy,
  conditionIdFromKey,
  isConditionShowing,
  keyForCondition,
  KNOWN_CONDITION_KINDS,
  type PermitConditionRow,
} from '../lib/permitConditions';
import { buildNewItems } from '../lib/boardReads';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';

// ===========================================================================
// fix-438 — a standing condition is ONE self-clearing row
// ===========================================================================
//
// Ruling, Bobby 2026-08-29. A condition is true NOW and will stop being true;
// it is not an event and not an error. There is no Resolve on one.
//
// ★★★ CI HAS NO DATABASE, so the sync's semantics are tested as a PURE MIRROR
// of the SQL (this repo's fix-153 pattern), and the mirror is held to the
// migration text by assertions on the comment-stripped source. The mirror IS
// the tested contract — keep the two in lockstep.

/** Comment-stripped migration. The header discusses every rule at length in
 *  prose, which is exactly how an assertion ends up matching a paragraph
 *  instead of the code it is about. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

// ---------------------------------------------------------------------------
// A2 — the sync, mirrored
// ---------------------------------------------------------------------------

interface MirrorRow {
  id: string;
  permit_id: number;
  kind: string;
  cond_key: string;
  detail: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  cleared_at: string | null;
  cleared_reason: string | null;
  acknowledged_at: string | null;
  acknowledged_detail_hash: string | null;
}

interface Incoming {
  kind: string;
  cond_key?: string;
  detail?: Record<string, unknown>;
}

/**
 * ★★★ Pure TS mirror of bp_sync_permit_conditions. Same three rules:
 *   1. every kind in the payload must be owned by the declared source;
 *   2. upsert what is present (a cleared row comes back with a FRESH
 *      first_seen_at and no acknowledgement);
 *   3. clear every open row of THIS SOURCE that the payload omits.
 */
function syncMirror(
  rows: MirrorRow[],
  permitId: number,
  source: string,
  incoming: Incoming[],
  now: string,
): { rows: MirrorRow[]; counts: { opened: number; updated: number; cleared: number } } {
  const prefix = `${source}:`;
  for (const i of incoming) {
    if (!i.kind.startsWith(prefix)) {
      throw new Error(`kind ${i.kind} is not owned by source ${source}`);
    }
  }
  const next = rows.map((r) => ({ ...r }));
  let opened = 0;
  let updated = 0;
  let cleared = 0;

  for (const i of incoming) {
    const condKey = i.cond_key ?? '';
    const detail = i.detail ?? {};
    const found = next.find(
      (r) => r.permit_id === permitId && r.kind === i.kind && r.cond_key === condKey,
    );
    if (!found) {
      next.push({
        id: `c-${i.kind}-${condKey}`,
        permit_id: permitId,
        kind: i.kind,
        cond_key: condKey,
        detail,
        first_seen_at: now,
        last_seen_at: now,
        seen_count: 1,
        cleared_at: null,
        cleared_reason: null,
        acknowledged_at: null,
        acknowledged_detail_hash: null,
      });
      opened += 1;
      continue;
    }
    const wasOpen = found.cleared_at === null;
    found.detail = detail;
    found.last_seen_at = now;
    found.seen_count = wasOpen ? found.seen_count + 1 : 1;
    found.first_seen_at = wasOpen ? found.first_seen_at : now;
    found.cleared_at = null;
    found.cleared_reason = null;
    if (!wasOpen) {
      found.acknowledged_at = null;
      found.acknowledged_detail_hash = null;
    }
    if (wasOpen) updated += 1;
    else opened += 1;
  }

  const present = new Set(
    incoming.map((i) => `${i.kind}\x1f${i.cond_key ?? ''}`),
  );
  for (const r of next) {
    if (r.permit_id !== permitId) continue;
    if (r.cleared_at !== null) continue;
    if (!r.kind.startsWith(prefix)) continue;
    if (present.has(`${r.kind}\x1f${r.cond_key}`)) continue;
    r.cleared_at = now;
    r.cleared_reason = 'condition_ended';
    cleared += 1;
  }
  return { rows: next, counts: { opened, updated, cleared } };
}

const T0 = '2026-08-20T21:04:52Z';
const T1 = '2026-08-29T03:11:25Z';
const T2 = '2026-09-02T03:11:25Z';

function open1(over: Partial<MirrorRow> = {}): MirrorRow {
  return {
    id: 'c1',
    permit_id: 198,
    kind: 'scraper:mbp_resubmittal',
    cond_key: '2',
    detail: { days_in_corrections: 14, cycle_index: 2 },
    first_seen_at: T0,
    last_seen_at: T0,
    seen_count: 1,
    cleared_at: null,
    cleared_reason: null,
    acknowledged_at: null,
    acknowledged_detail_hash: null,
    ...over,
  };
}

describe('fix-438 §A2 — the set difference IS the self-clearing rule', () => {
  it('★★★ ABSENT FROM THE PAYLOAD → CLEARED. Nothing else clears a condition.', () => {
    const { rows, counts } = syncMirror([open1()], 198, 'scraper', [], T1);
    expect(counts).toEqual({ opened: 0, updated: 0, cleared: 1 });
    expect(rows[0].cleared_at).toBe(T1);
    expect(rows[0].cleared_reason).toBe('condition_ended');
  });

  it('★★★ AN EMPTY ARRAY IS MEANINGFUL and must be sent — it is what clears the last one', () => {
    // A caller that "skips the call when it has nothing to report" leaves a
    // stale row open for ever. fix-439's brief has to say so.
    const { counts } = syncMirror([open1()], 198, 'scraper', [], T1);
    expect(counts.cleared).toBe(1);
  });

  it('★★ still present → UPDATED: the detail refreshes, first_seen holds, the count ticks', () => {
    const { rows, counts } = syncMirror(
      [open1()],
      198,
      'scraper',
      [{ kind: 'scraper:mbp_resubmittal', cond_key: '2', detail: { days_in_corrections: 30 } }],
      T1,
    );
    expect(counts).toEqual({ opened: 0, updated: 1, cleared: 0 });
    expect(rows[0].first_seen_at).toBe(T0);
    expect(rows[0].last_seen_at).toBe(T1);
    expect(rows[0].seen_count).toBe(2);
    expect(rows[0].detail).toEqual({ days_in_corrections: 30 });
  });

  it('★★★ CLEARED AND BACK → RE-OPENED with a FRESH first_seen and NO acknowledgement', () => {
    const wasCleared = open1({
      cleared_at: T1,
      cleared_reason: 'condition_ended',
      acknowledged_at: T0,
      acknowledged_detail_hash: 'abc',
      seen_count: 9,
    });
    const { rows, counts } = syncMirror(
      [wasCleared],
      198,
      'scraper',
      [{ kind: 'scraper:mbp_resubmittal', cond_key: '2', detail: { cycle_index: 2 } }],
      T2,
    );
    expect(counts).toEqual({ opened: 1, updated: 0, cleared: 0 });
    // ★★ It went away and came back: that is NEWS, so the key changes with
    //    first_seen and the earlier "I know" — which was about the previous
    //    episode — is dropped.
    expect(rows[0].first_seen_at).toBe(T2);
    expect(rows[0].seen_count).toBe(1);
    expect(rows[0].acknowledged_at).toBeNull();
    expect(rows[0].acknowledged_detail_hash).toBeNull();
    expect(keyForCondition(rows[0].id, rows[0].first_seen_at)).not.toBe(
      keyForCondition(wasCleared.id, T0),
    );
  });

  it('★★★ ANOTHER SOURCE’S ROWS ARE UNTOUCHED — the prefix is the ownership boundary', () => {
    const mine = open1();
    const theirs = open1({
      id: 'c2',
      kind: 'indexer:missing_letter',
      cond_key: '',
    });
    const { rows, counts } = syncMirror([mine, theirs], 198, 'scraper', [], T1);
    expect(counts.cleared).toBe(1);
    expect(rows.find((r) => r.id === 'c1')!.cleared_at).toBe(T1);
    // ★ A source that could see another source's rows would clear them, and the
    //   row would look as though the condition had genuinely ended.
    expect(rows.find((r) => r.id === 'c2')!.cleared_at).toBeNull();
  });

  it('★★ a mislabelled kind is REFUSED before anything is written', () => {
    expect(() =>
      syncMirror([open1()], 198, 'scraper', [{ kind: 'indexer:whatever' }], T1),
    ).toThrow(/not owned by source/);
  });

  it('★★ two conditions of one kind, told apart by cond_key, clear independently', () => {
    const c2 = open1({ id: 'c1', cond_key: '2' });
    const c3 = open1({ id: 'c3', cond_key: '3' });
    const { rows } = syncMirror(
      [c2, c3],
      198,
      'scraper',
      [{ kind: 'scraper:mbp_resubmittal', cond_key: '3' }],
      T1,
    );
    expect(rows.find((r) => r.cond_key === '2')!.cleared_at).toBe(T1);
    expect(rows.find((r) => r.cond_key === '3')!.cleared_at).toBeNull();
  });

  it('★★★ the separator makes (kind "x", key "1") ≠ (kind "x1", key "") ', () => {
    // Concatenating with nothing between them would make these one string and
    // one condition would silently clear the other. chr(31) cannot occur in
    // either; the mirror below uses the same byte, written \x1f.
    const a = open1({ id: 'a', kind: 'scraper:x', cond_key: '1' });
    const b = open1({ id: 'b', kind: 'scraper:x1', cond_key: '' });
    const { rows } = syncMirror(
      [a, b],
      198,
      'scraper',
      [{ kind: 'scraper:x', cond_key: '1' }],
      T1,
    );
    expect(rows.find((r) => r.id === 'a')!.cleared_at).toBeNull();
    expect(rows.find((r) => r.id === 'b')!.cleared_at).toBe(T1);
  });
});

// ---------------------------------------------------------------------------
// B2 — acknowledgement, and the hash decision
// ---------------------------------------------------------------------------

function row(over: Partial<PermitConditionRow> = {}): PermitConditionRow {
  return {
    id: 'cond-1',
    permit_id: 198,
    project_id: 'p-1',
    permit_num: 'BLD2026-0423',
    permit_type: 'Building Permit',
    address: '3626 164th Pl SE',
    ent_lead: 'Bobby',
    kind: 'scraper:mbp_resubmittal',
    cond_key: '2',
    detail: { days_in_corrections: 30, cycle_index: 2 },
    first_seen_at: T0,
    last_seen_at: T1,
    seen_count: 9,
    cleared_at: null,
    cleared_reason: null,
    acknowledged_at: null,
    acknowledged_detail_hash: null,
    detail_hash: 'HASH-A',
    ...over,
  };
}

describe('fix-438 §B2 — acknowledged holds until the condition CHANGES', () => {
  it('★★ an open, un-acknowledged condition shows', () => {
    expect(isConditionShowing(row())).toBe(true);
  });

  it('★★★ acknowledging HIDES it — there is no Resolve on a condition', () => {
    expect(
      isConditionShowing(row({ acknowledged_at: T1, acknowledged_detail_hash: 'HASH-A' })),
    ).toBe(false);
  });

  it('★★★ a CHANGED material detail brings it back', () => {
    expect(
      isConditionShowing(
        row({
          acknowledged_at: T0,
          acknowledged_detail_hash: 'HASH-A',
          detail_hash: 'HASH-B',
        }),
      ),
    ).toBe(true);
  });

  it('★★★ CLEARED disappears, acknowledged or not', () => {
    expect(isConditionShowing(row({ cleared_at: T1 }))).toBe(false);
    expect(
      isConditionShowing(
        row({ cleared_at: T1, acknowledged_at: T0, acknowledged_detail_hash: 'X' }),
      ),
    ).toBe(false);
  });

  it('★★★ THE HASH DECISION: day counters are stripped, so an acknowledgement survives the night', () => {
    // Verified on prod against the real payloads, 2026-08-29:
    //   md5(whole detail)     day14 0b364980… → day30 41e655b6…   CHANGES
    //   md5(material detail)  day14 29aa2862… → day30 29aa2862…   HOLDS
    //   cycle 2 → 3           29aa2862…      → cb53af26…          CHANGES
    //
    // The volatile keys the SQL strips, pinned here so a future edit to one has
    // to be an edit to both.
    const stripped = /'days_in_corrections', 'days', 'age_days', 'days_open', 'days_since'/;
    expect(SQL).toMatch(stripped);
    expect(SQL).toMatch(/'scraper_run_at', 'as_of', 'observed_at', 'checked_at', 'run_at'/);
    // ★★★ AND IT IS NOT md5(detail) ANYWHERE. Hashing the whole thing would
    //     re-surface an acknowledged condition every single morning — P-069
    //     rebuilt inside its own fix.
    expect(SQL).not.toMatch(/md5\(\s*(NEW\.)?detail::text\s*\)/);
    expect(SQL).toContain('bp_condition_detail_hash(v_row.detail)');
  });
});

// ---------------------------------------------------------------------------
// B1/B4 — routing and the key
// ---------------------------------------------------------------------------

const EMPTY = {
  flips: [],
  tasks: [],
  acks: [],
  permits: [],
};

describe('fix-438 §B1 — it goes to the permit’s ENT lead', () => {
  it('★★ the ENT lead gets it, as a PERSONAL item', () => {
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'Bobby',
      conditions: [row({ ent_lead: 'Bobby' })],
    });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('condition');
    // audience is undefined = personal (fix-339's default), so it participates
    // in board_item_reads like every other personal kind.
    expect(items[0].audience).toBeUndefined();
    expect(items[0].permitId).toBe(198);
    expect(items[0].target).toEqual({
      kind: 'permit',
      projectId: 'p-1',
      permitId: 198,
    });
  });

  it('★★ somebody else does not', () => {
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'Miles',
      conditions: [row({ ent_lead: 'Bobby' })],
    });
    expect(items).toHaveLength(0);
  });

  it('★★★ ERICK DOES NOT RECEIVE ERIC’S. The roster holds both, one letter apart.', () => {
    const forEric = [row({ id: 'x', ent_lead: 'Eric' })];
    expect(buildNewItems({ ...EMPTY, viewerName: 'Erick', conditions: forEric })).toHaveLength(0);
    expect(buildNewItems({ ...EMPTY, viewerName: 'Eric', conditions: forEric })).toHaveLength(1);
    // …and the reverse, so this is a property of the match and not of one name.
    const forErick = [row({ id: 'y', ent_lead: 'Erick' })];
    expect(buildNewItems({ ...EMPTY, viewerName: 'Eric', conditions: forErick })).toHaveLength(0);
  });

  it('★ the name match is trimmed and case-insensitive, like every other source', () => {
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'bobby',
      conditions: [row({ ent_lead: '  Bobby ' })],
    });
    expect(items).toHaveLength(1);
  });

  it('★★ an acknowledged one never becomes an item at all', () => {
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'Bobby',
      conditions: [row({ acknowledged_at: T1, acknowledged_detail_hash: 'HASH-A' })],
    });
    expect(items).toHaveLength(0);
  });

  it('★★★ NO EPOCH CHECK — a condition true since before the deploy is the most worth saying', () => {
    // Every other source drops anything older than BOARD_NOTIFICATIONS_EPOCH,
    // because they report events and an old event is history. A condition is
    // not history; it is true right now.
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'Bobby',
      conditions: [row({ first_seen_at: '2020-01-01T00:00:00Z', last_seen_at: T1 })],
    });
    expect(items).toHaveLength(1);
  });

  it('★★ it sorts on last_seen, not first_seen — a three-week-old fact is not three-week-old news', () => {
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'Bobby',
      conditions: [row({ first_seen_at: '2020-01-01T00:00:00Z', last_seen_at: T1 })],
    });
    expect(items[0].at).toBe(T1);
  });

  it('★★★ B4: the key carries first_seen, so a RE-OPEN is new and a persisting one is not', () => {
    const a = keyForCondition('cond-1', T0);
    expect(a).toBe(`cond:cond-1:${T0}`);
    expect(keyForCondition('cond-1', T0)).toBe(a); // persisting → one key for life
    expect(keyForCondition('cond-1', T2)).not.toBe(a); // re-opened → new item
  });

  it('★★ the id comes back OUT of the key, and an ISO timestamp full of colons does not break it', () => {
    expect(conditionIdFromKey(keyForCondition('cond-1', T0))).toBe('cond-1');
    // ★ `.pop()` would have returned "52Z" here.
    expect(conditionIdFromKey('cond:abc:2026-08-20T21:04:52Z')).toBe('abc');
    expect(conditionIdFromKey('task:abc')).toBe('');
    expect(conditionIdFromKey('')).toBe('');
  });

  it('★ no actor, so it can never make a sound (fix-369’s person-vs-machine rule)', () => {
    const items = buildNewItems({
      ...EMPTY,
      viewerName: 'Bobby',
      conditions: [row()],
    });
    expect(items[0].actor).toBeNull();
  });
});

describe('fix-438 — the words', () => {
  it('★★ a known kind gets a sentence built from its detail', () => {
    const copy = conditionCopy(row({ detail: { days_in_corrections: 30, corr_issued: '2026-07-30' } }));
    expect(copy.title).toBe('In corrections with no resubmittal');
    expect(copy.subtitle).toBe(
      '30 days in corrections with nothing uploaded. Corrections issued 2026-07-30.',
    );
  });

  it('★ the DAY COUNT is in the sentence even though it is out of the hash', () => {
    // Different jobs: the hash decides whether to interrupt somebody again, the
    // sentence tells them how bad it is now.
    expect(conditionCopy(row({ detail: { days_in_corrections: 44 } })).subtitle).toContain('44');
  });

  it('★★ an UNKNOWN kind still surfaces, humanised — a missing label is not a missing problem', () => {
    const copy = conditionCopy(row({ kind: 'scraper:something_new', detail: {} }));
    expect(copy.title).toBe('Something new');
    expect(copy.subtitle).toBeNull();
  });

  it('★ both kinds the migration documents have copy', () => {
    expect(KNOWN_CONDITION_KINDS).toEqual([
      'scraper:mbp_resubmittal',
      'scraper:cycle_disagreement',
    ]);
    // ★★ Asserted against the RAW migration, not the stripped SQL, and that is
    //    the right target: a KIND IS DATA, not schema. The migration hard-codes
    //    none of them — the CHECK only requires a namespace — so the only place
    //    they appear is the prose that documents what the scraper will send.
    //    Pinning it keeps fix-439's payload and this build's copy map together.
    for (const k of KNOWN_CONDITION_KINDS) expect(MIGRATION).toContain(k);
    expect(SQL).not.toContain('mbp_resubmittal');
  });
});

// ---------------------------------------------------------------------------
// The migration itself
// ---------------------------------------------------------------------------

describe('fix-438 — the migration says what the model needs it to say', () => {
  it('the comment stripper actually stripped', () => {
    expect(MIGRATION).toContain('A STANDING CONDITION IS ONE SELF-CLEARING ROW');
    expect(SQL).not.toContain('A STANDING CONDITION IS ONE SELF-CLEARING ROW');
  });

  it('★★★ ONE ROW PER CONDITION is a UNIQUE INDEX, not a promise the writer keeps', () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?ON public\.permit_conditions \(tenant_id, permit_id, kind, cond_key\)/,
    );
    // ★★ cond_key defaults to '' and is NOT NULL — NULL is not equal to itself
    //    in a unique index, and the whole guarantee would evaporate for every
    //    row that needed no disambiguator.
    expect(SQL).toMatch(/cond_key\s+text NOT NULL DEFAULT ''/);
  });

  it('★★ the grants follow the permit_task_audit model, naming `authenticated` explicitly', () => {
    expect(SQL).toContain('REVOKE ALL ON TABLE public.permit_conditions FROM PUBLIC, anon;');
    // ★ A bare REVOKE ... FROM PUBLIC, anon leaves the ALTER DEFAULT PRIVILEGES
    //   grant in place — the fix-265 lesson.
    expect(SQL).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.permit_conditions FROM authenticated;/,
    );
    expect(SQL).toContain('GRANT SELECT ON TABLE public.permit_conditions TO authenticated;');
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('★★ the read RPC is SECURITY INVOKER; only the sync is DEFINER', () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.bp_list_permit_conditions[\s\S]*?STABLE SECURITY INVOKER/,
    );
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.bp_sync_permit_conditions[\s\S]*?SECURITY DEFINER/,
    );
    // ★ …and the sync is not callable by a signed-in browser.
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.bp_sync_permit_conditions(integer, text, jsonb) TO service_role;',
    );
    expect(SQL).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bp_sync_permit_conditions\(integer, text, jsonb\) TO authenticated/,
    );
  });

  it('★★★ acknowledge is gated on the ENT LEAD or an admin, matched on the WHOLE name', () => {
    const fn = SQL.slice(
      SQL.indexOf('FUNCTION public.bp_acknowledge_permit_condition'),
      SQL.indexOf('bp_list_permit_conditions'),
    );
    expect(fn).toContain('public.is_tenant_admin(v_tenant)');
    expect(fn).toContain('lower(btrim(tm.name)) = lower(btrim(v_ent_lead))');
    // ★★★ Eric ≠ Erick: never a prefix, never a LIKE.
    expect(fn).not.toMatch(/LIKE|position\(|starts_with/i);
    // ★ Audited — acknowledging IS an event, even though the condition is not.
    expect(fn).toContain("'condition_acknowledged'");
  });

  it('★★★ C1 — the OLD signatures are DROPPED, not merely replaced', () => {
    // CREATE OR REPLACE with a new argument list makes an OVERLOAD. Both
    // bp_list_error_groups(text[]) and (text[],boolean) would exist and
    // PostgREST would refuse the call as ambiguous; bp_new_error_count() beside
    // bp_new_error_count(boolean) makes the zero-arg call "not unique".
    expect(SQL).toContain('DROP FUNCTION IF EXISTS public.bp_list_error_groups(text[]);');
    expect(SQL).toContain('DROP FUNCTION IF EXISTS public.bp_new_error_count();');
  });

  it('★★★ C1 — scraper rows are EXCLUDED, never deleted or updated', () => {
    expect(SQL).toMatch(/p_include_scraper boolean DEFAULT false/);
    // Both readers carry the same predicate.
    expect(SQL.match(/\(p_include_scraper OR source <> 'scraper'\)/g)).toHaveLength(2);
    // ★★ Nothing touches the 229 historical rows. If Bobby wants them marked,
    //    that is a separate approval.
    expect(SQL).not.toMatch(/UPDATE\s+public\.error_reports/i);
    expect(SQL).not.toMatch(/DELETE\s+FROM\s+public\.error_reports/i);
  });

  it('★★★ C2 — the sample comes from the FIRST row, with an id tie-break', () => {
    // created_at is set from now(), which is CONSTANT within a transaction: 89
    // of those rows share one run and several share a timestamp to the
    // microsecond, so without `, id ASC` the "first" row is whichever the
    // planner felt like.
    expect(SQL).toMatch(
      /\(array_agg\(message\s+ORDER BY created_at ASC, id ASC\)\)\[1\] AS sample_message/,
    );
    expect(SQL).toMatch(
      /\(array_agg\(context\s+ORDER BY created_at ASC, id ASC\)\)\[1\] AS sample_context/,
    );
    // ★ Triage STATE stays newest-first: it drives the filter.
    expect(SQL).toMatch(
      /\(array_agg\(status\s+ORDER BY created_at DESC, id DESC\)\)\[1\] AS status/,
    );
    expect(SQL).toMatch(
      /COUNT\(DISTINCT context->>'permit_id'\)::int AS permit_count/,
    );
  });

  it('★★★ the table is PUBLISHED for realtime — adding the key is half the job', () => {
    expect(SQL).toContain(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.permit_conditions;',
    );
    expect(REALTIME_TABLES).toHaveProperty('permit_conditions');
    expect(REALTIME_TABLES.permit_conditions).toEqual([queryKeys.permitConditionsAll]);
  });

  it('★ the migration is one transaction', () => {
    expect(SQL.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(SQL).toContain('COMMIT;');
  });
});
