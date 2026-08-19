import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { stalenessNote } from '../lib/planOfRecordStaleness';
import type {
  ProjectPlanOfRecordRow,
  ProjectPlanOfRecordVerdictRow,
} from '../lib/database.types';

// ===========================================================================
// fix-358 — the card knows why, and shows nothing
// ===========================================================================
//
// fix-356 (scraper) built the reasoning behind the Design Plan of Record card
// and stored it. ★★ 138 verdicts were in the table and no Bridge code read it,
// so the half Bobby actually asked for was invisible:
//
//   "Hey, you had a couple of options here — why would you take that option
//    versus the other option that you already had?"
//
// ★★ MEASURED ON PROD 2026-08-20, and every number below comes from there:
//
//     verdict rows                     138
//     …with a stage chosen             105   every sentence names the file
//     …stage NULL, nothing qualified    33   no sentence names a file
//     projects with NO verdict row      19   15 redesigns + 4 unmatched folders
//     projects                         157
//     computed_at                        one instant, 2026-08-19 21:04Z
//
// ★★★ AND ONE THING THE BRIEF DID NOT KNOW: of the 33 that resolve to nothing,
// only 11 render blank today. The other 22 have a `project_plan_of_record` file
// row — a MARKETING set that the older view (fix-284) picks by stage rank and
// the newer reasoning (fix-356) rejects, always for the same stated cause:
// "none marked internal". So those 22 cards do not look broken today; they look
// CONFIDENT, and they are asserting a plan of record the reasoning denies.

const state = vi.hoisted(() => ({
  row: null as ProjectPlanOfRecordRow | null,
  verdict: null as ProjectPlanOfRecordVerdictRow | null,
  verdictLoading: false,
  thumbUrl: 'https://example.supabase.co/storage/v1/object/sign/plan-thumbnails/x.jpg?token=abc' as string | null,
}));

vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({
    data: state.row,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePlanOfRecordThumbnail: (path: string | null | undefined) => ({
    data: path ? state.thumbUrl : null,
    isLoading: false,
    error: null,
  }),
  THUMB_BUCKET: 'plan-thumbnails',
}));

vi.mock('../hooks/usePlanOfRecordVerdict', () => ({
  usePlanOfRecordVerdict: () => ({
    data: state.verdict,
    isLoading: state.verdictLoading,
    isError: false,
  }),
}));

vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

import PlanOfRecordCard from '../components/ProjectDetail/PlanOfRecordCard';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const FRESH = new Date(Date.now() - 2 * 86_400_000).toISOString();

/** ★ 12836 N 60th St's REAL row from prod — the brief's own example. */
function nothingQualified(
  over: Partial<ProjectPlanOfRecordVerdictRow> = {},
): ProjectPlanOfRecordVerdictRow {
  return {
    project_id: 'p1',
    stage: null,
    file_name: null,
    unc_path: null,
    sentence:
      '3 marketing sets, none marked internal · 1 schematic, not named for ' +
      'this project · no design guidance',
    verdict: {},
    computed_at: FRESH,
    ...over,
  };
}

/** ★ 224 2nd Ave N's real row — note the sentence ENDS in the file name. */
function chosenVerdict(
  over: Partial<ProjectPlanOfRecordVerdictRow> = {},
): ProjectPlanOfRecordVerdictRow {
  return {
    project_id: 'p1',
    stage: 'design_guidance',
    file_name: '224 2nd Ave N, Edmonds- DESIGN GUIDANCE.pdf',
    unc_path: '\\\\bpc-file\\SoleilData\\224 2nd Ave N - Roland - BP\\dg.pdf',
    sentence:
      '2 marketing sets, none marked internal · no schematic (7 files, none a ' +
      'drawing) · showing design guidance: 224 2nd Ave N, Edmonds- DESIGN GUIDANCE.pdf',
    verdict: {},
    computed_at: FRESH,
    ...over,
  };
}

function fileRow(over: Partial<ProjectPlanOfRecordRow> = {}): ProjectPlanOfRecordRow {
  return {
    project_id: 'p1',
    tenant_id: 't1',
    file_index_id: 'f1',
    set_type: 'marketing',
    stage_rank: 3,
    file_name: '12836 - Marketing Plans.pdf',
    unc_path: '\\\\bpc-file\\SoleilData\\12836 N 60th St\\12836 - Marketing Plans.pdf',
    folder_name: null,
    modified_at: '2026-04-09T00:00:00Z',
    size_kb: 4096,
    thumb_path: 'p1/marketing.jpg',
    thumb_status: 'ok',
    thumb_generated_at: '2026-08-19T21:04:30Z',
    ...over,
  };
}

