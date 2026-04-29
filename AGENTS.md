# Vietboard - Vietnamese Scrabble Game

A high-performance Vietnamese Scrabble-style word game implemented in pure JavaScript. It features a fast AI engine leveraging regular expressions and supports both single-player (vs computer) and multiplayer modes.

## Tech Stack
- **Frontend:** Pure JavaScript (ES6+), HTML5, CSS3.
- **Libraries:**
  - [REDIPS.drag](https://github.com/dbunic/REDIPS_drag) for drag-and-drop functionality.
  - Supabase for multiplayer real-time communication and persistence.
- **Assets:** SVG/PNG icons, MP3 sound effects.
- **Backend:** Supabase (Real-time and Database).

## Architecture
The codebase is structured to separate game logic from the user interface:
- **`src/engine.js`**: The core game engine. Handles scoring, move validation, and AI logic using regular expressions for performance.
- **`src/ui.js`**: Manages the DOM, renders the board, handles user interactions, and provides feedback.
- **`src/multiplayer.js`**: Handles multiplayer logic, lobby management, and real-time state synchronization via Supabase.
- **`src/events.js`**: Global event listeners and coordination.
- **`lang/`**: Contains language-specific data and distributions:
  - `xx_letters.js`: Letter distribution and point values.
  - `xx_wordlist.js`: Word list for AI engine validation.
  - `xx_translate.js`: UI translation strings.

## Building and Running

### Development
The project can be run by opening `index.html` directly in a modern web browser. It can also be served via `http-server --cors -c-1` in WSL.

### Testing
End-to-end tests are implemented using Puppeteer.
```bash
npm test
```

### Build Process (Windows only)
A production build (minified and concatenated) can be generated using `build.bat`.
- **Requirements:**
  - [Microsoft Ajax Minifier](https://github.com/microsoft/ajaxmin)
  - [Find And Replace Text (FART)](https://github.com/lionello/fart-it)
- **Execution:**
  ```cmd
  build.bat
  ```
The build output is placed in the `play/` directory.

## Development Conventions
- **Global Variables:** Global state is used extensively, typically prefixed with `g_` (e.g., `g_board`, `g_letpool`).
- **Indentation:** 2 spaces.
- **Coding Style:** Pure JavaScript without heavy frameworks. Prioritizes performance and minimal dependencies.
- **Debug Mode:** Can be toggled via `const DEBUG = true;` in `src/engine.js` (automatically disabled during build).
- **Localization:** The system is designed to be easily localized by adding new files to the `lang/` directory.
- **Storage:** Uses `localStorage` for persisting sessions, high scores, and user preferences.
- **Mobile Detection:** Use `g_isMobile` (global boolean in `src/events.js`) to detect mobile form factor. Check with `typeof g_isMobile !== 'undefined' && g_isMobile` for safety.
- **Mobile Transitions:** When positioning elements over the board on mobile (e.g., emoji reactions), elements may be off-screen when the drawer is open. Use `transitionend` event on `#board` to wait for CSS transitions before calculating positions.
- **Rack Representation:** Empty rack cells are represented as `'.'` (dot), not empty string `''`. When checking for empty rack, use `rack.replace(/\./g, '') === ''` instead of `rack === ''`.
- **Dynamic CSS Updates:** When updating CSS dynamically (e.g., tileset, fonts), use separate `<style>` elements with unique IDs. Avoid concatenating multiple rules into one `textContent` update, as this wipes all other rules. See `index.html` for the pattern with `tileset-font-style` and `bonus-tiles-style`.
- **Data Loading Pattern:** Prefer loading small data via `<script>` tags (e.g., `lang/emojis.js` setting `window.g_emojis`) over `fetch()` for JSON. Script tags are synchronous and more reliable on mobile browsers where fetch can fail intermittently due to caching or battery-saving modes.

## Supabase Schema

The app uses two tables in Supabase:

- **`highscores`** — single row (`id='vietboard'`) storing all scores as a JSON blob. Schema: `{ id text PK, scores jsonb, app_key text }`.
- **`sessions`** — stores full game state for replay. Schema: `{ id text PK, session_data text, app_key text, created_at timestamptz }`.

An RPC function `sync_highscores_and_sessions` atomically upserts both tables and prunes orphaned sessions in a single call:

```sql
sync_highscores_and_sessions(p_id text, p_scores jsonb, p_sessions jsonb, p_active_session_ids text[], p_app_key text)
```

The `app_key` field uses a simple XOR obfuscation (`_dk`/`_hk` in `multiplayer.js`) for RLS policy validation.

### Session Replay
- Every session gets a unique `id` generated at game end via `getSession()` (`src/ui.js`).
- High score entries store both `session` (full JSON, local-only) and `sessionId` (lightweight key, synced globally).
- When a user clicks a high score from another device, `loadHighScore()` falls back to `loadSessionFromCloud()` if no local session exists.
- Fetched sessions are cached in `localStorage['cloud_sessions']` for instant replay on subsequent clicks.

### Return to Game (High Score Viewing)
When a user clicks a high score to view a replay, the current game state must be preserved to enable "Return to Game". This is handled via:
- **`session_return`** key in localStorage — set exactly once per viewing session (not the legacy `session` key used for SP).
- For multiplayer games, also call `saveMultiplayerSession()` to snapshot `session_mp` state.
- **`returnToGame()`** — helper function that loads from `session_return` (falling back to `session`), clears the key, and calls `updateTurnIndicator()` to restore button states.

### Player Name Syncing in High Scores
When a player renames, the change is synced to global high scores via three mechanisms:
1. **`updatePlayerName()`** - Updates local high score entries by matching either `playerId` (preferred) or the old fallback name.
2. **`mergeGlobalHighScores()`** - When loading global scores, uses both `playerId` and `sessionId` for deduplication, preferring the remote name for entries not belonging to the current user.
3. **`renderHighScoreRows()`** - Display format is `<name> (You)` for current user entries.

### Lobby Presence and Notifications
The lobby uses Supabase Realtime presence with metadata to track player activity:
- **`g_inLobbyModal`** — session variable (resets on page reload) that tracks whether the player has the lobby modal open
- **`inLobbyModal`** — presence metadata field: `true` when player opens lobby modal, `false` when closed, `undefined` for page-load-only subscribers
- **Auto-subscribe on page load** — players are subscribed to the lobby channel with `inLobbyModal: false` to receive presence updates
- **Badge count** — only counts players where `inLobbyModal !== false` (skips page-load subscribers who haven't opened lobby)
- **Toast notifications** — only fires when: (1) joining player has `inLobbyModal !== false`, (2) current player is not in MP game, (3) lobby modal is closed
- **Grace period** — `g_lobbySubscribedAt` timestamp prevents toasts for existing players within 2 seconds of subscribing
- **Design principle** — use presence metadata over broadcasts for cleaner implementation; presence state is inherently more reliable than custom broadcast events

### Session Persistence
Multiplayer sessions use `localStorage['session_mp']` for persistence, while single-player uses `localStorage['session']`. Key patterns:
- **Session mode tracking:** `localStorage['session_mode']` is `'mp'` or `'sp'`, but do not rely on it alone for resume decisions — always check for valid `session_mp` first.
- **On-load priority:** In `window.onload` (`src/events.js`), parse `session_mp` directly and check for valid `gameId` and `!isGameOver` before falling back to SP or fresh start.
- **Periodic auto-save:** Use a 30-second interval (`g_mpAutoSaveTimer`) to keep `session_mp` fresh for mobile scenarios where visibility events may not fire reliably.
- **Lifecycle events:** Handle `visibilitychange` (tab hide/visible), `pagehide` (beforeunload alternative for mobile), `beforeunload` (explicit unload), and `pageshow` (bfcache restore).
- **Skip identical saves:** In `saveMultiplayerSession()`, compare serialized JSON before writing to reduce disk I/O.
- **Resume connection watchdog:** After re-joining a game channel on resume, use a timer to show user feedback if connection is slow (toast at 5s, prompt at 20s).

### Multiplayer Rematch
- After a natural game-over (empty rack or max passes), the game enters a **post-game state** for `g_wait_mp_rematch` ms (default 60s).
- In post-game state, the game channel stays alive and `cleanupMultiplayerSession()` is deferred.
- Clicking **Play Again** calls `initiateRematch()` which:
  1. Generates a new `gameId`.
  2. Broadcasts a `rematch` event with the new `gameId` on the current game channel.
  3. Calls `startMultiplayerGame()` as host.
- The opponent receives the `rematch` broadcast and joins the same new game.
- If both click simultaneously, the lexicographically smaller `gameId` wins (deterministic tie-breaking via `g_myRematchGameId < payload.gameId`).
- Forfeit / disconnect / inactivity still call `cleanupMultiplayerSession()` immediately (no rematch offered).
- Key state variables: `g_postGameTimer`, `g_myRematchGameId`, `enterPostGameState()`, `leavePostGameState()`, `initiateRematch()`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
