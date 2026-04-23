# Project Conventions

## Supabase High Scores

### Schema
- Single row with `id = 'vietboard'`
- `scores` column stores a JSON object: `{ "Level Layout": [{ playerId, player, score, session, date }] }`

### Security
- Use XOR-obfuscated app_key for RLS write policies
- Obfuscation pattern in `src/multiplayer.js`:
  ```js
  const _hk = '\x...'; // XOR-obfuscated key
  function _dk(s) { /* XOR with 0xAB */ return r; }
  ```
- RLS policies require `app_key = '...'` for INSERT/UPDATE

### Score Entry Fields
| Field | Type | Description |
|-------|------|-------------|
| playerId | string | User ID or 'computer' |
| player | string | Display name |
| score | number | Points |
| session | string | Serialized game state (not persisted to Supabase) |
| date | string | ISO timestamp |

### Limits
- Max 100 scores per Level-Layout combination
- Apply `.slice(0, 100)` after sorting in both local and merged scores

### Date Formatting
- Store as ISO string in `date` field
- Display as `"Jul 7, 2026"` using `toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })`

## Player Names

- Max length: 32 characters (enforce in both UI and code)
- Always persist a real fallback immediately — never use temporary placeholders like "Generating..."
- On async nickname resolution, rename existing high score entries before re-syncing

## Translation Keys
- Add new keys to `lang/vi_translate.js` alphabetically
- Keys used in UI: `'Rank'`, `'Player'`, `'Score'`, `'Date'`

## Testing
- `npm test` runs `test/multiplayer.test.js`
- Puppeteer tests can be flaky due to timing; check for 32-char limit when testing name changes