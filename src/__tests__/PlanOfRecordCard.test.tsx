import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { ProjectPlanOfRecordRow } from '../lib/database.types';

// fix-285: the Design Plan of Record card.
//
// The supabase client is mocked at the module level so the REAL hooks run —
// which is what makes the "signed, never public" assertions mean something: if
// the component ever reached for getPublicUrl, the spy would record it.

const T = 'test-tenant-uuid';
const PROJECT_ID = '3e1f84c4-92fe-4c70-aaa2-2758c5f13d68';

const state = vi.hoisted(() => ({
  row: null as unknown,
  rowError: null as unknown,
  signedUrl: 'https://example.supabase.co/storage/v1/object/sign/plan-thumbnails/x.jpg?token=abc',
  signError: null as unknown,
  calls: [] as string[],
  publicUrlCalls: 0,
  signArgs: [] as Array<[string, number]>,
  buckets: [] as string[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      state.calls.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({ data: state.row, error: state.rowError });
      // Anything that would WRITE is recorded so the read-only test can see it.
      chain.insert = () => { state.calls.push(`insert:${table}`); return chain; };
      chain.update = () => { state.calls.push(`update:${table}`); return chain; };
      chain.upsert = () => { state.calls.push(`upsert:${table}`); return chain; };
      chain.delete = () => { state.calls.push(`delete:${table}`); return chain; };
      return chain;
    },
    storage: {
      from: (bucket: string) => {
        state.buckets.push(bucket);
        return {
          createSignedUrl: (path: string, ttl: number) => {
            state.calls.push('createSignedUrl');
            state.signArgs.push([path, ttl]);
            return Promise.resolve({
              data: state.signError ? null : { signedUrl: state.signedUrl },
              error: state.signError,
            });
          },
          getPublicUrl: (path: string) => {
            // ★ Must never be reached for this bucket.
            state.publicUrlCalls += 1;
            state.calls.push('getPublicUrl');
            return { data: { publicUrl: `https://public/${path}` } };
          },
          upload: () => { state.calls.push('upload'); return Promise.resolve({ data: null, error: null }); },
          remove: () => { state.calls.push('remove'); return Promise.resolve({ data: null, error: null }); },
        };
      },
    },
  },
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../stores/toastStore', () => ({ pushToast: toastMock }));

import PlanOfRecordCard from '../components/ProjectDetail/PlanOfRecordCard';

const UNC =
  '\\\\bpc-file\\SoleilData\\--- Blueprint Services ---\\Building Permits\\'
  + '10044 37th Ave SW - Haushund - MA\\10044 - Marketing Plans\\'
  + '10044 - Plan Set - Marketing Update 260618.pdf';

function row(over: Partial<ProjectPlanOfRecordRow> = {}): ProjectPlanOfRecordRow {
  return {
    project_id: PROJECT_ID,
    tenant_id: T,
    file_index_id: 'fi-1',
    set_type: 'marketing',
    stage_rank: 3,
    file_name: '10044 - Plan Set - Marketing Update 260618.pdf',
    unc_path: UNC,
    folder_name: '10044 - Marketing Plans',
    modified_at: '2026-06-18T00:00:00Z',
    size_kb: 17398,
    thumb_path: `${PROJECT_ID}/marketing.jpg`,
    thumb_status: 'ok',
    thumb_generated_at: '2026-08-11T00:00:00Z',
    ...over,
  };
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PlanOfRecordCard projectId={PROJECT_ID} />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.row = null;
  state.rowError = null;
  state.signError = null;
  state.calls = [];
  state.publicUrlCalls = 0;
  state.signArgs = [];
  state.buckets = [];
  toastMock.mockClear();
});

// ------------------------------------------------------------ the stages --

describe('fix-285 the card renders each stage with its own chip', () => {
  it.each([
    ['marketing', 'Marketing'],
    ['schematic', 'Schematic'],
    ['design_guidance', 'Design Guidance'],
  ] as const)('%s', async (setType, label) => {
    state.row = row({ set_type: setType });
    renderCard();
    const chip = await screen.findByTestId(`plan-of-record-stage-${setType}`);
    expect(chip).toHaveTextContent(label);
  });

  it('the three chips are visually distinct from one another', async () => {
    const seen = new Set<string>();
    for (const setType of ['marketing', 'schematic', 'design_guidance'] as const) {
      state.row = row({ set_type: setType });
      const { unmount } = renderCard();
      const chip = await screen.findByTestId(`plan-of-record-stage-${setType}`);
      seen.add(chip.getAttribute('style') ?? '');
      unmount();
    }
    expect(seen.size).toBe(3);
  });

  it('does NOT re-derive which stage wins — it renders the row it is given', async () => {
    // A schematic row on a project that also has marketing would be a fix-284
    // question. The card must not second-guess the view.
    state.row = row({ set_type: 'schematic', stage_rank: 2 });
    renderCard();
    expect(await screen.findByTestId('plan-of-record-stage-schematic'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('plan-of-record-stage-marketing')).toBeNull();
  });
});

// ------------------------------------------------------------- file detail --

describe('fix-285 the file card', () => {
  it('shows filename, modified date and size', async () => {
    state.row = row();
    renderCard();
    expect(await screen.findByTestId('plan-of-record-filename'))
      .toHaveTextContent('10044 - Plan Set - Marketing Update 260618.pdf');
    const meta = screen.getByTestId('plan-of-record-meta');
    expect(meta).toHaveTextContent('Jun 18, 2026');
    expect(meta).toHaveTextContent('17 MB');
  });

  // ★ fix-295: the path is OFF the card face. It wrapped to three or four
  // lines and was the tallest single element on the card -- a third of its
  // height spent on a string nobody acts on. The room went to the preview.
  it('does NOT show the UNC path on the card face', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-filename');
    expect(screen.queryByTestId('plan-of-record-path')).toBeNull();
    // ...and the card does not smuggle it back in as loose text.
    expect(screen.queryByText(UNC)).toBeNull();
  });

  // It is moved, not deleted -- the lightbox has room, and somebody who has
  // deliberately opened the file is far likelier to want it.
  it('shows the FULL UNC path inside the lightbox, selectable and monospace', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const path = screen.getByTestId('plan-of-record-lightbox-path');
    expect(path.textContent).toBe(UNC);
    expect(path.className).toContain('font-mono');
    expect(path.className).toContain('select-all');
  });

  it('offers Copy path, with a hint saying where to paste it', async () => {
    state.row = row();
    renderCard();
    expect(await screen.findByTestId('plan-of-record-copy')).toBeInTheDocument();
    expect(screen.getByTestId('plan-of-record-copy-hint'))
      .toHaveTextContent(/paste into File Explorer/i);
  });

  it('copies the path to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(UNC));
  });

  // ★ fix-289: the whole point of the ticket. Chrome and Edge silently refuse
  // to navigate from https to file:/UNC, so a button offering it does nothing
  // when clicked. These two assertions are what stop it being reintroduced.
  it('offers NO Open button and NO "Show in folder" button', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-copy');
    expect(screen.queryByTestId('plan-of-record-open')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-folder')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.queryByText(/show in folder/i)).toBeNull();
  });

  it('renders no link to a file: URL or a UNC path anywhere in the card', async () => {
    state.row = row();
    const { container } = renderCard();
    await screen.findByTestId('plan-of-record-copy');
    for (const a of Array.from(container.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      expect(href.toLowerCase().startsWith('file:')).toBe(false);
      expect(href.startsWith('\\\\')).toBe(false);
    }
  });
});

