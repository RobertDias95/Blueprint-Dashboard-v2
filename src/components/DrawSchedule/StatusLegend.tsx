// Q9.5.a: status legend bar for the Draw Schedule grid. Exact hex
// colors lifted from v1's index.html lines 9280-9287 — these are NOT
// the Tailwind palette; they're the v1-canonical chip colors used by
// the team's spatial memory of project status.
//
// Theming pass (Q9.5.b) may move these to CSS variables, but the hex
// values must stay identical to preserve v1 parity.

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
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
