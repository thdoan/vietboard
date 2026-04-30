const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 8765;
let BASE_URL = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg'
};

function startStaticServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${server.address().port}`);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/index.html';
        const filePath = path.join(root, pathname);
        if (!filePath.startsWith(root)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        fs.stat(filePath, (err, stats) => {
          if (err || !stats.isFile()) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
        });
      } catch (err) {
        res.writeHead(500);
        res.end('Server error');
      }
    });
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

async function waitFor(fn, timeout = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Timeout waiting for condition');
}

async function runTests() {
  console.log('=== Invite System Headless Test Suite ===\n');

  const server = await startStaticServer(ROOT, PORT);
  BASE_URL = `http://127.0.0.1:${PORT}`;
  console.log(`Server running at ${BASE_URL}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  console.log('Browser launched (headless)\n');

  let pageA, pageB;

  try {
    // Create isolated contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    // Capture console logs
    pageA.on('console', msg => console.log(`[A] ${msg.type().toUpperCase()}: ${msg.text()}`));
    pageB.on('console', msg => console.log(`[B] ${msg.type().toUpperCase()}: ${msg.text()}`));
    pageA.on('pageerror', err => console.log(`[A] PAGEERROR: ${err.message}`));
    pageB.on('pageerror', err => console.log(`[B] PAGEERROR: ${err.message}`));

    // Unique test identities
    const nameA = `TestA_${Date.now()}`;
    const nameB = `TestB_${Date.now()}`;
    const idA = `user_a_${Date.now()}`;
    const idB = `user_b_${Date.now()}`;

    console.log(`Player A: ${nameA} (${idA})`);
    console.log(`Player B: ${nameB} (${idB})\n`);

    // Inject identities before page load
    await pageA.addInitScript((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
    }, idA, nameA);

    await pageB.addInitScript((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
    }, idB, nameB);

    // Load game
    console.log('Loading game pages...');
    await pageA.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await pageB.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // Wait for game to be ready
    await pageA.waitForFunction(() => typeof g_bui !== 'undefined' && typeof g_bui.showLobby === 'function', { timeout: 20000 });
    await pageB.waitForFunction(() => typeof g_bui !== 'undefined' && typeof g_bui.showLobby === 'function', { timeout: 20000 });
    console.log('Both pages loaded and ready\n');

    // Cleanup any existing invites between these test users
    console.log('Cleaning up existing test invites...');
    await pageA.evaluate(async (idA, idB) => {
      if (window.supabaseClient) {
        await window.supabaseClient.from('invites')
          .delete()
          .eq('from_id', idA)
          .eq('to_id', idB);
        await window.supabaseClient.from('invites')
          .delete()
          .eq('from_id', idB)
          .eq('to_id', idA);
      }
    }, idA, idB);

    // Open lobby on both
    console.log('Opening lobby modals...');
    await pageA.evaluate(() => g_bui.showLobby());
    await pageB.evaluate(() => g_bui.showLobby());

    // Wait for presence sync
    console.log('Waiting for presence sync...');
    await waitFor(async () => {
      const namesA = await pageA.evaluate(() =>
        Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim())
      );
      return namesA.includes(nameB);
    }, 20000);

    await waitFor(async () => {
      const namesB = await pageB.evaluate(() =>
        Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim())
      );
      return namesB.includes(nameA);
    }, 20000);
    console.log('Presence synced: both players see each other\n');

    // --- TEST 1: Send Invite ---
    console.log('=== TEST 1: Player A invites Player B ===');

    // Player A clicks Invite
    await pageA.evaluate((name) => {
      const players = document.querySelectorAll('#lobby-players .lobby-player');
      for (const p of players) {
        const strong = p.querySelector('strong');
        if (strong && strong.innerText.trim() === name) {
          const btn = p.querySelector('button');
          if (btn) btn.click();
        }
      }
    }, nameB);

    // Wait for DB row to be created
    console.log('Waiting for invite DB row...');
    const inviteRow = await waitFor(async () => {
      return await pageA.evaluate(async (idA, idB) => {
        if (!window.supabaseClient) return null;
        const { data } = await window.supabaseClient
          .from('invites')
          .select('*')
          .eq('from_id', idA)
          .eq('to_id', idB)
          .eq('status', 'pending')
          .maybeSingle();
        return data;
      }, idA, idB);
    }, 15000);

    if (!inviteRow) throw new Error('Invite row not created in DB');
    console.log(`✓ Invite row created: game_id=${inviteRow.game_id}`);

    // Verify Player A sees "Invited..."
    const aSeesInvited = await pageA.evaluate((name) => {
      const players = document.querySelectorAll('#lobby-players .lobby-player');
      for (const p of players) {
        const strong = p.querySelector('strong');
        if (strong && strong.innerText.trim() === name) {
          return p.innerHTML.includes('Invited...');
        }
      }
      return false;
    }, nameB);

    if (!aSeesInvited) throw new Error('Player A does not see "Invited..." for B');
    console.log('✓ Player A sees "Invited..." status');

    // Verify Player B sees Accept button
    const bSeesAccept = await pageB.evaluate((name) => {
      const players = document.querySelectorAll('#lobby-players .lobby-player');
      for (const p of players) {
        const strong = p.querySelector('strong');
        if (strong && strong.innerText.trim() === name) {
          const btn = p.querySelector('button');
          return btn && btn.innerText.trim() === 'Accept';
        }
      }
      return false;
    }, nameA);

    if (!bSeesAccept) throw new Error('Player B does not see Accept button for A');
    console.log('✓ Player B sees "Accept" button\n');

    // --- TEST 2: Accept Invite ---
    console.log('=== TEST 2: Player B accepts invite ===');

    // Player B clicks Accept
    const gameId = inviteRow.game_id;
    await pageB.evaluate((gameId) => {
      if (typeof acceptInvite === 'function') {
        acceptInvite(gameId);
      }
    }, gameId);

    // Wait for DB row to be updated to accepted
    console.log('Waiting for DB status update...');
    await waitFor(async () => {
      const row = await pageB.evaluate(async (gameId) => {
        if (!window.supabaseClient) return null;
        const { data } = await window.supabaseClient
          .from('invites')
          .select('status')
          .eq('game_id', gameId)
          .maybeSingle();
        return data;
      }, gameId);
      return row && row.status === 'accepted';
    }, 15000);
    console.log('✓ DB row updated to status=accepted');

    // Wait for both to enter MP mode
    console.log('Waiting for MP game start on both players...');
    await waitFor(async () => {
      const isMP = await pageA.evaluate(() => typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer);
      return isMP;
    }, 20000);

    await waitFor(async () => {
      const isMP = await pageB.evaluate(() => typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer);
      return isMP;
    }, 20000);
    console.log('✓ Both players in MP mode');

    // Verify game channel connected
    await waitFor(async () => {
      const subscribed = await pageA.evaluate(() => typeof g_channelSubscribed !== 'undefined' && g_channelSubscribed);
      return subscribed;
    }, 20000);

    await waitFor(async () => {
      const subscribed = await pageB.evaluate(() => typeof g_channelSubscribed !== 'undefined' && g_channelSubscribed);
      return subscribed;
    }, 20000);
    console.log('✓ Both players connected to game channel\n');

    // Verify they're NOT on lobby channel anymore
    const aOnGameChannel = await pageA.evaluate(() =>
      typeof g_activeChannelType !== 'undefined' && g_activeChannelType === 'game'
    );
    const bOnGameChannel = await pageB.evaluate(() =>
      typeof g_activeChannelType !== 'undefined' && g_activeChannelType === 'game'
    );

    if (!aOnGameChannel) throw new Error('Player A still on lobby channel');
    if (!bOnGameChannel) throw new Error('Player B still on lobby channel');
    console.log('✓ Both players left lobby channel');

    // Verify game IDs match
    const aGameId = await pageA.evaluate(() => g_gameId);
    const bGameId = await pageB.evaluate(() => g_gameId);
    if (aGameId !== bGameId) throw new Error(`Game IDs mismatch: A=${aGameId}, B=${bGameId}`);
    if (aGameId !== gameId) throw new Error(`Game ID mismatch with invite: expected=${gameId}, actual=${aGameId}`);
    console.log('✓ Both players on same game channel\n');

    console.log('=== ALL TESTS PASSED ===\n');

  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (pageA) {
      try {
        // Cleanup invites
        await pageA.evaluate(async () => {
          if (window.supabaseClient && typeof g_lobbyUserId !== 'undefined') {
            await window.supabaseClient.from('invites')
              .delete()
              .eq('from_id', g_lobbyUserId);
          }
        });
      } catch (e) { /* ignore cleanup errors */ }
    }
    await browser.close();
    server.close();
    console.log('\nCleanup complete.');
  }
}

runTests();
