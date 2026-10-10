-- FASE 1: prepara il percorso server. Non revoca ancora gli INSERT pubblici.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cp_ingresso_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email_hash text NOT NULL CHECK(email_hash ~ '^[a-f0-9]{64}$'),
 flusso text NOT NULL CHECK(flusso IN ('segnalazione','proposta')),
 created_at timestamptz NOT NULL DEFAULT now(),
 submitted_at timestamptz,
 risultato jsonb
);
CREATE INDEX IF NOT EXISTS cp_ingresso_email_data ON public.cp_ingresso_tickets(email_hash,created_at);
CREATE TABLE IF NOT EXISTS public.cp_ingresso_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES public.cp_ingresso_tickets(id) ON DELETE CASCADE,
 bucket text NOT NULL CHECK(bucket IN ('segnalazioni-foto','allegati-proposte')),
 percorso text NOT NULL UNIQUE,
 genere text NOT NULL CHECK(genere IN ('foto','documento')),
 nome text NOT NULL,
 mime text NOT NULL,
 dimensione bigint NOT NULL CHECK(dimensione BETWEEN 1 AND 10485760),
 pronto boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_ingresso_file_ticket ON public.cp_ingresso_files(ticket_id);
ALTER TABLE public.cp_ingresso_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cp_ingresso_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cp_ingresso_tickets,public.cp_ingresso_files FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cp_ingresso_tickets,public.cp_ingresso_files TO service_role;

