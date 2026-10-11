import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  customTagTarget,
  mentionTargets,
  resolveTagUserIds,
  type MentionTag,
  type MentionTarget,
} from '../lib/mentionTags';
import { projectInternalTeam, projectTagNames } from '../lib/projectTeam';
import { buildNotice } from '../lib/crNotice';

// ===========================================================================
// ★★★ fix-643b (P-338 addendum) — @Corrections becomes a SMART tag
// ===========================================================================
//
// Bobby, 2026-10-12: *"We could just do @corrections in any chat, and the rule
// would follow any chat … if I'm in Fisk or if I'm in Amadi, it will be able
// to distinguish that and then @ the correct people."*
//
// ★ The SQL ran on prod inside BEGIN … ROLLBACK on 2026-10-12. Corrections tag
//   (members Dave, Lucas, Gena, Bobby, Brittani) with the flag on resolved to:
//     10431 SE 19th St (26 110231 BS, DA Fisk) → the five + Miles, Fisk
//     1515 MLK Jr Way (7113300-CN, DA Ahmadi)  → the five + Briana, Ahmadi
//     no project / flag off                     → the five
//   (Brittani, DM on both, counted once.) The notice on 7113300-CN round 3
//   carried one "@Corrections" chip and queued 7 emails.

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
// ★ CRLF-safe: `.` does not match `\r`, so a Windows checkout would strip nothing.
const stripSql = (t: string) => t.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
const sql = stripSql(repo('migrations/fix_643b_smart_corrections_tag.sql'));

const FIXED = ['u-dave', 'u-lucas', 'u-gena', 'u-bobby', 'u-brittani'];
const FISK_TEAM = ['u-miles', 'u-brittani', 'u-fisk'];      // ENT · DM · DA
const AHMADI_TEAM = ['u-briana', 'u-brittani', 'u-ahmadi'];

const CORRECTIONS: MentionTag = {
  id: 'tag-c', name: 'Corrections', member_ids: FIXED, include_project_team: true,
};

describe('fix-643b: who @Corrections reaches', () => {
  it('★★★ two project chats: the same five fixed people plus EACH project\'s own ENT/DM/DA', () => {
    expect(resolveTagUserIds(FIXED, true, FISK_TEAM)).toEqual([...FIXED, 'u-miles', 'u-fisk']);
    expect(resolveTagUserIds(FIXED, true, AHMADI_TEAM)).toEqual([...FIXED, 'u-briana', 'u-ahmadi']);
  });

  it('★★ someone both fixed and on the project is counted once', () => {
    const r = resolveTagUserIds(FIXED, true, FISK_TEAM);
    expect(r.filter((id) => id === 'u-brittani')).toHaveLength(1);
  });

  it('★★ no project → fixed only', () => {
    expect(resolveTagUserIds(FIXED, true, null)).toEqual(FIXED);
  });

  it('★★ flag off → fixed only', () => {
    expect(resolveTagUserIds(FIXED, false, FISK_TEAM)).toEqual(FIXED);
  });

  it('★★★ the composer stores what the DATABASE resolved for this chat', () => {
    const fromDb = ['u-x', 'u-y'];
    expect(customTagTarget(CORRECTIONS, { resolved: fromDb, projectTeamIds: FISK_TEAM }).userIds).toEqual(fromDb);
    // …and the chip still reads @Corrections.
    expect(customTagTarget(CORRECTIONS, { resolved: fromDb }).name).toBe('Corrections');
  });

  it('★★ before the database answers, a smart tag still reaches this chat\'s @project people', () => {
    const projectTag: MentionTarget = { name: 'project', userIds: AHMADI_TEAM, kind: 'smart' };
    const targets = mentionTargets({ people: [], tags: [CORRECTIONS], projectTag });
    const t = targets.find((x) => 'userIds' in x && x.name === 'Corrections') as MentionTarget;
    expect(t.userIds).toEqual([...FIXED, 'u-briana', 'u-ahmadi']);
    expect(t.hint).toContain("this project's team");
  });

  it('★ resolvedTags wins over the fallback, per tag id', () => {
    const projectTag: MentionTarget = { name: 'project', userIds: AHMADI_TEAM, kind: 'smart' };
    const targets = mentionTargets({
      people: [], tags: [CORRECTIONS], projectTag, resolvedTags: new Map([['tag-c', ['u-only']]]),
    });
    expect((targets.find((x) => 'userIds' in x && x.name === 'Corrections') as MentionTarget).userIds).toEqual(['u-only']);
  });

  it('★ a plain tag is unchanged', () => {
    const plain: MentionTag = { id: 'l', name: 'Leadership', member_ids: ['a', 'b'] };
    expect(customTagTarget(plain, { projectTeamIds: FISK_TEAM }).userIds).toEqual(['a', 'b']);
    expect(customTagTarget(plain).hint).toBe('2 people');
  });
});

