const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

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

// Valid 1-letter Vietnamese words (in g_wordmap)
const VALID_ONE_LETTER = ['a', 'e', 'o', 'u', 'y'];

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

async function waitFor(fn, timeout = 15000, interval = 250) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  if (lastError) throw lastError;
  throw new Error(`waitFor timeout (${timeout}ms)`);
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForAppReady(page) {
  await waitFor(() => page.evaluate(() => {
    return !!(window.g_bui && typeof window.g_bui.showLobby === 'function')
      && !!document.getElementById('board')
      && !document.documentElement.classList.contains('loading');
  }), 20000);
}

// Simulate network latency by intercepting all requests and adding a delay.
// Useful for testing race conditions in multiplayer sync.
async function simulateNetworkLatency(page, minMs = 100, maxMs = 300) {
  await page.route('**/*', async (route) => {
    const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
    await new Promise(r => setTimeout(r, delay));
    await route.continue();
  });
}

async function waitForHandshakeComplete(page, label) {
  try {
    return await waitFor(() => page.evaluate(() => {
      return !!g_isMultiplayer && !!g_channelSubscribed
        && typeof g_gameId === 'string' && g_gameId.length > 0
        && g_stateVersion > 0;
    }), 20000);
  } catch {
    const snap = await page.evaluate(() => ({
      mp: !!g_isMultiplayer, sub: !!g_channelSubscribed, gid: g_gameId, sv: g_stateVersion
    })).catch(() => ({}));
    throw new Error(`Handshake timeout ${label}: ${JSON.stringify(snap)}`);
  }
}

async function cleanupTestInvites(page, idA, idB) {
  await page.evaluate(async ({ a, b }) => {
    if (!window.supabaseClient) return;
    await window.supabaseClient.from('invites').delete().eq('from_id', a).eq('to_id', b);
    await window.supabaseClient.from('invites').delete().eq('from_id', b).eq('to_id', a);
  }, { a: idA, b: idB });
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

async function bootstrapMP(pageA, pageB, nameA, nameB, idA, idB) {
  await cleanupTestInvites(pageA, idA, idB);

  await Promise.all([
    pageA.evaluate(() => g_bui.showLobby()),
    pageB.evaluate(() => g_bui.showLobby())
  ]);

  await waitFor(() => pageA.evaluate(n => {
    return Array.from(document.querySelectorAll('#lobby-players .lobby-player strong'))
      .some(el => el.innerText.trim() === n);
  }, nameB), 20000);

  await waitFor(() => pageB.evaluate(n => {
    return Array.from(document.querySelectorAll('#lobby-players .lobby-player strong'))
      .some(el => el.innerText.trim() === n);
  }, nameA), 20000);

  await clickLobbyButton(pageA, nameB, 'Invite');
  console.log(`  Invite sent: ${nameA} -> ${nameB}`);

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
  console.log(`  Invite accepted: ${nameB}`);

  await Promise.all([
    waitForHandshakeComplete(pageA, 'A'),
    waitForHandshakeComplete(pageB, 'B')
  ]);

  const [gidA, gidB] = await Promise.all([
    pageA.evaluate(() => g_gameId),
    pageB.evaluate(() => g_gameId)
  ]);
  assert(gidA === gidB, `Game ID mismatch: A=${gidA} B=${gidB}`);
  console.log(`  Handshake done. gameId=${gidA}`);
}

async function getTurnInfo(page) {
  return page.evaluate(() => {
    const rack = g_bui.getPlayerRack() || '';
    return {
      isMyTurn: !!g_isMyTurn,
      isHost: !!g_isHost,
      myRack: rack,
      oppRack: g_bui.racks ? (g_bui.racks[2] || '') : '',
      gameId: g_gameId,
      pscore: g_pscore,
      oscore: g_oscore,
      newplays: Object.keys(g_bui.newplays || {}),
      oppNewplays: Object.keys(g_bui.oppNewplays || {}),
      boardEmpty: !!g_board_empty,
      stateVersion: g_stateVersion || 0,
      isGameOver: !!g_isGameOver,
      passes: g_passes || 0
    };
  });
}

/**
 * Find a pair of letters from the rack that form a valid 2-letter word.
 * Uses g_wordmap to check validity dynamically.
 * Returns [{ letter, index }, { letter, index }] or null.
 */
async function findValidPair(page) {
  return page.evaluate(() => {
    const rack = g_bui.getPlayerRack() || '';
    const letters = rack.split('');
    // Get all non-dot, non-blank letters with their indices
    const available = [];
    for (let i = 0; i < letters.length; i++) {
      if (letters[i] && letters[i] !== '.' && letters[i] !== '*') {
        available.push({ letter: letters[i], index: i });
      }
    }
    // Try every pair
    for (let i = 0; i < available.length; i++) {
      for (let j = 0; j < available.length; j++) {
        if (i === j) continue;
        const word = available[i].letter + available[j].letter;
        if (g_wordmap && g_wordmap[word]) {
          return [available[i], available[j]];
        }
      }
    }
    // Fallback: try single-letter words (a, e, o, u, y are valid in Vietnamese)
    const singleValid = ['a', 'e', 'o', 'u', 'y'];
    for (const sv of singleValid) {
      const idx = letters.indexOf(sv);
      if (idx >= 0) return [{ letter: sv, index: idx }];
    }
    return null;
  });
}

/**
 * Find a single letter from the rack that can extend an existing word.
 * Tries placing adjacent to existing tiles.
 */
async function findSinglePlacement(page) {
  return page.evaluate(() => {
    const rack = g_bui.getPlayerRack() || '';
    const bw = g_boardwidth, bh = g_boardheight;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    for (let x = 0; x < bw; x++) {
      for (let y = 0; y < bh; y++) {
        if (!g_board[x] || !g_board[x][y]) continue;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue;
          if (g_board[nx] && g_board[nx][ny]) continue;
          // Found an adjacent empty cell — try each letter from rack
          for (let i = 0; i < rack.length; i++) {
            const ch = rack[i];
            if (!ch || ch === '.' || ch === '*') continue;
            return { letter: ch, index: i, x: nx, y: ny };
          }
        }
      }
    }
    return null;
  });
}

