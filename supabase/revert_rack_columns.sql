-- Revert per-player rack column optimization
-- Safe to run at any time against existing DB
-- These columns may exist from prior optimization attempts;
-- dropping them is safe since JSON state is the authoritative rack source.

-- 1. Drop update_player_rack RPC (client no longer calls this)
DROP FUNCTION IF EXISTS update_player_rack(text, text, text, text, int);

-- 2. Update create_game_state to remove rack params (client no longer passes them)
--    Keep columns rack_a/rack_b/rack_a_count/rack_b_count in schema;
--    they remain unused but dropping them is a separate schema migration.
CREATE OR REPLACE FUNCTION create_game_state(
  p_game_id text,
  p_app_key text,
  p_player_a_id text,
  p_player_b_id text,
  p_initial_state jsonb
) RETURNS boolean AS $$
DECLARE
  inserted_rows int;
BEGIN
  INSERT INTO games (
    id, app_key, player_a_id, player_b_id,
    state, version
  )
  VALUES (
    p_game_id, p_app_key, p_player_a_id, p_player_b_id,
    p_initial_state, 1
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = row_count;
  RETURN inserted_rows = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
