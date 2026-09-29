import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../index.css';
import ChatAttachments from '../components/ProjectDetail/ChatAttachments';
import type { ChatAttachment } from '../lib/chatAttachments';

// ===========================================================================
// ★★★ fix-563 (P-267) — THE ATTACHMENT CARDS, RENDERED
// ===========================================================================
//
// Bobby: *"those kind of show up as, like, gray blobs… it would be nice if there
// was maybe a logo or something."* His screenshot was four PDFs in a row.
//
// ★★★ THE 22 ASSERTIONS PROVE THE MARKUP AND CANNOT PROVE IT IS LEGIBLE — and
//     "legible" is the entire request. fix-406's lesson: a styling change nothing
//     renders is indistinguishable from a styling change that does nothing, and
//     an icon that comes out as a smudge at 14px passes every test in the suite.
//
// ★★ THE FIRST ROW IS BOBBY'S SCREENSHOT, rebuilt from the real filenames: four
//    `10431 - SFR1..4 - Correction Letter CR2.pdf` cards. That is the "before"
//    this ticket is judged against — the only difference should be that you can
//    now tell at a glance what they are and how big.
//
// ⚠️ WHAT THIS HARNESS DOES **NOT** SHOW, stated rather than implied: the §B
//    FALLBACK. The signed-URL hook is not mocked and there is no session, so
//    every image takes the *"could not be signed"* branch — which is fix-330's
//    older, different failure. Reaching the fallback needs a signature that
//    mints over a dead object, which cannot be staged without a real session.
//
// ★★ THAT PATH IS COVERED WHERE IT CAN BE PROVEN: `ChatFileLooksLikeAFileFix563`
//    fires a real `error` on the rendered <img> and re-queries the DOM, which is
//    how §B asks for it — *"with a broken path, not by reading the handler"*. The
//    fallback renders the same §A card shown here, with the image icon.
//
// HOW TO RUN
//     npm run dev  →  http://localhost:5173/harness/chat-attachment-cards-563.html

const F = (
  name: string,
  mime: string,
  size: number,
  path = name,
): ChatAttachment => ({ path, name, mime, size });

/** Bobby's screenshot: four correction letters, told apart only by reading. */
const CORRECTION_LETTERS: ChatAttachment[] = [1, 2, 3, 4].map((i) =>
  F(
    `10431 - SFR${i} - Correction Letter CR2.pdf`,
    'application/pdf',
    // ★ Deliberately different sizes — §A: *"a 17 MB correction letter and a
    //   200 KB one are different objects and currently look identical."*
    [17_931_642, 204_800, 3_512_000, 53_916][i - 1]!,
    `p/u${i}/cr2.pdf`,
  ),
);

/** One of each kind, including the 5-file XLSX case the brief did not have. */
const ONE_OF_EACH: ChatAttachment[] = [
  F('site-plan.pdf', 'application/pdf', 11 * 1024 * 1024, 'p/a/site.pdf'),
  F('snip.png', 'image/png', 458_915, 'p/b/snip.png'),
  F('photo.jpeg', 'image/jpeg', 1_362_500, 'p/c/photo.jpeg'),
  F('takeoffs.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    344_208, 'p/d/takeoffs.xlsx'),
  F('notes.txt', 'text/plain', 812, 'p/e/notes.txt'),
];

/** The edge cases the suite asserts but nobody has looked at. */
const EDGES: ChatAttachment[] = [
  F('an-extremely-long-correction-letter-filename-that-will-not-fit-on-one-line.pdf',
    'application/pdf', 2_500_000, 'p/f/long.pdf'),
  { path: 'p/g/mystery', name: 'mystery' } as unknown as ChatAttachment,
  F('unknown.bin', 'application/x-nonsense', 1024, 'p/h/unknown.bin'),
];

function Panel({
  title,
  note,
  attachments,
  width,
  compact = false,
}: {
  title: string;
  note: string;
  attachments: ChatAttachment[];
  width: number;
  compact?: boolean;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          font: '700 13px/1.3 system-ui, sans-serif',
          color: 'var(--color-text)',
          margin: '0 0 2px',
        }}
      >
        {title}
      </h2>
      <p
        style={{
          font: '11px/1.4 system-ui, sans-serif',
          color: 'var(--color-muted)',
          margin: '0 0 8px',
        }}
      >
        {note}
      </p>
      {/* ★ A hard width, so what you see is what a real column gives it. 320px is
          a phone; 240px is the rail card fix-330 sized the compact chip for. */}
      <div
        style={{
          width,
          border: '1px dashed var(--color-border)',
          padding: 8,
          borderRadius: 8,
        }}
      >
        <ChatAttachments attachments={attachments} compact={compact} />
      </div>
    </section>
  );
}

function Harness() {
  return (
    <div
      style={{
        padding: 24,
        background: 'var(--color-bg)',
        minHeight: '100vh',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 32,
        alignItems: 'flex-start',
      }}
    >
      <div>
        <Panel
          title="Bobby's screenshot — four correction letters"
          note="Before: four identical grey rectangles. The icon and the size are the whole change."
          attachments={CORRECTION_LETTERS}
          width={640}
        />
        <Panel
          title="One of each kind"
          note="PDF · image · image · generic (XLSX, 5 live files) · generic (text)"
          attachments={ONE_OF_EACH}
          width={640}
        />
      </div>
      <div>
        <Panel
          title="At phone width (320px)"
          note="Five cards must wrap, not overflow. jsdom cannot see this; a browser can."
          attachments={CORRECTION_LETTERS}
          width={320}
        />
        <Panel
          title="Edge cases"
          note="A filename that cannot fit, an entry with no mime AND no size, an unknown type."
          attachments={EDGES}
          width={320}
        />
        <Panel
          title="The rail chip (compact, 240px)"
          note="Same kind derivation as the card, at 10px. It used two emoji for five kinds."
          attachments={ONE_OF_EACH}
          width={240}
          compact
        />
      </div>
    </div>
  );
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>
  </StrictMode>,
);
