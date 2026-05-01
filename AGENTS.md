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
- **`invites`** — persistent invite queue for lobby matchmaking. Schema:
  ```sql
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
  ```
  **Indexes:** `idx_invites_to_status`, `idx_invites_from_status`, `idx_invites_game`
  **RLS:** SELECT open to all; upsert gated by `app_key`.
  **Realtime:** `alter publication supabase_realtime add table invites;` — required for live invite delivery.
  **Required SQL on fresh DB:**
  ```sql
  alter table invites add column if not exists to_name text;
  alter publication supabase_realtime add table invites;
  ```

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
The lobby follows a chess.com-style model where anyone who visits the page is online, and anyone not currently in an MP game is available to be invited:
- **Auto-subscribe on page load** — all players subscribe to the lobby presence channel in the background via `joinLobbyChannel()` on `window.onload`, regardless of whether the lobby modal is open.
- **Badge count (modal closed)** — uses Supabase presence as a fast approximate hint.
- **Badge count (modal open)** — exact count from DB-backed lobby list. Always matches the rendered player list.
- **Lobby availability (DB source of truth)** — `refreshPlayersInGames()` queries the `invites` table for all `started`/`accepted` rows (global, not scoped to current user) and builds `g_playersInGames`. `getMergedLobbyState()` filters these IDs from presence state. Refreshes on modal open, `presence.sync`, invite INSERT/UPDATE/DELETE, and every 15s while modal is open.
- **Toast notifications** — fires when a new player joins the lobby, unless the current player is already in an MP game. A 5-second grace period after `joinLobbyChannel()` starts suppresses all join toasts during initial subscription churn. This is UX smoothing, not correctness.

### Invite Queue System
The invite system replaces the old broadcast-based invites with a persistent Supabase `invites` table + Realtime subscriptions.

