import type { TeamMember } from './database.types';
import { DEPARTMENTS, DEPARTMENT_LABEL } from './roleLabels';

// ★ fix-670 §A (P-351): the pure half of the department list — the row shape,
//   the built-in fallback, and the editor's arithmetic. Kept out of the hook
//   and component modules so a test that mocks either still has these
//   (fix-402's partial-mock trap) and fast refresh stays happy.

export interface DepartmentRow {
  key: string;
  label: string;
  sort_order: number;
}

/** The seeded seven, in DEPARTMENTS' order — the shape the table returns. */
export const FALLBACK_DEPARTMENTS: readonly DepartmentRow[] = DEPARTMENTS.map((key, i) => ({
  key,
  label: DEPARTMENT_LABEL[key],
  sort_order: (i + 1) * 10,
}));

/** Sort as the table does: sort_order, then label, so ties are stable. */
export function sortDepartments(rows: readonly DepartmentRow[]): DepartmentRow[] {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
  );
}

/** People per department key, counted by PERSON (a person holds several rows). */
export function peopleByDepartment(members: readonly TeamMember[]): Map<string, number> {
  const names = new Map<string, Set<string>>();
  for (const m of members) {
    const d = m.department;
    const n = (m.name ?? '').trim();
    if (!d || !n) continue;
    if (!names.has(d)) names.set(d, new Set());
    names.get(d)!.add(n);
  }
  return new Map([...names].map(([d, s]) => [d, s.size]));
}

/** The keys in their new order after moving `key` by `delta` (−1 up, +1 down). */
export function moveKey(keys: readonly string[], key: string, delta: -1 | 1): string[] {
  const i = keys.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= keys.length) return [...keys];
  const out = [...keys];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
