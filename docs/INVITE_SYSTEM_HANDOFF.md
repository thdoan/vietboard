# Vietboard Invite Queue System — Session Handoff

## Status: Implemented, Awaiting Final Testing

## Database Schema

### Table: `invites` (Supabase)
```sql
create table invites (
  id text primary key default gen_random_uuid()::text,
  from_id text not null,        -- inviter's g_lobbyUserId
  to_id text not null,          -- recipient's g_lobbyUserId
  game_id text not null,        -- generated game ID
  from_name text not null,      -- inviter's display name at time of invite
  to_name text,                 -- recipient's display name (nullable, added later)
  status text not null default 'pending',
  app_key text not null,        -- RLS policy validation
  created_at timestamptz default now(),
  unique(from_id, to_id, game_id)
);
```

**Indexes:** `idx_invites_to_status`, `idx_invites_from_status`, `idx_invites_game`
**RLS:** Anyone can SELECT. Upsert requires `app_key` match.
**Realtime:** `alter publication supabase_realtime add table invites` — MUST be executed in Supabase.

### Required SQL to run on fresh DB:
```sql
alter table invites add column if not exists to_name text;
alter publication supabase_realtime add table invites;
```

## Architecture

### Source of Truth
- **Database** is the single source of truth for invites.
- **Realtime subscriptions** provide instant delivery.
- **Query reconciliation** (`reconcileInvites()`) catches missed events on load/reconnect.

### What Was Removed
- `g_inviteQueue` (old in-memory incoming queue)
- `g_outboundInvites` (old in-memory outgoing queue)
- `lobby_invite` broadcast handler
- `lobby_accept` broadcast handler
- `invitePlayer()` function

### What Replaced It
```javascript
let g_inviteSub = null;      // Realtime channel: 'invites_to_me'
let g_myInviteSub = null;    // Realtime channel: 'my_invites'
let g_pendingInvites = {};   // gameId -> {from_id, from_name, created_at}
let g_myInvites = {};        // gameId -> {to_id, to_name, sent_at}
```

## Invite Lifecycle

1. **Player A clicks Invite** → `sendInvite(opponentId, opponentName)`
   - Checks DB for existing pending invite to same player (prevents duplicates)
   - Inserts row: `status='pending'`
   - Stores in `g_myInvites[gameId]`
   - Re-renders lobby showing "Invited..."

2. **Player B receives invite** → Realtime INSERT on `to_id=eq.me`
   - Populates `g_pendingInvites[gameId]`
   - Shows toast: `"<name> has invited you to play! Go to lobby to accept"`
   - Re-renders lobby showing **Accept** button

3. **Player B clicks Accept** → `acceptInvite(gameId)`
   - Updates DB row: `status='accepted'`
   - Calls `startMultiplayerGame()` as **non-host** (`isHost=false`)

4. **Player A receives acceptance** → Realtime UPDATE on `from_id=eq.me` and `status='accepted'`
   - Calls `startMultiplayerGame()` as **host** (`isHost=true`)

5. **Game starts** → `startMultiplayerGame()` calls `cancelMyInvites()`
   - Updates all pending invites from this player to `status='cancelled'`
   - Prevents multiple simultaneous games

## Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `subscribeToInvites()` | `multiplayer.js` | Realtime sub for incoming invites (INSERT + UPDATE) |
| `subscribeToMyInvites()` | `multiplayer.js` | Realtime sub for accepted invites (UPDATE on my outgoing) |
| `reconcileInvites()` | `multiplayer.js` | Query DB on load/reconnect to catch missed invites |
| `sendInvite()` | `multiplayer.js` | Insert invite row, update local cache |
| `acceptInvite()` | `multiplayer.js` | Update row to accepted, start game as non-host |
| `cancelMyInvites()` | `multiplayer.js` | Cancel all pending invites from this player |
| `renderLobbyPlayers()` | `multiplayer.js` | Uses `g_pendingInvites`/`g_myInvites` to show Accept/Invited.../Invite buttons |

## Critical Gotchas

1. **Realtime publication is REQUIRED.** Without `alter publication supabase_realtime add table invites`, no events fire. The table can still be queried, but live delivery breaks.
2. **`to_name` column must exist.** Added via `alter table`. Used by `subscribeToMyInvites()` to pass opponent name to `startMultiplayerGame()`.
3. **`maybeSingle()` returns the row directly**, not `{data: row}`. Fixed in `sendInvite()` duplicate check: use `if (existing)` not `if (existing.data)`.
4. **Invite persists across reloads** because it's in the DB. `reconcileInvites()` restores local caches on load.
5. **SP game does NOT cancel invites.** Only MP game start does (via `cancelMyInvites()` in `startMultiplayerGame()`).
6. **No TTL / expiration.** Invites persist until accepted or inviter starts MP game.

