-- Invite queue table for multiplayer lobby
-- Replaces in-memory invite queues with persistent, real-time backed invites
create table invites (
  id text primary key default gen_random_uuid()::text,
  from_id text not null,
  to_id text not null,
  game_id text not null,
  from_name text not null,
  to_name text,
  status text not null default 'pending',
  app_key text not null,
  created_at timestamptz default now(),
  unique(from_id, to_id, game_id)
);

create index idx_invites_to_status on invites(to_id, status);
create index idx_invites_from_status on invites(from_id, status);
create index idx_invites_game on invites(game_id);

alter table invites enable row level security;

create policy "Allow select invites"
  on invites for select
  using (true);

create policy "Allow upsert invites"
  on invites for all
  using (app_key = 'DECRYPTED_APP_KEY')
  with check (app_key = 'DECRYPTED_APP_KEY');

-- Enable realtime for this table
alter publication supabase_realtime add table invites;

-- Weekly cleanup of old non-pending invites (run manually or via pg_cron)
-- delete from invites
-- where status != 'pending'
--   and created_at < now() - interval '7 days';
