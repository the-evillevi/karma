-- EVL-118: server-owned identities, logical device sessions, and mutation roles.
-- This migration is draft-only until root security review; do not apply remotely.

alter table public.branch_memberships
  add column display_name text not null default 'Personal',
  add column active boolean not null default true;

create table public.register_device_sessions (
  session_id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  device_id text not null,
  actor_id uuid not null references auth.users(id),
  capability text not null check (capability in ('cash_register', 'preparation', 'read_only')),
  lease_id text,
  bound_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (branch_id, device_id)
    references public.register_devices(branch_id, device_id),
  foreign key (branch_id, actor_id)
    references public.branch_memberships(branch_id, user_id),
  check (expires_at > bound_at)
);

create unique index one_unrevoked_session_per_device
  on public.register_device_sessions (device_id)
  where revoked_at is null;
create index active_sessions_by_actor
  on public.register_device_sessions (branch_id, actor_id, device_id)
  where revoked_at is null;

alter table public.register_device_sessions enable row level security;
revoke all on public.register_device_sessions from public, anon, authenticated;
grant all on public.register_device_sessions to service_role;

create function public.bind_register_session(p_branch_id text, p_device_id text)
returns table (
  session_id uuid,
  branch_id text,
  device_id text,
  actor_id uuid,
  display_name text,
  role text,
  capability text,
  lease_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_membership public.branch_memberships%rowtype;
  v_device public.register_devices%rowtype;
  v_lease public.branch_register_leases%rowtype;
  v_session_id uuid;
  v_expires_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into v_membership
  from public.branch_memberships membership
  where membership.branch_id = p_branch_id
    and membership.user_id = v_actor_id
    and membership.active
  for update;
  if not found then
    raise exception 'Active branch membership is required' using errcode = '42501';
  end if;

  select * into v_device
  from public.register_devices device
  where device.branch_id = p_branch_id
    and device.device_id = p_device_id
    and device.revoked_at is null
  for update;
  if not found then
    raise exception 'Active enrolled device is required' using errcode = '42501';
  end if;
  if v_device.capability = 'read_only' then
    raise exception 'This device cannot open an operator session' using errcode = '42501';
  end if;

  v_lease.lease_id := null;
  v_expires_at := clock_timestamp() + interval '8 hours';
  if v_device.capability = 'cash_register' then
    select * into v_lease
    from public.branch_register_leases lease
    where lease.branch_id = p_branch_id
      and lease.device_id = p_device_id
      and lease.revoked_at is null
      and lease.valid_from <= statement_timestamp()
      and lease.expires_at > statement_timestamp()
    for update;
    if not found then
      raise exception 'Active register lease is required' using errcode = '42501';
    end if;
    v_expires_at := least(v_expires_at, v_lease.expires_at);
  end if;

  -- The browser is a logical device boundary, not hardware attestation. Binding
  -- replaces its prior actor session; memberships are rechecked on each write.
  update public.register_device_sessions old_session
  set revoked_at = clock_timestamp()
  where old_session.device_id = p_device_id
    and old_session.revoked_at is null;

  insert into public.register_device_sessions (
    branch_id, device_id, actor_id, capability, lease_id, expires_at
  ) values (
    p_branch_id, p_device_id, v_actor_id, v_device.capability,
    v_lease.lease_id, v_expires_at
  ) returning register_device_sessions.session_id into v_session_id;

  return query select
    v_session_id, p_branch_id, p_device_id, v_actor_id,
    v_membership.display_name, v_membership.role, v_device.capability,
    coalesce(v_lease.lease_id, 'no-cash-lease'), v_expires_at;
end;
$$;

create function public.manage_branch_membership(
  p_branch_id text,
  p_user_id uuid,
  p_display_name text,
  p_role text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.branch_memberships owner_membership
    where owner_membership.branch_id = p_branch_id
      and owner_membership.user_id = auth.uid()
      and owner_membership.role = 'duena'
      and owner_membership.active
  ) then
    raise exception 'Only an active owner may manage branch users' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('duena', 'encargado', 'barra', 'mesero')
    or p_display_name is null
    or length(btrim(p_display_name)) not between 1 and 120
    or p_active is null then
    raise exception 'Membership data is invalid' using errcode = '22023';
  end if;
  if (p_user_id = auth.uid() and (p_role <> 'duena' or not p_active))
    or (p_role <> 'duena' or not p_active) and not exists (
      select 1 from public.branch_memberships other_owner
      where other_owner.branch_id = p_branch_id
        and other_owner.role = 'duena'
        and other_owner.active
        and other_owner.user_id <> p_user_id
    ) then
    raise exception 'A branch must retain an active owner' using errcode = '22023';
  end if;

  insert into public.branch_memberships (branch_id, user_id, display_name, role, active)
  values (p_branch_id, p_user_id, btrim(p_display_name), p_role, p_active)
  on conflict (branch_id, user_id) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      active = excluded.active;

  update public.register_device_sessions
  set revoked_at = clock_timestamp()
  where branch_id = p_branch_id
    and actor_id = p_user_id
    and revoked_at is null;
end;
$$;

create function public.list_branch_memberships(p_branch_id text)
returns table (user_id uuid, display_name text, role text, active boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.branch_memberships owner_membership
    where owner_membership.branch_id = p_branch_id
      and owner_membership.user_id = auth.uid()
      and owner_membership.role = 'duena'
      and owner_membership.active
  ) then
    raise exception 'Only an active owner may list branch users' using errcode = '42501';
  end if;
  return query
    select membership.user_id, membership.display_name, membership.role, membership.active
    from public.branch_memberships membership
    where membership.branch_id = p_branch_id
    order by membership.display_name, membership.user_id;
end;
$$;

create function public.revoke_register_device(p_branch_id text, p_device_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.branch_memberships owner_membership
    where owner_membership.branch_id = p_branch_id
      and owner_membership.user_id = auth.uid()
      and owner_membership.role = 'duena'
      and owner_membership.active
  ) then
    raise exception 'Only an active owner may revoke a device' using errcode = '42501';
  end if;

  update public.register_devices
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where branch_id = p_branch_id and device_id = p_device_id;
  if not found then
    raise exception 'Enrolled device was not found' using errcode = 'P0002';
  end if;
  update public.register_device_sessions
  set revoked_at = clock_timestamp()
  where branch_id = p_branch_id and device_id = p_device_id and revoked_at is null;
  update public.branch_register_leases
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where branch_id = p_branch_id and device_id = p_device_id;
end;
$$;

-- The old direct insert policy is removed. All new commands pass through the
-- actor/session/role check below, so a client cannot bypass the role matrix.
drop policy "registered devices append authorized command batches"
  on public.command_batches;
drop policy "branch members read command batches"
  on public.command_batches;
create policy "role-limited command history"
on public.command_batches for select to authenticated
using (
  exists (
    select 1 from public.branch_memberships membership
    where membership.branch_id = command_batches.branch_id
      and membership.user_id = (select auth.uid())
      and membership.active
      and (
        membership.role in ('duena', 'encargado')
        or (membership.role in ('barra', 'mesero') and command_batches.actor_id = (select auth.uid()))
      )
  )
);

drop trigger validate_command_batch_before_insert on public.command_batches;
create function public.validate_command_batch_v118()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item record;
  expected_event_id text;
  event_type text;
  reason_text text;
begin
  if new.schema_version <> 1 or jsonb_typeof(new.events) is distinct from 'array'
    or jsonb_array_length(new.events) not between 1 and 100
    or octet_length(new.events::text) > 1048576 then
    raise exception 'Command batch schema or size is invalid' using errcode = '22023';
  end if;

  for item in
    select value as event, ordinality - 1 as event_index
    from pg_catalog.jsonb_array_elements(new.events) with ordinality
  loop
    if jsonb_typeof(item.event) is distinct from 'object' then
      raise exception 'Each event must be a JSON object' using errcode = '22023';
    end if;
    expected_event_id := new.command_id || ':' || item.event_index::text;
    if item.event ->> 'eventId' is distinct from expected_event_id
      or item.event ->> 'commandId' is distinct from new.command_id
      or item.event ->> 'aggregateId' is distinct from new.aggregate_id
      or item.event ->> 'actorId' is distinct from new.actor_id::text
      or item.event ->> 'deviceId' is distinct from new.device_id
      or jsonb_typeof(item.event -> 'schemaVersion') is distinct from 'number'
      or item.event ->> 'schemaVersion' is distinct from new.schema_version::text
      or (item.event ->> 'occurredAt')::timestamptz is distinct from new.occurred_at
      or jsonb_typeof(item.event -> 'payload') is distinct from 'object' then
      raise exception 'Event envelope does not match the command batch' using errcode = '22023';
    end if;
    event_type := item.event ->> 'type';
    if event_type not in (
      'OrderOpened', 'SaleCompleted', 'OrderCancelled', 'DiscountApplied',
      'MenuItemUpdated', 'InventoryAdjusted', 'PreparationStarted',
      'PreparationReady', 'OrderServed', 'PreparationCancelled'
    ) then
      raise exception 'Unsupported event type' using errcode = '22023';
    end if;
    if event_type in ('OrderCancelled', 'DiscountApplied') then
      reason_text := item.event -> 'payload' ->> 'reason';
      if reason_text is null or length(btrim(reason_text)) not between 1 and 250 then
        raise exception 'A bounded reason is required for this event' using errcode = '22023';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create trigger validate_command_batch_v118_before_insert
before insert on public.command_batches
for each row execute function public.validate_command_batch_v118();

create function public.append_command_batch(
  p_command_id text,
  p_branch_id text,
  p_aggregate_id text,
  p_device_id text,
  p_session_id uuid,
  p_lease_id text,
  p_schema_version integer,
  p_occurred_at timestamptz,
  p_events jsonb
)
returns table (command_id text, received_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text;
  v_capability text;
  v_session public.register_device_sessions%rowtype;
  v_device public.register_devices%rowtype;
  v_event jsonb;
  v_type text;
  v_existing public.command_batches%rowtype;
  v_received_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into v_session
  from public.register_device_sessions session_row
  where session_row.session_id = p_session_id
    and session_row.branch_id = p_branch_id
    and session_row.device_id = p_device_id
    and session_row.actor_id = v_actor_id
    and session_row.revoked_at is null
    and session_row.expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception 'A current bound device session is required' using errcode = '42501';
  end if;

  select membership.role into v_role
  from public.branch_memberships membership
  where membership.branch_id = p_branch_id
    and membership.user_id = v_actor_id
    and membership.active;
  if not found then
    raise exception 'An active branch membership is required' using errcode = '42501';
  end if;
  select * into v_device
  from public.register_devices device
  where device.branch_id = p_branch_id
    and device.device_id = p_device_id
    and device.capability = v_session.capability
    and device.revoked_at is null;
  if not found then
    raise exception 'The enrolled device is unavailable' using errcode = '42501';
  end if;
  if v_session.capability = 'cash_register' and not exists (
    select 1 from public.branch_register_leases lease
    where lease.branch_id = p_branch_id
      and lease.device_id = p_device_id
      and lease.lease_id = p_lease_id
      and lease.lease_id = v_session.lease_id
      and lease.revoked_at is null
      and lease.valid_from <= statement_timestamp()
      and lease.expires_at > statement_timestamp()
  ) then
    raise exception 'The active register lease is unavailable' using errcode = '42501';
  end if;
  if v_session.capability = 'preparation' and p_lease_id <> 'no-cash-lease' then
    raise exception 'Preparation devices do not accept cash register leases' using errcode = '42501';
  end if;

  for v_event in select value from pg_catalog.jsonb_array_elements(p_events)
  loop
    v_type := v_event ->> 'type';
    if v_type = 'OrderOpened' then
      if v_role not in ('duena', 'encargado', 'barra', 'mesero')
        or v_session.capability <> 'cash_register' then
        raise exception 'Role cannot open a cash register order' using errcode = '42501';
      end if;
    elsif v_type = 'SaleCompleted' then
      if v_role not in ('duena', 'encargado', 'barra')
        or v_session.capability <> 'cash_register' then
        raise exception 'Role cannot complete a sale' using errcode = '42501';
      end if;
    elsif v_type in ('OrderCancelled', 'DiscountApplied') then
      if v_role not in ('duena', 'encargado')
        or v_session.capability <> 'cash_register' then
        raise exception 'Role cannot cancel or discount an order' using errcode = '42501';
      end if;
    elsif v_type in ('MenuItemUpdated', 'InventoryAdjusted') then
      if v_role not in ('duena', 'encargado')
        or v_session.capability <> 'cash_register' then
        raise exception 'Role cannot mutate menu or inventory' using errcode = '42501';
      end if;
    elsif v_type in ('PreparationStarted', 'PreparationReady', 'OrderServed', 'PreparationCancelled') then
      if v_role not in ('duena', 'encargado', 'barra', 'mesero')
        or v_session.capability not in ('cash_register', 'preparation') then
        raise exception 'Role cannot update preparation state' using errcode = '42501';
      end if;
    end if;
  end loop;

  begin
    insert into public.command_batches (
      command_id, branch_id, aggregate_id, actor_id, device_id, lease_id,
      schema_version, occurred_at, events
    ) values (
      p_command_id, p_branch_id, p_aggregate_id, v_actor_id, p_device_id,
      p_lease_id, p_schema_version, p_occurred_at, p_events
    ) returning command_batches.received_at into v_received_at;
    return query select p_command_id, v_received_at;
  exception when unique_violation then
    select * into v_existing
    from public.command_batches existing
    where existing.command_id = p_command_id;
    if not found then raise; end if;
    if v_existing.branch_id is distinct from p_branch_id
      or v_existing.aggregate_id is distinct from p_aggregate_id
      or v_existing.actor_id is distinct from v_actor_id
      or v_existing.device_id is distinct from p_device_id
      or v_existing.lease_id is distinct from p_lease_id
      or v_existing.schema_version is distinct from p_schema_version
      or v_existing.occurred_at is distinct from p_occurred_at
      or v_existing.events is distinct from p_events then
      raise exception 'Command ID conflicts with a different batch' using errcode = '23505';
    end if;
    return query select p_command_id, v_existing.received_at;
  end;
end;
$$;

revoke all on function public.bind_register_session(text, text) from public, anon;
revoke all on function public.manage_branch_membership(text, uuid, text, text, boolean) from public, anon;
revoke all on function public.list_branch_memberships(text) from public, anon;
revoke all on function public.revoke_register_device(text, text) from public, anon;
revoke all on function public.append_command_batch(text, text, text, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
revoke all on function public.validate_command_batch_v118() from public, anon, authenticated;
grant execute on function public.bind_register_session(text, text) to authenticated;
grant execute on function public.manage_branch_membership(text, uuid, text, text, boolean) to authenticated;
grant execute on function public.list_branch_memberships(text) to authenticated;
grant execute on function public.revoke_register_device(text, text) to authenticated;
grant execute on function public.append_command_batch(text, text, text, text, uuid, text, integer, timestamptz, jsonb) to authenticated;

revoke insert on public.command_batches from authenticated, anon;
revoke update, delete, truncate on public.register_devices, public.branch_register_leases,
  public.branch_memberships, public.register_device_sessions from authenticated, anon;
revoke all on function public.validate_command_batch() from public, anon, authenticated;

revoke all on public.branches, public.branch_memberships, public.register_devices,
  public.branch_register_leases, public.command_batches, public.register_device_sessions from anon;