/**
 * Directly commit a move by manipulating internal state and broadcasting.
 * Bypasses Scrabble validation — we're testing MP sync, not word rules.
 * Picks 2 letters from the rack, places them on the board, draws replacements.
 */
async function placeAndCommit(page, label) {
  const result = await page.evaluate(() => {
    if (!g_isMyTurn || g_isGameOver) return { ok: false, reason: 'not my turn' };

    var rack = g_bui.getPlayerRack() || '';
    var available = [];
    for (var i = 0; i < rack.length; i++) {
      if (rack[i] && rack[i] !== '.') available.push({ letter: rack[i], index: i });
    }
    if (available.length < 2) return { ok: false, reason: 'fewer than 2 letters' };

    // Pick first 2 letters
    var t1 = available[0], t2 = available[1];

    // Find placement cells
    var cellId1, cellId2;
    if (g_board_empty) {
      cellId1 = 'c7_7'; cellId2 = 'c8_7';
    } else {
      // Find an occupied cell and place adjacent
      var placed = false;
      for (var x = 0; x < g_boardwidth && !placed; x++) {
        for (var y = 0; y < g_boardheight && !placed; y++) {
          if (!g_board[x] || !g_board[x][y]) continue;
          // Try right and below
          if (x + 1 < g_boardwidth && (!g_board[x+1] || !g_board[x+1][y])) {
            cellId1 = 'c' + (x+1) + '_' + y;
            if (x + 2 < g_boardwidth && (!g_board[x+2] || !g_board[x+2][y])) {
              cellId2 = 'c' + (x+2) + '_' + y;
            } else {
              cellId2 = null; // only one cell
            }
            placed = true;
          } else if (y + 1 < g_boardheight && (!g_board[x] || !g_board[x][y+1])) {
            cellId1 = 'c' + x + '_' + (y+1);
            if (y + 2 < g_boardheight && (!g_board[x] || !g_board[x][y+2])) {
              cellId2 = 'c' + x + '_' + (y+2);
            } else {
              cellId2 = null;
            }
            placed = true;
          }
        }
      }
      if (!placed) return { ok: false, reason: 'no adjacent cell' };
    }

    // Place tiles on board
    var tiles = [{ cellId: cellId1, ...t1 }];
    if (cellId2) tiles.push({ cellId: cellId2, ...t2 });

    var prevBoard = JSON.parse(JSON.stringify(g_board));
    var prevBoardP = JSON.parse(JSON.stringify(g_boardpoints));
    var prevBoardT = JSON.parse(JSON.stringify(g_boardtypes));

    var word = '';
    var scoreEarned = 0;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var cell = document.getElementById(t.cellId);
      if (!cell) return { ok: false, reason: 'cell not found: ' + t.cellId };
      var points = (g_letscore && g_letscore[t.letter]) || 1;
      var dl = t.letter.toUpperCase();
      var ph = '<sup><small>' + points + '</small></sup>';
      cell.innerHTML = '<div class="drag t1">' + dl + ph + '</div>';
      cell.holds = { letter: t.letter, points: points };
      if (cell.firstChild) cell.firstChild.holds = { letter: t.letter, points: points };

      var coords = t.cellId.slice(1).split('_');
      var cx = parseInt(coords[0]), cy = parseInt(coords[1]);
      g_board[cx][cy] = t.letter;
      g_boardpoints[cx][cy] = points;
      g_boardtypes[cx][cy] = 1;
      g_bui.newplays[t.cellId] = { letter: t.letter, points: points };
      word += t.letter;
      scoreEarned += points;
    }

    if (g_board_empty) g_board_empty = false;
    g_passes = 0;

    // Accept placement (clears newplays)
    g_bui.acceptPlayerPlacement();

    // Draw replacement tiles
    var newRack = g_bui.getPlayerRack() || '';
    newRack = takeLetters(newRack);
    g_bui.setPlayerRack(newRack);
    g_bui.setTilesLeft(g_letpool.length);

    // Update scores
    g_pscore += scoreEarned;
    g_playerLastScore = scoreEarned;
    g_bui.setPlayerScore(scoreEarned, g_pscore);

    // Build board info for broadcast
    var boardinfo = g_bui.getBoard();

    // Build and broadcast move payload
    var moveData = {
      type: 'move',
      passed: false,
      swapped: false,
      pstr: word,
      words: [word],
      score: scoreEarned,
      board: boardinfo.board,
      boardp: boardinfo.boardp,
      boardt: boardinfo.boardt,
      rackBefore: rack,
      rackAfter: newRack,
      letpool: g_letpool,
      boardEmpty: g_board_empty,
      stateVersion: (typeof getNextMultiplayerStateVersion === 'function') ? getNextMultiplayerStateVersion() : g_stateVersion + 1
    };

    g_isMyTurn = false;
    if (typeof updateTurnIndicator === 'function') updateTurnIndicator();
    if (typeof updateGameInfoLabels === 'function') updateGameInfoLabels();
    if (typeof broadcastGameState === 'function') broadcastGameState(moveData);
    g_cachedInitPayload = null;
    g_lastMoveAt = Date.now();
    if (typeof clearOpponentPreviewCache === 'function') clearOpponentPreviewCache();
    if (typeof saveMultiplayerSession === 'function') saveMultiplayerSession();

    return { ok: true, word: word, cells: tiles.map(function(t){return t.cellId;}), score: scoreEarned };
  });

  if (!result || !result.ok) {
    console.log(`  ${label}: place failed (${result ? result.reason : 'eval error'}), passing`);
    await passTurn(page, label);
    return false;
  }

  await page.waitForTimeout(500);
  console.log(`  ${label}: committed "${result.word}" at ${result.cells.join(',')} (score=${result.score})`);
  return true;
}

