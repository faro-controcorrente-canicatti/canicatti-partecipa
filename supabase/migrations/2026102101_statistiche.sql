BEGIN;
CREATE TABLE public.cp_visite_giorni(giorno date PRIMARY KEY, visualizzazioni bigint NOT NULL DEFAULT 0, visite bigint NOT NULL DEFAULT 0, visitatori bigint NOT NULL DEFAULT 0);
CREATE TABLE public.cp_visite_pagine(giorno date NOT NULL, pagina text NOT NULL, visualizzazioni bigint NOT NULL DEFAULT 0, PRIMARY KEY(giorno,pagina));
CREATE TABLE public.cp_visite_browser(giorno date NOT NULL, impronta text NOT NULL CHECK(length(impronta)=64), ultima timestamptz NOT NULL, conteggio integer NOT NULL DEFAULT 1, PRIMARY KEY(giorno,impronta));
CREATE TABLE public.cp_aperture_admin(id uuid PRIMARY KEY, utente uuid NOT NULL, creata timestamptz NOT NULL DEFAULT now(), inviata boolean NOT NULL DEFAULT false);
ALTER TABLE public.cp_visite_giorni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cp_visite_pagine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cp_visite_browser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cp_aperture_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cp_visite_giorni, public.cp_visite_pagine, public.cp_visite_browser,public.cp_aperture_admin FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cp_visite_giorni,public.cp_visite_pagine,public.cp_visite_browser,public.cp_aperture_admin TO service_role;
CREATE FUNCTION public.cp_registra_visita(p_impronta text,p_pagina text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d date := (now() AT TIME ZONE 'Europe/Rome')::date; b public.cp_visite_browser; nuova boolean; sessione boolean;
BEGIN
 IF p_impronta !~ '^[a-f0-9]{64}$' OR p_pagina NOT IN ('/index.html','/partecipa.html','/idee.html','/adozione.html','/stato.html','/iniziative.html','/come-funziona.html','/privacy.html','/cookie.html','/note-legali.html') THEN RAISE EXCEPTION 'INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(d::text||p_impronta,0));
 SELECT * INTO b FROM public.cp_visite_browser WHERE giorno=d AND impronta=p_impronta;
 nuova := NOT FOUND; sessione := nuova OR b.ultima < now()-interval '30 minutes';
 IF NOT nuova AND (b.ultima > now()-interval '2 seconds' OR b.conteggio>=600) THEN RETURN; END IF;
 INSERT INTO public.cp_visite_browser VALUES(d,p_impronta,now(),1) ON CONFLICT(giorno,impronta) DO UPDATE SET ultima=now(),conteggio=cp_visite_browser.conteggio+1;
 INSERT INTO public.cp_visite_giorni VALUES(d,1,sessione::integer,nuova::integer) ON CONFLICT(giorno) DO UPDATE SET visualizzazioni=cp_visite_giorni.visualizzazioni+1,visite=cp_visite_giorni.visite+excluded.visite,visitatori=cp_visite_giorni.visitatori+excluded.visitatori;
 INSERT INTO public.cp_visite_pagine VALUES(d,p_pagina,1) ON CONFLICT(giorno,pagina) DO UPDATE SET visualizzazioni=cp_visite_pagine.visualizzazioni+1;
 DELETE FROM public.cp_visite_browser WHERE giorno<d-2;
END $$;
REVOKE ALL ON FUNCTION public.cp_registra_visita(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cp_registra_visita(text,text) TO service_role;
CREATE FUNCTION public.cp_statistiche_visite() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE risultato jsonb;
BEGIN
 IF auth.uid() IS DISTINCT FROM '74b7a543-e730-4b67-9065-a05364f0ea50'::uuid THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('inizio',(SELECT min(giorno) FROM public.cp_visite_giorni),'totale',coalesce((SELECT sum(visualizzazioni) FROM public.cp_visite_giorni),0),'visite',coalesce((SELECT sum(visite) FROM public.cp_visite_giorni),0),'giorni',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY giorno DESC) FROM (SELECT * FROM public.cp_visite_giorni WHERE giorno>=(now() AT TIME ZONE 'Europe/Rome')::date-29) x),'[]'::jsonb),'pagine',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT pagina,sum(visualizzazioni) visualizzazioni FROM public.cp_visite_pagine GROUP BY pagina ORDER BY sum(visualizzazioni) DESC) x),'[]'::jsonb)) INTO risultato;
 RETURN risultato;
END $$;
REVOKE ALL ON FUNCTION public.cp_statistiche_visite() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cp_statistiche_visite() TO authenticated;
COMMIT;
