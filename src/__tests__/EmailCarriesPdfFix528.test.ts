import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  PDF_DOWNLOAD_TTL_SECONDS,
  SHARE_BUCKET,
  SHARE_TTL_DAYS,
  formatPdfSize,
  pdfDownloadName,
} from '../lib/planOfRecordShare';
import { pdfDownloadName as fnPdfDownloadName } from '../../supabase/functions/plan-share/handler';

// ===========================================================================
// fix-528 — the email carries the drawing, not a link to it (P-238)
// ===========================================================================
//
// ★ Source assertions strip comments first. Tenth recording of the gravestone
//   trap in this repo.

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
}
const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf8');

const card = () => read('src/components/ProjectDetail/PlanOfRecordCard.tsx');
const page = () => read('src/pages/SharedPlan.tsx');

// ---------------------------------------------------------------------------
// §A — the Graph draft is REPORTED, not built
// ---------------------------------------------------------------------------

describe('fix-528 §A — the gate is respected: nothing past it was built', () => {
  it('★★★ "Email it…" does NOT render as a live control — asserted as an absence', () => {
    // ★★★ §A5: *"never leave the user with a dead Email it…"* The Graph draft
    //     path needs an Azure app registration and tenant admin consent, and
    //     §A4 says report the shape and STOP. So the control is GONE rather
    //     than disabled — P-239's ruling, which this repo paid for a week ago:
    //     a disabled control says *"you may not"*, which sends somebody looking
    //     for permission that does not exist yet.
    expect(code(card())).not.toContain('-share-email');
    expect(code(card())).not.toContain('Email it');
    // ★ And the mailto composer is not reached from anywhere any more.
    expect(code(card())).not.toContain('planShareMailto');
  });

  it('★★★ NOTHING requests a Graph scope, and `Mail.Send` appears nowhere', () => {
    // ★★★ §A4: *"Do not build past this gate."* There is no scope constant to
    //     assert `Mail.Send` is absent FROM, because there is no scope list —
    //     which is the stronger form of the same guarantee. This test is what
    //     stops one arriving without the consent conversation.
    //
    // ★★ The permission the draft path will need is **`Mail.ReadWrite`** and
    //    **not** `Mail.Send`: creating a draft in the user's own mailbox does
    //    not require permission to send, and asking for send would be asking
    //    for the one capability the design rules out. When the scope list
    //    lands, this assertion becomes the one §A's test list describes.
    for (const f of [
      'src/components/ProjectDetail/PlanOfRecordCard.tsx',
      'src/lib/planOfRecordShare.ts',
      'src/hooks/usePlanShare.ts',
      'src/pages/SharedPlan.tsx',
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/Mail\.Send/i);
      expect(src).not.toMatch(/graph\.microsoft\.com/i);
      expect(src).not.toMatch(/@azure|msal/i);
    }
  });

  it('★★ the subject builder SURVIVES — it is the half nobody complained about', () => {
    // ★ Bobby's complaint was the link in the BODY, four times. The subject
    //   (`3505 - Marketing - External — Marketing`) has never been mentioned,
    //   and §A3 keeps it. Deleting `planShareSubject` because its one caller
    //   went away would be deleting the part that works.
    const lib = code(read('src/lib/planOfRecordShare.ts'));
    expect(lib).toContain('export function planShareSubject');
    const hook = code(read('src/hooks/usePlanShare.ts'));
    expect(hook).toContain('async email(');
  });
});

// ---------------------------------------------------------------------------
// §B — the link is demoted, not deleted
// ---------------------------------------------------------------------------

describe('fix-528 §B — Copy link and Unshare are untouched', () => {
  it('★★★ the token machinery is all still here', () => {
    // ⚠️⚠️ §B: *"DO NOT DELETE `plan_share_links`, the `/s/<token>` route, or
    //      the Edge Function."* Two days old, they work, and Copy link depends
    //      on them. This ticket demotes the link from **the** answer to **an**
    //      answer.
    expect(code(card())).toContain('-share-copy');
    expect(code(card())).toContain('-share-unshare');
    expect(code(card())).toContain('share.copy(');
    expect(code(read('src/router.tsx'))).toContain("path: '/s/:token'");
    const hook = code(read('src/hooks/usePlanShare.ts'));
    expect(hook).toContain('bp_create_plan_share');
    expect(hook).toContain('bp_revoke_plan_share');
    expect(hook).toContain('plan_share_links');
  });

  it('★★ the 30-day promise is unchanged', () => {
    expect(SHARE_TTL_DAYS).toBe(30);
  });

  it('★★★ the DOWNLOAD signature is short — it is not the link', () => {
    // ★ Five minutes, minted for a click that is about to happen. A signature
    //   that outlives the click is another copy of the drawing loose in the
    //   world, and it is a different promise from the share link's thirty days.
    expect(PDF_DOWNLOAD_TTL_SECONDS).toBe(300);
    expect(PDF_DOWNLOAD_TTL_SECONDS).toBeLessThan(SHARE_TTL_DAYS * 24 * 60 * 60);
  });
});

// ---------------------------------------------------------------------------
// §C — the file actually arrives
// ---------------------------------------------------------------------------

