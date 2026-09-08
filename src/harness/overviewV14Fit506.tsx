import { StrictMode, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_ROW_MIN_WIDTH,
  overviewMinViewport,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';

// ===========================================================================
// ★★★ fix-506 STEP 0-1 — DOES THE MOCK'S 470px PLAN OF RECORD COLUMN FIT?
// ===========================================================================
//
// The brief makes this a STOP CONDITION:
//
//   "If STEP 0-1 shows the mock's 470px Plan of Record column cannot fit at
//    1600 without clipping the units matrix, stop and report with the numbers
//    — that is a layout ruling, not yours to make."
//
// ★★★ AND THE MOCK IS DRAWN ON A NARROWER SHELL THAN THE APP SHIPS.
//     overview_book_v14.html:470   cols:'188px 470px 1.05fr 1.15fr'
//     overview_book_v14.html:17    .app{grid-template-columns:200px 1fr}
//
//                    app     mock
//       ribbon       212      200
//       permits rail 240      188
//     …plus shell 48 · page row 24 · rail gap 12 · pillbox 2 · header 32.
//
//     So the app's overview row is ~118px narrower than the drawing's before a
//     single card is placed — [[a-mock-measures-a-drawing-not-the-control-you-
//     ship]], which is why this page measures instead of trusting proportions.
//
// ★★ WHAT IT MEASURES, and why each number matters:
//     · Site data alone, and the Dates card alone, at the MOCK'S OWN label
//       widths (64 / 70 / 88px, read out of its CSS) — so the question
//       "beside or below?" can be answered in pixels.
//     · The transposed units matrix at 2 / 4 / 6 type columns. Those are the
//       counts that exist on prod: 59 projects have 2, 9 have 4, and 2 have 6
//       — including 403 W Dravus St, the brief's own measurement project.
//     · What Project actually GETS under `470px 1.05fr 1.15fr`.
//
// HOW TO RUN
//     npm run dev  →  http://localhost:5173/harness/overview-v14-fit-506.html
// The window size does not matter: every width is resolved from the app's own
// overviewRowWidthAt / resolveOverviewWidths.

const VIEWPORTS = [1920, 1600, 1440] as const;

/** The mock's three-box proportions, minus the rail — the app renders that
 *  outside this grid and `overviewRowWidthAt` already subtracts it. */
const V14 = { porPx: 470, projFr: 1.05, teamFr: 1.15 };

/** ★ The MOCK'S OWN arithmetic: a bare `fr` pair splitting what the fixed
 *  470px column leaves. No floors — which is the point of comparing it with
 *  the app's `minmax(floor, fr)` rule below. */
function v14BareFr(rowPx: number) {
  const free = rowPx - V14.porPx - 2 * OVERVIEW_GRID_GAP;
  const total = V14.projFr + V14.teamFr;
  return { por: V14.porPx, proj: (free * V14.projFr) / total, team: (free * V14.teamFr) / total };
}

const UNIT_ATTRS = ['Width', 'Depth', 'Size (sf)', 'Qty', 'Stories', 'Parking', 'Stalls', 'Roof deck'];

const SITE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Zone', 'NR3 · 5,000 sf'], ['Lot', '40 × 125'], ['Lot size', '5,000 sf'],
  ['Corner', 'No'], ['Alley', 'Paved'], ['Units', '6'],
  ['Reuse', '13515 27th Ave NE'], ['Tags', 'Townhome · DADU'],
];
const DATES_LEFT: ReadonlyArray<readonly [string, string]> = [
  ['DD start', '2026-04-13'], ['Consultant', '2026-05-01'], ['DD end', '2026-06-05'],
];
const DATES_RIGHT: ReadonlyArray<readonly [string, string]> = [
  ['Accepted', '2026-06-22'], ['ACQ target', '2026-09-30'], ['Est. approval', '2026-10-14'],
];

/** One label/value row at the mock's own type scale. Hoisted — a component
 *  declared inside another is re-created every render, which the React
 *  Compiler lint rejects outright. */
