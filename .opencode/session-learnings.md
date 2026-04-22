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

## Testing Notes

- Lobby tests (`npm test`) can be flaky due to shared Supabase presence state.
- Use `node test/multiplayer.reveal.test.js` for board sync tests.
- Manual verification often needed for visual issues (tile colors, animations).