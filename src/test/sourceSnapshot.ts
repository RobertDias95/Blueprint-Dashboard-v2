// ===========================================================================
// ★★★ fix-677 (P-356) — ONE READ OF THE SOURCE TREE PER RUN, NOT ONE PER TEST
// ===========================================================================
//
// 36 test files walk `src/` (and `migrations/`) as text to assert a rule —
// "nothing writes X", "only Y imports Z". Each walk is ~700 file opens; alone a
// walk takes ~0.5 s, and under a full local run (11 workers, a laptop short on
// memory) the same walk took 5–8.5 s and tripped the 5 s test timeout. §0
// measured the cost as the WALK (file opens), not the regexes: stripping
// comments from every non-test file takes 6 ms; reading one snapshot of the
// whole tree takes ~75 ms.
//
// ★★★ AND A PER-WORKER CACHE COULD NOT HAVE FIXED IT. Measured: vitest runs
//     every test FILE in a fresh process here (4 files, `--maxWorkers=1` →
//     4 pids, `globalThis` reset each time). A module-level memo would only
//     ever be shared within one file. So the tree is captured ONCE, in
//     `globalSetup`, into one JSON file, and every scanning file reads that.
//
// This module is the single definition of WHAT is captured. The global setup
// writes it; `src/__tests__/helpers/sourceTree.ts` serves it; and
// `SourceTreeIndexFix677` checks it against a fresh walk of the real tree.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/** The trees the scanning tests walk, relative to the repo root. */
export const SNAPSHOT_ROOTS = ['src', 'migrations'] as const;

/**
 * Directory names never descended into. ★ None of them exists under the
 * roots today (the guard asserts so), which is what makes leaving them out
 * change nothing a test can see. They are listed so a stray `dist/` or
 * coverage output dropped into `src/` can never balloon the snapshot.
 */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
]);

/** Files LISTED in their directory but whose bytes are not captured — the
 *  helper hands those reads to the real `fs`. */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.mp4', '.webm', '.mov', '.mp3', '.wav',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz',
]);

export interface SourceSnapshot {
  /** Absolute, normalised roots — see {@link snapshotKey}. */
  roots: string[];
  /** Directory → its entries, in the order `fs.readdirSync` returned them. */
  dirs: Record<string, Array<[name: string, isDirectory: boolean]>>;
  /** File → its UTF-8 text, or `null` for a binary the helper reads for real. */
  files: Record<string, string | null>;
}

/** ★ Windows paths are case-insensitive and `resolve()` normalises slashes,
 *   so one key per file whatever spelling a test built its path with. */
export function snapshotKey(p: string): string {
  const abs = resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

export function buildSourceSnapshot(repoRoot: string): SourceSnapshot {
  const snap: SourceSnapshot = { roots: [], dirs: {}, files: {} };
  const walk = (dir: string) => {
    const entries: Array<[string, boolean]> = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory() && EXCLUDED_DIRS.has(ent.name)) continue;
      const full = join(dir, ent.name);
      entries.push([ent.name, ent.isDirectory()]);
      if (ent.isDirectory()) walk(full);
      else {
        snap.files[snapshotKey(full)] = BINARY_EXT.has(extname(ent.name).toLowerCase())
          ? null
          : readFileSync(full, 'utf8');
      }
    }
    snap.dirs[snapshotKey(dir)] = entries;
  };
  for (const r of SNAPSHOT_ROOTS) {
    const abs = resolve(repoRoot, r);
    snap.roots.push(snapshotKey(abs));
    walk(abs);
  }
  return snap;
}

export function writeSourceSnapshot(repoRoot: string, outFile: string): void {
  writeFileSync(outFile, JSON.stringify(buildSourceSnapshot(repoRoot)));
}