## Files Modified

- `supabase/create_invites_table.sql` — new migration file
- `src/multiplayer.js` — complete invite system rewrite
- `src/events.js` — added `reconcileInvites()` call on page load

## Testing Checklist (For Next Session)

- [ ] Player A invites Player B while both in lobby → B sees toast and Accept button
- [ ] Player B reloads page → Accept button still visible (reconcile works)
- [ ] Player B clicks Accept → both start MP game
- [ ] Player A invites Player B, then A starts SP game → invite should persist
- [ ] Player A invites Player B, then A starts MP game with C → invite to B auto-cancelled
- [ ] Player A invites Player B, B's tab gets suspended → B reconnects and still sees Accept
- [ ] Only one toast ever fires: `"<name> has invited you to play! Go to lobby to accept"`

## How It's Supposed to Work (Detailed Flow)

### Happy Path: A invites B, B accepts

**Player A perspective:**
1. A opens lobby modal → `showLobby()` → `ensureLobbyConnection()` → `joinLobbyChannel()`
2. `joinLobbyChannel()` subscribes to lobby presence + `subscribeToInvites()` + `subscribeToMyInvites()` + `reconcileInvites()`
3. A clicks Invite on Player B row → `sendInvite('user_B', 'B_name')`
4. `sendInvite()` queries DB for existing pending invite to B → if none, inserts new row
5. Row inserted with `status='pending'`, `from_id=user_A`, `to_id=user_B`, `game_id=game_xyz`
6. `g_myInvites['game_xyz']` populated locally, lobby re-renders showing "Invited..." for B
7. A waits. Can close lobby modal, play SP, etc. Invite persists.
8. Realtime UPDATE fires on `from_id=eq.user_A` with `status='accepted'`
9. `subscribeToMyInvites()` callback triggers → `startMultiplayerGame('game_xyz', 'user_B', 'B_name', true)`
10. `startMultiplayerGame()` calls `cancelMyInvites()` → cancels all A's other pending invites
11. Game starts. Both players removed from lobby presence.

**Player B perspective:**
1. B has page open (lobby channel active via background subscription from page load)
2. Realtime INSERT fires on `to_id=eq.user_B` with new invite row
3. `subscribeToInvites()` callback triggers → `g_pendingInvites['game_xyz']` populated
4. Toast appears: `"A_name has invited you to play! Go to lobby to accept"`
5. B opens lobby → `renderLobbyPlayers()` sees `g_pendingInvites` → shows **Accept** button for A
6. B clicks Accept → `acceptInvite('game_xyz')`
7. `acceptInvite()` updates DB row `status='accepted'` where `game_id='game_xyz'` and `to_id=user_B`
8. `acceptInvite()` calls `startMultiplayerGame('game_xyz', 'user_A', 'A_name', false)`
9. Game starts.

### Reconnect Path: B was away when A invited

1. A invites B → DB row created
2. B's tab was suspended / browser killed / phone locked
3. B reopens Vietboard → `window.onload` → `joinLobbyChannel()` → `reconcileInvites()`
4. `reconcileInvites()` queries DB: `select * from invites where to_id='user_B' and status='pending'`
5. Finds A's invite → populates `g_pendingInvites` → lobby re-renders with **Accept** button
6. Toast does NOT fire on reconnect (only on live Realtime INSERT)
7. B clicks Accept → normal happy path continues

### Tab Unload Path: A invites B, then A's tab is killed

1. A invites B → DB row created
2. A's browser unloads the tab (memory pressure)
3. A reopens Vietboard → `reconcileInvites()` restores `g_myInvites`
4. Lobby shows "Invited..." for B
5. B clicks Accept → DB updated to `status='accepted'`
6. A's Realtime subscription receives UPDATE event
7. A's game starts automatically

## Code Review Checklist

### Database Layer
- [ ] `invites` table exists with all columns (including `to_name`)
- [ ] `app_key` column exists (for RLS)
- [ ] Indexes created on `(to_id, status)`, `(from_id, status)`, `(game_id)`
- [ ] RLS policies: SELECT open to all, upsert gated by `app_key`
- [ ] `supabase_realtime` publication includes `invites` table
- [ ] `unique(from_id, to_id, game_id)` constraint prevents duplicate game invites

### Client State Management
- [ ] `g_inviteQueue` and `g_outboundInvites` completely removed from codebase
- [ ] `g_pendingInvites` keyed by `gameId` (not `opponentId`)
- [ ] `g_myInvites` keyed by `gameId` (not `opponentId`)
- [ ] No references to old `invitePlayer()` function remain
- [ ] `lobby_invite` and `lobby_accept` broadcast event handlers removed

