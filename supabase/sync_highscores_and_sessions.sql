create or replace function sync_highscores_and_sessions(
  p_id text,
  p_scores jsonb,
  p_sessions jsonb,        -- array of {id, session_data}
  p_active_session_ids text[],
  p_app_key text
)
returns void
language plpgsql
security definer
as $$
begin
  if p_app_key != 'DECRYPTED_APP_KEY' then
    raise exception 'Invalid app_key';
  end if;
  -- Update the single highscores row
  insert into highscores (id, scores, app_key)
  values (p_id, p_scores, p_app_key)
  on conflict (id) do update set scores = excluded.scores;
  -- Upsert all active sessions
  insert into sessions (id, session_data, app_key)
  select x->>'id', x->>'session_data', p_app_key
  from jsonb_array_elements(p_sessions) as x
  on conflict (id) do update set session_data = excluded.session_data;
  -- Prune any session no longer referenced in the current top 100 per combo
  delete from sessions
  where id not in (select unnest(p_active_session_ids));
end;
$$;
