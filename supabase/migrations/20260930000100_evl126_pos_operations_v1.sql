-- EVL-126 forward-only server foundation for operational order commands.
-- EVL-114/118 command_batches and append_command_batch remain unchanged.

create schema if not exists pos_private;
revoke all on schema pos_private from public, anon, authenticated;

create table pos_private.pos_operation_branch_sequences (
  branch_id text primary key references public.branches(branch_id),
  last_sequence bigint not null default 0 check (last_sequence >= 0)
);

create table pos_private.pos_operation_commands (
  command_id text primary key check (length(command_id) between 1 and 180),
  branch_id text not null references public.branches(branch_id),
  actor_id uuid not null references auth.users(id),
  device_id text not null,
  action text not null check (action in (
    'order.opened', 'order.line-added', 'order.line-changed',
    'order.line-removed', 'order.details-changed'
  )),
  schema_version integer not null check (schema_version = 1),
  occurred_at timestamptz not null,
  command jsonb not null check (
    jsonb_typeof(command) = 'object' and octet_length(command::text) <= 1048576
  ),
  server_sequence bigint not null check (server_sequence > 0),
  received_at timestamptz not null default clock_timestamp(),
  unique (branch_id, server_sequence),
  foreign key (branch_id, device_id)
    references public.register_devices(branch_id, device_id),
  check (command ->> 'commandId' = command_id),
  check (command ->> 'branchId' = branch_id),
  check (command ->> 'actorId' = actor_id::text),
  check (command ->> 'deviceId' = device_id),
  check (command ->> 'action' = action),
  check ((command ->> 'schemaVersion')::integer = schema_version),
  check ((command ->> 'occurredAt')::timestamptz = occurred_at)
);

create table pos_private.pos_operation_aggregate_heads (
  branch_id text not null references public.branches(branch_id),
  aggregate_kind text not null check (aggregate_kind in ('order', 'preparation', 'sale')),
  aggregate_id text not null check (length(aggregate_id) between 1 and 180),
  revision bigint not null default 0 check (revision >= 0),
  last_command_id text,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  primary key (branch_id, aggregate_kind, aggregate_id),
  check ((revision = 0) = (last_command_id is null)),
  check ((revision = 0) = (last_sequence = 0))
);

create table pos_private.pos_operation_aggregate_events (
  branch_id text not null,
  aggregate_kind text not null,
  aggregate_id text not null,
  revision bigint not null check (revision > 0),
  command_id text not null references pos_private.pos_operation_commands(command_id),
  server_sequence bigint not null,
  occurred_at timestamptz not null,
  primary key (branch_id, aggregate_kind, aggregate_id, revision),
  unique (command_id, aggregate_kind, aggregate_id),
  foreign key (branch_id, aggregate_kind, aggregate_id)
    references pos_private.pos_operation_aggregate_heads(branch_id, aggregate_kind, aggregate_id),
  foreign key (branch_id, server_sequence)
    references pos_private.pos_operation_commands(branch_id, server_sequence)
);

create index pos_operation_events_by_sequence
  on pos_private.pos_operation_aggregate_events (branch_id, server_sequence, aggregate_kind, aggregate_id);

create table pos_private.pos_operation_projections (
  branch_id text not null,
  aggregate_kind text not null,
  aggregate_id text not null,
  revision bigint not null check (revision > 0),
  last_command_id text not null references pos_private.pos_operation_commands(command_id),
  last_sequence bigint not null check (last_sequence > 0),
  projection jsonb not null check (
    jsonb_typeof(projection) = 'object' and octet_length(projection::text) <= 4194304
  ),
  primary key (branch_id, aggregate_kind, aggregate_id),
  foreign key (branch_id, aggregate_kind, aggregate_id)
    references pos_private.pos_operation_aggregate_heads(branch_id, aggregate_kind, aggregate_id)
);

alter table pos_private.pos_operation_branch_sequences enable row level security;
alter table pos_private.pos_operation_commands enable row level security;
alter table pos_private.pos_operation_aggregate_heads enable row level security;
alter table pos_private.pos_operation_aggregate_events enable row level security;
alter table pos_private.pos_operation_projections enable row level security;
revoke all on all tables in schema pos_private from public, anon, authenticated;
revoke all on all sequences in schema pos_private from public, anon, authenticated;

create function pos_private.require_object_keys(
  p_value jsonb,
  p_label text,
  p_keys text[],
  p_exact boolean default true
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Invalid % object' , p_label using errcode = '22023';
  end if;
  -- Whitelist keys in both modes; exact mode also requires each listed key.
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_value) as supplied(key)
    where not (supplied.key = any(p_keys))
  ) or (p_exact and exists (
    select 1 from pg_catalog.unnest(p_keys) as required(key)
    where not (p_value ? required.key)
  )) then
    raise exception 'Invalid % fields' , p_label using errcode = '22023';
  end if;
end;
$$;

