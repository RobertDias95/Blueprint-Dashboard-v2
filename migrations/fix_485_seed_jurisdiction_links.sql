-- ===========================================================================
-- fix-485 §A3 (P-147) — SEED THE JURISDICTION LINK REGISTRY
-- ===========================================================================
--
-- ★★★ APPROVED IN THE BRIEF: *"One data write, approved: seeding the
-- jurisdiction-links registry with three cities — links Bobby has not supplied
-- yet ship as the city entries with NO links, never invented URLs."*
--
-- Bobby, 2026-09-02: *"a drop-down of Seattle, Kirkland, Bellevue with folders
-- inside that take you to their GIS, their code, whatever."*
--
-- ---------------------------------------------------------------------------
-- ★★★ THREE CITIES, ZERO URLS, AND THE ZERO IS THE POINT
-- ---------------------------------------------------------------------------
-- He named the cities and has not supplied the links. A GIS address is a thing
-- you can be wrong about in a way nobody notices until they have followed it to
-- the wrong county's parcel viewer — so this invents none. Each city renders
-- "No links yet — add in Settings", and the first real URL arrives the way every
-- other catalogue value in this app does: through Settings → Lists & Catalogs.
--
-- ★ Same rule fix-335 §4 wrote for `SHAREPOINT_URL`, which a test asserts by
--   its exact value rather than as "an href exists": a nav link to the wrong
--   site is the fix-306 defect class, and it is worse than no link at all.
--
-- ---------------------------------------------------------------------------
-- ★★ IT IS IDEMPOTENT AND IT NEVER OVERWRITES
-- ---------------------------------------------------------------------------
-- `WHERE NOT EXISTS` on the key, not an upsert. Re-running cannot flatten links
-- somebody has since added — and the app does not need this row at all:
-- `readJurisdictions()` falls back to the same three cities when the key has
-- never been written, so the seed makes the SETTINGS EDITOR open on a populated
-- list rather than making the ribbon work.
--
-- ★ MEASURED BEFORE (prod, 2026-09-03): `app_config` holds no `jurisdictionLinks`
--   key. The two neighbours it will sit beside are `zoneOptions` (21 values) and
--   `productTypeOptions` (8).
-- ===========================================================================

-- ★★★ ONE ROW PER TENANT THAT ALREADY HAS CONFIG, AND THE TENANT IS READ,
--     NOT TYPED. `app_config.tenant_id` is NOT NULL with no default, and this
--     table is per-tenant — so the seed derives its tenants from the rows that
--     exist rather than hard-coding the one uuid this deployment happens to
--     have. A second tenant added later gets the seed the moment it has any
--     config at all, and a typo'd uuid cannot silently create an orphan row.
insert into public.app_config (tenant_id, key, value)
select distinct c.tenant_id,
       'jurisdictionLinks',
       '[{"city":"Seattle","links":[]},
         {"city":"Kirkland","links":[]},
         {"city":"Bellevue","links":[]}]'::jsonb
  from public.app_config c
 where not exists (
   select 1 from public.app_config x
    where x.tenant_id = c.tenant_id
      and x.key = 'jurisdictionLinks'
 );

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select tenant_id,
--        jsonb_array_length(value) as cities,
--        (select count(*) from jsonb_array_elements(value) e
--          where jsonb_array_length(e->'links') > 0) as cities_with_links
--   from public.app_config where key = 'jurisdictionLinks';
--   -- one row, 3 cities, 0 with links
