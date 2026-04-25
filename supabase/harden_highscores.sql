-- Harden highscores table security and add app_key column
-- Run this in the Supabase SQL Editor

-- 1. Add app_key column (idempotent)
ALTER TABLE highscores ADD COLUMN IF NOT EXISTS app_key TEXT;

-- 2. Set the secret on the existing row
UPDATE highscores
SET app_key = 'DECRYPTED_APP_KEY'
WHERE id = 'vietboard';

-- 3. Drop old permissive policies
DROP POLICY IF EXISTS "Allow inserts only" ON highscores;
DROP POLICY IF EXISTS "Allow public read" ON highscores;
DROP POLICY IF EXISTS "Allow upsert" ON highscores;

-- 4. Create hardened policies
-- Anyone can read
CREATE POLICY "Allow public read"
  ON highscores FOR SELECT
  TO public USING (true);

-- Only inserts that provide the correct app_key
CREATE POLICY "Allow insert with app key"
  ON highscores FOR INSERT
  TO public WITH CHECK (app_key = 'DECRYPTED_APP_KEY');

-- Only updates that provide the correct app_key
CREATE POLICY "Allow update with app key"
  ON highscores FOR UPDATE
  TO public USING (app_key = 'DECRYPTED_APP_KEY')
  WITH CHECK (app_key = 'DECRYPTED_APP_KEY');
