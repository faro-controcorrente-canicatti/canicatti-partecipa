-- Applicato il 10 ottobre 2026 dopo registrazione TOTP personale
-- e conferma del nuovo accesso. Test AAL1/AAL2 e service_role superati.
BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id='74b7a543-e730-4b67-9065-a05364f0ea50' AND status='verified' AND factor_type='totp') THEN RAISE EXCEPTION 'Secondo fattore non ancora verificato'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.cp_secondo_fattore_admin_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT CASE WHEN (SELECT auth.uid())='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid
 THEN (SELECT auth.jwt()->>'aal')='aal2'
 ELSE true END;
$$;
REVOKE ALL ON FUNCTION public.cp_secondo_fattore_admin_ok() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cp_secondo_fattore_admin_ok() TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['perdite','foto_segnalazioni','iniziative','segnalazioni_cittadini','impostazioni_sito','comunicazioni','cp_email_guard','proposte_citta','cp_ingresso_tickets','cp_ingresso_files','cp_adesioni'] LOOP
  EXECUTE format('CREATE POLICY cp_admin_richiede_secondo_fattore ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.cp_secondo_fattore_admin_ok())) WITH CHECK ((SELECT public.cp_secondo_fattore_admin_ok()))',t);
 END LOOP;
END $$;
CREATE POLICY cp_admin_richiede_secondo_fattore ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.cp_secondo_fattore_admin_ok())) WITH CHECK ((SELECT public.cp_secondo_fattore_admin_ok()));
COMMIT;
