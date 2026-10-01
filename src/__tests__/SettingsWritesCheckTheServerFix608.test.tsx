// ===========================================================================
// ★★★ fix-608 — THE SERVER CHECKS WHO MAY WRITE A SETTING · ONE ADMIN SOURCE ·
//     THE SSS CARD FINDS ITS RECIPIENTS   (P-304, P-305, census gap 31)
// ===========================================================================
//
// Three things that had nothing in common except that a screen said one thing
// and the server did another.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const SRC = resolve(__dirname, '..');
const ROOT = resolve(SRC, '..');
const MIGRATION = readFileSync(
  resolve(ROOT, 'migrations/fix_608_settings_writes_admin_check.sql'),
  'utf8',
);

// ===========================================================================
// §A — P-305: the SSS card finds its recipients
// ===========================================================================

const CONFIG_REF = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock('../hooks/useAppConfig', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    useAppConfig: () => ({
      map: CONFIG_REF.map,
      rows: [],
      isLoading: false,
      error: null,
      refetch: () => undefined,
    }),
  };
});
vi.mock('../hooks/useVendorReportState', () => ({
  useVendorReportState: () => ({ data: [], isLoading: false, error: null }),
  useMarkVendorReportSent: () => ({ mutate: vi.fn(), isPending: false }),
}));

import SssCard from '../components/WeeklyUpdate/SssCard';
import {
  readVendorRecipients,
  readVendorRecipientsFromConfig,
  VENDOR_RECIPIENTS_CONFIG_KEY,
} from '../lib/vendorReportEmail';

const RECIPIENTS = {
  sss: {
    label: 'Structural Schedule',
    to: [{ name: 'Dana Reyes', email: 'dana@example.com' }],
    cc: [{ name: 'Sam Platt', email: 'sam@example.com' }],
  },
};

describe('fix-608 §A — the SSS card lists its configured recipients', () => {
  it('★★★ the card shows the people, where it used to say nothing', () => {
    CONFIG_REF.map = new Map<string, unknown>([
      [VENDOR_RECIPIENTS_CONFIG_KEY, RECIPIENTS],
    ]);
    render(
      <MemoryRouter>
        <SssCard />
      </MemoryRouter>,
    );
    const line = screen.getByTestId('sss-recipients').textContent ?? '';
    expect(line).toContain('dana@example.com');
    expect(line).toContain('sam@example.com');
    // ★ and the em-dash placeholder — the symptom P-305 reported — is gone
    expect(line).not.toMatch(/To\s+—/);
  });

  it('★★★ the OLD call shape is what produced "no recipients" — red proof', () => {
    // ★★★ THE DEFECT, DEMONSTRATED RATHER THAN DESCRIBED. The card passed the
    //     whole config Map to a function that wants the VALUE. A Map has no
    //     string index, so `value['sss']` was `undefined` every time, and the
    //     malformed-input guard turned that into an empty list instead of an
    //     error. This asserts the old expression still returns nothing, so the
    //     fix cannot be mistaken for a no-op.
    const map = new Map<string, unknown>([
      [VENDOR_RECIPIENTS_CONFIG_KEY, RECIPIENTS],
    ]);
    const oldWay = readVendorRecipients(map, 'sss');
    expect(oldWay.to).toEqual([]);
    expect(oldWay.cc).toEqual([]);
    expect(oldWay.label).toBe('');

    const newWay = readVendorRecipientsFromConfig(map, 'sss');
    expect(newWay.to).toHaveLength(1);
    expect(newWay.label).toBe('Structural Schedule');
  });

  it('★★ one accessor, one spelling of the key', () => {
    // ★ The key used to be spelled out at the forecast page's call site and
    //   nowhere else, which is how the two paths came to differ at all.
    expect(VENDOR_RECIPIENTS_CONFIG_KEY).toBe('vendorReportRecipients');
    const forecast = readFileSync(
      join(SRC, 'pages/VendorScheduleForecastReport.tsx'),
      'utf8',
    );
    const card = readFileSync(join(SRC, 'components/WeeklyUpdate/SssCard.tsx'), 'utf8');
    expect(forecast).not.toContain("get('vendorReportRecipients')");
    expect(forecast).toContain('VENDOR_RECIPIENTS_CONFIG_KEY');
    expect(card).toContain('readVendorRecipientsFromConfig(configQ.map');
    // ★ the card no longer passes the map to the VALUE-shaped reader
    expect(card).not.toContain('readVendorRecipients(configQ.map');
  });

  it('★ an empty config still degrades quietly', () => {
    CONFIG_REF.map = new Map<string, unknown>();
    expect(readVendorRecipientsFromConfig(CONFIG_REF.map, 'sss').to).toEqual([]);
    expect(readVendorRecipientsFromConfig(undefined, 'sss').to).toEqual([]);
  });
});

