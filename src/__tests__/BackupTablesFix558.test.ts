import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-558 (P-036) — thirteen backup tables go; four stay.
// ===========================================================================
//
// A shelf file (fix-450 rules: fully commented out, applied from Cowork). What
// this guards is the part a later edit could quietly break: which tables the
// file drops, and that the four a person may still need are never among them.
//
// ★★ The keepers, and why — the migration header carries the full reasoning:
//   * `_parking_site_archive_2026_08_25`     — the only site-parking record (fix-402)
//   * `_fix22_permits_dropped_cols_snapshot` — the older parking record (fix-456 KEEP)
//   * `_fix562_unit_matrix_snapshot`         — COMMENT says DO NOT DROP (fix-562)
//   * `_fix566_redesign_address_rename`      — created after the drop was ruled

const FILE = resolve(
  process.cwd(),
  'migrations',
  'fix_558_drop_backup_tables_PENDING_APPROVAL.sql',
);
const sql = readFileSync(FILE, 'utf8');

const DROPPED = [
  '_dd3056_fix_backup_20260717',
  '_deleted_test_4017_backup_20260820',
  '_deleted_thread_1301_backup_20260819',
  '_fix486_types_backup_20260903',
  '_fix537_color_override_snapshot',
  '_gd_108851_cycle_backup_20260819',
  '_intake_date_fix_backup_20260728',
  '_mbp_3626_recorr_backup_20260717',
  '_mbp_3626_recorr_backup_20260717b',
  '_mbp_premature_corr_backup_20260713',
  '_permit_type_fix_backup_20260728',
  '_seattle_cycle_fix_backup_20260728',
  '_seattle_reviewer_orphan_backup_20260728',
];

const KEPT = [
  '_parking_site_archive_2026_08_25',
  '_fix22_permits_dropped_cols_snapshot',
  '_fix562_unit_matrix_snapshot',
  '_fix566_redesign_address_rename',
];

describe('fix-558: the backup-table drop', () => {
  const drops = [...sql.matchAll(/drop\s+table\s+public\.(\w+)\s*;/gi)].map(
    (m) => m[1]!,
  );

  it('★★★ drops exactly the 13, each once', () => {
    expect([...drops].sort()).toEqual([...DROPPED].sort());
  });

  it('★★★ carries NO drop statement for any keeper — not even a commented one', () => {
    for (const keep of KEPT) {
      expect(sql, `${keep} must be named, with its reason`).toContain(keep);
      expect(sql).not.toMatch(new RegExp(`drop\\s+table[^\\n]*${keep}`, 'i'));
    }
  });

  it('★★ records every dropped table: rows and an md5, before the drop', () => {
    const header = sql.split('= BEGIN APPLY =')[0]!;
    for (const t of DROPPED) {
      expect(
        header,
        `${t} needs a header row with its row count, size and md5`,
      ).toMatch(new RegExp(`${t}\\s+\\d+\\s+\\d+\\s+[0-9a-f]{32}`));
    }
  });

  it('★★ asserts 13 gone, 4 kept, and no function or view names the dead', () => {
    expect(sql).toMatch(/if n <> 13 then/);
    expect(sql).toMatch(/KEEPER % is missing/);
    expect(sql).toMatch(/pg_get_viewdef/);
    expect(sql).toMatch(/p\.prosrc ilike/);
  });

  it('★★ says out loud that the scan counts were void', () => {
    expect(sql).toMatch(/pg_postmaster_start_time\(\)\s+= 2026-09-29/);
    expect(sql).toMatch(/SCAN COUNTS ARE VOID/);
  });
});
