import { describe, it, expect } from 'vitest';
import migrationSql from '../../migrations/fix_660_permit_type_rename_everywhere.sql?raw';
import renameHookSource from '../hooks/useRenamePermitType.ts?raw';
import {
  namesInDepartments,
  parseDepartments,
  peopleInDepartments,
} from '../lib/departmentFilter';
import { buildQueueForScope, resolveBoardViewer, type BoardInput } from '../lib/myBoard';
import { describeRenameWrites } from '../hooks/useRenamePermitType';
import type { PermitWithCycles, Project, TeamMember } from '../lib/database.types';

// ===========================================================================
// fix-660 (P-318) — census 23 (Department filter) and census 8 (a permit-type
// rename carries everything that stores the name).
// ===========================================================================

function member(name: string, role: string, department: string | null, active = true): TeamMember {
  return { id: `${name}-${role}`, name, role, department, active, former: false } as unknown as TeamMember;
}

// ---------------------------------------------------------------------------
// 23 — who is in a department
// ---------------------------------------------------------------------------
describe('fix-660 §23: peopleInDepartments reads the PERSON, not the row', () => {
  const roster = [
    member('Bobby', 'ent_lead', 'acquisitions'),
    member('Bobby', 'ent', 'acquisitions'),
    member('Dave', 'director', 'executive'),
    member('Dave', 'schematic', 'executive'),
    member('Fisk', 'da', 'design_entitlements'),
    member('Keelie', 'acq', 'acquisitions', false),
    member('Nobody', 'viewer', null),
    // ★ fix-461's split: two rows that disagree. The filter refuses to pick.
    member('Split', 'da', 'policy'),
    member('Split', 'dm', 'underwriting'),
  ];

  it('an empty selection is "no filter" (null), not "nobody"', () => {
    expect(peopleInDepartments(roster, [])).toBeNull();
  });

  it('folds a two-row person into one name', () => {
    expect(peopleInDepartments(roster, ['acquisitions'])).toEqual(['Bobby', 'Keelie']);
    expect(peopleInDepartments(roster, ['executive'])).toEqual(['Dave']);
  });

  it('includes inactive people — their tasks still exist', () => {
    expect(peopleInDepartments(roster, ['acquisitions'])).toContain('Keelie');
  });

  it('★ a split person is in neither department', () => {
    expect(peopleInDepartments(roster, ['policy'])).toEqual([]);
    expect(peopleInDepartments(roster, ['underwriting'])).toEqual([]);
  });

  it('several departments are a union', () => {
    expect(peopleInDepartments(roster, ['executive', 'design_entitlements'])).toEqual([
      'Dave',
      'Fisk',
    ]);
  });

  it('parseDepartments keeps only Settings departments, once each', () => {
    expect(parseDepartments(['acquisitions', 'nope', 3, 'acquisitions', 'policy'])).toEqual([
      'acquisitions',
      'policy',
    ]);
    expect(parseDepartments('acquisitions')).toEqual([]);
    expect(parseDepartments(undefined)).toEqual([]);
  });

  it('namesInDepartments is case-insensitive and passes through on null', () => {
    expect(namesInDepartments(['fisk ', 'Marc'], ['Fisk'])).toEqual(['fisk ']);
    expect(namesInDepartments(['Fisk', 'Marc'], null)).toEqual(['Fisk', 'Marc']);
  });
});

