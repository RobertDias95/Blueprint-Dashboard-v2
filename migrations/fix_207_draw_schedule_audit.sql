CREATE TABLE IF NOT EXISTS public.draw_schedule_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  txid text,
  tenant_id uuid,
  project_id uuid,
  op text NOT NULL,
  actor_uid uuid,
  source text,
  da_from text, da_to text,
  start_week_from text, start_week_to text,
  end_week_from text, end_week_to text,
  status_from text, status_to text,
  manually_placed_from boolean, manually_placed_to boolean
);
CREATE INDEX IF NOT EXISTS idx_draw_schedule_audit_project ON public.draw_schedule_audit (project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_draw_schedule_audit_txid ON public.draw_schedule_audit (txid);
CREATE INDEX IF NOT EXISTS idx_draw_schedule_audit_changed_at ON public.draw_schedule_audit (changed_at DESC);
ALTER TABLE public.draw_schedule_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draw_schedule_audit_tenant_select ON public.draw_schedule_audit;
CREATE POLICY draw_schedule_audit_tenant_select ON public.draw_schedule_audit
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));
CREATE OR REPLACE FUNCTION public.bp_audit_draw_schedule()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_source text := current_setting('app.ds_source', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.da_assigned IS NOT DISTINCT FROM OLD.da_assigned
       AND NEW.start_week IS NOT DISTINCT FROM OLD.start_week
       AND NEW.end_week IS NOT DISTINCT FROM OLD.end_week
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.manually_placed IS NOT DISTINCT FROM OLD.manually_placed THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.draw_schedule_audit(txid,tenant_id,project_id,op,actor_uid,source,da_from,da_to,start_week_from,start_week_to,end_week_from,end_week_to,status_from,status_to,manually_placed_from,manually_placed_to)
    VALUES (txid_current()::text,NEW.tenant_id,NEW.project_id,'UPDATE',auth.uid(),v_source,OLD.da_assigned,NEW.da_assigned,OLD.start_week,NEW.start_week,OLD.end_week,NEW.end_week,OLD.status,NEW.status,OLD.manually_placed,NEW.manually_placed);
    RETURN NULL;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.draw_schedule_audit(txid,tenant_id,project_id,op,actor_uid,source,da_from,da_to,start_week_from,start_week_to,end_week_from,end_week_to,status_from,status_to,manually_placed_from,manually_placed_to)
    VALUES (txid_current()::text,NEW.tenant_id,NEW.project_id,'INSERT',auth.uid(),v_source,NULL,NEW.da_assigned,NULL,NEW.start_week,NULL,NEW.end_week,NULL,NEW.status,NULL,NEW.manually_placed);
    RETURN NULL;
  ELSE
    INSERT INTO public.draw_schedule_audit(txid,tenant_id,project_id,op,actor_uid,source,da_from,da_to,start_week_from,start_week_to,end_week_from,end_week_to,status_from,status_to,manually_placed_from,manually_placed_to)
    VALUES (txid_current()::text,OLD.tenant_id,OLD.project_id,'DELETE',auth.uid(),v_source,OLD.da_assigned,NULL,OLD.start_week,NULL,OLD.end_week,NULL,OLD.status,NULL,OLD.manually_placed,NULL);
    RETURN NULL;
  END IF;
END;
$function$;
DROP TRIGGER IF EXISTS draw_schedule_audit_trg ON public.draw_schedule;
CREATE TRIGGER draw_schedule_audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.draw_schedule
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_draw_schedule();
