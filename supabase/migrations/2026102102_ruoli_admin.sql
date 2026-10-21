-- Proprietario: Stefano. Controcorrente: sola lettura di segnalazioni, proposte, adesioni e relativi allegati.
BEGIN;
DO $$ DECLARE r record; q text; c text; BEGIN
 FOR r IN SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') AND policyname<>'cp_admin_richiede_secondo_fattore' AND (qual LIKE '%74b7a543-e730-4b67-9065-a05364f0ea50%' OR with_check LIKE '%74b7a543-e730-4b67-9065-a05364f0ea50%') AND cmd='SELECT' AND ((schemaname='public' AND tablename IN ('segnalazioni_cittadini','proposte_citta')) OR (schemaname='storage' AND (qual LIKE '%segnalazioni-foto%' OR qual LIKE '%allegati-proposte%'))) LOOP
  q:=replace(r.qual,'''74b7a543-e730-4b67-9065-a05364f0ea50''::uuid','ANY(ARRAY[''74b7a543-e730-4b67-9065-a05364f0ea50''::uuid,''e6712a60-873b-446b-90ea-5c6811d2b346''::uuid])');
  EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',r.policyname,r.schemaname,r.tablename,q);
 END LOOP;
 -- Tutte le scritture restano riservate al proprietario, anche dove esistono policy permissive generiche.
 FOR r IN SELECT DISTINCT schemaname,tablename FROM pg_policies WHERE policyname='cp_admin_richiede_secondo_fattore' LOOP
  EXECUTE format('CREATE POLICY cp_solo_proprietario_insert ON %I.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=''74b7a543-e730-4b67-9065-a05364f0ea50''::uuid)',r.schemaname,r.tablename);
  EXECUTE format('CREATE POLICY cp_solo_proprietario_update ON %I.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT auth.uid())=''74b7a543-e730-4b67-9065-a05364f0ea50''::uuid) WITH CHECK ((SELECT auth.uid())=''74b7a543-e730-4b67-9065-a05364f0ea50''::uuid)',r.schemaname,r.tablename);
  EXECUTE format('CREATE POLICY cp_solo_proprietario_delete ON %I.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT auth.uid())=''74b7a543-e730-4b67-9065-a05364f0ea50''::uuid)',r.schemaname,r.tablename);
 END LOOP;
END $$;
CREATE POLICY cp_adesioni_lettore ON public.cp_adesioni FOR SELECT TO authenticated USING((SELECT auth.uid())='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid);
-- Non modifica password, utenti, dati delle pratiche o accessi anonimi.
CREATE OR REPLACE FUNCTION public.cp_secondo_fattore_admin_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT CASE WHEN auth.uid()='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid THEN auth.jwt()->>'aal'='aal2' ELSE true END $$;
COMMIT;
