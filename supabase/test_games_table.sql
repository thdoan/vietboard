-- Test queries to run in Supabase SQL Editor
-- after running create_games_table.sql

-- 1. Verify table exists
SELECT * FROM games LIMIT 1;

-- 2. Verify RPC functions exist
SELECT proname, proargnames, prorettype::regtype
FROM pg_proc
WHERE proname IN ('update_game_state', 'create_game_state', 'delete_game_state', 'cleanup_stale_games')
ORDER BY proname;

-- 3. Verify realtime publication
SELECT * FROM pg_publication_tables WHERE tablename = 'games';

-- 4. Verify RLS is enabled
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'games';

-- 5. Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies WHERE tablename = 'games';
