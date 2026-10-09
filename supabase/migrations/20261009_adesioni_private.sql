BEGIN;
CREATE TABLE public.cp_adesioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE CHECK (event_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  stato text NOT NULL DEFAULT 'Da valutare' CHECK (stato IN ('Da valutare','In gestione','Chiusa')),
  nome text NOT NULL,
  email text NOT NULL,
  telefono text,
  tipo text NOT NULL,
  zona text NOT NULL,
  messaggio text
);
ALTER TABLE public.cp_adesioni ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cp_adesioni FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cp_adesioni TO service_role;
GRANT SELECT,UPDATE ON public.cp_adesioni TO authenticated;
CREATE POLICY "Gestione adesioni solo amministratore" ON public.cp_adesioni FOR ALL TO authenticated
USING ((SELECT auth.uid())='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid)
WITH CHECK ((SELECT auth.uid())='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid);
COMMENT ON TABLE public.cp_adesioni IS 'Adesioni persistenti prima dell’invio email; accesso solo servizio e amministratore del progetto. Nessuna cancellazione automatica.';
COMMIT;
