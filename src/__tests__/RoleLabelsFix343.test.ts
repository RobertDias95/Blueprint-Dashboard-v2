import { describe, it, expect } from 'vitest';
import {
  ROLE_SENIORITY,
  ROLE_TITLE,
  ROLE_TITLE_PLURAL,
  primaryRoles,
  roleSeniorityRank,
  rosterRoleTitle,
} from '../lib/roleLabels';
import { resolveRosterIdentity } from '../lib/selfScope';
import { activeMemberNamesOf } from '../hooks/useTeamMembers';
import { isAssignableMember, isCurrentMember, rosterFullName } from '../lib/roster';
import { initialsOf } from '../lib/projectChat';
import type { TeamMember, TeamRole } from '../lib/database.types';

// ===========================================================================
// fix-343 — the app shows people database keys instead of job titles
// ===========================================================================
//
// Bobby: "it says Bobby and then it says entitlement lead, but it's like ENT
// underscore lead. First off, I am entitlements manager."
//
// ★★ AND THE SECOND HALF, which is a real bug rather than a tidy-up: the chip
// printed `roles[0]` of an array with NO GUARANTEED ORDER. Bobby holds `ent`
// AND `ent_lead`; so do Briana and Miles. Derry and Lindsay hold `dm` and
// `schematic`. Two people could see different titles for the same person, and
// one person could watch their own title change between reloads. Every
// multi-role case below is asserted against EVERY permutation of the input.

// ★ fix-354 §6 adds `director` — Dave, over Design and Entitlements. This list
// is the reason adding a role is safe: ROLE_TITLE and ROLE_TITLE_PLURAL are
// Records over TeamRole, so the compiler catches a missing key, and the line
// below catches a key with no role.
const ALL_ROLES: TeamRole[] = [
  'da', 'dm', 'ent', 'ent_lead', 'acq', 'acq_lead', 'schematic', 'viewer',
  'director',
];

