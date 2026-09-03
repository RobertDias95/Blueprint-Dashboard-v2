import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import {
  BLOCK_ADDRESS_MAX_LINES,
  BLOCK_ADDRESS_MIN_FONT,
  BLOCK_ADDRESS_CHAR_EM,
  blockAddressFontPx,
  blockAddressLines,
  blockCentresStack,
  blockDetailLines,
  blockFontPx,
  blockStackHeight,
} from '../lib/drawScheduleHelpers';

// ===========================================================================
// ★★★ fix-484 §A4 (P-146) — THE BLOCK, MEASURED IN CHROME
// ===========================================================================
//
// Bobby, 2026-09-02: *"when a project is on one quarter and goes to the next,
// it slams to the top or the bottom… it's going off the screen, a ton of
// colour and just a little bit of text."*
//
// ★★ THE PROJECT HE NAMED IS `540 3rd Ave N` AND IT DOES NOT EXIST. Prod has
// no such address. What it has is **548 3rd Ave N [Redesign 1]** —
// 2026-06-22 → 2026-08-17, which crosses the Q2/Q3 boundary and is therefore
// exactly the case: a 2-week HEAD slice in Q2 and a 7-week TAIL slice in Q3.
// One digit. Measured against the real row.
//
// ---------------------------------------------------------------------------
// WHAT THIS IMPORTS AND WHAT IT TRANSCRIBES
// ---------------------------------------------------------------------------
// It imports the REAL fit helpers from `lib/drawScheduleHelpers` — every number
// below comes out of the functions the grid renders with. What it transcribes
// is the four layout constants that live in `DrawScheduleGrid.tsx` and cannot
// be exported from it (react-refresh: a component module exports only
// components): `DA_MIN_W`, `LABEL_W`, `BASE_ROW_H` and the block's padding.
// ★ `DrawBlockFitFix484.test.ts` asserts these four against the component's own
//   source, so the harness cannot drift from the thing it is measuring.
const DA_MIN_W = 90;
const LABEL_W = 88;
const BASE_ROW_H = 28;
const BLOCK_INSET = 2; // left/right: 2
const BLOCK_PAD_X = 6; // padding: '1px 6px'

// The chrome between the viewport and the grid card, named so a reader can
// chase each one (fix-422's discipline).
const CHROME = {
  ribbon: 212, // Ribbon.tsx WIDTH_EXPANDED
  shellPadding: 48, // Chrome.tsx <main class="p-6">
  subTabBar: 34, // DrawSchedule.tsx ds-subtab-bar
  toolbar: 44, // DrawScheduleGrid Toolbar
  gaps: 24, // flex gap-3 ×2
  unscheduled: 120, // the max-h-[20vh] unscheduled card, typical
  headerBands: 52, // DM band + DA band, sticky
};

const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1440, h: 900 },
] as const;

/** The real prod rows this measures. */
const CASES = [
  {
    id: 'q3-tail',
    label: '548 3rd Ave N [Redesign 1]',
    weeks: 7,
    overflow: 'tail' as const,
    note: 'Q3 tail — the screenshot',
  },
  {
    id: 'q2-head',
    label: '548 3rd Ave N [Redesign 1]',
    weeks: 2,
    overflow: 'head' as const,
    note: 'Q2 head',
  },
  {
    id: 'in-quarter',
    label: '548 3rd Ave N',
    weeks: 4,
    overflow: null,
    note: 'fully in quarter',
  },
  { id: 'one-week', label: '611 3rd Ave N', weeks: 1, overflow: null, note: '1-week' },
  {
    id: 'long',
    label: '13021 23rd Ave NE [Redesign 2]',
    weeks: 6,
    overflow: null,
    note: 'longest real address',
  },
] as const;

type Mode = 'before' | 'after';

function geometry(vp: (typeof VIEWPORTS)[number], daCount = 13, weekCount = 13) {
  const cardW = vp.w - CHROME.ribbon - CHROME.shellPadding;
  const rowsAreaH =
    vp.h -
    CHROME.shellPadding -
    CHROME.subTabBar -
    CHROME.toolbar -
    CHROME.gaps -
    CHROME.unscheduled -
    CHROME.headerBands;
  const rowH = Math.max(BASE_ROW_H, Math.floor(rowsAreaH / weekCount));
  const textScale = Math.min(1.7, Math.max(1, rowH / BASE_ROW_H));
  const labelW = Math.round(LABEL_W * textScale);
  const daColW = Math.max(DA_MIN_W, Math.floor((cardW - labelW) / daCount));
  return { cardW, rowsAreaH, rowH, textScale, labelW, daColW };
}

