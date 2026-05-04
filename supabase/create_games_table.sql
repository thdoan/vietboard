-- Phase 1: Create games table for DB-as-SSOT architecture
-- Run this in Supabase SQL Editor

-- Create games table for authoritative multiplayer state
create table if not exists games (
  id text primary key,
  app_key text not null,
  player_a_id text not null,
  player_b_id text not null,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz default now()
);

-- Index for fast lookups
create index if not exists idx_games_app_key on games(app_key);
create index if not exists idx_games_updated_at on games(updated_at);

-- Enable RLS
alter table games enable row level security;

-- RLS: SELECT open to all (matches invites table pattern)
-- Writes are only allowed through security definer RPC functions which gate by app_key
create policy "Allow all reads" on games
  for select using (true);

-- Add to realtime publication
alter publication supabase_realtime add table games;

-- RPC: Optimistic concurrency control for game state updates
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

-- RPC: Create initial game state (idempotent - only creates if not exists)
create or replace function create_game_state(
  p_game_id text,
  p_app_key text,
  p_player_a_id text,
  p_player_b_id text,
  p_initial_state jsonb
) returns boolean as $$
declare
  inserted_rows int;
begin
  insert into games (id, app_key, player_a_id, player_b_id, state, version)
  values (p_game_id, p_app_key, p_player_a_id, p_player_b_id, p_initial_state, 1)
  on conflict (id) do nothing;
  
  get diagnostics inserted_rows = row_count;
  return inserted_rows = 1;
end;
$$ language plpgsql security definer;

-- RPC: Get game state by ID
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

-- RPC: Delete game state by ID (gated by app_key)
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

-- RPC: Delete stale games (call from client periodically or manually)
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
