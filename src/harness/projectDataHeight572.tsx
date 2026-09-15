import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../index.css';
import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';

import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-572 §B — HOW TALL IS EACH TAB, MEASURED IN CHROME
// ===========================================================================
//
// §B: *"MEASURE, do not pick a number. Render every tab in PROJECT_DATA_TABS,
// take the tallest natural body height, and size the shell to it."*
//
// ★★★ IT RENDERS THE REAL `ProjectDetailsModal`, not a transcription — the
//     whole point is the NATURAL height of each real tab, and a transcribed
//     interior would measure my typing rather than the app's. The queries it
//     depends on are seeded into a `QueryClient` with `retry: false` and no
//     network, so every panel mounts with plausible data and none of them
//     waits on Supabase.
//
// ★★ THE MEASUREMENT IS OF THE BODY'S **SCROLL HEIGHT**, taken with the shell
//    temporarily unconstrained. `offsetHeight` would report the clamped box and
//    tell us only what we already set; `scrollHeight` is what the content wants.
//
// HOW TO RUN
//     npm run dev  →  http://localhost:5173/harness/project-data-height-572.html
// The report prints into <pre id="fix572-report">.

const NOW = '2026-09-15T12:00:00Z';

const project = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  address: '10004 116th Ave NE',
  juris: 'Kirkland',
  archived: false,
  notes: null,
  acq_lead: 'Jake',
  entitlement_lead: 'Briana',
  design_manager: 'Brittani',
  schematic_designer: ['Derry'],
  construction_admin: 'Steve',
  da: 'Cam',
  external_team: {},
  builder_id: null,
  builder_name: 'A Builder',
  builder_company: 'Builder Co',
  builder_email: 'b@example.com',
  builder_phone: '555',
  permit_order: [],
  product_types: ['Detached', 'Attached'],
  project_tags: ['Tag'],
  units: 6,
  zone: 'RM 3.6',
  alley: 'Yes',
  lot_width: 40,
  lot_depth: 90,
  lot_size_sf: 3600,
  is_corner_lot: true,
  is_regular_shape: true,
  num_lots: 1,
  go_date: '2026-01-01',
  closing_date: '2026-02-01',
  kickoff_date: '2026-01-15',
  dd_start: '2026-02-01',
  dd_end: '2026-03-01',
  // ★ THREE unit types: the Units tab is the tallest candidate and its height is
  //   a function of how many blocks it renders. Prod's deepest project carries
  //   six; three is the median and the number the report labels.
  unit_types: [
    { label: 'Detached', width_ft: 24, depth_ft: 50.5, qty: 2, size_sf: 3352 },
    { label: 'Attached', width_ft: 20, depth_ft: 40, qty: 3, size_sf: 2100 },
    { label: 'Detached', width_ft: 22, depth_ft: 44, qty: 1, size_sf: 2400 },
  ],
  created_at: NOW,
  updated_at: NOW,
} as unknown as Project;

const permits = [1, 2, 3].map(
  (i) =>
    ({
      id: i,
      project_id: project.id,
      type: i === 1 ? 'Building Permit' : `Permit ${i}`,
      stage: 'de',
      cycle: 1,
      corr_rounds: 0,
      submitted: null,
      status: null,
      portal_url: null,
      struct_address: null,
      parent_permit_id: null,
      expected_issue: null,
      approval_date: null,
      actual_issue: null,
      extras: null,
      created_at: NOW,
      updated_at: NOW,
      permit_cycles: [],
    }) as unknown as PermitWithCycles,
);

// ★ The page renders ONE modal and the measurement is driven from the console
//   (or by clicking the tabs). An auto-advancing loop fought with the tab
//   clicks and produced a shifted table — the numbers were each one tab late.
function Report() {
  return (
    <ProjectDetailsModal
      project={project}
      permits={permits}
      bp={permits[0] ?? null}
      onClose={() => {}}
    />
  );
}

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    mutations: { retry: false },
  },
});

function App() {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Report />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
