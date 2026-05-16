-- This script does the following:
-- - Iterates every key in p_scores
-- - For each array, keeps only entries with a score field, orders by score descending, and limits to 100
-- - Rebuilds the JSONB object with trimmed arrays
-- - Upserts the trimmed highscores row
-- - Inserts missing active sessions without overwriting existing session_data
-- - Prunes orphaned sessions based on the server-trimmed top 100 scores
create or replace function sync_highscores_and_sessions(
  p_id text,
  p_scores jsonb,
  p_sessions jsonb,            -- array of {id, session_data}
  p_active_session_ids text[], -- kept for backward compatibility; pruning is derived server-side
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
  if p_app_key != 'DECRYPTED_APP_KEY' then
    raise exception 'Invalid app_key';
  end if;

  -- Trim each score array to top 100 scored entries per Layout-Level combo.
  -- Keep the existing score semantics: entries only need a score field, and
  -- invalid score values fail loudly instead of being silently dropped.
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

  -- Upsert trimmed highscores.
  insert into highscores (id, scores, app_key)
  values (p_id, v_trimmed_scores, p_app_key)
  on conflict (id) do update set scores = excluded.scores;

  -- Insert missing sessions only. Never overwrite existing session_data.
  -- Coalescing p_sessions is safe here because an empty session payload should
  -- not block score syncing.
  insert into sessions (id, session_data, app_key)
  select x->>'id', x->>'session_data', p_app_key
  from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) as x
  where x ? 'id'
    and x ? 'session_data'
    and x->>'id' <> ''
    and x->>'session_data' <> ''
  on conflict (id) do nothing;

  -- Prune sessions no longer referenced by the server-trimmed top 100.
  -- Derive this from v_trimmed_scores instead of trusting client-provided
  -- p_active_session_ids.
  delete from sessions s
  where s.app_key = p_app_key
    and not exists (
      select 1
      from jsonb_each(v_trimmed_scores) as score_group(key, arr)
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(score_group.arr) = 'array' then score_group.arr
          else '[]'::jsonb
        end
      ) as score_item(item)
      where score_item.item->>'sessionId' = s.id
    );
end;
$$;
