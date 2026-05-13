const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 0;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8', '.png': 'image/png', '.mp3': 'audio/mpeg'
};

function startStaticServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${server.address().port}`);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/index.html';
        const filePath = path.join(root, pathname);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
        fs.stat(filePath, (err, stats) => {
          if (err || !stats.isFile()) { res.writeHead(404); res.end('Not found'); return; }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
        });
      } catch (err) { res.writeHead(500); res.end('Server error'); }
    });
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

async function waitFor(fn, timeout = 15000, interval = 250) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeout) {
    try { const r = await fn(); if (r) return r; } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, interval));
  }
  if (lastErr) throw lastErr;
  throw new Error(`waitFor timeout (${timeout}ms)`);
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

async function simulateNetworkLatency(page, minMs = 100, maxMs = 300) {
  await page.route('**/*', async (route) => {
    const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
    await new Promise(r => setTimeout(r, delay));
    await route.continue();
  });
}

async function waitForAppReady(page) {
  await waitFor(() => page.evaluate(() => {
    return !!(window.g_bui && typeof window.g_bui.showLobby === 'function')
      && !!document.getElementById('board')
      && !document.documentElement.classList.contains('loading');
  }), 20000);
}

async function waitForHandshake(page, label) {
  try {
    await waitFor(() => page.evaluate(() => {
      return !!g_isMultiplayer && !!g_channelSubscribed && !!g_gameId && g_stateVersion > 0;
    }), 20000);
  } catch {
    const s = await page.evaluate(() => ({
      mp: !!g_isMultiplayer, sub: !!g_channelSubscribed, gid: g_gameId, sv: g_stateVersion
    })).catch(() => ({}));
    throw new Error(`Handshake timeout ${label}: ${JSON.stringify(s)}`);
  }
}

async function clickLobbyButton(page, targetName, expectedText) {
  const ok = await page.evaluate(({ name, text }) => {
    const rows = document.querySelectorAll('#lobby-players .lobby-player');
    for (const row of rows) {
      const strong = row.querySelector('strong');
      if (!strong || strong.innerText.trim() !== name) continue;
      const btn = row.querySelector('button');
      if (!btn) return false;
      if (text && btn.innerText.trim() !== text) return false;
      btn.click();
      return true;
    }
    return false;
  }, { name: targetName, text: expectedText });
  assert(ok, `Could not click "${expectedText}" for ${targetName}`);
}

async function runTests() {
  console.log('=== Forfeit Detection Test ===\n');

  const server = await startStaticServer(ROOT, PORT);
  const BASE_URL = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errors = [];
  let ctxA, ctxB;

  try {
    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    pageA.on('pageerror', e => { if (!e.message.includes('localStorage')) { console.error('[A] ERROR:', e.message); errors.push('A: ' + e.message); } });
    pageB.on('pageerror', e => { if (!e.message.includes('localStorage')) { console.error('[B] ERROR:', e.message); errors.push('B: ' + e.message); } });
    pageA.on('console', msg => { if (msg.type() === 'error') console.log('[A]', msg.text()); });
    pageB.on('console', msg => { if (msg.type() === 'error') console.log('[B]', msg.text()); });

    // Simulate network latency if --latency flag is set
    if (process.argv.includes('--latency')) {
      console.log('  Simulating network latency (100-300ms per request)');
      await simulateNetworkLatency(pageA, 100, 300);
      await simulateNetworkLatency(pageB, 100, 300);
    }

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nameA = `Host_${suffix}`, nameB = `Guest_${suffix}`;
    const idA = `host_${suffix}`, idB = `guest_${suffix}`;

    await pageA.addInitScript(({ uid, pn }) => { localStorage.setItem('lobby_user_id', uid); localStorage.setItem('player_name', pn); }, { uid: idA, pn: nameA });
    await pageB.addInitScript(({ uid, pn }) => { localStorage.setItem('lobby_user_id', uid); localStorage.setItem('player_name', pn); }, { uid: idB, pn: nameB });

    // Load pages
    await Promise.all([pageA.goto(BASE_URL, { waitUntil: 'commit' }), pageB.goto(BASE_URL, { waitUntil: 'commit' })]);
    await Promise.all([waitForAppReady(pageA), waitForAppReady(pageB)]);

    // Cleanup stale invites
    await pageA.evaluate(async ({ a, b }) => {
      if (!window.supabaseClient) return;
      await supabaseClient.from('invites').delete().eq('from_id', a).eq('to_id', b);
      await supabaseClient.from('invites').delete().eq('from_id', b).eq('to_id', a);
    }, { a: idA, b: idB });

    // Open lobby
    await Promise.all([pageA.evaluate(() => g_bui.showLobby()), pageB.evaluate(() => g_bui.showLobby())]);

    // Wait for presence
    await waitFor(() => pageA.evaluate((n) => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).some(el => el.innerText.trim() === n), nameB), 20000);
    await waitFor(() => pageB.evaluate((n) => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).some(el => el.innerText.trim() === n), nameA), 20000);
    console.log('  Presence synced');

    // A invites B
    await clickLobbyButton(pageA, nameB, 'Invite');
    console.log('  Invite sent');

    // B accepts
    await waitFor(() => pageB.evaluate(n => {
      const rows = document.querySelectorAll('#lobby-players .lobby-player');
      for (const row of rows) {
        const strong = row.querySelector('strong');
        if (strong && strong.innerText.trim() === n) {
          const btn = row.querySelector('button');
          return btn && btn.innerText.trim() === 'Accept';
        }
      }
      return false;
    }, nameA), 15000);
    await clickLobbyButton(pageB, nameA, 'Accept');
    console.log('  Invite accepted');

    // Wait for handshake
    await Promise.all([waitForHandshake(pageA, 'host'), waitForHandshake(pageB, 'guest')]);
    console.log('  Game started. Both in MP mode.\n');

    // Verify invite exists in DB with status 'started'
    const inviteBefore = await pageA.evaluate(async (gid) => {
      const { data } = await supabaseClient.from('invites').select('status').eq('game_id', gid).maybeSingle();
      return data;
    }, await pageA.evaluate(() => g_gameId));
    console.log(`  Invite status before forfeit: ${inviteBefore ? inviteBefore.status : 'NOT FOUND'}`);

    // === TEST 1: Guest forfeits, host detects ===
    console.log('\n--- Test 1: Guest (B) forfeits, Host (A) should detect ---');

    // B forfeits via the actual game function
    await pageB.evaluate(() => {
      finalizeMultiplayerGame('forfeit', true);
    });
    console.log('  B called finalizeMultiplayerGame(forfeit)');

    // Wait for A to detect the forfeit via postgres_changes (from_id filter)
    // The handler deletes the invite row, so we can't check DB status — check A's state instead
    try {
      await waitFor(() => pageA.evaluate(() => !!g_isGameOver), 15000);
      console.log('  PASS: A detected B\'s forfeit via realtime event');
    } catch {
      // Fallback: try visibilitychange
      console.log('  Realtime event missed, trying visibilitychange...');
      await pageA.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await pageA.waitForTimeout(3000);

      const aState = await pageA.evaluate(() => ({ isGameOver: !!g_isGameOver, isMultiplayer: !!g_isMultiplayer }));
      if (aState.isGameOver) {
        console.log('  PASS: A detected forfeit via visibilitychange fallback');
      } else {
        console.log('  FAIL: A did not detect forfeit');
        console.log('  A state:', JSON.stringify(aState));
        throw new Error('Forfeit detection failed');
      }
    }

    console.log('\n=== FORFEIT TEST PASSED ===');

  } catch (err) {
    console.error('\n=== FORFEIT TEST FAILED ===');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  } finally {
    try { if (ctxA) await ctxA.close(); } catch {}
    try { if (ctxB) await ctxB.close(); } catch {}
    await browser.close();
    server.close();
  }
}

runTests();
