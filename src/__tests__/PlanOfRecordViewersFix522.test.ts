import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planOfRecordViewerMode,
  shownPlanOfRecord,
  type PlanOfRecordSetLike,
} from '../lib/planOfRecord';
import {
  SHARE_TTL_DAYS,
  planShareBody,
  planShareMailto,
  planShareSubject,
} from '../lib/planOfRecordShare';
import type { ProjectPlanOfRecordRow } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-522 (P-217, P-187) — TWO PLANS, TWO VIEWERS, ONE SHARE
// ===========================================================================
//
// The three complaints were one defect: **three readers, three sources.**
// The buttons resolved the variant correctly; the CHIP printed `row.set_type`
// so both marketing buttons left a badge reading `MARKETING`; and the PREVIEW
// was bound to `row`, so the card face showed `marketing_internal.jpg`
// whichever button was pressed.
// ===========================================================================

function porRow(
  over: Partial<ProjectPlanOfRecordRow> = {},
): Pick<ProjectPlanOfRecordRow, 'set_type' | 'thumb_path' | 'thumb_status' | 'file_name'> {
  return {
    set_type: 'marketing',
    thumb_path: 'p/marketing_internal.jpg',
    thumb_status: 'ok',
    file_name: '3505 - Marketing - Internal.pdf',
    ...over,
  } as never;
}

function setRow(over: Partial<PlanOfRecordSetLike> = {}): PlanOfRecordSetLike {
  return {
    set_type: 'marketing',
    variant: 'internal',
    page_count: 1,
    thumb_path: 'p/marketing_internal.jpg',
    thumb_status: 'ok',
    file_name: '3505 - Marketing - Internal.pdf',
    ...over,
  };
}

/** `3505 Densmore Ave N`, from prod 2026-09-10 — the project in Bobby's report. */
const DENSMORE = {
  available: true,
  rows: [
    setRow({
      variant: 'internal',
      page_count: 1,
      thumb_path: 'p/marketing_internal.jpg',
      file_name: '3505 - Marketing - Internal.pdf',
    }),
    setRow({
      variant: 'external',
      page_count: 6,
      thumb_path: 'p/marketing_external.jpg',
      file_name: '3505 - Marketing - External.pdf',
    }),
  ],
};

// ---------------------------------------------------------------------------
// §A — the chip names the pressed button
// ---------------------------------------------------------------------------

