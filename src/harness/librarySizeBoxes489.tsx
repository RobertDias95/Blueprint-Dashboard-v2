import { StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// ===========================================================================
// ★★★ fix-489 (P-151) — DO THE LIBRARY'S ± BOXES FIT THEIR OWN DEFAULTS?
// ===========================================================================
//
// Bobby, 2026-09-03, with a screenshot: *"the unit and lot size is not fully
// visable. that is a problem. the lot size should default +/- 500 and the unit
// size should be +/- 100"*
//
// ★★★ THE DEFAULTS ARE ALREADY 500 AND 100 (INITIAL_FILTERS, fix-488). What he
//     is seeing is a **40px box printing "5" and "1"** — the value is right and
//     the box is too narrow. This page is how that stops being an opinion.
//
// Run it:   npm run dev
//           http://localhost:5173/harness/library-size-boxes-489.html
//
// ---------------------------------------------------------------------------
// ★★ WHY THE CLASS STRINGS ARE TRANSCRIBED RATHER THAN IMPORTED
// ---------------------------------------------------------------------------
// `TargetRange` and `FIELD_CLASS` are module-private in `LibraryMatrix.tsx`,
// and they have to stay that way: `react-refresh/only-export-components` is an
// ERROR in this repo, so a component file cannot export the control.
//
// ★★★ SO THE COPY IS PINNED. `LibraryTargetRangeFix489.test.tsx` asserts that
//     the two strings below appear VERBATIM in `LibraryMatrix.tsx`. A harness
//     that measures a stale copy reports numbers about nothing, which is worse
//     than not measuring — fix-479 hit this and answered it with a calibration;
//     this answers it with a twin test, because here the thing to keep in step
//     is an exact string rather than a rendered height.
//
// ★ It lives under src/ because tailwind.config.js scans `./src/**` and nothing
//   else — a harness outside src renders with none of these utilities and every
//   number is wrong in the same silent direction.

/** ★ VERBATIM from LibraryMatrix.tsx. The test pins both halves. */
const FIELD_CLASS =
  'bg-surface border border-border rounded px-2 py-1 text-[11px] text-text ' +
  'shadow-sm focus:outline-none focus:border-de focus:ring-1 focus:ring-de/30';

/** The widths as they ship today, and the ones fix-489 proposes. */
const WIDTHS = {
  ft: { target: 'w-16', buf: 'w-10' },
  // ★ MEASURED, not estimated. w-14 holds "500" and clips "1000" by 1px; a
  //   four-digit tolerance is ordinary, so the ± box takes w-16. The target
  //   takes w-20 because w-16 clips a six-digit area (108,900 sf = 2.5 acres).
  sf: { target: 'w-20', buf: 'w-16' },
} as const;

interface Probe {
  id: string;
  /** What the box actually holds in the app. */
  value: string;
  kind: 'target' | 'buf';
  unit: 'ft' | 'sf';
  /** Which width class this run is measuring. */
  width: string;
  note: string;
}

/**
 * ★★ THE EIGHT BOXES THE BRIEF ASKS ABOUT, plus the four `ft` ± boxes as the
 *    control group: if THEY clip too, the fix is not "sf boxes are special".
 */
function probes(mode: 'before' | 'after'): Probe[] {
  const sfW = mode === 'before' ? WIDTHS.ft : WIDTHS.sf;
  return [
    // The four dimension ± boxes — unchanged in both modes, the control group.
    { id: 'lotw-buf', value: '2', kind: 'buf', unit: 'ft', width: WIDTHS.ft.buf, note: 'Lot Width ± (default 2)' },
    { id: 'lotd-buf', value: '2', kind: 'buf', unit: 'ft', width: WIDTHS.ft.buf, note: 'Lot Depth ± (default 2)' },
    { id: 'unitw-buf', value: '2', kind: 'buf', unit: 'ft', width: WIDTHS.ft.buf, note: 'Unit Width ± (default 2)' },
    { id: 'unitd-buf', value: '2', kind: 'buf', unit: 'ft', width: WIDTHS.ft.buf, note: 'Unit Depth ± (default 2)' },
    // The two that Bobby photographed.
    { id: 'lotsize-buf', value: '500', kind: 'buf', unit: 'sf', width: sfW.buf, note: '★ Lot Size ± (default 500)' },
    { id: 'unitsize-buf', value: '100', kind: 'buf', unit: 'sf', width: sfW.buf, note: '★ Unit Size ± (default 100)' },
    // …and the two sf TARGET boxes, at the worst realistic value.
    { id: 'lotsize-target', value: '12000', kind: 'target', unit: 'sf', width: sfW.target, note: '★ Lot Size target, 5 digits' },
    { id: 'unitsize-target', value: '12000', kind: 'target', unit: 'sf', width: sfW.target, note: '★ Unit Size target, 5 digits' },
  ];
}

interface Result {
  id: string;
  mode: string;
  width: string;
  value: string;
  clientWidth: number;
  scrollWidth: number;
  fits: boolean;
  note: string;
}

function Box({
  probe,
  mode,
  onMeasure,
}: {
  probe: Probe;
  mode: string;
  onMeasure: (r: Result) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      onMeasure({
        id: probe.id,
        mode,
        width: probe.width,
        value: probe.value,
        clientWidth: el.clientWidth,
        // ★★★ THE MEASUREMENT THAT MATTERS. A number input whose content is
        //     wider than its box does not wrap and does not scroll a bar into
        //     view — it silently shows the leading glyphs, which is why "500"
        //     read as "5" and nobody saw an error.
        scrollWidth: el.scrollWidth,
        fits: el.scrollWidth <= el.clientWidth,
        note: probe.note,
      });
    });
    return () => cancelAnimationFrame(raf);
  });
  return (
    <label className="flex flex-col gap-1" style={{ marginRight: 14 }}>
      <span className="text-[10px] uppercase tracking-wide text-dim">
        {probe.id}
      </span>
      <div className="flex items-center gap-1 text-[10px] text-muted">
        {probe.kind === 'buf' && <span>±</span>}
        <input
          ref={ref}
          type="number"
          min={0}
          defaultValue={probe.value}
          placeholder={probe.kind === 'target' ? 'Target' : undefined}
          className={`${probe.width} text-center ${FIELD_CLASS}`}
        />
      </div>
    </label>
  );
}

