// ===========================================================================
// ★★★ fix-677 (P-356) — THE GUARD: the snapshot IS the tree
// ===========================================================================
//
// 36 scanning tests now read `src/` and `migrations/` through
// `helpers/sourceTree`, served from one snapshot taken in global setup. That
// is only safe if the snapshot holds EXACTLY the files a real walk finds, with
// the same text — a snapshot that silently dropped a folder would make every
// "nothing in src does X" test pass for the wrong reason. So this file walks
// the real tree with the real `fs` and compares.

import { describe, it, expect } from 'vitest';
import * as realFs from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
  existsSync,
  rawSourceLoaders,
  rawSources,
  readFileSync,
  readdirSync,
  sourceTreeMode,
  statSync,
} from './helpers/sourceTree';
import autoReloadRaw from '../lib/autoReload.ts?raw';
import siblingRaw from './noGuessedSleeps.test.ts?raw';
import { EXCLUDED_DIRS, SNAPSHOT_ROOTS } from '../test/sourceSnapshot';

const ROOT = process.cwd();

/** Every file under `dir`, relative to the repo, through the given fs. */
function walk(
  dir: string,
  rd: (d: string, o: { withFileTypes: true }) => Array<{ name: string; isDirectory(): boolean }>,
  out: string[] = [],
): string[] {
  for (const ent of rd(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, rd, out);
    else out.push(relative(ROOT, full).split('\\').join('/'));
  }
  return out;
}

const viaReal = (root: string) =>
  walk(resolve(ROOT, root), (d, o) => realFs.readdirSync(d, o)).sort();
const viaSnapshot = (root: string) =>
  walk(resolve(ROOT, root), (d, o) => readdirSync(d, o) as never).sort();

describe('fix-677 — the source snapshot covers the same files as a real walk', () => {
  it('★★★ reads are actually being served from the snapshot in this run', () => {
    // Otherwise the whole ticket has quietly stopped working and every
    // scanning test is back to ~700 opens per walk.
    expect(sourceTreeMode()).toBe('snapshot');
  });

  it.each(SNAPSHOT_ROOTS)('★★★ %s/: the same file set, the same count', (root) => {
    const real = viaReal(root);
    const snap = viaSnapshot(root);
    expect(snap.length).toBe(real.length);
    expect(snap).toEqual(real);
  });

  it('★★★ src/ holds what it should — a floor and known paths', () => {
    const files = viaSnapshot('src');
    expect(files.length).toBeGreaterThan(1000);
    for (const known of [
      'src/lib/autoReload.ts',
      'src/components/NewBuildNotice.tsx',
      'src/__tests__/SourceTreeIndexFix677.test.ts',
      'src/__tests__/helpers/sourceTree.ts',
      'src/test/setup.ts',
    ]) {
      expect(files).toContain(known);
    }
    expect(viaSnapshot('migrations')).toContain(
      'migrations/fix_673_auto_reload_blocked_reason.sql',
    );
  });

  it('★★ the excluded folder names do not exist under the roots, so leaving them out changes nothing', () => {
    const dirsNamed = (dir: string, out: string[] = []): string[] => {
      for (const ent of realFs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (EXCLUDED_DIRS.has(ent.name)) out.push(join(dir, ent.name));
        else dirsNamed(join(dir, ent.name), out);
      }
      return out;
    };
    for (const root of SNAPSHOT_ROOTS) expect(dirsNamed(resolve(ROOT, root))).toEqual([]);
  });

  it('★★★ the text is the real text — a sample of files, byte for byte', () => {
    for (const rel of [
      'src/lib/autoReload.ts',
      'src/__tests__/SourceTreeIndexFix677.test.ts',
      'migrations/fix_673_auto_reload_blocked_reason.sql',
    ]) {
      const abs = resolve(ROOT, rel);
      expect(readFileSync(abs, 'utf8')).toBe(realFs.readFileSync(abs, 'utf8'));
      // A relative path, as several scanning tests spell it.
      expect(readFileSync(rel, 'utf8')).toBe(realFs.readFileSync(abs, 'utf8'));
    }
  });

  it('★★ the misses behave like fs: a missing path throws ENOENT, and existsSync agrees', () => {
    const missing = resolve(ROOT, 'src/lib/unitWorkScope.ts');
    expect(realFs.existsSync(missing)).toBe(false);
    expect(() => statSync(missing)).toThrow(/ENOENT/);
    expect(() => readFileSync(missing, 'utf8')).toThrow(/ENOENT/);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/lib/autoReload.ts'))).toBe(true);
    expect(statSync(resolve(ROOT, 'src/lib')).isDirectory()).toBe(true);
    expect(statSync(resolve(ROOT, 'src/lib/autoReload.ts')).isDirectory()).toBe(false);
  });

  it('★★ a stat property the snapshot does not hold throws instead of reading undefined', () => {
    const st = statSync(resolve(ROOT, 'src/lib/autoReload.ts')) as unknown as Record<string, unknown>;
    expect(() => st.size).toThrow(/not served from the snapshot/);
  });

  it('★ outside the roots, and a read with no encoding, go to the real fs', () => {
    expect(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).toBe(
      realFs.readFileSync(resolve(ROOT, 'package.json'), 'utf8'),
    );
    expect(Buffer.isBuffer(readFileSync(resolve(ROOT, 'src/lib/autoReload.ts')))).toBe(true);
  });
});

describe('fix-677 — the ?raw glob scans: Vite picks the files, the snapshot supplies the text', () => {
  // ★ A plain lazy glob: Vite computes the keys, nothing is loaded.
  const glob = import.meta.glob('../**/*.{ts,tsx}');

  it('★★★ the keys are exactly the glob keys, and they are every .ts/.tsx file under src/', () => {
    const raw = rawSources(glob);
    expect(Object.keys(raw)).toEqual(Object.keys(glob));
    const fromKeys = Object.keys(glob)
      .map((k) => relative(ROOT, resolve(ROOT, 'src/__tests__', k)).split('\\').join('/'))
      .sort();
    // ★ Vite's glob never matches the file that calls it, so the walk is
    //   compared without this one — the same set every migrated test saw.
    const fromWalk = viaReal('src')
      .filter((p) => /\.tsx?$/.test(p))
      .filter((p) => p !== 'src/__tests__/SourceTreeIndexFix677.test.ts');
    expect(fromKeys).toEqual(fromWalk);
  });

  it('★★★ the text is what a real `?raw` import gives', async () => {
    const raw = rawSources(glob);
    expect(raw['../lib/autoReload.ts']).toBe(autoReloadRaw);
    expect(raw['./noGuessedSleeps.test.ts']).toBe(siblingRaw);
    const loaders = rawSourceLoaders(glob);
    expect(await loaders['../lib/autoReload.ts']()).toBe(autoReloadRaw);
  });
});
