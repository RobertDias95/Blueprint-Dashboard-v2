import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from './helpers/sourceTree';
import { resolve, join } from 'node:path';
import { useAuthStore } from '../stores/authStore';
import { agendaComposerMembers } from '../lib/agenda';
import { ACQ_ROLES, ENT_ROLES } from '../lib/roster';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// fix-644 (P-318) — the Settings cleanup sweep
// ===========================================================================
//
// Bobby, 2026-10-11: delete the unused settings, with a backup. 17 keys were
// approved; §0 found a live reader for ONE of them (the scraper's file indexer
// reads `design_guidance_task_enabled_at`), so 16 go. The two v1 writers that
// could have put them back are dropped.

const ROOT = resolve(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
/** Strip comments so a key named in an explanation is not mistaken for a read. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const DELETED = [
  'permitTypes', 'jurisdictions', 'dmDaGroups', 'das', 'dms', 'entLeads',
  'acqLeads', 'formerDas', 'consultantTypes', 'dmOrder', 'quarterTeams',
  'wizQuestions', 'permitOrder', 'nextId', '_ulsMigrated', 'learnThresholds',
] as const;
const KEPT = 'design_guidance_task_enabled_at';

/** What prod's app_config holds after the delete (2026-10-11), values trimmed. */
const SURVIVORS: Array<{ key: string; value: unknown }> = [
  { key: 'cancelReasonOptions', value: ['Deal died'] },
  { key: KEPT, value: '2026-08-29T14:17:44.754980+00:00' },
  { key: 'droneFootageFolderUrl', value: 'https://example.test/drone' },
  { key: 'holdReasonOptions', value: ['MHA', 'Financing / capital decision'] },
  { key: 'jurisdictionLinks', value: {} },
  { key: 'parkingOptions', value: ['Garage'] },
  { key: 'permitTypeDescriptions', value: {} },
  { key: 'productTypeOptions', value: ['SFR', 'Attached Units'] },
  { key: 'projectTagOptions', value: ['ECA'] },
  { key: 'roofDeckOptions', value: ['None'] },
  { key: 'seattleIntakeWarningRecipients', value: [] },
  { key: 'storiesOptions', value: ['2'] },
  { key: 'vendorReportRecipients', value: [] },
  { key: 'zoneOptions', value: ['NR3'] },
];

// ---------------------------------------------------------------------------
// §1 — the migration does exactly what §0 proved safe
// ---------------------------------------------------------------------------
describe('fix-644 §1 — the migration', () => {
  const sql = read('migrations/fix_644_settings_cleanup.sql');
  const body = code(sql.replace(/^--.*$/gm, ''));

  it('★★★ deletes exactly the 16 unread keys, guarded at 16', () => {
    const list = body.match(/DELETE FROM public\.app_config\s+WHERE key IN \(([\s\S]*?)\)/);
    expect(list).toBeTruthy();
    const keys = [...(list?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...DELETED].sort());
    expect(body).toMatch(/IF v_n <> 16 THEN\s+RAISE EXCEPTION/);
  });

  it('★★★ the key with a live reader is NOT deleted', () => {
    // The scraper's file_indexer reads it every run as the design-guidance
    // cutoff; deleting it would re-stamp the cutoff to "now" on the next run.
    expect(body).not.toContain(KEPT);
  });

  it('★★ drops the two v1 writers, and leaves the weekly DA report alone', () => {
    expect(body).toContain(
      'DROP FUNCTION IF EXISTS public.bp_replace_app_config_and_roster(bigint, jsonb);',
    );
    expect(body).toContain('DROP FUNCTION IF EXISTS public.bp_finalize_app_config_extras();');
    expect(body).not.toMatch(/bp_get_weekly_da_report/);
    // ★ and nothing else is written: no UPDATE, no INSERT, one DELETE
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).not.toMatch(/\bINSERT\b/i);
    expect(body.match(/\bDELETE FROM\b/g)).toHaveLength(1);
  });

  it('★★ the weekly DA report never read app_config — its `das` is an OUTPUT field', () => {
    // Every definition of bp_get_weekly_da_report in history builds its DA list
    // from permits.da. Live check (rolled back, 2026-10-11): output md5
    // identical before and after the delete, 13 DAs both times.
    const defs = readdirSync(join(ROOT, 'migrations'))
      .map((f) => read(`migrations/${f}`))
      .filter((s) => /FUNCTION\s+public\.bp_get_weekly_da_report/i.test(s));
    expect(defs.length).toBeGreaterThan(0);
    for (const s of defs) {
      expect(code(s.replace(/--.*$/gm, ''))).not.toMatch(/app_config/);
      expect(s).toMatch(/'das',/);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the backup holds every approved row, restorable as-is
// ---------------------------------------------------------------------------
describe('fix-644 §2 — the backup', () => {
  const rows = JSON.parse(read('supabase/backups/app_config_unused_keys_2026-10.json')) as Array<
    Record<string, unknown>
  >;

  it('★★★ all 17 approved rows, each with key, value, updated_at, tenant_id', () => {
    expect(rows.map((r) => r.key).sort()).toEqual([...DELETED, KEPT].sort());
    for (const r of rows) {
      expect(Object.keys(r).sort(), String(r.key)).toEqual(
        ['key', 'tenant_id', 'updated_at', 'value'],
      );
      expect(Number.isNaN(Date.parse(String(r.updated_at))), String(r.key)).toBe(false);
    }
  });

  it('★ every deleted key is in the backup (no delete without a copy)', () => {
    const backed = new Set(rows.map((r) => r.key));
    for (const k of DELETED) expect(backed.has(k), k).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — nothing in the app or the edge functions reads a deleted key
// ---------------------------------------------------------------------------
describe('fix-644 §3 — no live reader', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__' && name !== 'node_modules') walk(p, out);
      } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  // ★ READ-SHAPED only: `.get('k')`, `readAppConfig…(m, 'k')`, `key: 'k'`,
  //   `.eq('key', 'k')`, `p_key: 'k'`, `appConfig.k`. A bare 'jurisdictions'
  //   is also a TABLE name and a Settings block id, so a bare string is not a
  //   read.
  function readsKey(body: string, k: string): boolean {
    const q = `['"\`]${k}['"\`]`;
    return [
      String.raw`\.get\(\s*` + q,
      String.raw`readAppConfig\w*\([^)]*` + q,
      String.raw`\bkey:\s*` + q,
      String.raw`\.eq\(\s*'key'\s*,\s*` + q,
      String.raw`p_key:\s*` + q,
      String.raw`appConfig\??\.` + k + String.raw`\b`,
    ].some((re) => new RegExp(re).test(body));
  }

  it('★ the scan sees a read when there is one (positive control)', () => {
    expect(readsKey("appConfig.map.get('das')", 'das')).toBe(true);
    expect(readsKey("readAppConfigStringArray(cfg.map, 'permitTypes')", 'permitTypes')).toBe(true);
    expect(readsKey("setKey.mutate({ key: 'dmOrder', value })", 'dmOrder')).toBe(true);
    expect(readsKey("supabase.from('jurisdictions').select('*')", 'jurisdictions')).toBe(false);
  });

  it('★★★ no file that touches app_config reads a deleted key', () => {
    const files = [
      ...walk(join(ROOT, 'src')),
      ...walk(join(ROOT, 'supabase', 'functions')),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const body = code(readFileSync(f, 'utf8'));
      if (!/app_config|useAppConfig|readAppConfig|configMap|appConfig/.test(body)) continue;
      for (const k of DELETED) if (readsKey(body, k)) offenders.push(`${f}: ${k}`);
    }
    expect(offenders).toEqual([]);
  });

  it('★ the unused permit-owner file is gone', () => {
    expect(() => read('src/lib/permitOwnerOptions.ts')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §4 — Settings loads and saves against the post-delete app_config
// ---------------------------------------------------------------------------
const sb = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: unknown }>,
  rpc: vi.fn(),
}));

vi.mock('../lib/supabase', () => {
  // A chainable, awaitable stand-in: every builder method returns itself, and
  // awaiting it resolves app_config to the fixture and every other table to [].
  function builder(table: string) {
    const result = { data: table === 'app_config' ? sb.rows : [], error: null };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'range', 'match', 'filter', 'not', 'or', 'gte', 'lte']) {
      b[m] = () => b;
    }
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return b;
  }
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: (...args: unknown[]) => sb.rpc(...args),
      channel: () => ({ on: function on() { return this; }, subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    },
  };
});

import AdminProjectsTab from '../components/Settings/AdminProjectsTab';

describe('fix-644 §4 — Settings with the keys gone', () => {
  const T = 'test-tenant-uuid';
  beforeEach(() => {
    sb.rows = SURVIVORS;
    sb.rpc.mockReset();
    sb.rpc.mockImplementation((fn: string, args: { p_key: string; p_value: unknown }) =>
      Promise.resolve(
        fn === 'bp_set_app_config_key'
          ? { data: [{ out_key: args.p_key, out_value: args.p_value, updated_at: 'now' }], error: null }
          : { data: [], error: null },
      ),
    );
    useAuthStore.setState({
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'admin' }],
    });
  });

  function renderIt() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <AdminProjectsTab />
      </QueryClientProvider>,
    );
  }

  it('★★★ loads from the 14 surviving rows and saves through bp_set_app_config_key', async () => {
    renderIt();
    // ★ the real useAppConfig read the post-delete rows
    expect(await screen.findByTestId('hold-reasons-list-pill-MHA')).toBeInTheDocument();
    expect(sb.rows.some((r) => (DELETED as readonly string[]).includes(r.key))).toBe(false);

    fireEvent.change(screen.getByTestId('hold-reasons-list-add'), {
      target: { value: 'Permit hold' },
    });
    fireEvent.click(screen.getByTestId('hold-reasons-list-add-btn'));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('bp_set_app_config_key', {
        p_key: 'holdReasonOptions',
        p_value: ['MHA', 'Financing / capital decision', 'Permit hold'],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// §5 — census 44: the agenda composer offers agenda members
// ---------------------------------------------------------------------------
function tm(p: Partial<TeamMember> & { name: string }): TeamMember {
  return {
    id: `${p.name}-${p.role ?? 'da'}`,
    role: 'da',
    active: true,
    former: false,
    agenda_member: false,
    ...p,
  } as TeamMember;
}

describe('fix-644 §5 — census 44: who an agenda item can be given to', () => {
  const roster = [
    tm({ name: 'Bobby', role: 'ent', agenda_member: true }),
    tm({ name: 'Bobby', role: 'ent_lead', agenda_member: true }),
    tm({ name: 'Brittani', role: 'dm', agenda_member: true }),
    tm({ name: 'Francesca', role: 'da' }),
    tm({ name: 'Lucas', role: 'viewer', agenda_member: true }),
    tm({ name: 'Derry', role: 'dm', agenda_member: true, active: false, former: true }),
  ];

  it('★★★ agenda members only — one entry per person, current staff only', () => {
    expect(agendaComposerMembers(roster).map((m) => m.name)).toEqual([
      'Bobby',
      'Brittani',
      'Lucas',
    ]);
  });

  it('★ nobody ticked → the current roster, never an empty picker', () => {
    const none = roster.map((m) => ({ ...m, agenda_member: false }));
    expect(agendaComposerMembers(none).map((m) => m.name)).toEqual([
      'Bobby',
      'Brittani',
      'Francesca',
      'Lucas',
    ]);
  });

  it('★★ the Agenda block hands the composer that list, not team.all', () => {
    const block = code(read('src/components/WeeklyUpdate/AgendaBlock.tsx'));
    expect(block).toContain('agendaComposerMembers(team.all)');
    expect(block).not.toMatch(/memberNames=\{team\.all\}/);
  });
});

// ---------------------------------------------------------------------------
// §6 — census 21: one definition of each role family
// ---------------------------------------------------------------------------
describe('fix-644 §6 — census 21: role sets come from lib/roster', () => {
  it('★★ no file re-declares the ENT or ACQ set', () => {
    expect([...ENT_ROLES].sort()).toEqual(['ent', 'ent_lead']);
    expect([...ACQ_ROLES].sort()).toEqual(['acq', 'acq_lead']);
    for (const f of [
      'src/components/wizard/Step1ProjectInfo.tsx',
      'src/components/wizard/Step3Permits.tsx',
      'src/components/wizard/Step4TaskReview.tsx',
      'src/lib/unclaimedWork.ts',
      'src/hooks/useProjectDetailsForm.ts',
      'src/pages/ProjectList.tsx',
      'src/pages/MyTasks.tsx',
    ]) {
      const body = code(read(f));
      expect(body, f).not.toMatch(/new Set(<[^>]*>)?\(\[\s*'(ent|acq)',\s*'(ent|acq)_lead'\s*\]\)/);
      expect(body, f).not.toMatch(/===\s*'ent'\s*\|\|\s*\w+(\.role)?\s*===\s*'ent_lead'/);
      expect(body, f).not.toMatch(/===\s*'acq'\s*\|\|\s*\w+(\.role)?\s*===\s*'acq_lead'/);
    }
  });
});