// ------------------------------------------------------------ empty state --

describe('fix-285 the empty state is a real case, not a hypothetical', () => {
  it('renders when the project has no plan of record', async () => {
    state.row = null;
    renderCard();
    const empty = await screen.findByTestId('plan-of-record-empty');
    expect(empty).toHaveTextContent('No design set on file yet');
  });

  it('names the three things that would have counted', async () => {
    state.row = null;
    renderCard();
    const empty = await screen.findByTestId('plan-of-record-empty');
    expect(empty.textContent).toMatch(/Design.Guidance/);
    expect(empty).toHaveTextContent('Schematic');
    expect(empty).toHaveTextContent('Marketing');
  });

  it('shows no chip, no path and no actions', async () => {
    state.row = null;
    renderCard();
    await screen.findByTestId('plan-of-record-empty');
    expect(screen.queryByTestId('plan-of-record-copy')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-preview')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-filename')).toBeNull();
  });

  it('does not read like an error', async () => {
    state.row = null;
    renderCard();
    const empty = await screen.findByTestId('plan-of-record-empty');
    expect(empty.textContent?.toLowerCase()).not.toContain('error');
    expect(empty.textContent?.toLowerCase()).not.toContain('failed');
  });
});

// -------------------------------------------------------- missing thumbnail --

