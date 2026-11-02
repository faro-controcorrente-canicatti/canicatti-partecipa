BEGIN;
ALTER TABLE public.segnalazioni_cittadini
  ADD COLUMN IF NOT EXISTS messaggio_cittadino text,
  ADD COLUMN IF NOT EXISTS documenti_cittadino jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('documenti-pratiche','documenti-pratiche',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT(id) DO NOTHING;
CREATE POLICY cp_documenti_pratiche_inserimento ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='documenti-pratiche' AND auth.uid()='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid AND auth.jwt()->>'aal'='aal2'
AND EXISTS(SELECT 1 FROM public.segnalazioni_cittadini s WHERE s.id::text=(storage.foldername(name))[1]));
CREATE POLICY cp_documenti_pratiche_lettura ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='documenti-pratiche' AND ((auth.uid()='74b7a543-e730-4b67-9065-a05364f0ea50'::uuid AND auth.jwt()->>'aal'='aal2') OR auth.uid()='e6712a60-873b-446b-90ea-5c6811d2b346'::uuid));
NOTIFY pgrst, 'reload schema';
COMMIT;
