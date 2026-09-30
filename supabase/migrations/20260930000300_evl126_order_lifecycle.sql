-- EVL-126 owner/manager discount and cancellation support.
-- This is a forward migration; EVL-114/118 and reviewed 30000100/30000200 remain immutable.

alter table pos_private.pos_operation_commands
  drop constraint pos_operation_commands_action_check;
alter table pos_private.pos_operation_commands
  add constraint pos_operation_commands_action_check check (action in (
    'order.opened', 'order.line-added', 'order.line-changed',
    'order.line-removed', 'order.details-changed',
    'order.discounted', 'order.cancelled'
  ));

create or replace function pos_private.assert_order_projection(
  p_order jsonb,
  p_expected_id text,
  p_expected_revision bigint,
  p_expected_command_id text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_order_type text;
  v_status text;
  v_customer jsonb;
  v_line jsonb;
  v_line_count integer;
  v_line_id_count integer;
  v_history jsonb;
  v_entry jsonb;
  v_first_history jsonb;
  v_last_history jsonb;
  v_subtotal numeric := 0;
  v_subtotal_known boolean := true;
  v_discount_total numeric := 0;
  v_authorized numeric;
  v_allocated numeric;
  v_discount_count integer;
  v_history_discount_count integer;
  v_cancel_count integer;
  v_history_command_count integer;
  v_history_distinct_command_count integer;
  v_history_action text;
begin
  perform pos_private.require_object_keys(p_order, 'stored order projection', array[
    'orderId', 'revision', 'status', 'orderType', 'tableId', 'customer',
    'createdByActorId', 'openedAt', 'lines', 'discounts', 'preparationId',
    'splitFrom', 'splitOperations', 'history', 'closedAt',
    'cancellationReason', 'cancelledByActorId'
  ]);
  if pos_private.require_text(p_order -> 'orderId', 'stored orderId', 180, false, true, true) is distinct from p_expected_id
    or pos_private.require_safe_integer(p_order -> 'revision', 'stored revision', 1, false) is distinct from p_expected_revision then
    raise exception 'Stored order projection does not match its head' using errcode = 'XX001';
  end if;
  v_status := pos_private.require_text(p_order -> 'status', 'stored status', 40, false, true, false);
  if v_status not in ('open', 'cancelled') then
    raise exception 'Stored order has unsupported lifecycle status' using errcode = 'XX001';
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
    if v_line -> 'lineTotalCents' = 'null'::jsonb then
      v_subtotal_known := false;
    elsif v_subtotal_known then
      v_subtotal := v_subtotal + (v_line ->> 'lineTotalCents')::numeric;
      if v_subtotal > 9007199254740991 then
        raise exception 'Stored order subtotal exceeds safe cents' using errcode = 'XX001';
      end if;
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_order -> 'discounts') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_order -> 'discounts') > 5000 then
    raise exception 'Stored order discounts are invalid' using errcode = 'XX001';
  end if;
  v_discount_count := pg_catalog.jsonb_array_length(p_order -> 'discounts');
  for v_entry in select value from pg_catalog.jsonb_array_elements(p_order -> 'discounts')
  loop
    perform pos_private.require_object_keys(v_entry, 'order discount', array[
      'commandId', 'authorizedCents', 'allocatedCents', 'reason', 'actorId', 'occurredAt'
    ]);
    perform pos_private.require_text(v_entry -> 'commandId', 'discount.commandId', 180, false, true, true);
    v_authorized := pos_private.require_safe_integer(v_entry -> 'authorizedCents', 'discount.authorizedCents', 1, false);
    v_allocated := pos_private.require_safe_integer(v_entry -> 'allocatedCents', 'discount.allocatedCents', 1, false);
    if v_authorized is distinct from v_allocated then
      raise exception 'Stored discount allocation differs from authorized amount' using errcode = 'XX001';
    end if;
    v_discount_total := v_discount_total + v_allocated;
    if v_discount_total > 9007199254740991 then
      raise exception 'Stored discounts exceed safe cents' using errcode = 'XX001';
    end if;
    perform pos_private.require_text(v_entry -> 'reason', 'discount.reason', 250, false, true, false);
    perform pos_private.require_text(v_entry -> 'actorId', 'discount.actorId', 180, false, true, true);
    perform pos_private.require_utc_instant(v_entry -> 'occurredAt', 'discount.occurredAt');
  end loop;
  if v_discount_count > 0 and not v_subtotal_known then
    raise exception 'Stored discounts require captured line totals' using errcode = 'XX001';
  end if;
  if v_subtotal_known and v_discount_total > v_subtotal then
    raise exception 'Stored discounts exceed captured subtotal' using errcode = 'XX001';
  end if;

  if pg_catalog.jsonb_typeof(p_order -> 'history') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_order -> 'history') < 1
    or pg_catalog.jsonb_array_length(p_order -> 'history') > 5000 then
    raise exception 'Stored order history is invalid' using errcode = 'XX001';
  end if;
  v_history := p_order -> 'history';
  v_first_history := v_history -> 0;
  v_last_history := v_history -> (pg_catalog.jsonb_array_length(v_history) - 1);
  select pg_catalog.count(*), pg_catalog.count(distinct (history.value ->> 'commandId')),
    pg_catalog.count(*) filter (where history.value ->> 'action' = 'order.discounted'),
    pg_catalog.count(*) filter (where history.value ->> 'action' = 'order.cancelled')
    into v_history_command_count, v_history_distinct_command_count,
      v_history_discount_count, v_cancel_count
    from pg_catalog.jsonb_array_elements(v_history) as history(value);
  if v_history_command_count <> v_history_distinct_command_count
    or v_history_command_count <> p_expected_revision
    or v_first_history ->> 'action' is distinct from 'order.opened'
    or v_first_history ->> 'actorId' is distinct from p_order ->> 'createdByActorId'
    or v_first_history -> 'occurredAt' is distinct from p_order -> 'openedAt'
    or v_first_history -> 'reason' is distinct from 'null'::jsonb
    or v_last_history ->> 'commandId' is distinct from p_expected_command_id then
    raise exception 'Stored order history identity or opening event is invalid' using errcode = 'XX001';
  end if;
  for v_entry in select value from pg_catalog.jsonb_array_elements(v_history)
  loop
    perform pos_private.require_object_keys(v_entry, 'order history', array[
      'commandId', 'action', 'actorId', 'occurredAt', 'reason'
    ]);
    perform pos_private.require_text(v_entry -> 'commandId', 'history.commandId', 180, false, true, true);
    perform pos_private.require_text(v_entry -> 'actorId', 'history.actorId', 180, false, true, true);
    perform pos_private.require_utc_instant(v_entry -> 'occurredAt', 'history.occurredAt');
    v_history_action := pos_private.require_text(v_entry -> 'action', 'history.action', 80, false, true, false);
    if v_history_action not in (
      'order.opened', 'order.line-added', 'order.line-changed',
      'order.line-removed', 'order.details-changed',
      'order.discounted', 'order.cancelled'
    ) then
      raise exception 'Stored order history contains an unsupported operation' using errcode = 'XX001';
    end if;
    if v_history_action in ('order.discounted', 'order.cancelled') then
      perform pos_private.require_text(v_entry -> 'reason', 'history.reason', 250, false, true, false);
    elsif v_entry -> 'reason' is distinct from 'null'::jsonb then
      raise exception 'Stored open-order history has an unexpected reason' using errcode = 'XX001';
    end if;
    if v_history_action = 'order.discounted' and not exists (
      select 1 from pg_catalog.jsonb_array_elements(p_order -> 'discounts') as discount(value)
      where discount.value ->> 'commandId' = v_entry ->> 'commandId'
        and discount.value -> 'actorId' = v_entry -> 'actorId'
        and discount.value -> 'reason' = v_entry -> 'reason'
        and discount.value -> 'occurredAt' = v_entry -> 'occurredAt'
    ) then
      raise exception 'Discount history has no matching immutable discount entry' using errcode = 'XX001';
    end if;
  end loop;
  if v_history_discount_count <> v_discount_count
    or (select pg_catalog.count(distinct (discount.value ->> 'commandId'))
        from pg_catalog.jsonb_array_elements(p_order -> 'discounts') as discount(value)) <> v_discount_count then
    raise exception 'Discount history and entries do not reconcile' using errcode = 'XX001';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_history) as history(value)
      where history.value ->> 'action' = 'order.opened') <> 1 then
    raise exception 'Stored order must have exactly one opening event' using errcode = 'XX001';
  end if;

  if v_status = 'open' then
    if p_order -> 'closedAt' is distinct from 'null'::jsonb
      or p_order -> 'cancellationReason' is distinct from 'null'::jsonb
      or p_order -> 'cancelledByActorId' is distinct from 'null'::jsonb
      or v_cancel_count <> 0 then
      raise exception 'Open order contains cancellation metadata' using errcode = 'XX001';
    end if;
  else
    if v_cancel_count <> 1
      or v_last_history ->> 'action' is distinct from 'order.cancelled'
      or p_order -> 'closedAt' is distinct from v_last_history -> 'occurredAt'
      or p_order -> 'cancellationReason' is distinct from v_last_history -> 'reason'
      or p_order -> 'cancelledByActorId' is distinct from v_last_history -> 'actorId' then
      raise exception 'Cancelled order does not match its terminal history event' using errcode = 'XX001';
    end if;
    perform pos_private.require_utc_instant(p_order -> 'closedAt', 'stored closedAt');
    perform pos_private.require_text(p_order -> 'cancellationReason', 'stored cancellation reason', 250, false, true, false);
    perform pos_private.require_text(p_order -> 'cancelledByActorId', 'stored cancelling actor', 180, false, true, true);
  end if;
