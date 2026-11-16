-- Usa a classe literal [+] para evitar ambiguidades de escape no regex armazenado pelo Postgres.
alter table public.service_requests
  drop constraint service_requests_customer_whatsapp_check;

alter table public.service_requests
  add constraint service_requests_customer_whatsapp_check
  check (customer_whatsapp ~ '^[+]?[0-9() .-]{8,24}$');
