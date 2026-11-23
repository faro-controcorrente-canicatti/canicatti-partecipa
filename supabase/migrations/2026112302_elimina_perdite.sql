begin;
-- La policy cp_perdite_gestione limita già l'eliminazione al proprietario con MFA.
grant delete on public.cp_perdite_idriche to authenticated;
commit;
