import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// Q2: All non-archived projects, ordered by address. The matrix view, the
// project list, and the project detail breadcrumb all consume this.
//
// Q5.5.D: tenant-scoped via RLS. Cache key includes activeTenantId so a
// future tenant-switch invalidates cleanly.

export function useProjects() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Project[]>({
    queryKey: queryKeys.projects(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      // fix-22-final / Mig 6 read-surface sweep: explicitly list the 13
      // project-level columns added in Migrations 1+6 (entitlement_lead,
      // design_manager, go_date, units, zone, lot_width, lot_depth,
      // unit_types, parking_type, parking_stalls, alley, product_types,
      // project_tags, builder_name, builder_company, builder_email,
      // builder_phone) so Project Overview + Library + Reports can
      // read them. Without these listed, the wizard wrote to projects.*
      // but every read surface saw blanks. fix-91 (2026-06-02) renamed
      // the previously-singular Product Type column to its plural
      // text[] form — see migrations/fix_91_product_types_array.sql.
      const { data, error } = await supabase
        .from('projects')
        .select(
          [
            'id, address, juris, archived, notes',
            'acq_lead, external_team, builder_id, permit_order',
            // fix-222: schematic_designer text[] (added to the DB in
            // fix_222_task_template_overhaul.sql — now safe to select).
            // ★★★ fix-487: `construction_admin` HAS to be on this line — the
            // FOURTH time this trap has been recorded in this file (fix-122,
            // fix-386, fix-410 above). The select list is explicit, so an
            // unlisted column arrives as `undefined` and the Team card's sixth
            // block would render nothing, for ever, with no error anywhere.
            'entitlement_lead, design_manager, schematic_designer, go_date',
            'construction_admin',
            'units, zone, lot_width, lot_depth, unit_types',
            // ★ fix-402: parking_type / parking_stalls dropped from the select.
            // They are archived and NULL on every row; selecting them would
            // ship 186 nulls to every client on every load to feed nothing.
            'alley, product_types, project_tags',
            'builder_name, builder_company, builder_email, builder_phone',
            // fix-122 read-surface backfill: the Library matrix + the
            // Project Overview SiteEditor render these columns; they
            // were added to the table in fix-122 but never to this
            // select list, so the UI was rendering "—" in prod.
            // ★★★ fix-410: `is_regular_shape` HAS to be on this line. This
            // select list is explicit, and an unlisted column arrives as
            // `undefined` — the Site section and the Library would render
            // "not set" forever while the database held the answer. That is
            // the fix-122 trap the comment above records and the fix-386 trap
            // the comment below records; this is the third time.
            'num_lots, is_corner_lot, is_regular_shape, closing_date',
            // fix-126: redesign concept columns. Drive the "Redesign of"
            // top badge + the expandable "Redesigns (N)" subsection on
            // Project Overview, plus the yellow border on draw schedule
            // blocks for redesign projects.
            'redesign_of_project_id, redesign_trigger',
            'redesign_reuses_original_permit, redesign_notes',
            // ★★★ fix-386: WITHOUT THIS LINE THE WHOLE FLAG IS INERT. The
            // column exists, the wizard writes it, and the board's history gate
            // reads it — but this select list is explicit, so an unlisted
            // column arrives as undefined and every project looks "not
            // recorded" forever. Exactly the fix-122 trap two comments up.
            'is_backfill',
            'created_at, updated_at',
          ].join(', '),
        )
        .eq('archived', false)
        .order('address', { ascending: true });
      if (error) throw error;
      // PostgREST's inferred union doesn't unify with Project when the
      // select list is long. Cast via unknown — columns match the
      // hand-typed interface exactly.
      return (data ?? []) as unknown as Project[];
    },
  });
}