/** Every ordering of a small array — the shuffle the brief asks for, done
 *  exhaustively so it cannot pass by luck. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: `m-${over.name}-${over.role}`,
    name: over.name ?? 'Someone',
    role: (over.role ?? 'da') as TeamRole,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-08-18T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

// ---------------------------------------------------------------------------
// §1 — a label for every role
// ---------------------------------------------------------------------------

describe('fix-343 §1: every stored role has a job title', () => {
  it('★★ the map is total over TeamRole — no role can reach a screen unnamed', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_TITLE[role], role).toBeTruthy();
      expect(ROLE_TITLE_PLURAL[role], role).toBeTruthy();
    }
    expect(Object.keys(ROLE_TITLE).sort()).toEqual([...ALL_ROLES].sort());
  });

  // ★ The table in the brief, verbatim.
  it('★ the titles are the ones Bobby asked for', () => {
    expect(rosterRoleTitle(['ent_lead'])).toBe('Entitlements Manager');
    expect(rosterRoleTitle(['ent'])).toBe('Entitlements');
    expect(rosterRoleTitle(['dm'])).toBe('Design Manager');
    expect(rosterRoleTitle(['da'])).toBe('Design Associate');
    expect(rosterRoleTitle(['schematic'])).toBe('Schematic Design');
    expect(rosterRoleTitle(['acq_lead'])).toBe('Acquisitions Lead');
    expect(rosterRoleTitle(['acq'])).toBe('Acquisitions');
  });

  // ★★ THE POINT OF THE TICKET: no title is ever the stored key.
  it('★★ no title is the raw stored value', () => {
    for (const role of ALL_ROLES) {
      const title = rosterRoleTitle([role], 'Underwriting');
      expect(title, role).not.toBe(role);
      expect(title ?? '', role).not.toMatch(/_/);
    }
  });

  it('★ an unmapped login has no title at all — the caller supplies the neutral line', () => {
    expect(rosterRoleTitle([])).toBeNull();
    expect(rosterRoleTitle(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ★★ §2 — a person with two roles gets a DECIDED one
// ---------------------------------------------------------------------------

describe('fix-343 §2: multi-role people render deterministically', () => {
  // ★★ Bobby, Briana and Miles: two GRADES of one job. The senior one wins and
  // the other is not printed — "Entitlements Manager · Entitlements" says the
  // same thing twice.
  it('★★ ent_lead beats ent, in every order the roles can arrive in', () => {
    for (const order of permutations<TeamRole>(['ent', 'ent_lead'])) {
      expect(rosterRoleTitle(order), order.join(',')).toBe('Entitlements Manager');
    }
  });

  it('★ acq_lead beats acq, likewise', () => {
    for (const order of permutations<TeamRole>(['acq', 'acq_lead'])) {
      expect(rosterRoleTitle(order), order.join(',')).toBe('Acquisitions Lead');
    }
  });

  // ★★ Derry and Lindsay: `dm` and `schematic` are NOT a hierarchy. They are two
  // real jobs and both are shown — dropping one would be picking a favourite,
  // which is the arbitrary choice this ticket removes.
  it('★★ dm + schematic shows BOTH, in a fixed order', () => {
    for (const order of permutations<TeamRole>(['dm', 'schematic'])) {
      expect(rosterRoleTitle(order), order.join(',')).toBe(
        'Design Manager · Schematic Design',
      );
    }
  });

  it('★ three roles still collapse per family and stay ordered', () => {
    for (const order of permutations<TeamRole>(['schematic', 'ent', 'ent_lead'])) {
      expect(rosterRoleTitle(order), order.join(',')).toBe(
        'Entitlements Manager · Schematic Design',
      );
    }
  });

  it('★ primaryRoles is the decision, exposed on its own', () => {
    expect(primaryRoles(['ent', 'ent_lead'])).toEqual(['ent_lead']);
    expect(primaryRoles(['schematic', 'dm'])).toEqual(['dm', 'schematic']);
    expect(primaryRoles([])).toEqual([]);
  });

  it('★ seniority is a total order with no ties', () => {
    const ranks = ALL_ROLES.map(roleSeniorityRank);
    expect(new Set(ranks).size).toBe(ALL_ROLES.length);
    expect(ROLE_SENIORITY[ROLE_SENIORITY.length - 1]).toBe('viewer');
  });
});

// ---------------------------------------------------------------------------
// ★ `viewer` — the interesting one
// ---------------------------------------------------------------------------
//
// Rendering the word "viewer" tells EJ he is a viewer, which is true and
// useless: it names his permissions, not his job. His function is in `notes`.

describe('fix-343: a viewer shows their function, never the word', () => {
  it('★ EJ is Underwriting and Darin is CEO', () => {
    expect(rosterRoleTitle(['viewer'], 'Underwriting')).toBe('Underwriting');
    expect(rosterRoleTitle(['viewer'], 'CEO')).toBe('CEO');
    expect(rosterRoleTitle(['viewer'], 'IT')).toBe('IT');
    expect(rosterRoleTitle(['viewer'], 'Policy')).toBe('Policy');
  });

  it('★★ and never the word "viewer"', () => {
    for (const notes of ['Underwriting', 'CEO', '', null]) {
      expect(rosterRoleTitle(['viewer'], notes) ?? '').not.toMatch(/viewer/i);
    }
  });

  // ★ No placeholder. There is nothing true to say about an empty-notes
  // viewer's job, so this says nothing and the caller falls back to the neutral
  // line it already had ("Blueprint Services") — asserted in the Chrome suite.
  it('★ an empty note yields null rather than an invented title', () => {
    expect(rosterRoleTitle(['viewer'], '')).toBeNull();
    expect(rosterRoleTitle(['viewer'], '   ')).toBeNull();
    expect(rosterRoleTitle(['viewer'], null)).toBeNull();
    expect(rosterRoleTitle(['viewer'])).toBeNull();
  });

  // ★ `viewer` means "never assigned work" — a statement about what somebody
  // does NOT do. A real role always outranks it.
  it('★ a viewer row alongside a real role shows the real role', () => {
    for (const order of permutations<TeamRole>(['viewer', 'da'])) {
      expect(rosterRoleTitle(order, 'Underwriting'), order.join(',')).toBe(
        'Design Associate',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ★ The identity that feeds the chip
// ---------------------------------------------------------------------------

describe('fix-343: resolveRosterIdentity orders roles and carries notes', () => {
  const projects = [{ entitlement_lead: null, design_manager: null }];

  it('★★ the roles come back senior-first whatever order the roster returns', () => {
    const rows = [
      member({ name: 'Bobby', role: 'ent', email: 'robertd@blueprintcap.com' }),
      member({ name: 'Bobby', role: 'ent_lead', email: 'robertd@blueprintcap.com' }),
    ];
    for (const order of permutations(rows)) {
      const id = resolveRosterIdentity('robertd@blueprintcap.com', order, projects);
      expect(id.roles, JSON.stringify(order.map((r) => r.role))).toEqual([
        'ent_lead',
        'ent',
      ]);
      expect(rosterRoleTitle(id.roles, id.notes)).toBe('Entitlements Manager');
    }
  });

  it('★ a viewer identity carries the note the title is made of', () => {
    const id = resolveRosterIdentity(
      'ej@blueprintcap.com',
      [member({ name: 'EJ', role: 'viewer', email: 'ej@blueprintcap.com', notes: 'Underwriting' })],
      projects,
    );
    expect(id.notes).toBe('Underwriting');
    expect(rosterRoleTitle(id.roles, id.notes)).toBe('Underwriting');
  });

  it('★ the note is found on whichever row carries it', () => {
    const id = resolveRosterIdentity(
      'x@blueprintcap.com',
      [
        member({ name: 'X', role: 'viewer', email: 'x@blueprintcap.com', notes: null }),
        member({ name: 'X', role: 'viewer', email: 'x@blueprintcap.com', notes: 'Policy' }),
      ],
      projects,
    );
    expect(id.notes).toBe('Policy');
  });

  it('★ an unmapped login is unchanged — name null, no roles, no note', () => {
    const id = resolveRosterIdentity('nobody@example.com', [], projects);
    expect(id).toEqual({ name: null, roles: [], notes: null, scope: 'all' });
  });
});

// ---------------------------------------------------------------------------
// ★★ A viewer is never OFFERED work
// ---------------------------------------------------------------------------
//
// The six viewer rows are active=true, former=false — correctly, they work
// here — so fix-321's `isCurrentMember` says yes and the task-assignee pickers
// had started offering the CEO as an assignee the day the rows landed.

describe('fix-343: viewers are not selectable in assignment dropdowns', () => {
  const roster = [
    member({ name: 'Nicky', role: 'da' }),
    member({ name: 'Derry', role: 'dm' }),
    member({ name: 'EJ', role: 'viewer', notes: 'Underwriting' }),
    member({ name: 'Darin', role: 'viewer', notes: 'CEO' }),
    member({ name: 'Nidhi', role: 'da', active: false, former: true }),
  ];

  it('★★ the assignee name list drops viewers and keeps everyone else', () => {
    expect(activeMemberNamesOf(roster)).toEqual(['Derry', 'Nicky']);
  });

  it('★ but a viewer is still a CURRENT member — they work here', () => {
    const ej = roster.find((m) => m.name === 'EJ')!;
    expect(isCurrentMember(ej)).toBe(true);
    expect(isAssignableMember(ej)).toBe(false);
  });

  // ★ Per PERSON, not per row: one live working role is enough to be offered,
  // even if the same person also carries a viewer row.
  it('★ someone holding both a real role and a viewer row stays selectable', () => {
    expect(
      activeMemberNamesOf([
        member({ name: 'Gena', role: 'viewer' }),
        member({ name: 'Gena', role: 'dm' }),
      ]),
    ).toEqual(['Gena']);
  });

  it('★ a row with no role at all is unaffected (fixtures, projections)', () => {
    expect(isAssignableMember({ active: true, former: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★★ The ratchet — "grep the rendered output, not just the one component"
// ---------------------------------------------------------------------------
//
// ★ Chrome was the only site that printed a raw role (confirmed by this scan
// when the ticket started, and by reading every `.role` reference in the tree).
// The value of the scan is not the audit, which is done; it is that the NEXT
// component to reach for `member.role` in JSX fails here instead of shipping a
// database key to a person's name plate.
//
// Vite `?raw` rather than node:fs — the app tsconfig has no @types/node
// (fix-253's note, and the pattern noGuessedSleeps.test.ts already uses).
const COMPONENT_SOURCES = import.meta.glob(
  ['../components/**/*.tsx', '../pages/**/*.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Strip line comments so prose about the banned shape is not the shape. */
