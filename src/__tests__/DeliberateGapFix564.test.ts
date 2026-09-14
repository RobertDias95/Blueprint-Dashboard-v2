import { describe, it, expect } from 'vitest';
import {
  conditionCanNotify,
  conditionCopy,
  NEVER_NOTIFY_CONDITION_KINDS,
  type PermitConditionRow,
} from '../lib/permitConditions';
import {
  isNotTrackedPermit,
  NOT_TRACKED_PERMIT_TYPES,
  NOT_TRACKED_LABEL,
  NOT_TRACKED_TITLE,
} from '../lib/permitTracking';
import { buildNewItems } from '../lib/boardReads';

// ===========================================================================
// ★★★ fix-564 (P-269) — A DELIBERATE GAP STOPS BEING NEWS, AND A PERMIT SAYS
//     IT IS NOT TRACKED
// ===========================================================================
//
// Bobby and Miles, 2026-09-14: *"miles got this notification and we are both
// unsure of what it means."* ★ **If the two people who run permitting cannot
// read it, it is not a notification.**
//
// ★★★ WHERE THE ITEM ACTUALLY CAME FROM — measured, and not where the brief
//     looked. It is **not** an `audit_log` row reaching the panel: `parseFlips`
//     has skipped the whole `scrape_workflow_fetch_failed` action since fix-298
//     (`SUPPRESSED_ACTIONS`, boardFlips.ts). It is a **permit condition**
//     (fix-438): `permit_conditions` holds **14 open rows of kind
//     `scraper:module_unsupported`** — Miles 10 (7 IPR + 3 TRAO), Briana 4 —
//     and `buildNewItems` source 10 routes each to its ENT lead.
//
// ★★★ AND THE WORDS WERE THE MACHINE'S OWN KEY. Nobody wrote copy for that
//     kind, so `conditionCopy`'s FALLBACK humanised the stored string:
//     `scraper:module_unsupported` → **"Module unsupported"**. That fallback is
//     a good rule (an unnamed condition is a missing label, not a missing
//     problem) and it was doing its job; this kind simply must not be news.
//
// ★★★ PROD, 2026-09-14 — `scrape_workflow_fetch_failed`, 21 days, 288 rows,
//     and the brief's "every recent one is module_unsupported" is true only of
//     the RECENT ones. Three reasons, and they are not alike:
//
//       module_unsupported: SPUEngineering   86 rows /   9 permits  (IPR)
//       module_unsupported: DPDEnforcement   47 rows /   6 permits  (TRAO)
//       moduleName_parse_failed             148 rows / 148 permits  (one day)
//       adapter:fetch_error … 403 Forbidden    7 rows /   7 permits  (one day)
//
//     **133 of 288 are the permanent gap; 155 are not.** The gap is the only
//     reason still firing on every run (2026-08-27 → today); the other two are
//     single-day incidents — 148 parse failures on 28 Aug and seven Redmond
//     403s on 9 Sep. ★★★ **A filter written on the ACTION would have silenced
//     all 155**, including a jurisdiction locking us out with a 403.

const NOW = '2026-09-14T12:00:00Z';

function condition(over: Partial<PermitConditionRow> = {}): PermitConditionRow {
  return {
    id: 'c-1',
    permit_id: 10101,
    permit_num: 'SPUE-IPR-26-00393',
    cond_key: '',
    seen_count: 1,
    project_id: 'p-1',
    kind: 'scraper:mbp_resubmittal',
    detail: {},
    detail_hash: 'h1',
    first_seen_at: NOW,
    last_seen_at: NOW,
    cleared_at: null,
    acknowledged_at: null,
    acknowledged_detail_hash: null,
    ent_lead: 'Miles',
    address: '2039 N 78th St',
    permit_type: 'IPR',
    ...over,
  } as PermitConditionRow;
}

