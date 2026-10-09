BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Non sovrascrivere oggetti eventualmente creati nel frattempo.
CREATE TABLE public.cp_email_guard (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[a-f0-9]{64}$'),
  recipient_key text NOT NULL CHECK (recipient_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cp_email_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cp_email_guard FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.cp_email_guard TO service_role;
CREATE INDEX cp_email_guard_recipient_date ON public.cp_email_guard (recipient_key, created_at);
CREATE INDEX cp_email_guard_date ON public.cp_email_guard (created_at);

CREATE FUNCTION public.cp_claim_email(p_event_key text, p_recipient_key text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE existing_date timestamptz;
BEGIN
  IF p_event_key !~ '^[a-f0-9]{64}$' OR p_recipient_key !~ '^[a-f0-9]{64}$'
     OR p_event_key IS NULL OR p_recipient_key IS NULL THEN
    RAISE EXCEPTION 'Invalid notification key';
  END IF;
  -- Serializza solo le prenotazioni, non le chiamate al fornitore email.
  PERFORM pg_catalog.pg_advisory_xact_lock(261009, 600);
  DELETE FROM public.cp_email_guard WHERE created_at < now() - interval '48 hours';
  SELECT created_at INTO existing_date FROM public.cp_email_guard WHERE event_key=p_event_key;
  IF FOUND THEN
    IF existing_date > now() - interval '23 hours' THEN RETURN 'retry'; END IF;
    RETURN 'expired';
  END IF;
  IF (SELECT count(*) FROM public.cp_email_guard WHERE created_at > now() - interval '10 minutes') >= 100
     OR (SELECT count(*) FROM public.cp_email_guard WHERE recipient_key=p_recipient_key AND created_at > now() - interval '1 hour') >= 10 THEN
    RETURN 'limited';
  END IF;
  INSERT INTO public.cp_email_guard(event_key, recipient_key) VALUES (p_event_key,p_recipient_key);
  RETURN 'allowed';
END;
$function$;
REVOKE ALL ON FUNCTION public.cp_claim_email(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cp_claim_email(text,text) TO service_role;
COMMIT;
