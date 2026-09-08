-- Run once in the Supabase SQL Editor. All durable state lives in Postgres.
begin;

create schema if not exists heartping_private;
revoke all on schema heartping_private from public, anon, authenticated;

create table heartping_private.pairs (
  id uuid primary key default gen_random_uuid()
);
create table heartping_private.users (
  id text primary key check (id ~ '^[a-f0-9]{64}$'), -- SHA-256 of the session token
  name text not null check (char_length(name) between 1 and 24),
  pair_id uuid references heartping_private.pairs(id)
);
create index users_pair on heartping_private.users(pair_id);
create table heartping_private.pairing_codes (
  user_id text primary key references heartping_private.users(id) on delete cascade,
  code text not null unique check (code ~ '^[1-9][0-9]{5}$'),
  expires_at timestamptz not null
);
create table heartping_private.events (
  sequence bigint generated always as identity primary key,
  sender_id text not null references heartping_private.users(id) on delete cascade,
  recipient_id text not null references heartping_private.users(id) on delete cascade,
  client_id text not null check (client_id ~ '^[a-zA-Z0-9_-]{16,80}$'),
  sender_name text not null,
  recipient_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  sender_visible boolean not null default true,
  recipient_visible boolean not null default true,
  dedupe boolean not null default true,
  check (sender_id <> recipient_id)
);
create unique index events_retry on heartping_private.events(sender_id, client_id) where dedupe;
create index events_sender on heartping_private.events(sender_id, sequence desc);
create index events_recipient on heartping_private.events(recipient_id, sequence desc);

alter table heartping_private.users enable row level security;
alter table heartping_private.pairs enable row level security;
alter table heartping_private.pairing_codes enable row level security;
alter table heartping_private.events enable row level security;
revoke all on all tables in schema heartping_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema heartping_private from public, anon, authenticated, service_role;

create function heartping_private.rotate_code(p_user text) returns void
language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  loop
    candidate := (100000 + (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 900000))::text;
    exit when not exists (select 1 from heartping_private.pairing_codes where code = candidate);
  end loop;
  insert into heartping_private.pairing_codes(user_id, code, expires_at)
    values (p_user, candidate, clock_timestamp() + interval '24 hours')
    on conflict (user_id) do update set code = excluded.code, expires_at = excluded.expires_at;
end;
$$;

create function heartping_private.snapshot(p_user text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'myName', u.name, 'myCode', c.code,
    'codeExpiresAt', floor(extract(epoch from c.expires_at) * 1000)::bigint,
    'partnerName', coalesce(p.name, ''), 'partnerCode', coalesce(pc.code, ''),
    'isPaired', p.id is not null,
    'history', coalesce((select jsonb_agg(h.item order by h.sequence desc) from (
      select e.sequence, jsonb_build_object('id', e.client_id, 'sender', e.sender_name,
        'receiver', e.recipient_name, 'timestamp', floor(extract(epoch from e.created_at) * 1000)::bigint,
        'type', case when e.sender_id = u.id then 'sent' else 'received' end) as item
      from heartping_private.events e
      where (e.sender_id = u.id and e.sender_visible) or (e.recipient_id = u.id and e.recipient_visible)
      order by e.sequence desc limit 100
    ) h), '[]'::jsonb))
  from heartping_private.users u
  join heartping_private.pairing_codes c on c.user_id = u.id
  left join heartping_private.users p on p.pair_id = u.pair_id and p.id <> u.id
  left join heartping_private.pairing_codes pc on pc.user_id = p.id
  where u.id = p_user;
$$;

