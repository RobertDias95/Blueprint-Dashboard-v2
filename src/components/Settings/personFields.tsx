import type { ReactNode } from 'react';

// ===========================================================================
// ★★★ fix-487 §B (P-120) — THE PERSON FIELDS, DEFINED ONCE
// ===========================================================================
//
// The brief: *"One dialog reusing `AddPersonDialog`'s three fields in edit
// mode."* These are those fields' label + input shell, lifted out of
// AddPersonDialog (fix-436) so BOTH dialogs render from one definition rather
// than from a copy that starts identical and stops being so.
//
// ★★ THE TWO DIALOGS ARE NOT THE SAME DIALOG, and that is why this is a shared
//    ROW rather than a shared form. AddPersonDialog creates an auth user, a
//    profile, a membership and a roster row through an Edge Function, and shows
//    a generated password once. PersonDetailsDialog updates three columns on
//    rows that already exist. Sharing the chrome and not the behaviour is the
//    part that is actually the same.
//
// ★ `react-refresh/only-export-components` permits the constant beside the
//   component here — `reactRefresh.configs.vite` sets `allowConstantExport`.

export const PERSON_FIELD_INPUT =
  'w-full text-[12px] px-2 py-1.5 rounded border border-border bg-bg text-text focus:outline-none focus:border-de';

export function PersonFieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[10px] uppercase tracking-wide text-dim font-semibold mb-1"
      >
        {label}
      </label>
      {children}
      {hint && <div className="text-[10px] text-dim mt-0.5">{hint}</div>}
    </div>
  );
}