// ===========================================================================
// §B — P-304: the migration. Every write gets a server-side check.
// ===========================================================================
describe('fix-608 §B — the staged migration gates every settings write', () => {
  /** The body of one `CREATE OR REPLACE FUNCTION` block in the migration. */
  function fnBody(name: string): string {
    const i = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    expect(i, `${name} is not in the migration`).toBeGreaterThan(-1);
    const rest = MIGRATION.slice(i);
    const end = rest.indexOf('$function$;');
    expect(end, `${name} has no closing $function$;`).toBeGreaterThan(-1);
    return rest.slice(0, end);
  }

  const ADMIN_GATED = [
    'bp_upsert_target_submit_formula',
    'bp_delete_target_submit_formula',
    'bp_upsert_builder',
    'bp_deactivate_builder',
    'bp_merge_builders',
    'bp_rename_builder_person',
  ];

  it('★★★ every admin-side function raises 42501 unless is_tenant_admin', () => {
    for (const name of ADMIN_GATED) {
      const body = fnBody(name);
      expect(body, `${name} must ask is_tenant_admin`).toMatch(/is_tenant_admin/);
      expect(body, `${name} must raise 42501`).toMatch(/errcode\s*=\s*'42501'/i);
      // ★★ A PLAIN SENTENCE, because the client shows `error.message` verbatim.
      //    A bare code would reach the user as "42501".
      expect(body, `${name} needs a readable message`).toMatch(
        /raise exception '[A-Z][^']*\.'/i,
      );
    }
  });

  it('★★★ the project-side add is gated on bp_may_write_project, not on admin', () => {
    const body = fnBody('bp_add_builder_from_project');
    // ⚖️ Bobby: "admins + people of the project." That rule already exists.
    expect(body).toContain('bp_may_write_project(p_project_id)');
    expect(body).toMatch(/errcode\s*=\s*'42501'/i);
    // ★★★ AND IT DOES NOT WRITE A SECOND MEMBERSHIP RULE. No roster roles, no
    //     write-caps, no tenant_memberships lookup of its own — if any of those
    //     appear here, the rule has been forked.
    expect(body).not.toMatch(/bp_roster_roles|bp_write_caps|tenant_memberships/);
  });

  it('★★★ the project-side add is INSERT ONLY — that is the boundary', () => {
    const body = fnBody('bp_add_builder_from_project');
    expect(body).toMatch(/insert into public\.builders/i);
    // ★ no id parameter, so it cannot be steered at an existing row …
    expect(body).not.toMatch(/\bp_id\b/);
    // ★★ … and no update or delete of any kind
    expect(body).not.toMatch(/update\s+public\./i);
    expect(body).not.toMatch(/delete\s+from/i);
    // ★ the tenant comes from the PROJECT, never from the session
    expect(body).toContain('from public.projects pr');
    expect(body).not.toContain('auth_tenant_ids()');
  });

  it('★★ it is a NEW function, not a new parameter on bp_upsert_builder', () => {
    // ★★★ A changed signature leaves an OVERLOAD behind: the old shape stays
    //     resolvable and PostgREST then has two candidates (fix-438 hit this).
    const upsert = fnBody('bp_upsert_builder');
    expect(upsert).not.toContain('p_project_id');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.bp_add_builder_from_project(');
  });

  it('★★ bp_upsert_builder is gated ABOVE the insert/update fork', () => {
    // §B.2 asks for both branches. One check above the fork does both; two
    // copies of a rule is how one of them gets missed.
    const body = fnBody('bp_upsert_builder');
    const gate = body.indexOf('is_tenant_admin');
    const fork = body.indexOf('if p_id is null then');
    expect(gate).toBeGreaterThan(-1);
    expect(fork).toBeGreaterThan(gate);
  });

  it('★★★ the RLS policies change too — the RPC check alone is not enough', () => {
    // A SECURITY DEFINER function bypasses RLS, so the function check covers the
    // RPC and the policies cover a direct PostgREST write. Neither alone is the
    // gate.
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS target_submit_formulas_tenant_policy');
    for (const p of [
      'target_submit_formulas_admin_insert',
      'target_submit_formulas_admin_update',
      'target_submit_formulas_admin_delete',
      'builders_admin_insert',
      'builders_admin_update',
      'builders_admin_delete',
    ]) {
      expect(MIGRATION, `${p} missing`).toContain(`CREATE POLICY ${p}`);
    }
    // ★ reading was never the problem, and every dropdown depends on it
    expect(MIGRATION).toContain('CREATE POLICY target_submit_formulas_tenant_select');
    expect(MIGRATION).not.toContain('DROP POLICY IF EXISTS builders_tenant_select');
  });

  it('★★★ §C.1 — the two GLOBAL catalogues stop reading profiles.role', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.bp_is_admin_anywhere()');
    expect(MIGRATION).toContain('FROM public.tenant_memberships');
    for (const p of ['admin write jurisdictions', 'admin write permit_types']) {
      expect(MIGRATION).toContain(`DROP POLICY IF EXISTS "${p}"`);
      expect(MIGRATION).toContain(`CREATE POLICY "${p}"`);
    }
    // ★★ the replacement predicate, and NOT the old one
    expect(MIGRATION).toContain('USING (public.bp_is_admin_anywhere())');
    expect(MIGRATION).not.toMatch(/CREATE POLICY[\s\S]*?p\.role = 'admin'/);
    // ★ the paired read policies are untouched — every dropdown reads these
    expect(MIGRATION).not.toContain('auth read jurisdictions');
    expect(MIGRATION).not.toContain('auth read permit_types');
  });

  it('★★★ grants: REVOKE FROM public, anon — never FROM anon alone', () => {
    // ★★★ fix-157: anon INHERITS the PUBLIC grant, so `REVOKE … FROM anon` by
    //     itself leaves the function callable by an unauthenticated session.
    const revokes = MIGRATION.match(/REVOKE ALL ON FUNCTION[^;]*;/g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(8);
    for (const r of revokes) {
      expect(r, `must revoke from public too: ${r}`).toMatch(/FROM public,\s*anon/);
    }
    // every function the file creates or replaces is granted back
    const created = (MIGRATION.match(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g) ?? [])
      .map((m) => /public\.(\w+)\(/.exec(m)?.[1] as string);
    expect(created.length).toBe(8);
    for (const name of created) {
      expect(MIGRATION, `${name} needs its EXECUTE grant restated`).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(`,
      );
    }
  });

  it('★★ one transaction, and no data is touched', () => {
    expect(MIGRATION).toContain('BEGIN;');
    expect(MIGRATION).toContain('COMMIT;');
    expect((MIGRATION.match(/^BEGIN;/gm) ?? []).length).toBe(1);
    expect((MIGRATION.match(/^COMMIT;/gm) ?? []).length).toBe(1);
    // ★★★ NO DATA CHANGES. Asserted on statements outside a function body, since
    //     the function bodies legitimately contain INSERT/UPDATE.
    const outsideBodies = MIGRATION.split('$function$')
      .filter((_, i) => i % 2 === 0)
      .join('\n');
    expect(outsideBodies).not.toMatch(/^\s*(insert into|update|delete from|truncate)/im);
    // ★ and no role is reassigned — the 8-vs-7 difference is Bobby's call
    expect(MIGRATION).not.toMatch(/update\s+public\.(profiles|tenant_memberships)/i);
  });

  it('★ the file says it is staged, and names what it leaves alone', () => {
    expect(MIGRATION).toMatch(/STAGED, NOT APPLIED/i);
    // the legacy second source, named rather than silently left
    expect(MIGRATION).toMatch(/is_admin\(\)/);
  });
});

// ===========================================================================
// §B client — the picker, and the write path that is gone
// ===========================================================================
describe('fix-608 §B — the client side', () => {
  it('★★★ BuilderPicker requires a projectId and sends it', () => {
    const picker = readFileSync(join(SRC, 'components/builder/BuilderPicker.tsx'), 'utf8');
    // ★★ REQUIRED, not optional: a mount that could not supply one would fall
    //    back to the admin RPC and silently stop working for DAs.
    expect(picker).toMatch(/projectId: string;/);
    expect(picker).not.toMatch(/projectId\?: string/);
    expect(picker).toContain('useAddBuilderFromProject');
    expect(picker).toContain('addBuilder.mutate({ ...input, projectId }');
    // the admin-only RPC is no longer reachable from this surface
    expect(picker).not.toContain('useUpsertBuilderRow');
  });

  it('★★ the one mount passes its project', () => {
    // Measured: exactly one mount exists — ProjectDetailHeader's Owner cell —
    // and it has the project in scope, so no mount had to stay on the admin RPC.
    const header = readFileSync(
      join(SRC, 'components/ProjectDetail/ProjectDetailHeader.tsx'),
      'utf8',
    );
    expect(header).toContain('projectId={project.id}');
    const mounts: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      if (src.includes('<BuilderPicker')) mounts.push(relative(SRC, file).replace(/\\/g, '/'));
    }
    expect(mounts).toEqual(['components/ProjectDetail/ProjectDetailHeader.tsx']);
  });

  it('★★★ the new hook calls the new RPC, with no OCC token', () => {
    const reg = readFileSync(join(SRC, 'hooks/useBuilderRegistry.ts'), 'utf8');
    expect(reg).toContain("supabase.rpc('bp_add_builder_from_project'");
    expect(reg).toContain('p_project_id: input.projectId');
    // ★ an insert has nothing to collide with; the upsert keeps its serializer
    const add = reg.slice(reg.indexOf('export function useAddBuilderFromProject'));
    const addBody = add.slice(0, add.indexOf('export function useUpsertBuilderRow'));
    expect(addBody).not.toContain('occSerialize');
    expect(reg).toContain('occSerialize'); // still there, for the upsert
  });

  it('★★★ census gap 31 — the direct-table builder write is gone', () => {
    const src = readFileSync(join(SRC, 'hooks/useBuilders.ts'), 'utf8');
    // ★ the READ survives; it has live callers
    expect(src).toContain('export function useBuilders()');
    expect(src).not.toContain('export function useUpsertBuilder(');
    expect(src).not.toContain('export interface UpsertBuilderInput');
    // ★★ and it is not a PostgREST write path any more at all
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain(".update(");
  });

  it('★★ nothing imports the deleted hook', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (rel === 'hooks/useBuilderRegistry.ts') continue; // names it in a comment
      if (/import\s*\{[^}]*\buseUpsertBuilder\b[^}]*\}\s*from\s*'[^']*useBuilders'/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// §C — ONE ADMIN SOURCE
// ===========================================================================
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'harness' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(tsx?|sql)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments stripped, so prose ABOUT profiles.role is not mistaken for a read.
 *
 * ★★★ THE CRLF HOLE, FOUND BY THIS TEST FAILING ON TWO FILES THAT WERE CLEAN.
 *     These files are CRLF. Splitting on '\n' leaves a trailing '\r' on every
 *     line, and '\r' is a LINE TERMINATOR in a JS regex — so `.*` stops before it
 *     and `$` (no `m` flag) never matches, which means **the comment stripper
 *     silently stripped nothing at all**. A stripper that does nothing turns
 *     "no code reads this" into "no file mentions this", which is the opposite
 *     test and one this repo cannot pass: nine files discuss profiles.role on
 *     purpose. Normalising the line endings first is the whole fix.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/--.*$/, ''))
    .join('\n');
}

describe('fix-608 §C — only tenant_memberships answers "is this an admin"', () => {
  it('★★★ no CODE in src/ reads profiles.role as a gate', () => {
    // ★★★ THE GRAVESTONE TRAP, SEVENTH TIME. Nine files in src/ NAME
    //     `profiles.role` in a comment — several of them to explain that it is
    //     legacy. Asserting on the bare string would forbid writing that down,
    //     so comments are stripped first and only code is searched.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      if (/profiles[\s\S]{0,80}?\brole\b[\s\S]{0,40}?['"]admin['"]/.test(code)) {
        offenders.push(relative(SRC, file).replace(/\\/g, '/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('★★★ the Edge Function gate reads tenant_memberships', () => {
    const handler = readFileSync(
      resolve(ROOT, 'supabase/functions/admin-create-user/handler.ts'),
      'utf8',
    );
    const index = readFileSync(
      resolve(ROOT, 'supabase/functions/admin-create-user/index.ts'),
      'utf8',
    );
    expect(handler).toContain('membershipRole(userId: string, tenantId: string)');
    expect(handler).toContain('await deps.membershipRole(callerId, tenantId)');
    expect(handler).not.toContain('deps.profileRole(');
    expect(codeOnly(index)).toContain("from('tenant_memberships')");
    // ★★★ AND IT STILL WRITES profiles.role — §C.2 says do not stop. Only the
    //     gates stopped reading it.
    expect(index).toContain("from('profiles').update({ role })");
    expect(handler).toContain('setProfileRole(userId: string, role: BridgeRole)');
  });

  it('★★★ the gate asks about the tenant being written to, resolved FIRST', () => {
    const handler = readFileSync(
      resolve(ROOT, 'supabase/functions/admin-create-user/handler.ts'),
      'utf8',
    );
    const tenant = handler.indexOf('const tenantId = await deps.callerTenantId(callerId);');
    const gate = handler.indexOf('const callerRole = await deps.membershipRole(');
    expect(tenant).toBeGreaterThan(0);
    // ★★ "is this person an admin" is not answerable alone — only "an admin OF
    //    THIS TENANT" is, so the tenant has to come first.
    expect(gate).toBeGreaterThan(tenant);
  });

  it('★ the migration moved the two policies that did read it', () => {
    expect(MIGRATION).toContain('bp_is_admin_anywhere');
    // and it records the limitation rather than leaving it to be discovered
    expect(MIGRATION).toMatch(/ONE\s*TENANT/i);
  });
});

// ===========================================================================
// §C — the Edge Function's decision, exercised for real
// ===========================================================================
import {
  createPerson,
  type Deps,
  type RosterRow,
} from '../../supabase/functions/admin-create-user/handler';

/** Minimal deps: only the gate's inputs vary. */
function gateDeps(over: {
  membership?: 'admin' | 'editor' | null;
  profile?: 'admin' | 'editor' | null;
  tenantId?: string | null;
}): { deps: Deps; asked: { userId?: string; tenantId?: string } } {
  const asked: { userId?: string; tenantId?: string } = {};
  const deps: Deps = {
    callerId: async () => 'caller-1',
    membershipRole: async (userId, tenantId) => {
      asked.userId = userId;
      asked.tenantId = tenantId;
      return over.membership ?? null;
    },
    callerTenantId: async () =>
      over.tenantId === undefined ? 'tenant-1' : over.tenantId,
    createAuthUser: async () => ({ id: 'user-new' }),
    deleteAuthUser: async () => undefined,
    findRosterRows: async (): Promise<RosterRow[]> => [],
    updateRosterRow: async () => undefined,
    insertRosterRow: async () => 'roster-1',
    ensureMembership: async () => false,
    setProfileRole: async () => undefined,
  };
  return { deps, asked };
}

// ★ The full valid shape. An earlier draft omitted first_name/last_name and the
//   call came back `invalid` — which still proved the gate had PASSED, but a test
//   that stops at validation is not testing the thing after it.
const REQ = {
  email: 'jamie@blueprintcap.com',
  password: 'Correct-Horse-9',
  first_name: 'Jamie',
  last_name: 'Okafor',
  name: 'Jamie',
  role: 'da' as const,
  notes: null,
  bridge_role: 'editor' as const,
};

describe('fix-608 §C.2 — the add-person gate, by tenant_memberships', () => {
  it('★★★ a TENANT admin whose profiles.role is "editor" is ALLOWED', () => {
    // ★★★ THIS IS GENA. Measured on prod 2026-09-30: 8 admins in
    //     `tenant_memberships`, 7 in `profiles`, and one person differs — admin
    //     on screen, editor to the server. She could open the admin screens and
    //     every write refused her. The two now agree because only one is read.
    const { deps, asked } = gateDeps({ membership: 'admin', profile: 'editor' });
    return createPerson(deps, 'good', REQ).then((res) => {
      expect(res.ok).toBe(true);
      // ★ and the question was asked about the right pair
      expect(asked).toEqual({ userId: 'caller-1', tenantId: 'tenant-1' });
    });
  });

  it('★★★ a tenant EDITOR is refused, whatever profiles says', () => {
    const { deps } = gateDeps({ membership: 'editor', profile: 'admin' });
    return createPerson(deps, 'good', REQ).then((res) => {
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.code).toBe('not_admin');
      expect(res.message).toMatch(/not an admin/i);
    });
  });

  it('★★ no membership row at all is refused', () => {
    const { deps } = gateDeps({ membership: null });
    return createPerson(deps, 'good', REQ).then((res) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('not_admin');
    });
  });

  it('★★ no tenant is "no_tenant", not "not_admin" — the reorder’s one effect', () => {
    // ★ Named because it IS a behaviour change: before the reorder a caller with
    //   no tenant was told they were not an admin, which was true but not the
    //   reason. `no_tenant` is the accurate answer.
    const { deps } = gateDeps({ membership: 'admin', tenantId: null });
    return createPerson(deps, 'good', REQ).then((res) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('no_tenant');
    });
  });
});