function Field({ label, value, lw }: { label: string; value: string; lw: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${lw}px 1fr`,
        gap: '0 8px',
        padding: '2.5px 0',
        fontSize: 10.5,
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function FieldBlock({ rows, lw }: { rows: ReadonlyArray<readonly [string, string]>; lw: number }) {
  return (
    <div style={{ display: 'inline-block' }}>
      {rows.map(([l, v]) => (
        <Field key={l} label={l} value={v} lw={lw} />
      ))}
    </div>
  );
}

function UnitMatrix({ cols }: { cols: number }) {
  return (
    <table style={{ width: 'max-content', borderCollapse: 'collapse', fontSize: 10.5 }}>
      <tbody>
        <tr>
          <th style={{ padding: '2px 6px' }} />
          {Array.from({ length: cols }, (_, i) => (
            <th key={i} style={{ padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Unit {i + 1}
            </th>
          ))}
        </tr>
        {UNIT_ATTRS.map((a) => (
          <tr key={a}>
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {a}
            </th>
            {Array.from({ length: cols }, (_, i) => (
              <td key={i} style={{ padding: '2px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                {a === 'Parking' ? 'Garage' : a === 'Roof deck' ? 'Yes' : a === 'Size (sf)' ? '1,840' : '24'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** ★ ONE measuring pass over every probe, after layout. No per-probe callback
 *  and no ref written during render — both of which only LINT catches here. */
function measureProbes(): Record<string, number> {
  const out: Record<string, number> = {};
  document.querySelectorAll<HTMLElement>('[data-probe]').forEach((el) => {
    out[el.dataset.probe!] = Math.ceil(el.getBoundingClientRect().width);
  });
  return out;
}

/** ★★★ THE REPORT IS BUILT IN THE EFFECT AND WRITTEN TO THE DOM, not held in
 *  state. `setState` inside an effect is a LINT ERROR in this repo ("can
 *  trigger cascading renders") — the trap fix-350/403/426/487 each hit — and a
 *  measurement page is precisely the case the rule allows: the effect is
 *  updating an external system (the DOM) with numbers only layout can give. */
function buildReport(m: Record<string, number>): string {
  const site = m.site ?? 0;
  const datesCard = (m.datesL ?? 0) + (m.datesR ?? 0) + 14; // the mock's column-gap
  const beside = site + datesCard + 14;
  const below = Math.max(site, datesCard);
  const matrix6 = m.matrix6 ?? 0;

  const needBeside = Math.max(beside, matrix6);
  const needBelow = Math.max(below, matrix6);
  const teamFloor = 160; // today's Team floor, unchanged by this ticket

  const L: string[] = [];
  L.push('fix-506 STEP 0-1 — measured in Chrome');
  L.push('');
  L.push('TODAY — five cards');
  L.push(`  OVERVIEW_ROW_MIN_WIDTH ${OVERVIEW_ROW_MIN_WIDTH} · unwrapped from ${overviewMinViewport()}px`);
  L.push(`  floors ${OVERVIEW_CARD_COLUMNS.map((c) => `${c.key}=${c.minPx}`).join(' ')}`);
  for (const vp of VIEWPORTS) {
    const row = overviewRowWidthAt(vp);
    const w = resolveOverviewWidths(row).map(Math.round);
    L.push(`  ${vp}: row ${row} → ${OVERVIEW_CARD_COLUMNS.map((c, i) => `${c.key} ${w[i]}`).join(' · ')}`);
  }
  L.push('');
  L.push('WHAT THE v14 PROJECT CARD NEEDS (max-content, mock label widths)');
  L.push(`  Site data alone                 ${site}`);
  L.push(`  Dates card alone                ${datesCard}   (${m.datesL} + ${m.datesR} + 14 gap)`);
  L.push(`  Site + Dates SIDE BY SIDE       ${beside}   ← the mock's layout`);
  L.push(`  Site + Dates STACKED            ${below}`);
  L.push(`  units matrix  2 / 4 / 6 types   ${m.matrix2} / ${m.matrix4} / ${matrix6}`);
  L.push(`  → Project floor, side by side   ${needBeside}`);
  L.push(`  → Project floor, stacked        ${needBelow}`);
  L.push('');
  L.push("WHAT THE MOCK'S BARE `470px 1.05fr 1.15fr` GIVES");
  for (const vp of VIEWPORTS) {
    const g = v14BareFr(overviewRowWidthAt(vp));
    L.push(
      `  ${vp}: por ${g.por} · proj ${Math.round(g.proj)} · team ${Math.round(g.team)}` +
        `   ${g.proj >= needBeside ? 'fits' : `CLIPS by ${Math.ceil(needBeside - g.proj)}`}`,
    );
  }
  L.push('');
  L.push('WITH DERIVED FLOORS (§A\'s rule: minmax(floor, fr), never a bare fr)');
  for (const [name, need] of [['side by side', needBeside], ['stacked', needBelow]] as const) {
    const rowNeeded = V14.porPx + need + teamFloor + 2 * OVERVIEW_GRID_GAP;
    L.push(`  Dates ${name}: row must be ≥ ${rowNeeded} → unwrapped from ${rowNeeded + 570}px viewport`);
    for (const vp of VIEWPORTS) {
      const row = overviewRowWidthAt(vp);
      L.push(`      ${vp}: row ${row} ${row >= rowNeeded ? 'FITS' : `short by ${rowNeeded - row}`}`);
    }
  }

  return L.join(String.fromCharCode(10));
}

function App() {
  const out = useRef<HTMLPreElement | null>(null);
  useLayoutEffect(() => {
    if (out.current) out.current.textContent = buildReport(measureProbes());
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 16, fontWeight: 800 }}>fix-506 STEP 0-1 · does 470px fit?</h1>
      <div style={{ position: 'absolute', left: -99999, top: 0 }}>
        <div data-probe="site" style={{ display: 'inline-block' }}>
          <FieldBlock rows={SITE_ROWS} lw={64} />
        </div>
        <div data-probe="datesL" style={{ display: 'inline-block' }}>
          <FieldBlock rows={DATES_LEFT} lw={70} />
        </div>
        <div data-probe="datesR" style={{ display: 'inline-block' }}>
          <FieldBlock rows={DATES_RIGHT} lw={88} />
        </div>
        {[2, 4, 6].map((c) => (
          <div key={c} data-probe={`matrix${c}`} style={{ display: 'inline-block' }}>
            <UnitMatrix cols={c} />
          </div>
        ))}
      </div>
      <pre ref={out} id="fix506-report" style={{ fontSize: 12, lineHeight: 1.5 }} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
