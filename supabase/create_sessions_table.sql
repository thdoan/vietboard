create table sessions (
  id text primary key,
  session_data text not null,
  app_key text not null,
  created_at timestamptz default now()
);
alter table sessions enable row level security;
create policy "Allow read sessions" on sessions for select using (true);
create policy "Allow upsert sessions" on sessions
  for all using (app_key = 'DECRYPTED_APP_KEY');
