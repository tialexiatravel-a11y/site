-- Alexia Travel — Fase 1: fila compartilhada de atendimento.
-- A allowlist começa vazia. Até que e-mails sejam autorizados, nenhum usuário pode consultar os registros.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table private.staff_allowlist (
  email text primary key,
  added_at timestamptz not null default pg_catalog.now(),
  constraint staff_allowlist_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  )
);
alter table private.staff_allowlist enable row level security;
revoke all on table private.staff_allowlist from public, anon, authenticated;

create or replace function private.is_authorized_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as u
    join private.staff_allowlist as a
      on a.email = lower(btrim(u.email))
    where u.id = (select auth.uid())
  );
$$;
revoke all on function private.is_authorized_staff() from public, anon, authenticated;
grant execute on function private.is_authorized_staff() to authenticated;

-- O cliente usa este RPC sem parâmetros para exibir uma mensagem de acesso negado.
-- Ele revela apenas true/false para o usuário autenticado, nunca a lista de e-mails.
create or replace function public.current_staff_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_authorized_staff();
$$;
revoke all on function public.current_staff_access() from public, anon, authenticated;
grant execute on function public.current_staff_access() to authenticated;

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 120),
  customer_whatsapp text not null check (customer_whatsapp ~ '^\+?[0-9() .-]{8,24}$'),
  origin text not null check (char_length(btrim(origin)) between 1 and 120),
  destination text not null check (char_length(btrim(destination)) between 1 and 120),
  trip_type text not null default 'round_trip' check (trip_type in ('round_trip', 'one_way')),
  departure_date date not null,
  return_date date,
  adults smallint not null default 1 check (adults between 1 and 9),
  child_ages smallint[] not null default '{}'::smallint[] check (
    cardinality(child_ages) <= 8
    and (cardinality(child_ages) = 0 or array_ndims(child_ages) = 1)
    and 2 <= all(child_ages)
    and 11 >= all(child_ages)
  ),
  baby_ages smallint[] not null default '{}'::smallint[] check (
    cardinality(baby_ages) <= 8
    and (cardinality(baby_ages) = 0 or array_ndims(baby_ages) = 1)
    and 0 <= all(baby_ages)
    and 23 >= all(baby_ages)
  ),
  travel_class text not null default 'any' check (travel_class in ('any', 'economy', 'premium', 'business', 'first')),
  customer_notes text check (customer_notes is null or char_length(customer_notes) <= 800),
  status text not null default 'new' check (status in ('new', 'in_progress', 'quote_sent', 'waiting', 'closed', 'cancelled')),
  assigned_to text check (assigned_to is null or char_length(assigned_to) <= 120),
  follow_up_on date,
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint service_requests_distinct_route check (lower(btrim(origin)) <> lower(btrim(destination))),
  constraint service_requests_return_date check (
    (trip_type = 'round_trip' and return_date is not null and return_date >= departure_date)
    or (trip_type = 'one_way' and return_date is null)
  )
);

comment on table public.service_requests is 'Manual customer travel-service records for the Alexia Travel team; customer data, no payment or identity documents.';
comment on column public.service_requests.child_ages is 'Age in years for each child, 2 through 11.';
comment on column public.service_requests.baby_ages is 'Age in months for each baby, 0 through 23.';
comment on column public.service_requests.assigned_to is 'Optional staff display name entered by an authorized attendant.';

create index service_requests_created_at_idx on public.service_requests (created_at desc);
create index service_requests_status_created_at_idx on public.service_requests (status, created_at desc);
create index service_requests_follow_up_idx on public.service_requests (follow_up_on) where follow_up_on is not null;

create or replace function public.touch_service_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke all on function public.touch_service_request() from public, anon, authenticated;
create trigger service_requests_touch_updated_at
before update on public.service_requests
for each row execute function public.touch_service_request();

alter table public.service_requests enable row level security;
alter table public.service_requests force row level security;
revoke all on table public.service_requests from public, anon, authenticated;
grant select on table public.service_requests to authenticated;
grant insert (
  customer_name, customer_whatsapp, origin, destination, trip_type, departure_date, return_date,
  adults, child_ages, baby_ages, travel_class, customer_notes, status, assigned_to, follow_up_on, internal_notes
) on table public.service_requests to authenticated;
grant update (
  customer_name, customer_whatsapp, origin, destination, trip_type, departure_date, return_date,
  adults, child_ages, baby_ages, travel_class, customer_notes, status, assigned_to, follow_up_on, internal_notes
) on table public.service_requests to authenticated;

create policy service_requests_select_authorized_staff
on public.service_requests for select to authenticated
using ((select private.is_authorized_staff()));

create policy service_requests_insert_authorized_staff
on public.service_requests for insert to authenticated
with check (
  (select private.is_authorized_staff())
  and created_by = (select auth.uid())
);

create policy service_requests_update_authorized_staff
on public.service_requests for update to authenticated
using ((select private.is_authorized_staff()))
with check ((select private.is_authorized_staff()));
