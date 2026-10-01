do $$
declare
  table_name text;
  table_privilege text;
  role_name text;
  private_tables text[] := array[
    'pos_operation_branch_sequences',
    'pos_operation_commands',
    'pos_operation_aggregate_heads',
    'pos_operation_aggregate_events',
    'pos_operation_projections'
  ];
  table_privileges text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if pg_catalog.has_schema_privilege(role_name, 'pos_private', 'USAGE') then
      raise exception 'Unexpected private schema access for %', role_name;
    end if;
    foreach table_name in array private_tables
    loop
      foreach table_privilege in array table_privileges
      loop
        if pg_catalog.has_table_privilege(
          role_name,
          pg_catalog.format('pos_private.%I', table_name),
          table_privilege
        ) then
          raise exception 'Unexpected % privilege on pos_private.% for %',
            table_privilege, table_name, role_name;
        end if;
      end loop;
    end loop;
  end loop;

  if not pg_catalog.has_function_privilege(
      'authenticated', 'public.append_pos_operation_v1(jsonb,uuid,text)', 'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_pos_open_orders_v1(uuid,text,bigint,integer)', 'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_pos_order_lifecycle_v1(uuid,text,bigint,integer)', 'EXECUTE'
    ) then
    raise exception 'Authenticated RPC grants are missing';
  end if;
  if pg_catalog.has_function_privilege(
      'anon', 'public.append_pos_operation_v1(jsonb,uuid,text)', 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon', 'public.read_pos_open_orders_v1(uuid,text,bigint,integer)', 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon', 'public.read_pos_order_lifecycle_v1(uuid,text,bigint,integer)', 'EXECUTE'
    ) then
    raise exception 'Anonymous RPC access is unexpectedly granted';
  end if;

  foreach table_name in array private_tables
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'pos_private'
        and relation.relname = table_name
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled for pos_private.%', table_name;
    end if;
  end loop;
end;
$$;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111');
insert into public.branches (branch_id, name, currency)
values ('evl126-smoke', 'EVL-126 local smoke', 'MXN');
insert into public.branch_memberships (
  branch_id, user_id, role, display_name, active
) values (
  'evl126-smoke', '11111111-1111-4111-8111-111111111111',
  'duena', 'Owner smoke fixture', true
);
insert into public.register_devices (
  device_id, branch_id, owner_user_id, capability
) values (
  'cash-smoke', 'evl126-smoke',
  '11111111-1111-4111-8111-111111111111', 'cash_register'
);
insert into public.branch_register_leases (
  branch_id, device_id, lease_id, valid_from, expires_at, issued_by
) values (
  'evl126-smoke', 'cash-smoke', 'lease-smoke',
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp() + interval '8 hours',
  '11111111-1111-4111-8111-111111111111'
);
insert into public.register_device_sessions (
  session_id, branch_id, device_id, actor_id, capability, lease_id, expires_at
) values (
  '22222222-2222-4222-8222-222222222222', 'evl126-smoke', 'cash-smoke',
  '11111111-1111-4111-8111-111111111111', 'cash_register', 'lease-smoke',
  pg_catalog.clock_timestamp() + interval '8 hours'
);

set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
declare
  v_command jsonb;
  v_bad jsonb;
  v_line jsonb;
  v_result record;
  v_retry record;
  v_read record;
  v_lifecycle record;
  v_stale jsonb;
  v_bad_line jsonb;
  v_action_command jsonb;
  v_stale_rejected boolean := false;
  v_business_rejected boolean := false;
  v_received_at timestamptz;
  v_server_sequence bigint;
  v_orders jsonb;
  v_order_id text := 'smoke-order';
  v_time text := '2026-09-30T16:00:00.000Z';
  bad_time text;
