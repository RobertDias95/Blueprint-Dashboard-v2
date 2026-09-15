// ★★★ fix-553 §A: the legend paints from the BLOCK's record, so the two
//     cannot disagree about a park state again.
import {
  DS_PARK_PRESENTATION,
  type DsParkKind,
} from '../../lib/drawScheduleStatus';

/** Legend order for the parked states: pause first, then the two endings. */
const PARK_ORDER: readonly DsParkKind[] = ['hold', 'cancelled', 'redesigned'];

// Q9.5.a: status legend bar for the Draw Schedule grid. Exact hex
// colors lifted from v1's index.html lines 9280-9287 — these are NOT
// the Tailwind palette; they're the v1-canonical chip colors used by
// the team's spatial memory of project status.
//
// Theming pass (Q9.5.b) may move these to CSS variables, but the hex
// values must stay identical to preserve v1 parity.
//
// fix-263: the two PARK chips appended below are NOT v1-parity colours — they
// are new, and they deliberately go through CSS variables so the legend, the
// block and the shared HoldBadge cannot drift apart.

interface Chip {
  label: string;
  bg: string;
  fg: string;
  border: string;
}

const CHIPS: Chip[] = [
  { label: 'Scheduled', bg: '#ffffff', fg: '#1a2540', border: '#cacaca' },
  { label: 'Schematic', bg: '#5a84c0', fg: '#1a2540', border: '#3d6aad' },
  { label: 'DD / Permit Set', bg: '#5d6aac', fg: '#ffffff', border: '#4a5499' },
  { label: 'Pending Consultants', bg: '#02267e', fg: '#ffffff', border: '#011a5c' },
  {
    label: 'Submitted / Under Review / Corrections',
    bg: '#5cb8b2',
    fg: '#1a2540',
    border: '#3a9e98',
  },
  { label: 'Approved', bg: '#5abf75', fg: '#ffffff', border: '#3aa55e' },
  // ═══════════════════════════════════════════════════════════════════════
  // ★★★ fix-553 §A + §F — THE PARK CHIPS ARE THE BLOCK'S OWN PAINT NOW
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ★★★ §A's FINDING WAS THAT A RULE HAD BEEN APPLIED IN ONE PLACE AND NOT THE
  //     OTHER: fix-530 §D removed the strikethrough from the BLOCKS
  //     (`DS_PARK_PRESENTATION.strikeAddress`, `false` for all three) and the
  //     legend kept striking, because the legend held a SECOND copy of the
  //     colours with a `strike` flag of its own.
  //
  // ★★★ SO THE COPY IS GONE, NOT JUST THE FLAG. These three chips are now
  //     literally `DS_PARK_PRESENTATION` — the same record the block paints
  //     from — so "the legend matches what the block does" is true by
  //     construction rather than by two lists agreeing. Removing the flag alone
  //     would have fixed today's symptom and left tomorrow's.
  //
  // ★★ §F: all three wear the same 45° hatch now, three hues. Adjacency is the
  //    point — this is the one place in the app where they appear side by side,
  //    so it is the only place a reader can learn that the texture means
  //    "parked" and the hue says which kind.
  //
  // ★ WHAT CARRIES THE DISTINCTION NOW THE LINE IS GONE: the hatch texture
  //   (against every live status, which is flat), the hue, AND the word — each
  //   chip is labelled. Nothing here depends on colour alone.
  ...PARK_ORDER.map((kind) => {
    const p = DS_PARK_PRESENTATION[kind];
    return {
      label: p.label,
      bg: p.background,
      fg: p.text,
      border: p.border,
    };
  }),
];

export default function StatusLegend() {
  return (
    <div
      className="flex items-center gap-2 flex-wrap"
      data-testid="ds-status-legend"
    >
      <div className="text-[9px] uppercase tracking-wider text-dim">
        Legend:
      </div>
      {CHIPS.map((c) => (
        <span
          key={c.label}
          className="text-[9px] font-semibold px-2 py-0.5 rounded border"
          style={{
            background: c.bg,
            color: c.fg,
            borderColor: c.border,
          }}
          data-testid={`ds-legend-chip-${c.label}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
