BEGIN;
CREATE TABLE IF NOT EXISTS public.cp_messaggi_pratica (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pratica_id bigint NOT NULL REFERENCES public.segnalazioni_cittadini(id) ON DELETE CASCADE,
 event_key text NOT NULL UNIQUE,
 direzione text NOT NULL CHECK(direzione IN ('uscita','entrata')),
 origine text NOT NULL CHECK(origine IN ('email','manuale')),
 stato text NOT NULL CHECK(stato IN ('in_invio','accettato','errore','ricevuto','registrato')),
 mittente text NOT NULL,
 destinatario text NOT NULL,
 oggetto text NOT NULL DEFAULT '',
 testo text NOT NULL DEFAULT '',
 documenti jsonb NOT NULL DEFAULT '[]',
 provider_id text,
 verifica text,
 data_messaggio timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_messaggi_pratica_ordine ON public.cp_messaggi_pratica(pratica_id,data_messaggio,id);
ALTER TABLE public.cp_messaggi_pratica ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cp_messaggi_pratica FROM anon,authenticated;
GRANT SELECT ON public.cp_messaggi_pratica TO authenticated;
GRANT ALL ON public.cp_messaggi_pratica TO service_role;
CREATE POLICY cp_messaggi_lettura ON public.cp_messaggi_pratica FOR SELECT TO authenticated USING (
 (auth.uid()='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid AND auth.jwt()->>'aal'='aal2')
 OR auth.uid()='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid
);
CREATE OR REPLACE FUNCTION public.cp_registra_risposta(p_pratica_id bigint,p_testo text,p_data timestamptz,p_richiesta uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE risultato uuid; mittente text;
BEGIN
 IF NOT coalesce(auth.uid()='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid AND auth.jwt()->>'aal'='aal2',false) THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;
 IF p_testo IS NULL OR length(trim(p_testo))=0 OR length(p_testo)>20000 OR p_data IS NULL OR p_data>now()+interval '5 minutes' OR p_richiesta IS NULL THEN RAISE EXCEPTION 'Testo o data non validi'; END IF;
 SELECT email INTO mittente FROM public.segnalazioni_cittadini WHERE id=p_pratica_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pratica non trovata'; END IF;
 INSERT INTO public.cp_messaggi_pratica(pratica_id,event_key,direzione,origine,stato,mittente,destinatario,oggetto,testo,data_messaggio)
 VALUES(p_pratica_id,'manuale:'||p_pratica_id||':'||p_richiesta,'entrata','manuale','registrato',coalesce(mittente,''),'info@canicattipartecipa.it','Risposta registrata dall’amministratore',trim(p_testo),p_data)
 ON CONFLICT(event_key) DO NOTHING RETURNING id INTO risultato;
 IF risultato IS NULL THEN SELECT id INTO risultato FROM public.cp_messaggi_pratica WHERE event_key='manuale:'||p_pratica_id||':'||p_richiesta; END IF;
 RETURN risultato;
END $$;
REVOKE ALL ON FUNCTION public.cp_registra_risposta(bigint,text,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cp_registra_risposta(bigint,text,timestamptz,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
