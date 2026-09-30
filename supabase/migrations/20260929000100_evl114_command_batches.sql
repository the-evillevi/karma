create table public.branches (
  branch_id text primary key,
  name text not null,
  currency text not null check (currency = 'MXN'),
  created_at timestamptz not null default now()
);

create table public.branch_memberships (
  branch_id text not null references public.branches(branch_id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('duena', 'encargado', 'barra', 'mesero')),
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id)
);

create table public.register_devices (
  device_id text primary key,
  branch_id text not null references public.branches(branch_id),
  owner_user_id uuid not null references auth.users(id),
  capability text not null check (capability in ('cash_register', 'preparation', 'read_only')),
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (branch_id, device_id),
  foreign key (branch_id, owner_user_id) references public.branch_memberships(branch_id, user_id)
);

-- One active writer lease per branch. Local client clocks are not trusted by
-- Postgres; the server checks this lease when an offline batch reconnects.
create table public.branch_register_leases (
  branch_id text primary key references public.branches(branch_id),
  device_id text not null,
  lease_id text not null unique,
  valid_from timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  issued_by uuid not null references auth.users(id),
  foreign key (branch_id, device_id) references public.register_devices(branch_id, device_id),
  check (expires_at > valid_from)
);

-- A complete command plus all its ordered domain events is a single
-- immutable/Postgres-atomic acknowledgement unit. Projection rows are derived.
create table public.command_batches (
  command_id text primary key check (length(command_id) between 1 and 100 and btrim(command_id) <> ''),
  branch_id text not null references public.branches(branch_id) check (length(branch_id) between 1 and 100 and btrim(branch_id) <> ''),
  aggregate_id text not null check (length(aggregate_id) between 1 and 100 and btrim(aggregate_id) <> ''),
  actor_id uuid not null references auth.users(id),
  device_id text not null check (length(device_id) between 1 and 100 and btrim(device_id) <> ''),
  lease_id text not null check (length(lease_id) between 1 and 100 and btrim(lease_id) <> ''),
  schema_version integer not null check (schema_version = 1),
  occurred_at timestamptz not null,
  events jsonb not null check (
    case when jsonb_typeof(events) = 'array'
      then jsonb_array_length(events) between 1 and 100 and octet_length(events::text) <= 1048576
      else false
    end
  ),
  received_at timestamptz not null default clock_timestamp(),
  foreign key (branch_id, device_id) references public.register_devices(branch_id, device_id)
);

create function public.validate_command_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item record;
  expected_event_id text;
begin
  for item in
    select value as event, ordinality - 1 as event_index
    from pg_catalog.jsonb_array_elements(new.events) with ordinality
  loop
    if jsonb_typeof(item.event) is distinct from 'object' then
      raise exception 'each event must be a JSON object' using errcode = '22023';
    end if;
    expected_event_id := new.command_id || ':' || item.event_index::text;
    if item.event ->> 'eventId' is distinct from expected_event_id then
      raise exception 'eventId must be commandId plus its zero-based batch index' using errcode = '22023';
    end if;
    if item.event ->> 'commandId' is distinct from new.command_id
      or item.event ->> 'aggregateId' is distinct from new.aggregate_id
      or item.event ->> 'actorId' is distinct from new.actor_id::text
      or item.event ->> 'deviceId' is distinct from new.device_id
      or jsonb_typeof(item.event -> 'schemaVersion') is distinct from 'number'
      or item.event ->> 'schemaVersion' is distinct from new.schema_version::text
      or (item.event ->> 'occurredAt')::timestamptz is distinct from new.occurred_at then
      raise exception 'event identity metadata must match its command batch' using errcode = '22023';
    end if;
    if coalesce(item.event ->> 'type', '') not in ('OrderOpened', 'PreparationStarted', 'PreparationReady', 'OrderServed', 'PreparationCancelled')
      or jsonb_typeof(item.event -> 'payload') is distinct from 'object' then
      raise exception 'event type and object payload are required' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

create trigger validate_command_batch_before_insert
before insert on public.command_batches
for each row execute function public.validate_command_batch();

alter table public.branches enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.register_devices enable row level security;
alter table public.branch_register_leases enable row level security;
alter table public.command_batches enable row level security;

create policy "members read their branches"
on public.branches for select to authenticated
using (exists (
  select 1 from public.branch_memberships membership
  where membership.branch_id = branches.branch_id and membership.user_id = (select auth.uid())
));

create policy "users read their own membership"
on public.branch_memberships for select to authenticated
using (user_id = (select auth.uid()));

create policy "users read their registered devices"
on public.register_devices for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy "users read their device lease"
on public.branch_register_leases for select to authenticated
using (exists (
  select 1 from public.register_devices device
  where device.branch_id = branch_register_leases.branch_id
    and device.device_id = branch_register_leases.device_id
    and device.owner_user_id = (select auth.uid())
));

create policy "branch members read command batches"
on public.command_batches for select to authenticated
using (exists (
  select 1 from public.branch_memberships membership
  where membership.branch_id = command_batches.branch_id and membership.user_id = (select auth.uid())
));

create policy "registered devices append authorized command batches"
on public.command_batches for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and exists (
    select 1 from public.branch_memberships membership
    where membership.branch_id = command_batches.branch_id
      and membership.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.register_devices device
    where device.branch_id = command_batches.branch_id
      and device.device_id = command_batches.device_id
      and device.owner_user_id = (select auth.uid())
      and device.revoked_at is null
      and (
        (
          device.capability = 'cash_register'
          and exists (
            select 1 from public.branch_memberships membership
            where membership.branch_id = command_batches.branch_id
              and membership.user_id = (select auth.uid())
              and membership.role in ('duena', 'encargado', 'barra')
          )
          and not exists (
            select 1 from pg_catalog.jsonb_array_elements(command_batches.events) event
            where event ->> 'type' <> 'OrderOpened'
          )
          and exists (
            select 1 from public.branch_register_leases lease
            where lease.branch_id = command_batches.branch_id
              and lease.device_id = command_batches.device_id
              and lease.lease_id = command_batches.lease_id
              and lease.valid_from <= statement_timestamp()
              and lease.expires_at > statement_timestamp()
              and lease.revoked_at is null
          )
        )
        or
        (
          device.capability = 'preparation'
          and exists (
            select 1 from public.branch_memberships membership
            where membership.branch_id = command_batches.branch_id
              and membership.user_id = (select auth.uid())
              and membership.role in ('duena', 'encargado', 'mesero')
          )
          and not exists (
            select 1 from pg_catalog.jsonb_array_elements(command_batches.events) event
            where event ->> 'type' not in ('PreparationStarted', 'PreparationReady', 'OrderServed', 'PreparationCancelled')
          )
        )
      )
  )
);

revoke all on public.branches, public.branch_memberships, public.register_devices,
  public.branch_register_leases, public.command_batches from anon, authenticated;
grant select on public.branches, public.branch_memberships, public.register_devices,
  public.branch_register_leases, public.command_batches to authenticated;
grant insert on public.command_batches to authenticated;
grant all on public.branches, public.branch_memberships, public.register_devices,
  public.branch_register_leases, public.command_batches to service_role;
revoke update, delete, truncate on public.command_batches from anon, authenticated;
revoke all on function public.validate_command_batch() from public, anon, authenticated;
