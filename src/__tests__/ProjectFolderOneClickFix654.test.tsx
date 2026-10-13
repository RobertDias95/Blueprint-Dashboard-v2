import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  ALLOWED_SHARE_PREFIX,
  bridgeOpenUrl,
  copySharePath,
  isAllowedSharePath,
  ONE_CLICK_SETTINGS_HREF,
  openingMessage,
  OPENER_INSTALL_HREF,
  OPENER_UNINSTALL_HREF,
  pathFromBridgeOpenUrl,
  projectSharePath,
  SHARE_ROOT_CONFIG_KEY,
  shareRoot,
} from '../lib/bridgeOpen';
import { useToastStore } from '../stores/toastStore';
import type { Project } from '../lib/database.types';
// @ts-expect-error — a plain .mjs build script, no types
import { buildFiles, toCrlf, MARKER } from '../../scripts/build-bridge-opener.mjs';

// ===========================================================================
// fix-654 (P-149) — "Project folder ↗", the Bridge opener, and "Add project
// link" off Site Data.
// ===========================================================================

const cfg = vi.hoisted(() => ({ map: new Map<string, unknown>(), mayWrite: true }));
vi.mock('../hooks/useAppConfig', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useAppConfig')>()),
  useAppConfig: () => ({ map: cfg.map }),
}));
vi.mock('../hooks/useMayWriteProject', () => ({ useMayWriteProject: () => cfg.mayWrite }));

import { SiteDataBox } from '../components/ProjectDetail/ProjectOverviewBoxes';
import ShareOpenLink from '../components/ShareOpenLink';
import ToastHost from '../components/ToastHost';
import OneClickFoldersPanel from '../components/Settings/OneClickFoldersPanel';
import { INSTALL_STEPS } from '../lib/oneClickFolders';

const ROOT = '\\\\bpc-file\\SoleilData\\--- Blueprint Services ---\\Building Permits';
const P10431 = `${ROOT}\\10431 SE 19th St - Stas - Fisk`;
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