describe('fix-643b: the resolver in SQL', () => {
  it('members first, then the project team when smart and the project is the tag\'s tenant', () => {
    expect(sql).toMatch(/IF v_smart AND p_project_id IS NOT NULL\s+AND EXISTS \(SELECT 1 FROM public\.projects p\s+WHERE p\.id = p_project_id AND p\.tenant_id = v_tenant\) THEN/);
    expect(sql).toMatch(/IF NOT \(v_u = ANY \(v_ids\)\) THEN v_ids := v_ids \|\| v_u; END IF;/);
  });

  it('★★ a signed-in caller only resolves its own tenant\'s tags', () => {
    expect(sql).toMatch(/IF auth\.uid\(\) IS NOT NULL AND NOT \(v_tenant = ANY \(public\.auth_tenant_ids\(\)\)\) THEN\s+RETURN '\{\}';/);
  });

  it('★★ names resolve to a login the fix-634 way', () => {
    expect(sql).toMatch(/public\.bp_notify_person_for_name\(r\.tenant_id, r\.name\)/);
  });

  it('★★★ the notice uses the resolver, and shows ONE @Corrections chip', () => {
    expect(sql).toMatch(/v_ids := public\.bp_resolve_mention_tag\(v_tag_id, v_project\);/);
    expect(sql).toMatch(/v_body := v_body \|\| chr\(10\) \|\| '@' \|\| btrim\(v_tag\);/);
    const n = buildNotice({
      permitNum: '7113300-CN', permitType: 'Building Permit', round: 3, corrIssued: '2026-10-11',
      team: [
        { role: 'ENT', name: 'Briana', userId: 'u-briana' },
        { role: 'DM', name: 'Brittani', userId: 'u-brittani' },
        { role: 'DA', name: 'Ahmadi', userId: 'u-ahmadi' },
      ],
      tag: { name: 'Corrections', memberIds: FIXED, includeProjectTeam: true },
    });
    expect(n.body.split('\n')[1]).toBe('@Corrections');
    expect(n.mentions).toEqual(resolveTagUserIds(FIXED, true, AHMADI_TEAM));
    expect(n.mentions).toHaveLength(7);
  });

  it('★★ upsert: one signature (DROP, then CREATE), and NULL keeps the flag', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.bp_upsert_mention_tag\(uuid, text, uuid\[\]\);/);
    expect(sql).toMatch(/p_include_project_team boolean DEFAULT NULL/);
    expect(sql).toMatch(/include_project_team = COALESCE\(p_include_project_team, mention_tags\.include_project_team\)/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.bp_list_mention_tags\(\);/);
  });

  it('★ the one data write is the Corrections flag — members untouched', () => {
    expect(sql).toMatch(/UPDATE public\.mention_tags\s+SET include_project_team = true\s+WHERE lower\(btrim\(name\)\) = 'corrections'/);
    // Outside every function body, the only row-writing statement is that one.
    const topLevel = sql.slice(sql.lastIndexOf('$function$;'));
    expect((topLevel.match(/^\s*(UPDATE|INSERT|DELETE)\b.*$/gim) ?? []).map((l) => l.trim()))
      .toEqual(['UPDATE public.mention_tags']);
  });
});

// ---------------------------------------------------------------------------
// ★★★ The TWIN: `@project` in TypeScript ⇄ bp_project_team_names in SQL
// ---------------------------------------------------------------------------
describe('fix-643b: @project is unchanged, and SQL says the same thing', () => {
  const project = {
    acq_lead: 'Jason', entitlement_lead: 'Briana', design_manager: 'Derry',
    schematic_designer: ['Ana'], construction_admin: 'Steve',
  };

  it('★★★ @project = ENT · DM · DA — never ACQ, SD or CA (fix-503, unchanged)', () => {
    expect(projectTagNames(projectInternalTeam(project, null))).toEqual(['Briana', 'Derry']);
    expect(projectTagNames(projectInternalTeam(project, { ent_lead: 'Miles', dm: 'Brittani', da: 'Fisk' })))
      .toEqual(['Miles', 'Brittani', 'Fisk']);
  });

  it('★★★ the same precedence in SQL: the permit overrides ENT/DM, DA comes only from the permit', () => {
    expect(sql).toMatch(/COALESCE\(b\.ent_lead, pr\.entitlement_lead\)/);
    expect(sql).toMatch(/COALESCE\(b\.dm, pr\.design_manager\)/);
    expect(sql).toMatch(/SELECT 3, 'DA', b\.da, pr\.tenant_id/);
    expect(sql).not.toMatch(/acq_lead|schematic_designer|construction_admin/);
    // TS: the same three, the same order.
    expect(repo('src/lib/projectTeam.ts')).toMatch(/ent: bp\?\.ent_lead \?\? project\.entitlement_lead \?\? null/);
    expect(repo('src/lib/projectTeam.ts')).toMatch(/dm: bp\?\.dm \?\? project\.design_manager \?\? null/);
    expect(repo('src/lib/projectTeam.ts')).toMatch(/da: bp\?\.da \?\? null/);
    expect(repo('src/lib/projectTeam.ts')).toMatch(/projectTeamNames\(\{ \.\.\.team, sd: \[\], ca: null, acq: null \}\)/);
  });

  it('★★★ the same PERMIT: first Building Permit by id, else first permit by id', () => {
    expect(sql).toMatch(/ORDER BY \(pm\.type = 'Building Permit'\) DESC, pm\.id\s+LIMIT 1/);
    expect(repo('src/components/ProjectDetail/ProjectChatModal.tsx'))
      .toMatch(/permits\.find\(\(p\) => p\.type === 'Building Permit'\) \?\?\s+permits\[0\] \?\?\s+null/);
    expect(repo('src/hooks/usePermitsByProject.ts')).toMatch(/\.order\('id', \{ ascending: true \}\)/);
  });
});
