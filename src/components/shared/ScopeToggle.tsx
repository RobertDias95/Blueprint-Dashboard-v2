import TwoStateToggle from './TwoStateToggle';
import type { ScopeMode } from '../../lib/selfScope';

// fix-176: shared "My work / Everyone" segmented control used by the Dashboard,
// Project Overview, and My tab. Defaults to "My work" for rostered users; the
// choice is remembered per-user (see useScopeMode). Renders nothing for an
// unmapped login (no roster name -> nothing to scope to).
//
// ★★★ fix-483 §B (P-137) — THE CHROME MOVED OUT, THE MEANING STAYED.
//
// This file used to draw the two pills itself. It now delegates to
// `TwoStateToggle`, which draws the same two pills from the same `chipStyle` —
// the markup, the classes and the computed colours are unchanged, and a test
// asserts that against a hand-built copy of the original rather than against
// itself.
//
// ★★ THE LABELS STAY HERE rather than becoming props of the four call sites
//    (Dashboard, My Tasks, Project List, Waiting On). All four mean the same
//    thing and must keep saying the same words; pushing "My Work" / "Everyone"
//    out to each of them is how four copies of one label start to drift. What
//    the brief actually asks for — a control that takes its labels as props —
//    is `TwoStateToggle`, and this is its scope-shaped caller.
//
// ★ `name` still hides the whole control, and that is a SCOPE rule, not a
//   toggle rule: there is nothing to scope to for a login the roster does not
//   know. `TwoStateToggle` has no such notion and should not grow one.

export default function ScopeToggle({
  mode,
  onChange,
  name,
  testid = 'scope-toggle',
}: {
  mode: ScopeMode;
  onChange: (mode: ScopeMode) => void;
  /** Roster name of the logged-in user. When null the control hides. */
  name: string | null;
  testid?: string;
}) {
  if (!name) return null;
  return (
    <TwoStateToggle<ScopeMode>
      value={mode}
      onChange={onChange}
      testid={testid}
      ariaLabel="Scope work to me or everyone"
      surface="surface"
      options={[
        {
          value: 'mine',
          label: 'My Work',
          testid: `${testid}-mine`,
          title: `Show only ${name}'s work`,
        },
        { value: 'all', label: 'Everyone', testid: `${testid}-all` },
      ]}
    />
  );
}
