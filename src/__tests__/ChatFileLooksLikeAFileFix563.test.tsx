import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ATTACHMENT_KIND_LABEL,
  attachmentKind,
  attachmentMeta,
  humanSize,
  type ChatAttachment,
} from '../lib/chatAttachments';

// ===========================================================================
// ★★★ fix-563 (P-267) — A FILE IN CHAT LOOKS LIKE A FILE
// ===========================================================================
//
// Bobby, 2026-09-14: *"those kind of show up as, like, gray blobs… it would be
// nice if there was maybe a logo or something, or maybe a preview of the
// correction. Right now it's not super intuitive."* His screenshot: four
// `10431 - SFR1..4 - Correction Letter CR2.pdf` cards, identical grey rectangles
// distinguishable only by reading the filename.
//
// ---------------------------------------------------------------------------
// §0 — RE-MEASURED ON PROD 2026-09-29, and the census has nearly doubled
// ---------------------------------------------------------------------------
//
//                                  brief (09-14)        measured (09-29)
//   messages carrying attachments  27                   **50**
//   files                          48                   **92**
//   PDF                            21 (avg 3.7, max 17.1)  **44** (avg 3.36, max 17.09 MB)
//   PNG                            23 (avg 0.6)            **39** (avg 0.44)
//   JPEG                            4                       **4** ✓
//   XLSX                           —                        **5**  ★ NEW
//
// ★★★ A MIME TYPE THE BRIEF'S CENSUS DID NOT CONTAIN IS NOW LIVE: 5 XLSX files
//     (`application/…spreadsheetml.sheet`). The brief's test for *"a mime the UI
//     does not know"* was speculative when written; it now covers real files, so
//     the generic branch is load-bearing rather than defensive.
//
// ★★ EVERY ONE OF THE 92 ENTRIES CARRIES ALL FOUR KEYS — `mime`, `name`, `path`,
//    `size`, and no others. **The renderer has had the file type all along and
//    never used it.** This ticket stores nothing and backfills nothing.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT WAS ACTUALLY MISSING, re-derived against origin/main
// ---------------------------------------------------------------------------
//
// Most of §A and §B had already shipped — fix-330 built the filename, the
// human-readable size and the image thumbnail; fix-411 §4 built the lightbox.
// Exactly two things were absent:
//
//   §A  a TYPE ICON. The full card had NO icon, so a PDF and a spreadsheet were
//       the same grey rectangle — Bobby's literal complaint.
//   §B  a fallback when the THUMBNAIL ITSELF fails to load. `urlQ.error` (the
//       signature could not be minted) was handled; a signature that mints over
//       a dead object was not, and left a broken <img> on screen.
//
// ★★★ THAT SECOND GAP WAS PROVED BY A FAILING TEST BEFORE IT WAS FIXED. §B asks
//     for the fallback to be asserted *"with a broken path, not by reading the
//     handler"* — so every fallback test below fires a real `error` event on the
//     rendered <img> and re-queries the DOM.

const SIGNED = 'https://signed.example/x';
const state = { url: SIGNED as string | null, error: null as Error | null };

vi.mock('../hooks/useChatAttachments', () => ({
  CHAT_BUCKET: 'chat-attachments',
  useSignedAttachmentUrl: () => ({ data: state.url, error: state.error }),
}));

import ChatAttachments from '../components/ProjectDetail/ChatAttachments';

const A = (over: Partial<ChatAttachment> = {}): ChatAttachment =>
  ({
    path: 'p-1/u1/file.bin',
    name: 'file.bin',
    mime: 'application/octet-stream',
    size: 1024,
    ...over,
  }) as ChatAttachment;

function mount(attachments: ChatAttachment[], compact = false) {
  return render(<ChatAttachments attachments={attachments} compact={compact} />);
}
const card = (path: string) => screen.getByTestId(`chat-attachment-${path}`);

