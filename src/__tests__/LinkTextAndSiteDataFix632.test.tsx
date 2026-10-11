import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shareLinkAnchorHtml,
  shareLinkText,
  writeShareLinkToClipboard,
} from '../lib/shareLinkText';
import { draftHtmlBody } from '../lib/outlookDraft';
import { checkDroneUrl, DRONE_FOLDER_CONFIG_KEY, droneFolderUrl, googleMapsUrl } from '../lib/siteLinks';
import { SITE_DATES_RESPONSIVE_CSS } from '../lib/projectCardLayout';
import type { Project } from '../lib/database.types';

// ===========================================================================
// fix-632 (P-325, P-328) — share links read as "address — set"; Google Maps and
// drone links under Site Data; Site Data and Dates equal widths.
// ===========================================================================

const cfg = vi.hoisted(() => ({ map: new Map<string, unknown>(), mayWrite: true }));
vi.mock('../hooks/useAppConfig', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useAppConfig')>()),
  useAppConfig: () => ({ map: cfg.map }),
}));
vi.mock('../hooks/useMayWriteProject', () => ({ useMayWriteProject: () => cfg.mayWrite }));

import { SiteDataBox } from '../components/ProjectDetail/ProjectOverviewBoxes';
import { DroneLinkRow } from '../components/ProjectDetail/ProjectDataEditors';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').split('\r\n').join('\n');
const FOLDER =
  'https://blueprintcap-my.sharepoint.com/shared?listurl=https%3A%2F%2Fblueprintcap%2Dmy%2Esharepoint%2Ecom%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments&id=%2Fpersonal%2Fblake%5Fblueprintcap%5Fcom%2FDocuments%2FDrone%20Photos&ct=1791661069093&or=Teams%2DHL&shareLink=1&ga=1&LOF=1';

afterEach(() => {
  cfg.map = new Map();
  cfg.mayWrite = true;
});

// ---------------------------------------------------------------------------
describe('fix-632 §A: a share link reads "<address> — <set label>"', () => {
  it('★★★ the text, and the label alone with no address', () => {
    expect(shareLinkText('2601 E Galer St', 'Marketing')).toBe('2601 E Galer St — Marketing');
    expect(shareLinkText('  120 7th Ave W ', 'Schematic')).toBe('120 7th Ave W — Schematic');
    expect(shareLinkText(null, 'Site Plan')).toBe('Site Plan');
  });

  it('★★★ the Email PDF draft: View online: <a>address — set</a> (link expires …)', () => {
    expect(
      draftHtmlBody('2601 E Galer St', 'Marketing', {
        url: 'https://blueprint-dashboard-v2.onrender.com/s/4zpSkT0WkeMhGpABtnOatw',
        expiresOn: 'Oct 15, 2026',
        text: shareLinkText('2601 E Galer St', 'Marketing'),
      }),
    ).toBe(
      '<p>Attached: the Marketing plan set for 2601 E Galer St.</p>' +
        '<p>View online: <a href="https://blueprint-dashboard-v2.onrender.com/s/4zpSkT0WkeMhGpABtnOatw">' +
        '2601 E Galer St — Marketing</a> (link expires Oct 15, 2026)</p>',
    );
  });

  it('★★ the address and label are ESCAPED', () => {
    expect(shareLinkAnchorHtml('https://x.y/s/t', shareLinkText('1 <b>A</b> & "B"', 'Site Plan'))).toBe(
      '<a href="https://x.y/s/t">1 &lt;b&gt;A&lt;/b&gt; &amp; &quot;B&quot; — Site Plan</a>',
    );
    expect(draftHtmlBody('<i>x</i>', 'Marketing', { url: 'https://x.y/s/t', expiresOn: '', text: '<i>x</i> — Marketing' }))
      .toContain('<a href="https://x.y/s/t">&lt;i&gt;x&lt;/i&gt; — Marketing</a>');
    expect(shareLinkAnchorHtml('javascript:alert(1)', 'x')).toBeNull();
  });

  it('★★★ Copy link puts a RICH link on the clipboard: html = the anchor, plain = the bare URL', async () => {
    const written: Array<Record<string, Blob>> = [];
    class FakeItem {
      data: Record<string, Blob>;
      constructor(data: Record<string, Blob>) {
        this.data = data;
        written.push(data);
      }
    }
    const clipboard = { write: vi.fn().mockResolvedValue(undefined), writeText: vi.fn() };
    const r = await writeShareLinkToClipboard(
      'https://blueprint-dashboard-v2.onrender.com/s/tok',
      '224 2nd Ave N — Marketing',
      clipboard,
      FakeItem as unknown as typeof ClipboardItem,
    );
    expect(r).toBe('rich');
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(await written[0]['text/html'].text()).toBe(
      '<a href="https://blueprint-dashboard-v2.onrender.com/s/tok">224 2nd Ave N — Marketing</a>',
    );
    expect(await written[0]['text/plain'].text()).toBe('https://blueprint-dashboard-v2.onrender.com/s/tok');
  });

  it('★★★ no ClipboardItem → the bare URL, exactly as before (and the same when the rich write is refused)', async () => {
    const plain = { writeText: vi.fn().mockResolvedValue(undefined) };
    expect(await writeShareLinkToClipboard('https://x.y/s/t', 'A — Marketing', plain, undefined)).toBe('plain');
    expect(plain.writeText).toHaveBeenCalledWith('https://x.y/s/t');

    const refusing = { write: vi.fn().mockRejectedValue(new Error('no html')), writeText: vi.fn().mockResolvedValue(undefined) };
    class Item {
      d: unknown;
      constructor(d: unknown) {
        this.d = d;
      }
    }
    expect(
      await writeShareLinkToClipboard('https://x.y/s/t', 'A — Marketing', refusing, Item as unknown as typeof ClipboardItem),
    ).toBe('plain');
    expect(refusing.writeText).toHaveBeenCalledWith('https://x.y/s/t');
  });

  it('★★ every Copy link passes its text: the card and the enlarged view', () => {
    const card = read('src/components/ProjectDetail/PlanOfRecordCard.tsx');
    expect(card).toContain('share.copy(row.set_type, shareVariant(b.variant), shareLinkText(address, b.label))');
    expect(card).toContain('shareLinkText(address, lightboxSetLabel(row.set_type, shownSet))');
    expect(read('src/hooks/usePlanShare.ts')).toContain('await writeShareLinkToClipboard(url, linkText ?? url);');
  });
});

