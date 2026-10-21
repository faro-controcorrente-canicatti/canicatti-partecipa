BEGIN;
CREATE POLICY cp_lettore_iniziative_complete ON public.iniziative FOR SELECT TO authenticated USING((SELECT auth.uid())='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid);
CREATE POLICY cp_lettore_comunicazioni_complete ON public.comunicazioni FOR SELECT TO authenticated USING((SELECT auth.uid())='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid);
CREATE POLICY cp_lettore_foto_pannello ON storage.objects FOR SELECT TO authenticated USING(bucket_id IN ('foto-iniziative','foto-comunicazioni') AND (SELECT auth.uid())='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid);
CREATE OR REPLACE FUNCTION public.cp_statistiche_visite() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE risultato jsonb;
BEGIN
 IF NOT coalesce((auth.uid()='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid AND auth.jwt()->>'aal'='aal2') OR auth.uid()='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid,false) THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('inizio',(SELECT min(giorno) FROM public.cp_visite_giorni),'totale',coalesce((SELECT sum(visualizzazioni) FROM public.cp_visite_giorni),0),'visite',coalesce((SELECT sum(visite) FROM public.cp_visite_giorni),0),'giorni',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY giorno DESC) FROM (SELECT * FROM public.cp_visite_giorni WHERE giorno>=(now() AT TIME ZONE 'Europe/Rome')::date-29) x),'[]'::jsonb),'pagine',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT pagina,sum(visualizzazioni) visualizzazioni FROM public.cp_visite_pagine GROUP BY pagina ORDER BY sum(visualizzazioni) DESC) x),'[]'::jsonb)) INTO risultato;
 RETURN risultato;
END $$;

COMMIT;