-- The only exposed database entry point. Each request is one transaction;
-- a transaction-scoped lock serializes changes across all Node instances.
-- This deliberately favors correctness for a small couples app over throughput.
create function public.heartping_api(p_action text, p_user_id text, p_body jsonb default '{}'::jsonb,
  p_new_session boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u heartping_private.users%rowtype;
  partner heartping_private.users%rowtype;
  target_code heartping_private.pairing_codes%rowtype;
  pair uuid;
  member text;
begin
  perform pg_advisory_xact_lock(726483019);
  if p_action = 'health' then
    perform 1 from heartping_private.users limit 1;
    return jsonb_build_object('status', 200, 'data', jsonb_build_object('status', 'ok'));
  end if;
  if p_user_id is null or p_user_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 401, 'error', 'Your session has expired. Please enter your name again.');
  end if;
  select * into u from heartping_private.users where id = p_user_id;
  if p_action = 'session' then
    if jsonb_typeof(p_body->'name') is distinct from 'string' or length(btrim(p_body->>'name')) not between 1 and 24 then
      return jsonb_build_object('status', 400, 'error', 'Please enter a first name of 1–24 characters.');
    end if;
    if u.id is null and not p_new_session then
      return jsonb_build_object('status', 401, 'error', 'Your session has expired. Please enter your name again.');
    end if;
    if u.id is null then
      insert into heartping_private.users(id, name) values (p_user_id, btrim(p_body->>'name'));
      perform heartping_private.rotate_code(p_user_id);
    else
      update heartping_private.users set name = btrim(p_body->>'name') where id = p_user_id;
      if u.pair_id is null and (select expires_at < clock_timestamp() from heartping_private.pairing_codes where user_id = p_user_id) then
        perform heartping_private.rotate_code(p_user_id);
      end if;
    end if;
  else
    if u.id is null then
      return jsonb_build_object('status', 401, 'error', 'Your session has expired. Please enter your name again.');
    end if;
    if p_action = 'join' then
      if jsonb_typeof(p_body->'code') is distinct from 'string' or (p_body->>'code') !~ '^[0-9]{6}$' then
        return jsonb_build_object('status', 400, 'error', 'Enter a valid six-digit pairing code.');
      end if;
      select * into target_code from heartping_private.pairing_codes where code = p_body->>'code';
      if target_code.user_id = p_user_id then
        return jsonb_build_object('status', 400, 'error', 'Share your code with your partner; you cannot join yourself.');
      end if;
      if target_code.user_id is null or target_code.expires_at < clock_timestamp() then
        return jsonb_build_object('status', 404, 'error', 'That code was not found or has expired. Ask your partner for a new one.');
      end if;
      select * into partner from heartping_private.users where id = target_code.user_id;
      if u.pair_id is not null and u.pair_id = partner.pair_id then
        return jsonb_build_object('status', 200, 'data', heartping_private.snapshot(p_user_id));
      end if;
      if u.pair_id is not null or partner.pair_id is not null then
        return jsonb_build_object('status', 409, 'error', 'One of you is already paired. Unpair first.');
      end if;
      insert into heartping_private.pairs default values returning id into pair;
      update heartping_private.users set pair_id = pair where id in (p_user_id, partner.id);
      update heartping_private.events set sender_visible = false where sender_id in (p_user_id, partner.id);
      update heartping_private.events set recipient_visible = false where recipient_id in (p_user_id, partner.id);
    elsif p_action = 'ping' then
      select * into partner from heartping_private.users where pair_id = u.pair_id and id <> p_user_id;
      if partner.id is null then
        return jsonb_build_object('status', 409, 'error', 'Connect with your partner before sending a ping.');
      end if;
      if jsonb_typeof(p_body->'id') is distinct from 'string' or (p_body->>'id') !~ '^[a-zA-Z0-9_-]{16,80}$' then
        return jsonb_build_object('status', 400, 'error', 'Invalid ping identifier.');
      end if;
      if not exists (select 1 from heartping_private.events where sender_id = p_user_id and client_id = p_body->>'id' and dedupe) then
        insert into heartping_private.events(sender_id, recipient_id, client_id, sender_name, recipient_name)
          values (p_user_id, partner.id, p_body->>'id', u.name, partner.name);
        foreach member in array array[p_user_id, partner.id] loop
          with old as (select sequence from heartping_private.events
            where (sender_id = member and sender_visible) or (recipient_id = member and recipient_visible)
            order by sequence desc offset 100)
          update heartping_private.events e set
            sender_visible = case when e.sender_id = member then false else e.sender_visible end,
            recipient_visible = case when e.recipient_id = member then false else e.recipient_visible end
            where e.sequence in (select sequence from old);
        end loop;
        update heartping_private.events set dedupe = false where sequence in (
          select sequence from heartping_private.events where sender_id = p_user_id and dedupe order by sequence desc offset 200);
      end if;
    elsif p_action = 'unpair' then
      for member in select id from heartping_private.users where id = p_user_id or pair_id = u.pair_id loop
        update heartping_private.users set pair_id = null where id = member;
        perform heartping_private.rotate_code(member);
        update heartping_private.events set sender_visible = false where sender_id = member;
        update heartping_private.events set recipient_visible = false where recipient_id = member;
      end loop;
      delete from heartping_private.pairs where id = u.pair_id;
    elsif p_action = 'history/clear' then
      update heartping_private.events set sender_visible = false where sender_id = p_user_id;
      update heartping_private.events set recipient_visible = false where recipient_id = p_user_id;
    elsif p_action <> 'state' then
      return jsonb_build_object('status', 404, 'error', 'Endpoint not found.');
    end if;
  end if;
  if p_action <> 'state' then
    delete from heartping_private.events where not sender_visible and not recipient_visible and not dedupe;
  end if;
  return jsonb_build_object('status', 200, 'data', heartping_private.snapshot(p_user_id));
end;
$$;

revoke all on all functions in schema heartping_private from public, anon, authenticated, service_role;
revoke all on function public.heartping_api(text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.heartping_api(text, text, jsonb, boolean) to service_role;
notify pgrst, 'reload schema';
commit;
