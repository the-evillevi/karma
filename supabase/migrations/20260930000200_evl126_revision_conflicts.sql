-- EVL-126 forward compatibility fix: business revision conflicts map to HTTP 409.
-- SQLSTATE 40001 is reserved for actual PostgreSQL serialization failures. On
-- PostgREST 14, raising 40001 from application code triggers an infinite retry loop.
-- Keep the append contract, authorization, validation, and transaction logic identical.

create or replace function public.append_pos_operation_v1(
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
    raise sqlstate 'PT409'
      using message = 'OPERATION_REVISION_CONFLICT',
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
      raise sqlstate 'PT409'
        using message = 'OPERATION_REVISION_CONFLICT',
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
