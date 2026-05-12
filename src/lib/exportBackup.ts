import { supabase } from './supabase';

// Q9.5.a: Export full backup utility for the Account → DB Tools surface.
// Dumps every tenant-scoped table the user has read access to as a single
// JSON file. Tenant scope is enforced server-side via RLS — anon-key
// reads only return rows the user can see. Service-role keys are NEVER
// used here.
//
// Format mirrors v1's exportAllData shape: a top-level object with one
// property per table, value = array of rows. Downstream tooling can
// round-trip via a future Import step (Q9.5.x backlog).

const TABLES = [
  'projects',
  'permits',
  'permit_cycles',
  'permit_tasks',
  'task_subtasks',
  'draw_schedule',
  'da_time_blocks',
  'intake_records',
  'team_members',
  'dm_da_groups',
  'task_templates',
  'task_template_subtasks',
  'jurisdictions',
  'permit_types',
  'app_config',
] as const;

export interface ExportResult {
  filename: string;
  tableCounts: Record<string, number>;
  bytes: number;
}

/** Fetch every row from each table, bundle into a single JSON blob, and
 * trigger a browser download. Returns a summary of what was exported. */
export async function exportFullBackup(): Promise<ExportResult> {
  const payload: Record<string, unknown[]> = {};
  const tableCounts: Record<string, number> = {};

  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select('*');
    if (error) {
      throw new Error(`Export failed reading ${t}: ${error.message}`);
    }
    const rows = data ?? [];
    payload[t] = rows;
    tableCounts[t] = rows.length;
  }

  const meta = {
    exported_at: new Date().toISOString(),
    exporter: 'v2 Settings → Account → DB Tools',
    note: 'Tenant scope enforced by RLS at read time.',
  };

  const json = JSON.stringify({ meta, data: payload }, null, 2);
  const bytes = new Blob([json]).size;

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `blueprint-backup-${ts}.json`;

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { filename, tableCounts, bytes };
}

/** Read-only count summary for the "Check Supabase contents" button. */
export async function fetchTableSummary(): Promise<{
  counts: Record<string, number>;
  errors: { table: string; message: string }[];
}> {
  const counts: Record<string, number> = {};
  const errors: { table: string; message: string }[] = [];

  for (const t of TABLES) {
    const { count, error } = await supabase
      .from(t)
      .select('*', { count: 'exact', head: true });
    if (error) {
      errors.push({ table: t, message: error.message });
      continue;
    }
    counts[t] = count ?? 0;
  }
  return { counts, errors };
}
