import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// fix-288: the wizard's Step 2 descriptions now come from
// app_config.permitTypeDescriptions instead of a constant in the bundle, so
// changing one is a Settings edit rather than a deploy.
//
// QuestionnaireSection is tested directly rather than through Step2Questionnaire
// because it is the component that reads the descriptions — the bucketing above
// it is untouched by this ticket and has its own suite.

const cfg = vi.hoisted(() => ({ map: new Map<string, unknown>() }));

vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    data: [], isLoading: false, error: null, refetch: vi.fn(), map: cfg.map,
  }),
  readAppConfigStringArray: () => [],
}));

import QuestionnaireSection from '../components/wizard/QuestionnaireSection';

function renderSection(types: string[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <QuestionnaireSection
      title="Commonly used"
      items={types.map((type) => ({ type, pct: null }))}
      selectedByType={{}}
      onToggle={vi.fn()}
      testIdPrefix="q"
    />,
    { wrapper },
  );
}

beforeEach(() => {
  cfg.map = new Map<string, unknown>();
});

describe('fix-288 descriptions come from app_config', () => {
  it('renders the stored description', () => {
    cfg.map = new Map<string, unknown>([
      ['permitTypeDescriptions', { Demolition: 'Edited in Settings, no deploy' }],
    ]);
    renderSection(['Demolition']);
    expect(screen.getByTestId('q-desc-Demolition')).toHaveTextContent(
      'Edited in Settings, no deploy',
    );
  });

  // ★ The point of the move: an edit in Settings changes the wizard. Same
  // component, same permit type, different config — different text.
  it('an edit changes the wizard without a code change', () => {
    cfg.map = new Map<string, unknown>([
      ['permitTypeDescriptions', { Demolition: 'first wording' }],
    ]);
    const { unmount } = renderSection(['Demolition']);
    expect(screen.getByTestId('q-desc-Demolition')).toHaveTextContent('first wording');
    unmount();

    cfg.map = new Map<string, unknown>([
      ['permitTypeDescriptions', { Demolition: 'second wording' }],
    ]);
    renderSection(['Demolition']);
    expect(screen.getByTestId('q-desc-Demolition')).toHaveTextContent('second wording');
  });

  // ★ The brief's named case. 'Grading / Clearing' — forward slash — must show
  // its description. It is the type 7 production permits carry.
  it('Grading / Clearing renders its description', () => {
    renderSection(['Grading / Clearing']);
    expect(screen.getByTestId('q-desc-Grading / Clearing')).toHaveTextContent(
      'Earthwork, cut/fill, retaining walls, tree clearing at scale',
    );
  });

  it('falls back to the seeded text when app_config has no key yet', () => {
    // cfg.map is empty here — the pre-migration state, and any moment the
    // config query has not resolved. Help text must not vanish.
    renderSection(['Building Permit']);
    expect(screen.getByTestId('q-desc-Building Permit')).toHaveTextContent(
      'Required for new construction or major structural work',
    );
  });

  it('renders no description block for a type that has none', () => {
    cfg.map = new Map<string, unknown>([['permitTypeDescriptions', {}]]);
    renderSection(['Condo']);
    expect(screen.queryByTestId('q-desc-Condo')).toBeNull();
  });

  // The two keys that never matched a permit type are gone, so they cannot
  // render — and neither can the backslash spelling the brief described.
  it.each([
    'PPR (Post-Permit Revision)',
    'SDOT',
    'Grading \\ Clearing',
  ])('%s is not a permit type and renders nothing', (bogus) => {
    renderSection([bogus]);
    expect(screen.queryByTestId(`q-desc-${bogus}`)).toBeNull();
  });
});