function executable(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

// `{something.role}` — a stored role interpolated straight into JSX. The
// lookbehind exempts `${...}` inside template literals, which is how a role
// legitimately reaches a URL query string or a CSV filename (machine values,
// not screen text).
//
// ★★ fix-436 widens that exemption to the three ATTRIBUTES that are machine
// values for exactly the same reason. `<select value={form.role}>` binds the
// stored key because that is what the control's value IS — what a person reads
// is the `<option>` label, which comes from ROLE_TITLE. `key` and
// `defaultValue` are the same shape.
//
// ★ It is a NARROW list on purpose. `title={x.role}` is a tooltip and stays
// banned, which is why this is not a blanket `(?<!=)`.
const RAW_ROLE_IN_JSX =
  /(?<!\$)(?<!value=)(?<!defaultValue=)(?<!key=)\{\s*[A-Za-z_$][\w.$]*\.role\s*\}/;
// `{identity.roles[0]}` — the exact bug: an arbitrary element of an unordered
// array, printed raw.
const RAW_ROLES_INDEX = /\{\s*[A-Za-z_$][\w.$]*\.roles\s*\[/;

describe('fix-343: no component prints a stored role', () => {
  it('the source scan actually resolved', () => {
    expect(Object.keys(COMPONENT_SOURCES).length).toBeGreaterThan(50);
  });

  // ★★★ fix-436: the widened exemption must not have defanged the guard. A
  // regex change that stops a scan finding anything is indistinguishable from a
  // clean codebase, so the shapes it still has to catch are pinned here.
  it('★★★ the pattern still catches the bug it was written for', () => {
    for (const banned of [
      '<span>{member.role}</span>',
      '<div>{identity.roles[0]}</div>',
      // A tooltip IS screen text — deliberately still banned.
      '<span title={m.role}>x</span>',
      '{ m.role }',
    ]) {
      expect(
        RAW_ROLE_IN_JSX.test(banned) || RAW_ROLES_INDEX.test(banned),
        banned,
      ).toBe(true);
    }
    for (const allowed of [
      // Machine values: the control's value, a list key, a URL.
      '<select value={form.role}>',
      '<option key={o.role} />',
      '<input defaultValue={row.role} />',
      '`/report?role=${m.role}`',
    ]) {
      expect(
        RAW_ROLE_IN_JSX.test(allowed) || RAW_ROLES_INDEX.test(allowed),
        allowed,
      ).toBe(false);
    }
  });

  it('★★ no .tsx interpolates a raw role into the screen', () => {
    const offenders = Object.entries(COMPONENT_SOURCES)
      .filter(([, src]) => {
        const code = executable(src);
        return RAW_ROLE_IN_JSX.test(code) || RAW_ROLES_INDEX.test(code);
      })
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ★ §3 — the initials
// ---------------------------------------------------------------------------

describe('fix-343 §3: initials read the roster, so Bobby Dias is BD', () => {
  const roster = [
    member({ name: 'Bobby', role: 'ent_lead', first_name: 'Bobby', last_name: 'Dias' }),
    member({ name: 'Fisk', role: 'da', first_name: 'Matt', last_name: 'Fisk' }),
    member({ name: 'Alex', role: 'da', active: false, former: true }),
  ];

  it('★★ BD, not BO — the bug register #127 was opened for', () => {
    expect(initialsOf('Bobby')).toBe('BO'); // ★ the input was the problem…
    expect(rosterFullName('Bobby', roster)).toBe('Bobby Dias');
    expect(initialsOf(rosterFullName('Bobby', roster))).toBe('BD'); // …not initialsOf
  });

  // ★ `name` is a key, not a name: "Fisk" is Matt Fisk. The roster is the only
  // thing that knows.
  it('★ a key that is a surname resolves too', () => {
    expect(initialsOf(rosterFullName('Fisk', roster))).toBe('MF');
  });

  it('★ matched trimmed and case-folded, like every other name compare', () => {
    expect(rosterFullName('  bobby ', roster)).toBe('Bobby Dias');
  });

  // ★ Fails OPEN: an unknown name, a departed row with no first/last, or an
  // empty roster all return the input, so a caller always has a usable string.
  it('★ returns the input when it cannot do better', () => {
    expect(rosterFullName('Alex', roster)).toBe('Alex');
    expect(rosterFullName('Stranger', roster)).toBe('Stranger');
    expect(rosterFullName('Bobby', [])).toBe('Bobby');
    expect(rosterFullName(null, roster)).toBe('');
    expect(initialsOf(rosterFullName('Stranger', roster))).toBe('ST');
  });

  // ★ initialsOf itself is UNTOUCHED — it was never the broken half. fix-346
  // said this fix lands with the roster names; it has.
  it('★ initialsOf still does exactly what it did', () => {
    expect(initialsOf('Bobby Dias')).toBe('BD');
    expect(initialsOf('Bobby')).toBe('BO');
    expect(initialsOf('')).toBe('··');
  });
});
