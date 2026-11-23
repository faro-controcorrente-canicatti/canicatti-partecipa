begin;

create table if not exists public.cp_mappa_perdite (
  id integer primary key default 1 check (id = 1),
  attiva boolean not null default false
);
insert into public.cp_mappa_perdite default values on conflict (id) do nothing;

create table if not exists public.cp_perdite_idriche (
  id uuid primary key default gen_random_uuid(),
  luogo text not null check (char_length(btrim(luogo)) between 1 and 180),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  segnalata_il date not null,
  riparata_il date check (riparata_il >= segnalata_il),
  revisione integer not null default 1 check (revisione > 0),
  foto bytea check (octet_length(foto) between 1 and 5242880),
  foto_tipo text check (foto_tipo in ('image/jpeg', 'image/png', 'image/webp')),
  pdf bytea check (octet_length(pdf) between 5 and 5242880 and substring(pdf for 5) = decode('255044462d', 'hex')),
  ha_pdf boolean generated always as (pdf is not null) stored,
  check ((foto is null) = (foto_tipo is null)),
  check (foto is null or case foto_tipo
    when 'image/jpeg' then substring(foto for 3) = decode('ffd8ff', 'hex')
    when 'image/png' then substring(foto for 8) = decode('89504e470d0a1a0a', 'hex')
    when 'image/webp' then substring(foto for 4) = decode('52494646', 'hex')
      and substring(foto from 9 for 4) = decode('57454250', 'hex')
  end)
);
create index if not exists cp_perdite_ordine on public.cp_perdite_idriche (segnalata_il desc, id);

alter table public.cp_mappa_perdite enable row level security;
alter table public.cp_perdite_idriche enable row level security;

revoke all on public.cp_mappa_perdite, public.cp_perdite_idriche from public, anon, authenticated;
grant select on public.cp_mappa_perdite, public.cp_perdite_idriche to anon, authenticated;
grant update (attiva) on public.cp_mappa_perdite to authenticated;
grant insert, update on public.cp_perdite_idriche to authenticated;

drop policy if exists cp_mappa_lettura on public.cp_mappa_perdite;
create policy cp_mappa_lettura on public.cp_mappa_perdite
  for select to anon, authenticated using (true);
drop policy if exists cp_mappa_gestione on public.cp_mappa_perdite;
create policy cp_mappa_gestione on public.cp_mappa_perdite
  for update to authenticated
  using ((select auth.uid()) = '74b7a543-e730-4b67-9065-a05364f0ea50' and (select auth.jwt())->>'aal' = 'aal2');

drop policy if exists cp_perdite_pubbliche on public.cp_perdite_idriche;
create policy cp_perdite_pubbliche on public.cp_perdite_idriche
  for select to anon, authenticated
  using ((select attiva from public.cp_mappa_perdite where id = 1));
drop policy if exists cp_perdite_gestione on public.cp_perdite_idriche;
create policy cp_perdite_gestione on public.cp_perdite_idriche
  for all to authenticated
  using ((select auth.uid()) = '74b7a543-e730-4b67-9065-a05364f0ea50' and (select auth.jwt())->>'aal' = 'aal2');

notify pgrst, 'reload schema';
commit;
