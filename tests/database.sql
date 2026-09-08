-- Optional hosted SQL Editor assertions. Run after 001_heartping.sql.
-- Everything, including test data and test changes, is rolled back.
begin;
do $$
declare
  a text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  b text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  c text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  result jsonb;
  a_code text;
  i integer;
begin
  if has_function_privilege('anon', 'public.heartping_api(text,text,jsonb,boolean)', 'execute') or
     has_function_privilege('authenticated', 'public.heartping_api(text,text,jsonb,boolean)', 'execute') or
     not has_function_privilege('service_role', 'public.heartping_api(text,text,jsonb,boolean)', 'execute') then
    raise exception 'Unexpected RPC permissions';
  end if;
  if has_table_privilege('anon', 'heartping_private.users', 'select') or
     has_table_privilege('authenticated', 'heartping_private.events', 'select') then
    raise exception 'Unexpected table permissions';
  end if;
  result := public.heartping_api('session', a, '{"name":"SQL test A"}', true);
  a_code := result->'data'->>'myCode';
  perform public.heartping_api('session', b, '{"name":"SQL test B"}', true);
  perform public.heartping_api('session', c, '{"name":"SQL test C"}', true);
  update heartping_private.pairing_codes set expires_at = now() - interval '1 day' where user_id = a;
  result := public.heartping_api('join', b, jsonb_build_object('code', a_code));
  if (result->>'status')::int <> 404 then raise exception 'Expired code accepted'; end if;
  result := public.heartping_api('session', a, '{"name":"SQL test A"}');
  if result->'data'->>'myCode' = a_code then raise exception 'Expired code not rotated'; end if;
  a_code := result->'data'->>'myCode';
  result := public.heartping_api('join', b, jsonb_build_object('code', a_code));
  if (result->>'status')::int <> 200 then raise exception 'Join failed'; end if;
  result := public.heartping_api('join', c, jsonb_build_object('code', a_code));
  if (result->>'status')::int <> 409 then raise exception 'Occupied pair accepted'; end if;
  perform public.heartping_api('ping', a, '{"id":"sql-test-ping-000001"}');
  perform public.heartping_api('ping', a, '{"id":"sql-test-ping-000001"}');
  result := public.heartping_api('state', b);
  if jsonb_array_length(result->'data'->'history') <> 1 then raise exception 'Duplicate ping'; end if;
  perform public.heartping_api('history/clear', a);
  perform public.heartping_api('ping', a, '{"id":"sql-test-ping-000001"}');
  result := public.heartping_api('state', a);
  if jsonb_array_length(result->'data'->'history') <> 0 then raise exception 'Retry repopulated cleared history'; end if;
  result := public.heartping_api('state', b);
  if jsonb_array_length(result->'data'->'history') <> 1 then raise exception 'Clear affected partner'; end if;
  for i in 1..205 loop
    perform public.heartping_api('ping', a, jsonb_build_object('id', lpad(i::text, 16, '0')));
  end loop;
  result := public.heartping_api('state', b);
  if jsonb_array_length(result->'data'->'history') <> 100 then raise exception 'Unbounded history'; end if;
  if (select count(*) from heartping_private.events where sender_id = a and dedupe) <> 200 then
    raise exception 'Incorrect retry retention';
  end if;
  begin
    perform public.heartping_api('unpair', a);
    raise exception using errcode = 'HP001', message = 'Intentional transaction failure';
  exception when sqlstate 'HP001' then null;
  end;
  result := public.heartping_api('state', a);
  if not (result->'data'->>'isPaired')::boolean or result->'data'->>'myCode' <> a_code then
    raise exception 'Failed transaction changed pairing/code';
  end if;
  perform public.heartping_api('unpair', a);
  result := public.heartping_api('state', b);
  if (result->'data'->>'isPaired')::boolean or jsonb_array_length(result->'data'->'history') <> 0 then
    raise exception 'Unpair did not clear both sides';
  end if;
  raise notice 'PASS: SQL permissions, expiry, pairing, retries, history limits and rollback';
end;
$$;
rollback;