beforeEach(() => {
  useToastStore.getState().clear();
});
afterEach(() => {
  cfg.map = new Map();
  cfg.mayWrite = true;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe('fix-654 · the path and the bridge-open: link', () => {
  it('★★★ 10431: root + share_folder, and the exact link', () => {
    expect(projectSharePath(ROOT, '10431 SE 19th St - Stas - Fisk')).toBe(P10431);
    expect(bridgeOpenUrl(P10431)).toBe(
      'bridge-open:%5C%5Cbpc-file%5CSoleilData%5C---%20Blueprint%20Services%20---%5CBuilding%20Permits%5C10431%20SE%2019th%20St%20-%20Stas%20-%20Fisk',
    );
  });

  it('★★★ spaces, the --- folder, &, apostrophes and parentheses all round-trip', () => {
    for (const name of [
      '4425 41st Ave SW - D&C Homes - AW',
      "3250 29th AVE W - Jake'SD- Fisk",
      '1225 (1221 new) S Cloverdale St (Lots 9 & 10) - Habitat - Marc',
      '100% Done #2 - Builder - BP',
    ]) {
      const path = projectSharePath(ROOT, name)!;
      const url = bridgeOpenUrl(path);
      // nothing a browser or a command line could read specially survives raw
      expect(url.slice('bridge-open:'.length)).toMatch(/^[A-Za-z0-9%._~-]+$/);
      expect(pathFromBridgeOpenUrl(url)).toBe(path);
      // a browser adding a trailing slash changes nothing
      expect(pathFromBridgeOpenUrl(url + '/')).toBe(path);
    }
    expect(bridgeOpenUrl(`${ROOT}\\a&b`)).toContain('a%26b');
    expect(bridgeOpenUrl(`${ROOT}\\Jake's`)).toContain('Jake%27s');
  });

  it('★★ the Settings root: trailing backslash tolerated, anything off the share refused', () => {
    expect(shareRoot(new Map([[SHARE_ROOT_CONFIG_KEY, `${ROOT}\\`]]))).toBe(ROOT);
    expect(shareRoot(new Map([[SHARE_ROOT_CONFIG_KEY, 'C:\\Users\\x']]))).toBeNull();
    expect(shareRoot(new Map([[SHARE_ROOT_CONFIG_KEY, 'https://example.com']]))).toBeNull();
    expect(shareRoot(new Map())).toBeNull();
  });

  it('★★ a stored folder name that would walk the path is never linked', () => {
    expect(projectSharePath(ROOT, '..')).toBeNull();
    expect(projectSharePath(ROOT, '..\\..\\Windows')).toBeNull();
    expect(projectSharePath(ROOT, 'a/b')).toBeNull();
    expect(projectSharePath(ROOT, '  ')).toBeNull();
    expect(projectSharePath(null, '10431 SE 19th St - Stas - Fisk')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE ALLOWLIST. The handler on the PC is what runs, so it is tested
//     directly wherever Windows PowerShell exists (every dev PC); the TS mirror
//     runs the same table everywhere, CI included.
// ---------------------------------------------------------------------------
const ALLOW = [P10431, `${ROOT}\\4425 41st Ave SW - D&C Homes - AW`, `${ROOT}\\x\\plan.pdf`];
const REFUSE = [
  // ★★★ ONLY THE ROOT CHECK STOPS THESE TWO — clean, well-formed paths on
  //     another share / another server. (The first red-proof run passed with
  //     the root check deleted, because every other case here is also caught
  //     by a character or segment rule; these were added so it cannot.)
  '\\\\bpc-file\\OtherShare\\Folder\\Sub',
  '\\\\evil-server-name\\Public\\Downloads\\run.pdf',
  '\\\\bpc-file\\SoleilData\\..\\..\\Windows',
  '\\\\bpc-file\\SoleilData\\a\\..\\..\\Windows',
  '\\\\bpc-file\\SoleilData\\a\\...\\b',
  '\\\\evil\\share\\x.exe',
  '\\\\bpc-file\\SoleilDataX\\y',
  '\\\\bpc-file\\SoleilData\\',
  '\\\\bpc-file\\SoleilData',
  'C:\\Windows\\System32',
  '\\\\bpc-file\\SoleilData\\a"&calc',
  '\\\\bpc-file\\SoleilData\\a\\\\b',
  '\\\\bpc-file\\SoleilData\\a:stream',
  '\\\\bpc-file\\SoleilData\\a/../b',
  '\\\\bpc-file\\SoleilData\\a\nb',
  '',
];

describe('fix-654 · the allowlist (TS mirror of the handler)', () => {
  it('★★★ allows only paths under \\\\bpc-file\\SoleilData\\', () => {
    for (const p of ALLOW) expect(isAllowedSharePath(p), p).toBe(true);
    for (const p of REFUSE) expect(isAllowedSharePath(p), JSON.stringify(p)).toBe(false);
    expect(isAllowedSharePath('\\\\BPC-FILE\\soleildata\\x')).toBe(true); // Windows ignores case
  });
});

const HANDLER = resolve(process.cwd(), 'public/bridge-opener/bridge-open.ps1');
const hasWindowsPowerShell =
  process.platform === 'win32' &&
  spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe.runIf(hasWindowsPowerShell)('fix-654 · the REAL handler (Windows PowerShell 5.1)', () => {
  // ★ ONE PowerShell process for the whole table: -DryRun prints ALLOW/REFUSE
  //   per link and opens nothing.
  function verdicts(links: string[]): string[] {
    const script =
      `$links = @(${links.map((l) => `'${l.replace(/'/g, "''")}'`).join(',')}); ` +
      `foreach ($l in $links) { & '${HANDLER}' $l -DryRun }`;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8' },
    );
    return r.stdout.trim().split(/\r?\n/);
  }

  it('★★★ refuses everything outside \\\\bpc-file\\SoleilData\\ and opens what is inside', () => {
    const refused = REFUSE.filter((p) => p !== '').map(bridgeOpenUrl);
    // ★ and a link that is not ours at all
    refused.push('http:%5C%5Cbpc-file%5CSoleilData%5Ca', 'bridge-open:%ZZ');
    const out = verdicts([...ALLOW.map(bridgeOpenUrl), ...refused]);
    expect(out).toEqual([...ALLOW.map((p) => `ALLOW ${p}`), ...refused.map(() => 'REFUSE')]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('fix-654 · the opener files the Bridge serves', () => {
  const files = buildFiles() as Record<string, string>;

  it('★★★ the committed downloads are exactly what opener/ builds (CRLF, ASCII)', () => {
    for (const [name, text] of Object.entries(files)) {
      const committed = readFileSync(resolve(process.cwd(), 'public/bridge-opener', name));
      expect(committed.toString('latin1'), `${name} is stale — run node scripts/build-bridge-opener.mjs`).toBe(
        toCrlf(text),
      );
      expect([...committed].every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127))).toBe(true);
    }
    expect(existsSync(resolve(process.cwd(), 'public', OPENER_INSTALL_HREF.slice(1)))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'public', OPENER_UNINSTALL_HREF.slice(1)))).toBe(true);
  });

  it('★★★ the installer carries the handler, registers HKCU only, and never downloads', () => {
    const install = files['Install-BridgeOpener.cmd'];
    expect(install).toContain(files['bridge-open.ps1'].trimEnd());
    expect(install).toContain("'HKCU:\\Software\\Classes\\bridge-open'");
    expect(install).not.toMatch(/HKLM|Invoke-WebRequest|DownloadString|DownloadFile|Start-BitsTransfer|curl|wget/i);
    // the batch header reaches the PowerShell half and stops before it
    expect(install.indexOf(MARKER)).toBeGreaterThan(install.indexOf('exit /b'));
    // the marker literal appears once — the header splits it so IndexOf finds the real one
    expect(install.split(MARKER)).toHaveLength(2);
  });

  it('★★ the handler and the TS mirror share the root and refuse the same characters', () => {
    const handler = files['bridge-open.ps1'];
    expect(handler).toContain(`$AllowedRoot = '${ALLOWED_SHARE_PREFIX}'`);
    expect(handler).toContain(`'[\\x00-\\x1f"*?<>|/:]'`);
    expect(read('src/lib/bridgeOpen.ts')).toContain('/[\\x00-\\x1f"*?<>|/:]/');
    // it never runs a program: no Invoke-Expression, no cmd, no script types
    expect(handler).not.toMatch(/Invoke-Expression|\biex\b|cmd\.exe|\.exe'\s*,\s*'\.bat/i);
    expect(handler).not.toMatch(/'\.(exe|bat|cmd|ps1|vbs|js|lnk|msi|com|scr)'/i);
  });

  it('★ the uninstaller removes only the key and the folder it made', () => {
    const un = files['Uninstall-BridgeOpener.cmd'];
    expect(un).toContain("'HKCU:\\Software\\Classes\\bridge-open'");
    expect(un).toContain("Join-Path $env:LOCALAPPDATA 'BridgeOpener'");
    expect(un.match(/Remove-Item/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe('fix-654 · Site Data', () => {
  const project = (over: Partial<Project> = {}) =>
    ({ id: 'p1', address: '10431 SE 19th St', juris: 'Bellevue', project_tags: [], updated_at: 'x', ...over }) as Project;
  const renderBox = (p: Project) =>
    render(
      <MemoryRouter>
        <SiteDataBox project={p} allProjects={[]} unitTypes={[]} />
      </MemoryRouter>,
    );

  it('★★★ "Project folder ↗" under Drone when the project has a share folder', () => {
    cfg.map = new Map([[SHARE_ROOT_CONFIG_KEY, ROOT]]);
    renderBox(project({ share_folder: '10431 SE 19th St - Stas - Fisk' }));
    const link = screen.getByTestId('pd-site-folder-link');
    expect(link).toHaveTextContent('Project folder ↗');
    expect(link.getAttribute('href')).toBe(bridgeOpenUrl(P10431));
    expect(screen.getByTestId('pd-site-folder-row')).toHaveTextContent('Folder');
    const rows = Array.from(document.querySelectorAll('[data-testid$="-row"]')).map((r) => r.getAttribute('data-testid'));
    expect(rows.slice(rows.indexOf('pd-site-drone-row'))).toEqual(['pd-site-drone-row', 'pd-site-folder-row']);
  });

  it('★★ hidden with no share folder, or with no root in Settings', () => {
    cfg.map = new Map([[SHARE_ROOT_CONFIG_KEY, ROOT]]);
    renderBox(project());
    expect(screen.queryByTestId('pd-site-folder-row')).toBeNull();
    cfg.map = new Map();
    renderBox(project({ id: 'p2', share_folder: '10431 SE 19th St - Stas - Fisk' }));
    expect(screen.queryByTestId('pd-site-folder-row')).toBeNull();
  });

  it('★★★ "Add project link" is gone from Site Data; Project Data → Site keeps the field', () => {
    cfg.map = new Map([['droneFootageFolderUrl', 'https://x.sharepoint.com/shared?id=%2FDrone%20Photos']]);
    renderBox(project({ share_folder: 'x' }));
    expect(screen.queryByText('Add project link')).toBeNull();
    expect(screen.queryByTestId('pd-site-drone-add')).toBeNull();
    const editors = read('src/components/ProjectDetail/ProjectDataEditors.tsx');
    expect(editors).toContain('id="drone-video-url"');
    expect(editors).toContain('export function DroneLinkRow');
  });
});

// ---------------------------------------------------------------------------
describe('fix-654 · the copy fallback always fires', () => {
  it('★★★ a click copies the path and toasts, linking to the setup', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ShareOpenLink path={P10431} kind="folder" testId="l">
        Project folder ↗
      </ShareOpenLink>,
    );
    const a = screen.getByTestId('l');
    // ★ the link itself does the opening — the handler must not cancel it
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => {
      a.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(writeText).toHaveBeenCalledWith(P10431);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const t = useToastStore.getState().toasts[0];
    expect(t.message).toBe('Opening folder… (path copied — if nothing opened, set up one-click folders)');
    expect(t.link).toEqual({ label: 'Set up one-click folders', href: ONE_CLICK_SETTINGS_HREF });
  });

  it('★★ a refused clipboard still toasts, and says so', async () => {
    expect(await copySharePath(P10431, { writeText: () => Promise.reject(new Error('no')) })).toBe(false);
    // ★ a browser with no async clipboard at all (passing `undefined` would
    //   just pick up the default)
    expect(await copySharePath(P10431, {} as never)).toBe(false);
    expect(openingMessage('file', false)).toBe(
      'Opening file… (could not copy the path — if nothing opened, set up one-click folders)',
    );
  });

  it('★ the toast link navigates in-app', () => {
    const onNavigate = vi.fn();
    render(<ToastHost onNavigate={onNavigate} />);
    act(() => {
      useToastStore.getState().push('Opening folder…', 'info', {
        link: { label: 'Set up one-click folders', href: ONE_CLICK_SETTINGS_HREF },
      });
    });
    const id = useToastStore.getState().toasts[0].id;
    fireEvent.click(screen.getByTestId(`toast-link-${id}`));
    expect(onNavigate).toHaveBeenCalledWith(ONE_CLICK_SETTINGS_HREF);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('fix-654 · Settings → My account → One-click folders', () => {
  it('★★★ Download / Remove, and the numbered steps', () => {
    render(<OneClickFoldersPanel />);
    expect(screen.getByTestId('one-click-download').getAttribute('href')).toBe(OPENER_INSTALL_HREF);
    expect(screen.getByTestId('one-click-download').hasAttribute('download')).toBe(true);
    expect(screen.getByTestId('one-click-remove').getAttribute('href')).toBe(OPENER_UNINSTALL_HREF);
    const items = screen.getByTestId('one-click-steps').querySelectorAll('li');
    expect(items).toHaveLength(INSTALL_STEPS.length);
    // ★ the words Chrome and Windows show, named
    const all = screen.getByTestId('one-click-folders').textContent ?? '';
    for (const w of ['Keep', 'Windows protected your PC', 'More info', 'Run anyway', 'Open Bridge opener?', 'Always allow']) {
      expect(all).toContain(w);
    }
  });
});
