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
    
    pageA.on('console', msg => console.log('A:', msg.text()));
    pageB.on('console', msg => console.log('B:', msg.text()));

    const nameA = `PlayerA_${Date.now()}`;
    const nameB = `PlayerB_${Date.now()}`;
    const idA = `user_test_A_${Date.now()}`;
    const idB = `user_test_B_${Date.now()}`;

    await pageA.evaluateOnNewDocument((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
      localStorage.setItem('has_seen_tutorial', 'true');
    }, idA, nameA);
    await pageB.evaluateOnNewDocument((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
      localStorage.setItem('has_seen_tutorial', 'true');
    }, idB, nameB);

    console.log('Loading pages...');
    await pageA.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await pageB.goto(BASE_URL, { waitUntil: 'networkidle2' });

    console.log('Opening lobby...');
    await pageA.evaluate(() => g_bui.showLobby());
    await pageB.evaluate(() => g_bui.showLobby());

    console.log('Waiting for players to appear in lobby...');
    await pageA.waitForFunction((name) => {
      return Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).some(el => el.innerText.trim() === name);
    }, { timeout: 30000 }, nameB);

    console.log('Sending invite from A to B...');
    await pageA.evaluate((opponentName) => {
      const players = Array.from(document.querySelectorAll('.lobby-player'));
      const opponentEl = players.find(el => el.querySelector('strong') && el.querySelector('strong').innerText.trim() === opponentName);
      if (opponentEl) {
        const btn = opponentEl.querySelector('button');
        if (btn) btn.click();
        else throw new Error('Invite button not found for opponent');
      } else {
        throw new Error('Opponent not found in lobby list');
      }
    }, nameB);

    console.log('Accepting invite on B...');
    await pageB.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('.lobby-player button'));
      return buttons.some(btn => btn.innerText.includes('Accept'));
    }, { timeout: 15000 });
    
    await pageB.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.lobby-player button'));
      const btn = buttons.find(btn => btn.innerText.includes('Accept'));
      if (btn) btn.click();
    });

    console.log('Waiting for game to start...');
    await pageA.waitForFunction(() => typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && g_gameId !== null, { timeout: 15000 });
    await pageB.waitForFunction(() => typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && g_gameId !== null, { timeout: 15000 });

    console.log('Simulating preview drag...');
    // We'll simulate dragging the first tile from rack 1 to the center board (c7_7)
    await pageA.evaluate(() => {
      var rackCell = document.querySelector('#pl0');
      var boardCell = document.querySelector('#c7_7');
      if (rackCell && rackCell.firstChild && boardCell) {
        var tile = rackCell.firstChild;
        // Redips drag simulation
        g_bui.rd.moveObject({
          obj: tile,
          target: boardCell
        });
        var letterClass = Array.from(tile.classList).find(c => c.length === 2 && c[0] === 't');
        var letter = letterClass ? letterClass[1] : 'A';
        g_bui.newplays['c7_7'] = { letter: letter, points: 1, isBlank: false };
        if (typeof savePlayerStateToDB === 'function') savePlayerStateToDB();
        if (typeof g_gameChannel !== 'undefined' && g_gameChannel) {
            g_gameChannel.send({
                type: 'broadcast',
                event: 'drag_sync',
                payload: { newplays: g_bui.newplays, drag_token: Date.now().toString() }
            });
        }
      } else {
        throw new Error('Could not find rack tile or board cell for drag');
      }
    });

    // We should wait to see if the preview shows up on B's screen
    console.log('Checking opponent preview sync...');
    await pageB.waitForFunction(() => {
      var cell = document.querySelector('#c7_7');
      return cell && cell.querySelector('.drag');
    }, { timeout: 15000 });

    console.log('Reloading page A to test resilience...');
    await pageA.reload({ waitUntil: 'networkidle2' });
    await pageA.waitForFunction(() => typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && g_gameId !== null, { timeout: 15000 });

    console.log('Checking if preview restored on A...');
    await pageA.waitForFunction(() => {
      var cell = document.querySelector('#c7_7');
      return cell && cell.querySelector('.drag');
    }, { timeout: 15000 });

    console.log('Clearing preview on A...');
    await pageA.evaluate(() => {
      var clearBtn = document.querySelector('#clear');
      if (clearBtn) clearBtn.click();
    });

    console.log('Checking preview cleared on B...');
    await pageB.waitForFunction(() => {
      var cell = document.querySelector('#c7_7');
      return cell && !cell.querySelector('.drag');
    }, { timeout: 15000 });

    console.log('Testing turn pass...');
    // Only one player can pass right now (the one whose turn it is)
    const isMyTurnA = await pageA.evaluate(() => g_isMyTurn);
    if (isMyTurnA) {
      await pageA.evaluate(() => { document.querySelector('#pass').click(); });
      await pageB.waitForFunction(() => g_isMyTurn === true, { timeout: 15000 });
    } else {
      await pageB.evaluate(() => { document.querySelector('#pass').click(); });
      await pageA.waitForFunction(() => g_isMyTurn === true, { timeout: 15000 });
    }

    console.log('All gameplay tests passed!');

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