create function pos_private.require_text(
  p_value jsonb,
  p_label text,
  p_max_length integer,
  p_nullable boolean default false,
  p_nonblank boolean default true,
  p_trimmed boolean default false
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_nullable then return null; end if;
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  v_text := p_value #>> '{}';
  if pg_catalog.length(v_text) > p_max_length
    or pg_catalog.octet_length(pg_catalog.convert_to(v_text, 'UTF8')) > p_max_length * 3
    or (p_nonblank and pg_catalog.btrim(v_text) = '')
    or (p_trimmed and pg_catalog.btrim(v_text) <> v_text) then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  return v_text;
end;
$$;

create function pos_private.require_safe_integer(
  p_value jsonb,
  p_label text,
  p_minimum numeric default 0,
  p_nullable boolean default false
)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_number numeric;
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_nullable then return null; end if;
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'number' then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  begin
    v_number := (p_value #>> '{}')::numeric;
  exception when others then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end;
  if v_number <> pg_catalog.trunc(v_number)
    or v_number < p_minimum
    or v_number > 9007199254740991 then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  return v_number;
end;
$$;

create function pos_private.require_utc_instant(p_value jsonb, p_label text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
  v_instant timestamptz;
begin
  v_text := pos_private.require_text(p_value, p_label, 40, false, true, false);
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  begin
    v_instant := v_text::timestamptz;
  exception when others then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end;
  if (pg_catalog.to_char(v_instant at time zone 'UTC', 'YYYY-MM-DD') || 'T' ||
      pg_catalog.to_char(v_instant at time zone 'UTC', 'HH24:MI:SS'))
    is distinct from pg_catalog.substr(v_text, 1, 19) then
    raise exception 'Invalid %' , p_label using errcode = '22023';
  end if;
  return v_text;
end;
$$;

create function pos_private.assert_customer(p_customer jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_customer = 'null'::jsonb then return; end if;
  perform pos_private.require_object_keys(p_customer, 'customer', array['name', 'phone', 'address']);
  perform pos_private.require_text(p_customer -> 'name', 'customer.name', 160, true, false, false);
  perform pos_private.require_text(p_customer -> 'phone', 'customer.phone', 80, true, false, false);
  perform pos_private.require_text(p_customer -> 'address', 'customer.address', 250, true, false, false);
end;
$$;

create function pos_private.assert_order_contact(p_order_type text, p_customer jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
  v_address text;
begin
  perform pos_private.assert_customer(p_customer);
  if p_order_type in ('llevar', 'recoger', 'domicilio') then
    if p_customer is null or p_customer = 'null'::jsonb then
      raise exception 'Required order contact is missing' using errcode = '22023';
    end if;
    v_name := pos_private.require_text(p_customer -> 'name', 'customer.name', 160, false, true, false);
    v_phone := pos_private.require_text(p_customer -> 'phone', 'customer.phone', 80, false, true, false);
    if p_order_type = 'domicilio' then
      v_address := pos_private.require_text(p_customer -> 'address', 'customer.address', 250, false, true, false);
    end if;
  end if;
end;
$$;

create function pos_private.assert_operation_line(p_line jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_base numeric;
  v_modifier_total numeric;
  v_unit numeric;
  v_line_total numeric;
  v_quantity numeric;
  v_effect numeric;
  v_effect_quantity numeric;
  v_sum numeric := 0;
  v_all_modifier_effects boolean := true;
  v_count integer;
  v_distinct integer;
  v_evidence text;
  v_tax jsonb;
  v_tax_evidence text;
  v_unknown boolean;
  v_modifier jsonb;
begin
  perform pos_private.require_object_keys(p_line, 'order line', array[
    'lineId', 'productId', 'nameSnapshot', 'quantity', 'currency',
    'baseUnitPriceCents', 'modifierTotalCents', 'unitPriceCents',
    'lineTotalCents', 'priceEvidence', 'catalogPriceVersionId',
    'modifiers', 'notes', 'tax'
  ]);
  perform pos_private.require_text(p_line -> 'lineId', 'lineId', 180, false, true, true);
  perform pos_private.require_text(p_line -> 'productId', 'productId', 180, true, true, true);
  perform pos_private.require_text(p_line -> 'nameSnapshot', 'nameSnapshot', 200, false, true, false);
  v_quantity := pos_private.require_safe_integer(p_line -> 'quantity', 'quantity', 1, false);
  if p_line ->> 'currency' is distinct from 'MXN' then
    raise exception 'Line currency must be MXN' using errcode = '22023';
  end if;
  v_base := pos_private.require_safe_integer(p_line -> 'baseUnitPriceCents', 'baseUnitPriceCents', 0, true);
  v_modifier_total := pos_private.require_safe_integer(p_line -> 'modifierTotalCents', 'modifierTotalCents', 0, true);
  v_unit := pos_private.require_safe_integer(p_line -> 'unitPriceCents', 'unitPriceCents', 0, true);
  v_line_total := pos_private.require_safe_integer(p_line -> 'lineTotalCents', 'lineTotalCents', 0, true);
  v_evidence := pos_private.require_text(p_line -> 'priceEvidence', 'priceEvidence', 40, false, true, false);
  if v_evidence not in ('prototype-captured', 'legacy-captured', 'unknown') then
    raise exception 'Catalog-versioned price claims are unavailable in this server slice' using errcode = '22023';
  end if;
  if pos_private.require_text(p_line -> 'catalogPriceVersionId', 'catalogPriceVersionId', 180, true, true, true) is not null then
    raise exception 'Unverified price cannot carry a catalog version' using errcode = '22023';
  end if;
  if v_evidence = 'unknown' and (v_base is not null or v_modifier_total is not null or v_unit is not null or v_line_total is not null) then
    raise exception 'Unknown price provenance cannot carry an amount' using errcode = '22023';
  end if;
  if v_base is not null and v_modifier_total is not null then
    if v_base + v_modifier_total > 9007199254740991 or v_unit is distinct from v_base + v_modifier_total then
      raise exception 'Captured base and modifier amounts do not reconcile' using errcode = '22023';
    end if;
  end if;
  if v_unit is not null and (v_unit * v_quantity > 9007199254740991 or v_line_total is distinct from v_unit * v_quantity) then
    raise exception 'Captured unit and line amounts do not reconcile' using errcode = '22023';
  end if;
  perform pos_private.require_text(p_line -> 'notes', 'line.notes', 500, true, false, false);

  if pg_catalog.jsonb_typeof(p_line -> 'modifiers') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_line -> 'modifiers') > 100 then
    raise exception 'Invalid line modifiers' using errcode = '22023';
  end if;
  select pg_catalog.count(*), pg_catalog.count(distinct (modifier.value ->> 'groupId', modifier.value ->> 'optionId'))
    into v_count, v_distinct
    from pg_catalog.jsonb_array_elements(p_line -> 'modifiers') as modifier(value);
  if v_count <> v_distinct then
    raise exception 'Duplicate modifier selection' using errcode = '22023';
  end if;
  for v_modifier in select value from pg_catalog.jsonb_array_elements(p_line -> 'modifiers')
  loop
    perform pos_private.require_object_keys(v_modifier, 'modifier', array[
      'groupId', 'optionId', 'nameSnapshot', 'quantity', 'unit', 'priceEffectCents'
    ]);
    perform pos_private.require_text(v_modifier -> 'groupId', 'modifier.groupId', 180, false, true, true);
    perform pos_private.require_text(v_modifier -> 'optionId', 'modifier.optionId', 180, false, true, true);
    perform pos_private.require_text(v_modifier -> 'nameSnapshot', 'modifier.nameSnapshot', 160, false, true, false);
    v_effect_quantity := pos_private.require_safe_integer(v_modifier -> 'quantity', 'modifier.quantity', 1, false);
    perform pos_private.require_text(v_modifier -> 'unit', 'modifier.unit', 40, true, false, false);
    v_effect := pos_private.require_safe_integer(v_modifier -> 'priceEffectCents', 'modifier.priceEffectCents', 0, true);
    if v_effect is null then
      v_all_modifier_effects := false;
    else
      v_sum := v_sum + v_effect * v_effect_quantity;
      if v_sum > 9007199254740991 then
        raise exception 'Modifier amount exceeds safe cents' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_modifier_total is not null and v_all_modifier_effects and v_modifier_total is distinct from v_sum then
    raise exception 'Captured modifier effects do not reconcile' using errcode = '22023';
  end if;

  v_tax := p_line -> 'tax';
  perform pos_private.require_object_keys(v_tax, 'line tax', array[
    'currency', 'evidence', 'rateBasisPoints', 'amountCents', 'policyId'
  ]);
  if v_tax ->> 'currency' is distinct from 'MXN' then
    raise exception 'Tax currency must be MXN' using errcode = '22023';
  end if;
  v_tax_evidence := pos_private.require_text(v_tax -> 'evidence', 'tax.evidence', 40, false, true, false);
  if v_tax_evidence not in ('prototype-captured', 'unknown') then
    raise exception 'Catalog-versioned tax claims are unavailable in this server slice' using errcode = '22023';
  end if;
  v_effect := pos_private.require_safe_integer(v_tax -> 'rateBasisPoints', 'tax.rateBasisPoints', 0, true);
  v_effect_quantity := pos_private.require_safe_integer(v_tax -> 'amountCents', 'tax.amountCents', 0, true);
  if pos_private.require_text(v_tax -> 'policyId', 'tax.policyId', 180, true, true, true) is not null then
    raise exception 'Unverified tax cannot carry a policy ID' using errcode = '22023';
  end if;
  if v_tax_evidence = 'unknown' and (v_effect is not null or v_effect_quantity is not null) then
    raise exception 'Unknown tax provenance cannot carry tax amounts' using errcode = '22023';
  end if;
end;
$$;

create function pos_private.assert_order_projection(p_order jsonb, p_expected_id text, p_expected_revision bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_order_type text;
  v_customer jsonb;
  v_line jsonb;
  v_line_count integer;
  v_line_id_count integer;
  v_history jsonb;
  v_entry jsonb;
begin
  perform pos_private.require_object_keys(p_order, 'stored order projection', array[
    'orderId', 'revision', 'status', 'orderType', 'tableId', 'customer',
    'createdByActorId', 'openedAt', 'lines', 'discounts', 'preparationId',
    'splitFrom', 'splitOperations', 'history', 'closedAt',
    'cancellationReason', 'cancelledByActorId'
  ]);
  if pos_private.require_text(p_order -> 'orderId', 'stored orderId', 180, false, true, true) is distinct from p_expected_id
    or pos_private.require_safe_integer(p_order -> 'revision', 'stored revision', 1, false) is distinct from p_expected_revision
    or p_order ->> 'status' is distinct from 'open' then
    raise exception 'Stored order projection does not match its head' using errcode = 'XX001';
  end if;
  v_order_type := pos_private.require_text(p_order -> 'orderType', 'stored orderType', 40, false, true, false);
  if v_order_type not in ('local', 'mesa', 'llevar', 'recoger', 'domicilio') then
    raise exception 'Stored order type is invalid' using errcode = 'XX001';
  end if;
  perform pos_private.require_text(p_order -> 'tableId', 'stored tableId', 80, true, false, false);
  v_customer := p_order -> 'customer';
  perform pos_private.assert_order_contact(v_order_type, v_customer);
  perform pos_private.require_text(p_order -> 'createdByActorId', 'stored creator', 180, false, true, true);
  perform pos_private.require_utc_instant(p_order -> 'openedAt', 'stored openedAt');
  if p_order -> 'preparationId' <> 'null'::jsonb
    or p_order -> 'splitFrom' <> 'null'::jsonb
    or p_order -> 'closedAt' <> 'null'::jsonb
    or p_order -> 'cancellationReason' <> 'null'::jsonb
    or p_order -> 'cancelledByActorId' <> 'null'::jsonb
    or p_order -> 'discounts' <> '[]'::jsonb
    or p_order -> 'splitOperations' <> '[]'::jsonb then
    raise exception 'Stored order contains an unsupported operational family' using errcode = 'XX001';
  end if;
  if pg_catalog.jsonb_typeof(p_order -> 'lines') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_order -> 'lines') not between 1 and 200 then
    raise exception 'Stored order lines are invalid' using errcode = 'XX001';
  end if;
  select pg_catalog.count(*), pg_catalog.count(distinct (line.value ->> 'lineId'))
    into v_line_count, v_line_id_count
    from pg_catalog.jsonb_array_elements(p_order -> 'lines') as line(value);
  if v_line_count <> v_line_id_count then
    raise exception 'Stored order line identities are invalid' using errcode = 'XX001';
  end if;
  for v_line in select value from pg_catalog.jsonb_array_elements(p_order -> 'lines')
  loop
    perform pos_private.assert_operation_line(v_line);
  end loop;
  if pg_catalog.jsonb_typeof(p_order -> 'history') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_order -> 'history') < 1
    or pg_catalog.jsonb_array_length(p_order -> 'history') > 5000 then
    raise exception 'Stored order history is invalid' using errcode = 'XX001';
  end if;
  v_history := p_order -> 'history';
  for v_entry in select value from pg_catalog.jsonb_array_elements(v_history)
  loop
    perform pos_private.require_object_keys(v_entry, 'order history', array[
      'commandId', 'action', 'actorId', 'occurredAt', 'reason'
    ]);
    perform pos_private.require_text(v_entry -> 'commandId', 'history.commandId', 180, false, true, true);
    perform pos_private.require_text(v_entry -> 'actorId', 'history.actorId', 180, false, true, true);
    perform pos_private.require_utc_instant(v_entry -> 'occurredAt', 'history.occurredAt');
    perform pos_private.require_text(v_entry -> 'action', 'history.action', 80, false, true, false);
    if v_entry ->> 'action' not in ('order.opened', 'order.line-added', 'order.line-changed', 'order.line-removed', 'order.details-changed')
      or v_entry -> 'reason' <> 'null'::jsonb then
      raise exception 'Stored order history contains an unsupported operation' using errcode = 'XX001';
    end if;
  end loop;
end;
$$;

create function pos_private.require_register_context(
  p_branch_id text,
  p_device_id text,
  p_session_id uuid,
  p_lease_id text
)
returns table (actor_id uuid, verified_role text, capability text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_device_capability text;
  v_session_capability text;
  v_session_lease text;
  v_locked_lease text;
begin
  if v_actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select membership.role into v_role
  from public.branch_memberships as membership
  where membership.branch_id = p_branch_id
    and membership.user_id = v_actor
    and membership.active
  for share;
  if not found then
    raise exception 'Active branch membership is required' using errcode = '42501';
  end if;

  select device.capability into v_device_capability
  from public.register_devices as device
  where device.branch_id = p_branch_id
    and device.device_id = p_device_id
    and device.revoked_at is null
  for share;
  if not found then
    raise exception 'Active register device is required' using errcode = '42501';
  end if;

  select session_row.capability, session_row.lease_id
    into v_session_capability, v_session_lease
  from public.register_device_sessions as session_row
  where session_row.session_id = p_session_id
    and session_row.branch_id = p_branch_id
    and session_row.device_id = p_device_id
    and session_row.actor_id = v_actor
    and session_row.revoked_at is null
    and session_row.expires_at > statement_timestamp()
  for share;
  if not found or v_session_capability is distinct from v_device_capability then
    raise exception 'A current bound device session is required' using errcode = '42501';
  end if;

  if v_device_capability = 'cash_register' then
    if v_session_lease is null or p_lease_id is distinct from v_session_lease then
      raise exception 'The current register lease is required' using errcode = '42501';
    end if;
    select lease.lease_id into v_locked_lease
    from public.branch_register_leases as lease
    where lease.branch_id = p_branch_id
      and lease.device_id = p_device_id
      and lease.lease_id = v_session_lease
      and lease.revoked_at is null
      and lease.valid_from <= statement_timestamp()
      and lease.expires_at > statement_timestamp()
    for share;
    if not found then
      raise exception 'The current register lease is unavailable' using errcode = '42501';
    end if;
  elsif v_device_capability = 'preparation' then
    if v_session_lease is not null or p_lease_id is distinct from 'no-cash-lease' then
      raise exception 'Preparation sessions do not accept a cash lease' using errcode = '42501';
    end if;
  else
    raise exception 'This device has no operational access' using errcode = '42501';
  end if;
  return query select v_actor, v_role, v_device_capability;
end;
$$;

create function public.append_pos_operation_v1(
  p_command jsonb,
  p_session_id uuid,
  p_lease_id text
)
returns table (
  command_id text,
  outcome text,
  server_sequence bigint,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command_id text;
  v_branch_id text;
  v_actor_text text;
  v_actor uuid;
  v_device_id text;
  v_action text;
  v_occurred_at text;
  v_action_time timestamptz;
  v_payload jsonb;
  v_order_id text;
  v_order_type text;
  v_table_id text;
  v_customer jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_existing pos_private.pos_operation_commands%rowtype;
  v_auth record;
  v_expected jsonb;
  v_expected_id text;
  v_expected_kind text;
  v_expected_revision numeric;
  v_head pos_private.pos_operation_aggregate_heads%rowtype;
  v_order jsonb;
  v_new_order jsonb;
  v_projection_revision bigint;
  v_projection_command_id text;
  v_projection_sequence bigint;
  v_event_command_id text;
  v_event_sequence bigint;
  v_line_id text;
  v_found boolean := false;
  v_revision bigint;
  v_sequence bigint;
  v_received_at timestamptz;
  v_history jsonb;
  v_old_customer jsonb;
  v_old_table jsonb;
  v_total numeric;
  v_total_known boolean := true;
  v_count integer;
begin
  perform pos_private.require_object_keys(p_command, 'operation command', array[
    'schemaVersion', 'commandId', 'branchId', 'actorId', 'deviceId',
    'occurredAt', 'expectedRevisions', 'action', 'reason', 'payload'
  ]);
  if octet_length(p_command::text) > 1048576 then
    raise exception 'Operation command exceeds the size limit' using errcode = '22023';
  end if;
  if pos_private.require_safe_integer(p_command -> 'schemaVersion', 'schemaVersion', 1, false) <> 1 then
    raise exception 'Unsupported operation schema' using errcode = '22023';
  end if;
  v_command_id := pos_private.require_text(p_command -> 'commandId', 'commandId', 180, false, true, true);
  v_branch_id := pos_private.require_text(p_command -> 'branchId', 'branchId', 100, false, true, true);
  v_actor_text := pos_private.require_text(p_command -> 'actorId', 'actorId', 180, false, true, true);
  begin
    v_actor := v_actor_text::uuid;
  exception when others then
    raise exception 'Invalid actorId' using errcode = '22023';
  end;
  if v_actor_text is distinct from v_actor::text then
    raise exception 'Invalid actorId' using errcode = '22023';
  end if;
  v_device_id := pos_private.require_text(p_command -> 'deviceId', 'deviceId', 100, false, true, true);
  v_occurred_at := pos_private.require_utc_instant(p_command -> 'occurredAt', 'occurredAt');
  v_action_time := v_occurred_at::timestamptz;
  v_action := pos_private.require_text(p_command -> 'action', 'action', 80, false, true, false);
  if v_action not in ('order.opened', 'order.line-added', 'order.line-changed', 'order.line-removed', 'order.details-changed') then
    raise exception 'Unsupported operation action' using errcode = '0A000';
  end if;
  if p_command -> 'reason' <> 'null'::jsonb then
    raise exception 'Open-order actions do not accept a reason' using errcode = '22023';
  end if;

  v_payload := p_command -> 'payload';
  if v_action = 'order.opened' then
    perform pos_private.require_object_keys(v_payload, 'order.opened payload', array[
      'orderId', 'orderType', 'tableId', 'customer', 'lines'
    ]);
    v_order_id := pos_private.require_text(v_payload -> 'orderId', 'orderId', 180, false, true, true);
    v_order_type := pos_private.require_text(v_payload -> 'orderType', 'orderType', 40, false, true, false);
    if v_order_type not in ('local', 'mesa', 'llevar', 'recoger', 'domicilio') then
      raise exception 'Unsupported order type' using errcode = '22023';
    end if;
    perform pos_private.require_text(v_payload -> 'tableId', 'tableId', 80, true, false, false);
    v_customer := v_payload -> 'customer';
    perform pos_private.assert_order_contact(v_order_type, v_customer);
    v_lines := v_payload -> 'lines';
    if pg_catalog.jsonb_typeof(v_lines) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_lines) not between 1 and 200 then
      raise exception 'Opened orders require 1 to 200 lines' using errcode = '22023';
    end if;
    select pg_catalog.count(*), pg_catalog.count(distinct (line.value ->> 'lineId'))
      into v_count, v_revision
      from pg_catalog.jsonb_array_elements(v_lines) as line(value);
    if v_count <> v_revision then
      raise exception 'Duplicate order line IDs' using errcode = '22023';
    end if;
    v_total := 0;
    for v_line in select value from pg_catalog.jsonb_array_elements(v_lines)
    loop
      perform pos_private.assert_operation_line(v_line);
      if v_line -> 'lineTotalCents' = 'null'::jsonb then
        v_total_known := false;
      elsif v_total_known then
        v_total := v_total + (v_line ->> 'lineTotalCents')::numeric;
        if v_total > 9007199254740991 then
          raise exception 'Order subtotal exceeds safe centavos' using errcode = '22023';
        end if;
      end if;
    end loop;
  else
    if v_action = 'order.line-added' then
      perform pos_private.require_object_keys(v_payload, 'order.line-added payload', array['orderId', 'line']);
      v_line := v_payload -> 'line';
    elsif v_action = 'order.line-changed' then
      perform pos_private.require_object_keys(v_payload, 'order.line-changed payload', array['orderId', 'lineId', 'line']);
      perform pos_private.require_text(v_payload -> 'lineId', 'lineId', 180, false, true, true);
      v_line := v_payload -> 'line';
      if v_line ->> 'lineId' is distinct from v_payload ->> 'lineId' then
        raise exception 'Changed line must keep its stable ID' using errcode = '22023';
      end if;
    elsif v_action = 'order.line-removed' then
      perform pos_private.require_object_keys(v_payload, 'order.line-removed payload', array['orderId', 'lineId']);
      perform pos_private.require_text(v_payload -> 'lineId', 'lineId', 180, false, true, true);
    else
      perform pos_private.require_object_keys(v_payload, 'order.details-changed payload', array[
        'orderId', 'tableId', 'customer'
      ], false);
      if not (v_payload ? 'tableId' or v_payload ? 'customer') then
        raise exception 'A details change must change a field' using errcode = '22023';
      end if;
      if v_payload ? 'tableId' then
        perform pos_private.require_text(v_payload -> 'tableId', 'tableId', 80, true, false, false);
      end if;
      if v_payload ? 'customer' then
        perform pos_private.assert_customer(v_payload -> 'customer');
      end if;
    end if;
    v_order_id := pos_private.require_text(v_payload -> 'orderId', 'orderId', 180, false, true, true);
    if v_action in ('order.line-added', 'order.line-changed') then
      perform pos_private.assert_operation_line(v_line);
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_command -> 'expectedRevisions') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_command -> 'expectedRevisions') <> 1 then
    raise exception 'Supported order actions require one canonical order revision' using errcode = '22023';
  end if;
  v_expected := (p_command -> 'expectedRevisions') -> 0;
  perform pos_private.require_object_keys(v_expected, 'expected aggregate revision', array['kind', 'id', 'revision']);
  v_expected_kind := pos_private.require_text(v_expected -> 'kind', 'expected.kind', 40, false, true, false);
  v_expected_id := pos_private.require_text(v_expected -> 'id', 'expected.id', 180, false, true, true);
  v_expected_revision := pos_private.require_safe_integer(v_expected -> 'revision', 'expected.revision', 0, false);
  if v_expected_kind <> 'order' or v_expected_id is distinct from v_order_id
    or (v_action = 'order.opened' and v_expected_revision <> 0) then
    raise exception 'Expected revision set does not match this order action' using errcode = '22023';
  end if;

  select * into v_auth
  from pos_private.require_register_context(v_branch_id, v_device_id, p_session_id, p_lease_id);
  if v_actor is distinct from v_auth.actor_id
    or v_auth.capability <> 'cash_register'
    or v_auth.verified_role not in ('duena', 'encargado', 'barra', 'mesero') then
    raise exception 'Current authority cannot open or change this order' using errcode = '42501';
  end if;

  -- A caller's session/role is checked above, before this idempotency lookup.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_command_id, 0));
  select * into v_existing
  from pos_private.pos_operation_commands as saved
  where saved.command_id = v_command_id
  for share;
  if found then
    if v_existing.command is distinct from p_command then
      raise exception 'Command ID conflicts with different immutable content' using errcode = '23505';
    end if;
    return query select v_command_id, 'identical-retry'::text, v_existing.server_sequence, v_existing.received_at;
    return;
  end if;

  if v_action = 'order.opened' then
    insert into pos_private.pos_operation_aggregate_heads (
      branch_id, aggregate_kind, aggregate_id, revision, last_command_id, last_sequence
    ) values (v_branch_id, 'order', v_order_id, 0, null, 0)
    on conflict (branch_id, aggregate_kind, aggregate_id) do nothing;
  end if;

  select * into v_head
  from pos_private.pos_operation_aggregate_heads as head
  where head.branch_id = v_branch_id
    and head.aggregate_kind = 'order'
    and head.aggregate_id = v_order_id
  for update;
  if not found then
    raise exception 'Order was not found' using errcode = 'P0002';
  end if;
  if v_head.revision::numeric <> v_expected_revision then
    raise exception 'OPERATION_REVISION_CONFLICT'
      using errcode = '40001',
        detail = pg_catalog.jsonb_build_object(
          'kind', 'order', 'id', v_order_id,
          'expectedRevision', v_expected_revision,
          'actualRevision', v_head.revision
        )::text;
  end if;

  select saved.projection, saved.revision, saved.last_command_id, saved.last_sequence
    into v_order, v_projection_revision, v_projection_command_id, v_projection_sequence
  from pos_private.pos_operation_projections as saved
  where saved.branch_id = v_branch_id
    and saved.aggregate_kind = 'order'
    and saved.aggregate_id = v_order_id
  for update;
  if v_action = 'order.opened' then
    if v_head.revision <> 0 or found then
      raise exception 'OPERATION_REVISION_CONFLICT'
        using errcode = '40001',
          detail = pg_catalog.jsonb_build_object(
            'kind', 'order', 'id', v_order_id,
            'expectedRevision', 0, 'actualRevision', v_head.revision
          )::text;
    end if;
    v_revision := 1;
    v_new_order := pg_catalog.jsonb_build_object(
      'orderId', v_order_id,
      'revision', v_revision,
      'status', 'open',
      'orderType', v_order_type,
      'tableId', v_payload -> 'tableId',
      'customer', v_customer,
      'createdByActorId', v_actor::text,
      'openedAt', v_occurred_at,
      'lines', v_lines,
      'discounts', '[]'::jsonb,
      'preparationId', null,
      'splitFrom', null,
      'splitOperations', '[]'::jsonb,
      'history', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'commandId', v_command_id,
        'action', v_action,
        'actorId', v_actor::text,
        'occurredAt', v_occurred_at,
        'reason', null
      )),
      'closedAt', null,
      'cancellationReason', null,
      'cancelledByActorId', null
    );
  else
    if v_head.revision = 0 or not found then
      raise exception 'Order was not found' using errcode = 'P0002';
    end if;
    if v_projection_revision is distinct from v_head.revision
      or v_projection_command_id is distinct from v_head.last_command_id
      or v_projection_sequence is distinct from v_head.last_sequence then
      raise exception 'Stored order head and projection do not match' using errcode = 'XX001';
    end if;
    select event.command_id, event.server_sequence
      into v_event_command_id, v_event_sequence
    from pos_private.pos_operation_aggregate_events as event
    where event.branch_id = v_branch_id
      and event.aggregate_kind = 'order'
      and event.aggregate_id = v_order_id
      and event.revision = v_head.revision;
    if not found or v_event_command_id is distinct from v_head.last_command_id
      or v_event_sequence is distinct from v_head.last_sequence then
      raise exception 'Stored order event history and head do not match' using errcode = 'XX001';
    end if;
    perform pos_private.assert_order_projection(v_order, v_order_id, v_head.revision);
    if v_order -> 'preparationId' <> 'null'::jsonb then
      raise exception 'Orders linked to preparation require the later preparation operation family' using errcode = '0A000';
    end if;
    v_new_order := v_order;
    if v_action in ('order.line-added', 'order.line-changed', 'order.line-removed') then
      v_lines := '[]'::jsonb;
      v_found := false;
      for v_line in select value from pg_catalog.jsonb_array_elements(v_order -> 'lines')
      loop
        v_line_id := v_line ->> 'lineId';
        if v_action = 'order.line-added' and v_line_id = v_payload #>> '{line,lineId}' then
          raise exception 'Order line already exists' using errcode = '22023';
        elsif v_action = 'order.line-changed' and v_line_id = v_payload ->> 'lineId' then
          v_lines := v_lines || pg_catalog.jsonb_build_array(v_payload -> 'line');
          v_found := true;
        elsif v_action = 'order.line-removed' and v_line_id = v_payload ->> 'lineId' then
          v_found := true;
        else
          v_lines := v_lines || pg_catalog.jsonb_build_array(v_line);
        end if;
      end loop;
      if v_action = 'order.line-added' then
        if pg_catalog.jsonb_array_length(v_lines) >= 200 then
          raise exception 'Order line limit reached' using errcode = '22023';
        end if;
        v_lines := v_lines || pg_catalog.jsonb_build_array(v_payload -> 'line');
        v_found := true;
      end if;
      if not v_found then
        raise exception 'Order line was not found' using errcode = 'P0002';
      end if;
      if pg_catalog.jsonb_array_length(v_lines) = 0 then
        raise exception 'An open order must retain a line' using errcode = '22023';
      end if;
      select pg_catalog.count(*), pg_catalog.count(distinct (line.value ->> 'lineId'))
        into v_count, v_revision
        from pg_catalog.jsonb_array_elements(v_lines) as line(value);
      if v_count <> v_revision then
        raise exception 'Duplicate order line IDs' using errcode = '22023';
      end if;
      v_total := 0;
      v_total_known := true;
      for v_line in select value from pg_catalog.jsonb_array_elements(v_lines)
      loop
        perform pos_private.assert_operation_line(v_line);
        if v_line -> 'lineTotalCents' = 'null'::jsonb then
          v_total_known := false;
        elsif v_total_known then
          v_total := v_total + (v_line ->> 'lineTotalCents')::numeric;
          if v_total > 9007199254740991 then
            raise exception 'Order subtotal exceeds safe centavos' using errcode = '22023';
          end if;
        end if;
      end loop;
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{lines}', v_lines, true);
    elsif v_action = 'order.details-changed' then
      v_old_customer := v_order -> 'customer';
      v_old_table := v_order -> 'tableId';
      if v_payload ? 'customer' then
        v_customer := v_payload -> 'customer';
      else
        v_customer := v_old_customer;
      end if;
      if v_payload ? 'tableId' then
        v_table_id := pos_private.require_text(v_payload -> 'tableId', 'tableId', 80, true, false, false);
      else
        v_table_id := v_old_table #>> '{}';
      end if;
      perform pos_private.assert_order_contact(v_order ->> 'orderType', v_customer);
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{customer}', v_customer, true);
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{tableId}', coalesce(to_jsonb(v_table_id), 'null'::jsonb), true);
    end if;
    v_revision := v_head.revision + 1;
    v_new_order := pg_catalog.jsonb_set(v_new_order, '{revision}', to_jsonb(v_revision), true);
    v_history := v_new_order -> 'history' || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'commandId', v_command_id,
      'action', v_action,
      'actorId', v_actor::text,
      'occurredAt', v_occurred_at,
      'reason', null
    ));
    v_new_order := pg_catalog.jsonb_set(v_new_order, '{history}', v_history, true);
  end if;

  perform pos_private.assert_order_projection(v_new_order, v_order_id, v_revision);
  insert into pos_private.pos_operation_branch_sequences (branch_id, last_sequence)
  values (v_branch_id, 0)
  on conflict (branch_id) do nothing;
  update pos_private.pos_operation_branch_sequences as branch_sequence
  set last_sequence = branch_sequence.last_sequence + 1
  where branch_sequence.branch_id = v_branch_id
  returning last_sequence into v_sequence;

  insert into pos_private.pos_operation_commands as inserted_command (
    command_id, branch_id, actor_id, device_id, action, schema_version,
    occurred_at, command, server_sequence
  ) values (
    v_command_id, v_branch_id, v_actor, v_device_id, v_action, 1,
    v_action_time, p_command, v_sequence
  ) returning inserted_command.received_at into v_received_at;
  insert into pos_private.pos_operation_aggregate_events (
    branch_id, aggregate_kind, aggregate_id, revision, command_id,
    server_sequence, occurred_at
  ) values (
    v_branch_id, 'order', v_order_id, v_revision, v_command_id,
    v_sequence, v_action_time
  );
  insert into pos_private.pos_operation_projections (
    branch_id, aggregate_kind, aggregate_id, revision,
    last_command_id, last_sequence, projection
  ) values (
    v_branch_id, 'order', v_order_id, v_revision,
    v_command_id, v_sequence, v_new_order
  ) on conflict (branch_id, aggregate_kind, aggregate_id) do update
    set revision = excluded.revision,
        last_command_id = excluded.last_command_id,
        last_sequence = excluded.last_sequence,
        projection = excluded.projection;
  update pos_private.pos_operation_aggregate_heads as head
  set revision = v_revision,
      last_command_id = v_command_id,
      last_sequence = v_sequence
  where head.branch_id = v_branch_id
    and head.aggregate_kind = 'order'
    and head.aggregate_id = v_order_id;

  return query select v_command_id, 'inserted'::text, v_sequence, v_received_at;