CREATE OR REPLACE FUNCTION public.cp_prepara_ingresso(p_email_hash text,p_flusso text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF p_email_hash !~ '^[a-f0-9]{64}$' OR p_flusso NOT IN ('segnalazione','proposta') THEN RAISE EXCEPTION 'CP_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(261010,701);
 -- Solo metadati tecnici temporanei; nessuna pratica o fotografia viene cancellata.
 DELETE FROM public.cp_ingresso_tickets WHERE created_at < now()-interval '7 days';
 IF (SELECT count(*) FROM public.cp_ingresso_tickets WHERE created_at>now()-interval '10 minutes')>=100
 OR (SELECT count(*) FROM public.cp_ingresso_tickets WHERE email_hash=p_email_hash AND created_at>now()-interval '1 day')>=12
 THEN RAISE EXCEPTION 'CP_LIMIT'; END IF;
 INSERT INTO public.cp_ingresso_tickets(email_hash,flusso) VALUES(p_email_hash,p_flusso) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cp_prenota_file(p_ticket uuid,p_genere text,p_nome text,p_mime text,p_dimensione bigint,p_estensione text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.cp_ingresso_tickets; v_id uuid:=gen_random_uuid(); v_path text; v_bucket text; v_limite integer;
BEGIN
 PERFORM pg_advisory_xact_lock(261010,701);
 SELECT * INTO t FROM public.cp_ingresso_tickets WHERE id=p_ticket FOR UPDATE;
 IF NOT FOUND OR t.submitted_at IS NOT NULL OR t.created_at<now()-interval '1 hour' THEN RAISE EXCEPTION 'CP_TICKET'; END IF;
 IF p_genere NOT IN ('foto','documento') OR (t.flusso='segnalazione' AND p_genere<>'foto') OR p_dimensione NOT BETWEEN 1 AND 10485760
 OR length(p_nome) NOT BETWEEN 1 AND 255 OR p_estensione !~ '^[a-z0-9]{2,5}$' OR length(p_mime)>100 THEN RAISE EXCEPTION 'CP_INPUT'; END IF;
 v_limite:=CASE WHEN t.flusso='segnalazione' THEN 5 ELSE 3 END;
 IF (SELECT count(*) FROM public.cp_ingresso_files WHERE ticket_id=p_ticket AND genere=p_genere)>=v_limite
 OR (SELECT coalesce(sum(dimensione),0) FROM public.cp_ingresso_files WHERE created_at>now()-interval '1 hour')+p_dimensione>209715200
 OR (SELECT coalesce(sum(dimensione),0) FROM public.cp_ingresso_files WHERE created_at>now()-interval '1 day')+p_dimensione>524288000
 THEN RAISE EXCEPTION 'CP_LIMIT'; END IF;
 v_bucket:=CASE WHEN t.flusso='segnalazione' THEN 'segnalazioni-foto' ELSE 'allegati-proposte' END;
 v_path:=CASE WHEN t.flusso='segnalazione' THEN 'segnalazioni/' ELSE 'proposte/' END||p_ticket::text||'/'||v_id::text||'.'||p_estensione;
 INSERT INTO public.cp_ingresso_files(id,ticket_id,bucket,percorso,genere,nome,mime,dimensione)
 VALUES(v_id,p_ticket,v_bucket,v_path,p_genere,p_nome,p_mime,p_dimensione);
 RETURN jsonb_build_object('id',v_id,'bucket',v_bucket,'percorso',v_path,'nome',p_nome,'tipo',p_mime,'dimensione',p_dimensione);
END $$;

CREATE OR REPLACE FUNCTION public.cp_completa_ingresso(p_ticket uuid,p_dati jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.cp_ingresso_tickets; v_allegati jsonb; v_foto text[]; v_id text; v_numero text; v_result jsonb;
BEGIN
 SELECT * INTO t FROM public.cp_ingresso_tickets WHERE id=p_ticket FOR UPDATE;
 IF NOT FOUND OR t.created_at<now()-interval '1 hour' THEN RAISE EXCEPTION 'CP_TICKET'; END IF;
 IF t.submitted_at IS NOT NULL THEN RETURN t.risultato; END IF;
 IF EXISTS(SELECT 1 FROM public.cp_ingresso_files WHERE ticket_id=p_ticket AND NOT pronto) THEN RAISE EXCEPTION 'CP_FILE'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('nome',nome,'percorso',percorso,'tipo',mime,'dimensione',dimensione) ORDER BY created_at,id),'[]'::jsonb),
 coalesce(array_agg(percorso ORDER BY created_at,id),'{}'::text[])
 INTO v_allegati,v_foto FROM public.cp_ingresso_files WHERE ticket_id=p_ticket AND pronto;
 IF t.flusso='segnalazione' THEN
  IF coalesce(p_dati->'foto_urls','[]'::jsonb)<>to_jsonb(v_foto) THEN RAISE EXCEPTION 'CP_FILE'; END IF;
  v_numero:='CP-'||to_char(now() AT TIME ZONE 'Europe/Rome','YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  INSERT INTO public.segnalazioni_cittadini(tipo,indirizzo,descrizione,nome,contatto,foto_url,foto_urls,stato,data_invio,categoria,telefono,email,numero_pratica)
  VALUES('segnalazione',p_dati->>'indirizzo',p_dati->>'descrizione',p_dati->>'nome',coalesce(nullif(p_dati->>'telefono',''),p_dati->>'email'),v_foto[1],v_foto,'in_attesa',now(),p_dati->>'categoria',nullif(p_dati->>'telefono',''),p_dati->>'email',v_numero)
  RETURNING id::text INTO v_id;
  v_result:=jsonb_build_object('id',v_id,'numero_pratica',v_numero);
 ELSE
  IF coalesce(p_dati->'allegati','[]'::jsonb)<>v_allegati THEN RAISE EXCEPTION 'CP_FILE'; END IF;
  INSERT INTO public.proposte_citta(titolo,categoria,descrizione,zona,nome,cognome,email,telefono,allegati,stato_interno,created_at)
  VALUES(p_dati->>'titolo',p_dati->>'categoria',p_dati->>'descrizione',nullif(p_dati->>'zona',''),p_dati->>'nome',p_dati->>'cognome',p_dati->>'email',nullif(p_dati->>'telefono',''),v_allegati,'Da valutare',now())
  RETURNING id::text INTO v_id;
  v_result:=jsonb_build_object('id',v_id);
 END IF;
 UPDATE public.cp_ingresso_tickets SET submitted_at=now(),risultato=v_result WHERE id=p_ticket;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.cp_prepara_ingresso(text,text),public.cp_prenota_file(uuid,text,text,text,bigint,text),public.cp_completa_ingresso(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cp_prepara_ingresso(text,text),public.cp_prenota_file(uuid,text,text,text,bigint,text),public.cp_completa_ingresso(uuid,jsonb) TO service_role;
COMMENT ON TABLE public.cp_ingresso_tickets IS 'Metadati tecnici temporanei (7 giorni), hash HMAC email, autorizzazione monouso e limiti agli ingressi pubblici. Nessun recapito in chiaro.';
COMMIT;

-- Permessi necessari al servizio interno; nessun accesso nuovo per visitatori.
BEGIN;
GRANT SELECT (manutenzione) ON public.impostazioni_sito TO service_role;
GRANT INSERT (titolo,categoria,descrizione,zona,nome,cognome,email,telefono,allegati,stato_interno,created_at)
 ON public.proposte_citta TO service_role;
COMMIT;