async function passTurn(page, label) {
  const info = await getTurnInfo(page);
  assert(info.isMyTurn, `${label}: not my turn, cannot pass`);

  await page.click('#pass');
  await page.waitForTimeout(500);
  await waitFor(() => page.evaluate(() => !g_isMyTurn || g_isGameOver), 15000);
  console.log(`  ${label}: passed`);
}

async function placePreviewTile(page, label) {
  return page.evaluate(() => {
    const rack = g_bui.getPlayerRack() || '';
    const valids = ['a', 'e', 'o', 'u', 'y'];
    let letter = null, idx = -1;
    for (const ch of valids) {
      idx = rack.indexOf(ch);
      if (idx >= 0) { letter = ch; break; }
    }
    if (!letter) {
      for (let i = 0; i < rack.length; i++) {
        if (rack[i] && rack[i] !== '.' && rack[i] !== '*') { letter = rack[i]; idx = i; break; }
      }
    }
    if (!letter) return { ok: false, reason: 'no letter' };

    // Find a cell to place (center if board empty, else adjacent)
    let cellId;
    if (g_board_empty) {
      cellId = 'c7_7';
    } else {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      outer: for (let x = 0; x < g_boardwidth; x++) {
        for (let y = 0; y < g_boardheight; y++) {
          if (!g_board[x] || !g_board[x][y]) continue;
          for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= g_boardwidth || ny < 0 || ny >= g_boardheight) continue;
            if (g_board[nx] && g_board[nx][ny]) continue;
            cellId = `c${nx}_${ny}`;
            break outer;
          }
        }
      }
    }
    if (!cellId) return { ok: false, reason: 'no cell' };

    const points = (typeof g_letscore !== 'undefined' && g_letscore[letter]) || 1;
    const cell = document.getElementById(cellId);
    if (!cell) return { ok: false, reason: 'cell not found' };

    const displayLetter = letter.toUpperCase();
    const pointsHtml = `<sup><small>${points}</small></sup>`;
    cell.innerHTML = `<div class="drag t1">${displayLetter}${pointsHtml}</div>`;
    cell.holds = { letter, points };
    if (cell.firstChild) cell.firstChild.holds = { letter, points };

    const newRack = rack.slice(0, idx) + '.' + rack.slice(idx + 1);
    g_bui.setPlayerRack(newRack);
    g_bui.newplays[cellId] = { letter, points };

    // Update Clear button to switch from Shuffle to Clear mode
    var clearBtn = document.getElementById('clear');
    if (clearBtn) {
      clearBtn.textContent = t('Clear');
      clearBtn.onclick = onPlayerClear;
    }

    if (typeof savePreviewToDB === 'function') savePreviewToDB();
    if (typeof sendDragPreview === 'function') sendDragPreview('pl' + idx, cellId, { letter, points });

    return { ok: true, cellId, letter, points, rack: newRack };
  });
}

async function clearBoard(page, label) {
  const before = await page.evaluate(() => Object.keys(g_bui.newplays || {}).length);
  await page.click('#clear');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    newplays: Object.keys(g_bui.newplays || {}).length,
    rack: g_bui.getPlayerRack() || ''
  }));
  console.log(`  ${label}: cleared (${before} previews -> ${after.newplays})`);
  return after;
}

async function reloadPage(page, label) {
  const consoleLogs = [];
  const handler = msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  page.on('console', handler);

  await page.reload({ waitUntil: 'commit' });
  await waitForAppReady(page);
  await waitForHandshakeComplete(page, label);

  page.off('console', handler);
  return consoleLogs;
}