beforeEach(() => {
  state.url = SIGNED;
  state.error = null;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-563 — the kind derivation', () => {
  it('★★★ three kinds, which is exactly what §A asks for', () => {
    expect(attachmentKind({ mime: 'image/png' })).toBe('image');
    expect(attachmentKind({ mime: 'image/jpeg' })).toBe('image');
    expect(attachmentKind({ mime: 'image/heic' })).toBe('image');
    expect(attachmentKind({ mime: 'application/pdf' })).toBe('pdf');
    // ★ the 5 live XLSX files, and anything else
    expect(
      attachmentKind({
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toBe('generic');
    expect(attachmentKind({ mime: 'text/csv' })).toBe('generic');
  });

  it('★★★ TOTAL — a missing, null or malformed mime is `generic`, never a throw', () => {
    // ★★ All 92 files carry a `mime` today, **which is exactly why a missing one
    //    would never be noticed**. So the default is asserted rather than assumed.
    expect(attachmentKind({ mime: '' })).toBe('generic');
    expect(attachmentKind({ mime: undefined as unknown as string })).toBe('generic');
    expect(attachmentKind({ mime: null as unknown as string })).toBe('generic');
    expect(attachmentKind(null)).toBe('generic');
    expect(attachmentKind(undefined)).toBe('generic');
  });

  it('★★ case and whitespace do not change the answer', () => {
    expect(attachmentKind({ mime: 'APPLICATION/PDF' })).toBe('pdf');
    expect(attachmentKind({ mime: '  image/png  ' })).toBe('image');
  });

  it('★★★ `17,931,642` bytes reads `17.1 MB` — the brief\'s own example', () => {
    expect(humanSize(17_931_642)).toBe('17.1 MB');
    // ★ and the real maximum in chat today, 17,922,451, reads the same
    expect(humanSize(17_922_451)).toBe('17.1 MB');
    // ★★ §A: *"the size is the cheapest useful signal on the card"* — these two
    //    correction letters currently look identical and are not.
    expect(humanSize(204_800)).toBe('200 KB');
    expect(humanSize(999)).toBe('999 B');
  });

  it('★★★ the meta line DROPS the separator when the size is missing', () => {
    // ★★★ Otherwise it renders "PDF · " — a dangling middle dot, which is the
    //     "never an empty box" failure in miniature.
    expect(attachmentMeta({ mime: 'application/pdf', size: 17_931_642 })).toBe(
      'PDF · 17.1 MB',
    );
    expect(attachmentMeta({ mime: 'application/pdf', size: undefined as unknown as number }))
      .toBe('PDF');
    expect(attachmentMeta({ mime: '', size: NaN })).toBe('File');
    expect(attachmentMeta(null)).toBe('File');
    expect(ATTACHMENT_KIND_LABEL.image).toBe('Image');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-563 §A — the card', () => {
  it('★★★ a PDF renders the PDF icon, the filename and 17.1 MB', () => {
    // The brief's first test, verbatim.
    const a = A({
      path: 'p-1/u1/CR2.pdf',
      name: '10431 - SFR1 - Correction Letter CR2.pdf',
      mime: 'application/pdf',
      size: 17_931_642,
    });
    mount([a]);
    const c = card(a.path);
    expect(c.dataset.kind).toBe('file');
    expect(c.dataset.fileKind).toBe('pdf');
    expect(within(c).getByTestId('attachment-icon-pdf')).toBeTruthy();
    expect(c.textContent).toContain('10431 - SFR1 - Correction Letter CR2.pdf');
    expect(c.textContent).toContain('17.1 MB');
    expect(c.textContent).toContain('Open file');
  });

  it('★★★ a PDF and a spreadsheet are NO LONGER the same grey rectangle', () => {
    // ★★★ BOBBY'S ACTUAL COMPLAINT, as one assertion. Before this ticket both
    //     cards rendered identical markup apart from the filename.
    const pdf = A({ path: 'a.pdf', name: 'a.pdf', mime: 'application/pdf' });
    const xls = A({
      path: 'b.xlsx',
      name: 'b.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    mount([pdf, xls]);
    expect(within(card('a.pdf')).getByTestId('attachment-icon-pdf')).toBeTruthy();
    expect(within(card('b.xlsx')).getByTestId('attachment-icon-generic')).toBeTruthy();
    expect(card('a.pdf').dataset.fileKind).not.toBe(card('b.xlsx').dataset.fileKind);
  });

  it('★★★ an unknown mime gets the generic icon and NEVER an empty box', () => {
    const a = A({ path: 'x.weird', name: 'x.weird', mime: 'application/x-nonsense' });
    mount([a]);
    const c = card('x.weird');
    expect(within(c).getByTestId('attachment-icon-generic')).toBeTruthy();
    // ★★ "never an empty box": the card carries a name, a meta line and an action.
    expect(c.textContent).toContain('x.weird');
    expect(c.textContent).toContain('File');
    expect(c.textContent).toContain('Open file');
    expect(c.textContent!.trim().length).toBeGreaterThan(10);
  });

  it('★★★ an attachment missing BOTH size and mime renders without throwing', () => {
    // The brief's fourth test. 92 files all have both — which is the reason.
    const a = {
      path: 'p/u/mystery',
      name: 'mystery',
    } as unknown as ChatAttachment;
    expect(() => mount([a])).not.toThrow();
    const c = card('p/u/mystery');
    expect(within(c).getByTestId('attachment-icon-generic')).toBeTruthy();
    expect(c.textContent).toContain('mystery');
    // ★ no dangling separator, and no "NaN" or "undefined" on screen
    expect(c.textContent).not.toContain('NaN');
    expect(c.textContent).not.toContain('undefined');
    expect(
      screen.getByTestId('chat-attachment-meta-p/u/mystery').textContent,
    ).toBe('File');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-563 §B — images render as themselves, and fail safely', () => {
  it('★★★ a PNG renders its own thumbnail from the signed url', () => {
    const a = A({ path: 'p/u/snip.png', name: 'snip.png', mime: 'image/png', size: 2048 });
    mount([a]);
    const c = card('p/u/snip.png');
    expect(c.dataset.kind).toBe('image');
    expect(within(c).getByRole('img').getAttribute('src')).toBe(SIGNED);
  });

  it('★★★ a PNG whose LOAD FAILS falls back to the §A card', () => {
    // ★★★ §B: *"A thumbnail that 404s is worse than the grey blob it replaced —
    //     fall back to the §A card on any load error, and assert that fallback
    //     with a broken path, not by reading the handler."*
    //
    //     So this fires a real `error` on the rendered <img>. It FAILED against
    //     origin/main before the fix, which is how the gap was established.
    const a = A({ path: 'p/u/gone.png', name: 'gone.png', mime: 'image/png', size: 2048 });
    mount([a]);
    const before = card('p/u/gone.png');
    expect(before.tagName).toBe('BUTTON');

    fireEvent.error(within(before).getByRole('img'));

    // ★★ RE-QUERIED, because React swaps the <button> for an <a> and the old node
    //    is detached — a stale reference still holds the dead <img> and the
    //    assertion passes for the wrong reason. (Cost one debugging pass.)
    const after = card('p/u/gone.png');
    expect(after.tagName).toBe('A');
    expect(after.dataset.kind).toBe('file');
    expect(after.dataset.thumbFailed).toBe('true');
    // ★★★ AND NO BROKEN IMAGE IS LEFT ON SCREEN. This is the whole assertion.
    expect(within(after).queryByRole('img')).toBeNull();
    // ★ it is a real §A card: icon, name, size, and a way to open it
    expect(within(after).getByTestId('attachment-icon-image')).toBeTruthy();
    expect(after.textContent).toContain('gone.png');
    expect(after.textContent).toContain('2 KB');
    expect(after.textContent).toContain('Open file');
    expect(after.getAttribute('href')).toBe(SIGNED);
  });

  it('★★★ the fallback is ONE-WAY — it does not flip back and retry', () => {
    // ★★ A card that recovered on the next render would re-request an object that
    //    is not coming back, once per render, for as long as the thread is open.
    const a = A({ path: 'p/u/gone2.png', name: 'gone2.png', mime: 'image/png', size: 2048 });
    const { rerender } = mount([a]);
    fireEvent.error(within(card('p/u/gone2.png')).getByRole('img'));
    expect(card('p/u/gone2.png').tagName).toBe('A');
    rerender(<ChatAttachments attachments={[a]} />);
    expect(card('p/u/gone2.png').tagName).toBe('A');
    expect(within(card('p/u/gone2.png')).queryByRole('img')).toBeNull();
  });

  it('★★★ ONE failing image does not take its siblings down with it', () => {
    // ★★ The latch is per item. Two snips in one message, one dead: the live one
    //    must still be a thumbnail.
    const good = A({ path: 'p/u/ok.png', name: 'ok.png', mime: 'image/png', size: 2048 });
    const bad = A({ path: 'p/u/bad.png', name: 'bad.png', mime: 'image/png', size: 2048 });
    mount([good, bad]);
    fireEvent.error(within(card('p/u/bad.png')).getByRole('img'));
    expect(card('p/u/bad.png').tagName).toBe('A');
    expect(card('p/u/ok.png').tagName).toBe('BUTTON');
    expect(within(card('p/u/ok.png')).getByRole('img')).toBeTruthy();
  });

  it('★★ a signature that cannot be MINTED is still its own message', () => {
    // ★★★ TWO DIFFERENT FAILURES, AND THIS TICKET ONLY ADDED THE SECOND. fix-330
    //     already handled "no signature" — a permission or network problem. The
    //     load failure above is "signature fine, object gone". Both are covered,
    //     and neither renders a broken image.
    state.url = null;
    state.error = new Error('nope');
    const a = A({ path: 'p/u/nosig.png', name: 'nosig.png', mime: 'image/png', size: 2048 });
    mount([a]);
    expect(
      screen.getByTestId('chat-attachment-pending-p/u/nosig.png').textContent,
    ).toMatch(/could not open/i);
    expect(within(card('p/u/nosig.png')).queryByRole('img')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-563 — layout at phone width, and the rail', () => {
  it('★★★ multiple attachments WRAP rather than overflow', () => {
    // ★★★ jsdom HAS NO LAYOUT — it cannot see clipping, so asserting a rendered
    //     width would pass on anything (fix-417's lesson). What is asserted is
    //     the DECLARED rule that makes wrapping happen, plus that every card
    //     declares a ceiling narrower than a 320px phone.
    const list = [1, 2, 3, 4, 5].map((i) =>
      A({ path: `p/u/f${i}.pdf`, name: `file-${i}.pdf`, mime: 'application/pdf' }),
    );
    mount(list);
    const wrap = screen.getByTestId('chat-attachments');
    expect(wrap.className).toContain('flex-wrap');
    for (const a of list) {
      const c = card(a.path);
      expect(c.style.maxWidth).toBe('300px');
      expect(Number.parseInt(c.style.maxWidth, 10)).toBeLessThan(320);
    }
    // ★ all five are present — a wrap that dropped one would still "not overflow"
    expect(screen.getAllByTestId(/^chat-attachment-p\/u\/f/)).toHaveLength(5);
  });

  it('★★★ the filename is the part allowed to truncate, not the icon', () => {
    // ★★ An icon that squashes is the one element on the card that cannot be read
    //    at all, so it is `flex-shrink-0` and the name carries `truncate`.
    const a = A({
      path: 'p/u/long.pdf',
      name: 'an-extremely-long-correction-letter-filename-that-will-not-fit.pdf',
      mime: 'application/pdf',
    });
    mount([a]);
    const c = card('p/u/long.pdf');
    expect(within(c).getByTestId('attachment-icon-pdf').getAttribute('class'))
      .toContain('flex-shrink-0');
    const name = c.querySelector('.truncate');
    expect(name).toBeTruthy();
    expect(name!.textContent).toContain('correction-letter-filename');
  });

  it('★★★ the rail chip reads the SAME kind derivation as the card', () => {
    // ★★ It used a TWO-way emoji split (image vs everything), so a PDF and a
    //    spreadsheet were the same glyph there too. One derivation, two sizes —
    //    rather than a second vocabulary that can drift from the card's.
    const pdf = A({ path: 'r.pdf', name: 'r.pdf', mime: 'application/pdf' });
    mount([pdf], true);
    const chip = screen.getByTestId('chat-attachment-compact-r.pdf');
    expect(chip.dataset.kind).toBe('pdf');
    expect(within(chip).getByTestId('attachment-icon-pdf')).toBeTruthy();
    expect(chip.textContent).toContain('r.pdf');
  });

  it('★★ no emoji survive in the attachment renderer', () => {
    // Emoji render as a different picture on every platform and cannot take a
    // colour; the icons are themeable SVG using `currentColor`.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/ChatAttachments.tsx'),
      'utf8',
    )
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-563 §C — what is deliberately NOT here', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectDetail/ChatAttachments.tsx'),
    'utf8',
  );
  const code = src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

  it('★★★ NO PDF rendering, and the indexer is not reached for', () => {
    // ⛔ §C: Bobby chose *"file card now, preview later"*. And fix-526's renderer
    //    is a scheduled pipeline over INDEXED files, writing plan-set covers from
    //    the file share into `plan-thumbnails`. A chat upload is a different
    //    source with a different lifecycle — a real ticket, not an extension.
    for (const forbidden of [
      'plan-thumbnails',
      'pdfjs',
      'pdf.js',
      'PDFDocument',
      'usePlanOfRecordSets',
      'canvas',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('★★★ nothing new is stored, and nothing is backfilled', () => {
    // ⛔ *"Store new fields on `attachments`, or backfill anything."*
    // The four keys are all that is read; `mime` was already on all 92 files.
    const lib = readFileSync(resolve(process.cwd(), 'src/lib/chatAttachments.ts'), 'utf8');
    expect(lib).toContain('path: string;');
    expect(lib).toContain('name: string;');
    expect(lib).toContain('mime: string;');
    expect(lib).toContain('size: number;');
    // no fifth field crept onto the interface
    // ★★ SLICED TO A BRACE AT LINE START, not the first `}` — the JSDoc on
    //    `path` contains `{project_id}/{uuid}/{filename}`, so `indexOf('}')`
    //    truncates the interface after its first comment and the field list comes
    //    back EMPTY. The assertion then passes or fails for nothing to do with
    //    the shape it is about.
    const start = lib.indexOf('export interface ChatAttachment');
    const iface = lib.slice(start, lib.indexOf('\n}', start));
    const fields = [...iface.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
    expect(fields.sort()).toEqual(['mime', 'name', 'path', 'size']);
  });

  it('★★★ upload, the size limits and the bucket are untouched', () => {
    // ⛔ *"Change upload, size limits, or storage buckets."*
    const lib = readFileSync(resolve(process.cwd(), 'src/lib/chatAttachments.ts'), 'utf8');
    expect(lib).toContain('export const MAX_ATTACHMENT_BYTES = 26_214_400;');
    expect(lib).toContain('export const MAX_ATTACHMENTS_PER_MESSAGE = 5;');
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useChatAttachments.ts'), 'utf8');
    expect(hook).toContain("export const CHAT_BUCKET = 'chat-attachments';");
    expect(hook).toContain('const SIGNED_URL_TTL_SECONDS = 60 * 60;');
  });

  it('★★★ this ticket ships NO migration', () => {
    // *"no migration, no data changes"* — asserted by absence, because the
    // cheapest way to change data is to add a file nobody reads closely.
    const migrations = readdirSync(resolve(process.cwd(), 'migrations'));
    expect(migrations.filter((f) => /fix_563/i.test(f))).toEqual([]);
  });
});
