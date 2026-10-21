-- Consente al proprietario di eliminare le adesioni dal pannello.
-- RLS esistente: solo UID proprietario e secondo fattore verificato.
GRANT DELETE ON TABLE public.cp_adesioni TO authenticated;
