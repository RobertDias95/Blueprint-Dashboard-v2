import { useState } from 'react';
import { exportFullBackup, fetchTableSummary } from '../../lib/exportBackup';
import { pushToast } from '../../stores/toastStore';

// Q9.5.a: restored v1 Account → "Database Tools (Admin Only)" card
// (v1 index.html:6894-6904). Three buttons:
//   - Check Supabase contents (live, read-only count summary)
//   - Export full backup as JSON (live, tenant-scoped dump)
//   - Import JSON backup (stub — opens "Coming soon" explainer per Q9.5.a-sub)
//
// Amber card styling matches v1 exactly: bg #fef3c7 + border #fcd34d +
// heading text #92400e. Log area appears below buttons once any tool runs.

interface LogLine {
  ts: string;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'err';
}

const LOG_COLOR: Record<LogLine['kind'], string> = {
  info: '#1a2540',
  ok: '#059669',
  warn: '#d97706',
  err: '#dc2626',
};

export default function DbToolsCard() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<null | 'check' | 'export' | 'import'>(null);

  function append(text: string, kind: LogLine['kind'] = 'info') {
    setLog((prev) => [
      ...prev,
      { ts: new Date().toLocaleTimeString(), text, kind },
    ]);
  }

  async function onCheck() {
    setBusy('check');
    append('Checking Supabase contents…');
    try {
      const { counts, errors } = await fetchTableSummary();
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [t, n] of Object.entries(counts)) {
        append(`  ${t.padEnd(28, ' ')} ${n} rows`, n > 0 ? 'ok' : 'info');
      }
      for (const e of errors) {
        append(`  ${e.table.padEnd(28, ' ')} ERROR: ${e.message}`, 'err');
      }
      append(`Total rows across ${Object.keys(counts).length} tables: ${total}`, 'ok');
    } catch (err) {
      append(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setBusy(null);
    }
  }

  async function onExport() {
    setBusy('export');
    append('Exporting full backup — this may take a few seconds…');
    try {
      const result = await exportFullBackup();
      const kb = Math.round(result.bytes / 1024);
      const total = Object.values(result.tableCounts).reduce((a, b) => a + b, 0);
      append(`Downloaded ${result.filename} (${kb} KB, ${total} rows)`, 'ok');
      pushToast(`Backup downloaded · ${total} rows`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      append(`Export failed: ${msg}`, 'err');
      pushToast(`Backup failed — ${msg}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  function onImport() {
    setBusy('import');
    append('Import not yet wired — see modal explainer.', 'warn');
    pushToast(
      'Import not yet wired — see Settings → Account → DB Tools.',
      'info',
    );
    setTimeout(() => setBusy(null), 0);
  }

  const [importExplainerOpen, setImportExplainerOpen] = useState(false);

  return (
    <>
      <div
        className="rounded-lg p-3.5 border"
        style={{ background: '#fef3c7', borderColor: '#fcd34d' }}
        data-testid="db-tools-card"
      >
        <div
          className="text-[10px] tracking-widest uppercase font-bold mb-1.5"
          style={{ color: '#92400e' }}
        >
          Database Tools (Admin Only)
        </div>
        <div className="text-[11px] mb-3" style={{ color: '#92400e' }}>
          Manual snapshots + content checks against the live database.
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={onCheck}
            disabled={busy !== null}
            className="text-left text-xs px-3.5 py-1.5 rounded-md border bg-surface hover:bg-s2 disabled:opacity-50 transition"
            style={{ color: '#92400e', borderColor: '#fcd34d' }}
            data-testid="db-tools-check"
          >
            {busy === 'check' ? 'Checking…' : 'Check Supabase contents'}
          </button>
          <button
            onClick={onExport}
            disabled={busy !== null}
            className="text-left text-xs px-3.5 py-1.5 rounded-md border bg-surface hover:bg-s2 disabled:opacity-50 transition"
            style={{ color: '#92400e', borderColor: '#fcd34d' }}
            data-testid="db-tools-export"
          >
            {busy === 'export' ? 'Exporting…' : 'Export full backup as JSON'}
          </button>
          <button
            onClick={() => {
              onImport();
              setImportExplainerOpen(true);
            }}
            disabled={busy !== null}
            className="text-left text-xs px-3.5 py-1.5 rounded-md border bg-surface hover:bg-s2 disabled:opacity-50 transition"
            style={{ color: '#92400e', borderColor: '#fcd34d' }}
            data-testid="db-tools-import"
          >
            Import JSON backup
          </button>
        </div>
        {log.length > 0 && (
          <div
            className="mt-3 p-2.5 rounded-md bg-surface border text-[11px] font-mono overflow-y-auto whitespace-pre-wrap"
            style={{
              borderColor: '#fcd34d',
              maxHeight: 240,
            }}
            data-testid="db-tools-log"
          >
            {log.map((l, i) => (
              <div key={i} style={{ color: LOG_COLOR[l.kind] }}>
                [{l.ts}] {l.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {importExplainerOpen && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center"
          style={{ background: 'rgba(0,0,50,.5)' }}
          onClick={() => setImportExplainerOpen(false)}
          data-testid="import-explainer-overlay"
        >
          <div
            className="bg-surface border border-border rounded-xl p-7 max-w-md"
            style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-display font-bold text-text mb-2">
              Import not yet wired
            </div>
            <div className="text-xs text-muted leading-relaxed">
              Restoring from a JSON backup requires careful schema validation +
              tenant scope enforcement that hasn't shipped yet. Two safer paths
              for now:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>
                  Contact Claude to restore from a specific backup file (manual
                  SQL with verification).
                </li>
                <li>
                  Use Supabase's automatic <span className="font-mono">PITR</span>{' '}
                  (point-in-time recovery) from the project dashboard — that's
                  the canonical DR path.
                </li>
              </ul>
            </div>
            <div className="mt-4 text-right">
              <button
                onClick={() => setImportExplainerOpen(false)}
                className="px-4 py-1.5 text-xs rounded-md border border-border bg-s2 hover:bg-s3"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
