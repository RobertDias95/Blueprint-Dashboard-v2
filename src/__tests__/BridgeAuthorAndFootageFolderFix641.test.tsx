import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import {
  BRIDGE_AUTHOR_LABEL,
  NO_AUTHOR_LABEL,
  crThreadBody,
  isSystemPost,
} from '../lib/projectChat';
import {
  DRONE_FOLDER_CONFIG_KEY,
  folderAddresses,
  footageLink,
  matchDroneFolders,
  normaliseAddress,
  projectFolderUrl,
  sharePointEncode,
} from '../lib/siteLinks';
import type { Project, ProjectMessage } from '../lib/database.types';

// ===========================================================================
// fix-641 (P-336, P-337) — posts the Bridge created itself say "The Bridge"
// with its logo; "Footage folder" opens each project's own drone folder.
// ===========================================================================

const cfg = vi.hoisted(() => ({ map: new Map<string, unknown>(), mayWrite: true }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u-1', email: 'robertd@blueprintcap.com' },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateTaskFromMessage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));
vi.mock('../hooks/useAppConfig', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useAppConfig')>()),
  useAppConfig: () => ({ map: cfg.map }),
}));
vi.mock('../hooks/useMayWriteProject', () => ({ useMayWriteProject: () => cfg.mayWrite }));

import ChatMessageRow from '../components/ProjectDetail/ChatMessageRow';
import { SiteDataBox } from '../components/ProjectDetail/ProjectOverviewBoxes';

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8').split('\r\n').join('\n');

afterEach(() => {
  cfg.map = new Map();
  cfg.mayWrite = true;
});

// ---------------------------------------------------------------------------
// §A — the Bridge signs its own posts
// ---------------------------------------------------------------------------

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: null,
    author_name: null,
    body: crThreadBody(3),
    mentions: [],
    attachments: [],
    created_at: '2026-10-06T10:00:00Z',
    task_id: null,
    task_text: null,
    task_permit_id: null,
    parent_message_id: null,
    title: 'CR 3',
    edited_at: null,
    deleted_at: null,
    revisions: [],
    reply_count: null,
    last_activity_at: null,
    ...over,
  } as unknown as ProjectMessage;
}

function renderRow(msg: ProjectMessage) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ChatMessageRow message={msg} projectId="p-1" userId="u-1" people={[]} permits={[]} variant="post" />,
    { wrapper },
  );
}

describe('fix-641 §A: which posts are the Bridge\'s', () => {
  it('★★★ the minted CR thread and every seeded phase post are system posts', () => {
    expect(isSystemPost(message())).toBe(true);
    expect(isSystemPost(message({ title: 'CR 1', body: crThreadBody(1) }))).toBe(true);
    expect(
      isSystemPost(message({ title: 'ACQ Questions', body: 'Anything acquisitions — questions for the ACQ team live here.' })),
    ).toBe(true);
    expect(
      isSystemPost(message({ title: 'Design Phase', body: 'Design through intake: drawings, consultants, and the submittal set.' })),
    ).toBe(true);
    expect(
      isSystemPost(message({ title: 'Preliminary Assessment', body: "The city's initial comments on what we are submitting." })),
    ).toBe(true);
    expect(isSystemPost(message({ title: 'General', body: 'General discussion for this project.' }))).toBe(true);
  });

  it('★★★ a seeded post stays the Bridge\'s even though the seed stamped a person', () => {
    // bp_seed_project_posts writes auth.uid() — the project's creator.
    expect(isSystemPost(message({ author_id: 'u-1', author_name: 'Bobby' }))).toBe(true);
  });

  it('★★★ a missing author alone is NOT the Bridge — an imported human reply stays human', () => {
    expect(isSystemPost(message({ parent_message_id: 'post-1', title: null, body: 'Called the city.' }))).toBe(false);
  });

  it('★★ a person\'s own post, or an edited seed, is not the Bridge\'s', () => {
    expect(isSystemPost(message({ title: 'Design Phase', body: 'All things design to intake' }))).toBe(false);
    expect(isSystemPost(message({ title: 'CR 3', body: crThreadBody(2) }))).toBe(false);
    expect(isSystemPost(message({ title: 'Correction Round 3', body: crThreadBody(3) }))).toBe(false);
    // A reply that happens to repeat a seed body is still a reply.
    expect(isSystemPost(message({ parent_message_id: 'post-1' }))).toBe(false);
  });

  it('★★ the bodies are the ones the SQL writes (mirror pin)', () => {
    const cr = read('migrations/fix_381_cr_threads.sql');
    expect(cr).toContain("'The first round of city corrections — what came back, and who is clearing what.'");
    expect(cr).toContain("' of city corrections — what came back, and who is clearing what.'");
    const seed = read('migrations/fix_381_cr_threads.sql') + read('migrations/fix_344_sd_reassign_and_default_posts.sql');
    expect(seed).toContain('Anything acquisitions — questions for the ACQ team live here.');
    expect(seed).toContain('Design through intake: drawings, consultants, and the submittal set.');
    expect(seed).toContain("The city''s initial comments on what we are submitting.");
    expect(read('migrations/fix_542_notes_to_general_PENDING_APPROVAL.sql')).toContain('General discussion for this project.');
  });
});

