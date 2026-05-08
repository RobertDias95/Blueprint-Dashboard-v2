# Blueprint Dashboard v2

Permitting & entitlements dashboard — rebuild on a modern stack.

**Why this exists:** v1 (`Blueprint-Dashboard-/index.html`, ~810KB single file) accumulated structural defects across 17+ fixes that fix-N iteration could not converge on. v2 is the fresh-start rebuild planned in `permit_scraper/REBUILD_DESIGN_PASS.md` (see also `HANDOFF_2026-05-08_REBUILD_DECISION.md` for the decision rationale).

**What's reused:** Supabase backend (schema, RLS, realtime, working RPCs).
**What's new:** Vite + React 18+ + TypeScript + TanStack Query + Tailwind + Zustand + Vitest, plus tests from day 1 and CI on every push.

---

## Stack

| Layer | Choice |
|---|---|
| Bundler | Vite |
| Language | TypeScript |
| Framework | React 19 |
| Server state | TanStack Query v5 |
| Client state | Zustand (auth only — server data lives in TanStack Query) |
| Routing | react-router-dom v7 |
| Styling | Tailwind CSS v3 (palette ported from v1) |
| Tests | Vitest + Testing Library + jsdom |
| Lint | ESLint (Vite default) |
| Backend | Supabase (shared with v1 — no migration needed) |

---

## Setup

1. **Install Node.js 20 LTS or newer.** Node 24 (current) also works.
2. **Clone / pull** this repo to `C:\Users\robertd\dev\Blueprint-Dashboard-v2\`.
3. **Install deps:**
   ```bash
   npm install
   ```
4. **Configure environment:**
   ```bash
   cp .env.example .env.local
   ```
   Then edit `.env.local` with the Supabase URL + publishable key. Default points at production. See `.env.example` comments for staging values.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Vite dev server with HMR (default: http://localhost:5173) |
| `npm run build` | Type-check (`tsc -b`) then production build to `dist/` |
| `npm run preview` | Serve the production build locally (verify pre-deploy) |
| `npm run typecheck` | Type-check only (`tsc -b --noEmit`) |
| `npm run lint` | ESLint over the project |
| `npm run test` | Vitest run-once (used by CI) |
| `npm run test:watch` | Vitest watch mode (used during dev) |
| `npm run test:ui` | Vitest UI dashboard at http://localhost:51204 |

---

## CI

GitHub Actions runs on every push (`.github/workflows/ci.yml`):

1. `npm ci` — clean install
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test`

PRs that fail any step block merge. The harness must stay green.

---

## Deploy

Not configured yet. v2 stays at localhost during Q1-Q8. Q9 (cutover) defines the deploy path — likely a Render service alongside v1's, with users opting in via URL.

---

## Project structure

```
src/
├── components/        Reusable React components (AuthGuard, Chrome, ...)
├── lib/               Pure helpers, no React (supabase client, date math, ...)
├── pages/             Route components (Login, Placeholder, future Dashboard, ...)
├── stores/            Zustand stores (authStore — minimal client-only state)
├── test/              Test setup (jest-dom matchers, mocks)
├── __tests__/         Unit/component tests (Vitest discovers these)
├── App.tsx            App shell — wires QueryClient, Router, auth bootstrap
├── main.tsx           Entry — renders <App /> into #root
├── router.tsx         Route table — /login + auth-guarded /dashboard, /project/:id, etc.
└── index.css          Tailwind directives + Google Fonts + base layer
```

---

## Roadmap (from REBUILD_DESIGN_PASS.md)

- **Q1** — Project scaffold + auth flow ← **YOU ARE HERE**
- **Q2** — Read paths (matrix view via `useQuery`, project-keyed render)
- **Q3** — Write paths for permit fields (mutations via `useMutation`, optimistic updates)
- **Q4** — Cycles + tasks (row-level RPCs, OCC tokens)
- **Q5** — Wizard (atomic `bp_create_project_with_permits` RPC)
- **Q6** — Draw schedule view (drag, gap-fill, conflict resolution)
- **Q7** — Intake tracker, project documents, admin panel, my tasks
- **Q8** — Test harness expansion (~20-30 E2E tests for critical paths)
- **Q9** — Cutover (parallel deploy, validation, decommission v1)

Each phase has acceptance criteria that must pass before the next begins. See `permit_scraper/REBUILD_DESIGN_PASS.md` for the full plan.

---

## Architectural primitives (non-negotiable — see design doc §2)

1. **Server is source of truth, local is cache.** No localStorage-as-truth. TanStack Query owns server-state caching.
2. **Every write is row-level OCC.** No wholesale-replace RPCs.
3. **Realtime is canonical sync.** Realtime broadcasts → query cache invalidation → UI refresh. One pipeline, not two.
4. **Project-keyed render.** Matrix iterates `projects` → looks up child permits. No placeholder permit synthesis.
5. **Atomic create RPCs.** Wizard fires one RPC; no diff/discover loops.
6. **Module separation.** No `window._bp*` globals. ES modules with explicit imports; TypeScript catches cross-module issues at compile time.
7. **Test harness from day 1.** Vitest unit + (later) Playwright E2E. CI gates merges.

If a feature requires violating any of these, the feature waits.

---

## Contributing

This is currently a one-developer project (Bobby) with AI assist (Claude Code). Workflow:

1. Pull latest, branch off `main`.
2. Make changes. Run `npm run typecheck && npm run lint && npm run test` locally before pushing.
3. Push branch, open PR. CI runs automatically.
4. Merge after CI green + manual smoke test.

No force-pushes to `main`. No skipping CI.
