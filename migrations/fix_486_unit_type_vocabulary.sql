-- ===========================================================================
-- fix-486 (P-143) — UNIT TYPES BECOME Detached / Attached / ADU / DADU / Remodel
-- ===========================================================================
--
-- ★★★ APPROVED BY BOBBY 2026-09-02/03, INCLUDING THE DATA REMAP:
--
--   *"attached, detached, ADU, DADU, and then remodel. We can easily take
--    whatever we have and map it to these types, then update our settings."*
--   *"a cottage is detached, an SFR is detached, a duplex (or triplex or ^plex)
--    is attached."*
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD 2026-09-03 — the day this ran
-- ---------------------------------------------------------------------------
--   projects                                        211
--   projects.product_types values                   280  across 202 projects
--     SFR 117 · Duplex 83 · DADU 34 · SFR+ADU 30 · ADU 6 · Remodel 6 · Cottages 4
--     ★ `Condo` is in the registry and in NO project. Mapped anyway (the rule
--       costs nothing and a hand-added Condo tomorrow lands right), reported as
--       unused.
--   unit_types[].label values                       245  rows on 106 projects
--     SFR 107 · Duplex 102 · Cottages 6 · SFR+ADU 6 · SFR w/ Accessory Units 4
--     Type A 4 · Type B 4 · DADU 3 · Remodel 3 · SFR + Attached Units 2
--     Type C 2 · ADU 1 · Type D 1
--   unit_types[].work_scope                         245 rows, 95 carry the key,
--                                                   **0 non-null**
--
-- ---------------------------------------------------------------------------
-- ★★★ THE THREE PLACES `SFR+ADU` AND `Type A–D` ARE DECIDED, NOT GUESSED
-- ---------------------------------------------------------------------------
--
--   `SFR+ADU` on a PROJECT   →  Detached AND ADU (two values).
--        `product_types` is a LIST of what a project contains, and a project
--        that is both is both. 30 projects.
--
--   `SFR+ADU` on a UNIT ROW  →  Detached, alone.
--        One row is one unit. Splitting it would invent a second row carrying
--        the first one's dimensions — a fabricated unit, not a migration.
--        6 rows on 5 projects: 1327 44th Ave SW · 233 31st Ave E ·
--        3117 W Dravus St (×2) · 5623 44th Ave SW · 9711 12th Ave NW.
--
--   `Type A` / `B` / `C` / `D`  →  LEFT EXACTLY AS THEY ARE.
--        These are the wizard's seed letters (`nextUnitTypeLabel`), not a
--        vocabulary: the intake habit is to add rows first and name them later.
--        A mapping that fell back to Detached would declare eleven unanswered
--        rows answered. The UI marks them "needs a type" and Project Data
--        offers the five. 11 rows on 4 projects, all redesigns:
--        2443 5th Ave W [Redesign 1] · 4000 SW Concord St [Redesign 1] ·
--        5537 35th Ave NE [Redesign 1] · 6505 21st Ave NW [Redesign 1].
--
-- ★★ ANYTHING THE RULES DO NOT COVER IS REPORTED, NOT GUESSED. Step 5 raises if
--    a value survives that is neither one of the five nor a `Type …`
--    placeholder — so an unmapped label added between the measurement and the
--    run aborts the transaction rather than being silently rewritten.
--
-- ---------------------------------------------------------------------------
-- ★ BACKUP FIRST (house practice, P-036): `_fix486_types_backup_20260903`
--   holds `id, product_types, unit_types` for every project, taken inside this
--   transaction so it cannot be a snapshot of a different moment.
--   ★ It is listed for the P-036 cleanup sweep like every other backup table.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — BACKUP
-- ---------------------------------------------------------------------------
create table if not exists public._fix486_types_backup_20260903 as
select id, tenant_id, address, product_types, unit_types, now() as backed_up_at
  from public.projects;

