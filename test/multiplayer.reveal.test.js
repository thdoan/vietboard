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
    pageA.on('pageerror', err => console.log(`[A] PAGEERROR: ${err.message}`));
    pageB.on('pageerror', err => console.log(`[B] PAGEERROR: ${err.message}`));

    // Set IDs and names
    const idA = 'user_A';
    const idB = 'user_B';
    await pageA.evaluateOnNewDocument((id) => localStorage.setItem('lobby_user_id', id), idA);
    await pageB.evaluateOnNewDocument((id) => localStorage.setItem('lobby_user_id', id), idB);

    await pageA.goto(BASE_URL);
    await pageB.goto(BASE_URL);

    // Mock alert and getPlayerPlacement
    await pageA.evaluate(() => {
        window.alert = (msg) => console.log('ALERT A:', msg);
        window.g_bui.getPlayerPlacement = () => {
            const placements = [];
            for (let id in window.g_bui.newplays) {
                const holds = window.g_bui.newplays[id];
                if (!holds) continue;
                const parts = id.slice(1).split('_');
                const x = parseInt(parts[0], 10);
                const y = parseInt(parts[1], 10);
                placements.push({ 
                    id: id, 
                    x: x, 
                    y: y, 
                    ltr: holds.letter, 
                    lsc: holds.points 
                });
            }
            return placements;
        };
        
        // Force turn during onMultiplayerMove
        const originalOnMultiplayerMove = window.onMultiplayerMove;
        window.onMultiplayerMove = function() {
            window.g_isMyTurn = true;
            return originalOnMultiplayerMove.apply(this, arguments);
        };
    });
    await pageB.evaluate(() => window.alert = (msg) => console.log('ALERT B:', msg));

    // Join lobby
    await pageA.evaluate(() => window.showLobby());
    await pageB.evaluate(() => window.showLobby());

    // Wait for B to appear in A's lobby
    await pageA.waitForFunction(() => {
        const players = Array.from(document.querySelectorAll('.lobby-player strong')).map(el => el.innerText);
        return players.length > 0;
    });

    // Invite B from A
    await pageA.evaluate(() => {
        const playerEl = document.querySelector('.lobby-player');
        playerEl.click();
    });

    // Wait for game to start for both (modal closes)
    await pageA.waitForFunction(() => !document.getElementById('modal-mask') || document.getElementById('modal-mask').style.display === 'none');
    await pageB.waitForFunction(() => !document.getElementById('modal-mask') || document.getElementById('modal-mask').style.display === 'none');

    console.log('Game started');

    // Wait for initial sync to settle
    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    const initBoardMatrices = (p) => p.evaluate(() => {
        window.g_isMultiplayer = true;
        window.g_board_empty = true;
        const width = (typeof g_boardwidth !== 'undefined') ? g_boardwidth : 15;
        const height = (typeof g_boardheight !== 'undefined') ? g_boardheight : 15;
        window.g_board = [];
        window.g_boardpoints = [];
        window.g_boardtypes = [];
        for (let x=0; x<width; x++) {
            window.g_board[x] = [];
            window.g_boardpoints[x] = [];
            window.g_boardtypes[x] = [];
            for (let y=0; y<height; y++) {
                window.g_board[x][y] = '';
                window.g_boardpoints[x][y] = 0;
                window.g_boardtypes[x][y] = 0;
            }
        }
    });

    await initBoardMatrices(pageA);
    await initBoardMatrices(pageB);

    await pageA.evaluate(() => {
        window.g_isMyTurn = true;
        // Vietnamese word 'ba' (father)
        g_bui.setPlayerRack('ba......');
        window.updateTurnIndicator();
    });
    await pageB.evaluate(() => {
        window.g_isMyTurn = false;
        window.updateTurnIndicator();
    });

    // Player A places 'ba'
    console.log('Player A: Dragging tiles to board...');
    
    async function dragTile(page, sourceId, targetId) {
        const holds = await page.evaluate((sid) => document.getElementById(sid).holds, sourceId);
        const source = await page.$(`#${sourceId} .drag`);
        const target = await page.$(`#${targetId}`);
        const sourceBox = await source.boundingBox();
        const targetBox = await target.boundingBox();
        
        await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
        await page.mouse.up();
        
        await page.evaluate((tid, sid, h) => {
            const tcell = document.getElementById(tid);
            tcell.holds = h;
            window.g_bui.newplays[tid] = h;
        }, targetId, sourceId, holds);
    }

    // A places at top-left: c0_0 and c1_0
    await dragTile(pageA, 'pl0', 'c0_0');
    await dragTile(pageA, 'pl1', 'c1_0');

    // Capture the broadcast from Page A
    const movePayload = await pageA.evaluate(async () => {
      try {
        let capturedPayload = null;
        const originalBroadcast = window.broadcastGameState;
        window.broadcastGameState = (payload) => {
            if (payload.type === 'move') {
                capturedPayload = JSON.parse(JSON.stringify(payload));
            }
            originalBroadcast(payload);
        };
        
        window.g_isMyTurn = true;
        // Ensure g_board is up to date for checkValidPlacement
        for (let tid in window.g_bui.newplays) {
            if (window.g_bui.newplays[tid]) {
                const parts = tid.slice(1).split('_');
                window.g_board[parseInt(parts[0])][parseInt(parts[1])] = window.g_bui.newplays[tid].letter;
            }
        }

        onMultiplayerMove();
        
        for (let i = 0; i < 50; i++) {
            if (capturedPayload) return capturedPayload;
            await new Promise(r => setTimeout(r, 100));
        }
        return null;
      } catch (e) {
        console.log('Eval Error: ' + e.message);
        return null;
      }
    });

    if (!movePayload) throw new Error('Failed to capture move broadcast from Player A');
    console.log('Captured move payload from A');

    // Delivery of move to Page B
    await pageB.evaluate((payload) => {
        handleMoveBroadcast(payload);
    }, movePayload);

    // Wait for Player B to receive move and update turn
    let playEnabledB = false;
    for (let i = 0; i < 50; i++) {
        playEnabledB = await pageB.evaluate(() => !document.getElementById('play').disabled);
        if (playEnabledB) break;
        await new Promise(r => setTimeout(r, 200));
    }
    if (!playEnabledB) throw new Error('Timeout waiting for Player B turn update (Play button still disabled)');
    console.log('Player B turn updated');

    // Check Player B's board at c14_14 and c13_14 (mirrored of c0_0 and c1_0)
    const boardStateB = await pageB.evaluate(() => {
        const cell1 = document.getElementById('c14_14');
        const cell2 = document.getElementById('c13_14');
        return [
            {
                letter: cell1 && cell1.holds ? cell1.holds.letter : (cell1 ? cell1.innerText.trim()[0] : null),
                isVisible: cell1 && cell1.querySelector('.drag') ? cell1.querySelector('.drag').innerText.trim().length > 0 : false
            },
            {
                letter: cell2 && cell2.holds ? cell2.holds.letter : (cell2 ? cell2.innerText.trim()[0] : null),
                isVisible: cell2 && cell2.querySelector('.drag') ? cell2.querySelector('.drag').innerText.trim().length > 0 : false
            }
        ];
    });

    console.log('Player B board at c14_14, c13_14:', boardStateB);

    if (!boardStateB[0].isVisible || !boardStateB[1].isVisible) {
        throw new Error('Tiles are NOT visible for Player B at mirrored positions!');
    }

    console.log('REVEAL, TURN SYNC AND MIRRORING TEST PASSED');

  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
    server.close();
  }
}

runTests();
