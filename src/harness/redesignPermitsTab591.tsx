import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../index.css';
import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-591 (P-290) — THE PERMITS TAB OF A REUSE-REDESIGN, RENDERED
// ===========================================================================
//
// The 19 assertions prove the STRUCTURE — read-only flag, disabled boxes, no ✕,
// the owner line and its href. They cannot prove it is LEGIBLE, and this ticket
// turns two rows into "shown, not edited" on the strength of exactly that.
// fix-406's lesson is that a styling change nothing renders is indistinguishable
// from a styling change that does nothing.
//
// ★ It mounts the REAL modal on the REAL tab with the REAL shape of the live
//   row: the redesign `e2235581…` showing the original's permits 10638/10639,
//   `redesign_reuses_original_permit = true`.
//
// HOW TO RUN
//     npm run dev  →  http://localhost:5173/harness/redesign-permits-tab-591.html

const NOW = '2026-09-16T17:08:29.925908Z';
const ORIGINAL = '0bae741f-d21a-4b4d-9803-f1a08e5d9a15';
const REDESIGN = 'e2235581-5042-441c-8cdd-eeacb20920ba';

const redesign = {
  id: REDESIGN,
  tenant_id: '00000000-0000-0000-0000-000000000001',
  address: '4707 S Graham St',
  juris: 'Seattle',
  archived: false,
  redesign_of_project_id: ORIGINAL,
  redesign_reuses_original_permit: true,
  acq_lead: 'Jake',
  entitlement_lead: 'Miles',
  design_manager: 'Brittani',
  schematic_designer: ['Derry'],
  da: 'Marc',
  external_team: {},
  permit_order: [],
  product_types: [],
  project_tags: [],
  units: 2,
  zone: 'LR1',
  go_date: '2026-01-01',
  created_at: NOW,
  updated_at: NOW,
} as unknown as Project;

const original = { ...redesign, id: ORIGINAL, redesign_of_project_id: null } as Project;

/** ★ The ORIGINAL's two rows — `project_id` is the original's, which is the
 *  whole point: this is what `lineagePermits` hands the tab. */
const permits = [
  { id: 10638, num: '7078527-CN' },
  { id: 10639, num: '7079712-CN' },
].map(
  (p) =>
    ({
      ...p,
      project_id: ORIGINAL,
      type: 'Building Permit',
      ent_lead: 'Miles',
      da: 'Marc',
      portal_url: 'https://cosaccela.seattle.gov/portal/',
      struct_address: null,
      expected_issue: null,
      parent_permit_id: null,
      status: 'Pre-Submittal — GO',
      permit_cycles: [],
      created_at: NOW,
      updated_at: '2026-09-02T21:22:11.310678Z',
    }) as unknown as PermitWithCycles,
);

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
        <ProjectDetailsModal
          project={redesign}
          permits={permits}
          bp={permits[0]}
          allProjects={[redesign, original]}
          initialTab="permits"
          onClose={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
