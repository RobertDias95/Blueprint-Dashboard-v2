import { StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { OverviewCard, OverviewSection, OverviewAction } from '../components/ProjectDetail/OverviewCard';
import {
  OVERVIEW_CARD_COLUMNS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_ROW_MIN_WIDTH,
  TEAM_INTERNAL_ROWS,
  TEAM_INTERNAL_ROW_GAP,
  overviewRowWidthAt,
  resolveOverviewWidths,
} from '../lib/overviewCardLayout';
import { CONSULTANT_DATE_LABEL, CONSULTANT_DATE_SLOTS } from '../lib/consultants';

// ===========================================================================
// ★★★ fix-479 §F — THE OVERVIEW ROW, MEASURED IN CHROME
// ===========================================================================
//
// ★★★ WHAT THIS IS AND IS NOT. It imports the REAL `OverviewCard` /
// `OverviewSection` / `OverviewAction` primitives and the REAL layout
// constants (`OVERVIEW_CARD_COLUMNS`, `resolveOverviewWidths`,
// `TEAM_INTERNAL_ROWS`, `CONSULTANT_DATE_SLOTS`), so the frame, the banner,
// the separators, the section height distribution and every card WIDTH are
// the app's own. The card INTERIORS are transcribed from the class strings in
// `ProjectDetailHeader.tsx` / `ConsultantsCard.tsx` — the same method
// fix-453's harness used, and for the same reason: the real cards are wired to
// fifteen hooks and a Supabase client, and a harness that had to log in would
// measure nothing.
//
// ★★★ SO IT CARRIES ITS OWN CALIBRATION. Milestones is transcribed in full and
// its height is checked against fix-453's Chrome measurement of **412px**. If
// this harness cannot reproduce a number the repo already published for an
// UNCHANGED card, none of its other numbers should be believed — and the page
// says so out loud rather than leaving the reader to notice.
//
// ★ Project and Design Plan of Record are NOT transcribed. fix-479 does not
//   touch either, and their heights enter the row max as fix-453's published
//   Chrome numbers, labelled as carried forward.
//
// HOW TO RUN
//     npm run dev   →   http://localhost:5173/harness/overview-height-479.html
// Set the browser window to 1920 or 1440 wide; the page measures at BOTH by
// resolving the row width from the app's own `overviewRowWidthAt`, so the
// window size does not have to match.

// ---------------------------------------------------------------------------
// Carried forward from fix-453 (docs/FIX_453_OVERVIEW_HEIGHT_MEASUREMENT.md)
// ---------------------------------------------------------------------------
const FIX453 = {
  milestones: 412,
  projectOneType: 424,
  projectSixTypes: 544,
  por: 92,
  /** The External section's own height, measured by fix-423 in Chrome. */
  externalEmpty: 251,
  externalFull: 256,
};

// ---------------------------------------------------------------------------
// Milestones — transcribed from ProjectDetailHeader.tsx (the calibration card)
// ---------------------------------------------------------------------------
const MILESTONE_LABEL_CLASS = 'text-[9px] text-dim w-20 flex-shrink-0 whitespace-nowrap';
const MILESTONE_BOX_CLASS = 'text-[11px] font-semibold px-1.5 py-0.5 border rounded flex-1 min-w-0';
const MILESTONE_BOX_STYLE = {
  borderColor: 'var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
} as const;
const MILESTONE_INPUT_CLASS =
  'w-full bg-transparent border-0 outline-none p-0 text-[11px] font-semibold text-text disabled:opacity-50';

function DateRow({ label, value, editable }: { label: string; value: string; editable?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" data-milestone-row="">
      <span className={MILESTONE_LABEL_CLASS}>{label}</span>
      <div className={`${MILESTONE_BOX_CLASS}${editable ? '' : ' cursor-default'}`} style={MILESTONE_BOX_STYLE}>
        {editable ? (
          <input type="date" defaultValue={value} className={MILESTONE_INPUT_CLASS} />
        ) : (
          value || '—'
        )}
      </div>
    </div>
  );
}

function MilestonesCard() {
  return (
    <OverviewCard title="Milestones">
      <OverviewSection title="Key dates">
        <div className="flex flex-col gap-1.5">
          <DateRow label="GO Date" value="06/05/2026" />
          <DateRow label="Closing" value="—" />
        </div>
      </OverviewSection>
      <OverviewSection title="DD window">
        <div className="flex flex-col gap-1.5">
          <DateRow label="SD start" value="05/08/2026" />
          <DateRow label="SD end" value="06/05/2026" />
          <div role="separator" className="border-b border-dashed" style={{ borderColor: 'var(--color-border)' }} />
          <DateRow label="DD start" value="2026-06-05" editable />
          <DateRow label="Consultant" value="07/24/2026" />
          <DateRow label="DD end" value="2026-07-31" editable />
        </div>
      </OverviewSection>
      <OverviewSection title="Permit intake">
        <div className="flex flex-col gap-1.5">
          <DateRow label="Target Submit" value="2026-08-14" editable />
          <DateRow label="Intake Accepted" value="09/02/2026" />
        </div>
      </OverviewSection>
      <OverviewSection pinBottom>
        <OverviewAction onClick={() => {}} testId="h-draw">
          Draw schedule · Q3 2026 →
        </OverviewAction>
      </OverviewSection>
    </OverviewCard>
  );
}

// ---------------------------------------------------------------------------
// Team — BEFORE (with External) and AFTER (fix-479 §A)
// ---------------------------------------------------------------------------
const ROSTER: Record<string, string> = {
  acq: 'Greg',
  ent: 'Miles',
  sd: 'Ana',
  dm: 'Jade',
  da: 'Nicky',
};

function BuilderDisclosure() {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="w-full text-left rounded border px-2 py-1"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
      >
        <span className="block text-[9px] font-bold" style={{ color: 'var(--color-muted)' }}>
          Expand ⌄
        </span>
        <span className="block text-[11.5px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>
          Cam
        </span>
        <span className="block text-[10.5px] truncate" style={{ color: 'var(--color-muted)' }}>
          Blue Fern Development
        </span>
      </button>
    </div>
  );
}