**Client state:**
- `g_pendingInvites` — `gameId -> {from_id, from_name, created_at}` for incoming invites.
- `g_myInvites` — `gameId -> {to_id, to_name, sent_at}` for outgoing invites.
- `g_inviteSub` — Realtime channel listening for INSERT/UPDATE/**DELETE** on `to_id=eq.me`.
- `g_myInviteSub` — Realtime channel listening for UPDATE on `from_id=eq.me` with `status='accepted'`.

**Invite lifecycle:**
1. **Send:** `sendInvite(opponentId, opponentName)` checks for existing pending invites, inserts a row with `status='pending'`, and stores in `g_myInvites`.
2. **Receive:** Realtime INSERT on recipient's `g_inviteSub` populates `g_pendingInvites` and shows toast: `"<name> has invited you to play! Go to lobby to accept"`.
3. **Accept:** `acceptInvite(gameId)` first **re-queries the DB** to verify the invite is still `pending`, then updates it to `status='accepted'`. Uses the DB row as source of truth for `from_id`/`from_name`. Starts the game as non-host.
4. **Auto-start (inviter):** Realtime UPDATE on `g_myInviteSub` triggers `startMultiplayerGame()` as host.
5. **Auto-decline:** When a player starts an MP game, `startMultiplayerGame()` calls `cancelMyInvites()`, which **hard-deletes** all pending outgoing invites (no soft-delete accumulation).
6. **Invite deleted:** Realtime DELETE on recipient's `g_inviteSub` removes the invite from `g_pendingInvites` immediately. The Accept button disappears without waiting for a page reload.
7. **Cleanup:** `cleanupStaleInvites(currentGameId)` hard-deletes any `started`/`accepted`/`cancelled` invite rows (global, not scoped to current user). Called from `startMultiplayerGame()` (rematch/crash recovery) and `reconcileInvites()` (page-load safety net).
8. **Unload purge:** `beforeunload`/`pagehide` delete the invite row for the active game so tab closure doesn't leave stale `started` rows.

**Key rules:**
- SP game start does NOT cancel invites; MP game start DOES.
- There is no manual Cancel button. Pending invites are hard-deleted on game start.
- `reconcileInvites()` queries the DB on page load to restore missed invites and also checks for `status='accepted'` outgoing invites to auto-start as host after a reload.
- All Supabase invite operations (insert, update, delete) must include `app_key` for RLS policy validation.

**Critical implementation notes:**
- NEVER call `g_bui.restart()` during MP game initialization (`initializeHostGame`, `handleGameStateBroadcast type='init'`). The `restart()` method unconditionally calls `cleanupMultiplayerSession()` when `g_isMultiplayer === true`, destroying the active game channel. Instead, use direct `init('board')` + explicitly set `g_isMultiplayer = true` afterward.
- Stale invite rows are prevented by: (1) `cleanupStaleInvites()` purging old `started`/`accepted`/`cancelled` rows globally on game start and page load, (2) `deleteGameInvite()` called on game end and page unload, (3) 5-minute freshness guard in `reconcileInvites()` for accepted invites.
- Stale `pending` invites can cause phantom Accept buttons. Mitigate with 24-hour TTL in `reconcileInvites()` — pending invites older than 24h are skipped and not added to `g_pendingInvites`/`g_myInvites`.
- Always validate session data before resuming (e.g., check `opponentName` is not null/empty) to reject corrupted sessions from buggy prior runs.
- When fixing bugs that affect game initialization, clear localStorage and delete stale Supabase invite rows before testing.
- **DB is the source of truth for lobby availability.** Presence is advisory only. `refreshPlayersInGames()` queries all `started`/`accepted` invites globally and filters them from the lobby list. This prevents players in active games from appearing as inviteable.
- **Broadcast is advisory transport.** Critical state (invites, game init) must be confirmed via DB queries or handshake ACKs. Never rely on a single broadcast for correctness.

### Session Persistence
Multiplayer sessions use `localStorage['session_mp']` for persistence, while single-player uses `localStorage['session']`. Key patterns:
- **Session mode tracking:** `localStorage['session_mode']` is `'mp'` or `'sp'`, but do not rely on it alone for resume decisions — always check for valid `session_mp` first.
- **On-load priority:** In `window.onload` (`src/events.js`), parse `session_mp` directly and check for valid `gameId` and `!isGameOver` before falling back to SP or fresh start.
- **Periodic auto-save:** Use a 30-second interval (`g_mpAutoSaveTimer`) to keep `session_mp` fresh for mobile scenarios where visibility events may not fire reliably.
- **Lifecycle events:** Handle `visibilitychange` (tab hide/visible), `pagehide` (beforeunload alternative for mobile), `beforeunload` (explicit unload), and `pageshow` (bfcache restore).
- **Skip identical saves:** In `saveMultiplayerSession()`, compare serialized JSON before writing to reduce disk I/O.
- **Resume connection watchdog:** After re-joining a game channel on resume, use a timer to show user feedback if connection is slow (toast at 5s, prompt at 20s).

### Game Init Handshake
To avoid the race condition where the host broadcasts `init` before the guest is subscribed, a bidirectional `hello → init` protocol is used:

- **Both players**: On `SUBSCRIBED`, broadcast `{type: 'hello', gameId, fromId, role}`.
- **Guest** (non-host): Starts a retry timer (5s × 3 attempts = 15s max). On each tick, broadcasts `{type: 'request_init', gameId, fromId}` if `init` not yet received.
- **Host**: On receiving `hello` from guest, calls `initializeHostGame()` once, caches `g_cachedInitPayload`, and broadcasts `init`. Also handles `request_init` by initializing on-demand if not yet done, or re-broadcasting cached `init` if already initialized.
- **Guest**: On receiving `init`, validates `gameId`, checks `initId` not seen, clears retry timer, applies game state, and broadcasts `{type: 'init_ack'}`.
- **Give-up**: After 3 retries, guest shows "Connection failed" toast, sends `{type: 'connection_failed'}`, deletes the invite row, and returns to SP. Host receiving `connection_failed` does the same.
- The init payload includes: `gameId`, `initId`, `letpool`, `myRack`, `oppRack`, `hostGoesFirst`, `stateVersion`.
- `g_cachedInitPayload`, `g_seenInitIds`, `g_initTimeout`, `g_initRetryTimer`, and `g_initRetryCount` are cleared during `cleanupMultiplayerSession()`, rematch, and channel teardown.

### Multiplayer Rematch
- After a natural game-over (empty rack or max passes), the game enters a **post-game state** for `g_wait_mp_rematch` ms (default 60s).
- In post-game state, the game channel stays alive and `cleanupMultiplayerSession()` is deferred.
- Clicking **Play Again** calls `initiateRematch()`:
  - Deterministic host = lexicographically smaller `playerId`.
  - **Host only**: generates a new `gameId`, broadcasts `rematch` event, calls `startMultiplayerGame()`.
  - **Non-host**: waits for host's `rematch` broadcast (or joins immediately if already received).
- Both players subscribe to the new game channel and run the `ready` → `init` → `init_ack` handshake.
- Forfeit / disconnect / inactivity still call `cleanupMultiplayerSession()` immediately (no rematch offered).
- Key state variables: `g_postGameTimer`, `g_myRematchGameId`, `enterPostGameState()`, `leavePostGameState()`, `initiateRematch()`.
