import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { TaskTemplate } from '../lib/database.types';
import {
  applicableTemplates,
  compareTemplates,
  defaultTickedIds,
  templateApplies,
  templatesToOffer,
} from '../lib/templateTasks';
import { useAddedPermitsStore } from '../stores/addedPermitsStore';

// ===========================================================================
// fix-609 (P-306) — a permit added later is OFFERED its template tasks
// ===========================================================================

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = read('migrations/fix_609_template_tasks_for_a_permit.sql');
const SQL = MIGRATION.split('\n').map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l)).join('\n');

// ---------------------------------------------------------------------------
// §A — the refactor proof
// ---------------------------------------------------------------------------

/** The live create function's seeding block, verbatim (prod, 2026-09-30). */
const ORIGINAL = read('src/__tests__/fixtures/fix609_create_seed_block.sql');
const ORIGINAL_MD5 = '1aaeef35f9e47badc5c1eb0d9ae98200';

/** THE substitution list the migration header documents — names only. */
const SUBS: Array<[string, string]> = [
  ["NULLIF(v_permit->>'ent_lead', '')", 'v_ent_lead'],
  ["NULLIF(v_permit->>'da', '')", 'v_da'],
  ['v_schematic_designer', 'v_schematic'],
  ['v_permit_type', 'v_type'],
  ['v_permit_id', 'p_permit_id'],
  ['v_task_ids', 'p_template_ids'],
  ['p_tenant_id', 'v_tenant'],
];

describe('fix-609 §A — bp_seed_template_tasks IS the create function\'s block', () => {
  it('★★★ the fixture is the live block, byte for byte (md5 + length)', () => {
    expect(ORIGINAL.length).toBe(2019);
    expect(createHash('md5').update(ORIGINAL).digest('hex')).toBe(ORIGINAL_MD5);
  });

  it('★★★ the new function\'s INSERT is the original with the documented NAME substitutions and nothing else', () => {
    let expected = ORIGINAL;
    for (const [a, b] of SUBS) expected = expected.split(a).join(b);
    expect(MIGRATION).toContain(expected);
    // and nothing from the old names survived inside it
    for (const [a] of SUBS) expect(expected).not.toContain(a);
  });

  it('★★★ each substituted name is READ BACK from the row the create function just wrote', () => {
    const seed = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_seed_template_tasks('),
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_add_template_tasks_to_permit('),
    );
    expect(seed).toMatch(
      /SELECT p\.tenant_id, p\.type, NULLIF\(p\.ent_lead, ''\), NULLIF\(p\.da, ''\),\s+pr\.juris, COALESCE\(pr\.schematic_designer, ARRAY\[\]::text\[\]\)\s+INTO v_tenant, v_type, v_ent_lead, v_da, v_juris, v_schematic/,
    );
    // no subtasks — the original seeds none, so neither does the extraction
    expect(seed).not.toMatch(/task_template_subtasks/);
  });

  it('★★★ the create function is patched to CALL it — guarded by the same md5, by anchor, never retyped', () => {
    expect(SQL).toContain(`c_md5   constant text := '${ORIGINAL_MD5}';`);
    expect(SQL).toContain("E'      PERFORM public.bp_seed_template_tasks(v_permit_id, v_task_ids);\\n'");
    expect(SQL).toMatch(/IF md5\(v_old\) <> c_md5 THEN\s+RAISE EXCEPTION/);
    expect(SQL).toContain("IF (length(v_def) - length(replace(v_def, c_start, ''))) / length(c_start) <> 1 THEN");
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.bp_create_project_with_permits/);
    // post-condition: the inline INSERT is gone, the call is there
    expect(SQL).toContain("IF position('INSERT INTO public.permit_tasks' IN v_def) > 0 THEN");
  });

  it('★★ one transaction', () => {
    expect(SQL.trim().startsWith('BEGIN;')).toBe(true);
    expect(SQL.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(SQL.match(/\bBEGIN;/g)).toHaveLength(1);
  });
});

describe('fix-609 §A — bp_add_template_tasks_to_permit', () => {
  const rpc = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_add_template_tasks_to_permit('));
  const body = rpc.slice(0, rpc.indexOf('$function$;'));

  it('★★★ SECURITY DEFINER, and it refuses 42501 through bp_may_write_project — the existing rule', () => {
    expect(body).toMatch(/SECURITY DEFINER/);
    const gate = body.indexOf('IF NOT public.bp_may_write_project(v_project) THEN');
    expect(gate).toBeGreaterThan(0);
    expect(body.slice(gate, gate + 200)).toContain("ERRCODE = '42501'");
    // the gate runs before anything is written
    expect(gate).toBeLessThan(body.indexOf('bp_seed_template_tasks('));
  });

  it('★★★ the SERVER refuses a template that does not apply (wrong type, another city, another tenant)', () => {
    expect(body).toMatch(
      /tt\.tenant_id = v_tenant\s+AND tt\.permit_type = v_type\s+AND \(tt\.jurisdiction IS NULL OR tt\.jurisdiction = v_juris\)/,
    );
    expect(body).toContain("ERRCODE = '22023'");
  });

  it('★★★ idempotent: a template whose text is already a task on the permit is skipped', () => {
    expect(body).toMatch(
      /NOT EXISTS \(\s+SELECT 1 FROM public\.permit_tasks pt\s+WHERE pt\.permit_id = p_permit_id\s+AND pt\.text = tt\.text\)/,
    );
  });

  it('★★★ grants: never anon (FROM PUBLIC, anon — fix-157), the seeder is not callable by clients, the create ACL restated', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.bp_add_template_tasks_to_permit(integer, uuid[]) FROM PUBLIC, anon;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.bp_add_template_tasks_to_permit(integer, uuid[]) TO authenticated, service_role;');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.bp_seed_template_tasks(integer, uuid[]) FROM PUBLIC, anon, authenticated;');
    expect(SQL).not.toMatch(/GRANT[^;]*bp_seed_template_tasks/);
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.bp_create_project_with_permits(uuid,text,text,text,jsonb,jsonb,boolean,jsonb) TO authenticated, service_role;',
    );
    expect(SQL).not.toMatch(/GRANT[^;]*\banon\b/i);
  });
});