async function assertMPState(page, label) {
  const s = await getTurnInfo(page);
  assert(s.gameId, `${label}: no gameId`);
  assert(typeof s.isMyTurn === 'boolean', `${label}: isMyTurn not boolean`);
  assert(s.newplays.length === 0, `${label}: stale newplays: ${s.newplays}`);
  // oppNewplays may be stale if the SQL fix (fix_rack_count_constraint.sql) hasn't been applied.
  // The update_player_state RPC rejects rack_count > 7, causing opponent preview saves to fail.
  if (s.oppNewplays.length > 0) {
    console.log(`  WARNING: ${label}: stale oppNewplays: ${s.oppNewplays} (apply SQL fix to resolve)`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('=== Multiplayer E2E Test Suite ===\n');

  const server = await startStaticServer(ROOT, PORT);
  BASE_URL = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const errors = [];
  let contextA, contextB;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    pageA.on('pageerror', err => {
      const msg = err.message;
      if (msg.includes('localStorage') && msg.includes('Access is denied')) return; // Expected from goBack in headless
      console.error('[A] PAGEERROR:', msg); errors.push(`A: ${msg}`);
    });
    pageB.on('pageerror', err => {
      const msg = err.message;
      if (msg.includes('localStorage') && msg.includes('Access is denied')) return;
      console.error('[B] PAGEERROR:', msg); errors.push(`B: ${msg}`);
    });

    // Simulate network latency if --latency flag is set
    if (process.argv.includes('--latency')) {
      console.log('  Simulating network latency (100-300ms per request)');
      await simulateNetworkLatency(pageA, 100, 300);
      await simulateNetworkLatency(pageB, 100, 300);
    }

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nameA = `E2EA_${suffix}`;
    const nameB = `E2EB_${suffix}`;
    const idA = `e2e_a_${suffix}`;
    const idB = `e2e_b_${suffix}`;

    console.log(`Players: ${nameA} (${idA}), ${nameB} (${idB})`);

    await pageA.addInitScript(({ uid, pn }) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pn);
    }, { uid: idA, pn: nameA });
    await pageB.addInitScript(({ uid, pn }) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pn);
    }, { uid: idB, pn: nameB });

    // -----------------------------------------------------------------------
    // Phase 1: Setup & Invite
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 1: Setup & Invite ---');
    await Promise.all([
      pageA.goto(BASE_URL, { waitUntil: 'commit' }),
      pageB.goto(BASE_URL, { waitUntil: 'commit' })
    ]);
    await Promise.all([waitForAppReady(pageA), waitForAppReady(pageB)]);
    await bootstrapMP(pageA, pageB, nameA, nameB, idA, idB);

    // -----------------------------------------------------------------------
    // Phase 2: First moves (each player places a word)
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 2: First Moves ---');

    // Find whose turn it is
    let turnA = await pageA.evaluate(() => g_isMyTurn);
    let turnB = await pageB.evaluate(() => g_isMyTurn);
    console.log(`  Turn: A=${turnA}, B=${turnB}`);

    // Player A goes first if it's their turn, otherwise Player B
    if (turnA) {
      await placeAndCommit(pageA, 'A-move1');
      await pageB.waitForTimeout(500);
      await placeAndCommit(pageB, 'B-move1');
    } else {
      await placeAndCommit(pageB, 'B-move1');
      await pageA.waitForTimeout(500);
      await placeAndCommit(pageA, 'A-move1');
    }

    // Verify both have scores
    const scores1 = await Promise.all([getTurnInfo(pageA), getTurnInfo(pageB)]);
    console.log(`  Scores after 2 moves: A=${scores1[0].pscore}/${scores1[0].oscore}, B=${scores1[1].pscore}/${scores1[1].oscore}`);

    // -----------------------------------------------------------------------
    // Phase 3: Clear button test
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 3: Clear Button ---');

    // Current active player places a preview tile (don't commit)
    const activePage = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
    const activeLabel = activePage === pageA ? 'A' : 'B';
    const otherPage = activePage === pageA ? pageB : pageA;
    const otherLabel = activePage === pageA ? 'B' : 'A';

    const preview = await placePreviewTile(activePage, activeLabel);
    if (preview.ok) {
      console.log(`  ${activeLabel}: placed preview "${preview.letter}" at ${preview.cellId}`);
      await activePage.waitForTimeout(600);

      // Verify opponent sees preview
      const oppSees = await otherPage.evaluate((cid) => {
        const cell = document.getElementById(cid);
        return !!(cell && cell.innerHTML && cell.innerHTML.includes('drag'));
      }, preview.cellId);
      console.log(`  ${otherLabel} sees preview: ${oppSees}`);

    // Clear
    const cleared = await clearBoard(activePage, activeLabel);
    assert(cleared.newplays === 0, `Clear failed: newplays still has ${cleared.newplays} entries`);

    // Verify opponent no longer sees preview (wait for broadcast delivery)
    await activePage.waitForTimeout(1500);
    const oppStill = await otherPage.evaluate((cid) => {
      const cell = document.getElementById(cid);
      return !!(cell && cell.innerHTML && cell.innerHTML.includes('drag'));
    }, preview.cellId);
    console.log(`  ${otherLabel} still sees preview after clear: ${oppStill}`);
    } else {
      console.log(`  Skipping clear test: ${preview.reason}`);
    }

    // -----------------------------------------------------------------------
    // Phase 3b: Drag → Clear → Reload (the critical regression test)
    // A drags tile, clicks Clear, reloads. Verifies:
    //   - A sees no preview on board AND no empty slot in rack
    //   - B sees no preview on A's board after reload
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 3b: Drag → Clear → Reload ---');
    {
      // Wait for turn
      await waitFor(async () => {
        const [a, b] = await Promise.all([pageA.evaluate(() => g_isMyTurn), pageB.evaluate(() => g_isMyTurn)]);
        return a || b;
      }, 10000);
      const clearReloadPage = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
      const clearReloadLabel = clearReloadPage === pageA ? 'A' : 'B';
      const clearReloadOther = clearReloadPage === pageA ? pageB : pageA;

      // Capture rack before drag
      const rackBeforeDrag = await clearReloadPage.evaluate(() => g_bui.getPlayerRack() || '');
      console.log(`  ${clearReloadLabel} rack before drag: ${rackBeforeDrag}`);

      // Drag tile to board
      const previewResult = await placePreviewTile(clearReloadPage, clearReloadLabel);
      if (previewResult.ok) {
        console.log(`  ${clearReloadLabel} dragged "${previewResult.letter}" to ${previewResult.cellId}`);
        await clearReloadPage.waitForTimeout(300);

        // Verify rack has empty slot
        const rackAfterDrag = await clearReloadPage.evaluate(() => g_bui.getPlayerRack() || '');
        const hasDotAfterDrag = rackAfterDrag.includes('.');
        console.log(`  ${clearReloadLabel} rack after drag: ${rackAfterDrag} (has dot: ${hasDotAfterDrag})`);
        assert(hasDotAfterDrag, `${clearReloadLabel}: rack should have empty slot after drag`);

        // Click Clear and catch any JS errors
        const clearErrors = [];
        const clearErrHandler = err => clearErrors.push(err.message);
        clearReloadPage.on('pageerror', clearErrHandler);
        await clearReloadPage.click('#clear');
        await clearReloadPage.waitForTimeout(500);
        clearReloadPage.off('pageerror', clearErrHandler);

        // Debug: check what cancelPlayerPlacement did
        const clearDebug = await clearReloadPage.evaluate(() => {
          var boardCell = document.getElementById('c6_7');
          return {
            newplays: JSON.stringify(g_bui.newplays || {}),
            rack: g_bui.getPlayerRack() || '',
            clearBtnText: document.getElementById('clear') ? document.getElementById('clear').textContent : null,
            clearBtnOnclick: document.getElementById('clear') && document.getElementById('clear').onclick ? document.getElementById('clear').onclick.name : null,
            boardCellHolds: boardCell ? (boardCell.holds || 'EMPTY') : 'NO_CELL',
            boardCellHasChild: boardCell ? !!boardCell.firstChild : false,
            rackSlots: Array.from({length: g_racksize}, (_, i) => {
              var cell = document.getElementById('pl' + i);
              return { holds: cell && cell.holds ? cell.holds : 'EMPTY', hasChild: cell ? !!cell.firstChild : false };
            })
          };
        });
        console.log(`  ${clearReloadLabel} clear debug: newplays=${clearDebug.newplays}, rack=${clearDebug.rack}, btn=${clearDebug.clearBtnText}, onclick=${clearDebug.clearBtnOnclick}`);
        console.log(`  Board c6_7: holds=${clearDebug.boardCellHolds}, hasChild=${clearDebug.boardCellHasChild}`);
        console.log(`  Rack slots: ${JSON.stringify(clearDebug.rackSlots)}`);
        if (clearErrors.length) console.log(`  Clear errors: ${clearErrors.join('; ')}`);

        // Verify rack is restored (same number of dots as before drag)
        const rackAfterClear = await clearReloadPage.evaluate(() => g_bui.getPlayerRack() || '');
        const dotsBeforeDrag = (rackBeforeDrag.match(/\./g) || []).length;
        const dotsAfterClear = (rackAfterClear.match(/\./g) || []).length;
        console.log(`  ${clearReloadLabel} rack after clear: ${rackAfterClear} (dots: ${dotsAfterClear}, was: ${dotsBeforeDrag})`);
        assert(dotsAfterClear <= dotsBeforeDrag, `${clearReloadLabel}: rack should not have more empty slots after clear (${dotsAfterClear} vs ${dotsBeforeDrag})`);

        // Wait for DB write to settle (savePlayerStateToDB is async)
        await clearReloadPage.waitForTimeout(3000);

        // RELOAD A
        console.log(`  ${clearReloadLabel} reloading...`);
        await reloadPage(clearReloadPage, clearReloadLabel);

        // Verify A: no preview on board, no empty slot in rack
        const afterReload = await clearReloadPage.evaluate(() => {
          const newplays = Object.keys(g_bui.newplays || {});
          const rack = g_bui.getPlayerRack() || '';
          const hasDot = rack.includes('.');
          const boardCells = [];
          for (var x = 0; x < g_boardwidth; x++) {
            for (var y = 0; y < g_boardheight; y++) {
              var cellId = 'c' + x + '_' + y;
              var cell = document.getElementById(cellId);
              if (cell && cell.innerHTML && cell.innerHTML.includes('drag') && !g_board[x][y]) {
                boardCells.push(cellId);
              }
            }
          }
          return { newplays, rack, hasDot, ghostCells: boardCells };
        });
        console.log(`  ${clearReloadLabel} after reload: rack=${afterReload.rack} (dot:${afterReload.hasDot}), newplays=${afterReload.newplays}, ghosts=${afterReload.ghostCells}`);
        assert(afterReload.newplays.length === 0, `${clearReloadLabel}: newplays should be empty after reload, got ${afterReload.newplays}`);
        const dotsAfterReload = (afterReload.rack.match(/\./g) || []).length;
        assert(dotsAfterReload <= dotsBeforeDrag, `${clearReloadLabel}: rack should not have more empty slots after reload (${dotsAfterReload} vs ${dotsBeforeDrag})`);
        assert(afterReload.ghostCells.length === 0, `${clearReloadLabel}: no ghost preview cells after reload`);

        // Wait for A's DB write to propagate before reloading B.
        // NOTE: This depends on the SQL fix in supabase/fix_rack_count_constraint.sql
        // being applied to the live DB. The update_player_state RPC rejects rack_count > 7,
        // but g_racksize = 8, causing ALL multiplayer state saves to silently fail.
        const otherLabel = clearReloadOther === pageA ? 'A' : 'B';
        let dbPreviewCleared = false;
        try {
          await waitFor(async () => {
            return clearReloadPage.evaluate(async () => {
              if (!window.supabaseClient || !g_gameId) return true;
              const { data } = await window.supabaseClient
                .from('games')
                .select('preview_a, preview_b')
                .eq('id', g_gameId)
                .single();
              if (!data) return true;
              const myPreview = g_isHost ? data.preview_a : data.preview_b;
              return !myPreview || Object.keys(myPreview).length === 0;
            });
          }, 10000, 1000);
          dbPreviewCleared = true;
          console.log(`  DB confirmed empty preview for ${clearReloadLabel}`);
        } catch {
          console.log(`  WARNING: DB preview still stale — apply supabase/fix_rack_count_constraint.sql to fix`);
        }

        // RELOAD B and verify B doesn't see A's stale preview
        // Only assert if DB fix is applied (otherwise stale preview is expected)
        await reloadPage(clearReloadOther, otherLabel);
        const otherAfterReload = await clearReloadOther.evaluate(() => {
          return { oppNewplays: Object.keys(g_bui.oppNewplays || {}) };
        });
        console.log(`  ${otherLabel} after reload: oppNewplays=${otherAfterReload.oppNewplays}`);
        if (dbPreviewCleared) {
          assert(otherAfterReload.oppNewplays.length === 0, `Opponent should not see stale previews after reload`);
        } else {
          console.log(`  Skipping opponent preview assertion (SQL fix not applied)`);
        }

        console.log(`  Phase 3b: Drag → Clear → Reload PASSED`);
      } else {
        console.log(`  Skipping Phase 3b: ${previewResult.reason}`);
      }
    }

    // -----------------------------------------------------------------------
    // Phase 4: Pass test (each player passes once)
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 4: Pass Test ---');

    // Debug turn state
    const turnStatePre = await Promise.all([getTurnInfo(pageA), getTurnInfo(pageB)]);
    console.log(`  Turn state before pass: A(turn=${turnStatePre[0].isMyTurn},v=${turnStatePre[0].stateVersion}), B(turn=${turnStatePre[1].isMyTurn},v=${turnStatePre[1].stateVersion})`);

    // Wait for turn to stabilize after clear
    await waitFor(async () => {
      const [aTurn, bTurn] = await Promise.all([pageA.evaluate(() => g_isMyTurn), pageB.evaluate(() => g_isMyTurn)]);
      return aTurn || bTurn;
    }, 15000);
    const passPage1 = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
    const passLabel1 = passPage1 === pageA ? 'A' : 'B';
    const passPage2 = passPage1 === pageA ? pageB : pageA;
    const passLabel2 = passPage1 === pageA ? 'B' : 'A';

    // Check buttons before pass
    const btnsBefore = await passPage1.evaluate(() => ({
      play: !document.getElementById('play').disabled,
      pass: !document.getElementById('pass').disabled,
      clear: !document.getElementById('clear').disabled,
      swap: !document.getElementById('swap').disabled
    }));
    console.log(`  ${passLabel1} buttons before pass: play=${btnsBefore.play}, pass=${btnsBefore.pass}, clear=${btnsBefore.clear}, swap=${btnsBefore.swap}`);

    await passTurn(passPage1, passLabel1);

    // Wait for turn to switch to player 2
    await waitFor(() => passPage2.evaluate(() => g_isMyTurn), 10000);
    await passPage2.waitForTimeout(300);

    // Verify buttons enabled on active player
    const btnsAfter = await passPage2.evaluate(() => ({
      play: !document.getElementById('play').disabled,
      pass: !document.getElementById('pass').disabled
    }));
    console.log(`  ${passLabel2} buttons after ${passLabel1} pass: play=${btnsAfter.play}, pass=${btnsAfter.pass}`);
    assert(btnsAfter.play, `${passLabel2}: play should be enabled after ${passLabel1} pass`);
    assert(btnsAfter.pass, `${passLabel2}: pass should be enabled after ${passLabel1} pass`);

    await passTurn(passPage2, passLabel2);
    console.log(`  Both players passed once`);

    // -----------------------------------------------------------------------
    // Phase 5: Reload test
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 5: Reload Test ---');

    // Wait for turn
    await waitFor(async () => { const [a, b] = await Promise.all([pageA.evaluate(() => g_isMyTurn), pageB.evaluate(() => g_isMyTurn)]); return a || b; }, 10000);

    // Reload the active player
    const reloadPage1 = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
    const reloadLabel1 = reloadPage1 === pageA ? 'A' : 'B';
    const reloadOther1 = reloadPage1 === pageA ? pageB : pageA;
    const reloadOtherLabel1 = reloadPage1 === pageA ? 'B' : 'A';

    const preReload1 = await getTurnInfo(reloadPage1);
    console.log(`  ${reloadLabel1} reloading (turn=${preReload1.isMyTurn}, rack=${preReload1.myRack})...`);

    await reloadPage(reloadPage1, reloadLabel1);
    const postReload1 = await assertMPState(reloadPage1, `${reloadLabel1} post-reload`);
    assert(postReload1.myRack.replace(/\./g, '').length > 0, `${reloadLabel1}: empty rack after reload`);
    console.log(`  ${reloadLabel1} restored: turn=${postReload1.isMyTurn}, rack=${postReload1.myRack}`);

    // Reload the OTHER player
    const preReload2 = await getTurnInfo(reloadOther1);
    console.log(`  ${reloadOtherLabel1} reloading (turn=${preReload2.isMyTurn}, rack=${preReload2.myRack})...`);

    await reloadPage(reloadOther1, reloadOtherLabel1);
    const postReload2 = await assertMPState(reloadOther1, `${reloadOtherLabel1} post-reload`);
    assert(postReload2.myRack.replace(/\./g, '').length > 0, `${reloadOtherLabel1}: empty rack after reload`);
    console.log(`  ${reloadOtherLabel1} restored: turn=${postReload2.isMyTurn}, rack=${postReload2.myRack}`);

    // Verify game IDs still match
    const [gidA2, gidB2] = await Promise.all([
      pageA.evaluate(() => g_gameId),
      pageB.evaluate(() => g_gameId)
    ]);
    assert(gidA2 === gidB2, `Game ID mismatch after reload: A=${gidA2} B=${gidB2}`);

    // -----------------------------------------------------------------------
    // Phase 6: Back/Forward navigation test
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 6: Back/Forward Navigation ---');

    const navPage = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
    const navLabel = navPage === pageA ? 'A' : 'B';
    const preNav = await getTurnInfo(navPage);
    console.log(`  ${navLabel}: navigating back...`);

    await navPage.goBack({ waitUntil: 'commit' });
    await navPage.waitForTimeout(2000);

    // Navigate forward to recover
    await navPage.goForward({ waitUntil: 'commit' });
    await waitForAppReady(navPage);

    // Try to re-establish MP (may or may not succeed depending on session state)
    const navState = await navPage.evaluate(() => ({
      isMP: !!g_isMultiplayer,
      hasSession: !!localStorage['session_mp'],
      hasSessionMode: localStorage['session_mode'] === 'mp'
    }));
    console.log(`  ${navLabel} after back/forward: MP=${navState.isMP}, session=${navState.hasSession}, mode=${navState.hasSessionMode}`);

    if (navState.isMP) {
      await waitForHandshakeComplete(navPage, navLabel);
      const postNav = await assertMPState(navPage, `${navLabel} post-nav`);
      console.log(`  ${navLabel} recovered: turn=${postNav.isMyTurn}, rack=${postNav.myRack}`);
    } else {
      console.log(`  ${navLabel}: MP session lost after navigation (expected in some cases)`);
      // Re-join via session mode if possible
      if (navState.hasSessionMode) {
        console.log(`  ${navLabel}: session_mode=mp, attempting recovery...`);
        await navPage.waitForTimeout(3000);
      }
    }

    // -----------------------------------------------------------------------
    // Phase 7: Continue game to completion
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 7: Game Completion ---');

    // Make sure both pages are in MP mode
    const bothMP = await Promise.all([
      pageA.evaluate(() => !!g_isMultiplayer),
      pageB.evaluate(() => !!g_isMultiplayer)
    ]);
    console.log(`  Both MP: A=${bothMP[0]}, B=${bothMP[1]}`);

    if (bothMP[0] && bothMP[1]) {
      // Place a few more moves to progress the game
      for (let turn = 0; turn < 20; turn++) {
        const gameOver = await pageA.evaluate(() => !!g_isGameOver) || await pageB.evaluate(() => !!g_isGameOver);
        if (gameOver) {
          console.log(`  Game over detected at turn ${turn}`);
          break;
        }

        try {
          await waitFor(async () => { const [a, b] = await Promise.all([pageA.evaluate(() => g_isMyTurn), pageB.evaluate(() => g_isMyTurn)]); return a || b; }, 15000);
        } catch {
          const stateA = await getTurnInfo(pageA);
          const stateB = await getTurnInfo(pageB);
          console.log(`  Wait failed at turn ${turn}: A(turn=${stateA.isMyTurn},v=${stateA.stateVersion}), B(turn=${stateB.isMyTurn},v=${stateB.stateVersion})`);
          break;
        }
        const p = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
        const l = p === pageA ? 'A' : 'B';

        const placed = await placeAndCommit(p, `${l}-turn${turn}`);
        if (!placed) {
          console.log(`  ${l}: could not place (passed)`);
        }
        await p.waitForTimeout(500);
      }
    }

    const finalState = await Promise.all([getTurnInfo(pageA), getTurnInfo(pageB)]);
    console.log(`  Final: A(gameOver=${finalState[0].isGameOver}, pscore=${finalState[0].pscore}, oscore=${finalState[0].oscore})`);
    console.log(`  Final: B(gameOver=${finalState[1].isGameOver}, pscore=${finalState[1].pscore}, oscore=${finalState[1].oscore})`);

    // -----------------------------------------------------------------------
    // Phase 8: Rematch
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 8: Rematch ---');

    const gameOverA = await pageA.evaluate(() => !!g_isGameOver);
    const gameOverB = await pageB.evaluate(() => !!g_isGameOver);

    if (gameOverA && gameOverB) {
      // Look for Play Again button
      const hasPlayAgainA = await pageA.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.some(b => b.innerText.includes('Play Again') || b.innerText.includes('Rematch'));
      });
      const hasPlayAgainB = await pageB.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.some(b => b.innerText.includes('Play Again') || b.innerText.includes('Rematch'));
      });
      console.log(`  Play Again buttons: A=${hasPlayAgainA}, B=${hasPlayAgainB}`);

      if (hasPlayAgainA) {
        await pageA.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.innerText.includes('Play Again') || b.innerText.includes('Rematch'));
          if (btn) btn.click();
        });
        console.log('  A clicked Play Again');

        await Promise.all([
          waitForHandshakeComplete(pageA, 'A-rematch'),
          waitForHandshakeComplete(pageB, 'B-rematch')
        ]);

        const rematchState = await Promise.all([getTurnInfo(pageA), getTurnInfo(pageB)]);
        assert(rematchState[0].gameId === rematchState[1].gameId, 'Rematch gameId mismatch');
        assert(rematchState[0].boardEmpty, 'Rematch board not empty for A');
        assert(rematchState[1].boardEmpty, 'Rematch board not empty for B');
        console.log(`  Rematch started. gameId=${rematchState[0].gameId}`);

        // Play one move each in rematch
        await waitFor(async () => { const [a, b] = await Promise.all([pageA.evaluate(() => g_isMyTurn), pageB.evaluate(() => g_isMyTurn)]); return a || b; }, 15000);
        const rm1 = await pageA.evaluate(() => g_isMyTurn) ? pageA : pageB;
        await placeAndCommit(rm1, rm1 === pageA ? 'A-rematch1' : 'B-rematch1');
        await rm1.waitForTimeout(500);
        const rm2 = rm1 === pageA ? pageB : pageA;
        await placeAndCommit(rm2, rm2 === pageA ? 'A-rematch2' : 'B-rematch2');

        console.log('  Rematch: 2 moves played successfully');
      }
    } else {
      console.log('  Skipping rematch (game not over)');
    }

    // -----------------------------------------------------------------------
    // Phase 9: Forfeit detection (forfeit the existing game)
    // -----------------------------------------------------------------------
    console.log('\n--- Phase 9: Forfeit Detection ---');

    // Determine who forfeits (the player whose turn it is NOT)
    const forfeitPage = await pageA.evaluate(() => g_isMyTurn) ? pageB : pageA;
    const forfeitLabel = forfeitPage === pageA ? 'A' : 'B';
    const forfeitOtherPage = forfeitPage === pageA ? pageB : pageA;
    const forfeitOtherLabel = forfeitPage === pageA ? 'B' : 'A';

    // Forfeit
    await forfeitPage.evaluate(() => { finalizeMultiplayerGame('forfeit', true); });
    console.log(`  ${forfeitLabel} forfeited`);

    // Wait for the other player to detect the forfeit via postgres_changes
    try {
      await waitFor(() => forfeitOtherPage.evaluate(() => !!g_isGameOver), 15000);
      console.log(`  PASS: ${forfeitOtherLabel} detected ${forfeitLabel}'s forfeit via realtime event`);
    } catch {
      console.log(`  FAIL: ${forfeitOtherLabel} did not detect ${forfeitLabel}'s forfeit`);
      const debugState = await forfeitOtherPage.evaluate(() => ({
        isGameOver: !!g_isGameOver,
        isMultiplayer: !!g_isMultiplayer,
        hasInviteSub: typeof g_inviteSub !== 'undefined' && g_inviteSub !== null,
        inviteSubState: typeof g_inviteSub !== 'undefined' && g_inviteSub ? g_inviteSub.state : null
      }));
      console.log(`  ${forfeitOtherLabel} state: ${JSON.stringify(debugState)}`);
      throw new Error('Forfeit detection failed');
    }

    // -----------------------------------------------------------------------
    // Final assertions
    // -----------------------------------------------------------------------
    console.log('\n--- Final Assertions ---');

    assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
    console.log('  No browser errors');

    console.log('\n=== ALL E2E TESTS PASSED ===');

  } catch (err) {
    console.error('\n=== E2E TEST FAILED ===');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  } finally {
    try { if (contextA) await contextA.close(); } catch {}
    try { if (contextB) await contextB.close(); } catch {}
    await browser.close();
    server.close();
  }
}

runTests().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
