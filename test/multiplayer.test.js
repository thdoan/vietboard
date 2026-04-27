const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 0;
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

async function waitForLobbyNames(page, expectedNames, timeout = 20000) {
  try {
    await page.waitForFunction(
      (expected) => {
        const names = Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim());
        return names.length >= expected.length && expected.every(name => names.includes(name));
      },
      { timeout },
      expectedNames
    );
  } catch (err) {
    const currentNames = await page.evaluate(() => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()));
    console.error('waitForLobbyNames timed out. expected:', expectedNames, 'found:', currentNames);
    throw err;
  }
  return page.evaluate(() => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()));
}

async function waitForLobbyCount(page, expectedCount, timeout = 20000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('#lobby-players .lobby-player').length === count,
    { timeout },
    expectedCount
  );
  return page.evaluate(() => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()));
}

async function waitForLobbyNameAbsent(page, name, timeout = 20000) {
  await page.waitForFunction(
    (expected) => {
      const names = Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim());
      return !names.includes(expected);
    },
    { timeout },
    name
  );
  return page.evaluate((expected) => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()), name);
}

async function waitForPresenceState(page, predicate, timeout = 20000) {
  await page.waitForFunction(
    (predicateString) => {
      const fn = new Function('state', `return ${predicateString}`);
      const state = window.g_channel && typeof window.g_channel.presenceState === 'function' ? window.g_channel.presenceState() : null;
      return fn(state);
    },
    { timeout },
    predicate.toString()
  );
}

async function runTests() {
  const server = await startStaticServer(ROOT, PORT);
  BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  let contextA;
  let contextB;
  try {
    contextA = await browser.createIncognitoBrowserContext();
    contextB = await browser.createIncognitoBrowserContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    pageA.on('console', msg => console.log(`[A] ${msg.type().toUpperCase()}: ${msg.text()} ${JSON.stringify(msg.location())}`));
    pageB.on('console', msg => console.log(`[B] ${msg.type().toUpperCase()}: ${msg.text()} ${JSON.stringify(msg.location())}`));
    pageA.on('pageerror', err => console.log(`[A] PAGEERROR: ${err.stack || err.message}`));
    pageB.on('pageerror', err => console.log(`[B] PAGEERROR: ${err.stack || err.message}`));
    pageA.on('requestfailed', req => console.log(`[A] REQUESTFAILED: ${req.url()} ${req.failure().errorText}`));
    pageB.on('requestfailed', req => console.log(`[B] REQUESTFAILED: ${req.url()} ${req.failure().errorText}`));
    pageA.on('request', req => {
      if (req.resourceType() === 'script') console.log(`[A] SCRIPT REQUEST: ${req.url()}`);
    });
    pageB.on('request', req => {
      if (req.resourceType() === 'script') console.log(`[B] SCRIPT REQUEST: ${req.url()}`);
    });
    pageA.on('response', resp => {
      if (resp.request().resourceType() === 'script' && resp.status() !== 200) {
        console.log(`[A] SCRIPT RESPONSE: ${resp.url()} status=${resp.status()}`);
      }
    });
    pageB.on('response', resp => {
      if (resp.request().resourceType() === 'script' && resp.status() !== 200) {
        console.log(`[B] SCRIPT RESPONSE: ${resp.url()} status=${resp.status()}`);
      }
    });

    const nameA = `PlayerA_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const newNameA = `${nameA}_ch`;
    const nameB = `PlayerB_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const idA = `user_test_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const idB = `user_test_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

    await pageA.evaluateOnNewDocument((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
    }, idA, nameA);
    await pageB.evaluateOnNewDocument((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
    }, idB, nameB);

    await pageA.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await pageB.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await Promise.all([
      pageA.waitForSelector('#lobby'),
      pageB.waitForSelector('#lobby'),
      pageA.waitForFunction(() => typeof g_bui.showLobby === 'function', { timeout: 20000 }),
      pageB.waitForFunction(() => typeof g_bui.showLobby === 'function', { timeout: 20000 })
    ]);

    const pageAName = await pageA.evaluate(() => localStorage.getItem('player_name'));
    const pageBName = await pageB.evaluate(() => localStorage.getItem('player_name'));
    console.log('TEST: pageAName', pageAName, 'expected', nameA);
    console.log('TEST: pageBName', pageBName, 'expected', nameB);

    await pageA.evaluate(() => g_bui.showLobby());
    await pageB.evaluate(() => g_bui.showLobby());

    const pageAStatePre = await pageA.evaluate(() => (g_channel && typeof g_channel.presenceState === 'function') ? JSON.stringify(g_channel.presenceState()) : null);
    const pageBStatePre = await pageB.evaluate(() => (g_channel && typeof g_channel.presenceState === 'function') ? JSON.stringify(g_channel.presenceState()) : null);
    console.log('TEST: pageAStatePre', pageAStatePre);
    console.log('TEST: pageBStatePre', pageBStatePre);

    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);
    const pageAStatePost = await pageA.evaluate(() => (g_channel && typeof g_channel.presenceState === 'function') ? JSON.stringify(g_channel.presenceState()) : null);
    const pageBStatePost = await pageB.evaluate(() => (g_channel && typeof g_channel.presenceState === 'function') ? JSON.stringify(g_channel.presenceState()) : null);
    console.log('TEST: pageAStatePost', pageAStatePost);
    console.log('TEST: pageBStatePost', pageBStatePost);

    await waitForLobbyNames(pageA, [nameB]);
    await waitForLobbyNames(pageB, [nameA]);

    // Regression: entering a new name and pressing Enter should update the player name immediately
    await pageA.click('#lobby-name');
    await pageA.keyboard.down('Control');
    await pageA.keyboard.press('A');
    await pageA.keyboard.up('Control');
    await pageA.keyboard.press('Backspace');
    await pageA.type('#lobby-name', newNameA);
    await pageA.keyboard.press('Enter');
    await pageA.waitForFunction(
      (expected) => localStorage.getItem('player_name') === expected,
      { timeout: 5000 },
      newNameA
    );
    await pageA.waitForFunction(
      (expected) => {
        const input = document.getElementById('lobby-name');
        return input && input.value === expected;
      },
      { timeout: 5000 },
      newNameA
    );
    await waitForLobbyNames(pageB, [newNameA], 30000);

    await pageB.evaluate(() => leaveLobby());
    await waitForLobbyNameAbsent(pageA, nameB);
    const pageANamesAfterLeave = await pageA.evaluate(() => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()));
    if (pageANamesAfterLeave.includes(nameB)) throw new Error('Player A still sees player B after leave');

    await pageB.evaluate(() => g_bui.showLobby());
    await waitForLobbyNames(pageA, [nameB]);
    await waitForLobbyNames(pageB, [newNameA]);

    const pageALobby = await pageA.evaluate(() => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()));
    if (!pageALobby.includes(nameB)) throw new Error('Player B did not reappear on player A after rejoining');

    console.log('All multiplayer lobby tests passed.');
  } finally {
    if (contextA) await contextA.close();
    if (contextB) await contextB.close();
    await browser.close();
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test suite failed:');
  console.error(err);
  process.exit(1);
});
