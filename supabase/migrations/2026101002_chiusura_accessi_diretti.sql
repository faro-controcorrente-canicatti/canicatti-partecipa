-- FASE 3: applicare soltanto dopo distribuzione e collaudo dei nuovi moduli.
BEGIN;
CREATE POLICY "Segnalazioni solo tramite ingresso protetto" ON public.segnalazioni_cittadini
 AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK((SELECT auth.uid())='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid);
CREATE POLICY "Proposte solo tramite ingresso protetto" ON public.proposte_citta
 AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK((SELECT auth.uid())='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid);
CREATE POLICY "Allegati cittadini solo tramite ingresso protetto" ON storage.objects
 AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK(bucket_id NOT IN ('segnalazioni-foto','allegati-proposte') OR (SELECT auth.uid())='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid);
COMMIT;