-- ---------------------------------------------------------------------------
-- 2 — ★★★ ASSERT NOTHING IS LOST BEFORE STRIPPING `work_scope`
-- ---------------------------------------------------------------------------
-- The brief's rule, and the only thing standing between "retiring a field
-- nobody used" and "deleting somebody's answer". Checked against the LIVE rows,
-- not against the measurement above.
do $$
declare v_answered integer;
begin
  select count(*) into v_answered
    from public.projects p,
         lateral jsonb_array_elements(
           case when jsonb_typeof(p.unit_types) = 'array'
                then p.unit_types else '[]'::jsonb end) u
   where u->>'work_scope' is not null;
  if v_answered > 0 then
    raise exception
      'fix-486: % unit rows carry a non-null work_scope — the strip would lose data. Aborting.',
      v_answered;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 — THE REGISTRY
-- ---------------------------------------------------------------------------
-- ★ Per tenant, read not typed (app_config.tenant_id is NOT NULL, no default).
update public.app_config
   set value = '["Detached","Attached","ADU","DADU","Remodel"]'::jsonb,
       updated_at = now()
 where key = 'productTypeOptions';

-- ---------------------------------------------------------------------------
-- 4 — THE DATA
-- ---------------------------------------------------------------------------
-- ★★ `projects.product_types` — mapped, SFR+ADU split into two, then DEDUPED.
--    `[SFR, Cottages]` is one Detached, not two. Order of first appearance is
--    preserved (`with ordinality` + `min(ord)`), so a project's list reads the
--    way its owner built it.
with mapped as (
  select p.id,
         t.ord,
         case lower(btrim(t.v))
           when 'sfr'                    then array['Detached']
           when 'cottages'               then array['Detached']
           when 'sfr w/ accessory units' then array['Detached']
           when 'duplex'                 then array['Attached']
           when 'condo'                  then array['Attached']
           when 'sfr + attached units'   then array['Attached']
           when 'sfr+adu'                then array['Detached','ADU']
           when 'adu'                    then array['ADU']
           when 'dadu'                   then array['DADU']
           when 'remodel'                then array['Remodel']
           when 'detached'               then array['Detached']
           when 'attached'               then array['Attached']
           else array[t.v]
         end as vals
    from public.projects p,
         lateral unnest(p.product_types) with ordinality as t(v, ord)
),
flat as (
  select id, m.val, min(ord) as ord
    from mapped, lateral unnest(vals) as m(val)
   group by id, m.val
),
rebuilt as (
  select id, array_agg(val order by ord, val) as next_types
    from flat group by id
)
update public.projects p
   set product_types = r.next_types
  from rebuilt r
 where r.id = p.id
   and p.product_types is distinct from r.next_types;

-- ★★ `projects.unit_types[].label` — mapped, and the `work_scope` key stripped
--    in the SAME rewrite. One pass over the array rather than two, so a row
--    cannot end up with a new label and an old key.
--
-- ★★★ EVERY OTHER KEY IS PRESERVED BY `u - 'work_scope' || jsonb_build_object(...)`
--     rather than rebuilt: width, depth, qty, stories, parking_kind,
--     parking_stalls and roof_deck must survive byte-for-byte, and a rebuild
--     that named them would be a second whitelist to keep in step with
--     `parseUnitTypes`.
with remapped as (
  select p.id,
         jsonb_agg(
           (u.elem - 'work_scope') ||
           jsonb_build_object('label',
             case lower(btrim(coalesce(u.elem->>'label','')))
               when 'sfr'                    then 'Detached'
               when 'cottages'               then 'Detached'
               when 'sfr w/ accessory units' then 'Detached'
               when 'duplex'                 then 'Attached'
               when 'condo'                  then 'Attached'
               when 'sfr + attached units'   then 'Attached'
               -- ★ ONE ROW IS ONE UNIT — see the header.
               when 'sfr+adu'                then 'Detached'
               when 'adu'                    then 'ADU'
               when 'dadu'                   then 'DADU'
               when 'remodel'                then 'Remodel'
               when 'detached'               then 'Detached'
               when 'attached'               then 'Attached'
               -- ★ Type A–D and anything else: LEFT EXACTLY AS STORED.
               else coalesce(u.elem->>'label','')
             end)
           order by u.ord
         ) as next_units
    from public.projects p,
         lateral jsonb_array_elements(p.unit_types) with ordinality as u(elem, ord)
   where jsonb_typeof(p.unit_types) = 'array'
     and jsonb_array_length(p.unit_types) > 0
   group by p.id
)
update public.projects p
   set unit_types = r.next_units
  from remapped r
 where r.id = p.id
   and p.unit_types is distinct from r.next_units;

