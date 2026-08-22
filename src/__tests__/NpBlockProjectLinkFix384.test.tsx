import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import migrationSql from '../../migrations/fix_384_np_block_project_link.sql?raw';
import candidatesSql from '../../migrations/fix_384_label_candidates_PENDING_APPROVAL.sql?raw';
import vendorReportSource from '../lib/vendorReport.ts?raw';
import builtinReportsSource from '../lib/builtinReports.ts?raw';
import volumeSource from '../lib/teamPerformance.ts?raw';
import redesignSource from '../lib/redesignAnalytics.ts?raw';
import NpBlockEditPopup from '../components/NpBlockEditPopup';
import type { DaTimeBlock } from '../lib/database.types';

// ===========================================================================
// fix-384 — people are typing project addresses into a label because there is
//           no link
// ===========================================================================
//
// 5831 104th Ave NE took two design windows months apart. The first is stored
// (draw_schedule, Nicky, dd_start 2025-03-31 → dd_end 2025-04-25, manually
// placed). The second, 9–27 Jun 2025, could not be: draw_schedule's PRIMARY
// KEY is project_id — one row per project.
//
// Re-keying that table was priced and rejected (34 source files, plus
// bp_sync_draw_schedule_da, fix-24a's overlap resolver, fix-182's quarter
// layout, fix-207's audit and the vendor reports). Bobby's answer was better:
// "Could we just plop a block on the draw schedule as an 'other', but link it
// to that project?" — so da_time_blocks gained a nullable project_id.

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');
/** ★ The DDL with the COMMENT ON string removed. That comment TALKS about the
 *  vendor reports and draw_schedule — a "the migration does not mention X"
 *  assertion has to read the statements, not the prose inside them. The trap
 *  fix-369/371/372 each hit once, wearing a different hat. */
const sqlDdl = sqlCode.replace(/COMMENT ON COLUMN[\s\S]*?;/g, '');

// ---------------------------------------------------------------------------
// ★★★ THE CONTRACT MOST AT RISK — asserted first and directly.
// ---------------------------------------------------------------------------

describe('fix-384 — a linked block still cannot reach the reports', () => {
  // The exclusion is ARCHITECTURAL, not a filter someone could later tidy
  // away: the reporting path does not read da_time_blocks at all. These
  // assertions fail the moment any of them starts to.
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '');

  it('★★★ vendorReport.ts never reads da_time_blocks', () => {
    // It names the table exactly once, in a COMMENT, explaining why it needs
    // no clause. Strip the prose and the name is gone entirely.
    expect(vendorReportSource).toContain('da_time_blocks');
    expect(stripComments(vendorReportSource)).not.toContain('da_time_blocks');
  });

  it('★★★ no deal-volume or analytics module reads da_time_blocks', () => {
    for (const src of [volumeSource, redesignSource, builtinReportsSource]) {
      expect(stripComments(src)).not.toContain('da_time_blocks');
      expect(stripComments(src)).not.toContain('DaTimeBlock');
    }
  });

  it('★★★ the vendor report is still built from DRAW rows, not this table', () => {
    // It works on DrawScheduleRow — the per-project draw row — and a column
    // added to a table it never queries cannot travel into it.
    const code = stripComments(vendorReportSource);
    expect(code).toContain('DrawScheduleRow');
    expect(code).not.toContain('da_time_blocks');
    expect(code).not.toContain('DaTimeBlock');
  });

  it('★★ the migration adds no report wiring, and never touches draw_schedule', () => {
    expect(sqlDdl).not.toMatch(/CREATE\s+(OR REPLACE\s+)?VIEW/i);
    expect(sqlDdl).not.toMatch(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    // ★★★ draw_schedule is the table this whole ticket exists to avoid
    // re-keying. The migration must not go near it.
    expect(sqlDdl).not.toMatch(/draw_schedule/);
  });

  it("★★ builtinReports still tells the reader NP blocks never reach the report", () => {
    expect(builtinReportsSource).toContain(
      'they are not projects and never reach this report',
    );
  });
});

// ---------------------------------------------------------------------------

