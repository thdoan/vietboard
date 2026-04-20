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
The project can be run by opening `index.html` directly in a modern web browser.

### Testing
End-to-end tests are implemented using Puppeteer.
```bash
npm test
```

### Build Process (Windows)
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