-- ---------------------------------------------------------------------------
-- 5 — ★★★ VERIFY INSIDE THE TRANSACTION: every surviving value is one of the
--     five, or an explicitly-allowed wizard placeholder. Anything else aborts.
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(distinct v, ', ') into v_bad
    from (
      select t as v from public.projects p, unnest(p.product_types) t
      union all
      select u->>'label'
        from public.projects p,
             lateral jsonb_array_elements(
               case when jsonb_typeof(p.unit_types)='array'
                    then p.unit_types else '[]'::jsonb end) u
    ) x
   where v is not null
     and v not in ('Detached','Attached','ADU','DADU','Remodel')
     and v !~ '^Type( [A-Z]{1,2})?$'
     and btrim(v) <> '';
  if v_bad is not null then
    raise exception 'fix-486: unmapped values survived the remap: %', v_bad;
  end if;
end $$;

-- ★ And no `work_scope` key is left anywhere.
do $$
declare v_left integer;
begin
  select count(*) into v_left
    from public.projects p,
         lateral jsonb_array_elements(
           case when jsonb_typeof(p.unit_types)='array'
                then p.unit_types else '[]'::jsonb end) u
   where u ? 'work_scope';
  if v_left > 0 then
    raise exception 'fix-486: % rows still carry a work_scope key', v_left;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- ★ VERIFIED AFTER COMMIT — MEASURED, NOT PREDICTED, 2026-09-03
-- ---------------------------------------------------------------------------
--   product_types  Detached 144 · Attached 83 · ADU 35 · DADU 34 · Remodel 6
--                  = 302 values (was 280)
--
--     ★★ THE ARITHMETIC, BECAUSE THE TOTAL GOING UP LOOKS WRONG AT A GLANCE:
--        280 + 30 (each SFR+ADU project became TWO values) = 310, less 8 that
--        deduped away, on SEVEN projects — every one of them a project that
--        already listed `SFR` ALONGSIDE `SFR+ADU`, i.e. that said "detached"
--        twice in the old vocabulary and says it once in the new:
--          1327 44th Ave SW · 233 31st Ave E · 3021 NW 62nd St ·
--          3117 W Dravus St · 5623 44th Ave SW · 6336 51st Ave S   (1 each)
--          9711 12th Ave NW  (2 — it also carried a bare `ADU` next to the
--                             `SFR+ADU`, so both halves of the split collapsed)
--        ★ NO `SFR`+`Cottages` pair exists on prod; the dedupe rule is still
--          right, it simply had only this one shape to catch.
--
--     ★ `Condo` is still in no project. It left the registry with the rest of
--       the old list and was mapped anyway, so a Condo hand-added before the
--       run would have landed on Attached.
--
--   unit labels    Detached 123 · Attached 104 · Remodel 3 · DADU 3 · ADU 1 ·
--                  Type A 4 · Type B 4 · Type C 2 · Type D 1
--                  = 245 rows, unchanged (a unit row never splits), 11 left
--                  unmapped BY DESIGN
--
--     Detached 123 = SFR 107 + Cottages 6 + SFR w/ Accessory Units 4 + SFR+ADU 6
--     Attached 104 = Duplex 102 + SFR + Attached Units 2
--
--   work_scope     0 keys remaining (was 95 rows carrying it, all null)
--   registry       ["Detached","Attached","ADU","DADU","Remodel"]
--   backup         211 rows in public._fix486_types_backup_20260903
--
-- select t, count(*) from public.projects p, unnest(p.product_types) t group by 1 order by 2 desc;
-- select u->>'label', count(*) from public.projects p,
--        lateral jsonb_array_elements(p.unit_types) u group by 1 order by 2 desc;
