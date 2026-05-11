-- Migration: Fix rack_count constraint in update_player_state
-- The game uses g_racksize=8 but the SQL function rejects rack_count > 7.
-- This causes ALL multiplayer state saves to silently fail when a player has a full rack.
-- Run this in the Supabase SQL Editor.

create or replace function update_player_state(
  p_app_key text,
  p_game_id text,
  p_player_id text,
  p_rack text,
  p_rack_count int,
  p_preview jsonb
) returns boolean as $$
declare
  updated_rows int;
  game_row games%rowtype;
begin
  if p_rack_count < 0 or p_rack_count > 8 then
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
        preview_a = p_preview,
        updated_at = now()
    where id = p_game_id
      and app_key = p_app_key;
  elsif game_row.player_b_id = p_player_id then
    update games
    set rack_b = p_rack,
        rack_b_count = p_rack_count,
        preview_b = p_preview,
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