function InternalRoster() {
  return (
    <div className="flex flex-col" style={{ gap: TEAM_INTERNAL_ROW_GAP }}>
      {TEAM_INTERNAL_ROWS.map((r) => (
        <div key={r.key}>
          <div
            className="text-[8.5px] font-extrabold uppercase"
            style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
          >
            {r.title}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="inline-flex items-center justify-center rounded-full text-[8px] font-bold"
              style={{ width: 16, height: 16, background: 'var(--color-de-bg)', color: 'var(--color-de)' }}
            >
              {ROSTER[r.key]?.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-[11.5px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              {ROSTER[r.key]}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** ★ The External section EXACTLY as it rendered on origin/main @ 52b7cf6 —
 *  this is the "before" half of §F and the only reason it is still written
 *  down anywhere. Empty (the 148-of-202 case) and full (5 firms). */
function ExternalSection({ firms }: { firms: string[] }) {
  if (firms.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-dim whitespace-nowrap">None yet</span>
        <select
          className="text-[9px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer text-dim"
          style={{ borderBottomColor: 'var(--color-border)' }}
        >
          <option>+ Add discipline…</option>
        </select>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {firms.map((d) => (
        <div key={d} className="flex flex-col gap-0.5">
          <span className="text-[8px] font-bold text-dim uppercase tracking-wide">{d}</span>
          <select
            className="text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5"
            style={{ borderBottomColor: 'var(--color-border)' }}
          >
            <option>Firm name here</option>
          </select>
        </div>
      ))}
      <select
        className="text-[9px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer text-dim"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        <option>+ Add discipline…</option>
      </select>
    </div>
  );
}

/** The four-slot EMPTY External block — fix-193's rule, which is the 251px
 *  fix-423 measured before it collapsed it to one line. Kept so the doc can
 *  quote the number the section cost across its whole life. */
function ExternalFourSlots() {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-[8px] leading-tight rounded border px-1.5 py-1"
        style={{
          background: 'var(--color-co-bg)',
          borderColor: 'var(--color-co-border)',
          color: 'var(--color-co)',
        }}
      >
        No external team yet — add a Surveyor / Structural / Arborist below.
      </div>
      {['Civil', 'Surveyor', 'Structural', 'Arborist'].map((d) => (
        <div key={d} className="flex flex-col gap-0.5">
          <span className="text-[8px] font-bold text-dim uppercase tracking-wide">{d}</span>
          <select
            className="text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5"
            style={{ borderBottomColor: 'var(--color-border)' }}
          >
            <option>Unassigned</option>
          </select>
        </div>
      ))}
      <select
        className="text-[9px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer text-dim"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        <option>+ Add discipline…</option>
      </select>
    </div>
  );
}

function ChatPreview() {
  return (
    <div className="flex flex-col gap-1.5">
      {['ACQ Questions', 'Survey'].map((t, i) => (
        <div key={t} className="flex gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-bold text-text truncate">{t}</span>
              <span className="text-[9px] text-dim flex-shrink-0">{i} {i === 1 ? 'reply' : 'replies'}</span>
            </div>
            <div
              className="text-[11px] text-text"
              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              Builder says they are likely selling the parcel next door.
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type ExternalShape = 'none' | 'empty-four-slots' | 'five';

/** ★★★ §B's ACCEPTANCE, MEASURED. The expanded Builder/Owner card is rendered
 *  here exactly as `BuilderOwnerDisclosure` renders it — a `position: fixed`
 *  layer, sized by the hook — so the Team card's own height can be read with it
 *  OPEN and CLOSED. A fixed box contributes nothing to an ancestor's layout, so
 *  the two numbers must be byte-identical; if they ever differ, the panel has
 *  fallen back into flow. */
function FloatingBuilderPanel() {
  return (
    <div
      className="shadow-xl rounded-md"
      style={{ position: 'fixed', top: 200, left: 40, width: 217, maxHeight: 420, overflowY: 'auto', zIndex: 40, background: 'var(--color-surface)' }}
    >
      <OverviewCard title="Builder / Owner">
        <OverviewSection>
          <div className="flex flex-col gap-1.5">
            {['Owner', 'Business', 'Email', 'Cell', 'LLC Address', 'Point of Contact', 'Contact Email'].map((l) => (
              <div key={l}>
                <span className="text-[8px] font-bold text-dim uppercase tracking-wide">{l}</span>
                <input
                  className="text-[12px] font-bold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5"
                  style={{ borderBottomColor: 'var(--color-border)' }}
                  defaultValue="Blue Fern Development"
                />
              </div>
            ))}
          </div>
        </OverviewSection>
      </OverviewCard>
    </div>
  );
}

function TeamCard({ external, panelOpen }: { external: ExternalShape | null; panelOpen?: boolean }) {
  return (
    <OverviewCard title="Team">
      <OverviewSection title="Builder / Owner">
        <BuilderDisclosure />
        {panelOpen && <FloatingBuilderPanel />}
      </OverviewSection>
      <OverviewSection title="Internal">
        <InternalRoster />
      </OverviewSection>
      {external !== null && (
        <OverviewSection title="External">
          {external === 'empty-four-slots' ? (
            <ExternalFourSlots />
          ) : (
            <ExternalSection
              firms={external === 'five' ? ['Civil', 'Surveyor', 'Structural', 'Arborist', 'Geotech'] : []}
            />
          )}
        </OverviewSection>
      )}
      <OverviewSection title="Chat">
        <ChatPreview />
      </OverviewSection>
      <OverviewSection pinBottom>
        <OverviewAction onClick={() => {}} testId="h-chat">
          Chat · 2 posts
        </OverviewAction>
      </OverviewSection>
    </OverviewCard>
  );
}

// ---------------------------------------------------------------------------
// Consultants — transcribed from ConsultantsCard.tsx
// ---------------------------------------------------------------------------
const DISCIPLINES = ['Arborist', 'Civil', 'Energy', 'Geotech', 'Structural', 'Surveyor'];

function ConsultantPill({ discipline }: { discipline: string }) {
  const slots = CONSULTANT_DATE_SLOTS.Scheduled;
  return (
    <div
      className="rounded border mb-1.5 overflow-hidden"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div className="px-2 py-1.5">
        <div
          className="text-[8.5px] font-extrabold uppercase mb-0.5"
          style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
        >
          {discipline}
        </div>
        <select
          className="w-full text-[11.5px] font-bold rounded px-1 py-0.5 border min-w-0"
          style={{ borderColor: 'transparent', background: 'transparent', color: 'var(--color-text)' }}
        >
          <option>Seattle Tree Consulting</option>
        </select>
        <select
          className="w-full text-[9.5px] font-extrabold uppercase rounded-full px-2 py-0.5 border mt-1"
          style={{
            letterSpacing: '0.04em',
            background: 'var(--color-co-bg)',
            color: 'var(--color-wa)',
            borderColor: 'var(--color-co-border)',
          }}
        >
          <option>Scheduled</option>
        </select>
        <div className="flex flex-col gap-1 mt-1.5">
          {slots.map((field) => (
            <label key={field} className="block">
              <span
                className="block text-[8.5px] font-extrabold uppercase mb-0.5"
                style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
              >
                {CONSULTANT_DATE_LABEL[field]}
              </span>
              <input
                type="date"
                className="w-full text-[10.5px] rounded px-1 py-0.5 border tabular-nums"
                style={{
                  borderColor: 'var(--color-border)',
                  borderStyle: 'dashed',
                  background: 'var(--color-s2)',
                  color: 'var(--color-muted)',
                }}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsultantsCardH({ count }: { count: number }) {
  return (
    <OverviewCard title="Consultants">
      <OverviewSection>
        {DISCIPLINES.slice(0, count).map((d) => (
          <ConsultantPill key={d} discipline={d} />
        ))}
        <button
          type="button"
          className="w-full text-[11px] font-bold px-2 py-1.5 rounded border border-dashed"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          + Add consultant
        </button>
      </OverviewSection>
    </OverviewCard>
  );
}

// ---------------------------------------------------------------------------
// The measuring rig
// ---------------------------------------------------------------------------
/** Renders one card at its RESOLVED grid width in an AUTO-height box, so the
 *  stretch is removed and the card's own content height is what is read. This
 *  is fix-453's "natural height" method, unchanged. */
function Probe({
  label,
  widthPx,
  children,
  onHeight,
}: {
  label: string;
  widthPx: number;
  children: React.ReactNode;
  onHeight: (label: string, h: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => onHeight(label, el.getBoundingClientRect().height));
    return () => cancelAnimationFrame(raf);
  });
  return (
    <div style={{ width: widthPx, display: 'inline-block', verticalAlign: 'top', marginRight: 12 }}>
      <div style={{ fontSize: 10, color: '#5a6a85', marginBottom: 2 }}>{label}</div>
      <div ref={ref}>{children}</div>
    </div>
  );
}

const VIEWPORTS = [1920, 1440] as const;

function key(k: string) {
  return OVERVIEW_CARD_COLUMNS.findIndex((c) => c.key === k);
}

function App() {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const record = (label: string, h: number) =>
    setHeights((prev) => (prev[label] === Math.round(h) ? prev : { ...prev, [label]: Math.round(h) }));

  const cases = VIEWPORTS.flatMap((vp) => {
    const rowPx = overviewRowWidthAt(vp);
    const widths = resolveOverviewWidths(rowPx);
    return [
      { vp, rowPx, w: widths[key('dd')]!, id: `${vp}·Milestones`, node: <MilestonesCard /> },
      { vp, rowPx, w: widths[key('team')]!, id: `${vp}·Team BEFORE (empty ext, 1-line)`, node: <TeamCard external="none" /> },
      { vp, rowPx, w: widths[key('team')]!, id: `${vp}·Team BEFORE (empty ext, 4 slots)`, node: <TeamCard external="empty-four-slots" /> },
      { vp, rowPx, w: widths[key('team')]!, id: `${vp}·Team BEFORE (5 firms)`, node: <TeamCard external="five" /> },
      { vp, rowPx, w: widths[key('team')]!, id: `${vp}·Team AFTER`, node: <TeamCard external={null} /> },
      { vp, rowPx, w: widths[key('team')]!, id: `${vp}·Team AFTER + panel OPEN`, node: <TeamCard external={null} panelOpen /> },
      { vp, rowPx, w: widths[key('consultants')]!, id: `${vp}·Consultants 0`, node: <ConsultantsCardH count={0} /> },
      { vp, rowPx, w: widths[key('consultants')]!, id: `${vp}·Consultants 1`, node: <ConsultantsCardH count={1} /> },
      { vp, rowPx, w: widths[key('consultants')]!, id: `${vp}·Consultants 3`, node: <ConsultantsCardH count={3} /> },
      { vp, rowPx, w: widths[key('consultants')]!, id: `${vp}·Consultants 6`, node: <ConsultantsCardH count={6} /> },
    ];
  });

  const report = () => {
    const lines: string[] = [];
    lines.push(`OVERVIEW_ROW_MIN_WIDTH = ${OVERVIEW_ROW_MIN_WIDTH}  ·  gap = ${OVERVIEW_GRID_GAP}`);
    for (const vp of VIEWPORTS) {
      const rowPx = overviewRowWidthAt(vp);
      const widths = resolveOverviewWidths(rowPx);
      lines.push('');
      lines.push(`--- viewport ${vp}  ·  row ${rowPx}px  ·  widths ${widths.map((w, i) => `${OVERVIEW_CARD_COLUMNS[i]!.key}=${w}`).join(' ')}`);
      for (const c of cases.filter((x) => x.vp === vp)) {
        lines.push(`${c.id.padEnd(40)} ${heights[c.id] ?? '?'}`);
      }
    }
    lines.push('');
    lines.push(`CALIBRATION — Milestones@1920 measured ${heights['1920·Milestones'] ?? '?'} vs fix-453's ${FIX453.milestones}`);
    lines.push(`Carried forward (untouched by fix-479): Project ${FIX453.projectOneType}–${FIX453.projectSixTypes}, PoR ${FIX453.por}`);
    return lines.join('\n');
  };

  return (
    <div style={{ padding: 16, background: 'var(--color-bg)', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 15, margin: '0 0 10px' }}>fix-479 §F — overview card heights, measured</h1>
      {VIEWPORTS.map((vp) => (
        <div key={vp} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 6px' }}>
            viewport {vp} · row {overviewRowWidthAt(vp)}px
          </div>
          <div style={{ whiteSpace: 'nowrap', overflowX: 'auto' }}>
            {cases
              .filter((c) => c.vp === vp)
              .map((c) => (
                <Probe key={c.id} label={c.id} widthPx={c.w} onHeight={record}>
                  {c.node}
                </Probe>
              ))}
          </div>
        </div>
      ))}
      <pre
        id="fix479-report"
        style={{ fontSize: 11, background: '#fff', border: '1px solid #c8d3e0', padding: 12, whiteSpace: 'pre' }}
      >
        {report()}
      </pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
