-- Registra la chiusura senza cancellare pratiche. Applicato e collaudato il 10 ottobre 2026.
BEGIN;
ALTER TABLE public.segnalazioni_cittadini ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.proposte_citta ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE OR REPLACE FUNCTION public.cp_registra_chiusura()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE stato text; precedente text; chiuso boolean; prima_chiuso boolean;
BEGIN
 IF TG_TABLE_NAME='segnalazioni_cittadini' THEN
  stato:=NEW.stato;
  chiuso:=stato IN ('risolta','chiusa','rifiutata');
  IF TG_OP='UPDATE' THEN precedente:=OLD.stato; prima_chiuso:=precedente IN ('risolta','chiusa','rifiutata'); END IF;
 ELSIF TG_TABLE_NAME='proposte_citta' THEN
  stato:=NEW.stato_interno;
  chiuso:=stato='Archiviata';
  IF TG_OP='UPDATE' THEN precedente:=OLD.stato_interno; prima_chiuso:=precedente='Archiviata'; END IF;
 ELSIF TG_TABLE_NAME='cp_adesioni' THEN
  stato:=NEW.stato;
  chiuso:=stato='Chiusa';
  IF TG_OP='UPDATE' THEN precedente:=OLD.stato; prima_chiuso:=precedente='Chiusa'; END IF;
 ELSE RAISE EXCEPTION 'Tabella non prevista';
 END IF;
 IF NOT chiuso THEN
  NEW.closed_at:=NULL;
 ELSIF TG_OP='INSERT' OR NOT coalesce(prima_chiuso,false) THEN
  NEW.closed_at:=statement_timestamp();
 ELSE
  -- Solo per lo storico senza data, l’amministratore può inserire una data ricostruita.
  -- I permessi di UPDATE restano quelli esistenti; nessuna modifica agli accessi.
  IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL THEN
   IF NEW.closed_at>statement_timestamp() THEN RAISE EXCEPTION 'La chiusura non può essere nel futuro'; END IF;
  ELSE NEW.closed_at:=OLD.closed_at;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_registra_chiusura() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER cp_data_chiusura_segnalazione BEFORE INSERT OR UPDATE ON public.segnalazioni_cittadini
 FOR EACH ROW EXECUTE FUNCTION public.cp_registra_chiusura();
CREATE TRIGGER cp_data_chiusura_proposta BEFORE INSERT OR UPDATE ON public.proposte_citta
 FOR EACH ROW EXECUTE FUNCTION public.cp_registra_chiusura();
CREATE TRIGGER cp_data_chiusura_adesione BEFORE INSERT OR UPDATE ON public.cp_adesioni
 FOR EACH ROW EXECUTE FUNCTION public.cp_registra_chiusura();
COMMENT ON COLUMN public.segnalazioni_cittadini.closed_at IS 'Data della chiusura: risolta/chiusa/rifiutata; riapertura azzera. Scadenza ordinaria 12 mesi. Storico senza data da riesaminare.';
COMMENT ON COLUMN public.proposte_citta.closed_at IS 'Data archiviazione; riapertura azzera. Scadenza ordinaria 12 mesi. Storico senza data da riesaminare.';
COMMIT;
