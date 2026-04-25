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
declare
  v_trimmed_scores jsonb := '{}'::jsonb;
  v_key text;
  v_arr jsonb;
  v_trimmed_arr jsonb;
begin
  if p_app_key != 'THE_DECRYPTED_APP_KEY_VALUE' then
    raise exception 'Invalid app_key';
  end if;

  -- Trim each score array to top 100 scored entries per Layout-Level combo
  for v_key, v_arr in select * from jsonb_each(p_scores)
  loop
    if jsonb_typeof(v_arr) = 'array' then
      select jsonb_agg(item)
      into v_trimmed_arr
      from (
        select item
        from jsonb_array_elements(v_arr) as item
        where item ? 'score'
        order by (item->>'score')::numeric desc
        limit 100
      ) sub;

      v_trimmed_scores := v_trimmed_scores || jsonb_build_object(v_key, COALESCE(v_trimmed_arr, '[]'::jsonb));
    else
      v_trimmed_scores := v_trimmed_scores || jsonb_build_object(v_key, v_arr);
    end if;
  end loop;

  -- Upsert trimmed highscores
  insert into highscores (id, scores, app_key)
  values (p_id, v_trimmed_scores, p_app_key)
  on conflict (id) do update set scores = excluded.scores;

  -- Upsert all active sessions
  insert into sessions (id, session_data, app_key)
  select x->>'id', x->>'session_data', p_app_key
  from jsonb_array_elements(p_sessions) as x
  on conflict (id) do update set session_data = excluded.session_data;

  -- Prune sessions no longer referenced in the current top 100
  delete from sessions
  where id not in (select unnest(p_active_session_ids));
end;
$$;
