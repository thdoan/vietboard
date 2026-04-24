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