describe('fix-641 §A: the row', () => {
  it('★★★ a system post shows "The Bridge" and the Bridge logo', () => {
    renderRow(message());
    expect(screen.getByTestId('project-chat-author-m-1')).toHaveTextContent(BRIDGE_AUTHOR_LABEL);
    expect(screen.getByTestId('project-chat-author-m-1').getAttribute('data-by-system')).toBe('true');
    expect(screen.getByTestId('chat-avatar').getAttribute('data-bridge')).toBe('true');
    expect(screen.getByTestId('chat-avatar-bridge')).toBeInTheDocument();
  });

  it('★★★ a human message with a null author keeps "Not recorded" and initials', () => {
    renderRow(message({ parent_message_id: 'post-1', title: null, body: 'Called the city.' }));
    expect(screen.getByTestId('project-chat-author-m-1')).toHaveTextContent(NO_AUTHOR_LABEL);
    expect(screen.getByTestId('project-chat-author-m-1')).not.toHaveTextContent(BRIDGE_AUTHOR_LABEL);
    expect(screen.queryByTestId('chat-avatar-bridge')).toBeNull();
  });

  it('★★ a seeded post the creator was stamped on reads "The Bridge", not their name', () => {
    renderRow(message({ author_id: 'u-1', author_name: 'Bobby' }));
    expect(screen.getByTestId('project-chat-author-m-1')).toHaveTextContent(BRIDGE_AUTHOR_LABEL);
    expect(screen.getByTestId('project-chat-author-m-1')).not.toHaveTextContent('Bobby');
  });
});

// ---------------------------------------------------------------------------
// §B — the footage folder
// ---------------------------------------------------------------------------

const SHARED =
  'https://blueprintcap-my.sharepoint.com/shared?listurl=https%3A%2F%2Fblueprintcap%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments&id=%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments%2FDrone%20Photos&ct=1791661069093&or=Teams%2DHL&shareLink=1&ga=1&LOF=1';
const SHARED_ID = '%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments%2FDrone%20Photos';

describe('fix-641 §B: the URL', () => {
  it('★★★ 10431 — the exact link Cowork opened in Bobby\'s browser', () => {
    expect(projectFolderUrl(SHARED, '10431 SE 19th St - Bellevue')).toBe(
      SHARED.replace(
        `id=${SHARED_ID}&`,
        `id=${SHARED_ID}%2F10431%20SE%2019th%20St%20%2D%20Bellevue&`,
      ),
    );
  });

  it('★★ spaces are %20, commas %2C, hyphens %2D — and the rest of the URL is untouched', () => {
    const url = projectFolderUrl(SHARED, '1301, 1303, 1307 6th Ave N')!;
    expect(url).toContain(`${SHARED_ID}%2F1301%2C%201303%2C%201307%206th%20Ave%20N&ct=`);
    expect(url.startsWith(SHARED.slice(0, SHARED.indexOf('&id=')))).toBe(true);
    expect(url.endsWith('&ct=1791661069093&or=Teams%2DHL&shareLink=1&ga=1&LOF=1')).toBe(true);
    expect(sharePointEncode("a-b_c.d")).toBe('a%2Db%5Fc%2Ed');
  });

  it('★ no folder, no shared link, or a shared link without id= → null', () => {
    expect(projectFolderUrl(SHARED, null)).toBeNull();
    expect(projectFolderUrl(SHARED, '  ')).toBeNull();
    expect(projectFolderUrl(null, '2601 E Galer St')).toBeNull();
    expect(projectFolderUrl('https://x.sharepoint.com/:f:/g/abc', '2601 E Galer St')).toBeNull();
  });
});

