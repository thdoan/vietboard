-- Create games table for DB-as-SSOT architecture
-- Run this in Supabase SQL Editor
-- Safe to re-run against an existing games table (idempotent)

-- games.state JSONB schema includes:
--   board, boardPoints, boardTypes, boardEmpty, letpool,
--   player1Id, player2Id, player1Score, player2Score, player1LastScore, player2LastScore,
--   history, passes, turnNumber,
--   preview: {
--     player1: { "c3_4": {"letter":"a","points":1}, ... },
--     player2: { "c5_2": {"letter":"b","points":3}, ... }
--   }

-- 1. Create table (safe if already exists)
create table if not exists games (
  id text primary key,
  app_key text not null,
  player_a_id text not null,
  player_b_id text not null,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz default now()
);

-- 2. Add rack columns idempotently if table already existed without them
alter table games
  add column if not exists rack_a text,
  add column if not exists rack_b text,
  add column if not exists rack_a_count int,
  add column if not exists rack_b_count int;

-- 3. Indexes (idempotent)
create index if not exists idx_games_app_key on games(app_key);
create index if not exists idx_games_updated_at on games(updated_at);

-- 4. Enable RLS (idempotent)
alter table games enable row level security;

-- 5. Policy: SELECT open to all (idempotent)
-- Writes are only allowed through security definer RPC functions which gate by app_key
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'games'
      and policyname = 'Allow all reads'
  ) then
    create policy "Allow all reads" on games
      for select using (true);
  end if;
end $$;

-- 6. Add to realtime publication (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where schemaname = 'public'
      and tablename = 'games'
      and pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table games;
  end if;
end $$;

-- 7. RPC: Optimistic concurrency control for game state updates
create or replace function update_game_state(
  p_game_id text,
  p_app_key text,
  p_expected_version bigint,
  p_new_state jsonb
) returns boolean as $$
declare
  updated_rows int;
begin
  update games
  set state = p_new_state,
      version = p_expected_version + 1,
      updated_at = now()
  where id = p_game_id
    and app_key = p_app_key
    and version = p_expected_version;

  get diagnostics updated_rows = row_count;
  return updated_rows = 1;
end;
$$ language plpgsql security definer;

-- 8. RPC: Create initial game state (idempotent - only inserts if not exists)
create or replace function create_game_state(
  p_game_id text,
  p_app_key text,
  p_player_a_id text,
  p_player_b_id text,
  p_initial_state jsonb,
  p_rack_a text,
  p_rack_b text,
  p_rack_a_count int,
  p_rack_b_count int
) returns boolean as $$
declare
  inserted_rows int;
begin
  insert into games (
    id, app_key, player_a_id, player_b_id,
    state, version,
    rack_a, rack_b, rack_a_count, rack_b_count
  )
  values (
    p_game_id, p_app_key, p_player_a_id, p_player_b_id,
    p_initial_state, 1,
    p_rack_a, p_rack_b, p_rack_a_count, p_rack_b_count
  )
  on conflict (id) do nothing;

  get diagnostics inserted_rows = row_count;
  return inserted_rows = 1;
end;
$$ language plpgsql security definer;

-- 9. RPC: Get game state by ID
create or replace function get_game_state(p_game_id text)
returns jsonb as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'state', state,
    'version', version,
    'updated_at', updated_at
  ) into result
  from games
  where id = p_game_id;
  return result;
end;
$$ language plpgsql stable;

-- 10. RPC: Delete game state by ID (gated by app_key)
create or replace function delete_game_state(
  p_game_id text,
  p_app_key text
) returns boolean as $$
declare
  deleted_rows int;
begin
  delete from games
  where id = p_game_id
    and app_key = p_app_key;
  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$ language plpgsql security definer;

-- 11. RPC: Delete stale games (call from client periodically or manually)
-- Recommended: call cleanup_stale_games(24) from lobby load or hourly timer
create or replace function cleanup_stale_games(p_max_age_hours int default 24)
returns int as $$
declare
  deleted_count int;
begin
  delete from games
  where updated_at < now() - interval '1 hour' * p_max_age_hours;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$ language plpgsql security definer;

-- 12. RPC: Update player rack (server decides column from player_id match)
create or replace function update_player_rack(
  p_app_key text,
  p_game_id text,
  p_player_id text,
  p_rack text,
  p_rack_count int
) returns boolean as $$
declare
  updated_rows int;
  game_row games%rowtype;
begin
  if p_rack_count < 0 or p_rack_count > 7 then
    return false;
  end if;

  select * into game_row from games where id = p_game_id;
  if not found then
    return false;
  end if;

  if game_row.player_a_id = p_player_id then
    update games
    set rack_a = p_rack,
        rack_a_count = p_rack_count,
        updated_at = now()
    where id = p_game_id
      and app_key = p_app_key;
  elsif game_row.player_b_id = p_player_id then
    update games
    set rack_b = p_rack,
        rack_b_count = p_rack_count,
        updated_at = now()
    where id = p_game_id
      and app_key = p_app_key;
  else
    return false;
  end if;

  get diagnostics updated_rows = row_count;
  return updated_rows = 1;
end;
$$ language plpgsql security definer set search_path = public;
