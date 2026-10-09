-- Autorizzazione specifica dell’utente acquisita prima dell’azione.
BEGIN;
GRANT SELECT ON public.proposte_citta TO service_role;
COMMIT;