describe('fix-641 §B: the matching rule (mirror of the seed)', () => {
  const projects = [
    { id: 'a', address: '10431 SE 19th St' },
    { id: 'b', address: '2601 E GALER ST' },
    { id: 'c', address: '1301 6th Ave N' },
    { id: 'd', address: '1303 6th Avenue North' },
    { id: 'e', address: '552 NE 89th St' },
    { id: 'f', address: '524 NE 89th ST' },
    { id: 'g', address: '548 3rd Ave N' },
    { id: 'h', address: '548 3rd Ave N' },
  ];
  const ids = (folder: string) => matchDroneFolders([folder], projects)[0].projectIds;

  it('★★★ a trailing " - City" is stripped', () => {
    expect(folderAddresses('10431 SE 19th St - Bellevue')).toEqual(['10431 SE 19th St']);
    expect(ids('10431 SE 19th St - Bellevue')).toEqual(['a']);
  });

  it('★★★ ST / St / Street and N / North are the same word', () => {
    expect(normaliseAddress('2601 E GALER ST')).toBe(normaliseAddress('2601 East Galer Street'));
    expect(ids('2601 E Galer St')).toEqual(['b']);
  });

  it('★★★ a comma list maps to each address on the shared street', () => {
    expect(folderAddresses('1301, 1303, 1307 6th Ave N')).toEqual([
      '1301 6th Ave N',
      '1303 6th Ave N',
      '1307 6th Ave N',
    ]);
    expect(ids('1301, 1303, 1307 6th Ave N')).toEqual(['c', 'd']);
    // ★ a list this rule does not understand yields nothing, not a guess
    expect(folderAddresses('1301 6th Ave N, Rear')).toEqual([]);
  });

  it('★★★ never fuzzy: a near miss matches nothing', () => {
    expect(ids('526 NE 89th St')).toEqual([]);
    expect(ids('10431 SE 19th Pl')).toEqual([]);
    expect(ids('10431 SE 19th St Unit B')).toEqual([]);
  });

  it('★★ two projects at one identical address both get the folder', () => {
    expect(ids('548 3rd Ave N')).toEqual(['g', 'h']);
  });

  it('★★ the SQL token map and this one agree, pair for pair', () => {
    const sql = read('migrations/fix_641_drone_folder.sql');
    const pairs = [...sql.matchAll(/WHEN '([a-z]+)' THEN '([a-z]+)'/g)];
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    for (const [, from, to] of pairs) expect(normaliseAddress(from)).toBe(to);
  });
});

describe('fix-641 §B: the link priority and the label', () => {
  it('★★★ pasted link → the project\'s folder → the shared folder → none', () => {
    const own = 'https://blueprintcap-my.sharepoint.com/x/224.mp4';
    expect(footageLink({ drone_video_url: own, drone_folder: '224 2nd Ave N' }, SHARED)).toEqual({ kind: 'own', href: own });
    expect(footageLink({ drone_folder: '224 2nd Ave N' }, SHARED)).toEqual({
      kind: 'project-folder',
      href: projectFolderUrl(SHARED, '224 2nd Ave N'),
    });
    expect(footageLink({ drone_folder: null }, SHARED)).toEqual({ kind: 'shared-folder', href: SHARED });
    expect(footageLink({ drone_folder: '224 2nd Ave N' }, null)).toEqual({ kind: 'none' });
  });

  const project = (over: Partial<Project> = {}) =>
    ({ id: 'p1', address: '10431 SE 19th St', juris: 'Bellevue', project_tags: [], updated_at: 'x', ...over }) as Project;
  const renderBox = (p: Project) =>
    render(
      <MemoryRouter>
        <SiteDataBox project={p} allProjects={[]} unitTypes={[]} />
      </MemoryRouter>,
    );

  it('★★★ Site Data: "Footage folder ↗" opens the project\'s own folder (fix-654: "Add project link" gone)', () => {
    cfg.map = new Map([[DRONE_FOLDER_CONFIG_KEY, SHARED]]);
    renderBox(project({ drone_folder: '10431 SE 19th St - Bellevue' }));
    const a = screen.getByTestId('pd-site-drone-folder');
    expect(a).toHaveTextContent('Footage folder ↗');
    expect(a).not.toHaveTextContent('Drone');
    expect(a.getAttribute('data-folder-kind')).toBe('project');
    expect(a.getAttribute('href')).toBe(projectFolderUrl(SHARED, '10431 SE 19th St - Bellevue'));
    // ★ fix-654 (P-149) removed it from Site Data; Project Data → Site keeps it.
    expect(screen.queryByTestId('pd-site-drone-add')).toBeNull();
  });

  it('★★ no matched folder → the shared library, as before', () => {
    cfg.map = new Map([[DRONE_FOLDER_CONFIG_KEY, SHARED]]);
    renderBox(project());
    const a = screen.getByTestId('pd-site-drone-folder');
    expect(a.getAttribute('data-folder-kind')).toBe('shared');
    expect(a.getAttribute('href')).toBe(SHARED);
  });

  it('★★ the column is on the projects select list (an unlisted column is silently undefined)', () => {
    expect(read('src/hooks/useProjects.ts')).toContain("'drone_folder',");
  });
});