beforeEach(() => {
  state.row = null;
  state.verdict = null;
  state.verdictLoading = false;
});

// ---------------------------------------------------------------------------
// §2 — two states, and they must not look alike
// ---------------------------------------------------------------------------

describe('fix-358 §2: nothing qualified is a DESIGNED state', () => {
  it('★★★ a NULL stage renders the empty state with its sentence', async () => {
    // 12836 N 60th St, verbatim from prod.
    state.verdict = nothingQualified();
    wrap(<PlanOfRecordCard projectId="p1" />);
    const box = await screen.findByTestId('plan-of-record-nothing-qualified');
    expect(box).toHaveTextContent('No approved design set filed');
    expect(screen.getByTestId('plan-of-record-verdict-sentence').textContent).toBe(
      '3 marketing sets, none marked internal · 1 schematic, not named for ' +
        'this project · no design guidance',
    );
  });

  it('★★ …and it is NOT a blank card — the reason is the content', async () => {
    state.verdict = nothingQualified();
    wrap(<PlanOfRecordCard projectId="p1" />);
    const box = await screen.findByTestId('plan-of-record-nothing-qualified');
    // Each blank becomes a specific filing request: this one says mark a
    // marketing set internal, or name the schematic for this project.
    expect(box.textContent).toMatch(/none marked internal/);
    expect(box.textContent!.length).toBeGreaterThan(60);
  });

  it('★★★ a missing verdict row renders NOT INDEXED, a different string', async () => {
    state.verdict = null;
    wrap(<PlanOfRecordCard projectId="p1" />);
    const box = await screen.findByTestId('plan-of-record-not-indexed');
    expect(box).toHaveTextContent('Not indexed yet');
    // ★ And the other state is nowhere on screen.
    expect(screen.queryByTestId('plan-of-record-nothing-qualified')).toBeNull();
  });

  it('★★★ the two are distinguishable in the DOM, not just in prose', async () => {
    // "This project has no design set" and "the tool has no opinion" must not
    // render identically — that is the exact failure fix-356 was built to end.
    state.verdict = nothingQualified();
    const a = wrap(<PlanOfRecordCard projectId="p1" />);
    const nothing = await screen.findByTestId('plan-of-record-nothing-qualified');
    const nothingText = nothing.textContent;
    a.unmount();

    state.verdict = null;
    wrap(<PlanOfRecordCard projectId="p1" />);
    const notIndexed = await screen.findByTestId('plan-of-record-not-indexed');

    expect(notIndexed.textContent).not.toBe(nothingText);
    // Two viewers, two different strings — asserted on the words, because a
    // different testid with the same sentence would still be the same bug.
    expect(notIndexed.textContent).not.toMatch(/no approved design set/i);
    expect(nothingText).not.toMatch(/not indexed/i);
  });

  it('★★★ …and they differ to the EYE too, not only to a reader', async () => {
    // Two different sentences inside one identical dashed frame is most of the
    // way to identical at the distance a card is actually read from. The frame
    // belongs to the state that has an answer; the state that has none is
    // unframed.
    state.verdict = nothingQualified();
    const a = wrap(<PlanOfRecordCard projectId="p1" />);
    expect(
      (await screen.findByTestId('plan-of-record-nothing-qualified')).className,
    ).toMatch(/border-dashed/);
    a.unmount();

    state.verdict = null;
    wrap(<PlanOfRecordCard projectId="p1" />);
    expect(
      (await screen.findByTestId('plan-of-record-not-indexed')).className,
    ).not.toMatch(/border/);
  });

  it('★★ "not indexed" never accuses the team of not filing', async () => {
    // 19 projects are here, and FOUR of them are live projects carrying 3 to 9
    // permits. Saying "no design set" to those would be wrong about a fact.
    state.verdict = null;
    wrap(<PlanOfRecordCard projectId="p1" />);
    const box = await screen.findByTestId('plan-of-record-not-indexed');
    expect(box.textContent).toMatch(/has not walked/i);
    expect(box.textContent).toMatch(/not a statement about what has been filed/i);
    expect(box.textContent).not.toMatch(/no design set/i);
  });

  it('★ the nothing-qualified state offers no controls — there is no file', async () => {
    state.verdict = nothingQualified();
    wrap(<PlanOfRecordCard projectId="p1" />);
    await screen.findByTestId('plan-of-record-nothing-qualified');
    expect(screen.queryByTestId('plan-of-record-copy')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-preview')).toBeNull();
  });

  it('★★★ and it WINS over a file row the older view still picks', async () => {
    // 22 of the 33 are here: fix-284's view picks a marketing set by stage
    // rank, fix-356 rejects it because none is marked internal. Showing the
    // preview would assert a plan of record the reasoning denies, and would put
    // the card and its own sentence in contradiction.
    state.verdict = nothingQualified();
    state.row = fileRow();
    wrap(<PlanOfRecordCard projectId="p1" />);
    await screen.findByTestId('plan-of-record-nothing-qualified');
    expect(screen.queryByTestId('plan-of-record-preview')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-copy')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §1 — render the sentence, never re-derive it
// ---------------------------------------------------------------------------

describe('fix-358 §1: the sentence is READ, never rebuilt', () => {
  it('★★★ no reason-code vocabulary appears anywhere in src/', async () => {
    // The vocabulary lives in one Python file on purpose (fix-356 §4).
    // Rebuilding the sentence here would be one rule in two languages, drifting
    // from the day it shipped.
    const files = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    // ★★ The real vocabulary, read off prod rather than taken from the brief:
    //   select s->>'reason' … from verdict, jsonb_array_elements(verdict->'stages') s
    //     absent 140 · not_internal 53 · no_eligible_file 43 · (null) 178
    // `unapproved_name` is the brief's example and is not in the data; it is
    // forbidden anyway, because inventing it here would be the same mistake.
    const codes = ['not_internal', 'no_eligible_file', 'unapproved_name'];
    // ★ `absent` is deliberately NOT asserted, and the reason is worth keeping:
    // 80 files in src/ use the word in prose, and `'absent'` quoted is already
    // taken — it is one of fix-348's three `RelayState` values (myBoard.ts:144),
    // an unrelated concept that happens to share the word. An assertion on it
    // would fail for a reason that has nothing to do with this ticket. The two
    // codes below are distinctive enough to catch a real reimplementation.
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(files)) {
      // This file names the codes in order to forbid them.
      if (path.includes('VerdictOnTheCardFix358')) continue;
      for (const code of codes) {
        if (src.includes(code)) offenders.push(`${path}: ${code}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('★★ the structured verdict is typed as unknown, so it cannot be reasoned over', async () => {
    const types = (await import('../lib/database.types.ts?raw')).default as string;
    const block = types.slice(types.indexOf('ProjectPlanOfRecordVerdictRow'));
    expect(block.slice(0, 1400)).toMatch(/verdict: unknown;/);
  });

  it('★ the card prints the string it was given, character for character', async () => {
    const odd = 'a sentence nobody would compose · with a middot · and a trailing note';
    state.verdict = nothingQualified({ sentence: odd });
    wrap(<PlanOfRecordCard projectId="p1" />);
    const el = await screen.findByTestId('plan-of-record-verdict-sentence');
    expect(el.textContent).toBe(odd);
  });
});

// ---------------------------------------------------------------------------
// §4 — where it goes, and what must not come back
// ---------------------------------------------------------------------------

describe('fix-358 §4: a chosen set keeps fix-331 §2s face', () => {
  it('★★ the face still has the chip, preview, enlarge and copy — and no text', async () => {
    state.verdict = chosenVerdict();
    state.row = fileRow({ set_type: 'design_guidance' });
    wrap(<PlanOfRecordCard projectId="p1" />);
    const card = await screen.findByTestId('plan-of-record-card');
    expect(screen.getByTestId('plan-of-record-stage-design_guidance')).toBeInTheDocument();
    expect(screen.getByTestId('plan-of-record-copy')).toBeInTheDocument();
    // ★★★ AND THE SENTENCE IS NOT ON THE FACE. Every one of the 105 chosen
    // sentences ends in "showing <stage>: <file name>", so printing it here
    // would put back the file name fix-331 §2 removed at Bobby's request.
    // Measured, not assumed: 105 of 105 name a file, 0 of 33 do.
    expect(card.textContent).not.toContain('DESIGN GUIDANCE.pdf');
    expect(card.textContent).not.toContain('none a drawing');
  });

  it('★★★ …the sentence is in the ENLARGED view, where fix-331 §2 put the text', async () => {
    state.verdict = chosenVerdict();
    state.row = fileRow({ set_type: 'design_guidance', thumb_status: 'failed', thumb_path: null });
    wrap(<PlanOfRecordCard projectId="p1" />);
    // The preview degrades without a thumbnail, so open the lightbox the way a
    // person would when there is one: through the card's own state.
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-verdict-sentence')).toBeNull();
  });

  it('★★ the lightbox carries the sentence beside the file it explains', async () => {
    state.verdict = chosenVerdict();
    state.row = fileRow({ set_type: 'design_guidance' });
    wrap(<PlanOfRecordCard projectId="p1" />);
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const box = await screen.findByTestId('plan-of-record-lightbox');
    expect(box.textContent).toContain('showing design guidance');
    expect(screen.getByTestId('plan-of-record-verdict-sentence')).toBeInTheDocument();
    // fix-331 §2's relocation is intact: the file name and meta are here too.
    expect(screen.getByTestId('plan-of-record-lightbox-path')).toBeInTheDocument();
  });

  it('★ nothing is written — the card reads a table the indexer owns', async () => {
    const hook = (await import('../hooks/usePlanOfRecordVerdict.ts?raw')).default as string;
    expect(hook).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(hook).toMatch(/\.select\(/);
  });
});

// ---------------------------------------------------------------------------
// §3 — say how old the answer is
// ---------------------------------------------------------------------------

describe('fix-358 §3: staleness is visible without a hover', () => {
  it('★ a fresh walk says nothing about its age', () => {
    expect(stalenessNote(new Date().toISOString())).toBeNull();
    expect(stalenessNote(new Date(Date.now() - 6 * 86_400_000).toISOString())).toBeNull();
  });

  it('★★ a walk a week old says so, with the number of days', () => {
    const note = stalenessNote(new Date(Date.now() - 9 * 86_400_000).toISOString());
    expect(note).toMatch(/Last checked 9 days ago/);
    expect(note).toMatch(/may have changed/);
  });

  it('★★ and it renders on the FACE, not behind a hover', async () => {
    state.verdict = nothingQualified({
      computed_at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    });
    wrap(<PlanOfRecordCard projectId="p1" />);
    const stale = await screen.findByTestId('plan-of-record-stale');
    expect(stale.textContent).toMatch(/Last checked 12 days ago/);
    // Not a title attribute, not a tooltip — real text in the document.
    expect(stale.getAttribute('title')).toBeNull();
  });

  it('★★ a chosen card shows it too, and ONLY when stale', async () => {
    state.verdict = chosenVerdict();
    state.row = fileRow({ set_type: 'design_guidance' });
    const fresh = wrap(<PlanOfRecordCard projectId="p1" />);
    await screen.findByTestId('plan-of-record-copy');
    // ★ A healthy card is unchanged — which is what stops the tallest card in
    // the row growing for all 157 projects (fix-331 #80).
    expect(screen.queryByTestId('plan-of-record-stale')).toBeNull();
    fresh.unmount();

    state.verdict = chosenVerdict({
      computed_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    wrap(<PlanOfRecordCard projectId="p1" />);
    expect(await screen.findByTestId('plan-of-record-stale')).toHaveTextContent(
      'Last checked 30 days ago',
    );
  });

  it('★ an unparseable timestamp says nothing rather than guessing', () => {
    expect(stalenessNote('not a date')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-358: prior contracts survive', () => {
  it('★★ the verdict is additive — if it cannot be read, the card is unchanged', async () => {
    // A piece of context must never be able to break the card it annotates.
    state.verdictLoading = true;
    state.row = fileRow();
    wrap(<PlanOfRecordCard projectId="p1" />);
    await screen.findByTestId('plan-of-record-copy');
    expect(screen.queryByTestId('plan-of-record-not-indexed')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-nothing-qualified')).toBeNull();
  });

  it('★ the card is still read-only — no upload, replace, delete or edit', async () => {
    state.verdict = nothingQualified();
    wrap(<PlanOfRecordCard projectId="p1" />);
    const card = await screen.findByTestId('plan-of-record-card');
    const text = card.textContent ?? '';
    for (const word of [/upload/i, /replace/i, /delete/i, /remove/i, /edit/i]) {
      expect(text).not.toMatch(word);
    }
  });

  it('★★ the centred section is still the card\'s only section', async () => {
    // fix-335 §6 selects it as `section section`; wrapping the body in another
    // <section> would break that, and fix-331 §1 asserts every section in a
    // card shares one flexGrow.
    state.verdict = nothingQualified();
    const { container } = wrap(<PlanOfRecordCard projectId="p1" />);
    await screen.findByTestId('plan-of-record-nothing-qualified');
    const inner = container.querySelector('section section') as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.dataset.centerVertically).toBe('true');
    expect(container.querySelectorAll('section section').length).toBe(1);
  });
});
