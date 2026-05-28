-- fix-69 (2026-05-28): Reports hub Phase 3 — freeform / curated report builder.
--
-- A guided, SAFE report builder over existing data. NOT raw SQL exposure:
--   * only catalog-defined entities / columns / operators are reachable,
--   * filter VALUES are always parameterized (EXECUTE ... USING), never
--     interpolated,
--   * column names are derived from the hardcoded catalog (equality-validated
--     against the request) + regex-guarded before they touch SQL,
--   * the tenant filter `p.tenant_id = ANY(auth_tenant_ids())` is ALWAYS
--     appended.
--
-- No new tables: custom specs live in saved_reports.spec (kind='custom') from
-- fix-68. This migration adds the catalog + the validate/execute machinery +
-- 3 public RPCs (run / preview / upsert-spec).
--
-- ADDITIVE + SAFE. Nothing existing changes.

-- ---------------------------------------------------------------------------
-- 1. Catalog
-- ---------------------------------------------------------------------------
-- _rbcol: build one catalog column object, deriving the allowed operator set
-- from the column type so the catalog stays compact + the frontend gets the
-- exact operator whitelist the runtime enforces.
CREATE OR REPLACE FUNCTION public._rbcol(
  p_key text, p_label text, p_type text, p_filterable boolean, p_source text
)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'key', p_key,
    'label', p_label,
    'type', p_type,
    'filterable', p_filterable,
    'source', p_source,
    'operators', CASE
      WHEN NOT p_filterable THEN '[]'::jsonb
      WHEN p_type IN ('text','enum') THEN
        '["=","!=","contains","starts_with","in","not_in","is_null","is_not_null"]'::jsonb
      WHEN p_type IN ('date','number') THEN
        '["=","!=",">",">=","<","<=","in","not_in","is_null","is_not_null"]'::jsonb
      WHEN p_type = 'boolean' THEN
        '["=","!=","is_null","is_not_null"]'::jsonb
      ELSE '[]'::jsonb
    END
  );
$function$;

