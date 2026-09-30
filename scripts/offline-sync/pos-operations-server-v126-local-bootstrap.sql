create schema if not exists auth;

do $roles$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
      execute pg_catalog.format('create role %I nologin', role_name);
    end if;
  end loop;
end;
$roles$;

create table if not exists auth.users (
  id uuid primary key
);