describe('fix-564 §A — the deliberate gap produces no notification', () => {
  it('★★★ a `module_unsupported` condition never reaches a person', () => {
    expect(conditionCanNotify({ kind: 'scraper:module_unsupported' })).toBe(false);
  });

  it('★★★ …and the OTHER live kind still does — the news this panel exists for', () => {
    // ★★★ ASSERTED WITH THE REAL NEIGHBOURING KIND, not by reading the filter.
    //     `scraper:mbp_resubmittal` is "18 days in corrections with nothing
    //     uploaded" — 2 open rows on prod. A filter one level coarser (all
    //     conditions, or all scraper: kinds) would have taken it too.
    expect(conditionCanNotify({ kind: 'scraper:mbp_resubmittal' })).toBe(true);
    expect(conditionCanNotify({ kind: 'scraper:cycle_disagreement' })).toBe(true);
  });

  it('★★★ an UNNAMED kind still reaches its lead — fix-438’s rule is intact', () => {
    // ★★ The fallback exists because "an unnamed condition is a missing label,
    //    not a missing problem". Suppressing by kind must not become
    //    suppressing everything nobody has worded yet.
    expect(conditionCanNotify({ kind: 'scraper:something_new' })).toBe(true);
  });

  it('★★ exactly ONE kind is suppressed, and it is named', () => {
    expect([...NEVER_NOTIFY_CONDITION_KINDS]).toEqual([
      'scraper:module_unsupported',
    ]);
  });

  it('★★★ buildNewItems drops it and keeps the corrections one — end to end', () => {
    const items = buildNewItems({
      flips: [],
      tasks: [],
      acks: [],
      permits: [],
      viewerName: 'Miles',
      conditions: [
        condition({ id: 'c-1', kind: 'scraper:module_unsupported', permit_id: 1 }),
        condition({ id: 'c-2', kind: 'scraper:mbp_resubmittal', permit_id: 2 }),
      ],
    });
    const kinds = items.filter((i) => i.source === 'condition');
    expect(kinds).toHaveLength(1);
    expect(kinds[0].title).toBe('In corrections with no resubmittal');
  });

  it('★★★ the words Miles saw were the machine’s own key — recorded, not fixed here', () => {
    // ★ `conditionCopy` is untouched: the fallback is correct behaviour for an
    //   unnamed kind. This asserts WHY the item was unreadable, so a future
    //   reader does not go looking for a copy bug.
    expect(conditionCopy(condition({ kind: 'scraper:module_unsupported' })).title)
      .toBe('Module unsupported');
  });
});

describe('fix-564 §B — a permit in a deferred collection says it is not tracked', () => {
  it('★★★ an IPR and a TRAO both carry the marker', () => {
    expect(isNotTrackedPermit({ type: 'IPR' })).toBe(true);
    expect(isNotTrackedPermit({ type: 'TRAO' })).toBe(true);
  });

  it('★★★ a Building Permit and a ULS do not', () => {
    expect(isNotTrackedPermit({ type: 'Building Permit' })).toBe(false);
    expect(isNotTrackedPermit({ type: 'ULS' })).toBe(false);
    expect(isNotTrackedPermit({ type: 'Demolition' })).toBe(false);
    expect(isNotTrackedPermit({ type: 'PAR/Pre-Sub' })).toBe(false);
  });

  it('★★★ it is DERIVED, so a permit created today carries it with no backfill', () => {
    // ★★★ The whole reason this is a type test and not a column: a row that
    //     does not exist yet, with no `last_scraper_update_at` and no history,
    //     is correct the instant it is inserted.
    const brandNew = {
      id: 99999,
      type: 'IPR',
      status: null,
      last_scraper_update_at: null,
      created_at: NOW,
    };
    expect(isNotTrackedPermit(brandNew)).toBe(true);
  });

  it('★★ an unknown or missing type is TRACKED — fail towards the safer claim', () => {
    // ★ Saying "not tracked" about a permit we might be refreshing is the worse
    //   of the two mistakes: it invites a person to hand-edit a field the
    //   scraper will overwrite.
    expect(isNotTrackedPermit({ type: null })).toBe(false);
    expect(isNotTrackedPermit({ type: '' })).toBe(false);
    expect(isNotTrackedPermit({ type: '   ' })).toBe(false);
    expect(isNotTrackedPermit(null)).toBe(false);
    expect(isNotTrackedPermit(undefined)).toBe(false);
  });

  it('★★ the type match is exact — no prefix, no substring', () => {
    // ★ fix-415's lesson: a substring filter let `NR` swallow `NR3`.
    expect(isNotTrackedPermit({ type: 'IPR-2' })).toBe(false);
    expect(isNotTrackedPermit({ type: 'TRAOX' })).toBe(false);
    expect(NOT_TRACKED_PERMIT_TYPES.size).toBe(2);
  });

  it('★★★ nothing a person reads says "module"', () => {
    // ★★★ The reason is a fact about our scraper's internals. The reader needs
    //     to know what to DO. Explicit in the brief, and asserted so a later
    //     "helpful" edit cannot put the jargon back.
    expect(NOT_TRACKED_LABEL.toLowerCase()).not.toContain('module');
    expect(NOT_TRACKED_TITLE.toLowerCase()).not.toContain('module');
    expect(NOT_TRACKED_LABEL).toBe('Not tracked — update manually');
    // ★ and it says what to do, not what broke.
    expect(NOT_TRACKED_TITLE.toLowerCase()).toContain('by hand');
  });

  it('★★ the marker is pure — it reads a type and writes nothing', () => {
    // ★ "No test writes to `permits`" is a brief rule; this makes the helper's
    //   own freedom from side effects assertable rather than assumed.
    const p = { type: 'IPR', status: 'Reviews In Process' };
    const before = JSON.stringify(p);
    isNotTrackedPermit(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});
