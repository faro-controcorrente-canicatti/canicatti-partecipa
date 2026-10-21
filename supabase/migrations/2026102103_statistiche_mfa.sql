CREATE OR REPLACE FUNCTION public.cp_statistiche_visite() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE risultato jsonb;
BEGIN
 IF auth.uid() IS DISTINCT FROM '74b7a543-e730-4b67-9065-a05364f0ea50'::uuid OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('inizio',(SELECT min(giorno) FROM public.cp_visite_giorni),'totale',coalesce((SELECT sum(visualizzazioni) FROM public.cp_visite_giorni),0),'visite',coalesce((SELECT sum(visite) FROM public.cp_visite_giorni),0),'giorni',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY giorno DESC) FROM (SELECT * FROM public.cp_visite_giorni WHERE giorno>=(now() AT TIME ZONE 'Europe/Rome')::date-29) x),'[]'::jsonb),'pagine',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT pagina,sum(visualizzazioni) visualizzazioni FROM public.cp_visite_pagine GROUP BY pagina ORDER BY sum(visualizzazioni) DESC) x),'[]'::jsonb)) INTO risultato;
 RETURN risultato;
END $$;