exception
  when sqlstate '22023' then
    raise exception 'Stored order projection contains malformed fields' using errcode = 'XX001';
end;
$$;

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
  v_reason text;
  v_amount numeric;
  v_current_discount numeric;
  v_discount_entry jsonb;
  v_discounts jsonb;
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
  if v_action not in ('order.opened', 'order.line-added', 'order.line-changed', 'order.line-removed', 'order.details-changed', 'order.discounted', 'order.cancelled') then
    raise exception 'Unsupported operation action' using errcode = '0A000';
  end if;
  if v_action in ('order.discounted', 'order.cancelled') then
    v_reason := pos_private.require_text(p_command -> 'reason', 'reason', 250, false, true, false);
  elsif p_command -> 'reason' <> 'null'::jsonb then
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
    elsif v_action = 'order.details-changed' then
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
    else
      if v_action = 'order.discounted' then
        perform pos_private.require_object_keys(v_payload, 'order.discounted payload', array['orderId', 'amountCents']);
        v_amount := pos_private.require_safe_integer(v_payload -> 'amountCents', 'amountCents', 1, false);
      else
        perform pos_private.require_object_keys(v_payload, 'order.cancelled payload', array['orderId']);
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
    or v_auth.capability <> 'cash_register' then
    raise exception 'Current actor and cash-register authority must match this command' using errcode = '42501';
  end if;
  if v_action in ('order.discounted', 'order.cancelled') then
    if v_auth.verified_role not in ('duena', 'encargado') then
      raise exception 'Only Dueña or Encargado may discount or cancel an order' using errcode = '42501';
    end if;
  elsif v_auth.verified_role not in ('duena', 'encargado', 'barra', 'mesero') then
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
    if v_order -> 'preparationId' <> 'null'::jsonb then
      raise exception 'Orders linked to preparation require the later preparation operation family' using errcode = '0A000';
    end if;
    perform pos_private.assert_order_projection(
      v_order, v_order_id, v_head.revision, v_head.last_command_id
    );
    if v_order ->> 'status' <> 'open' then
      raise exception 'ORDER_NOT_OPEN' using errcode = '22023';
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
      select coalesce(pg_catalog.sum((discount.value ->> 'allocatedCents')::numeric), 0)
        into v_current_discount
      from pg_catalog.jsonb_array_elements(v_order -> 'discounts') as discount(value);
      if v_current_discount > 0 and not v_total_known then
        raise exception 'ORDER_PRICE_INCOMPLETE' using errcode = '22023';
      end if;
      if v_total_known and v_current_discount > v_total then
        raise exception 'Order discount cannot exceed captured subtotal' using errcode = '22023';
      end if;
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
    elsif v_action = 'order.discounted' then
      v_total := 0;
      v_total_known := true;
      for v_line in select value from pg_catalog.jsonb_array_elements(v_order -> 'lines')
      loop
        if v_line -> 'lineTotalCents' = 'null'::jsonb then
          v_total_known := false;
        elsif v_total_known then
          v_total := v_total + (v_line ->> 'lineTotalCents')::numeric;
          if v_total > 9007199254740991 then
            raise exception 'Order subtotal exceeds safe centavos' using errcode = '22023';
          end if;
        end if;
      end loop;
      if not v_total_known then
        raise exception 'ORDER_PRICE_INCOMPLETE' using errcode = '22023';
      end if;
      select coalesce(pg_catalog.sum((discount.value ->> 'allocatedCents')::numeric), 0)
        into v_current_discount
      from pg_catalog.jsonb_array_elements(v_order -> 'discounts') as discount(value);
      if v_current_discount + v_amount > v_total then
        raise exception 'Order discount exceeds captured subtotal' using errcode = '22023';
      end if;
      v_discount_entry := pg_catalog.jsonb_build_object(
        'commandId', v_command_id,
        'authorizedCents', v_amount,
        'allocatedCents', v_amount,
        'reason', v_reason,
        'actorId', v_actor::text,
        'occurredAt', v_occurred_at
      );
      v_discounts := (v_order -> 'discounts') || pg_catalog.jsonb_build_array(v_discount_entry);
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{discounts}', v_discounts, true);
    elsif v_action = 'order.cancelled' then
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{status}', to_jsonb('cancelled'::text), true);
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{closedAt}', to_jsonb(v_occurred_at), true);
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{cancellationReason}', to_jsonb(v_reason), true);
      v_new_order := pg_catalog.jsonb_set(v_new_order, '{cancelledByActorId}', to_jsonb(v_actor::text), true);
    end if;
    v_revision := v_head.revision + 1;
    v_new_order := pg_catalog.jsonb_set(v_new_order, '{revision}', to_jsonb(v_revision), true);
    v_history := v_new_order -> 'history' || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'commandId', v_command_id,
      'action', v_action,
      'actorId', v_actor::text,
      'occurredAt', v_occurred_at,
      'reason', v_reason
    ));
    v_new_order := pg_catalog.jsonb_set(v_new_order, '{history}', v_history, true);
  end if;

  perform pos_private.assert_order_projection(
    v_new_order, v_order_id, v_revision, v_command_id
  );
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

