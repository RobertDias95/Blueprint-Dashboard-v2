# Backups of production rows deleted on purpose

## `app_config_unused_keys_2026-10.json` (fix-644, P-318)

The 17 `app_config` rows Bobby approved for deletion on 2026-10-11. Exported
from prod and verified equal to the live rows (17/17, no differences) before
the delete.

- **Deleted (16):** permitTypes, jurisdictions, dmDaGroups, das, dms, entLeads,
  acqLeads, formerDas, consultantTypes, dmOrder, quarterTeams, wizQuestions,
  permitOrder, nextId, _ulsMigrated, learnThresholds.
- **Kept (1):** `design_guidance_task_enabled_at` — the scraper's file indexer
  reads it every run. It is in the file only because it was approved.

A second copy is in the Brain at
`reference/app_config-backup-2026-10-fix644.json` (same bytes).

### Restore

One statement. Paste the file's contents between the quotes. Existing keys are
left alone, so it is safe to run twice:

```sql
INSERT INTO public.app_config (key, value, updated_at, tenant_id)
SELECT r->>'key', r->'value', (r->>'updated_at')::timestamptz, (r->>'tenant_id')::uuid
  FROM jsonb_array_elements('<contents of app_config_unused_keys_2026-10.json>'::jsonb) r
ON CONFLICT (key) DO NOTHING;
```

Nothing in the app reads these keys, so a restore changes no screen. The
functions that once wrote them (`bp_replace_app_config_and_roster`,
`bp_finalize_app_config_extras`) were dropped in the same migration. Their
definitions are in `migrations/fix_379_dm_derived.sql` and in migration history.
