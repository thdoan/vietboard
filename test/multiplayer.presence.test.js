const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');

function startStaticServer(root, port = 0) {
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
          const map = {
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
          res.writeHead(200, { 'Content-Type': map[ext] || 'application/octet-stream' });
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

async function waitForLobbyPlayers(page, expectedNames, timeout = 30000) {
  await page.waitForFunction(
    (expected) => {
      const names = Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim());
      return expected.every(name => names.includes(name));
    },
    { timeout },
    expectedNames
  );
  return page.evaluate(() => Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim()));
}

async function run() {
  const server = await startStaticServer(ROOT);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  const aContext = await browser.createIncognitoBrowserContext();
  const bContext = await browser.createIncognitoBrowserContext();
  const pageA = await aContext.newPage();
  const pageB = await bContext.newPage();

  pageA.on('console', msg => console.log('[A]', msg.type(), msg.text()));
  pageB.on('console', msg => console.log('[B]', msg.type(), msg.text()));

  const idA = `user_a_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const idB = `user_b_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const nameA = `Alpha_${Math.random().toString(36).slice(2,6)}`;
  const nameB = `Bravo_${Math.random().toString(36).slice(2,6)}`;

  await pageA.evaluateOnNewDocument((uid, name) => {
    localStorage.setItem('lobby_user_id', uid);
    localStorage.setItem('player_name', name);
  }, idA, nameA);
  await pageB.evaluateOnNewDocument((uid, name) => {
    localStorage.setItem('lobby_user_id', uid);
    localStorage.setItem('player_name', name);
  }, idB, nameB);

  await Promise.all([
    pageA.goto(baseUrl, { waitUntil: 'networkidle2' }),
    pageB.goto(baseUrl, { waitUntil: 'networkidle2' })
  ]);

  await Promise.all([
    pageA.waitForFunction(() => typeof g_bui.showLobby === 'function', { timeout: 20000 }),
    pageB.waitForFunction(() => typeof g_bui.showLobby === 'function', { timeout: 20000 })
  ]);

  await Promise.all([
    pageA.evaluate(() => g_bui.showLobby()),
    pageB.evaluate(() => g_bui.showLobby())
  ]);

  await pageA.waitForSelector('#lobby-name', { timeout: 20000 });
  await pageB.waitForSelector('#lobby-name', { timeout: 20000 });

  console.log('Waiting for lobby listing from both pages...');
  const [playersA, playersB] = await Promise.all([
    waitForLobbyPlayers(pageA, [nameB]),
    waitForLobbyPlayers(pageB, [nameA])
  ]);

  console.log('Page A sees:', playersA);
  console.log('Page B sees:', playersB);

  const stateA = await pageA.evaluate(() => g_channel && typeof g_channel.presenceState === 'function' ? JSON.stringify(g_channel.presenceState()) : null);
  const stateB = await pageB.evaluate(() => g_channel && typeof g_channel.presenceState === 'function' ? JSON.stringify(g_channel.presenceState()) : null);
  console.log('Page A raw presence:', stateA);
  console.log('Page B raw presence:', stateB);

  await browser.close();
  server.close();
}

run().catch(err => {
  console.error('REPRO FAILED:', err);
  process.exit(1);
});
