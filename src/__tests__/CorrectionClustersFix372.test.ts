import { describe, it, expect } from 'vitest';
import migration from '../../migrations/fix_372_correction_clusters.sql?raw';
import libSource from '../lib/correctionClusters.ts?raw';
import pageSource from '../pages/CorrectionPatterns.tsx?raw';
import reportSource from '../pages/CorrectionsReport.tsx?raw';
import routerSource from '../router.tsx?raw';
import hookSource from '../hooks/useCorrectionClusters.ts?raw';
import saveFailureSource from '../lib/saveFailure.ts?raw';
import bannerSource from '../components/SaveFailureBanner.tsx?raw';
import appSource from '../App.tsx?raw';
import storeSource from '../stores/saveFailureStore.ts?raw';
import {
  CURATION_CONTROLS,
  byProjectReach,
  chipsOf,
  clusterName,
  isSingleProject,
  projectsOf,
  reachVerdict,
  resolveMerge,
  wordingsOf,
  type CorrectionCluster,
  type CorrectionClusterItem,
} from '../lib/correctionClusters';
import {
  describeMutation,
  failureDetail,
  failureHeadline,
  isNetworkFailure,
  RETRY_DESCRIPTION,
  RETRY_LABEL,
} from '../lib/saveFailure';

// ===========================================================================
// fix-372 — the corrections report names categories but never the correction
// ===========================================================================
//
// Bobby: *"What makes up that 78%? Is it 42% are getting this one correction,
// and then it applies to 36 projects, and then we can just click and see all 36
// projects."* … *"how do I know which corrections are constantly occurring so
// that I can update our template? That's the mindset."*

// ★ Both comment forms. The migration explains the contract it keeps, so its
// own prose quotes the things these assertions forbid — the trap that has now
// bitten three tickets.
const SQL = migration
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*--.*$/gm, '');