create function public.read_pos_order_lifecycle_v1(
  p_session_id uuid,
  p_lease_id text,
  p_after_sequence bigint default 0,
  p_limit integer default 50
)
returns table (feed_version integer, server_cursor bigint, orders jsonb)
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
    where projection.projection ->> 'status' in ('open', 'cancelled')
      and (
        v_context.verified_role in ('duena', 'encargado')
        or projection.projection ->> 'createdByActorId' = v_context.actor_id::text
      )
    order by changed.server_sequence, changed.aggregate_id
    limit p_limit
  )
  select
    1,
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
          'createdByActorId', visible.projection -> 'createdByActorId',
          'openedAt', visible.projection -> 'openedAt',
          'lines', visible.projection -> 'lines',
          'discounts', visible.projection -> 'discounts',
          'closedAt', visible.projection -> 'closedAt',
          'cancellationReason', visible.projection -> 'cancellationReason',
          'cancelledByActorId', visible.projection -> 'cancelledByActorId',
          'history', visible.projection -> 'history'
        ) order by visible.aggregate_id
      ),
      '[]'::jsonb
    )
  from visible;
end;
$$;

revoke all on function public.read_pos_order_lifecycle_v1(uuid, text, bigint, integer) from public, anon;
grant execute on function public.read_pos_order_lifecycle_v1(uuid, text, bigint, integer) to authenticated;
revoke all on function pos_private.assert_order_projection(jsonb, text, bigint, text) from public, anon, authenticated;
