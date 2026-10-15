// ===========================================================================
// ★★★ fix-677 (P-356) — `node:fs` for the tests that scan the source tree,
//     served from this run's snapshot
// ===========================================================================
//
// DROP-IN, ON PURPOSE. Every scanning test keeps its own walk — its own
// excluded folders, its own extension filter, its own order — and only its
// import line changes from `'node:fs'` to this file. So each test scans
// EXACTLY the files it scanned before and checks exactly the same rule; the
// only difference is that a directory listing or a file's text comes from one
// JSON file read once, instead of ~700 opens per walk. See
// `src/test/sourceSnapshot.ts` for the measurements.
//
// What is served from the snapshot: paths under `src/` and `migrations/`.
// Everything else — another folder, a binary, a read with no encoding — goes
// to the real `fs`, unchanged. With no snapshot (a run without the config's
// global setup) every call goes to the real `fs`.
//
// ★★ `statSync` answers only `isDirectory()` / `isFile()` from the snapshot —
//    the only questions any scanning test asks. Any other property THROWS,
//    so a future test that needs `size` or `mtime` fails loudly instead of
//    reading `undefined` and passing for the wrong reason.
//
// `SourceTreeIndexFix677` proves the snapshot equals a fresh walk of the
// real tree.

import * as fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';
import { snapshotKey, type SourceSnapshot } from '../../test/sourceSnapshot';

let snap: SourceSnapshot | null | undefined;

function snapshot(): SourceSnapshot | null {
  if (snap !== undefined) return snap;
  let file: string | undefined;
  try {
    file = inject('sourceSnapshotPath');
  } catch {
    file = undefined;
  }
  snap = file ? (JSON.parse(fs.readFileSync(file, 'utf8')) as SourceSnapshot) : null;
  return snap;
}

/** `'snapshot'` when reads are being served from this run's capture. */
export function sourceTreeMode(): 'snapshot' | 'fs' {
  return snapshot() ? 'snapshot' : 'fs';
}

/** The snapshot's key for `p` if `p` lies under one of its roots, else null. */
function covered(p: fs.PathLike): { s: SourceSnapshot; key: string } | null {
  const s = snapshot();
  if (!s || typeof p !== 'string') return null;
  const key = snapshotKey(p);
  for (const root of s.roots) {
    if (key === root || key.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) {
      return { s, key };
    }
  }
  return null;
}

function enoent(syscall: string, p: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`) as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  err.errno = -2;
  err.syscall = syscall;
  err.path = p;
  return err;
}

function encodingOf(opts: unknown): string | null {
  if (typeof opts === 'string') return opts;
  if (opts && typeof opts === 'object' && 'encoding' in opts) {
    const e = (opts as { encoding?: unknown }).encoding;
    return typeof e === 'string' ? e : null;
  }
  return null;
}

export function readFileSync(
  p: fs.PathOrFileDescriptor,
  opts: BufferEncoding | { encoding: BufferEncoding; flag?: string },
): string;
export function readFileSync(p: fs.PathOrFileDescriptor, opts?: { flag?: string } | null): Buffer;
export function readFileSync(p: fs.PathOrFileDescriptor, opts?: unknown): string | Buffer {
  const enc = encodingOf(opts);
  const hit = typeof p === 'string' && enc && /^utf-?8$/i.test(enc) ? covered(p) : null;
  if (hit) {
    if (!(hit.key in hit.s.files)) {
      if (hit.key in hit.s.dirs) {
        // Same failure the real call gives for a directory.
        return fs.readFileSync(p, opts as never);
      }
      throw enoent('open', p as string);
    }
    const text = hit.s.files[hit.key];
    if (text !== null) return text;
  }
  return fs.readFileSync(p, opts as never) as string | Buffer;
}

interface SnapshotDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export function readdirSync(p: fs.PathLike, opts: { withFileTypes: true }): SnapshotDirent[];
export function readdirSync(p: fs.PathLike, opts?: BufferEncoding | { withFileTypes?: false } | null): string[];
export function readdirSync(p: fs.PathLike, opts?: unknown): string[] | SnapshotDirent[] {
  const hit = covered(p);
  if (!hit) return fs.readdirSync(p, opts as never) as unknown as string[];
  const entries = hit.s.dirs[hit.key];
  if (!entries) {
    if (hit.key in hit.s.files) return fs.readdirSync(p, opts as never) as unknown as string[];
    throw enoent('scandir', p as string);
  }
  const withTypes =
    !!opts && typeof opts === 'object' && (opts as { withFileTypes?: boolean }).withFileTypes;
  if (!withTypes) return entries.map(([name]) => name);
  return entries.map(([name, dir]) => ({
    name,
    isDirectory: () => dir,
    isFile: () => !dir,
    isSymbolicLink: () => false,
  }));
}

export function statSync(p: fs.PathLike, opts?: unknown): fs.Stats {
  const hit = covered(p);
  if (!hit) return fs.statSync(p, opts as never) as fs.Stats;
  const isDir = hit.key in hit.s.dirs;
  const isFile = hit.key in hit.s.files;
  if (!isDir && !isFile) throw enoent('stat', p as string);
  const answers: Record<string, unknown> = {
    isDirectory: () => isDir,
    isFile: () => isFile,
  };
  return new Proxy(answers, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      throw new Error(
        `fix-677 sourceTree: statSync(...).${String(prop)} is not served from the snapshot — import statSync from 'node:fs' for this call`,
      );
    },
  }) as unknown as fs.Stats;
}

export function existsSync(p: fs.PathLike): boolean {
  const hit = covered(p);
  if (!hit) return fs.existsSync(p);
  return hit.key in hit.s.dirs || hit.key in hit.s.files;
}

// ---------------------------------------------------------------------------
// ★★★ The `import.meta.glob(..., { query: '?raw' })` scans
// ---------------------------------------------------------------------------
//
// Fourteen files read the tree as text through Vite instead of `fs`, and that
// path is the dearer one: every matched file goes through Vite's transform
// pipeline as its own `?raw` module (fix-326 and fix-369 each needed a 60 s
// budget, and still took 13–30 s under a full run).
//
// ★★ THE FILE SET STAYS VITE'S. Callers pass a PLAIN lazy glob of the very same
//    pattern — `rawSources(import.meta.glob('../**/*.{ts,tsx}'))` — whose keys
//    are computed by Vite exactly as before and whose loaders are never
//    called. Only each key's TEXT comes from the snapshot. The keys are what
//    the tests print and compare, so they are kept verbatim.

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
/** Glob keys are relative to the importing test, and every caller lives in
 *  `src/__tests__` — one level above this file. */
const TESTS_DIR = resolve(HELPERS_DIR, '..');

function globKeyPath(key: string): string {
  if (!key.startsWith('./') && !key.startsWith('../')) {
    throw new Error(`fix-677 sourceTree: unexpected glob key ${key}`);
  }
  return resolve(TESTS_DIR, key);
}

/** The eager `{ query: '?raw', import: 'default', eager: true }` shape. */
export function rawSources(glob: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(glob)) out[key] = readFileSync(globKeyPath(key), 'utf8');
  return out;
}

/** The lazy `{ query: '?raw', import: 'default' }` shape: same keys, a loader each. */
export function rawSourceLoaders(
  glob: Record<string, unknown>,
): Record<string, () => Promise<string>> {
  const out: Record<string, () => Promise<string>> = {};
  for (const key of Object.keys(glob)) {
    out[key] = () => Promise.resolve(readFileSync(globKeyPath(key), 'utf8'));
  }
  return out;
}