function Block({
  mode,
  label,
  weeks,
  overflow,
  daColW,
  rowH,
  textScale,
  id,
}: {
  mode: Mode;
  label: string;
  weeks: number;
  overflow: 'tail' | 'head' | null;
  daColW: number;
  rowH: number;
  textScale: number;
  id: string;
}) {
  const height = weeks * rowH - 3;
  const baseFontPx = blockFontPx(weeks);
  const detailFont = Math.round((baseFontPx - 1) * textScale);
  const ramp = Math.round((baseFontPx + 1) * textScale);
  const isCompact = !!overflow || weeks <= 1;
  const addrBoxW = Math.max(0, daColW - BLOCK_INSET * 2 - BLOCK_PAD_X * 2);

  // ★ BEFORE = origin/main: the ramp font, one line + ellipsis, and the anchor
  //   keyed off `isCompact` (so every cross-quarter slice top-anchors).
  // ★ AFTER  = fix-484: the stepped font, up to two lines, and the anchor keyed
  //   off whether the stack FITS.
  const addrFont =
    mode === 'before'
      ? ramp
      : blockAddressFontPx(label, addrBoxW, ramp, BLOCK_ADDRESS_MIN_FONT);
  const addrLines =
    mode === 'before'
      ? 1
      : Math.min(BLOCK_ADDRESS_MAX_LINES, blockAddressLines(label, addrFont, addrBoxW));
  const centres =
    mode === 'before'
      ? !isCompact
      : blockCentresStack(
          height,
          blockStackHeight(addrLines, addrFont, detailFont, blockDetailLines(isCompact)),
        );

  const oneLine = {
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  };
  const clamped = {
    display: '-webkit-box' as const,
    WebkitLineClamp: BLOCK_ADDRESS_MAX_LINES,
    WebkitBoxOrient: 'vertical' as const,
    overflowWrap: 'anywhere' as const,
    overflow: 'hidden' as const,
  };

  return (
    <div
      data-block={`${mode}:${id}`}
      data-font={addrFont}
      data-lines={addrLines}
      data-centres={centres ? 'yes' : 'no'}
      style={{
        position: 'relative',
        width: daColW - BLOCK_INSET * 2,
        height,
        marginBottom: 8,
        background: 'var(--color-de-bg)',
        border: '2px solid var(--color-de-border)',
        borderRadius: 4,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: centres ? 'center' : 'flex-start',
        textAlign: 'center',
        gap: 1,
        padding: '1px 6px',
        color: 'var(--color-text)',
      }}
    >
      <span
        data-addr
        style={{
          fontSize: addrFont,
          fontWeight: 800,
          lineHeight: 1.1,
          maxWidth: '100%',
          ...(mode === 'before' ? oneLine : clamped),
        }}
        title={label}
      >
        {label}
      </span>
      {!isCompact && (
        <span style={{ fontSize: detailFont, opacity: 0.75, lineHeight: 1.1 }}>Seattle</span>
      )}
      {!isCompact && (
        <span
          style={{
            fontSize: Math.round(6 * textScale),
            fontWeight: 700,
            padding: '0px 3px',
            borderRadius: 2,
            background: 'rgba(255,255,255,0.55)',
            border: '1px solid var(--color-de-border)',
          }}
        >
          Under Review
        </span>
      )}
      <span style={{ fontSize: detailFont, lineHeight: 1.1 }}>Est. Approval</span>
      <span style={{ fontSize: detailFont, fontWeight: 800, lineHeight: 1.1 }}>10/14/26</span>
    </div>
  );
}

function App() {
  return (
    <div style={{ padding: 16, background: 'var(--color-bg)', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 15, margin: '0 0 4px' }}>
        fix-484 §A — the Draw Schedule block, measured
      </h1>
      <p style={{ fontSize: 11, color: 'var(--color-muted)', maxWidth: '80ch' }}>
        BEFORE = origin/main @ 5dfb39a (one line + ellipsis, anchor keyed off
        <code> isCompact</code>). AFTER = fix-484 (two lines, stepped font,
        anchor keyed off whether the stack fits). Report at the bottom.
      </p>
      {VIEWPORTS.map((vp) => {
        const g = geometry(vp);
        return (
          <div key={vp.w} style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {vp.w}×{vp.h} · card {g.cardW} · rowH {g.rowH} · textScale{' '}
              {g.textScale.toFixed(2)} · labelW {g.labelW} · daColW {g.daColW}
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 6 }}>
              {(['before', 'after'] as const).map((mode) => (
                <div key={mode} data-vp={vp.w} data-mode={mode}>
                  <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>{mode}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    {CASES.map((c) => (
                      <div key={c.id}>
                        <div style={{ fontSize: 9, color: 'var(--color-dim)' }}>{c.note}</div>
                        <Block
                          mode={mode}
                          id={`${vp.w}:${c.id}`}
                          label={c.label}
                          weeks={c.weeks}
                          overflow={c.overflow}
                          daColW={g.daColW}
                          rowH={g.rowH}
                          textScale={g.textScale}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 11, color: 'var(--color-muted)' }}>
        BLOCK_ADDRESS_CHAR_EM = {BLOCK_ADDRESS_CHAR_EM} · floor ={' '}
        {BLOCK_ADDRESS_MIN_FONT}px × textScale
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