// ---------------------------------------------------------------------------
// 23 — the board queue
// ---------------------------------------------------------------------------
describe('fix-660 §23: buildQueueForScope with a department', () => {
  const TODAY = '2026-08-24';
  const PROJECTS = [{ id: 'p1', address: '1 A St' }] as unknown as Project[];
  function permit(id: number, over: Partial<PermitWithCycles>): PermitWithCycles {
    return {
      id,
      project_id: 'p1',
      type: 'SDOT Tree',
      num: `N${id}`,
      status: 'Initiated',
      da: null,
      ent_lead: null,
      parent_permit_id: null,
      target_submit: null,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: `${TODAY}T09:00:00Z`,
      permit_cycles: [
        {
          id: `c${id}`, permit_id: id, cycle_index: 1, submitted: '2026-08-18',
          intake_accepted: null, city_target: '2026-08-21', corr_issued: null,
          resubmitted: null, created_at: '', updated_at: '',
        },
      ],
      ...over,
    } as unknown as PermitWithCycles;
  }
  const input: BoardInput = {
    viewer: resolveBoardViewer('Bobby', []),
    permits: [
      permit(1, { ent_lead: 'Bobby' }),
      permit(2, { ent_lead: 'Cam' }),
      permit(3, { ent_lead: 'Keelie' }),
    ],
    projects: PROJECTS,
    tasks: [],
    today: TODAY,
  } as BoardInput;
  const ids = (q: ReturnType<typeof buildQueueForScope>) => q.rows.map((r) => r.permitId).sort();

  it('without a department, "My team" is the whole team (unchanged)', () => {
    expect(ids(buildQueueForScope(input, { mode: 'team' }, ['Cam', 'Keelie']))).toEqual([2, 3]);
  });

  it('a department narrows the team', () => {
    expect(ids(buildQueueForScope(input, { mode: 'team' }, ['Cam', 'Keelie'], ['Keelie']))).toEqual([3]);
  });

  it('★★ no one on the team in the department → an EMPTY queue, never the viewer\'s own', () => {
    const q = buildQueueForScope(input, { mode: 'team' }, ['Cam', 'Keelie'], ['Someone Else']);
    expect(q.total).toBe(0);
    // Bobby's own permit 1 must not leak in under a team heading.
    expect(ids(q)).toEqual([]);
  });

  it('"one person" outside the department is empty too', () => {
    expect(buildQueueForScope(input, { mode: 'person', person: 'Cam' }, ['Cam', 'Keelie'], ['Keelie']).total).toBe(0);
  });

  it('"My queue" ignores it — the scope never reaches the viewer\'s own list', () => {
    expect(ids(buildQueueForScope(input, { mode: 'mine' }, ['Cam'], ['Someone Else']))).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// 8 — the rename
// ---------------------------------------------------------------------------
const sql = migrationSql.replace(/\r\n/g, '\n');
/** The function body without its comment lines, so prose cannot satisfy an
 *  assertion about code. */
const code = sql
  .split('\n')
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');

describe('fix-660 §8: bp_rename_permit_type writes every place that stores the name', () => {
  // ★ The §0 write list. Each entry is (table, column) — the migration must
  //   UPDATE it, keyed on the old name.
  const PLACES: Array<[string, string]> = [
    ['permit_types', 'name'],
    ['permits', 'type'],
    ['task_templates', 'permit_type'],
    ['target_submit_formulas', 'type'],
    ['permit_type_defaults', 'type'],
    ['intake_records', 'permit_type'],
  ];

  it.each(PLACES)('moves %s.%s', (table, col) => {
    const re = new RegExp(
      `UPDATE public\\.${table}\\s+SET ${col} = v_new[\\s\\S]*?WHERE ${col} = v_old`,
    );
    expect(code).toMatch(re);
  });

  it('moves the description KEY in app_config, keeping its text', () => {
    expect(code).toMatch(
      /UPDATE public\.app_config\s+SET value = \(value - v_old\) \|\| jsonb_build_object\(v_new, value -> v_old\)/,
    );
    expect(code).toMatch(/WHERE key = 'permitTypeDescriptions' AND value \? v_old/);
  });

  it('moves the import copy in permits.extras', () => {
    expect(code).toMatch(/jsonb_set\(extras, '\{type\}', to_jsonb\(v_new\)\)/);
  });

  it('does NOT rewrite history', () => {
    for (const t of ['audit_log SET', 'notification_email_queue', 'error_reports', 'legacy_', '_fix22_']) {
      expect(code).not.toContain(`UPDATE public.${t}`);
    }
  });

  it('is one function body — one transaction — and reports every count', () => {
    expect(code.match(/CREATE FUNCTION public\.bp_rename_permit_type/g)).toHaveLength(1);
    for (const k of [
      'permit_types', 'permits', 'permits_extras_only', 'task_templates',
      'target_submit_formulas', 'permit_type_defaults', 'intake_records',
      'permit_type_descriptions',
    ]) {
      expect(code).toContain(`jsonb_build_object('${k}'`);
    }
    expect(code).toContain('out_writes jsonb');
  });

  it('refuses with a reason: signed out, non-admin, merge, built-in, named in code, name taken, foreign tenant', () => {
    expect(code).toContain('IF v_uid IS NULL THEN');
    expect(code).toContain('IF NOT public.bp_is_admin_anywhere() THEN');
    expect(code).toMatch(/lower\(name\) = lower\(v_new\) AND name <> v_old/);
    expect(code).toMatch(/IF v_builtin THEN\s+RAISE EXCEPTION/);
    expect(code).toMatch(/p\.prosrc LIKE v_quoted/);
    expect(code).toMatch(/IF v_taken IS NOT NULL THEN\s+RAISE EXCEPTION/);
    expect(code).toMatch(/IF v_foreign > 0 THEN\s+RAISE EXCEPTION/);
  });

  it('★ every refusal comes BEFORE the first write', () => {
    const firstWrite = code.indexOf('UPDATE public.permit_types');
    const lastRefusal = code.lastIndexOf('RAISE EXCEPTION');
    expect(firstWrite).toBeGreaterThan(0);
    expect(lastRefusal).toBeLessThan(firstWrite);
  });

  it('is audited and admin-only at the grant level too', () => {
    expect(code).toMatch(/INSERT INTO public\.audit_log[\s\S]*'permit_type_renamed'/);
    expect(code).toContain('SECURITY DEFINER');
    expect(code).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.bp_rename_permit_type\(text, text\) FROM PUBLIC, anon/);
  });

  it('keeps the old return columns so either deploy order works', () => {
    expect(code).toContain(
      'RETURNS TABLE(out_name text, out_permits_repointed integer, out_writes jsonb)',
    );
  });
});

describe('fix-660 §8: the client says what moved', () => {
  it('lists every non-zero place, permits first', () => {
    expect(
      describeRenameWrites({
        out_name: 'Tree',
        out_permits_repointed: 22,
        out_writes: {
          permits: 22,
          permit_types: 1,
          task_templates: 1,
          target_submit_formulas: 1,
          permit_type_defaults: 1,
          permit_type_descriptions: 1,
          intake_records: 0,
        },
      }),
    ).toBe(
      '22 permits, 1 task template, 1 target-submit formula, 1 default, 1 description',
    );
  });

  it('copes with the pre-migration shape (no out_writes)', () => {
    expect(describeRenameWrites({ out_name: 'X', out_permits_repointed: 1 })).toBe('1 permit');
    expect(describeRenameWrites({ out_name: 'X', out_permits_repointed: 0, out_writes: null })).toBe('');
  });

  it('refreshes every cache the rename touched', () => {
    for (const k of ['taskTemplatesAll', 'targetSubmitFormulasAll', 'permitTypeDefaultsAll', 'appConfigAll']) {
      expect(renameHookSource).toContain(`queryKeys.${k}`);
    }
  });
});
