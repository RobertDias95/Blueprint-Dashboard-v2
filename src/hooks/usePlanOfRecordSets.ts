import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { PlanOfRecordStage } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §E (P-148) — THE PLAN OF RECORD'S SETS, BEFORE THEY EXIST
// ===========================================================================
//
// fix-504 (scraper repo, in flight) adds `public.project_plan_of_record_sets` —
// one row per `(project, set_type, variant)` carrying `page_count`,
// `pages_status`, `pages_prefix` and `is_archived_fallback` — plus external
// page objects at `{project_id}/marketing_external/pNNN.jpg`.
//
// ★★★ IT IS NOT ON PROD, AND THE BRIEF MAKES THAT A REQUIREMENT, NOT A CAVEAT:
//     *"Feature-detect the view once per session; never throw when it is
//     missing."* STEP 0-4 confirmed it absent, so **the missing branch is the
//     live one today** and the present branch is the one nobody can exercise
//     until fix-504 lands. Both are written; only one is reachable.
//
// ★★ POSTGREST ANSWERS A MISSING RELATION WITH `42P01`, AND THAT IS THE WHOLE
//    DETECTION. No catalogue probe, no config flag, no build-time switch: ask
//    for the rows, and treat that one code as "not yet". Anything else is a
//    real error and is thrown, because a view that exists and is refusing to
//    answer must not look identical to a view that has not shipped.
//
// ★ CACHED FOR THE SESSION. `staleTime: Infinity` on the miss is deliberate —
//   a view does not appear between two renders, and re-asking on every mount
//   would put a 404 in the network log of every project page.

/** One row of `project_plan_of_record_sets`. Hand-typed like the rest of
 *  database.types — see the standing rule about never regenerating it. */
export interface PlanOfRecordSetRow {
  project_id: string;
  set_type: PlanOfRecordStage;
  /** `internal` | `external`. The two Marketing variants Bobby's v14 buttons
   *  pick between. */
  variant: string;
  /** How many page images the indexer wrote. 1 for internal. */
  page_count: number | null;
  /** `ok` | `pending` | `failed` | null. Anything but `ok` degrades to the
   *  single thumbnail, exactly as `thumb_status` already does. */
  pages_status: string | null;
  /** Object-path prefix in the private plan-thumbnails bucket, e.g.
   *  `{project_id}/marketing_external/`. Pages are `pNNN.jpg` under it. */
  pages_prefix: string | null;
  /** ★ True when the indexer could only find an ARCHIVED set. The card says so
   *  in the label — an archived plan of record is still the plan of record, but
   *  a reader must not mistake it for a current one. */
  is_archived_fallback: boolean | null;
  /**
   * ★★★ fix-522 §B (P-217) — THE SET'S OWN THUMBNAIL, AND IT WAS ALWAYS THERE.
   *
   * The view has carried `thumb_path` and `thumb_status` since fix-504; this
   * interface and `SELECT_COLUMNS` below never asked for them, so the card had
   * no per-variant image to bind to and fell back to the plan-of-record row's
   * one thumbnail for both buttons. **The select list is explicit, so an
   * unlisted column arrives as `undefined` and the feature that needs it looks
   * impossible rather than unwired** — the trap this codebase has now recorded
   * six times (fix-122, fix-386, fix-410, fix-487, fix-488, and here).
   *
   * Prod, 2026-09-10 — `3505 Densmore Ave N` carries two distinct thumbs and
   * both are `ok`:
   *   marketing/internal  →  …/marketing_internal.jpg   1 page
   *   marketing/external  →  …/marketing_external.jpg   6 pages
   */
  thumb_path: string | null;
  /** `ok` | `pending` | `failed` | null. Anything but `ok` degrades to the
   *  plan-of-record row's thumbnail, exactly as the card already does. */
  thumb_status: string | null;
  /** ★ fix-522 §D4: the set's own file name, which is what a shared email's
   *  subject is built from — *"is this schematic, design guidance, marketing
   *  internal or external?"* */
  file_name: string | null;
}

export interface PlanOfRecordSets {
  /** ★ `false` until fix-504 lands. Every caller branches on this, and the
   *  absent branch is what prod runs today. */
  available: boolean;
  rows: PlanOfRecordSetRow[];
}

const MISSING_RELATION = '42P01';

// ★★★ fix-522 §B: `thumb_path`, `thumb_status` and `file_name` join the list.
//     They have existed on the view since fix-504 — see the note on the
//     interface for why an unlisted column makes a feature look impossible.
const SELECT_COLUMNS =
  'project_id,set_type,variant,page_count,pages_status,pages_prefix,is_archived_fallback,thumb_path,thumb_status,file_name';

export function usePlanOfRecordSets(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PlanOfRecordSets>({
    queryKey: ['planOfRecordSets', tenantId ?? '', projectId ?? ''],
    enabled: Boolean(projectId) && !!tenantId,
    // The indexer runs once a day; and when the view is missing the answer
    // cannot change at all within a session.
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_plan_of_record_sets')
        .select(SELECT_COLUMNS)
        .eq('project_id', projectId!);
      if (error) {
        // ★★★ THE ONE CODE THAT IS NOT AN ERROR. Everything else propagates.
        if (error.code === MISSING_RELATION) return { available: false, rows: [] };
        throw error;
      }
      return {
        available: true,
        rows: (data ?? []) as unknown as PlanOfRecordSetRow[],
      };
    },
  });
}

/** The variant a set row describes, normalised. ★ A row whose `variant` is
 *  neither of the two is ignored rather than rendered as a third button —
 *  fix-504 owns that column and this app should not guess at a value it has
 *  not been told about. */
export function findVariant(
  sets: PlanOfRecordSets | undefined,
  variant: 'internal' | 'external',
): PlanOfRecordSetRow | null {
  if (!sets?.available) return null;
  return (
    sets.rows.find(
      (r) => r.set_type === 'marketing' && r.variant?.toLowerCase() === variant,
    ) ?? null
  );
}

/** The object paths for a set's pages, in order. ★ `pNNN.jpg`, zero-padded to
 *  three, which is fix-504's own naming — a page 10 sorting before page 2 is
 *  the classic version of this bug and the padding is what prevents it. */
export function pagePaths(row: PlanOfRecordSetRow | null): string[] {
  if (!row?.pages_prefix || !row.page_count || row.page_count < 1) return [];
  const prefix = row.pages_prefix.endsWith('/') ? row.pages_prefix : `${row.pages_prefix}/`;
  return Array.from(
    { length: row.page_count },
    (_, i) => `${prefix}p${String(i + 1).padStart(3, '0')}.jpg`,
  );
}
