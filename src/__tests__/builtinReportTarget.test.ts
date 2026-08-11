import { describe, it, expect } from 'vitest';
import {
  BUILTIN_REPORT_COMPONENTS,
  resolveSavedReportTarget,
  unknownBuiltinMessage,
  builtinReportDef,
} from '../lib/builtinReports';

// fix-282: the three-way resolution that replaced `def ? builtin : custom`.
//
// The production error was "spec.entity is required" from bp_run_saved_report
// on the `corrections` builtin row. Nothing was wrong with the row: every
// builtin has spec = {} and that is correct. The client had merged "unknown
// builtin" into "custom report" and sent it down a path that runs specs.

describe('fix-282 resolveSavedReportTarget distinguishes THREE cases', () => {
  it('null builtin_key is a custom report', () => {
    expect(resolveSavedReportTarget(null)).toEqual({ kind: 'custom' });
    expect(resolveSavedReportTarget(undefined)).toEqual({ kind: 'custom' });
    // Empty string is a data smell, but it is not a builtin either.
    expect(resolveSavedReportTarget('')).toEqual({ kind: 'custom' });
  });

  it('a registered builtin_key resolves to its definition and route', () => {
    const t = resolveSavedReportTarget('corrections');
    expect(t.kind).toBe('builtin');
    if (t.kind !== 'builtin') throw new Error('unreachable');
    expect(t.key).toBe('corrections');
    expect(t.def.route).toBe('/reports/corrections');
  });

  it('an UNREGISTERED builtin_key is "unknown" — never "custom"', () => {
    const t = resolveSavedReportTarget('corrections_v9_not_shipped_yet');
    expect(t.kind).toBe('unknown');
    if (t.kind !== 'unknown') throw new Error('unreachable');
    expect(t.key).toBe('corrections_v9_not_shipped_yet');
  });

  it('every registered builtin resolves as builtin, none as custom', () => {
    for (const key of Object.keys(BUILTIN_REPORT_COMPONENTS)) {
      expect(resolveSavedReportTarget(key).kind).toBe('builtin');
    }
  });

  it('is the distinction builtinReportDef could not make', () => {
    // Both return null from the old helper — that collapse WAS the bug.
    expect(builtinReportDef(null)).toBeNull();
    expect(builtinReportDef('nope')).toBeNull();
    // The new resolver keeps them apart.
    expect(resolveSavedReportTarget(null).kind).toBe('custom');
    expect(resolveSavedReportTarget('nope').kind).toBe('unknown');
  });
});

describe('fix-282 the message names the key', () => {
  it('includes the key, because it is what turns a report into a diagnosis', () => {
    expect(unknownBuiltinMessage('corrections')).toContain('corrections');
  });

  it('tells the user the actionable thing: refresh', () => {
    expect(unknownBuiltinMessage('x').toLowerCase()).toContain('refresh');
  });
});