// ---------------------------------------------------------------------------
describe('fix-632 §B: the map and drone links', () => {
  it('★★ Google Maps at the address (no API key)', () => {
    expect(googleMapsUrl('2601 E Galer St', 'Seattle')).toBe(
      'https://www.google.com/maps/search/?api=1&query=2601%20E%20Galer%20St%2C%20Seattle',
    );
    expect(googleMapsUrl('', 'Seattle')).toBeNull();
  });

  it('★★★ only http(s) is accepted — and a server path is refused by name', () => {
    expect(checkDroneUrl('')).toEqual({ ok: true, value: null });
    expect(checkDroneUrl(FOLDER)).toEqual({ ok: true, value: FOLDER });
    const unc = checkDroneUrl('\\\\bpc-file\\Drone\\224.mp4');
    expect(unc.ok).toBe(false);
    expect(!unc.ok && unc.message).toMatch(/server path, and a browser can't open those/);
    expect(checkDroneUrl('X:\\drone\\a.mp4').ok).toBe(false);
    expect(checkDroneUrl('www.example.com/v').ok).toBe(false);
  });

  const project = (over: Partial<Project> = {}) =>
    ({ id: 'p1', address: '2601 E Galer St', juris: 'Seattle', project_tags: [], updated_at: 'x', ...over }) as Project;
  const renderBox = (p: Project) =>
    render(
      <MemoryRouter>
        <SiteDataBox project={p} allProjects={[]} unitTypes={[]} />
      </MemoryRouter>,
    );

  it('★★★ Site Data, under Tags: Google Maps ↗ and the project\'s own Drone video ↗', () => {
    renderBox(project({ drone_video_url: 'https://blueprintcap-my.sharepoint.com/x/224.mp4' }));
    const map = screen.getByTestId('pd-site-map-link');
    expect(map).toHaveTextContent('Google Maps ↗');
    expect(map.getAttribute('target')).toBe('_blank');
    expect(map.getAttribute('href')).toBe(googleMapsUrl('2601 E Galer St', 'Seattle'));
    expect(screen.getByTestId('pd-site-drone-link')).toHaveTextContent('Drone video ↗');
    // ★ under Tags, in that order
    const rows = Array.from(document.querySelectorAll('[data-testid$="-row"]')).map((r) => r.getAttribute('data-testid'));
    expect(rows.slice(rows.indexOf('pd-site-tags-row'))).toEqual(['pd-site-tags-row', 'pd-site-map-row', 'pd-site-drone-row']);
  });

  it('★★★ no project link → the shared folder, and "Add project link" for editors', () => {
    cfg.map = new Map([[DRONE_FOLDER_CONFIG_KEY, FOLDER]]);
    renderBox(project());
    expect(screen.getByTestId('pd-site-drone-folder')).toHaveTextContent('Footage folder ↗');
    expect(screen.getByTestId('pd-site-drone-folder').getAttribute('href')).toBe(FOLDER);
    expect(screen.getByTestId('pd-site-drone-add')).toHaveTextContent('Add project link');
    expect(screen.getByTestId('pd-site-drone-add').getAttribute('href')).toBe('/?data=site#drone-video-url');
  });

  it('★★ neither → a muted "Add drone link" for editors; nothing to click for others', () => {
    renderBox(project());
    expect(screen.getByTestId('pd-site-drone-add')).toHaveTextContent('Add drone link');
    cfg.mayWrite = false;
    renderBox(project({ id: 'p2' }));
    expect(screen.getAllByTestId('pd-site-drone-row')[1]).toHaveTextContent('none');
  });

  it('★★★ the editor: a server path shows the sentence and saves nothing; a web link saves', () => {
    const onCommit = vi.fn();
    render(<DroneLinkRow project={project()} disabled={false} onCommit={onCommit} />);
    const input = screen.getByTestId('pd-site-drone-input');
    fireEvent.change(input, { target: { value: '\\\\bpc-file\\Drone\\x.mp4' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('pd-site-drone-error')).toHaveTextContent(/server path/);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' https://blueprintcap-my.sharepoint.com/x.mp4 ' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('https://blueprintcap-my.sharepoint.com/x.mp4');
    expect(screen.queryByTestId('pd-site-drone-error')).toBeNull();
  });

  it('★ the Settings folder value is read only when it is a web link', () => {
    expect(droneFolderUrl(new Map([[DRONE_FOLDER_CONFIG_KEY, FOLDER]]))).toBe(FOLDER);
    expect(droneFolderUrl(new Map([[DRONE_FOLDER_CONFIG_KEY, '\\\\srv\\x']]))).toBeNull();
    expect(droneFolderUrl(new Map())).toBeNull();
  });

  it('★★★ the new column is in useProjects\' explicit select list and named for toasts', () => {
    expect(read('src/hooks/useProjects.ts')).toMatch(/'drone_video_url',/);
    expect(read('src/lib/savedPatchAudit.ts')).toContain("drone_video_url: 'Drone video link',");
  });

  it('★★★ the migration: column + CHECK, the atomic RPC by anchor, one seeded row with its tenant', () => {
    const sql = read('migrations/fix_632_drone_video_link.sql').replace(/--.*$/gm, '');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS drone_video_url text;/);
    expect(sql).toMatch(/CHECK \(drone_video_url IS NULL OR drone_video_url ~\* '\^https\?:\/\/\\S\+\$'\)/);
    expect(sql).toMatch(/md5\(v_src\) <> 'd862e98e797ce4c0d787949a51521851'/);
    expect(sql).toContain("v_anchor constant text := 'ELSE alley END,';");
    expect(sql).toMatch(/INSERT INTO public\.app_config \(key, value, tenant_id\)[\s\S]*'droneFootageFolderUrl'[\s\S]*'00000000-0000-0000-0000-000000000001'[\s\S]*ON CONFLICT \(key\) DO NOTHING;/);
    // the only row written is that one insert; nothing updated or deleted
    expect((sql.match(/^\s*(UPDATE|DELETE|TRUNCATE|DROP)\b.*$/gim) ?? [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('fix-632 §C: Site Data and Dates are equal widths', () => {
  it('★★★ both tracks are 1fr (each keeps its own floor)', () => {
    expect(SITE_DATES_RESPONSIVE_CSS).toMatch(/grid-template-columns:minmax\(154px,1fr\) minmax\(156px,1fr\)/);
    expect(SITE_DATES_RESPONSIVE_CSS).not.toContain('1.25fr');
  });
});
