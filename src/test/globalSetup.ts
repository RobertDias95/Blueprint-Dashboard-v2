// ★★★ fix-677 (P-356): capture the source tree ONCE per run for the tests that
//     scan it as text. See `./sourceSnapshot.ts` for why this cannot be a
//     per-worker cache. Runs in the main vitest process, before any worker.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { writeSourceSnapshot } from './sourceSnapshot';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Absolute path of this run's source snapshot (fix-677). */
    sourceSnapshotPath: string;
  }
}

export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'bp-source-snapshot-'));
  const file = join(dir, 'snapshot.json');
  const root = project.config.root;
  writeSourceSnapshot(root, file);
  project.provide('sourceSnapshotPath', file);

  // ★★ WATCH MODE: re-capture before every rerun, so an edit made while
  //    watching is what the next run scans — never a stale tree.
  project.onTestsRerun(() => {
    writeSourceSnapshot(root, file);
  });

  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
