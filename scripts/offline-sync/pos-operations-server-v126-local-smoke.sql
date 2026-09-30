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
    ) then
    raise exception 'Authenticated RPC grants are missing';
  end if;
  if pg_catalog.has_function_privilege(
      'anon', 'public.append_pos_operation_v1(jsonb,uuid,text)', 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon', 'public.read_pos_open_orders_v1(uuid,text,bigint,integer)', 'EXECUTE'
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
  v_stale jsonb;
  v_stale_rejected boolean := false;
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

  raise notice 'EVL-126 PostgreSQL order, retry, PT409 conflict, exact keys, timestamps, and read checks passed';
end;
$$;

reset role;

do $$
begin
  if (select last_sequence from pos_private.pos_operation_branch_sequences where branch_id = 'evl126-smoke') <> 2
    or (select revision from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'smoke-order') <> 2
    or (select last_sequence from pos_private.pos_operation_aggregate_heads where branch_id = 'evl126-smoke' and aggregate_id = 'smoke-order') <> 2
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

drop table smoke_before;
