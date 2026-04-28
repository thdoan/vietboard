# Session Learnings

## Key Design Decisions

### g_boardtypes is perspective-relative
- `g_boardtypes[x][y]` stores **who placed the tile from each player's perspective**:
  - `1` = my tiles (green/t1)
  - `2` = opponent tiles (red/t2)
- This means Player A sees their tiles as type 1, Player B sees them as type 2.
- **Bug risk**: Transmitting `boardt` wholesale in multiplayer caused color mismatches. The fix: don't transmit it; each screen tracks types locally.

### Ghost tile cleanup pattern
- Ghost tiles (`div#mp-drag-ghost`) can persist if `drag.end` broadcast is dropped.
- Solution: `cleanupDragGhosts()` helper that:
  1. Removes tracked `g_dragGhost`
  2. Sweeps `document.querySelectorAll('.mp-ghost')` for orphans
- Called from: local drop events, remote move processing, drag-end broadcasts.

### Rack mirroring in multiplayer
- Players face each other across the board.
- Opponent rack is mirrored horizontally: logical index `i` → physical cell `op(racksize-1-i)`.
- Affected functions: `setLetters()`, `getOpponentRack()`, `playOpponentMove()` (via `getOppCellId()`).
- Single-player is untouched.

### Move animation is SP-only
- `placeOnBoard()` → `playOpponentMove()` animates tiles flying from rack to board.
- In multiplayer, opponent's rack shows blank backs → animation looks broken.
- Fix: In `handleMoveBroadcast`, skip `placeOnBoard` and render directly when `g_isMultiplayer`.

### Space vs Blank tiles
- `' '` (space): 10 points, represents word separator in Vietnamese Scrabble
- `'*'` (blank/joker): 0 points, wildcard that can substitute any letter

## Common Bug Patterns

1. **Perspective-relative state transmitted as absolute**: Always check if a state variable is perspective-dependent before broadcasting.
2. **Ghost tiles from dropped broadcasts**: Always clean up in multiple places (drop, move, end).
3. **Single-player logic leaking into multiplayer**: Gate changes on `g_isMultiplayer`.
4. **Disable logic only on local move, not remote**: The layout dropdown (`bonuseslayout`) and level links were disabled after the local player's move (`onPlayerMove`/`onMultiplayerMove`) but NOT when receiving an opponent's move via `handleMoveBroadcast` or `handleGameStateBroadcast`. Always mirror disable/enable UI state in both local-action and remote-payload handlers.
5. **CSS rgb() vs hex for inline style comparison**: `element.style.backgroundColor` returns computed rgb() format (e.g. `rgb(131, 191, 231)`), not hex. When checking for stuck hover colors, compare against both forms.
6. **Async UI handlers need re-entrancy guards**: `loadHighScore()` is async and triggered from an `<a tabindex="1">` onclick. Firefox mobile synthesizes a click after touch, causing double invocation. Guard with a flag (`g_loadingHighScore`) at function entry.
7. **Supabase `.single()` throws PGRST116 for 0 rows**: Use `.maybeSingle()` when querying sessions that may not exist (e.g., backfilled IDs never upserted to Supabase). Returns `null` gracefully instead of HTTP 406.
8. **Backfill migrations must sync to both localStorage AND Supabase**: The original backfill generated `sessionId` locally but never wrote to the `sessions` table. This caused cloud replay to fail on any device/browser that lost the full `entry.session` JSON (Firefox Android is stricter with localStorage eviction). Always upsert backfilled data to Supabase.
9. **Toast deduplication prevents visual stacking**: When showing sequential toasts (e.g., "Loading..." → "Unable to load session"), reuse the visible toast `<div>` instead of creating a new one. Check `container.querySelector('.toast-message.show')`, update `textContent`, clear the old timeout, and set a new one.
10. **Beware `|| ''` on optional data that controls sync logic**: In `mergeGlobalHighScores()`, `session: item.session || ''` turned `undefined` (no session from Supabase) into `''` (empty string). Later, `saveGlobalHighScores()` checks `if (item.session)` to decide whether to sync to the `sessions` table. An empty string is falsy, so once merged, the session was permanently blocked from syncing. **Fix**: Use `|| undefined` to preserve the distinction between "no data" and "empty data".
11. **Stale remote names in high scores not propagating**: When merging global high scores, entries were deduplicated by `(playerId || name) + '|' + score`. Local entries (with old names) appeared first in the combined list, so the dedupe skip blocked remote entries with updated names. **Fix**: In `mergeGlobalHighScores()`, when encountering duplicates, update the existing entry's name to the remote version unless the entry belongs to the current user (protect local renames). Also dedupe by `sessionId + '|' + score` as a fallback key.
12. **Opponent name resolution in renderHighScoreRows uses stale local state**: Previously added logic to resolve opponent names using `g_opponentName` from the current game state. But this value is set at game start and never updates when the opponent renames, causing it to overwrite fresh names from the database with stale local data. **Fix**: Remove the runtime override; rely on `mergeGlobalHighScores()` to propagate the correct name.

## Testing Notes

- Lobby tests (`npm test`) can be flaky due to shared Supabase presence state.
- Use `node test/multiplayer.reveal.test.js` for board sync tests.
- Manual verification often needed for visual issues (tile colors, animations).