function cluster(over: Partial<CorrectionCluster> = {}): CorrectionCluster {
  return {
    cluster_key: 'subject:x',
    tier: 'subject',
    subject: 'X',
    label: 'X',
    display_name: null,
    item_count: 1,
    project_count: 1,
    reviewer_count: 1,
    distinct_bodies: 1,
    scope_projects: 118,
    project_share: 0.8,
    wording_variance: 1,
    is_verbatim: false,
    hidden: false,
    merged_into_key: null,
    fix_note: null,
    fix_note_by_name: null,
    fix_note_at: null,
    addressed_on: null,
    occurrences_after_addressed: 0,
    first_seen: null,
    last_seen: null,
    sheets: [],
    codes: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §1 — ★★★ rank by share of projects, never by item count
// ---------------------------------------------------------------------------

describe('fix-372 §1: the ranking is by project reach', () => {
  // THE REAL SHAPES, from prod 2026-08-20.
  const bellevueShaped = cluster({
    cluster_key: 'subject:(no subject)',
    label: '(no subject)',
    item_count: 484,          // the LARGEST bucket in the corpus
    project_count: 1,         // …and one Bellevue project
    project_share: 0.8,
  });
  const seattleShaped = cluster({
    cluster_key: 'subject:general',
    label: 'General',
    item_count: 440,
    project_count: 75,
    project_share: 63.6,
  });

  it('★★★ a Bellevue-shaped population cannot outrank a Seattle-shaped one', () => {
    // ★★★ THE EXACT INVERSION THIS TICKET EXISTS TO PREVENT. Bellevue sends one
    // wholistic markup summary per round — 31.8 items per letter against
    // Seattle's 3.1 — so 484 rows is two projects' worth of review and 440 rows
    // is seventy-five projects'. Sorting on items puts the wrong one first.
    expect(bellevueShaped.item_count).toBeGreaterThan(seattleShaped.item_count);
    const ranked = [bellevueShaped, seattleShaped].sort(byProjectReach);
    expect(ranked[0].label).toBe('General');
    // ★ Verified against the live ranking too: `(no subject)` comes 183rd.
    expect(seattleShaped.project_count / bellevueShaped.project_count).toBe(75);
  });

  it('★★ items are a TIE-BREAK, never a rank', () => {
    const a = cluster({ cluster_key: 'a', project_count: 29, item_count: 33 });
    const b = cluster({ cluster_key: 'b', project_count: 29, item_count: 36 });
    // Equal reach — the real `Addressing` / `ASSIGNED ADDRESSES` pair — so the
    // larger count wins the tie and only the tie.
    expect([a, b].sort(byProjectReach)[0].cluster_key).toBe('b');
    const c = cluster({ cluster_key: 'c', project_count: 30, item_count: 1 });
    expect([b, c].sort(byProjectReach)[0].cluster_key).toBe('c');
  });

  it('★★ the SQL orders on projects and the denominator is the scope', () => {
    expect(SQL).toContain('ORDER BY a.projects DESC, a.items DESC, a.cluster_key ASC');
    // ★★ The denominator is projects with corrections IN THE SELECTED
    // JURISDICTION, not all projects and not all corrections.
    expect(SQL).toMatch(/WITH scope AS \([\s\S]*?count\(DISTINCT ci\.project_id\)/);
    expect(SQL).toMatch(/scope AS \([\s\S]*?p_juris IS NULL OR pr\.juris = p_juris/);
    expect(SQL).toContain('a.projects::numeric * 100 / (SELECT n FROM scope)');
  });

  it('★★ percentages are computed against the SELECTED scope, not all projects', () => {
    // Same cluster, two scopes. A Seattle-only view must not divide by the
    // whole-book denominator.
    const all = cluster({ project_count: 39, scope_projects: 118, project_share: 33.1 });
    const seattleOnly = cluster({ project_count: 39, scope_projects: 105, project_share: 37.1 });
    expect(seattleOnly.project_share).toBeGreaterThan(all.project_share);
    expect(pageSource).toContain('useCorrectionClusterRanking(juris, tier, includeVerbatim)');
    expect(hookSource).toContain('p_juris: juris');
  });

  it('★ jurisdiction is a filter with an All option, not fixed tabs', () => {
    expect(pageSource).toContain('patterns-juris');
    expect(pageSource).toMatch(/<option value="">All<\/option>/);
  });

  it('★★★ nothing anywhere sorts on item count', () => {
    const body = strip(libSource) + strip(pageSource);
    expect(body).not.toMatch(/sort\([^)]*item_count[^)]*\)/);
    expect(SQL).not.toMatch(/ORDER BY[^;]*a\.items DESC,\s*a\.projects/);
  });
});

// ---------------------------------------------------------------------------
// §2 — ★★★ two tiers
// ---------------------------------------------------------------------------

describe('fix-372 §2: the subject is the cluster where the city gives one', () => {
  it('★★★ a coded subject with 100 distinct bodies is still ONE correction', () => {
    // `302 Fire Separation`, from the real data: 106 items, 39 projects, 22
    // reviewers, 103 distinct bodies. Essentially nothing repeats.
    const fire = cluster({
      cluster_key: 'subject:302 fire separation',
      label: '302 Fire Separation',
      item_count: 106,
      project_count: 39,
      reviewer_count: 22,
      distinct_bodies: 103,
      project_share: 33.1,
      wording_variance: 0.97,
    });
    // It is one row, not 103.
    expect(fire.distinct_bodies).toBeGreaterThan(100);
    expect(isSingleProject(fire)).toBe(false);
    // ★★★ And the screen says WHY that makes it more of a template item, not
    // less — the single most useful judgement the report can make.
    const verdict = reachVerdict(fire);
    expect(verdict).toContain('22 reviewers');
    expect(verdict).toContain('103 different ways');
    expect(verdict).toMatch(/plan-set gap/);
  });

  it('★★ tier 1 needs no matching at all — the SQL says so', () => {
    expect(SQL).toContain("'subject:' || i.subject_key");
    // Grouped by the KEY, not the raw subject: two casings of one subject were
    // a unique-constraint violation the prod probe caught before shipping.
    expect(SQL).toContain('GROUP BY i.subject_key');
  });

  it('★★ the two Bellevue buckets are never a cross-project pattern', () => {
    for (const label of ['(no subject)', 'BUILDING concern']) {
      const c = cluster({ label, item_count: 484, project_count: 1, project_share: 0.8 });
      expect(isSingleProject(c)).toBe(true);
      expect(reachVerdict(c)).toBeNull();
    }
    // ★ Named on the row rather than silently dropped.
    expect(pageSource).toContain('pattern-single-project');
    expect(pageSource).toContain('not a cross-project pattern');
    // ★ And no special case in the SQL — reach ranking drops them by itself.
    // ('(no subject)' appears once, as the default LABEL for an empty subject,
    // which is a name and not a rule.)
    expect(SQL).not.toMatch(/Bellevue|BUILDING concern/);
    expect((SQL.match(/\(no subject\)/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — ★★★ the clustering rule, and the measurement behind it
// ---------------------------------------------------------------------------

describe('fix-372 §3: the clustering rule', () => {
  it('★★★ seed-and-attract, NOT single-link transitive closure', () => {
    // ★★★ THE WHOLE SAFETY ARGUMENT. Single-link chains — A~B, B~C, and A and C
    // land in one pile having nothing in common. Every member here is measured
    // against the SEED, which bounds how far a cluster can drift.
    expect(SQL).toMatch(/INSERT INTO _cc_assign \(id, seed\)[\s\S]*?WHERE e\.a = v_seed/);
    expect(SQL).not.toMatch(/RECURSIVE[\s\S]*?_cc_edge/);
    // The seed is deterministic, so two rebuilds pick the same one and the
    // cluster_key does not move.
    expect(SQL).toContain('DESC, n.id ASC');
  });

  it('★★ the threshold is 0.60 and is single-sourced', () => {
    expect(SQL).toContain('SELECT 0.60::real');
    expect(SQL).toContain('v_thresh   real := public.bp_correction_similarity_threshold()');
    // MEASURED on General (438 eligible items, 75 projects):
    //   0.50 -> 24 clusters / 273 items | 0.55 -> 27 / 274
    //   0.60 -> 29 / 260  (shipped)     | 0.70 -> 30 / 238
    // Below 0.60 coverage is FLAT while clusters fall: loosening buys merges,
    // not reach.
    expect(migration).toContain('0.60        29        260');
  });

  it('★★ the normaliser drops digits on purpose, and they come back as chips', () => {
    // A sheet number is the most variable token in an otherwise identical
    // sentence — "sheet C1.0" here, "sheet C1.1" there — so keeping it would
    // split one correction into one cluster per project.
    expect(SQL).toContain("regexp_replace(lower(btrim(coalesce(p_body, ''))), '[^a-z ]+', ' ', 'g')");
    expect(SQL).toContain('bp_correction_sheets');
  });

  it('★ verbatim boilerplate is a FACT and is never deleted', () => {
    expect(SQL).toContain('bp_correction_verbatim_projects');
    expect(SQL).toContain('is_verbatim');
    // Hidden by default behind a VISIBLE COUNT, with a toggle.
    expect(pageSource).toContain('patterns-verbatim-hidden');
    expect(pageSource).toContain('patterns-verbatim-toggle');
    expect(SQL).toContain('p_include_verbatim OR NOT a.is_verbatim');
    // ★ And no DELETE of anything it decides is boilerplate.
    expect(SQL).not.toMatch(/DELETE FROM public\.correction_items/);
  });
});

// ---------------------------------------------------------------------------
// §4 — ★★★ what a person reads when they drill in
// ---------------------------------------------------------------------------

function item(over: Partial<CorrectionClusterItem> = {}): CorrectionClusterItem {
  return {
    item_id: 'i1',
    project_id: 'p1',
    address: '233 31st Ave E',
    juris: 'Seattle',
    reviewer: 'Jessica',
    letter_date: '2026-08-01',
    cycle: 1,
    body: 'On the CSC/Soil Plan – sheet C1.0, please show and label the tree protection.',
    sheets: ['C1.0'],
    codes: [],
    ...over,
  };
}

describe('fix-372 §4: the drill-in payload', () => {
  it('★★★ extracted chips come from pattern matches, and count REVIEWERS', () => {
    // ★★★ `Sheet A6.1` across five separate reviewers is the single most
    // actionable fact this feature produces: it says where the change goes.
    const items = [
      item({ reviewer: 'A', sheets: ['A6.1'] }),
      item({ reviewer: 'B', sheets: ['A6.1'] }),
      item({ reviewer: 'C', sheets: ['A6.1'] }),
      item({ reviewer: 'D', sheets: ['A6.1'] }),
      item({ reviewer: 'E', sheets: ['A6.1', 'A2.0'] }),
    ];
    const chips = chipsOf(items, 'sheets');
    expect(chips[0]).toEqual({ value: 'A6.1', reviewers: 5, items: 5 });
    expect(chips[1]).toEqual({ value: 'A2.0', reviewers: 1, items: 1 });
  });

  it('★ a body with no sheet shows NO chip, never an invented one', () => {
    expect(chipsOf([item({ sheets: [], codes: [] })], 'sheets')).toEqual([]);
    expect(pageSource).toContain('pattern-no-chips');
    expect(pageSource).toContain('No sheet or code reference in any of these comments.');
  });

  it('★★★ the fix note is stored and rendered verbatim — nothing generates it', () => {
    // ★★ Bobby approved this explicitly: a summary that quietly invented a
    // requirement would drive a wrong change to the standard plan set.
    const note = 'Add the HRV detail and the AHRI efficiency note to A6.1.';
    const c = cluster({ fix_note: note, fix_note_by_name: 'Bobby', fix_note_at: '2026-08-21T10:00:00Z' });
    expect(c.fix_note).toBe(note);
    // Rendered straight, with who wrote it.
    expect(pageSource).toContain('{cluster.fix_note}');
    expect(pageSource).toContain('cluster.fix_note_by_name');
    // *** Nothing anywhere GENERATES text. Asserted on the mechanisms rather
    // than on the word: the control's own tooltip says "nothing summarises
    // the reviewer's text for you", which is the promise, not a breach of it.
    const all = strip(libSource) + strip(pageSource) + SQL;
    expect(all).not.toMatch(/openai|anthropic|\bllm\b|gpt-|completions?\(|generateText/i);
    // ** And the note that renders is the note that was stored - no truncation,
    // no rewrite, no fallback text standing in for a person's words.
    expect(pageSource).not.toMatch(/fix_note\b[^\n]*\.(slice|substring|replace)\(/);
  });

  it('★ verbatim quotes are the stored body, never paraphrased', () => {
    // Including the OCR bleed the two-column read leaves behind.
    const chewed = 'CCORDANCE WITH AHRI 550/590 REDUC Sheet A6.1 AND INTERNATIO';
    const w = wordingsOf([item({ body: chewed })]);
    expect(w[0].body).toBe(chewed);
    // The renderer prints w.body and nothing else.
    expect(pageSource).toContain('{w.body}');
    expect(strip(libSource)).not.toMatch(/\.slice\(0,\s*\d+\)\s*\+\s*['"]…/);
  });

  it('★★ wordings are grouped per reviewer with project counts', () => {
    const w = wordingsOf([
      item({ reviewer: 'Jessica', project_id: 'p1' }),
      item({ reviewer: 'Jessica', project_id: 'p2' }),
      item({ reviewer: 'Marc', project_id: 'p3', body: 'Different wording entirely.' }),
    ]);
    expect(w[0].reviewer).toBe('Jessica');
    expect(w[0].projects).toBe(2);
    expect(w[1].reviewer).toBe('Marc');
  });

  it('★ the project list is names only — Bobby chose that over letter links', () => {
    const p = projectsOf([item(), item({ project_id: 'p2', address: '4017 Corliss Ave N' })]);
    expect(p.map((x) => x.address)).toEqual(['233 31st Ave E', '4017 Corliss Ave N']);
    expect(pageSource).toContain('pattern-project');
    // No link to the letter or its file.
    expect(pageSource).not.toMatch(/source_file|letter_url|to=\{`\/letter/);
  });
});

// ---------------------------------------------------------------------------
// §5 — ★★ curation, and the failure that would make it pointless
// ---------------------------------------------------------------------------

describe('fix-372 §5: curation', () => {
  it('★★★ a merge survives a re-cluster — the key is the anchor', () => {
    // ★★★ The clusters table is TRUNCATED and rebuilt by every re-index, so a
    // curation row pointing at a cluster ROW would dangle. It points at the
    // KEY, and for tier 1 the key is the city's own subject and cannot move.
    expect(SQL).toContain('DELETE FROM public.correction_clusters WHERE tenant_id = v_tenant');
    expect(SQL).not.toMatch(/DELETE FROM public\.correction_cluster_curation/);
    expect(SQL).toContain('UNIQUE (tenant_id, cluster_key)');
    // Proven on prod: merged `subject:addressing` into
    // `subject:assigned addresses for all units`, re-ran the whole rebuild, and
    // both merged_into_key and the 70-character fix note were still there.
    expect(migration).toContain('cluster_key, NOT on cluster id');
  });

  it('★★ curation that no longer matches is KEPT and listed, never deleted', () => {
    expect(SQL).toContain('bp_correction_curation_orphans');
    expect(SQL).toMatch(/NOT EXISTS \([\s\S]*?FROM public\.correction_clusters c/);
  });

  it('★ every curation control has a description', () => {
    // Bobby: "make sure you give a description of what they actually do,
    // because I'm not 100% sure on what their actionable item is."
    expect(CURATION_CONTROLS).toHaveLength(4);
    for (const c of CURATION_CONTROLS) {
      expect(c.description.length).toBeGreaterThan(60);
      expect(c.label.length).toBeGreaterThan(0);
    }
    expect(new Set(CURATION_CONTROLS.map((c) => c.action)).size).toBe(4);
    // …and it reaches the DOM, not only a tooltip.
    expect(pageSource).toContain('curation-description');
    expect(pageSource).toContain('title={c.description}');
  });

  it('★★ "addressed" keeps counting and separates what came after', () => {
    // ★★★ Otherwise nobody can tell whether the template change worked.
    const c = cluster({ addressed_on: '2026-07-01', occurrences_after_addressed: 3, item_count: 20 });
    expect(c.item_count).toBe(20);
    expect(c.occurrences_after_addressed).toBe(3);
    expect(SQL).toContain('m4.letter_date > cur.addressed_on');
    expect(pageSource).toContain('pattern-addressed');
  });

  it('★ a rename is what everyone else sees', () => {
    expect(clusterName(cluster({ label: 'Sheet A4.0 Per 2021 SEC section R402...' })))
      .toContain('Sheet A4.0');
    expect(clusterName(cluster({ display_name: 'Attic insulation notes' })))
      .toBe('Attic insulation notes');
  });

  it('★ a merge chain resolves and a cycle cannot spin', () => {
    const m = new Map([['a', 'b'], ['b', 'c']]);
    expect(resolveMerge('a', m)).toBe('c');
    expect(resolveMerge('a', new Map([['a', 'b'], ['b', 'a']]))).toBeTruthy();
    // …and the RPC refuses the degenerate case outright.
    expect(SQL).toContain('a cluster cannot be merged into itself');
  });
});

// ---------------------------------------------------------------------------
// Standing rules and where it lives
// ---------------------------------------------------------------------------

describe('fix-372: standing rules', () => {
  it('★★★ not one existing correction_items row is edited', () => {
    expect(SQL).not.toMatch(/UPDATE\s+public\.correction_items/);
    expect(SQL).not.toMatch(/DELETE\s+FROM\s+public\.correction_items/);
    expect(SQL).not.toMatch(/INSERT\s+INTO\s+public\.correction_items/);
  });

  it('★★ the existing report is level one and is not rebuilt', () => {
    // Its rows became doors; nothing it showed went away.
    expect(reportSource).toContain('corrections-to-patterns');
    expect(reportSource).toContain('/reports/corrections/patterns');
    expect(reportSource).toContain('corrections-report');
    expect(reportSource).toContain('corrections-stat-repeat-rate');
  });

  it('★ the drill-down is its own static route under the reports surface', () => {
    // fix-367 moved Saved Reports out of /settings; reports live under /reports.
    expect(routerSource).toContain("path: 'reports/corrections/patterns'");
    expect(routerSource).toContain('<CorrectionPatterns />');
    expect(routerSource).toContain('reports/corrections/patterns');
  });

  it('★★ no level dead-ends', () => {
    // Level 2 opens into level 3, and level 3 renders chips, a note, wordings
    // and projects — every one of them built.
    expect(pageSource).toContain('pattern-detail-');
    expect(pageSource).toContain('pattern-chips');
    expect(pageSource).toContain('pattern-wordings');
    expect(pageSource).toContain('pattern-projects');
    expect(pageSource).toContain('pattern-drill-subject');
    expect(pageSource).not.toMatch(/phase 2|coming soon|TODO|not implemented/i);
  });

  it('★ anon gets nothing and every function pins search_path', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.bp_rebuild_correction_clusters() FROM PUBLIC, anon');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.bp_correction_cluster_ranking(text, text, boolean) TO authenticated, service_role');
    const fns = SQL.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
    const paths = SQL.match(/SET search_path TO 'public'/g) ?? [];
    expect(paths.length).toBeGreaterThanOrEqual(fns.length);
  });
});

// ---------------------------------------------------------------------------
// §6 — ★★★ a save that died on the wire, independent of everything above
// ---------------------------------------------------------------------------

describe('fix-372 §6: a failed save surfaces to the person', () => {
  it('★★★ the real logged shape is recognised as a network failure', () => {
    // LOGGED IN PROD: TypeError "Failed to fetch", 3 occurrences, 2 users,
    // 14 / 17 / 20 August.
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    // ★★★ …and NOT by its message. fix-357's lesson: the wording is
    // browser-specific, so the TYPE is the test.
    expect(isNetworkFailure(new TypeError('NetworkError when attempting to fetch resource'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
    const body = strip(saveFailureSource);
    expect(body).toContain('err instanceof TypeError');
  });

  it('★★ a server that ANSWERED and refused is not a network failure', () => {
    // A PostgrestError has a code; an HTTP error has a status. Either means the
    // request completed, so the write definitely did not land — a different
    // sentence.
    expect(isNetworkFailure({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isNetworkFailure({ status: 403, message: 'permission denied' })).toBe(false);
  });

  it('★★★ a network failure is reported as MAY not have saved, never as lost', () => {
    // ★★ The request left; the answer is what went missing. Telling somebody
    // their edit was lost when it was not is how they redo work already done —
    // which for a date field overwrites the newer value with the older one.
    const net = { kind: 'network' as const, what: 'upsert permit cycle', message: 'Failed to fetch', at: 0, newBuildAvailable: false };
    expect(failureHeadline(net)).toContain('may not have been saved');
    expect(failureDetail(net)).toContain('may have gone');
    const rejected = { ...net, kind: 'rejected' as const };
    expect(failureHeadline(rejected)).toContain('was not saved');
    expect(failureDetail(rejected)).toContain('Nothing was written');
  });

  it('★★★ the retry CANNOT double-write — it re-reads instead', () => {
    // ★★ Most mutations here are not idempotent: a duplicated note is a real
    // artefact. So the honest answer is re-read, then let them decide.
    expect(RETRY_LABEL).toBe('Check what saved');
    expect(RETRY_DESCRIPTION).toContain('does not re-send');
    const body = strip(bannerSource);
    expect(body).toContain('refetchQueries');
    // ★★★ The guard, asserted: nothing in the banner re-runs a mutation.
    expect(body).not.toMatch(/\.mutate\(|mutateAsync|retry\(\)/);
    expect(body).toContain('title={RETRY_DESCRIPTION}');
  });

  it('★★ it does NOT fade — a toast was the wrong shape', () => {
    // toastStore auto-dismisses after six seconds (fix-86, deliberately). A
    // person who looked away would come back to a screen showing their edit,
    // with nothing saying it might not be on the server.
    const body = strip(bannerSource) + strip(storeSource);
    expect(body).not.toContain('AUTO_DISMISS');
    expect(body).not.toContain('setTimeout');
    expect(body).toContain('save-failure-dismiss');
    expect(strip(bannerSource)).toContain("role=\"alert\"");
  });

  it('★★ it is reported BEFORE the log-suppression check', () => {
    // That check keeps Error Reports quiet about expected rejections. It must
    // never decide whether a person is told their save may not have landed.
    const body = strip(appSource);
    const report = body.indexOf('useSaveFailureStore.getState().report');
    const skip = body.indexOf('shouldSkipBackendRpcLog(err, key)');
    expect(report).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(report);
  });

  it('★ a deploy is named when the version signal says one happened', () => {
    // fix-371 §4 already knows. A deploy restart drops in-flight requests and
    // is the one cause here that is both known and recoverable.
    const deployed = { kind: 'network' as const, what: 'save', message: '', at: 0, newBuildAvailable: true };
    expect(failureDetail(deployed)).toContain('new version');
    expect(failureDetail(deployed)).toContain('Reload');
    expect(strip(appSource)).toContain('newBuildIsLive()');
  });

  it('★ the mutation key becomes something a person recognises', () => {
    expect(describeMutation(['upsert-permit-cycle', 12])).toBe('upsert permit cycle');
    expect(describeMutation(undefined)).toBe('your change');
    expect(describeMutation([])).toBe('your change');
  });

  it('★ no offline queue and no optimistic replay — the scope line holds', () => {
    const body = strip(saveFailureSource) + strip(bannerSource) + strip(storeSource);
    expect(body).not.toMatch(/queue|replay|localStorage|indexedDB/i);
  });
});

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}
