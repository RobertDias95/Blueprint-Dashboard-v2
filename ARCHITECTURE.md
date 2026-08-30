# Blueprint — architecture and orientation

**Last verified against production: 2026-08-11.**
Written for an engineer joining the project. It covers what the system is, how the pieces
fit, and — most importantly — the things that are not discoverable from the code.

If you read only one section, read [Traps](#traps-that-will-cost-you-a-day).

---

## The 60-second version

Blueprint Services manages residential building permits through city portals (Seattle, plus
Bellevue / Kirkland / Bothell / Edmonds / Redmond, plus a little Phoenix / Scottsdale). This
system tracks those permits from design through issuance.

Three moving parts, one shared database:

| Part | What it is | Where it runs |
|---|---|---|
| **Dashboard** | React/TS SPA — the tool people use | Render, static site |
| **Scraper** | Python — reads city portals, writes permit state | GitHub Actions, 2×/weekday |
| **File indexer** | Python — reads correction letters off an on-prem share | Bobby's PC, daily |

All three read and write one Supabase Postgres database. There is no separate API server;
the SPA talks to Postgres through PostgREST with RLS enforcing tenancy.

---

## ★ The two repositories

**This trips up everyone. Read it twice.**

| Repo | Contains | Deployed? |
|---|---|---|
| **`Blueprint-Dashboard-v2`** | The **live dashboard**. Vite + React 19 + TypeScript. | **Yes — Render builds and serves this.** |
| **`Blueprint-Dashboard-`** | The **scraper** (`permit_scraper/`) and the **file indexer** (`file_indexer/`). Also a dead `index.html` — the v1 dashboard. | Only via GitHub Actions for the scrape. The `index.html` is served by nothing. |

The naming is unhelpful: the folder without `v2` is the *older* repo but still holds live
Python. The `index.html` at its root is v1 — a ~810KB single file, superseded, **not served
anywhere**. Editing it has no effect on anything, and it is easy to do by accident because it
looks like an application.

Local checkouts:
```
C:\Users\robertd\dev\Blueprint-Dashboard-v2\    # dashboard
C:\Users\robertd\dev\Blueprint-Dashboard-\      # scraper + indexer
```

Render's build config for the dashboard: `npm install && npm run build`, publish `dist`,
branch `main`, auto-deploy on commit.

**Note:** `Blueprint-Dashboard-` has **no PR CI at all**. Its only workflow is the scheduled
scrape, which triggers on `schedule` and `workflow_dispatch` — never on `pull_request`. Its
~1,000 tests only run when someone runs them by hand. `Blueprint-Dashboard-v2` does have CI
(typecheck + lint + test) on every PR.

---

## Deployment

**Dashboard** — push to `main` → Render webhook → build → live. Usually 2–4 minutes.
If a change doesn't appear, check in this order: (1) did Render receive the webhook — GitHub
webhook delivery has been throttled during GitHub incidents and Render will sit on an old
build indefinitely without erroring; (2) is the browser cached; (3) is the code actually on
`main`.

**Scraper** — `.github/workflows/scrape-prod.yml`, cron at 07:30 and 13:05 Pacific on
weekdays, plus manual dispatch. 90-minute timeout against a ~40-minute typical run. Runtime is
dominated by a deliberate 1.5s politeness sleep between portal requests — **do not remove it**
to speed things up.

**File indexer** — Windows Task Scheduler on Bobby's PC, daily 07:15. Runs targeted (~7s).
Cannot move to CI: the share is on-prem (see below).

---

## The database

Supabase Postgres. Production project ref `eibnmwthkcuumyclyxoe`.

As of 2026-08-11: **69 tables, 3 views, 169 functions (~145 `bp_*` RPCs), 131 RLS policies,
214 migrations.**

### Shape

Everything is multi-tenant on `tenant_id`, gated by RLS through `auth_tenant_ids()`.
Access requires three things, and having two of them looks identical to having none:
an Auth user, a `profiles` row, **and** a `tenant_memberships` row.

Writes mostly go through `bp_*` RPCs rather than direct table writes. Those RPCs are where
the invariants live — cascades, optimistic-concurrency checks, audit trails. Prefer an
existing RPC over a direct `UPDATE`; if you write a new one, follow the surrounding style.

Optimistic concurrency: `bp_check_and_bump_version` guards concurrent edits. The UI is
expected to handle a version conflict, not swallow it.

### Core tables

```
projects (133)          one physical development
  permits (708)         one permit per structure per type; parent_permit_id for sub-permits
    permit_cycles       review rounds — see the cycle model below
      permit_cycle_reviewers    per-discipline reviewer state (1,596)
    permit_tasks (1,014)
correction_items (2,194)      comments parsed off correction letters
project_file_index (1,932)    schematic/marketing file metadata (no file contents)
draw_schedule (133)           design-associate capacity planning
audit_log (10,051), user_activity (3,245)
```

### Migrations

**Always apply schema changes with the Supabase MCP `apply_migration`, never `execute_sql`
and never the dashboard SQL editor.** `apply_migration` records a `schema_migrations` row
*and* the full statement text. The SQL editor records nothing — three migrations applied that
way in July 2026 were invisible to `list_migrations` and were wrongly reported as never
applied, which cost a day. If `list_migrations` shows nothing, that proves nothing; test the
behaviour instead.

---

## ★ The domain model

Two things here are not inferable from the schema and will cause wrong code if assumed.

### Cycle indexing

- **Cycle 0 is the design phase and the initial submittal.** It holds `submitted` (when we
  sent it) and `intake_accepted` (when the city took it).
- **Cycles 1+ are review rounds.** They hold `submitted` (round start) and `resubmitted`
  (when we sent corrections back). They do **not** carry `intake_accepted` — that field is
  populated only on cycle 0.
- Setting `intake_accepted` on cycle N auto-creates cycle N+1 with `submitted` =
  `intake_accepted`. This is a database trigger, not application logic.

### What the scraper owns vs what is manual

The scraper writes what the portal exposes. Several fields it cannot see stay manual, and
**some of those are largely unfilled**:

- `permit_cycles.submitted` on cycle 0 is manual and is empty on most Seattle building
  permits. **Any report counting "permits we submitted" from this field undercounts badly** —
  use `intake_accepted` unless you specifically mean the send date.
- `permits.expected_issue` (ACQ Target) is manual.
- MPB pre-number project-ID intake is invisible to the scraper by design.

`permits.last_scraper_update_at` is **change-based** — it only moves when a value actually
changes. A stale timestamp does not mean the scrape didn't run.

---

## The scraper

`Blueprint-Dashboard-/permit_scraper/`.

Reads Seattle (Accela + Socrata), the MyBuildingPermit portal (Bellevue, Kirkland, Bothell,
Edmonds), Redmond (Tyler, GUID-gated), and Maricopa. Each jurisdiction has meaningfully
different vocabulary for the same concepts — reviewer status, cycle numbering, correction
rounds — and the mapping code is where most of the accumulated knowledge lives.

Two behaviours worth knowing:

- **Issued permits are excluded from scraping** by keying off `actual_issue`, not `status`.
  Status is scraper-written, so keying on it would be self-latching. Clearing the date
  reactivates a permit.
- **Seattle runs a per-discipline cycle counter** for some disciplines (Housing), which can
  orphan reviewer rows so they never surface in the UI. Known, partially fixed.

---

## The file indexer

`Blueprint-Dashboard-/file_indexer/`. See its own `README.md` for run modes.

Reads correction letters as PDFs from
`\\bpc-file\SoleilData\--- Blueprint Services ---\Building Permits`, splits each into its
numbered comments, classifies them, and writes `correction_items`.

**★ The share is on-prem.** Render cannot reach it. GitHub Actions cannot reach it. Anything
touching those files must run inside the network. That constraint is why the indexer lives on
a PC and not in CI, and it is not negotiable without new infrastructure.

**★ It is strictly read-only against the share, and must stay that way.** PDFs open through
explicit `rb` handles; the process refuses to start if its output directory resolves inside
the share. This is a hard requirement from the business, not a preference.

Three modes:

```
python -m file_indexer              # targeted — only projects with expected-but-missing letters
python -m file_indexer --full       # every matched project
python -m file_indexer --offline    # no database, no network — CSVs out
```

`--offline` exists so the correction analysis outlives the tool. It discovers projects from
folder names on the share rather than from the database. It shares the same parsers and test
suite as the online path, deliberately — an unexercised fallback is not a fallback.

`text-cache.jsonl` holds every letter's extracted text. Re-parsing costs seconds instead of
the ~25-minute cold walk. Never delete it casually.

### Filename grammar

Two conventions, and neither is enforced:

```
Seattle:   10044 - Addressing Corr 2.pdf
East side: 10431 - SFR 1 - Correction Letter 1.pdf     <- BUILDING in the middle
           19117 (Cot 2) - Correction Letter 3.pdf
```

East-side projects have **several buildings per project folder**, each with its own permit and
its own letters. `correction_items.building` matches `permits.struct_address` exactly
(`'SFR 1'`, `'DUPLEX 2'`). Ignoring the building level collapses distinct buildings and
corrupts any cycle-over-cycle analysis.

### Known ceiling

`correction_items.permit_id` is populated on ~50%. The remaining half is not a matching
bug: **1,074 of 1,091 unlinked letters name no permit anywhere in their text.** Four
inference routes were measured and rejected (cycle+date 92.8–98.1% precise, single-permit
96.2%, body text 52.9%) — at corpus scale each would silently attach 20–50 corrections to the
wrong permit. The lever is upstream: get the permit number into the filename.

---

## Reports

Two surfaces, easily confused:

- **Reports tab** — analytics pages.
- **Settings → Reporting** — the saved-reports hub and a report builder.

**★ The hub lists from the `saved_reports` table, not from the code registry in
`src/lib/builtinReports.ts`.** Registering a builtin report without also seeding its
`saved_reports` row produces a finished report that is reachable only by typing its URL. This
has happened twice. If you add a report, write the seed migration.

---

## Traps that will cost you a day

Each of these has already caused a production incident or a wasted day.

**PostgREST truncates at 1,000 rows, silently.** A `select()` without `.range()` returns the
first 1,000 rows with no error and no indication. Several tables are past that. Use
`fetchAllRows`. When a total looks plausible but slightly low, suspect this first.

**`src/lib/database.types.ts` is hand-typed.** Never run `supabase gen types` against it —
that overwrites deliberate hand-narrowing. Add interfaces manually.

**Dead code with passing tests.** `src/components/MyTasks/Task*.tsx` is not rendered anywhere.
It has tests, and those tests pass. Two fixes were shipped against it before anyone noticed
they were hardening code nobody executes. Verify a component is actually mounted before
debugging it.

**Raw date inputs save garbage.** A native date input's `onChange` fires on every keystroke,
so typing a year writes `0002-01-01` before it writes `2026-01-01`. Wire dates through
`BufferedDateInput`, which commits on blur. This bug shipped three separate times.

**`useState(prop)` initialises once.** A controlled input deriving state from a prop needs a
`useEffect` to resync, or it silently ignores updates. This is the root of a class of
optimistic-concurrency churn bugs.

**Staging is far behind production.** It is a false negative for anything tenant-aware or
newer than 2026-05-09. Audit against production (read-only) or use a transaction you roll
back.

**Grants are the second layer, and until fix-455 they were not holding.** RLS is on all 97
tables and every view sets `security_invoker`, so nothing was ever reachable — but 60 tables
also granted `anon` INSERT/UPDATE/DELETE. The cause is `pg_default_acl`: Supabase’s
`ALTER DEFAULT PRIVILEGES` gives **anon *and* authenticated** everything on each new relation
in `public`. fix-273 revoked TRUNCATE (and it held — TRUNCATE is now absent everywhere), but
the defaults kept re-granting the rest to every new table. fix-455 revoked anon’s writes
database-wide and fixed the `postgres` default so the next relation is not born with them.
★ The `supabase_admin` default entry still grants anon and **cannot be changed from here** —
`postgres` is not a member. It governs relations Supabase provisions, not ours.

**The house revoke must NAME `authenticated`, and be verified from the catalogue.**
`revoke all … from public, anon` does **not** touch `authenticated`. fix-454 used that pattern
and the applied view came back `authenticated=arwdxtm`; the migration text looked right and the
database disagreed. The correct pattern for a new view is:

```sql
revoke all on public.<rel> from public, anon, authenticated;
grant select on public.<rel> to authenticated;
```

★ **Then read `pg_class.relacl` back after applying** — not the migration file. A new TABLE
follows `permit_task_audit`: `anon` nothing, `authenticated` SELECT only (plus the writes the
Bridge actually needs), `service_role` ALL. `migrations/GRANT_POSTURE_CHECK.sql` is the
standing query; it is a manual check, because this repo has no CI database.

**Column drops need three checks, not one.** Client `.select()` strings, every function body,
*and* a live probe against production. Two incidents came from "exhaustive" greps that missed
a string built at runtime.

**A stale local checkout lies.** Diagnose from `origin/main`, not from what is on disk —
local can be days behind and the resulting bug report will name a line that no longer exists.

---

## How work gets done here

Changes are specified as written briefs, implemented by an AI agent with full autonomy, then
reviewed and merged by Bobby. Briefs live in
`OneDrive\...\Permitting Tool\Blueprint\file-server\` and are worth reading — they show the
level of specificity this codebase expects, including the failure modes each ticket had to
avoid.

Conventions that matter:

- Branch off `origin/main`, squash-merge, delete the branch.
- **Verify by content, not by report.** CI green, "pushed", and "shipped" are not the same as
  merged. Grep `origin/main` for a marker from the change.
- Tests are expected with every change. v2 has ~3,800; the scraper repo ~1,000.
- Migrations via `apply_migration`, with a probe before anything destructive.

---

## Documentation map

| File | What it covers | Trust |
|---|---|---|
| `ARCHITECTURE.md` (this) | System overview, domain model, traps | Current |
| `README.md` (v2) | Stack, local setup, env config | Current |
| `file_indexer/README.md` | Indexer run modes, timings, offline | Current |
| `BUG_BACKLOG.md` | Open work | **Stale — verify each item before trusting it** |
| `CLAUDE_HANDOFF.md` (v2) | A session log from 2026-05-16 | **Obsolete. Delete or ignore.** |
| `file-server/FINDINGS.md` | File-server investigation | Current for its date |
| `file-server/CORRECTION_ANALYSIS.md` | Correction findings | Current |

---

## Open items worth knowing on day one

- **TRUNCATE grants** across 58 tables (above). Needs one sweeping revoke plus
  `ALTER DEFAULT PRIVILEGES`.
- **No PR CI in the scraper repo.** ~1,000 tests that never run automatically.
- **Permit linkage at 50%** on correction items, blocked upstream on filing convention.
- **No agreed filename convention** for correction letters. Blocks distinguishing "never
  filed" from "filed under a name we don't parse" on ~40% of projects.
- **`draw_schedule_audit`** does not record `dd_*` column changes.