describe('fix-384 — the column', () => {
  it('★★ is nullable, and is never gated on block type', () => {
    const addColumn = sqlDdl.slice(
      sqlDdl.indexOf('ALTER TABLE public.da_time_blocks'),
      sqlDdl.indexOf(';', sqlDdl.indexOf('ALTER TABLE public.da_time_blocks')),
    );
    expect(addColumn).toMatch(
      /ADD COLUMN IF NOT EXISTS project_id uuid\s+REFERENCES public\.projects\(id\)/,
    );
    // ★★ nullable: most rows keep NULL, and a Vacation block genuinely has no
    // project. (`IS NOT NULL` inside the function body is a different thing,
    // hence slicing the ADD COLUMN clause rather than grepping the file.)
    expect(addColumn).not.toMatch(/NOT NULL/);
    expect(addColumn).not.toMatch(/DEFAULT/i);
    // no CHECK tying the link to a block type
    expect(sqlDdl).not.toMatch(/CHECK\s*\(/i);
    expect(sqlDdl).not.toMatch(/'Vacation'|'Training'|'Redesign'/);
  });

  it('★★ deleting a project nulls the link rather than deleting the block', () => {
    // The row is a person's TIME; the project link is incidental to it.
    expect(sqlCode).toContain('ON DELETE SET NULL');
    expect(sqlCode).not.toMatch(/ON DELETE CASCADE/i);
  });

  it('★ the upsert refuses a project outside the caller\'s scope', () => {
    expect(sqlCode).toContain("USING ERRCODE = '42501'");
    expect(sqlCode).toContain('SELECT 1 FROM public.projects p WHERE p.id = v_project');
  });

  it('★ the RPC stays SECURITY INVOKER so fix-220\'s admin RLS still governs', () => {
    expect(sqlCode).not.toMatch(/SECURITY DEFINER/);
    expect(sqlCode).toContain('bp_upsert_da_time_block_row');
  });

  it('★ no row is edited by the migration', () => {
    const outsideFn = sqlCode.split('$function$')[0];
    expect(outsideFn).not.toMatch(/\bUPDATE\s+public\./i);
    expect(outsideFn).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(outsideFn).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

// ---------------------------------------------------------------------------

// ★ No hook mocks needed: the picker is presentational and the grid hands it
// the options, which is what keeps this popover renderable on its own.
const OPTIONS = [
  { id: 'proj-1', address: '5831 104th Ave NE', juris: 'Kirkland',
    hay: '5831 104th ave ne kirkland' },
  { id: 'proj-2', address: '9022 36th Ave SW', juris: 'Seattle',
    hay: '9022 36th ave sw seattle' },
];

const block = (over: Partial<DaTimeBlock> = {}): DaTimeBlock =>
  ({
    id: 'np_1',
    da_name: 'Nicky',
    type: 'Other',
    label: 'Second window',
    start_week: '2025-06-09',
    end_week: '2025-06-27',
    updated_at: '2026-08-22T00:00:00Z',
    project_id: null,
    ...over,
  }) as DaTimeBlock;

describe('fix-384 — the picker', () => {
  it('★★★ links a project without being required to', () => {
    const onAdd = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Nicky"
        weekKey="2025-06-09"
        onAdd={onAdd}
        projectOptions={OPTIONS}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('project-link-search'), {
      target: { value: '5831' },
    });
    fireEvent.click(screen.getByTestId('project-link-option-proj-1'));
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onAdd).toHaveBeenCalledWith('Vacation', '', 'proj-1');
  });

  it('★★ a block saved without picking a project passes null', () => {
    const onAdd = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Nicky"
        weekKey="2025-06-09"
        onAdd={onAdd}
        projectOptions={OPTIONS}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-save'));
    // ★ Most rows. Behaves exactly as before this ticket.
    expect(onAdd).toHaveBeenCalledWith('Vacation', '', null);
  });

  it('★★★ the link is offered on EVERY type, not only "Other"', () => {
    // Three of the four blocks that already name a project in their label are
    // typed Vacation. Gating on type would have made exactly those unlinkable.
    for (const t of ['Vacation', 'Training', 'Redesign', 'Corrections', 'Other']) {
      const { unmount } = render(
        <NpBlockEditPopup
          mode="edit"
          block={block({ type: t })}
          onUpdate={() => {}}
          onRemove={() => {}}
          onClose={() => {}}
        />,
      );
      expect(screen.getByTestId('project-link-picker')).toBeTruthy();
      unmount();
    }
  });

  it('★ it can CLEAR a link as well as set one', () => {
    const onUpdate = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={block({ project_id: 'proj-2' })}
        onUpdate={onUpdate}
        projectOptions={OPTIONS}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    // It shows what it is linked to...
    expect(screen.getByTestId('project-link-current')).toHaveTextContent(
      '9022 36th Ave SW',
    );
    // ...and the way to undo that.
    fireEvent.click(screen.getByTestId('project-link-clear'));
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onUpdate).toHaveBeenCalledWith('Other', 'Second window', null);
  });

  it('★ an existing link is seeded into the editor', () => {
    const onUpdate = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={block({ project_id: 'proj-1' })}
        onUpdate={onUpdate}
        projectOptions={OPTIONS}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onUpdate).toHaveBeenCalledWith('Other', 'Second window', 'proj-1');
  });

  it('★ the label stays free text and keeps its own meaning', () => {
    const onUpdate = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={block({ project_id: 'proj-2', label: 'Cancelled Project (9022 36th Ave SW)' })}
        onUpdate={onUpdate}
        projectOptions={OPTIONS}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    // The link is added BESIDE the label, never instead of it.
    expect(screen.getByTestId('np-popup-label')).toHaveValue(
      'Cancelled Project (9022 36th Ave SW)',
    );
    expect(screen.getByTestId('project-link-current')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('fix-384 — nothing was backfilled', () => {
  it('★★ the candidate file is entirely commented out', () => {
    const live = candidatesSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
  });

  it('★★ it says plainly that it has not been run', () => {
    expect(candidatesSql).toContain('NOT APPLIED');
    expect(candidatesSql).toContain('HAS NOT BEEN RUN AGAINST ANY DATABASE');
  });

  it('★★★ it records that an auto-linker would have been wrong 3 times in 4', () => {
    // Measured, not asserted from intuition: one label matches exactly one
    // project, two name projects that DO NOT EXIST, and one is ambiguous
    // between two Estrella addresses.
    expect(candidatesSql).toMatch(/NOT LINKABLE — the project does not exist/);
    expect(candidatesSql).toMatch(/AMBIGUOUS — two candidates/);
    expect(candidatesSql).toContain('4060 E Via Estrella');
    expect(candidatesSql).toContain('4040 E Via Estrella');
  });

  it('★ the migration itself contains no link-writing statement', () => {
    expect(sqlCode).not.toMatch(/SET\s+project_id\s*=\s*'/i);
  });
});