// ---------------------------------------------------------------------------
// §B — the shared rule (the wizard's, moved — not changed)
// ---------------------------------------------------------------------------

function tpl(over: Partial<TaskTemplate>): TaskTemplate {
  return {
    id: over.id ?? `t-${over.text}`,
    permit_type: 'ULS',
    jurisdiction: null,
    bucket: 'de',
    text: 'x',
    default_team: null,
    default_co_assignees: [],
    default_waiting_on: null,
    cat: null,
    sort_order: 0,
    ...over,
  } as TaskTemplate;
}

const TEMPLATES = [
  tpl({ id: 'a', text: 'Survey', sort_order: 2 }),
  tpl({ id: 'b', text: 'Arborist', sort_order: 1 }),
  tpl({ id: 'c', text: 'Seattle-only step', jurisdiction: 'Seattle', sort_order: 1 }),
  tpl({ id: 'd', text: 'Kirkland-only step', jurisdiction: 'Kirkland' }),
  tpl({ id: 'e', text: 'A BP task', permit_type: 'Building Permit' }),
];

describe('fix-609 §B1 — one rule for which templates apply', () => {
  it('★★★ Base rows apply ALONGSIDE the city\'s own rows; other cities and other types do not', () => {
    expect(applicableTemplates(TEMPLATES, 'ULS', 'Seattle').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(applicableTemplates(TEMPLATES, 'ULS', 'Kirkland').map((t) => t.id)).toEqual(['d', 'b', 'a']);
    expect(templateApplies(TEMPLATES[4]!, 'ULS', 'Seattle')).toBe(false);
  });

  it('★★ the order is sort_order, then text — the wizard\'s', () => {
    expect(compareTemplates({ sort_order: 1, text: 'b' }, { sort_order: 1, text: 'a' })).toBeGreaterThan(0);
    expect(compareTemplates({ sort_order: null as unknown as number, text: 'a' }, { sort_order: 1, text: 'a' })).toBeLessThan(0);
  });

  it('★★ the offer leaves out what the permit already has (the RPC\'s idempotency, client side)', () => {
    expect(templatesToOffer(TEMPLATES, 'ULS', 'Seattle', ['Survey']).map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('★★ the wizard default: all ticked; a backfill project, none', () => {
    expect([...defaultTickedIds(TEMPLATES.slice(0, 2), false)]).toEqual(['a', 'b']);
    expect(defaultTickedIds(TEMPLATES.slice(0, 2), true).size).toBe(0);
  });

  it('★★★ wizard Step 4 reads this module and no longer has its own copy', () => {
    const step4 = read('src/components/wizard/Step4TaskReview.tsx');
    expect(step4).toContain("import { applicableTemplates } from '../../lib/templateTasks';");
    expect(step4).toContain('applicableTemplates(tplQ.templates ?? [], p.type, value.juris)');
    expect(step4).not.toMatch(/function templateApplies\(/);
  });
});

// ---------------------------------------------------------------------------
// §B2/B3 — the offer, rendered
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  mayWrite: true,
  templates: [] as TaskTemplate[],
  tasks: [] as { text: string }[] | undefined,
  mutate: vi.fn(),
}));

vi.mock('../hooks/useMayWriteProject', () => ({ useMayWriteProject: () => h.mayWrite }));
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({ templates: h.templates, subtasks: [], byScope: new Map(), isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTaskTree', () => ({
  usePermitTaskTree: () => ({ data: h.tasks, isSuccess: h.tasks !== undefined }),
}));
vi.mock('../hooks/useAddTemplateTasks', () => ({
  useAddTemplateTasks: () => ({ mutate: h.mutate, isPending: false }),
}));

import TemplateTasksOffer from '../components/ProjectDetail/TemplateTasksOffer';

const PERMIT = { id: 42, type: 'ULS', project_id: 'p-1' };

beforeEach(() => {
  h.mayWrite = true;
  h.templates = TEMPLATES;
  h.tasks = [];
  h.mutate.mockReset();
});

function renderOffer(props: Partial<Parameters<typeof TemplateTasksOffer>[0]> = {}) {
  return render(<TemplateTasksOffer permit={PERMIT} juris="Seattle" testid="offer" {...props} />);
}

describe('fix-609 §B — "Add template tasks (N)"', () => {
  it('★★★ offers exactly the applicable templates, all ticked, and creates NOTHING until Add', () => {
    renderOffer();
    const open = screen.getByTestId('offer-open');
    expect(open.textContent).toBe('Add template tasks (3)');
    fireEvent.click(open);
    for (const id of ['a', 'b', 'c']) {
      expect((screen.getByTestId(`offer-tpl-${id}`) as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.queryByTestId('offer-tpl-d')).toBeNull(); // another city
    expect(screen.queryByTestId('offer-tpl-e')).toBeNull(); // another type
    expect(h.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('offer-tpl-c')); // untick one
    fireEvent.click(screen.getByTestId('offer-add'));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0]![0]).toEqual({ permitId: 42, templateIds: ['b', 'a'] });
  });

  it('★★ Cancel closes the list without writing', () => {
    renderOffer();
    fireEvent.click(screen.getByTestId('offer-open'));
    fireEvent.click(screen.getByTestId('offer-cancel'));
    expect(screen.queryByTestId('offer-list')).toBeNull();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('★★★ only to people who may edit the project', () => {
    h.mayWrite = false;
    renderOffer();
    expect(screen.queryByTestId('offer')).toBeNull();
  });

  it('★★★ only when N > 0', () => {
    h.tasks = [{ text: 'Survey' }, { text: 'Arborist' }, { text: 'Seattle-only step' }];
    renderOffer();
    expect(screen.queryByTestId('offer')).toBeNull();
    h.templates = [];
    h.tasks = [];
    renderOffer();
    expect(screen.queryByTestId('offer')).toBeNull();
  });

  it('★★ not before the permit\'s tasks have loaded (it would offer what is already there)', () => {
    h.tasks = undefined;
    renderOffer();
    expect(screen.queryByTestId('offer')).toBeNull();
  });

  it('★★ a backfill project starts with nothing ticked, and Add is disabled until one is', () => {
    renderOffer({ isBackfill: true });
    fireEvent.click(screen.getByTestId('offer-open'));
    expect((screen.getByTestId('offer-tpl-a') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('offer-add') as HTMLButtonElement).disabled).toBe(true);
  });

  it('★★ "Not now" dismisses the post-save row offer without writing', () => {
    const onDismiss = vi.fn();
    renderOffer({ onDismiss });
    fireEvent.click(screen.getByTestId('offer-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('★ a permit with no type is offered nothing', () => {
    renderOffer({ permit: { ...PERMIT, type: null } });
    expect(screen.queryByTestId('offer')).toBeNull();
  });
});

describe('fix-609 §B2 — the offer after a Project Details save', () => {
  it('★★★ the save marks the permits it ADDED (ids the form did not already have)', () => {
    const form = read('src/hooks/useProjectDetailsForm.ts');
    expect(form).toMatch(
      /const known = new Set\(\s+form\.permits\.map\(\(p\) => p\.id\)\.filter\(\(id\): id is number => id != null\),\s+\);\s+markPermitsAdded\(\s+\(result\.permits \?\? \[\]\)\.map\(\(p\) => p\.id\)\.filter\(\(id\) => !known\.has\(id\)\),\s+\);/,
    );
    // …only after the conflict branch has returned
    expect(form.indexOf('markPermitsAdded(\n')).toBeGreaterThan(form.indexOf('if (result.conflict) {'));
  });

  it('★★ the project page row shows the offer for a just-added permit, with "Not now"', () => {
    const table = read('src/components/ProjectDetail/ScheduleHealthTable.tsx');
    expect(table).toMatch(/\{justAdded && \(\s+<TemplateTasksOffer[\s\S]{0,200}onDismiss=\{\(\) => dismissAdded\(permit\.id\)\}/);
  });

  it('★★ the store adds and dismisses', () => {
    useAddedPermitsStore.getState().markAdded([7, 8]);
    expect(useAddedPermitsStore.getState().ids.has(7)).toBe(true);
    useAddedPermitsStore.getState().dismiss(7);
    expect(useAddedPermitsStore.getState().ids.has(7)).toBe(false);
    expect(useAddedPermitsStore.getState().ids.has(8)).toBe(true);
  });
});

describe('fix-609 §B3 — the empty Tasks panel', () => {
  const pd = read('src/components/ProjectDetail/PermitDetailV2.tsx');

  it('★★★ offered on a permit with zero tasks, once its tasks have loaded', () => {
    expect(pd).toMatch(/\{treeQ\.isSuccess && tasks\.length === 0 && templateOffer && \(/);
  });

  it('★★★ never on an effectively issued permit (fix-221: done is done)', () => {
    expect(pd).toMatch(/project && permit\.type && !isEffectivelyIssued\(permit\)\s+\?/);
  });
});

describe('fix-609 §B5 — tasks appear everywhere without a reload', () => {
  it('★★★ the add invalidates the permit_tasks prefix (tree, My Tasks, Waiting On) and the task neighbours', () => {
    const hook = read('src/hooks/useAddTemplateTasks.ts');
    for (const k of ['permitTasksAll', 'dashboardPermitCardsAll', 'taskProvenanceAll']) {
      expect(hook).toContain(`queryKey: queryKeys.${k}`);
    }
  });
});

describe('fix-609 §C — the Task Templates copy says what the code does', () => {
  it('★★★ Base applies alongside, not "where no specific override exists"', () => {
    const tab = read('src/components/Settings/AdminPermitsTab.tsx');
    expect(tab).not.toContain('where no specific override exists');
    expect(tab).toContain('"Base" tasks apply in');
    expect(tab).toContain("alongside that jurisdiction's own tasks.");
  });
});