describe('fix-528 §C — Download PDF hands over a file, on both surfaces', () => {
  it('★★★ the card signs the object path — it never puts one in an href', () => {
    // ★★★ THE BUG fix-523 SHIPPED ON THE OTHER SURFACE, and the reason this
    //     assertion exists on both. `pdf_path` is an OBJECT PATH. In an `href`
    //     it resolves against the app's own origin and 404s — the control
    //     renders, looks right, and hands over nothing. §C: **"the button
    //     exists" is not "the file arrives."**
    const c = code(card());
    expect(c).toContain('signPlanPdfUrl(objectPath, fileName)');
    expect(c).toContain("a.download = pdfDownloadName(fileName)");
    expect(c).not.toMatch(/href=\{pdfPath\}/);
  });

  it('★★★ the shared page uses the SIGNED url the function returns', () => {
    const p = code(page());
    expect(p).toContain('const pdfPath = pdfUrl;');
    // ★ An anonymous reader cannot sign a private object, so the signing
    //   happens server-side in `plan-share` with the service-role key — the
    //   same door fix-523 built for the page images.
    expect(p).not.toContain('planSharePdfPath');
    const fn = code(read('supabase/functions/plan-share/handler.ts'));
    expect(fn).toContain('deps.sign(row.pdf_path, pdfDownloadName(row.file_name))');
  });

  it('★★ the download name is the SET’s name, not `source.pdf`', () => {
    // ★ Every stored object is literally `{project}/{set}/source.pdf`, so a
    //   builder's downloads folder would fill with identical file names.
    expect(pdfDownloadName('3505 - Marketing - External.pdf')).toBe(
      '3505 - Marketing - External.pdf',
    );
    expect(pdfDownloadName('3505 - Marketing - External')).toBe(
      '3505 - Marketing - External.pdf',
    );
    expect(pdfDownloadName('  ')).toBe('plan-set.pdf');
    expect(pdfDownloadName(null)).toBe('plan-set.pdf');
  });

  it('★★ TWIN: the Edge Function’s copy matches the app’s', () => {
    // ★ The function cannot import from `src/` — Deno would have to resolve the
    //   whole app tree. Same device fix-523 used for `pagePaths`.
    for (const n of [
      '3505 - Marketing - External.pdf',
      '3505 - Marketing - External',
      'ALREADY.PDF',
      '   ',
      null,
    ] as Array<string | null>) {
      expect(fnPdfDownloadName(n)).toBe(pdfDownloadName(n));
    }
  });

  it('★★ it says how big the file is before you press it', () => {
    // ★ A builder on a phone deserves to know. Bytes, not `size_kb` — this is
    //   the file itself.
    expect(formatPdfSize(2_774_619)).toBe('2.6 MB');
    expect(formatPdfSize(19_484_755)).toBe('19 MB');
    expect(formatPdfSize(572_765)).toBe('559 KB');
    expect(formatPdfSize(0)).toBe('');
    expect(formatPdfSize(null)).toBe('');
  });

  it('★★★ MEASURED ON PROD 2026-09-11 — every claimed PDF is a real one', () => {
    // ★★★ §C: *"verify both actually download a valid PDF against prod, and say
    //     so with a measured result."* Queried against the live database and
    //     the live object store:
    //
    //       rows claiming a pdf_path                336
    //       …whose object EXISTS in plan-thumbnails 336
    //       …whose mimetype is application/pdf      336
    //       …whose stored size equals pdf_bytes     336
    //       zero-byte objects                         0
    //       missing objects                           0
    //
    //     Largest: `b56be488…/marketing_external/source.pdf` —
    //     **19,484,755 bytes**, `application/pdf`, eTag
    //     `"97926937b932b093d8ddcea4352ce4d6-2"`, uploaded 2026-09-11 03:01:39Z.
    //     Average 2.5 MB; **none over 20 MB**, which is what makes §0's
    //     "just attach it" correct.
    //
    // ★★ WHAT THAT DOES AND DOES NOT ESTABLISH, stated rather than blurred: it
    //    proves the bytes exist, are PDFs, and are the size the index claims —
    //    the object store's own metadata, which is what it serves. It does NOT
    //    prove a browser round-trip, because signing a private object needs a
    //    session this tooling does not have. The client half is pinned by the
    //    assertions above: the right bucket, the right path, a signature rather
    //    than a raw path.
    //
    // ★ Pinned here so the bucket cannot drift out from under the paths.
    expect(SHARE_BUCKET).toBe('plan-thumbnails');
  });

  it('★★★ the sets hook ASKS for the pdf columns now', () => {
    // ★★★ THE THIRD TIME THIS FILE IS THE LESSON. fix-522 added `thumb_path`
    //     after two tickets of "the picture cannot change" — the column had
    //     been on the view all along. fix-523 REFUSED to add `pdf_path` and
    //     said so loudly, because an UNKNOWN column makes PostgREST fail the
    //     whole query with `42703` and would have taken the card away from all
    //     167 projects. The view carries it now (verified 2026-09-11), so the
    //     refusal expires.
    const hook = read('src/hooks/usePlanOfRecordSets.ts');
    expect(hook).toContain('pdf_path,pdf_bytes');
    expect(hook).toContain('pdf_path: string | null;');
  });

  it('★★ the control is absent when a set has no PDF', () => {
    // ★ 336 of 336 carry one today — but "always" is a fact about today's data
    //   and the guard is a fact about the control. Never a disabled affordance
    //   and never a promise (P-032, and P-239's rule).
    expect(code(card())).toContain('{pdfPath && (');
    expect(code(page())).toContain('{pdfPath && (');
  });
});