describe('fix-522 §A (P-217) — the chip stops saying MARKETING in both states', () => {
  it('★★★ pressing Site Plan gives a SITE PLAN chip, not MARKETING', () => {
    // ★★★ THE COMPLAINT, EXACTLY. Bobby: *"right now it is displaying site plan
    //     (marketing internal) but if i click marketing, it should show
    //     marketing external."* Both rows are `set_type = 'marketing'`, so a
    //     chip naming the SET TYPE read `MARKETING` whichever button was
    //     pressed — "Marketing" doing double duty as a type AND a variant.
    expect(shownPlanOfRecord(porRow(), DENSMORE, 'internal').label).toBe('Site Plan');
    expect(shownPlanOfRecord(porRow(), DENSMORE, 'external').label).toBe('Marketing');
  });

  it('★★★ the chip and the pressed BUTTON read off the same list', () => {
    // ★ Not "they happen to agree" — the label IS the button's, resolved the
    //   same way `SetButtons` resolves the pressed one. Same discipline
    //   fix-519 §A applied to the Library's unit columns.
    const card = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/PlanOfRecordCard.tsx'),
      'utf8',
    );
    expect(card).toContain('<StageChip stage={row.set_type} label={shown.label} />');
    // ★ The testid keeps the STAGE — four suites name
    //   `plan-of-record-stage-marketing` and the element they reach for has
    //   not moved. What changed is the WORD inside it.
    expect(card).toContain('data-testid={`plan-of-record-stage-${stage}`}');
    expect(card).toContain('{label}');
  });

  it('★★ the other two stages keep their own name', () => {
    const schematic = { available: true, rows: [setRow({ set_type: 'schematic', variant: '' })] };
    expect(
      shownPlanOfRecord(porRow({ set_type: 'schematic' }), schematic, 'internal').label,
    ).toBe('Schematic');
    expect(
      shownPlanOfRecord(porRow({ set_type: 'design_guidance' }), undefined, 'internal').label,
    ).toBe('Design Guidance');
  });

  it('★ a stage with no buttons still gets a chip, never a blank', () => {
    expect(
      shownPlanOfRecord(porRow({ set_type: 'other' as never }), undefined, 'internal').label,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §B — the image changes with the button
// ---------------------------------------------------------------------------

describe('fix-522 §B (P-217) — the thumbnail and the caption resolve from ONE row', () => {
  it('★★★ pressing Marketing paints marketing_external.jpg', () => {
    // ★★★ WHAT IT WAS BOUND TO BEFORE: `row.thumb_path` — the single
    //     `project_plan_of_record` row — while the buttons and the Lightbox's
    //     caption resolved the variant. Prod carries two distinct thumbnails
    //     and both are `ok`; the app just never asked for the column.
    expect(shownPlanOfRecord(porRow(), DENSMORE, 'internal').thumbPath).toBe(
      'p/marketing_internal.jpg',
    );
    expect(shownPlanOfRecord(porRow(), DENSMORE, 'external').thumbPath).toBe(
      'p/marketing_external.jpg',
    );
  });

  it('★★★ asserted BY NAME — the same set answers the label, the image and the pages', () => {
    // ★★ fix-519 §A's lesson: a positional or "they both look right" assertion
    //    passes happily through the whole broken period. The question a test
    //    has to be able to ask is *"do the image and the caption come from the
    //    same ROW?"*
    const shown = shownPlanOfRecord(porRow(), DENSMORE, 'external');
    expect(shown.set?.variant).toBe('external');
    expect(shown.thumbPath).toBe(shown.set?.thumb_path);
    expect(shown.fileName).toBe(shown.set?.file_name);
    expect(shown.pageCount).toBe(shown.set?.page_count);
  });

  it('★★★ the hook SELECTS the columns — an unlisted one arrives undefined', () => {
    // ★★★ THE SIXTH RECORDING OF THIS TRAP (fix-122, fix-386, fix-410,
    //     fix-487, fix-488, and here). The view has carried `thumb_path` since
    //     fix-504; the explicit select list did not name it, so the feature
    //     looked impossible rather than unwired.
    const hook = readFileSync(
      resolve(process.cwd(), 'src/hooks/usePlanOfRecordSets.ts'),
      'utf8',
    );
    for (const col of ['thumb_path', 'thumb_status', 'file_name']) {
      expect(hook, `${col} must be in SELECT_COLUMNS`).toContain(col);
    }
    const select = hook.slice(hook.indexOf('const SELECT_COLUMNS'));
    expect(select.slice(0, 400)).toContain('thumb_path,thumb_status,file_name');
  });

  it('★★ a set whose own thumbnail has not rendered falls back to the row', () => {
    // ★ A `pending` or `failed` set degrades to the plan of record's image,
    //   which is what the card did for every set before this.
    const pending = {
      available: true,
      rows: [setRow({ variant: 'external', thumb_status: 'pending', thumb_path: null })],
    };
    expect(shownPlanOfRecord(porRow(), pending, 'external').thumbPath).toBe(
      'p/marketing_internal.jpg',
    );
  });

  it('★★ with NO sets view at all the card behaves exactly as before', () => {
    // fix-504 was absent on prod for two tickets; that branch must still work.
    const shown = shownPlanOfRecord(porRow(), undefined, 'external');
    expect(shown.set).toBeNull();
    expect(shown.thumbPath).toBe('p/marketing_internal.jpg');
    expect(shown.mode).toBe('drawing');
  });
});

// ---------------------------------------------------------------------------
// §C — the document decides which viewer, not its label
// ---------------------------------------------------------------------------

describe('fix-522 §C (P-217) — page_count picks the viewer', () => {
  it('★★★ a ONE-PAGE marketing set reads as a drawing, not a pager', () => {
    // ★★★ §C: *"a one-page marketing set should read like a site plan"* — and
    //     there is exactly ONE on prod, which is why the rule cannot key off
    //     the variant string.
    const onePageExternal = {
      available: true,
      rows: [setRow({ variant: 'external', page_count: 1 })],
    };
    expect(shownPlanOfRecord(porRow(), onePageExternal, 'external').mode).toBe('drawing');
  });

  it('★★★ a MULTI-PAGE schematic pages — 86 of 101 on prod, and none could', () => {
    // ★★★ THE BIG ONE. `findVariant` matched `set_type === 'marketing'` and
    //     nothing else, so a schematic always resolved to `null`, `pagePaths`
    //     came back empty and the viewer fell back to a single thumbnail.
    //     fix-510's backfill gave 86 schematics pages that nothing could reach.
    const schematic = {
      available: true,
      rows: [setRow({ set_type: 'schematic', variant: '', page_count: 13 })],
    };
    const shown = shownPlanOfRecord(porRow({ set_type: 'schematic' }), schematic, 'internal');
    expect(shown.set?.set_type).toBe('schematic');
    expect(shown.pageCount).toBe(13);
    expect(shown.mode).toBe('pager');
  });

  it('★★ the rule is the PAGE COUNT and nothing else', () => {
    expect(planOfRecordViewerMode(1)).toBe('drawing');
    expect(planOfRecordViewerMode(2)).toBe('pager');
    expect(planOfRecordViewerMode(13)).toBe('pager');
    // ★ 0 and a missing count both mean "one sheet we know of", never "empty".
    expect(planOfRecordViewerMode(0)).toBe('drawing');
  });

  it('★★★ the prod split, so the ruling is against the data and not a hunch', () => {
    // Measured 2026-09-10, all 334 sets, none with a null `page_count`:
    const PROD = [
      { setType: 'design_guidance', variant: null, sets: 48, onePage: 48, multi: 0 },
      { setType: 'marketing', variant: 'internal', sets: 58, onePage: 58, multi: 0 },
      { setType: 'marketing', variant: 'external', sets: 127, onePage: 1, multi: 126 },
      { setType: 'schematic', variant: null, sets: 101, onePage: 15, multi: 86 },
    ];
    expect(PROD.reduce((n, r) => n + r.sets, 0)).toBe(334);
    expect(PROD.reduce((n, r) => n + r.onePage, 0)).toBe(122);
    expect(PROD.reduce((n, r) => n + r.multi, 0)).toBe(212);
    // ★★★ WHAT KEYING OFF THE LABEL WOULD COST: the one single-page marketing
    //     external, the 86 multi-page schematics and the 15 one-page ones —
    //     **102 of 334 sets in the wrong viewer.**
    expect(1 + 86 + 15).toBe(102);
  });

  it('★★ the Lightbox is handed the resolved set, and declares its mode', () => {
    const card = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/PlanOfRecordCard.tsx'),
      'utf8',
    );
    expect(card).toContain('shownSet={shownPlanOfRecord(row, setsQ.data, variant).set}');
    expect(card).toContain('data-viewer-mode={mode}');
    expect(card).toContain('planOfRecordViewerMode(');
  });
});

// ---------------------------------------------------------------------------
// §D3 / §D4 — the share menu and the email
// ---------------------------------------------------------------------------

describe('fix-522 §D4 (P-187) — the mailto subject names the set', () => {
  it('★★★ all four kinds, from their own file names', () => {
    // ★★★ §D4: *"the subject line pre-filled from the set's own name — is this
    //     schematic, design guidance, marketing internal or external?"*
    //     The names are prod's, from `3505 Densmore Ave N`.
    expect(planShareSubject('3505 - Marketing - Internal.pdf', 'Site Plan')).toBe(
      '3505 - Marketing - Internal — Site Plan',
    );
    expect(planShareSubject('3505 - Marketing - External.pdf', 'Marketing')).toBe(
      '3505 - Marketing - External — Marketing',
    );
    expect(planShareSubject('3505 - SD Preliminary 5.pdf', 'Schematic')).toBe(
      '3505 - SD Preliminary 5 — Schematic',
    );
    expect(
      planShareSubject('3505 Densmore Ave N - Design Guidance.pdf', 'Design Guidance'),
    ).toBe('3505 Densmore Ave N - Design Guidance — Design Guidance');
  });

  it('★★ the `.pdf` goes — a subject is read by a person', () => {
    expect(planShareSubject('x.PDF', 'Marketing')).not.toContain('.PDF');
  });

  it('★★ a set with no file name still gets a subject that names what it is', () => {
    expect(planShareSubject(null, 'Site Plan')).toBe('Site Plan');
    expect(planShareSubject('   ', 'Marketing')).toBe('Marketing');
  });

  it('★★★ the body carries the link and tells the RECIPIENT when it stops working', () => {
    const body = planShareBody('3505 - Marketing - External.pdf', 'Marketing', 'https://x/y', 6);
    expect(body).toContain('https://x/y');
    expect(body).toContain('(6 pages)');
    // ★ The expiry is stated to the person it stops working for, not only to
    //   the sender in a toast.
    expect(body).toContain(`${SHARE_TTL_DAYS} days`);
    // ★ A one-page set does not claim a page count.
    expect(planShareBody('x.pdf', 'Site Plan', 'https://x/y', 1)).not.toContain('pages)');
  });

  it('★★★ the mailto encodes newlines as %0A, which is what does not truncate', () => {
    const url = planShareMailto('S', 'a\nb');
    expect(url.startsWith('mailto:?subject=')).toBe(true);
    expect(url).toContain('body=a%0Ab');
    expect(url).not.toContain('\n');
  });

  it('★★★ SHARE_TTL_DAYS is unchanged at 30 — fix-506’s number carries over', () => {
    expect(SHARE_TTL_DAYS).toBe(30);
  });
});

/** Strip block, line and JSX comments. ★ Both files below DISCUSS the strings
 *  these tests forbid — a "must not appear" grep that matches its own
 *  gravestone is the trap this repo has now recorded five times. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-522 §D3 (P-187) — a share MENU, and what is deliberately not in it', () => {
  const card = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectDetail/PlanOfRecordCard.tsx'),
    'utf8',
  );

  // ★★★ SUPERSEDED BY fix-528 §A/§B — `Email it…` IS GONE AND IT IS THE POINT.
  //
  //     fix-522 built the pair because a `mailto:` was the only way to hand
  //     somebody a set without a send path, and it shipped subject + link with
  //     an explicit note that an attachment was impossible. That was true of
  //     `mailto:` and it was never true of email — and Bobby asked four times,
  //     ending with *"i dont think we need a link, just a pdf."*
  //
  // ★★★ THE MENU IS TWO ITEMS AGAIN, and the second one is the drawing.
  //     `Email it…` returns carrying the PDF once the Graph draft path clears
  //     its IT gate (§A4); until then it is ABSENT rather than dead, which is
  //     P-239's rule applied to a control that cannot work yet.
  it('★★★ two items: copy the link, and download the PDF', () => {
    expect(card).toContain('-share-menu');
    expect(card).toContain('-share-copy');
    expect(card).toContain('-share-download');
    expect(card).toContain('aria-haspopup="menu"');
    // ★ And the item Bobby complained about is not there in any form.
    expect(code(card)).not.toContain('-share-email');
    expect(code(card)).not.toContain('planShareMailto');
  });

  // ★★★ SUPERSEDED BY fix-523 §A (P-187), AND THE ORIGINAL WAS NOT MISTAKEN.
  //
  //     These three assertions pinned fix-522's deliberate NON-decision: the
  //     whole-set route was reported and not built, so the menu had to copy a
  //     signed Storage URL to page one and had to do it through ONE resolver.
  //     Both halves were right for a ticket with no table, no RPC and no route.
  //
  //     All three landed on prod on 2026-09-11 (applied from Cowork), so the
  //     absence assertion is now an assertion that the ticket did not happen.
  //     **The property it was protecting survives verbatim** and is what these
  //     replacements pin: one resolver, and no second spelling of the shared
  //     object. `sharePlanPage` and `sharePath` are gone because minting moved
  //     into `usePlanShareActions` — which collapsed a THIRD control, the
  //     enlarged view's Share button, that fix-522 had left signing on its own.
  it('★★★ the whole-set share IS built now, and everything mints through one path', () => {
    expect(code(card)).toContain('usePlanShareActions(row.project_id)');
    expect(code(card)).toContain('share.copy(');
    // ★ fix-528: `share.email(` is no longer called here — see the two-items
    //   test above for why the control it fed was removed rather than fixed.
    expect(code(card)).toContain('downloadPlanPdf(');
    // ★ …and nothing in this file signs a Storage object any more.
    expect(code(card)).not.toContain('signPlanShareUrl');
    expect(code(card)).not.toContain('sharePlanPage(');
  });

  it('★★ Copy link still says thirty days and still needs no login', () => {
    const shareLib = readFileSync(
      resolve(process.cwd(), 'src/lib/planOfRecordShare.ts'),
      'utf8',
    );
    // ★ fix-506's promise is unchanged by the link becoming a route: the
    //   constant is the same, the toast is built from it, and the words and the
    //   expiry therefore still cannot disagree.
    expect(shareLib).toContain('export const SHARE_TTL_DAYS = 30');
    expect(code(shareLib)).toContain('SHARE_TOAST');
  });

  it('★★ Copy link and the viewer send the SAME thing — one definition', () => {
    // ★ Three controls resolving the shared object separately is how they end
    //   up sending three different things. fix-522 collapsed two of them.
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/usePlanShare.ts'), 'utf8');
    expect(code(hook)).toContain('async function mint(');
    // ★★ The viewer's Share button was the third, and it is on the same path.
    expect(code(card)).toContain('data-testid="plan-of-record-lightbox-share"');
    const lightbox = card.slice(card.indexOf('function Lightbox('));
    expect(lightbox).toContain('share.copy(');
    // ★ fix-528: `share.email` is no longer CALLED from this file — the menu
    //   item it fed is gone. The helper itself stays in `usePlanShareActions`,
    //   because §A brings the item back carrying a PDF rather than a link, and
    //   the subject line it builds is the half Bobby has never complained
    //   about. Deleting it would be deleting the part that works.
    expect(code(hook)).toContain('async email(');
  });

  it('★★★ no `getPublicUrl` for the plan bucket — the snip is out for a reason', () => {
    // ★★★ §D4 splits: subject + link is a `mailto:` and works everywhere; the
    //     front-page snip needs a real send path or a HOSTED image. The second
    //     is what `planOfRecordShare` says must never exist: *"a public URL
    //     would either 400 or — far worse — work, which would mean somebody had
    //     made drawing content world-readable."*
    const shareLib = readFileSync(
      resolve(process.cwd(), 'src/lib/planOfRecordShare.ts'),
      'utf8',
    );
    expect(code(shareLib)).not.toContain('getPublicUrl');
    expect(code(card)).not.toContain('getPublicUrl');
  });
});
