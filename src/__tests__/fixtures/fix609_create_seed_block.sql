    IF array_length(v_task_ids, 1) > 0 THEN
      INSERT INTO public.permit_tasks (
        tenant_id, permit_id, bucket, discipline, text, cat,
        assigned_to, co_assignees, waiting_on,
        sort_order, is_jurisdiction_specific
      )
      SELECT
        p_tenant_id, v_permit_id, tt.bucket,
        COALESCE(public.bp_discipline_for_team(tt.default_team), 'ent'),
        tt.text, tt.cat,
        CASE tt.default_team
          WHEN 'Entitlements'     THEN NULLIF(v_permit->>'ent_lead', '')
          WHEN 'Design Associate' THEN NULLIF(v_permit->>'da', '')
          WHEN 'Architecture'     THEN NULLIF(v_permit->>'da', '')
          WHEN 'Schematic Team'   THEN (v_schematic_designer)[1]
          ELSE NULLIF(tt.default_team, '')
        END AS assigned_to,
        (
          SELECT COALESCE(
                   array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL AND r <> ''),
                   ARRAY[]::text[])
          FROM unnest(COALESCE(tt.default_co_assignees, ARRAY[]::text[])) AS elem
          CROSS JOIN LATERAL (
            SELECT CASE
              WHEN elem = 'role:design_associate'
                THEN ARRAY[NULLIF(v_permit->>'da', '')]
              WHEN elem = 'role:design_manager'
                THEN ARRAY[(
                  SELECT g.dm_name FROM public.dm_da_groups g
                  WHERE g.tenant_id = p_tenant_id
                    AND g.da_name = NULLIF(v_permit->>'da', '')
                  LIMIT 1)]
              WHEN elem = 'role:schematic_designer'
                THEN COALESCE(v_schematic_designer, ARRAY[]::text[])
              ELSE ARRAY[elem]
            END AS arr
          ) x
          CROSS JOIN LATERAL unnest(x.arr) AS r
        ) AS co_assignees,
        tt.default_waiting_on AS waiting_on,
        COALESCE(tt.sort_order, 0),
        (tt.jurisdiction IS NOT NULL)
      FROM public.task_templates tt
      WHERE tt.id = ANY(v_task_ids)
        AND tt.permit_type = v_permit_type
        AND (tt.jurisdiction = v_juris OR tt.jurisdiction IS NULL);
