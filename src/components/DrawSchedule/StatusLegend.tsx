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
  /** fix-263: struck through, for the terminal (cancelled) chip. */
  strike?: boolean;
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
  // fix-263: the two PARK states. Without these the amber and the hatch are
  // unexplained colours on the board. They resolve through the same index.css
  // tokens the block and the shared HoldBadge use, so each chip is literally
  // the same paint as the thing it explains — a legend that cannot drift.
  {
    label: 'On hold',
    bg: 'var(--color-hold-bg)',
    fg: 'var(--color-hold-text)',
    border: 'var(--color-hold-border)',
  },
  {
    label: 'Cancelled',
    bg: 'var(--hatch-cancelled)',
    fg: 'var(--color-cancelled-text)',
    border: 'var(--color-cancelled-border)',
    strike: true,
  },
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
            textDecoration: c.strike ? 'line-through' : 'none',
          }}
          data-testid={`ds-legend-chip-${c.label}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
