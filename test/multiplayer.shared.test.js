const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PORT = 0;
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
    server.listen(port, () => resolve(server));
  });
}

async function runTests() {
  const server = await startStaticServer(ROOT, PORT);
  BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const contextA = await browser.createIncognitoBrowserContext();
    const contextB = await browser.createIncognitoBrowserContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    pageA.on('console', msg => console.log(`[A] LOG: ${msg.text()}`));
    pageB.on('console', msg => console.log(`[B] LOG: ${msg.text()}`));

    const idA = 'user_A';
    const idB = 'user_B';
    await pageA.evaluateOnNewDocument((id) => localStorage.setItem('lobby_user_id', id), idA);
    await pageB.evaluateOnNewDocument((id) => localStorage.setItem('lobby_user_id', id), idB);

    await pageA.goto(BASE_URL);
    await pageB.goto(BASE_URL);

    // Join lobby and start game
    await pageA.evaluate(() => window.showLobby());
    await pageB.evaluate(() => window.showLobby());
    await pageA.waitForFunction(() => document.querySelectorAll('.lobby-player strong').length > 0);
    await pageA.evaluate(() => document.querySelector('.lobby-player').click());
    await pageA.waitForFunction(() => !document.getElementById('modal-mask') || document.getElementById('modal-mask').style.display === 'none');
    await pageB.waitForFunction(() => !document.getElementById('modal-mask') || document.getElementById('modal-mask').style.display === 'none');

    console.log('Game started');
    await pageA.waitForTimeout(1000);

    // Mock getPlayerPlacement and alerts
    await pageA.evaluate(() => {
        window.alert = (msg) => console.log('ALERT A:', msg);
        window.g_bui.getPlayerPlacement = () => {
            const placements = [];
            for (let id in window.g_bui.newplays) {
                const holds = window.g_bui.newplays[id];
                if (!holds) continue;
                const parts = id.slice(1).split('_');
                placements.push({ 
                    id: id, 
                    x: parseInt(parts[0]), 
                    y: parseInt(parts[1]), 
                    ltr: holds.letter, 
                    lsc: holds.points 
                });
            }
            return placements;
        };
    });
    await pageB.evaluate(() => window.alert = (msg) => console.log('ALERT B:', msg));

    // Force turn A
    await pageA.evaluate(() => { window.g_isMyTurn = true; window.updateTurnIndicator(); });
    await pageB.evaluate(() => { window.g_isMyTurn = false; window.updateTurnIndicator(); });

    // A places "ba" at (7,7) and (8,7)
    await pageA.evaluate(() => {
        g_bui.setPlayerRack('ba......');
        const hB = { letter: 'b', points: 1 };
        const hA = { letter: 'a', points: 1 };
        const c1 = document.getElementById('c7_7');
        const c2 = document.getElementById('c8_7');
        c1.holds = hB;
        c2.holds = hA;
        g_bui.newplays['c7_7'] = hB;
        g_bui.newplays['c8_7'] = hA;
    });

    console.log('Player A placing "ba"...');
    const movePayload = await pageA.evaluate(async () => {
        let captured = null;
        const originalBroadcast = window.broadcastGameState;
        window.broadcastGameState = (p) => { if (p.type === 'move') captured = p; originalBroadcast(p); };
        onMultiplayerMove();
        for (let i=0; i<20; i++) { if (captured) return captured; await new Promise(r => setTimeout(r, 100)); }
        return null;
    });

    if (!movePayload) throw new Error('Move broadcast failed');

    // Deliver to B
    console.log('Delivering move to Player B...');
    await pageB.evaluate((p) => handleMoveBroadcast(p), movePayload);

    // Check B's board - should be SAME coordinates (7,7 and 8,7) and SAME word "ba"
    const boardStateB = await pageB.evaluate(() => {
        const c1 = document.getElementById('c7_7');
        const c2 = document.getElementById('c8_7');
        return [
            c1.querySelector('.drag').innerText.trim()[0],
            c2.querySelector('.drag').innerText.trim()[0]
        ];
    });

    console.log('Player B board at (7,7), (8,7):', boardStateB);
    if (boardStateB[0] !== 'B' || boardStateB[1] !== 'A') {
        throw new Error(`Word reversed! Expected BA, got ${boardStateB.join('')}`);
    }

    console.log('SHARED ORIENTATION TEST PASSED: Words are correct for both players.');

  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
    server.close();
  }
}

runTests();
