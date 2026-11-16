-- A fila usa updated_at para manter atendimentos recém-atualizados no topo.
create index service_requests_updated_at_idx
  on public.service_requests (updated_at desc);

create index service_requests_status_updated_at_idx
  on public.service_requests (status, updated_at desc);
