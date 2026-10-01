import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// ===========================================================================
// fix-612 (P-307) — one admin source everywhere: is_admin() reads tenant_memberships
// ===========================================================================
//
// fix-608 made `tenant_memberships.role` the admin source for Settings writes
// and Add person, and named `public.is_admin()` (still reading `profiles.role`)
// as the second source it left. Seven RLS policies and three functions call
// is_admin(), so changing its BODY moves all ten at once — and the body
// delegates to fix-608's helper so the rule exists exactly once.
//
// No live DB in CI. The file is asserted here; the behaviour was measured on
// prod read-only (every login evaluated under its own JWT claims: 37 logins,
// 36 unchanged, the one difference is Gena, false → true). See the PR.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n?/g, '\n');
const RAW = read('migrations/fix_612_is_admin_reads_memberships.sql');

/** Code only — SQL `--` comments stripped, so the header's quotation of the
 *  OLD body cannot satisfy or trip anything below. */
const SQL = RAW.split('\n').map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l)).join('\n');

function isAdminDefinition(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.is_admin()');
  expect(start, 'is_admin() is (re)defined').toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end + '$function$;'.length);
}

describe('fix-612 §A — is_admin() delegates to the one rule', () => {
  const def = isAdminDefinition(SQL);

  it('★★★ the body IS a call to fix-608\'s bp_is_admin_anywhere() — not a second copy of the rule', () => {
    const body = def.slice(def.indexOf('AS $function$') + 'AS $function$'.length, def.lastIndexOf('$function$'));
    expect(body.trim()).toBe('SELECT public.bp_is_admin_anywhere();');
    expect(def).not.toMatch(/profiles/i);
    expect(def).not.toMatch(/tenant_memberships/i); // the rule lives in the helper, once
  });

  it('★★★ same signature, LANGUAGE sql, STABLE SECURITY DEFINER, search_path public', () => {
    expect(def).toMatch(/public\.is_admin\(\)\s+RETURNS boolean\s+LANGUAGE sql\s+STABLE SECURITY DEFINER\s+SET search_path TO 'public'/);
  });

  it('★★★ authenticated keeps EXECUTE — is_admin() runs inside RLS as the caller', () => {
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;');
    expect(SQL).not.toMatch(/REVOKE[^;]*is_admin\(\)[^;]*\bauthenticated\b/i);
    expect(SQL).not.toMatch(/GRANT[^;]*\banon\b/i);
    // …and the post-condition checks it on the live database
    expect(SQL).toContain("has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')");
  });

  it('★★ it refuses to run against a body other than the one read on 2026-10-01', () => {
    // The guard compares an md5 of the whitespace-normalised live body; that
    // hash IS the old body quoted in the header (computed here, not trusted).
    const OLD_NORMALISED =
      " select exists ( select 1 from public.profiles where id = auth.uid() and role = 'admin' ); ";
    const hash = createHash('md5').update(OLD_NORMALISED).digest('hex');
    expect(hash).toBe('67709f28530ccbebd037f7915a9efd9d');
    expect(SQL).toContain(`ELSIF md5(regexp_replace(v_src, '\\s+', ' ', 'g')) <> '${hash}' THEN`);
    expect(SQL).toContain("to_regprocedure('public.bp_is_admin_anywhere()') IS NULL");
  });

  it('★★ one transaction, and it asserts its own change landed', () => {
    expect(SQL.trim().startsWith('BEGIN;')).toBe(true);
    expect(SQL.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(SQL).toContain("does not delegate to bp_is_admin_anywhere");
  });
});

describe('fix-612 §B — reading your own profile is untouched', () => {
  it('★★★ no policy is created, altered or dropped — all ten callers follow the function', () => {
    expect(SQL).not.toMatch(/\b(CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(SQL).not.toMatch(/\bALTER\s+TABLE\b/i);
    // the only function this file defines is is_admin()
    expect(SQL.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });

  it('★★★ profiles_read_own is recorded exactly as it stands on prod: own row, OR an admin', () => {
    // The policy is not in this repo's migrations (prod is ahead); its live
    // text is recorded in the header and must say what the PR says it says.
    expect(RAW).toContain('public.profiles.profiles_read_own        SELECT  auth.uid() = id OR is_admin()');
  });

  it('★★ the helper it delegates to reads tenant_memberships (fix-608)', () => {
    const f608 = read('migrations/fix_608_settings_writes_admin_check.sql');
    const at = f608.indexOf('FUNCTION public.bp_is_admin_anywhere()');
    expect(at).toBeGreaterThan(0);
    const helper = f608.slice(at, f608.indexOf('$function$;', at));
    expect(helper).toMatch(/FROM public\.tenant_memberships\s+WHERE user_id = auth\.uid\(\)\s+AND role = 'admin'/);
  });
});

// ---------------------------------------------------------------------------
// §C — the sweep, extended past src/ (fix-608's test covers src/)
// ---------------------------------------------------------------------------

function codeOnly(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/--.*$/, ''))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') walk(full, out);
    } else if (/\.(tsx?|sql)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The fix-608 gate shape: profiles … role … 'admin' (or "admin"). */
const PROFILES_ROLE_GATE = /profiles[\s\S]{0,80}?\brole\b[\s\S]{0,40}?['"]admin['"]/;

function fixNumber(f: string): number {
  const m = /fix_(\d+)/.exec(f);
  return m ? Number(m[1]) : -1;
}

describe('fix-612 §C — nothing reads profiles.role as an admin gate', () => {
  it('★★★ no migration written after fix-608 reads profiles.role as a gate', () => {
    const offenders = readdirSync(resolve(ROOT, 'migrations'))
      .filter((f) => f.endsWith('.sql') && fixNumber(f) >= 608)
      .filter((f) => PROFILES_ROLE_GATE.test(codeOnly(read(`migrations/${f}`))));
    expect(offenders).toEqual([]);
  });

  it('★★★ no Edge Function reads profiles.role as a gate', () => {
    const offenders = walk(resolve(ROOT, 'supabase/functions'))
      .filter((f) => PROFILES_ROLE_GATE.test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('★★★ PROOF — the sweep catches the old is_admin() body if it came back', () => {
    const OLD = `CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $f$
      select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      ); $f$;`;
    expect(PROFILES_ROLE_GATE.test(codeOnly(OLD))).toBe(true);
    // …and this file's header, which QUOTES that body in comments, does not count
    expect(PROFILES_ROLE_GATE.test(codeOnly(RAW))).toBe(false);
  });
});