begin
  v_line := pg_catalog.jsonb_build_object(
    'lineId', 'line-1', 'productId', null, 'nameSnapshot', 'Cafe test',
    'quantity', 1, 'currency', 'MXN', 'baseUnitPriceCents', 100,
    'modifierTotalCents', 0, 'unitPriceCents', 100, 'lineTotalCents', 100,
    'priceEvidence', 'prototype-captured', 'catalogPriceVersionId', null,
    'modifiers', '[]'::jsonb, 'notes', null,
    'tax', pg_catalog.jsonb_build_object(
      'currency', 'MXN', 'evidence', 'unknown', 'rateBasisPoints', null,
      'amountCents', null, 'policyId', null
    )
  );
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-open', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', v_time,
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', v_order_id, 'revision', 0)
    ),
    'action', 'order.opened', 'reason', null,
    'payload', pg_catalog.jsonb_build_object(
      'orderId', v_order_id, 'orderType', 'mesa', 'tableId', null,
      'customer', null, 'lines', pg_catalog.jsonb_build_array(v_line)
    )
  );

  foreach bad_time in array array[
    '2026-09-30T24:00:00.000Z',
    '2026-09-30T23:59:60.000Z',
    '2026-02-30T12:00:00.000Z'
  ]
  loop
    v_bad := pg_catalog.jsonb_set(v_command, '{occurredAt}', to_jsonb(bad_time), false);
    begin
      perform * from public.append_pos_operation_v1(
        v_bad, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
      );
      raise exception 'Non-canonical timestamp was accepted' using errcode = 'P0002';
    exception when sqlstate '22023' then
      null;
    end;
  end loop;

  v_bad := v_command || pg_catalog.jsonb_build_object('projection', '{}'::jsonb);
  begin
    perform * from public.append_pos_operation_v1(
      v_bad, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Unknown envelope field was accepted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    null;
  end;

  v_bad := pg_catalog.jsonb_set(v_command, '{payload}',
    (v_command -> 'payload') - 'tableId', false);
  begin
    perform * from public.append_pos_operation_v1(
      v_bad, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Missing required order.opened field was accepted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    null;
  end;

  select * into v_result from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' then
    raise exception 'Open did not insert';
  end if;
  v_server_sequence := v_result.server_sequence;
  v_received_at := v_result.received_at;

  select * into v_retry from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_retry.outcome is distinct from 'identical-retry'
    or v_retry.server_sequence is distinct from v_server_sequence
    or v_retry.received_at is distinct from v_received_at then
    raise exception 'Exact retry did not preserve its acknowledgement';
  end if;

  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-details', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', v_time,
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', v_order_id, 'revision', 1)
    ),
    'action', 'order.details-changed', 'reason', null,
    'payload', pg_catalog.jsonb_build_object('orderId', v_order_id, 'tableId', 'TABLE-1')
  );
  select * into v_result from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' then
    raise exception 'Optional-field details change did not insert';
  end if;

  v_bad := v_command || pg_catalog.jsonb_build_object('ignoredField', true);
  v_bad := pg_catalog.jsonb_set(v_bad, '{commandId}', to_jsonb('smoke-details-extra'::text), false);
  v_bad := pg_catalog.jsonb_set(v_bad, '{expectedRevisions,0,revision}', '2'::jsonb, false);
  begin
    perform * from public.append_pos_operation_v1(
      v_bad, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Unknown details field was accepted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    null;
  end;

  v_bad := v_command;
  v_bad := pg_catalog.jsonb_set(v_bad, '{commandId}', to_jsonb('smoke-details-noop'::text), false);
  v_bad := pg_catalog.jsonb_set(v_bad, '{expectedRevisions,0,revision}', '2'::jsonb, false);
  v_bad := pg_catalog.jsonb_set(v_bad, '{payload}', pg_catalog.jsonb_build_object('orderId', v_order_id), false);
  begin
    perform * from public.append_pos_operation_v1(
      v_bad, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'No-op details change was accepted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    null;
  end;

  select * into v_read from public.read_pos_open_orders_v1(
    '22222222-2222-4222-8222-222222222222', 'lease-smoke', 0, 10
  );
  v_orders := v_read.orders;
  if v_read.server_cursor <> 2
    or pg_catalog.jsonb_array_length(v_orders) <> 1
    or v_orders -> 0 ->> 'orderId' is distinct from v_order_id
    or v_orders -> 0 ->> 'tableId' is distinct from 'TABLE-1'
    or v_orders -> 0 ? 'history' then
    raise exception 'Sanitized cash read did not return the expected current view';
  end if;

  v_action_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-discount', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:01.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', v_order_id, 'revision', 2)
    ),
    'action', 'order.discounted', 'reason', 'Local discount proof',
    'payload', pg_catalog.jsonb_build_object('orderId', v_order_id, 'amountCents', 40)
  );
  select * into v_result from public.append_pos_operation_v1(
    v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' or v_result.server_sequence <> 3 then
    raise exception 'Authorized discount did not append exactly once';
  end if;
  select * into v_retry from public.append_pos_operation_v1(
    v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_retry.outcome is distinct from 'identical-retry'
    or v_retry.server_sequence is distinct from v_result.server_sequence then
    raise exception 'Discount retry did not preserve its acknowledgement';
  end if;

  -- A past/current cursor must not hide the legacy feed's missing money facts.
  for v_cursor in 0..3 loop
    v_business_rejected := false;
    begin
      perform * from public.read_pos_open_orders_v1(
        '22222222-2222-4222-8222-222222222222', 'lease-smoke', v_cursor, 1
      );
      raise exception 'Legacy read silently omitted a live discount' using errcode = 'P0002';
    exception when sqlstate '0A000' then
      if sqlerrm <> 'ORDER_LIFECYCLE_READ_REQUIRED' then
        raise exception 'Legacy read disclosed unexpected error details';
      end if;
      v_business_rejected := true;
    end;
    if not v_business_rejected then
      raise exception 'Legacy discounted read did not fail closed';
    end if;
  end loop;
  select * into v_read from public.read_pos_order_lifecycle_v1(
    '22222222-2222-4222-8222-222222222222', 'lease-smoke', 0, 50
  );
  if v_read.orders -> 0 ->> 'status' <> 'open'
    or (v_read.orders -> 0 -> 'discounts' -> 0 ->> 'allocatedCents')::bigint <> 40 then
    raise exception 'Lifecycle feed omitted the live discount';
  end if;

  v_business_rejected := false;
  v_action_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-cumulative-discount', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:01.500Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', v_order_id, 'revision', 3)
    ),
    'action', 'order.discounted', 'reason', 'Cumulative discount limit',
    'payload', pg_catalog.jsonb_build_object('orderId', v_order_id, 'amountCents', 61)
  );
  begin
    perform * from public.append_pos_operation_v1(
      v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Cumulative discount over subtotal was accepted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    v_business_rejected := true;
  end;
  if not v_business_rejected then
    raise exception 'Cumulative discount did not fail closed';
  end if;

  v_bad_line := v_line || pg_catalog.jsonb_build_object(
    'baseUnitPriceCents', 30, 'unitPriceCents', 30, 'lineTotalCents', 30
  );
  v_action_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-overdiscount-line', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:02.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', v_order_id, 'revision', 3)
    ),
    'action', 'order.line-changed', 'reason', null,
    'payload', pg_catalog.jsonb_build_object('orderId', v_order_id, 'lineId', 'line-1', 'line', v_bad_line)
  );
  begin
    perform * from public.append_pos_operation_v1(
      v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Line change below the existing discount was accepted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    v_business_rejected := true;
  end;
  if not v_business_rejected then
    raise exception 'Over-discount line change did not fail closed';
  end if;

  v_action_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-cancel', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:03.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', v_order_id, 'revision', 3)
    ),
    'action', 'order.cancelled', 'reason', 'Prueba de cancelación',
    'payload', pg_catalog.jsonb_build_object('orderId', v_order_id)
  );
  select * into v_result from public.append_pos_operation_v1(
    v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' or v_result.server_sequence <> 4 then
    raise exception 'Authorized cancellation did not append exactly once';
  end if;
  v_business_rejected := false;
  v_action_command := pg_catalog.jsonb_set(v_action_command, '{commandId}', to_jsonb('smoke-after-cancel'::text), false);
  v_action_command := pg_catalog.jsonb_set(v_action_command, '{expectedRevisions,0,revision}', '4'::jsonb, false);
  v_action_command := pg_catalog.jsonb_set(v_action_command, '{action}', to_jsonb('order.discounted'::text), false);
  v_action_command := pg_catalog.jsonb_set(v_action_command, '{payload}',
    pg_catalog.jsonb_build_object('orderId', v_order_id, 'amountCents', 10), false);
  begin
    perform * from public.append_pos_operation_v1(
      v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'A cancelled order was changed' using errcode = 'P0002';
  exception when sqlstate '22023' then
    v_business_rejected := true;
  end;
  if not v_business_rejected then
    raise exception 'Cancelled order accepted another mutation';
  end if;

  select * into v_lifecycle from public.read_pos_order_lifecycle_v1(
    '22222222-2222-4222-8222-222222222222', 'lease-smoke', 0, 10
  );
  if v_lifecycle.feed_version <> 1 or v_lifecycle.server_cursor <> 4
    or pg_catalog.jsonb_array_length(v_lifecycle.orders) <> 1
    or v_lifecycle.orders -> 0 ->> 'orderId' is distinct from v_order_id
    or v_lifecycle.orders -> 0 ->> 'status' is distinct from 'cancelled'
    or v_lifecycle.orders -> 0 ->> 'cancellationReason' is distinct from 'Prueba de cancelación'
    or v_lifecycle.orders -> 0 -> 'discounts' -> 0 ->> 'allocatedCents' is distinct from '40'
    or pg_catalog.jsonb_array_length(v_lifecycle.orders -> 0 -> 'history') <> 4 then
    raise exception 'Lifecycle feed did not preserve the cancelled order tombstone and money history';
  end if;
  select * into v_read from public.read_pos_open_orders_v1(
    '22222222-2222-4222-8222-222222222222', 'lease-smoke', 0, 10
  );
  if v_read.orders <> '[]'::jsonb then
    raise exception 'Legacy open-order feed exposed a cancelled order';
  end if;

  v_bad_line := v_line || pg_catalog.jsonb_build_object(
    'baseUnitPriceCents', null, 'modifierTotalCents', null,
    'unitPriceCents', null, 'lineTotalCents', null, 'priceEvidence', 'unknown'
  );
  v_action_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-unknown-open', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:04.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'unknown-price-order', 'revision', 0)
    ),
    'action', 'order.opened', 'reason', null,
    'payload', pg_catalog.jsonb_build_object(
      'orderId', 'unknown-price-order', 'orderType', 'local', 'tableId', null,
      'customer', null, 'lines', pg_catalog.jsonb_build_array(v_bad_line)
    )
  );
  select * into v_result from public.append_pos_operation_v1(
    v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' or v_result.server_sequence <> 5 then
    raise exception 'Unknown-price order did not open while remaining undiscounted';
  end if;
  v_action_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-unknown-discount', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:05.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'unknown-price-order', 'revision', 1)
    ),
    'action', 'order.discounted', 'reason', 'Unknown price must fail closed',
    'payload', pg_catalog.jsonb_build_object('orderId', 'unknown-price-order', 'amountCents', 1)
  );
  v_business_rejected := false;
  begin
    perform * from public.append_pos_operation_v1(
      v_action_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Unknown-price order was discounted' using errcode = 'P0002';
  exception when sqlstate '22023' then
    v_business_rejected := true;
  end;
  if not v_business_rejected
    then
    raise exception 'Unknown-price discount did not fail without state changes';
  end if;
  select * into v_lifecycle from public.read_pos_order_lifecycle_v1(
    '22222222-2222-4222-8222-222222222222', 'lease-smoke', 4, 10
  );
  if v_lifecycle.server_cursor <> 5
    or pg_catalog.jsonb_array_length(v_lifecycle.orders) <> 1
    or v_lifecycle.orders -> 0 ->> 'orderId' is distinct from 'unknown-price-order'
    or v_lifecycle.orders -> 0 ->> 'revision' is distinct from '1'
    or v_lifecycle.orders -> 0 -> 'discounts' <> '[]'::jsonb then
    raise exception 'Unknown-price order projection changed after rejected discount';
  end if;

  v_stale := pg_catalog.jsonb_set(
    v_command, '{commandId}', to_jsonb('smoke-stale-details'::text), false
  );
  v_stale := pg_catalog.jsonb_set(
    v_stale, '{payload,tableId}', to_jsonb('TABLE-STALE'::text), false
  );
  begin
    perform * from public.append_pos_operation_v1(
      v_stale, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Stale order revision was accepted' using errcode = 'P0002';
  exception when sqlstate 'PT409' then
    v_stale_rejected := true;
  end;
  if not v_stale_rejected then
    raise exception 'Stale order revision did not return PT409';
  end if;

  raise notice 'EVL-126 local discount and cancellation family checks passed';

  raise notice 'EVL-126 PostgreSQL open/edit, discount, cancellation, retry, PT409, strict-key, timestamp, and lifecycle feed checks passed';
end;
$$;

reset role;

create temp table smoke_original_projection as
select projection
from pos_private.pos_operation_projections
where branch_id = 'evl126-smoke'
  and aggregate_kind = 'order'
  and aggregate_id = 'smoke-order';

update pos_private.pos_operation_projections
set projection = pg_catalog.jsonb_set(projection, '{history,1,action}', 'null'::jsonb, false)
where branch_id = 'evl126-smoke' and aggregate_kind = 'order' and aggregate_id = 'smoke-order';

set role authenticated;
do $$
declare
  v_command jsonb;
  v_rejected boolean := false;
begin
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-corrupt-null-action', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:04.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'smoke-order', 'revision', 4)
    ),
    'action', 'order.discounted', 'reason', 'Integrity probe',
    'payload', pg_catalog.jsonb_build_object('orderId', 'smoke-order', 'amountCents', 1)
  );
  begin
    perform * from public.append_pos_operation_v1(
      v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
  exception when sqlstate 'XX001' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Null stored history action did not fail closed' using errcode = 'P0002';
  end if;
end;
$$;
reset role;

update pos_private.pos_operation_projections as projection
set projection = pg_catalog.jsonb_set(
  (select original.projection from smoke_original_projection as original),
  '{history,1,action}', to_jsonb(17), false
)
where projection.branch_id = 'evl126-smoke'
  and projection.aggregate_kind = 'order'
  and projection.aggregate_id = 'smoke-order';

set role authenticated;
do $$
declare
  v_command jsonb;
  v_rejected boolean := false;
begin
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-corrupt-number-action', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:00:05.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'smoke-order', 'revision', 4)
    ),
    'action', 'order.discounted', 'reason', 'Integrity probe',
    'payload', pg_catalog.jsonb_build_object('orderId', 'smoke-order', 'amountCents', 1)
  );
  begin
    perform * from public.append_pos_operation_v1(
      v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
  exception when sqlstate 'XX001' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Numeric stored history action did not fail closed' using errcode = 'P0002';
  end if;
end;
$$;
reset role;

update pos_private.pos_operation_projections as projection
set projection = original.projection
from smoke_original_projection as original
where projection.branch_id = 'evl126-smoke'
  and projection.aggregate_kind = 'order'
  and projection.aggregate_id = 'smoke-order';
drop table smoke_original_projection;

do $$
begin
  if (select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke') <> 5
    or (select revision from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'smoke-order') <> 4
    or (select last_sequence from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'smoke-order') <> 4
    or (select projection ->> 'tableId' from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'smoke-order') is distinct from 'TABLE-1'
    or exists (select 1 from pos_private.pos_operation_commands where command_id = 'smoke-stale-details')
    or exists (select 1 from pos_private.pos_operation_aggregate_events where command_id = 'smoke-stale-details') then
    raise exception 'PT409 stale revision changed sequence, head, command, event, or projection state';
  end if;
end;
$$;

create temp table smoke_before as
select
  coalesce((select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke'), 0) as branch_sequence,
  (select count(*) from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') as heads,
  (select count(*) from pos_private.pos_operation_commands where command_id = 'smoke-rollback') as commands,
  (select count(*) from pos_private.pos_operation_aggregate_events where command_id = 'smoke-rollback') as events,
  (select count(*) from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') as projections;

create function public.smoke_fail_pos_operation_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Forced local rollback proof' using errcode = 'P0001';
end;
$$;
create trigger smoke_fail_pos_operation_command_before_insert
before insert on pos_private.pos_operation_commands
for each row execute function public.smoke_fail_pos_operation_command();

set role authenticated;
do $$
declare
  v_command jsonb;
  v_line jsonb;
  v_failed boolean := false;
begin
  v_line := pg_catalog.jsonb_build_object(
    'lineId', 'rollback-line', 'productId', null, 'nameSnapshot', 'Rollback test',
    'quantity', 1, 'currency', 'MXN', 'baseUnitPriceCents', 100,
    'modifierTotalCents', 0, 'unitPriceCents', 100, 'lineTotalCents', 100,
    'priceEvidence', 'prototype-captured', 'catalogPriceVersionId', null,
    'modifiers', '[]'::jsonb, 'notes', null,
    'tax', pg_catalog.jsonb_build_object(
      'currency', 'MXN', 'evidence', 'unknown', 'rateBasisPoints', null,
      'amountCents', null, 'policyId', null
    )
  );
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-rollback', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:01:00.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'rollback-order', 'revision', 0)
    ),
    'action', 'order.opened', 'reason', null,
    'payload', pg_catalog.jsonb_build_object(
      'orderId', 'rollback-order', 'orderType', 'mesa', 'tableId', null,
      'customer', null, 'lines', pg_catalog.jsonb_build_array(v_line)
    )
  );
  begin
    perform * from public.append_pos_operation_v1(
      v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Forced late failure did not fire' using errcode = 'P0002';
  end if;
end;
$$;
reset role;

drop trigger smoke_fail_pos_operation_command_before_insert on pos_private.pos_operation_commands;
drop function public.smoke_fail_pos_operation_command();

do $$
begin
  if (select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke')
      is distinct from (select branch_sequence from smoke_before)
    or (select count(*) from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select heads from smoke_before)
    or (select count(*) from pos_private.pos_operation_commands where command_id = 'smoke-rollback')
      is distinct from (select commands from smoke_before)
    or (select count(*) from pos_private.pos_operation_aggregate_events where command_id = 'smoke-rollback')
      is distinct from (select events from smoke_before)
    or (select count(*) from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select projections from smoke_before) then
    raise exception 'Late failure left a partial operation write';
  end if;
end;
$$;

set role authenticated;
do $$
declare
  v_line jsonb;
  v_command jsonb;
  v_result record;
begin
  v_line := pg_catalog.jsonb_build_object(
    'lineId', 'rollback-line', 'productId', null, 'nameSnapshot', 'Rollback test',
    'quantity', 1, 'currency', 'MXN', 'baseUnitPriceCents', 100,
    'modifierTotalCents', 0, 'unitPriceCents', 100, 'lineTotalCents', 100,
    'priceEvidence', 'prototype-captured', 'catalogPriceVersionId', null,
    'modifiers', '[]'::jsonb, 'notes', null,
    'tax', pg_catalog.jsonb_build_object(
      'currency', 'MXN', 'evidence', 'unknown', 'rateBasisPoints', null,
      'amountCents', null, 'policyId', null
    )
  );
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-rollback', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:01:00.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'rollback-order', 'revision', 0)
    ),
    'action', 'order.opened', 'reason', null,
    'payload', pg_catalog.jsonb_build_object(
      'orderId', 'rollback-order', 'orderType', 'mesa', 'tableId', null,
      'customer', null, 'lines', pg_catalog.jsonb_build_array(v_line)
    )
  );
  select * into v_result from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' then
    raise exception 'Retry after forced rollback did not insert';
  end if;
end;
$$;
reset role;

do $$
begin
  if (select branch_sequence from smoke_before) + 1 is distinct from
       (select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke')
    or (select revision from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') <> 1
    or (select count(*) from pos_private.pos_operation_commands where command_id = 'smoke-rollback') <> 1
    or (select count(*) from pos_private.pos_operation_aggregate_events where command_id = 'smoke-rollback') <> 1
    or (select count(*) from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') <> 1 then
    raise exception 'Retry after rollback did not commit exactly once';
  end if;
end;
$$;

create function public.smoke_fail_pos_projection_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('karma.v126.fail_projection', true) = 'on' then
    raise exception 'Forced local projection rollback proof' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger smoke_fail_pos_projection_write
before insert or update on pos_private.pos_operation_projections
for each row execute function public.smoke_fail_pos_projection_write();

create temp table smoke_before_discount as
select
  branch_sequence.last_sequence as branch_sequence,
  head.revision,
  head.last_command_id,
  head.last_sequence,
  projection.projection,
  projection.projection -> 'history' as history,
  (select count(*) from pos_private.pos_operation_commands where branch_id = 'evl126-smoke' and command -> 'payload' ->> 'orderId' = 'rollback-order') as commands,
  (select count(*) from pos_private.pos_operation_aggregate_events where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') as events
from pos_private.pos_operation_branch_sequences as branch_sequence
join pos_private.pos_operation_aggregate_heads as head on head.branch_id = branch_sequence.branch_id
join pos_private.pos_operation_projections as projection
  on projection.branch_id = head.branch_id and projection.aggregate_id = head.aggregate_id
where branch_sequence.branch_id = 'evl126-smoke'
  and head.aggregate_kind = 'order' and head.aggregate_id = 'rollback-order'
  and projection.aggregate_kind = 'order';

set role authenticated;
do $$
declare
  v_command jsonb;
  v_result record;
  v_failed boolean := false;
begin
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-rollback-discount', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:02:00.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'rollback-order', 'revision', 1)
    ),
    'action', 'order.discounted', 'reason', 'Rollback discount',
    'payload', pg_catalog.jsonb_build_object('orderId', 'rollback-order', 'amountCents', 20)
  );
  perform pg_catalog.set_config('karma.v126.fail_projection', 'on', true);
  begin
    select * into v_result from public.append_pos_operation_v1(
      v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Forced discount projection failure did not fire' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;
  perform pg_catalog.set_config('karma.v126.fail_projection', 'off', true);
  if not v_failed then
    raise exception 'Discount projection failure was not observed';
  end if;
end;
$$;
reset role;

do $$
begin
  if (select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke')
      is distinct from (select branch_sequence from smoke_before_discount)
    or (select revision from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select revision from smoke_before_discount)
    or (select last_command_id from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select last_command_id from smoke_before_discount)
    or (select last_sequence from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select last_sequence from smoke_before_discount)
    or (select projection from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select projection from smoke_before_discount)
    or (select projection -> 'history' from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select history from smoke_before_discount)
    or exists (select 1 from pos_private.pos_operation_commands where command_id = 'smoke-rollback-discount')
    or exists (select 1 from pos_private.pos_operation_aggregate_events where command_id = 'smoke-rollback-discount') then
    raise exception 'Failed discount wrote a command, event, sequence, head, projection, or history';
  end if;
end;
$$;

set role authenticated;
do $$
declare
  v_command jsonb;
  v_result record;
  v_retry record;
begin
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-rollback-discount', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:02:00.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'rollback-order', 'revision', 1)
    ),
    'action', 'order.discounted', 'reason', 'Rollback discount',
    'payload', pg_catalog.jsonb_build_object('orderId', 'rollback-order', 'amountCents', 20)
  );
  select * into v_result from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' then
    raise exception 'Exact retry after failed discount did not insert';
  end if;
  select * into v_retry from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_retry.outcome is distinct from 'identical-retry'
    or v_retry.server_sequence is distinct from v_result.server_sequence
    or v_retry.received_at is distinct from v_result.received_at then
    raise exception 'Successful discount exact retry changed its acknowledgement';
  end if;
end;
$$;
reset role;
drop table smoke_before_discount;

create temp table smoke_before_cancel as
select
  branch_sequence.last_sequence as branch_sequence,
  head.revision,
  head.last_command_id,
  head.last_sequence,
  projection.projection,
  projection.projection -> 'history' as history
from pos_private.pos_operation_branch_sequences as branch_sequence
join pos_private.pos_operation_aggregate_heads as head on head.branch_id = branch_sequence.branch_id
join pos_private.pos_operation_projections as projection
  on projection.branch_id = head.branch_id and projection.aggregate_id = head.aggregate_id
where branch_sequence.branch_id = 'evl126-smoke'
  and head.aggregate_kind = 'order' and head.aggregate_id = 'rollback-order'
  and projection.aggregate_kind = 'order';

set role authenticated;
do $$
declare
  v_command jsonb;
  v_result record;
  v_failed boolean := false;
begin
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-rollback-cancel', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:03:00.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'rollback-order', 'revision', 2)
    ),
    'action', 'order.cancelled', 'reason', 'Rollback cancellation',
    'payload', pg_catalog.jsonb_build_object('orderId', 'rollback-order')
  );
  perform pg_catalog.set_config('karma.v126.fail_projection', 'on', true);
  begin
    select * into v_result from public.append_pos_operation_v1(
      v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
    );
    raise exception 'Forced cancellation projection failure did not fire' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;
  perform pg_catalog.set_config('karma.v126.fail_projection', 'off', true);
  if not v_failed then
    raise exception 'Cancellation projection failure was not observed';
  end if;
end;
$$;
reset role;

do $$
begin
  if (select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke')
      is distinct from (select branch_sequence from smoke_before_cancel)
    or (select revision from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select revision from smoke_before_cancel)
    or (select last_command_id from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select last_command_id from smoke_before_cancel)
    or (select last_sequence from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select last_sequence from smoke_before_cancel)
    or (select projection from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select projection from smoke_before_cancel)
    or (select projection -> 'history' from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order')
      is distinct from (select history from smoke_before_cancel)
    or exists (select 1 from pos_private.pos_operation_commands where command_id = 'smoke-rollback-cancel')
    or exists (select 1 from pos_private.pos_operation_aggregate_events where command_id = 'smoke-rollback-cancel') then
    raise exception 'Failed cancellation wrote a command, event, sequence, head, projection, or history';
  end if;
end;
$$;

set role authenticated;
do $$
declare
  v_command jsonb;
  v_result record;
  v_retry record;
begin
  v_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'commandId', 'smoke-rollback-cancel', 'branchId', 'evl126-smoke',
    'actorId', '11111111-1111-4111-8111-111111111111', 'deviceId', 'cash-smoke',
    'occurredAt', '2026-09-30T16:03:00.000Z',
    'expectedRevisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'order', 'id', 'rollback-order', 'revision', 2)
    ),
    'action', 'order.cancelled', 'reason', 'Rollback cancellation',
    'payload', pg_catalog.jsonb_build_object('orderId', 'rollback-order')
  );
  select * into v_result from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_result.outcome is distinct from 'inserted' then
    raise exception 'Exact retry after failed cancellation did not insert';
  end if;
  select * into v_retry from public.append_pos_operation_v1(
    v_command, '22222222-2222-4222-8222-222222222222', 'lease-smoke'
  );
  if v_retry.outcome is distinct from 'identical-retry'
    or v_retry.server_sequence is distinct from v_result.server_sequence
    or v_retry.received_at is distinct from v_result.received_at then
    raise exception 'Successful cancellation exact retry changed its acknowledgement';
  end if;
end;
$$;
reset role;
drop trigger smoke_fail_pos_projection_write on pos_private.pos_operation_projections;
drop function public.smoke_fail_pos_projection_write();
drop table smoke_before_cancel;

do $$
begin
  if (select revision from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') <> 3
    or (select projection ->> 'status' from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') is distinct from 'cancelled'
    or (select pg_catalog.jsonb_array_length(projection -> 'history') from pos_private.pos_operation_projections where branch_id = 'evl126-smoke' and aggregate_id = 'rollback-order') <> 3
    or (select count(*) from pos_private.pos_operation_commands where command_id in ('smoke-rollback-discount', 'smoke-rollback-cancel')) <> 2
    or (select count(*) from pos_private.pos_operation_aggregate_events where command_id in ('smoke-rollback-discount', 'smoke-rollback-cancel')) <> 2 then
    raise exception 'Discount/cancellation rollback retries did not commit one complete terminal history';
  end if;
  raise notice 'EVL-126 late discount/cancellation rollback and exact-ID retry checks passed';
end;
$$;

drop table smoke_before;