### Realtime Subscriptions
- [ ] `subscribeToInvites()` listens for INSERT on `to_id=eq.me`
- [ ] `subscribeToInvites()` listens for UPDATE on `to_id=eq.me` (for cancellations)
- [ ] `subscribeToMyInvites()` listens for UPDATE on `from_id=eq.me` with `status='accepted'`
- [ ] Both subscriptions call `.subscribe()`
- [ ] Subscriptions re-created on every lobby channel join (not duplicated)

### Invite Sending
- [ ] `sendInvite()` checks DB for existing pending invite before inserting (duplicate prevention)
- [ ] `sendInvite()` uses correct `app_key: _dk(_hk)` in upsert
- [ ] `sendInvite()` includes `to_name` in upsert
- [ ] `sendInvite()` handles `maybeSingle()` return correctly (`if (existing)` not `if (existing.data)`)
- [ ] On duplicate, function returns early without error

### Invite Acceptance
- [ ] `acceptInvite()` takes `gameId` parameter (not `opponentId`)
- [ ] `acceptInvite()` updates DB row with `status='accepted'` before starting game
- [ ] `acceptInvite()` calls `startMultiplayerGame()` as non-host (`isHost=false`)
- [ ] `acceptInvite()` guards against missing invite in cache (`if (!invite) return`)

### Game Start Integration
- [ ] `startMultiplayerGame()` calls `cancelMyInvites()` before leaving lobby
- [ ] `cancelMyInvites()` updates DB: all `from_id=me, status='pending'` → `status='cancelled'`
- [ ] `cancelMyInvites()` clears `g_myInvites` cache
- [ ] `init()` (SP start) does NOT call `cancelMyInvites()`
- [ ] `g_bui.restart()` (SP restart) does NOT call `cancelMyInvites()`

### Reconciliation
- [ ] `reconcileInvites()` queries both incoming and outgoing pending invites
- [ ] `reconcileInvites()` populates `g_pendingInvites` and `g_myInvites`
- [ ] `reconcileInvites()` called on `window.onload` after lobby join
- [ ] `reconcileInvites()` called inside `joinLobbyChannel()` after subscribe

### UI Rendering
- [ ] `renderLobbyPlayers()` checks `g_pendingInvites` by `from_id` match (not old `g_inviteQueue`)
- [ ] `renderLobbyPlayers()` checks `g_myInvites` by `to_id` match (not old `g_outboundInvites`)
- [ ] Accept button calls `acceptInvite('${gameId}')` with gameId, not opponentId
- [ ] Invite button calls `sendInvite('${id}', '${name}')` with opponent info
- [ ] "Invited..." text shown when outgoing invite exists (no Cancel button)

### Error Handling
- [ ] All Supabase calls wrapped in try/catch
- [ ] DEBUG console.warn on failures
- [ ] No uncaught promise rejections

### Edge Cases to Verify
- [ ] A invites B, B reloads → Accept still visible
- [ ] A invites B, A reloads → "Invited..." still visible
- [ ] A invites B, A plays SP → invite persists
- [ ] A invites B, then A invites C → both invites exist (different game_ids)
- [ ] A invites B, B accepts, A already left lobby → A still starts game via Realtime
- [ ] A invites B, B never accepts, A starts MP with C → B's invite auto-cancelled

## Automated Testing

### Existing Test Infrastructure

The project uses **Playwright** (v1.59.1, installed globally) with a custom static server.

**Test files:**
- `test/multiplayer.test.js` — Original Puppeteer-based lobby presence tests
- `test/invite-system.test.js` — **NEW** Full invite system end-to-end test (headless)

**Test commands:**
```bash
npm test                    # runs original multiplayer.test.js
npm run test:invite         # runs invite-system.test.js
node test/invite-system.test.js   # direct invocation
```

**Invite test capabilities:**
- Launches 2 headless browser contexts with unique identities
- Opens lobby on both pages, waits for presence sync
- Player A clicks Invite → verifies DB row created with `status='pending'`
- Verifies "Invited..." shown for A, "Accept" button shown for B
- Player B clicks Accept → verifies DB row updated to `status='accepted'`
- Verifies both players enter MP mode (`g_isMultiplayer === true`)
- Verifies both on game channel (`g_activeChannelType === 'game'`)
- Verifies both have matching `g_gameId`
- Cleans up test invites from DB after run

### Running Tests on Windows (Non-Headless)