end;
$$;

create function public.read_pos_open_orders_v1(
  p_session_id uuid,
  p_lease_id text,
  p_after_sequence bigint default 0,
  p_limit integer default 50
)
returns table (server_cursor bigint, orders jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_branch_id text;
  v_latest_sequence bigint;
begin
  select * into v_context
  from pos_private.require_register_context(
    (select session_row.branch_id from public.register_device_sessions as session_row where session_row.session_id = p_session_id),
    (select session_row.device_id from public.register_device_sessions as session_row where session_row.session_id = p_session_id),
    p_session_id,
    p_lease_id
  );
  if v_context.capability <> 'cash_register'
    or v_context.verified_role not in ('duena', 'encargado', 'barra', 'mesero') then
    raise exception 'This session cannot read cash-register orders' using errcode = '42501';
  end if;
  if p_after_sequence is null or p_after_sequence < 0
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid order read cursor or limit' using errcode = '22023';
  end if;
  select session_row.branch_id into v_branch_id
  from public.register_device_sessions as session_row
  where session_row.session_id = p_session_id;
  select coalesce(branch_sequence.last_sequence, 0) into v_latest_sequence
  from pos_private.pos_operation_branch_sequences as branch_sequence
  where branch_sequence.branch_id = v_branch_id;
  v_latest_sequence := coalesce(v_latest_sequence, 0);
  if p_after_sequence > v_latest_sequence then
    raise exception 'Order read cursor is ahead of this branch' using errcode = '22023';
  end if;

  return query
  with changed as (
    select distinct on (event.aggregate_id)
      event.aggregate_id,
      event.server_sequence
    from pos_private.pos_operation_aggregate_events as event
    where event.branch_id = v_branch_id
      and event.aggregate_kind = 'order'
      and event.server_sequence > p_after_sequence
    order by event.aggregate_id, event.server_sequence desc
  ), visible as (
    select changed.aggregate_id, changed.server_sequence, projection.projection
    from changed
    join pos_private.pos_operation_projections as projection
      on projection.branch_id = v_branch_id
      and projection.aggregate_kind = 'order'
      and projection.aggregate_id = changed.aggregate_id
    where projection.projection ->> 'status' = 'open'
      and (
        v_context.verified_role in ('duena', 'encargado')
        or projection.projection ->> 'createdByActorId' = v_context.actor_id::text
      )
    order by changed.server_sequence, changed.aggregate_id
    limit p_limit
  )
  select
    coalesce(pg_catalog.max(visible.server_sequence), p_after_sequence),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'orderId', visible.projection -> 'orderId',
          'revision', visible.projection -> 'revision',
          'status', visible.projection -> 'status',
          'orderType', visible.projection -> 'orderType',
          'tableId', visible.projection -> 'tableId',
          'customer', visible.projection -> 'customer',
          'openedAt', visible.projection -> 'openedAt',
          'lines', visible.projection -> 'lines'
        ) order by visible.aggregate_id
      ),
      '[]'::jsonb
    )
  from visible;
end;
$$;

revoke all on function pos_private.require_object_keys(jsonb, text, text[], boolean) from public, anon, authenticated;
revoke all on function pos_private.require_text(jsonb, text, integer, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function pos_private.require_safe_integer(jsonb, text, numeric, boolean) from public, anon, authenticated;
revoke all on function pos_private.require_utc_instant(jsonb, text) from public, anon, authenticated;
revoke all on function pos_private.assert_customer(jsonb) from public, anon, authenticated;
revoke all on function pos_private.assert_order_contact(text, jsonb) from public, anon, authenticated;
revoke all on function pos_private.assert_operation_line(jsonb) from public, anon, authenticated;
revoke all on function pos_private.assert_order_projection(jsonb, text, bigint) from public, anon, authenticated;
revoke all on function pos_private.require_register_context(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.append_pos_operation_v1(jsonb, uuid, text) from public, anon;
revoke all on function public.read_pos_open_orders_v1(uuid, text, bigint, integer) from public, anon;
grant execute on function public.append_pos_operation_v1(jsonb, uuid, text) to authenticated;
grant execute on function public.read_pos_open_orders_v1(uuid, text, bigint, integer) to authenticated;
