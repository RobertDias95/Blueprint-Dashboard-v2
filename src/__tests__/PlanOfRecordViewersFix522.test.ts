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

  it('★★★ two items: copy the link, and email it', () => {
    expect(card).toContain('-share-menu');
    expect(card).toContain('-share-copy');
    expect(card).toContain('-share-email');
    expect(card).toContain('aria-haspopup="menu"');
  });

  it('★★★ the WHOLE-SET share is NOT built — it is a route with an access ruling', () => {
    // ★★★ §D1 requires the shape to be reported BEFORE it is built: a Bridge
    //     route is the app's second unauthenticated surface and the first to
    //     serve tenant content, and it needs a table and an RPC besides — which
    //     means Cowork applies a migration and it cannot ship here anyway.
    //     **The menu exists so it drops in as one more item** rather than as a
    //     redesign of this control.
    expect(code(card)).not.toContain('/s/');
    expect(code(card)).not.toContain('plan_share_links');
  });

  it('★★ Copy link is fix-506’s behaviour, unchanged to the character', () => {
    expect(card).toContain('sharePlanPage(');
    expect(card).toContain('SHARE_TOAST');
  });

  it('★★ Copy and Email send the SAME object — one definition', () => {
    // ★ Two controls that resolve the shared object separately is how they end
    //   up sending different things.
    expect(card).toContain('function sharePath(');
    expect(card).toContain('void sharePlanPage(sharePath(b.variant))');
    expect(card).toContain('void emailPlanPage(sharePath(b.variant), b.label)');
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