function App() {
  const [rows, setRows] = useState<Record<string, Result>>({});
  const record = (r: Result) =>
    setRows((prev) => {
      const key = `${r.mode}·${r.id}`;
      const old = prev[key];
      if (old && old.scrollWidth === r.scrollWidth && old.clientWidth === r.clientWidth) {
        return prev;
      }
      return { ...prev, [key]: r };
    });

  const report = () => {
    const lines = [
      `viewport ${window.innerWidth}px`,
      '',
      'mode    box               width  value    client  scroll  fits',
      '------- ----------------- ------ -------- ------- ------- ----',
    ];
    for (const mode of ['before', 'after']) {
      for (const p of probes(mode as 'before' | 'after')) {
        const r = rows[`${mode}·${p.id}`];
        lines.push(
          [
            mode.padEnd(7),
            p.id.padEnd(17),
            p.width.padEnd(6),
            p.value.padEnd(8),
            r ? String(r.clientWidth).padEnd(7) : '?      ',
            r ? String(r.scrollWidth).padEnd(7) : '?      ',
            r ? (r.fits ? 'yes' : '★ NO') : '?',
          ].join(' '),
        );
      }
      lines.push('');
    }
    return lines.join('\n');
  };

  return (
    <div style={{ padding: 16, background: 'var(--color-bg)', minHeight: '100vh' }}>
      <h1 className="text-sm font-bold text-text">
        fix-489 — do the Library ± boxes fit their values?
      </h1>
      <p className="text-[11px] text-muted" style={{ maxWidth: 720 }}>
        Bobby saw <b>“5”</b> and <b>“1”</b>. The stored defaults are 500 and 100,
        so the value is right and the box is too narrow. Each row below renders
        the real class string at the real font size;{' '}
        <code>scrollWidth &gt; clientWidth</code> is the clip.
      </p>

      {(['before', 'after'] as const).map((mode) => (
        <section key={mode} style={{ marginTop: 18 }}>
          <h2 className="text-xs font-bold text-text">
            {mode === 'before' ? 'BEFORE — as it ships today' : 'AFTER — fix-489 widths'}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 6 }}>
            {probes(mode).map((p) => (
              <Box key={`${mode}-${p.id}`} probe={p} mode={mode} onMeasure={record} />
            ))}
          </div>
        </section>
      ))}

      <pre
        id="fix489-report"
        className="text-[11px]"
        style={{ marginTop: 20, color: 'var(--color-text)' }}
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