CREATE OR REPLACE FUNCTION public.bp_get_report_builder_catalog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'entities', jsonb_build_array(
      -- Permits ------------------------------------------------------------
      jsonb_build_object(
        'key', 'permits', 'label', 'Permits',
        'default_sort', jsonb_build_object('column', 'target_submit', 'dir', 'asc'),
        'columns', jsonb_build_array(
          _rbcol('num','Permit #','text',true,'direct'),
          _rbcol('type','Type','text',true,'direct'),
          _rbcol('ent_lead','Ent Lead','text',true,'direct'),
          _rbcol('da','DA','text',true,'direct'),
          _rbcol('stage','Stage','text',true,'direct'),
          _rbcol('status','Status','text',true,'direct'),
          _rbcol('corr_rounds','Corr Rounds','number',true,'direct'),
          _rbcol('expected_issue','ACQ Target','date',true,'direct'),
          _rbcol('target_submit','Target Submit','date',true,'direct'),
          _rbcol('actual_issue','Actual Issue','date',true,'direct'),
          _rbcol('approval_date','Approval Date','date',true,'direct'),
          _rbcol('intake_date','Intake Date','date',true,'direct'),
          _rbcol('dd_start','DD Start','date',true,'direct'),
          _rbcol('dd_end','DD End','date',true,'direct'),
          _rbcol('nickname','Nickname','text',true,'direct'),
          _rbcol('struct_address','Structure Address','text',true,'direct'),
          _rbcol('portal_url','Portal URL','text',false,'direct'),
          _rbcol('project.address','Project Address','text',true,'parent.projects'),
          _rbcol('project.juris','Jurisdiction','text',true,'parent.projects'),
          _rbcol('project.acq_lead','ACQ Lead','text',true,'parent.projects'),
          _rbcol('project.go_date','GO Date','date',true,'parent.projects'),
          _rbcol('project.units','Units','number',true,'parent.projects'),
          _rbcol('project.product_type','Product Type','text',true,'parent.projects')
        )
      ),
      -- Projects -----------------------------------------------------------
      jsonb_build_object(
        'key', 'projects', 'label', 'Projects',
        'default_sort', jsonb_build_object('column', 'go_date', 'dir', 'desc'),
        'columns', jsonb_build_array(
          _rbcol('address','Address','text',true,'direct'),
          _rbcol('juris','Jurisdiction','text',true,'direct'),
          _rbcol('acq_lead','ACQ Lead','text',true,'direct'),
          _rbcol('entitlement_lead','Entitlement Lead','text',true,'direct'),
          _rbcol('design_manager','Design Manager','text',true,'direct'),
          _rbcol('go_date','GO Date','date',true,'direct'),
          _rbcol('units','Units','number',true,'direct'),
          _rbcol('zone','Zone','text',true,'direct'),
          _rbcol('lot_width','Lot Width','number',true,'direct'),
          _rbcol('lot_depth','Lot Depth','number',true,'direct'),
          _rbcol('parking_type','Parking Type','text',true,'direct'),
          _rbcol('parking_stalls','Parking Stalls','number',true,'direct'),
          _rbcol('product_type','Product Type','text',true,'direct'),
          _rbcol('builder_name','Builder','text',true,'direct'),
          _rbcol('archived','Archived','boolean',true,'direct'),
          _rbcol('created_at','Created','date',true,'direct')
        )
      ),
      -- Permit Cycles ------------------------------------------------------
      jsonb_build_object(
        'key', 'permit_cycles', 'label', 'Permit Cycles',
        'default_sort', jsonb_build_object('column', 'corr_issued', 'dir', 'desc'),
        'columns', jsonb_build_array(
          _rbcol('cycle_index','Cycle #','number',true,'direct'),
          _rbcol('submitted','Submitted','date',true,'direct'),
          _rbcol('intake_accepted','Intake Accepted','date',true,'direct'),
          _rbcol('resubmitted','Resubmitted','date',true,'direct'),
          _rbcol('city_target','City Target','date',true,'direct'),
          _rbcol('corr_issued','Corr Issued','date',true,'direct'),
          _rbcol('permit.num','Permit #','text',true,'parent.permits'),
          _rbcol('permit.type','Permit Type','text',true,'parent.permits'),
          _rbcol('permit.ent_lead','Ent Lead','text',true,'parent.permits'),
          _rbcol('permit.da','DA','text',true,'parent.permits'),
          _rbcol('project.address','Project Address','text',true,'parent.projects'),
          _rbcol('project.juris','Jurisdiction','text',true,'parent.projects')
        )
      ),
      -- Permit Cycle Reviewers ---------------------------------------------
      jsonb_build_object(
        'key', 'permit_cycle_reviewers', 'label', 'Permit Cycle Reviewers',
        'default_sort', jsonb_build_object('column', 'last_event_date', 'dir', 'desc'),
        'columns', jsonb_build_array(
          _rbcol('discipline','Discipline','text',true,'direct'),
          _rbcol('reviewer_name','Reviewer','text',true,'direct'),
          _rbcol('current_status','Status','text',true,'direct'),
          _rbcol('last_event_date','Last Event','date',true,'direct'),
          _rbcol('cycle_index','Cycle #','number',true,'direct'),
          _rbcol('permit.num','Permit #','text',true,'parent.permits'),
          _rbcol('permit.type','Permit Type','text',true,'parent.permits'),
          _rbcol('project.address','Project Address','text',true,'parent.projects'),
          _rbcol('project.juris','Jurisdiction','text',true,'parent.projects')
        )
      ),
      -- Draw Schedule ------------------------------------------------------
      jsonb_build_object(
        'key', 'draw_schedule', 'label', 'Draw Schedule',
        'default_sort', jsonb_build_object('column', 'dd_start', 'dir', 'asc'),
        'columns', jsonb_build_array(
          _rbcol('da_assigned','DA Assigned','text',true,'direct'),
          _rbcol('status','Status','text',true,'direct'),
          _rbcol('start_week','Start Week','text',true,'direct'),
          _rbcol('end_week','End Week','text',true,'direct'),
          _rbcol('dd_start','DD Start','date',true,'direct'),
          _rbcol('dd_end','DD End','date',true,'direct'),
          _rbcol('notes','Notes','text',true,'direct'),
          _rbcol('project.address','Project Address','text',true,'parent.projects'),
          _rbcol('project.juris','Jurisdiction','text',true,'parent.projects')
        )
      )
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION public._rbcol(text, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_get_report_builder_catalog() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Internal helpers: column SQL whitelist + base FROM
-- ---------------------------------------------------------------------------
-- Map a (validated) catalog column key to a safe SQL expression. Aliases:
--   p  = the primary entity, pr = parent projects, pm = parent permits.
-- The column name is the catalog key (or its post-prefix segment) and is
-- regex-guarded to a strict identifier before it touches SQL. Returns NULL
-- for anything not recognizable (caller raises). Callers MUST have already
-- validated key membership against the catalog — this is defense in depth.
CREATE OR REPLACE FUNCTION public._report_col_sql(p_entity text, p_key text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_prefix text;
  v_col    text;
  v_alias  text;
BEGIN
  IF position('.' IN p_key) > 0 THEN
    v_prefix := split_part(p_key, '.', 1);
    v_col    := split_part(p_key, '.', 2);
    v_alias  := CASE v_prefix
                  WHEN 'project' THEN 'pr'
                  WHEN 'permit'  THEN 'pm'
                  ELSE NULL
                END;
  ELSE
    v_alias := 'p';
    v_col   := p_key;
  END IF;

  IF v_alias IS NULL THEN
    RETURN NULL;
  END IF;
  -- Strict identifier guard — nothing but lowercase snake_case reaches SQL.
  IF v_col !~ '^[a-z_][a-z0-9_]*$' THEN
    RETURN NULL;
  END IF;
  RETURN v_alias || '.' || v_col;
END;
$function$;

-- Base FROM/JOIN clause per entity. Primary entity is always alias `p`
-- (which carries tenant_id); parents are pr (projects) / pm (permits).
CREATE OR REPLACE FUNCTION public._report_from_sql(p_entity text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_entity
    WHEN 'permits' THEN
      'public.permits p LEFT JOIN public.projects pr ON pr.id = p.project_id'
    WHEN 'projects' THEN
      'public.projects p'
    WHEN 'permit_cycles' THEN
      'public.permit_cycles p LEFT JOIN public.permits pm ON pm.id = p.permit_id LEFT JOIN public.projects pr ON pr.id = pm.project_id'
    WHEN 'permit_cycle_reviewers' THEN
      'public.permit_cycle_reviewers p LEFT JOIN public.permits pm ON pm.id = p.permit_id LEFT JOIN public.projects pr ON pr.id = pm.project_id'
    WHEN 'draw_schedule' THEN
      'public.draw_schedule p LEFT JOIN public.projects pr ON pr.id = p.project_id'
    ELSE NULL
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Validate + build + run (shared by run / preview / upsert-validate)
-- ---------------------------------------------------------------------------
-- _report_validate_spec raises on any rule violation; returns void on success.
CREATE OR REPLACE FUNCTION public._report_validate_spec(p_spec jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cat     jsonb := public.bp_get_report_builder_catalog();
  v_entity  text  := p_spec->>'entity';
  v_ent     jsonb;
  v_colmap  jsonb := '{}'::jsonb;   -- key -> column object
  v_c       jsonb;
  v_elem    jsonb;
  v_key     text;
  v_op      text;
  v_type    text;
  v_ops     jsonb;
  v_val     jsonb;
BEGIN
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'spec.entity is required';
  END IF;

  SELECT e INTO v_ent
  FROM jsonb_array_elements(v_cat->'entities') e
  WHERE e->>'key' = v_entity;
  IF v_ent IS NULL THEN
    RAISE EXCEPTION 'unknown entity: %', v_entity;
  END IF;

  -- Build a key -> column lookup for this entity.
  FOR v_c IN SELECT * FROM jsonb_array_elements(v_ent->'columns') LOOP
    v_colmap := v_colmap || jsonb_build_object(v_c->>'key', v_c);
  END LOOP;

  -- columns: >=1, each must be a catalog column.
  IF jsonb_typeof(p_spec->'columns') <> 'array'
     OR jsonb_array_length(p_spec->'columns') < 1 THEN
    RAISE EXCEPTION 'spec.columns must be a non-empty array';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_spec->'columns') LOOP
    v_key := v_elem #>> '{}';
    IF NOT (v_colmap ? v_key) THEN
      RAISE EXCEPTION 'unknown column "%" for entity %', v_key, v_entity;
    END IF;
    IF public._report_col_sql(v_entity, v_key) IS NULL THEN
      RAISE EXCEPTION 'column "%" is not selectable', v_key;
    END IF;
  END LOOP;

  -- filters: each column filterable, op allowed for type, value shape ok.
  IF p_spec ? 'filters' THEN
    IF jsonb_typeof(p_spec->'filters') <> 'array' THEN
      RAISE EXCEPTION 'spec.filters must be an array';
    END IF;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_spec->'filters') LOOP
      v_key := v_elem->>'column';
      v_op  := v_elem->>'op';
      IF NOT (v_colmap ? v_key) THEN
        RAISE EXCEPTION 'unknown filter column "%"', v_key;
      END IF;
      v_c    := v_colmap->v_key;
      v_type := v_c->>'type';
      v_ops  := v_c->'operators';
      IF NOT (v_c->>'filterable')::boolean THEN
        RAISE EXCEPTION 'column "%" is not filterable', v_key;
      END IF;
      IF v_op IS NULL OR NOT (v_ops @> to_jsonb(v_op)) THEN
        RAISE EXCEPTION 'operator "%" not allowed for column "%"', v_op, v_key;
      END IF;
      -- value-shape checks
      v_val := v_elem->'value';
      IF v_op IN ('in','not_in') THEN
        IF v_val IS NULL OR jsonb_typeof(v_val) <> 'array' OR jsonb_array_length(v_val) < 1 THEN
          RAISE EXCEPTION 'operator "%" requires a non-empty array value (column %)', v_op, v_key;
        END IF;
      ELSIF v_op IN ('is_null','is_not_null') THEN
        NULL; -- no value needed
      ELSE
        IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
          RAISE EXCEPTION 'operator "%" requires a value (column %)', v_op, v_key;
        END IF;
        IF v_type = 'number' AND jsonb_typeof(v_val) <> 'number' THEN
          RAISE EXCEPTION 'column "%" expects a number value', v_key;
        END IF;
        IF v_type = 'boolean' AND jsonb_typeof(v_val) <> 'boolean' THEN
          RAISE EXCEPTION 'column "%" expects a boolean value', v_key;
        END IF;
        IF v_type IN ('text','enum','date') AND jsonb_typeof(v_val) <> 'string' THEN
          RAISE EXCEPTION 'column "%" expects a string value', v_key;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- sort: each column must be a catalog column; dir asc/desc; max 3.
  IF p_spec ? 'sort' THEN
    IF jsonb_typeof(p_spec->'sort') <> 'array' THEN
      RAISE EXCEPTION 'spec.sort must be an array';
    END IF;
    IF jsonb_array_length(p_spec->'sort') > 3 THEN
      RAISE EXCEPTION 'at most 3 sort columns allowed';
    END IF;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_spec->'sort') LOOP
      v_key := v_elem->>'column';
      IF NOT (v_colmap ? v_key) THEN
        RAISE EXCEPTION 'unknown sort column "%"', v_key;
      END IF;
      IF lower(COALESCE(v_elem->>'dir','asc')) NOT IN ('asc','desc') THEN
        RAISE EXCEPTION 'sort dir must be asc or desc';
      END IF;
    END LOOP;
  END IF;
END;
$function$;

-- _report_build_and_run: validate (via the helper above), construct a
-- parameterized SQL string from the validated spec, EXECUTE ... USING the
-- collected text params, and return the runtime payload. SECURITY DEFINER so
-- it can read across the joined tables; the tenant filter is ALWAYS appended,
-- so a definer query still only returns the caller's rows.
CREATE OR REPLACE FUNCTION public._report_build_and_run(p_spec jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cat     jsonb := public.bp_get_report_builder_catalog();
  v_entity  text  := p_spec->>'entity';
  v_ent     jsonb;
  v_colmap  jsonb := '{}'::jsonb;
  v_c       jsonb;
  v_elem    jsonb;
  v_key     text;
  v_op      text;
  v_type    text;
  v_cast    text;
  v_acast   text;
  v_colexpr text;
  v_pairs   text := '';
  v_where   text := '';
  v_order   text := '';
  v_limit   int;
  v_params  text[] := ARRAY[]::text[];
  v_pidx    int := 0;
  v_ph      text;
  v_sub     jsonb;
  v_sql     text;
  v_rows    jsonb;
BEGIN
  -- Re-validate (defense in depth — a saved spec may predate a catalog change).
  PERFORM public._report_validate_spec(p_spec);

  SELECT e INTO v_ent
  FROM jsonb_array_elements(v_cat->'entities') e
  WHERE e->>'key' = v_entity;

  FOR v_c IN SELECT * FROM jsonb_array_elements(v_ent->'columns') LOOP
    v_colmap := v_colmap || jsonb_build_object(v_c->>'key', v_c);
  END LOOP;

  -- SELECT object pairs: 'key', <colexpr>, ...
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_spec->'columns') LOOP
    v_key := v_elem #>> '{}';
    v_colexpr := public._report_col_sql(v_entity, v_key);
    v_pairs := v_pairs
      || CASE WHEN v_pairs = '' THEN '' ELSE ', ' END
      || quote_literal(v_key) || ', ' || v_colexpr;
  END LOOP;

  -- WHERE from filters (all AND-combined). Values parameterized.
  IF p_spec ? 'filters' THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_spec->'filters') LOOP
      v_key  := v_elem->>'column';
      v_op   := v_elem->>'op';
      v_c    := v_colmap->v_key;
      v_type := v_c->>'type';
      v_colexpr := public._report_col_sql(v_entity, v_key);
      v_cast := CASE v_type
                  WHEN 'date' THEN '::date'
                  WHEN 'number' THEN '::numeric'
                  WHEN 'boolean' THEN '::boolean'
                  ELSE '' END;
      v_acast := CASE v_type
                  WHEN 'date' THEN '::date[]'
                  WHEN 'number' THEN '::numeric[]'
                  WHEN 'boolean' THEN '::boolean[]'
                  ELSE '::text[]' END;

      IF v_op IN ('is_null','is_not_null') THEN
        v_where := v_where || ' AND (' || v_colexpr
          || CASE v_op WHEN 'is_null' THEN ' IS NULL' ELSE ' IS NOT NULL' END || ')';

      ELSIF v_op IN ('in','not_in') THEN
        v_ph := '';
        FOR v_sub IN SELECT * FROM jsonb_array_elements(v_elem->'value') LOOP
          v_pidx := v_pidx + 1;
          v_params := v_params || (v_sub #>> '{}');
          v_ph := v_ph || CASE WHEN v_ph = '' THEN '' ELSE ',' END || '$' || v_pidx;
        END LOOP;
        v_where := v_where || ' AND ('
          || CASE WHEN v_op = 'not_in' THEN 'NOT (' ELSE '' END
          || v_colexpr || ' = ANY(ARRAY[' || v_ph || ']' || v_acast || ')'
          || CASE WHEN v_op = 'not_in' THEN ')' ELSE '' END
          || ')';

      ELSIF v_op = 'contains' THEN
        v_pidx := v_pidx + 1;
        v_params := v_params || (v_elem->>'value');
        v_where := v_where || ' AND (' || v_colexpr
          || ' ILIKE (''%'' || $' || v_pidx || ' || ''%''))';

      ELSIF v_op = 'starts_with' THEN
        v_pidx := v_pidx + 1;
        v_params := v_params || (v_elem->>'value');
        v_where := v_where || ' AND (' || v_colexpr
          || ' ILIKE ($' || v_pidx || ' || ''%''))';

      ELSE
        -- comparison ops: = != <> > >= < <=
        v_pidx := v_pidx + 1;
        v_params := v_params || (v_elem->>'value');
        v_where := v_where || ' AND (' || v_colexpr || ' '
          || CASE WHEN v_op = '!=' THEN '<>' ELSE v_op END
          || ' $' || v_pidx || v_cast || ')';
      END IF;
    END LOOP;
  END IF;

  -- ORDER BY: from spec.sort, else entity default_sort.
  IF p_spec ? 'sort' AND jsonb_array_length(p_spec->'sort') > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_spec->'sort') LOOP
      v_colexpr := public._report_col_sql(v_entity, v_elem->>'column');
      v_order := v_order
        || CASE WHEN v_order = '' THEN '' ELSE ', ' END
        || v_colexpr || ' '
        || CASE WHEN lower(COALESCE(v_elem->>'dir','asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END
        || ' NULLS LAST';
    END LOOP;
  ELSE
    v_colexpr := public._report_col_sql(v_entity, v_ent->'default_sort'->>'column');
    v_order := v_colexpr || ' '
      || CASE WHEN lower(COALESCE(v_ent->'default_sort'->>'dir','asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END
      || ' NULLS LAST';
  END IF;

  -- LIMIT: default 1000, cap 10000.
  v_limit := COALESCE((p_spec->>'limit')::int, 1000);
  IF v_limit < 1 THEN v_limit := 1; END IF;
  IF v_limit > 10000 THEN v_limit := 10000; END IF;

  v_sql :=
    'SELECT COALESCE(jsonb_agg(obj ORDER BY rn), ''[]''::jsonb) FROM ('
    || ' SELECT jsonb_build_object(' || v_pairs || ') AS obj,'
    || ' row_number() OVER (ORDER BY ' || v_order || ') AS rn'
    || ' FROM ' || public._report_from_sql(v_entity)
    || ' WHERE 1=1' || v_where
    || ' AND p.tenant_id = ANY(public.auth_tenant_ids())'
    || ' ORDER BY ' || v_order
    || ' LIMIT ' || v_limit
    || ') s';

  BEGIN
    EXECUTE v_sql USING VARIADIC v_params INTO v_rows;
  EXCEPTION WHEN OTHERS THEN
    -- Never leak the constructed SQL or the DB error detail.
    RAISE EXCEPTION 'report execution failed';
  END;

  v_rows := COALESCE(v_rows, '[]'::jsonb);
  RETURN jsonb_build_object(
    'rows', v_rows,
    'row_count', jsonb_array_length(v_rows),
    'executed_at', now(),
    'spec_version', 1
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Public RPCs
-- ---------------------------------------------------------------------------
-- Run a saved report by id (any tenant member). Looks up the row in the
-- caller's tenant, then runs its stored spec through the shared executor.
CREATE OR REPLACE FUNCTION public.bp_run_saved_report(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_spec jsonb;
BEGIN
  SELECT spec INTO v_spec
  FROM public.saved_reports
  WHERE id = p_id AND tenant_id = ANY(public.auth_tenant_ids());
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'report % not found', p_id;
  END IF;
  RETURN public._report_build_and_run(v_spec);
END;
$function$;

-- Preview an inline spec (no saved row) — the builder's Preview button. Same
-- validate + execute path as run.
CREATE OR REPLACE FUNCTION public.bp_preview_report_spec(p_spec jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public._report_build_and_run(p_spec);
END;
$function$;

-- Create / edit a custom report's spec + metadata. Validates the spec against
-- the catalog (raise on invalid). Builtins are not editable here.
CREATE OR REPLACE FUNCTION public.bp_upsert_custom_report_spec(
  p_id          uuid,
  p_category_id uuid,
  p_name        text,
  p_description text,
  p_position    integer,
  p_spec        jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_primary uuid   := (public.auth_tenant_ids())[1];
  v_id      uuid;
  v_kind    text;
BEGIN
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'report name is required';
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.report_categories
    WHERE id = p_category_id AND tenant_id = ANY(v_tenants)
  ) THEN
    RAISE EXCEPTION 'category % not found in caller tenant', p_category_id;
  END IF;

  -- Validate the spec (raises on any rule violation).
  PERFORM public._report_validate_spec(p_spec);

  IF p_id IS NULL THEN
    INSERT INTO public.saved_reports
      (tenant_id, category_id, name, description, kind, builtin_key, spec, position)
    VALUES (
      v_primary, p_category_id, TRIM(p_name), COALESCE(p_description, ''),
      'custom', NULL, p_spec, COALESCE(p_position, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT kind INTO v_kind
    FROM public.saved_reports
    WHERE id = p_id AND tenant_id = ANY(v_tenants);
    IF v_kind IS NULL THEN
      RAISE EXCEPTION 'report % not found in caller tenant', p_id;
    END IF;
    IF v_kind = 'builtin' THEN
      RAISE EXCEPTION 'builtin reports cannot be edited as custom specs';
    END IF;
    UPDATE public.saved_reports
      SET category_id = p_category_id,
          name        = TRIM(p_name),
          description = COALESCE(p_description, ''),
          position    = COALESCE(p_position, position),
          spec        = p_spec,
          updated_at  = now()
    WHERE id = p_id AND tenant_id = ANY(v_tenants)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$;

-- Fetch a single saved report incl. its spec (the hub list omits spec). Used
-- by the viewer's "Edit" + the builder's edit mode to pre-populate. Tenant-
-- scoped read; any member can read, the builder gates editing on admin.
CREATE OR REPLACE FUNCTION public.bp_get_saved_report(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', r.id,
    'category_id', r.category_id,
    'name', r.name,
    'description', r.description,
    'kind', r.kind,
    'builtin_key', r.builtin_key,
    'spec', r.spec,
    'position', r.position
  )
  FROM public.saved_reports r
  WHERE r.id = p_id AND r.tenant_id = ANY(public.auth_tenant_ids());
$function$;

GRANT EXECUTE ON FUNCTION public.bp_run_saved_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_preview_report_spec(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_upsert_custom_report_spec(uuid, uuid, text, text, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_get_saved_report(uuid) TO authenticated;
