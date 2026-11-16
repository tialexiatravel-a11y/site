-- Política explícita de negação total para a tabela privada de e-mails.
create policy staff_allowlist_deny_all
on private.staff_allowlist for all to public
using (false)
with check (false);

-- Wrapper REST de menor privilégio; a função interna, privada, continua verificando a allowlist.
create or replace function public.current_staff_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_authorized_staff();
$$;
revoke all on function public.current_staff_access() from public, anon, authenticated;
grant execute on function public.current_staff_access() to authenticated;