describe('fix-285 a missing thumbnail degrades to the file card', () => {
  it('a failed render shows the file card, never a broken image', async () => {
    state.row = row({ thumb_status: 'failed', thumb_path: null });
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview-img')).toBeNull();
    // Everything else still works.
    expect(screen.getByTestId('plan-of-record-filename')).toBeInTheDocument();
    expect(screen.getByTestId('plan-of-record-meta')).toBeInTheDocument();
    // fix-295: the path is no longer on the face, so Copy path is what has to
    // survive a failed render -- it is the only route from here to the file.
    expect(screen.getByTestId('plan-of-record-copy')).toBeInTheDocument();
  });

  it('a not-yet-generated thumbnail says so plainly', async () => {
    state.row = row({ thumb_status: null, thumb_path: null });
    renderCard();
    const note = await screen.findByTestId('plan-of-record-no-preview');
    expect(note).toHaveTextContent(/next file-server index/i);
  });

  it('a status of ok with no path still degrades rather than rendering empty src', async () => {
    state.row = row({ thumb_status: 'ok', thumb_path: null });
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview-img')).toBeNull();
  });

  it('a failed SIGNING also degrades, and shows no broken image', async () => {
    state.row = row();
    state.signError = { message: 'Object not found' };
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview-img')).toBeNull();
  });

  it('never renders an img with an empty src', async () => {
    for (const over of [
      { thumb_status: 'failed' as const, thumb_path: null },
      { thumb_status: null, thumb_path: null },
    ]) {
      state.row = row(over);
      const { unmount } = renderCard();
      await screen.findByTestId('plan-of-record-no-preview');
      for (const img of Array.from(document.querySelectorAll('img'))) {
        expect(img.getAttribute('src')).toBeTruthy();
      }
      unmount();
    }
  });
});

// --------------------------------------------------------------- lightbox --

describe('fix-285 the lightbox', () => {
  it('opens on clicking the preview and closes again', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    expect(screen.getByTestId('plan-of-record-lightbox')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-of-record-lightbox-close'));
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });

  it('closes on clicking the backdrop', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    fireEvent.click(screen.getByTestId('plan-of-record-lightbox'));
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });

  it('names the file and says which page is shown', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const lb = screen.getByTestId('plan-of-record-lightbox');
    expect(lb).toHaveTextContent('10044 - Plan Set - Marketing Update 260618.pdf');
    expect(lb).toHaveTextContent('Page 1');
  });

  it('does not invent a page COUNT it does not have', async () => {
    // The mockup showed "page 1 of 12". The view carries no page count, so
    // claiming one would be fabricating data.
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const lb = screen.getByTestId('plan-of-record-lightbox');
    expect(lb.textContent).not.toMatch(/page\s*1\s*of\s*\d+/i);
  });

  it('is not reachable when there is no preview to enlarge', async () => {
    state.row = row({ thumb_status: 'failed', thumb_path: null });
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });
});

// ------------------------------------------------------ ★ security posture --

describe('fix-285 thumbnails are SIGNED, never public', () => {
  it('mints a signed URL and renders it', async () => {
    state.row = row();
    renderCard();
    const img = await screen.findByTestId('plan-of-record-preview-img');
    expect(img.getAttribute('src')).toBe(state.signedUrl);
    expect(state.calls).toContain('createSignedUrl');
  });

  it('★ never calls getPublicUrl', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    expect(state.publicUrlCalls).toBe(0);
    expect(state.calls).not.toContain('getPublicUrl');
  });

  it('★ no public storage URL is ever constructed in the markup', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    expect(document.body.innerHTML).not.toContain('/object/public/');
  });

  it('signs against the private bucket, with a bounded lifetime', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    expect(state.buckets).toContain('plan-thumbnails');
    const [path, ttl] = state.signArgs[0];
    expect(path).toBe(`${PROJECT_ID}/marketing.jpg`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60 * 60);
  });
});

