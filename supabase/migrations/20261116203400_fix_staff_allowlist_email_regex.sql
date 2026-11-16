-- Corrige a validação de e-mail sem depender de escapes de barra invertida
-- que podem ser alterados em camadas de transporte SQL.
alter table private.staff_allowlist
  drop constraint if exists staff_allowlist_email_normalized;

alter table private.staff_allowlist
  add constraint staff_allowlist_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  );
