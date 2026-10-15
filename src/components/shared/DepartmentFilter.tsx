import type { Department } from '../../lib/database.types';
import { departmentLabel } from '../../lib/roleLabels';
import { FALLBACK_DEPARTMENTS, type DepartmentRow } from '../../lib/departmentList';

// fix-660 (census 23): the Department filter, shared by My Tasks and the board.
//
// ★ The same shape as My Tasks' stage filter — a select that adds a chip, and
//   a chip × that removes it — because that is the multi-select this app's
//   filter rows already use. The options are the Settings department list, in
//   its order (lib/roleLabels DEPARTMENTS), and nothing else.

interface Props {
  selected: readonly Department[];
  onChange: (next: Department[]) => void;
  /** Test-id prefix: `${testid}`, `${testid}-chip-<key>`, `${testid}-remove-<key>`. */
  testid: string;
  /** Text size for the board's denser bar. */
  size?: 'sm' | 'xs';
  /** ★ fix-670: the live list (`useDepartments().list`); the built-in seven
   *  when absent. */
  departments?: readonly DepartmentRow[];
}

export default function DepartmentFilter({
  selected,
  onChange,
  testid,
  size = 'sm',
  departments = FALLBACK_DEPARTMENTS,
}: Props) {
  const labels = new Map(departments.map((d) => [d.key, d.label]));
  const label = (d: Department) => departmentLabel(d, labels);
  const text = size === 'xs' ? 'text-[10px]' : 'text-[12px]';
  const chipText = size === 'xs' ? 'text-[9.5px]' : 'text-[11px]';
  return (
    <>
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value as Department | '';
          if (!v || selected.includes(v)) return;
          onChange([...selected, v]);
        }}
        className={`${text} px-1.5 py-0.5 rounded border border-border bg-bg text-text`}
        data-testid={testid}
        aria-label="Filter by department"
      >
        <option value="">
          {selected.length === 0 ? 'All departments' : 'Add department…'}
        </option>
        {departments
          .filter((d) => !selected.includes(d.key))
          .map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
      </select>
      {selected.map((d) => (
        <span
          key={d}
          className={`inline-flex items-center gap-1 ${chipText} px-2 py-0.5 rounded-full bg-s2 text-text`}
          data-testid={`${testid}-chip-${d}`}
        >
          {label(d)}
          <button
            type="button"
            onClick={() => onChange(selected.filter((x) => x !== d))}
            className="text-dim hover:text-text leading-none"
            title={`Remove ${label(d)}`}
            aria-label={`Remove ${label(d)}`}
            data-testid={`${testid}-remove-${d}`}
          >
            ×
          </button>
        </span>
      ))}
    </>
  );
}