describe('fix-285 the card is READ ONLY', () => {
  it('offers no upload, replace or delete control', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-filename');
    const card = screen.getByTestId('plan-of-record-card');
    expect(card.querySelector('input[type="file"]')).toBeNull();
    for (const word of [/upload/i, /replace/i, /delete/i, /remove/i, /edit/i]) {
      expect(card.textContent ?? '').not.toMatch(word);
    }
  });

  it('issues no write against project_file_index or the bucket', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    fireEvent.click(screen.getByTestId('plan-of-record-preview'));
    fireEvent.click(screen.getByTestId('plan-of-record-lightbox-close'));
    for (const forbidden of ['insert', 'update', 'upsert', 'delete', 'upload', 'remove']) {
      expect(state.calls.some((c) => c.startsWith(forbidden))).toBe(false);
    }
  });

  it('reads from the view, not the underlying table', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-filename');
    expect(state.calls).toContain('from:project_plan_of_record');
    expect(state.calls).not.toContain('from:project_file_index');
  });
});

describe('fix-285 a failed row fetch stays calm', () => {
  it('shows a retry rather than an exception', async () => {
    state.rowError = { message: 'network' };
    renderCard();
    const err = await screen.findByTestId('plan-of-record-error');
    expect(err).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByTestId('plan-of-record-retry')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- fix-295 -----

// The card works; it was too small to do its job and spent a third of its
// height on a string nobody reads. Three changes: drop the path from the face,
// enlarge the preview, and enlarge the lightbox WITHOUT upscaling the image.

describe('fix-295 the path moved off the card face', () => {
  it('keeps Copy path, which is the only route from the card to the file', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-copy'));
    // ★ Still the FULL UNC path, even though it is no longer displayed.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(UNC));
  });

  it('still offers no Open or Show in folder (fix-289 stays fixed)', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-copy');
    expect(screen.queryByTestId('plan-of-record-open')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-folder')).toBeNull();
  });
});

describe('fix-295 the enlarge is capped by the render, not by the viewport', () => {
  /** Fire a load event carrying a natural width, the way a real bitmap would. */
  function loadWith(img: HTMLElement, naturalWidth: number) {
    Object.defineProperty(img, 'naturalWidth', {
      value: naturalWidth,
      configurable: true,
    });
    fireEvent.load(img);
  }

  // ★ THE ASSERTION THE BRIEF ASKS FOR. The thumbnails come from the scraper
  // (file_indexer/thumbnails.py, MAX_WIDTH = 900). Displaying one wider than
  // its source upscales a JPEG, so the enlarge gets bigger and LESS readable --
  // the opposite of the request. This is what stops a future change quietly
  // reintroducing that.
  it('never renders the image wider than its natural width', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const img = screen.getByTestId('plan-of-record-lightbox-img');
    loadWith(img, 900);
    expect(img.style.maxWidth).toBe('900px');
  });

  // Read from the loaded bitmap rather than hardcoded, so when the companion
  // scraper ticket raises MAX_WIDTH and re-renders, the lightbox widens on its
  // own with no change here.
  it('follows the source width rather than a hardcoded 900', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const img = screen.getByTestId('plan-of-record-lightbox-img');
    loadWith(img, 1600);
    expect(img.style.maxWidth).toBe('1600px');
  });

  it('sets no cap before the image has loaded, rather than guessing one', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    expect(
      screen.getByTestId('plan-of-record-lightbox-img').style.maxWidth,
    ).toBe('');
  });

  it('applies no transform, filter or zoom to fake extra resolution', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const img = screen.getByTestId('plan-of-record-lightbox-img');
    loadWith(img, 900);
    expect(img.style.transform).toBe('');
    expect(img.style.filter).toBe('');
    expect(img.style.imageRendering).toBe('');
  });
});