Since you're in WSL, Puppeteer/Playwright browsers installed in WSL are Linux binaries. To launch **visible Windows browsers** for debugging:

**Option A: Install Puppeteer in Windows (recommended)**
```powershell
# In Windows PowerShell (not WSL)
cd C:\path\to\vietboard
npm install puppeteer
$env:HEADLESS="false"
node test/multiplayer.test.js
```

**Option B: Use Playwright with cross-platform support**
```bash
# In WSL, install Playwright
npm install -D @playwright/test
npx playwright install chromium

# Run with headed mode (will try to use Windows display if configured)
HEADLESS=false npx playwright test
```

**Option C: WSLg (if available)**
If your Windows 11 has WSLg support, GUI apps from WSL can display natively:
```bash
# In WSL
HEADLESS=false npm test
```

### Adding Invite System Tests

Create `test/invite.test.js`:

```javascript
const { test, expect } = require('@playwright/test');

test('Player A invites Player B, B accepts, game starts', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // Setup unique identities
  const nameA = 'TestA_' + Date.now();
  const nameB = 'TestB_' + Date.now();
  const idA = 'user_test_a_' + Date.now();
  const idB = 'user_test_b_' + Date.now();

  await pageA.addInitScript((uid, pname) => {
    localStorage.setItem('lobby_user_id', uid);
    localStorage.setItem('player_name', pname);
  }, idA, nameA);

  await pageB.addInitScript((uid, pname) => {
    localStorage.setItem('lobby_user_id', uid);
    localStorage.setItem('player_name', pname);
  }, idB, nameB);

  // Load game
  await pageA.goto('http://localhost:8080');
  await pageB.goto('http://localhost:8080');

  // Wait for lobby functionality
  await pageA.waitForFunction(() => typeof g_bui.showLobby === 'function');
  await pageB.waitForFunction(() => typeof g_bui.showLobby === 'function');

  // Open lobby
  await pageA.evaluate(() => g_bui.showLobby());
  await pageB.evaluate(() => g_bui.showLobby());

  // Wait for both players to see each other
  await pageA.waitForSelector('.lobby-player:has-text("' + nameB + '")');
  await pageB.waitForSelector('.lobby-player:has-text("' + nameA + '")');

  // Player A clicks Invite on Player B
  const inviteButtonA = await pageA.locator('.lobby-player:has-text("' + nameB + '") button:has-text("Invite")');
  await inviteButtonA.click();

  // Player B should see Accept button
  await pageB.waitForSelector('.lobby-player:has-text("' + nameA + '") button:has-text("Accept")', { timeout: 5000 });

  // Player B clicks Accept
  const acceptButtonB = await pageB.locator('.lobby-player:has-text("' + nameA + '") button:has-text("Accept")');
  await acceptButtonB.click();

  // Both should start MP game
  await pageA.waitForFunction(() => g_isMultiplayer === true, { timeout: 10000 });
  await pageB.waitForFunction(() => g_isMultiplayer === true, { timeout: 10000 });

  // Verify game channel connected
  await pageA.waitForFunction(() => g_channelSubscribed === true, { timeout: 10000 });
  await pageB.waitForFunction(() => g_channelSubscribed === true, { timeout: 10000 });

  await contextA.close();
  await contextB.close();
});
```

**Run the invite test:**
```bash
# Headless (CI)
npx playwright test test/invite.test.js

# Headed (visible windows, for debugging)
HEADLESS=false npx playwright test test/invite.test.js
```

### Invite System Test Scenarios to Implement

1. **Happy path:** A invites B → B sees toast → B accepts → both in MP game
2. **Reconnect:** A invites B → B reloads → B still sees Accept button → B accepts → game starts
3. **Inviter reload:** A invites B → A reloads → A still sees "Invited..." → B accepts → game starts
4. **SP doesn't cancel:** A invites B → A starts SP game → invite persists → B accepts → A pulled into MP
5. **MP cancels invites:** A invites B → A starts MP with C → B's invite disappears
6. **Duplicate prevention:** A invites B → A clicks Invite again → no duplicate row created

### Manual Testing (No Automation)

If you just want to test quickly without writing tests:

```bash
# Terminal 1: serve the game
npx http-server -p 8080 --cors

# Terminal 2: open two Chrome windows manually
# Open http://localhost:8080 in two separate browser profiles
# Open DevTools → Application → Local Storage
# Set lobby_user_id and player_name differently in each tab
# Open lobby modal on both and test invites
```

## SQL to Reset State (For Testing)

```sql
-- Nuclear option: delete all invites
delete from invites;

-- Or delete between specific players
delete from invites where from_id = 'user_A' or to_id = 'user_A';
```
