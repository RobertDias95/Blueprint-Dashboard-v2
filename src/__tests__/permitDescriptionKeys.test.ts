import { describe, it, expect } from 'vitest';
import { PERMIT_DESCRIPTION_SEED } from '../components/wizard/wizardState';
import { readPermitDescriptions } from '../hooks/usePermitDescriptions';

// fix-288: ★ EVERY DESCRIPTION KEY MUST NAME A REAL PERMIT TYPE.
//
// This is the test the ticket actually asked for, and the reason it is worth
// having: a description whose key matches no type renders NOTHING, and looks
// exactly like a type that simply has no description. Two of them survived
// since v2 launched precisely because the failure is invisible:
//
//     'PPR (Post-Permit Revision)'   the live type is 'PPR'
//     'SDOT'                         the live type is 'SDOT Tree'
//
// Both are removed. A future typo now fails here instead of silently rendering
// nothing.
//
// (The brief named 'Grading \ Clearing' — with a backslash — as the offender.
// It has never existed in this repo: `git log -S` over the whole history finds
// nothing, and the key has always read 'Grading / Clearing', matching the live
// type. The two above are the real instances.)

/** The permit-type catalogue in production, 2026-08-12, with usage counts:
 *
 *   Building Permit 143 · Demolition 114 · ULS 86 · PAR/Pre-Sub 39
 *   SDOT Tree 20 · IPR 15 · TRAO 13 · PPR 10 · Grading / Clearing 7
 *   ECA Waiver 5 · LSM 4 · SIP 4 · LBA 3 · Condo 1 · STFI 1 · Short Plat 0
 *   · WAC 0 (added by fix-349, going-forward only — no backfill)
 *
 * ★ SIXTEEN, not the fifteen the brief listed — 'Short Plat' is in the
 * catalogue with zero permits, so it never showed up in a usage-ordered list.
 * A description for it would be legitimate; a description for something NOT in
 * this list is the bug.
 */
const LIVE_PERMIT_TYPES = [
  'Building Permit',
  'Demolition',
  'ULS',
  'PAR/Pre-Sub',
  'SDOT Tree',
  'IPR',
  'TRAO',
  'PPR',
  'Grading / Clearing',
  'ECA Waiver',
  'LSM',
  'SIP',
  'LBA',
  'Condo',
  'STFI',
  'Short Plat',
  // ★ fix-349: WAC. Bobby: "a WAC is a separate permit in Seattle, and
  // generally required every time" — the tool had no such type, which is why it
  // had become a checkbox on the PAR template. Seventeen now. It carries no
  // description yet (six of the others do not either); adding one is a
  // Settings edit, not a deploy, since fix-288 moved them into app_config.
  'WAC',
] as const;

describe('fix-288 every description key names a real permit type', () => {
  it.each(Object.keys(PERMIT_DESCRIPTION_SEED))(
    '%s is a permit type',
    (key) => {
      expect(LIVE_PERMIT_TYPES).toContain(key);
    },
  );

  // The same assertion stated over the whole set, so a key added without a
  // matching `it.each` entry cannot slip through.
  it('has no key outside the catalogue', () => {
    const strays = Object.keys(PERMIT_DESCRIPTION_SEED).filter(
      (k) => !(LIVE_PERMIT_TYPES as readonly string[]).includes(k),
    );
    expect(strays).toEqual([]);
  });

  // ★ PROOF THE GUARD BITES. The brief asked for the test to be shown failing
  // on a bad key; doing it here, against the same predicate the suite above
  // uses, means the proof cannot drift away from the assertion.
  it('rejects a bad key — the backslash spelling included', () => {
    const withTypo = {
      ...PERMIT_DESCRIPTION_SEED,
      'Grading \\ Clearing': 'the backslash spelling the brief described',
    };
    const strays = Object.keys(withTypo).filter(
      (k) => !(LIVE_PERMIT_TYPES as readonly string[]).includes(k),
    );
    expect(strays).toEqual(['Grading \\ Clearing']);
  });

  it('rejects the two keys that really were dead', () => {
    for (const dead of ['PPR (Post-Permit Revision)', 'SDOT']) {
      expect(LIVE_PERMIT_TYPES).not.toContain(dead);
      expect(PERMIT_DESCRIPTION_SEED).not.toHaveProperty(dead);
    }
  });

  it('still describes Grading / Clearing, with a forward slash', () => {
    expect(PERMIT_DESCRIPTION_SEED['Grading / Clearing']).toBe(
      'Earthwork, cut/fill, retaining walls, tree clearing at scale',
    );
  });
});

describe('fix-288 descriptions read from app_config', () => {
  it('uses the stored map when the key is present', () => {
    const map = new Map<string, unknown>([
      ['permitTypeDescriptions', { 'Building Permit': 'edited in Settings' }],
    ]);
    expect(readPermitDescriptions(map)['Building Permit']).toBe(
      'edited in Settings',
    );
  });

  // ★ A present key WINS OUTRIGHT — no merge with the seed. Merging would make
  // a description impossible to delete, because the seed would keep putting it
  // back on the next render.
  it('does not merge the seed into a stored map', () => {
    const map = new Map<string, unknown>([
      ['permitTypeDescriptions', { 'Building Permit': 'only this one' }],
    ]);
    const out = readPermitDescriptions(map);
    expect(Object.keys(out)).toEqual(['Building Permit']);
    expect(out.Demolition).toBeUndefined();
  });

  it('an empty stored map means "no descriptions", not "fall back"', () => {
    const map = new Map<string, unknown>([['permitTypeDescriptions', {}]]);
    expect(readPermitDescriptions(map)).toEqual({});
  });

  // ...but a MISSING key falls back wholesale, so help text can never vanish
  // entirely — e.g. before the migration has run.
  it('falls back to the seed when the key is absent', () => {
    expect(readPermitDescriptions(new Map())).toBe(PERMIT_DESCRIPTION_SEED);
  });

  it('ignores a malformed value rather than rendering junk', () => {
    for (const bad of [null, 'a string', ['an', 'array'], 42]) {
      expect(readPermitDescriptions(new Map([['permitTypeDescriptions', bad]])))
        .toBe(PERMIT_DESCRIPTION_SEED);
    }
  });

  it('drops non-string and blank entries', () => {
    const map = new Map<string, unknown>([
      ['permitTypeDescriptions', {
        Good: 'text', Numeric: 7, Nested: { a: 1 }, Blank: '   ',
      }],
    ]);
    expect(readPermitDescriptions(map)).toEqual({ Good: 'text' });
  });
});
