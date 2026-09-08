import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectDataModal from '../components/ProjectDetail/ProjectDataModal';
import type { ProjectDataTab } from '../lib/projectDataTabs';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §G — WHERE THE OVERVIEW'S EDITORS ARE NOW MOUNTED
// ===========================================================================
//
// P-140 made the overview read-only, so a suite that used to render
// `ProjectDetailHeader` and reach for `pd-site-zone`, `pd-bp-dd_start`,
// `pd-unit-w` or `pd-target-submit` is now looking in the wrong place: those
// controls are the Project Data modal's tabs.
//
// ★★★ THE EDITORS THEMSELVES DID NOT CHANGE, WHICH IS WHY THIS HELPER IS ALL
//     MOST SUITES NEED. The brief's rule — *"every write goes through the SAME
//     hooks the overview uses today; no new RPC, same OCC tokens, same
//     toasts"* — means the components under test are byte-for-byte the ones
//     that shipped on `origin/main`; only their parent moved. A suite that
//     swaps `renderHeader` for `renderProjectData` and keeps every assertion is
//     asserting exactly what it asserted before, which is the point: it can
//     still catch a regression in the editor.
//
// ★ Its own file in `src/test/` rather than a copy per suite, because fifteen
//   suites need it and fifteen copies is fifteen chances for one of them to
//   mount a different tab and quietly stop testing anything.

/** Mount the Project Data modal on one tab, with the app's providers. */
export function renderProjectData(
  project: Project,
  permits: PermitWithCycles[],
  tab: ProjectDataTab = 'site',
) {
  const bp =
    permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDataModal
      project={project}
      permits={permits}
      bp={bp}
      initialTab={tab}
      onClose={() => {}}
      onOpenSettings={() => {}}
    />,
    { wrapper },
  );
}
