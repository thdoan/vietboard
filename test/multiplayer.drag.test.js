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

    // Set IDs and names
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
    await pageA.waitForTimeout(2000);

    // Enable multiplayer mode flags manually for the test
    await pageA.evaluate(() => { window.g_isMultiplayer = true; window.g_isMyTurn = true; });
    await pageB.evaluate(() => { window.g_isMultiplayer = true; window.g_isMyTurn = false; });

    // We want to test that a drag on Page A's bottom-left is seen on Page B's top-right (mirrored)
    const dragAreaA = await pageA.evaluate(() => {
        const rect = document.getElementById('drag').getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    });

    const dragAreaB = await pageB.evaluate(() => {
        const rect = document.getElementById('drag').getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    });

    // Capture broadcast on Page A
    await pageA.evaluate(() => {
        const originalBroadcast = window.broadcastGameState;
        window.broadcastGameState = (payload) => {
            if (payload.type === 'drag_start' || payload.type === 'drag_move') {
                window.lastDragPayload = payload;
            }
            originalBroadcast(payload);
        };
    });

    // Simulate drag start from rack cell pl0
    const sourceCellA = await pageA.$('#pl0');
    const sourceBoxA = await sourceCellA.boundingBox();
    const startX = sourceBoxA.x + sourceBoxA.width / 2;
    const startY = sourceBoxA.y + sourceBoxA.height / 2;

    await pageA.mouse.move(startX, startY);
    await pageA.mouse.down();
    
    // Move to a specific point in drag area (e.g., bottom-left quadrant)
    const targetX = dragAreaA.x + dragAreaA.width * 0.2;
    const targetY = dragAreaA.y + dragAreaA.height * 0.8;
    await pageA.mouse.move(targetX, targetY, { steps: 5 });

    // Get the payload sent to B
    const payload = await pageA.evaluate(() => window.lastDragPayload);
    if (!payload) throw new Error('No drag payload captured from Page A');

    console.log('Captured drag move payload:', { x: payload.x, y: payload.y });

    // Manually trigger the visual sync on Page B
    const mirroredPos = await pageB.evaluate((p) => {
        // Mock the ghost tile for localizeDragPosition to work (it looks for .drag-ghost)
        let ghost = document.querySelector('.drag-ghost');
        if (!ghost) {
            ghost = document.createElement('div');
            ghost.className = 'drag-ghost';
            document.body.appendChild(ghost);
        }
        
        // This is what onMultiplayerDragMove does
        const pos = window.localizeDragPosition(p);
        ghost.style.left = pos.x + 'px';
        ghost.style.top = pos.y + 'px';
        return pos;
    }, payload);

    console.log('Mirrored position on Page B:', mirroredPos);

    // Verification:
    // Page A moved to (0.2, 0.8) relative to drag area.
    // Page B should see it at (0.8, 0.2) relative to its drag area.
    const expectedX = dragAreaB.x + dragAreaB.width * 0.8;
    const expectedY = dragAreaB.y + dragAreaB.height * 0.2;

    const tolerance = 5; // pixels
    const dx = Math.abs(mirroredPos.x - expectedX);
    const dy = Math.abs(mirroredPos.y - expectedY);

    console.log(`Expected mirrored pos: (${expectedX}, ${expectedY}). Actual: (${mirroredPos.x}, ${mirroredPos.y})`);
    console.log(`Diff: dx=${dx}, dy=${dy}`);

    if (dx > tolerance || dy > tolerance) {
        throw new Error('Drag position was NOT correctly mirrored for the opponent!');
    }

    console.log('DRAG MIRRORING TEST PASSED');

  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
    server.close();
  }
}

runTests();
