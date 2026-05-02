const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 0;

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
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  if (lastError) throw lastError;
  throw new Error('Timeout waiting for condition');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForAppReady(page) {
  await waitFor(async () => {
    return page.evaluate(() => {
      const hasUi = !!(window.g_bui && typeof window.g_bui.showLobby === 'function');
      const hasBoard = !!document.getElementById('board');
      const isLoading = document.documentElement.classList.contains('loading');
      const hasModalRefs = !!(window.g_cache && g_cache.modalContainer && g_cache.modalMask && g_cache.modalInner && g_cache.modalContent);
      return hasUi && hasBoard && hasModalRefs && !isLoading;
    });
  }, 10000, 250);
}

async function getMpRuntimeState(page) {
  return page.evaluate(() => ({
    isMultiplayer: !!g_isMultiplayer,
    channelSubscribed: (typeof g_channelSubscribed !== 'undefined') ? !!g_channelSubscribed : false,
    channelSubscribing: (typeof g_channelSubscribing !== 'undefined') ? !!g_channelSubscribing : false,
    activeChannelType: (typeof g_activeChannelType !== 'undefined' && g_activeChannelType) ? g_activeChannelType : null,
    gameId: g_gameId || null,
    isHost: !!g_isHost,
    connectingInvites: (typeof g_connectingInvites !== 'undefined' && g_connectingInvites) ? Array.from(g_connectingInvites) : [],
    stateVersion: (typeof g_stateVersion !== 'undefined') ? g_stateVersion : 0
  }));
}

async function waitForHandshakeComplete(page, label = 'player') {
  try {
    return await waitFor(async () => {
      const state = await getMpRuntimeState(page);
      return state.isMultiplayer &&
        state.channelSubscribed &&
        state.activeChannelType === 'game' &&
        typeof state.gameId === 'string' &&
        state.gameId.length > 0 &&
        typeof state.stateVersion === 'number' &&
        state.stateVersion > 0;
    }, 10000);
  } catch (err) {
    const snapshot = await getMpRuntimeState(page).catch(() => ({ error: 'unable to capture state' }));
    throw new Error(`Handshake timeout for ${label}: ${JSON.stringify(snapshot)}`);
  }
}

async function getLobbyPlayers(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#lobby-players .lobby-player strong')).map(el => el.innerText.trim())
  );
}

async function waitForPlayerVisibleInLobby(page, playerName) {
  await waitFor(async () => {
    const names = await getLobbyPlayers(page);
    return names.includes(playerName);
  }, 10000);
}

async function clickLobbyActionButton(page, playerName, expectedButtonText) {
  const clicked = await page.evaluate(({ targetName, expectedText }) => {
    const rows = Array.from(document.querySelectorAll('#lobby-players .lobby-player'));
    for (const row of rows) {
      const strong = row.querySelector('strong');
      if (!strong || strong.innerText.trim() !== targetName) continue;
      const btn = row.querySelector('button');
      if (!btn) return false;
      if (expectedText && btn.innerText.trim() !== expectedText) return false;
      btn.click();
      return true;
    }
    return false;
  }, { targetName: playerName, expectedText: expectedButtonText });

  assert(clicked, `Could not click ${expectedButtonText || 'action'} for ${playerName}`);
}

async function cleanupTestInvites(page, ids) {
  const { idA, idB } = ids;
  await page.evaluate(async ({ idA, idB }) => {
    if (!window.supabaseClient) return;
    await window.supabaseClient.from('invites').delete().eq('from_id', idA).eq('to_id', idB);
    await window.supabaseClient.from('invites').delete().eq('from_id', idB).eq('to_id', idA);
  }, { idA, idB });
}

async function bootstrapMultiplayerViaInvite({ pageA, pageB, nameA, nameB, ids }) {
  await cleanupTestInvites(pageA, ids);

  await Promise.all([
    pageA.evaluate(() => g_bui.showLobby()),
    pageB.evaluate(() => g_bui.showLobby())
  ]);

  await Promise.all([
    waitForPlayerVisibleInLobby(pageA, nameB),
    waitForPlayerVisibleInLobby(pageB, nameA)
  ]);

  await clickLobbyActionButton(pageA, nameB, 'Invite');
  console.log(`Invite clicked: ${nameA} -> ${nameB}`);

  await waitFor(async () => {
    const hasAccept = await pageB.evaluate((targetName) => {
      const rows = Array.from(document.querySelectorAll('#lobby-players .lobby-player'));
      for (const row of rows) {
        const strong = row.querySelector('strong');
        if (!strong || strong.innerText.trim() !== targetName) continue;
        const btn = row.querySelector('button');
        return !!(btn && btn.innerText.trim() === 'Accept');
      }
      return false;
    }, nameA);
    return hasAccept;
  }, 10000);

  await clickLobbyActionButton(pageB, nameA, 'Accept');
  console.log(`Accept clicked: ${nameB} accepted invite from ${nameA}`);

  await Promise.all([
    waitForHandshakeComplete(pageA, 'playerA'),
    waitForHandshakeComplete(pageB, 'playerB')
  ]);

  const gameIds = await Promise.all([
    pageA.evaluate(() => g_gameId),
    pageB.evaluate(() => g_gameId)
  ]);

  assert(gameIds[0] === gameIds[1], `Handshake mismatch gameId A=${gameIds[0]} B=${gameIds[1]}`);
}

async function setupLocalPreviewTile(page, targetCellId = 'c7_7') {
  return page.evaluate((cellId) => {
    if (!window.g_isMultiplayer) throw new Error('Not in multiplayer mode');

    const rack = String(g_bui.getPlayerRack() || '');
    const idx = rack.split('').findIndex(ch => ch && ch !== '.');
    const letter = idx >= 0 ? rack[idx] : 'a';
    const points = (typeof g_letscore !== 'undefined' && g_letscore && g_letscore[letter]) ? g_letscore[letter] : 1;

    const updatedRack = idx >= 0
      ? rack.slice(0, idx) + '.' + rack.slice(idx + 1)
      : rack;

    g_bui.setPlayerRack(updatedRack);

    const cell = document.getElementById(cellId);
    if (!cell) throw new Error('Target cell not found: ' + cellId);

    const holds = { letter, points };
    const displayLetter = (letter === ' ' || letter === '*') ? SPACER : String(letter).toUpperCase();
    const pointsHtml = points > 0 ? '<sup><small>' + points + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';

    cell.innerHTML = '<div class="drag t1">' + displayLetter + pointsHtml + '</div>';
    cell.holds = holds;
    if (cell.firstChild) cell.firstChild.holds = holds;

    // Previews are DOM+newplays only — g_board must remain committed state only.
    g_bui.newplays[cellId] = holds;

    const clearBtn = document.getElementById('clear');
    if (clearBtn) {
      clearBtn.textContent = t('Clear');
      clearBtn.onclick = onPlayerClear;
    }

    if (!g_isMyTurn) g_isMyTurn = true;
    if (typeof updateTurnIndicator === 'function') updateTurnIndicator();
    if (typeof saveMultiplayerSession === 'function') saveMultiplayerSession();

    return {
      targetCellId: cellId,
      letter,
      originalRack: rack,
      rack: String(g_bui.getPlayerRack()),
      clearLabel: clearBtn ? clearBtn.textContent.trim() : null,
      hasDot: String(g_bui.getPlayerRack()).includes('.')
    };
  }, targetCellId);
}

async function captureRestoreState(page, previewCellId) {
  return page.evaluate((cellId) => {
    const cell = document.getElementById(cellId);
    const clearBtn = document.getElementById('clear');
    const playBtn = document.getElementById('play');
    const boardEl = document.getElementById('board');
    const expectedClearLabel = Object.keys(g_bui.newplays || {}).length > 0 ? t('Clear') : t('Shuffle');

    return {
      gameId: g_gameId,
      isMultiplayer: !!g_isMultiplayer,
      isMyTurn: !!g_isMyTurn,
      myRack: String(g_bui.getPlayerRack() || ''),
      oppRack: String(g_bui.racks && g_bui.racks[2] ? g_bui.racks[2] : ''),
      hasEmptySlot: String(g_bui.getPlayerRack() || '').includes('.'),
      clearLabel: clearBtn ? clearBtn.textContent.trim() : null,
      expectedClearLabel,
      clearDisabled: clearBtn ? !!clearBtn.disabled : null,
      playDisabled: playBtn ? !!playBtn.disabled : null,
      expectedMoveDisabled: !g_isMyTurn || (typeof g_isShuffling !== 'undefined' && !!g_isShuffling),
      boardClass: boardEl ? boardEl.className : null,
      newplaysCount: Object.keys(g_bui.newplays || {}).length,
      previewExistsInMap: !!(g_bui.newplays && g_bui.newplays[cellId]),
      previewCellHasTile: !!(cell && cell.holds && cell.innerHTML && cell.innerHTML.includes('drag')),
      hasRenderablePreview: Object.keys(g_bui.newplays || {}).some((id) => {
        const pCell = document.getElementById(id);
        return !!(pCell && pCell.holds && pCell.innerHTML && pCell.innerHTML.includes('drag'));
      }),
      channelSubscribed: (typeof g_channelSubscribed !== 'undefined') ? !!g_channelSubscribed : false,
      activeChannelType: (typeof g_activeChannelType !== 'undefined' && g_activeChannelType) ? g_activeChannelType : null,
      stateVersion: g_stateVersion || 0
    };
  }, previewCellId);
}

async function assertStateConsistency(page, state, label) {
  assert(state.isMultiplayer, `${label}: expected multiplayer mode`);
  assert(state.channelSubscribed, `${label}: expected subscribed game channel`);
  assert(state.activeChannelType === 'game', `${label}: expected game channel, got ${state.activeChannelType}`);
  assert(state.boardClass === 'mp', `${label}: expected #board class mp, got ${state.boardClass}`);
  assert(state.clearLabel === state.expectedClearLabel, `${label}: clear/shuffle label mismatch (${state.clearLabel} vs ${state.expectedClearLabel})`);
  assert(
    state.clearDisabled === state.expectedMoveDisabled,
    `${label}: clear disabled mismatch (actual=${state.clearDisabled}, expected=${state.expectedMoveDisabled}, isMyTurn=${state.isMyTurn})`
  );
  assert(
    state.playDisabled === state.expectedMoveDisabled,
    `${label}: play disabled mismatch (actual=${state.playDisabled}, expected=${state.expectedMoveDisabled}, isMyTurn=${state.isMyTurn})`
  );

  // Under simplified design, previews are transient and must not survive reload/state_sync.
  assert(state.newplaysCount === 0, `${label}: expected no persisted preview entries after sync/reload`);
  assert(!state.hasRenderablePreview, `${label}: expected no renderable preview tiles after sync/reload`);

  // Keep this call for clearer trace in failures.
  await page.evaluate(() => true);
}

async function reloadManualStyle(page) {
  await page.keyboard.press('F5');
  await page.waitForTimeout(1200);
  await waitForAppReady(page);
}

async function reloadApi(page) {
  await page.reload({ waitUntil: 'commit' });
  await waitForAppReady(page);
}

async function sendGhostDragEvent(page) {
  await page.evaluate(() => {
    if (!g_channel || !g_isMultiplayer) throw new Error('No active game channel for drag test');
    const board = document.getElementById('board');
    const rect = board.getBoundingClientRect();
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.5;
    const sx = rect.left + rect.width * 0.15;
    const sy = rect.top + rect.height * 0.9;

    g_channel.send({
      type: 'broadcast',
      event: 'drag',
      payload: {
        seq: ++g_dragSeq,
        sourceId: 'pl0',
        x,
        y,
        sourceCenterX: sx,
        sourceCenterY: sy,
        bx: 0.5,
        by: 0.5,
        bsX: 0.15,
        bsY: 0.9
      }
    });
  });
}

async function sendGhostDragEnd(page) {
  await page.evaluate(() => {
    if (!g_channel || !g_isMultiplayer) return;
    g_channel.send({
      type: 'broadcast',
      event: 'drag',
      payload: {
        seq: ++g_dragSeq,
        end: true
      }
    });
  });
}

async function assertGhostVisibleThenCleared(receiverPage, senderPage, label) {
  await sendGhostDragEvent(senderPage);

  await waitFor(async () => {
    return receiverPage.evaluate(() => {
      const ghost = document.querySelector('.mp-ghost');
      return !!(ghost && ghost.style.transform && ghost.style.transform.includes('translate3d'));
    });
  }, 10000);

  await sendGhostDragEnd(senderPage);

  await waitFor(async () => {
    return receiverPage.evaluate(() => !document.querySelector('.mp-ghost'));
  }, 10000);

  console.log(`✓ ${label}: ghost drag visible and cleared`);
}

async function scenarioReloadPlayer({ pageA, pageB, reloader, other, scenarioName, useManualReload, previewCellId }) {
  console.log(`\n=== ${scenarioName} ===`);

  const pre = await setupLocalPreviewTile(reloader, previewCellId);
  assert(pre.hasDot, `${scenarioName}: expected rack to contain an empty slot before reload`);

  const before = await captureRestoreState(reloader, previewCellId);

  // Capture browser console for the reloader page during reload+reconnect phase
  const reloaderConsoleLogs = [];
  const consoleHandler = msg => reloaderConsoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  reloader.on('console', consoleHandler);

  if (useManualReload) await reloadManualStyle(reloader);
  else await reloadApi(reloader);

  // Debug: log the session content and post-appReady state before handshake
  const sessionDebug = await reloader.evaluate(() => {
    try {
      const raw = localStorage['session_mp'] || 'null';
      const parsed = JSON.parse(raw);
      return {
        sessionMyRack: parsed ? parsed.myRack : null,
        sessionNewplaysKeys: parsed && parsed.newplays ? Object.keys(parsed.newplays) : [],
        sessionBoardHasTile: parsed && parsed.board ? (() => {
          for (var x = 0; x < parsed.board.length; x++) {
            for (var y = 0; y < (parsed.board[x] || []).length; y++) {
              if (parsed.board[x][y]) return true;
            }
          }
          return false;
        })() : false,
        runtimeNewplaysAfterReady: Object.keys((window.g_bui && window.g_bui.newplays) ? window.g_bui.newplays : {})
      };
    } catch (e) { return { error: String(e) }; }
  });
  console.log(`${scenarioName} session+runtime debug:`, JSON.stringify(sessionDebug));
  if (reloaderConsoleLogs.length) {
    console.log(`${scenarioName} browser console (${reloaderConsoleLogs.length} msgs):\n  ` + reloaderConsoleLogs.slice(0, 30).join('\n  '));
  }

  await Promise.all([
    waitForHandshakeComplete(reloader),
    waitForHandshakeComplete(other)
  ]);

  reloader.off('console', consoleHandler);
  console.log(`${scenarioName} browser console after handshake (total ${reloaderConsoleLogs.length}):\n  ` + (reloaderConsoleLogs.length ? reloaderConsoleLogs.slice(-30).join('\n  ') : '(none)'));

  const afterReloadingPlayer = await captureRestoreState(reloader, previewCellId);
  const afterOtherPlayer = await captureRestoreState(other, previewCellId);

  console.log(`${scenarioName} reloader state:`, JSON.stringify(afterReloadingPlayer));
  console.log(`${scenarioName} opponent state:`, JSON.stringify(afterOtherPlayer));

  await assertStateConsistency(reloader, afterReloadingPlayer, `${scenarioName} reloader`);
  await assertStateConsistency(other, afterOtherPlayer, `${scenarioName} opponent`);

  // Previews are intentionally non-persistent; they must be gone after reload.
  assert(!afterReloadingPlayer.previewExistsInMap, `${scenarioName}: reloader should not restore preview entry for ${previewCellId}`);
  assert(!afterReloadingPlayer.previewCellHasTile, `${scenarioName}: reloader should not render preview tile on ${previewCellId}`);

  assert(before.isMyTurn === afterReloadingPlayer.isMyTurn, `${scenarioName}: turn changed unexpectedly after reload`);
  assert(pre.originalRack === afterReloadingPlayer.myRack, `${scenarioName}: committed rack was not restored after preview discard`);

  const gameIds = await Promise.all([
    reloader.evaluate(() => g_gameId),
    other.evaluate(() => g_gameId)
  ]);
  assert(gameIds[0] === gameIds[1], `${scenarioName}: gameId mismatch after reload`);

  await assertGhostVisibleThenCleared(other, reloader, scenarioName);

  console.log(`✓ ${scenarioName} passed`);
}

async function scenarioBothReload({ pageA, pageB, previewCellId }) {
  console.log('\n=== Scenario: Both players reload ===');

  const pre = await setupLocalPreviewTile(pageA, previewCellId);

  await Promise.all([
    reloadManualStyle(pageA),
    reloadManualStyle(pageB)
  ]);

  await Promise.all([
    waitForHandshakeComplete(pageA),
    waitForHandshakeComplete(pageB)
  ]);

  const stateA = await captureRestoreState(pageA, previewCellId);
  const stateB = await captureRestoreState(pageB, previewCellId);

  await assertStateConsistency(pageA, stateA, 'Both reload A');
  await assertStateConsistency(pageB, stateB, 'Both reload B');

  assert(stateA.myRack === pre.originalRack, 'Both reload A: committed rack was not restored');

  const gameIds = await Promise.all([
    pageA.evaluate(() => g_gameId),
    pageB.evaluate(() => g_gameId)
  ]);
  assert(gameIds[0] === gameIds[1], 'Both reload: gameId mismatch after dual reload');

  await assertGhostVisibleThenCleared(pageB, pageA, 'Both reload');

  console.log('✓ Both-player reload scenario passed');
}

async function scenarioDragChurnReturnThenReload({ pageA, pageB }) {
  console.log('\n=== Scenario: Drag churn then rack return, opponent reload ===');

  const churn = await pageB.evaluate(() => {
    const rack = String(g_bui.getPlayerRack() || '');
    const idx = rack.split('').findIndex(ch => ch && ch !== '.');
    if (idx < 0) throw new Error('No movable tile found in rack');

    const letter = rack[idx];
    const points = (typeof g_letscore !== 'undefined' && g_letscore && g_letscore[letter]) ? g_letscore[letter] : 1;
    const holds = { letter, points };
    const trail = ['c7_7', 'c8_7', 'c9_7', 'c8_7'];

    // Remove from rack once, then move across several board cells.
    g_bui.racks[1] = rack.slice(0, idx) + '.' + rack.slice(idx + 1);
    g_bui.setPlayerRack(g_bui.racks[1]);

    for (let i = 0; i < trail.length; i++) {
      const id = trail[i];
      const cell = document.getElementById(id);
      if (!cell) throw new Error('Missing board cell ' + id);

      // Clear previous board preview when moving tile around.
      if (i > 0) {
        const prevId = trail[i - 1];
        const prevCell = document.getElementById(prevId);
        if (prevCell) {
          prevCell.innerHTML = '';
          prevCell.holds = '';
        }
        const prev = prevId.slice(1).split('_');
        const px = parseInt(prev[0], 10);
        const py = parseInt(prev[1], 10);
        g_board[px][py] = '';
        g_boardpoints[px][py] = 0;
        g_boardtypes[px][py] = 0;
        delete g_bui.newplays[prevId];
        if (typeof sendDragSourceClear === 'function') sendDragSourceClear(prevId);
      }

      const pointsHtml = points > 0 ? '<sup><small>' + points + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';
      cell.innerHTML = '<div class="drag t1">' + letter.toUpperCase() + pointsHtml + '</div>';
      cell.holds = holds;
      if (cell.firstChild) cell.firstChild.holds = holds;

      const coords = id.slice(1).split('_');
      const x = parseInt(coords[0], 10);
      const y = parseInt(coords[1], 10);
      g_board[x][y] = letter;
      g_boardpoints[x][y] = points;
      g_boardtypes[x][y] = 1;
      g_bui.newplays[id] = holds;
      if (typeof sendDragPreview === 'function') sendDragPreview(i === 0 ? ('pl' + idx) : trail[i - 1], id, holds);
    }

    // Return tile to original rack slot (without pressing Play).
    const lastId = trail[trail.length - 1];
    const lastCell = document.getElementById(lastId);
    if (lastCell) {
      lastCell.innerHTML = '';
      lastCell.holds = '';
    }
    const lastCoords = lastId.slice(1).split('_');
    const lx = parseInt(lastCoords[0], 10);
    const ly = parseInt(lastCoords[1], 10);
    g_board[lx][ly] = '';
    g_boardpoints[lx][ly] = 0;
    g_boardtypes[lx][ly] = 0;
    delete g_bui.newplays[lastId];

    g_bui.racks[1] = g_bui.racks[1].slice(0, idx) + letter + g_bui.racks[1].slice(idx + 1);
    g_bui.setPlayerRack(g_bui.racks[1]);

    if (typeof sendDragPreview === 'function') sendDragPreview(lastId, 'pl' + idx, holds);
    if (typeof sendDragSourceClear === 'function') sendDragSourceClear(lastId);
    if (typeof sendDragEnd === 'function') sendDragEnd();

    const clearBtn = document.getElementById('clear');
    if (Object.keys(g_bui.newplays).length === 0 && clearBtn) {
      clearBtn.textContent = t('Shuffle');
      clearBtn.onclick = onPlayerShuffle;
    }
    if (typeof saveMultiplayerSession === 'function') saveMultiplayerSession();

    return { letter, trail, rack: String(g_bui.getPlayerRack()) };
  });

  // Give realtime a short window to deliver final drag events.
  await pageB.waitForTimeout(600);

  await reloadManualStyle(pageA);

  await Promise.all([
    waitForHandshakeComplete(pageA),
    waitForHandshakeComplete(pageB)
  ]);

  const stale = await pageA.evaluate((trail) => {
    const staleCells = [];
    for (const id of trail) {
      const cell = document.getElementById(id);
      if (cell && cell.innerHTML && cell.innerHTML.includes('drag')) staleCells.push(id);
    }
    return {
      staleCells,
      boardLetters: trail.map((id) => {
        const c = id.slice(1).split('_');
        const x = parseInt(c[0], 10);
        const y = parseInt(c[1], 10);
        return (g_board[x] && g_board[x][y]) || '';
      })
    };
  }, churn.trail);

  assert(stale.staleCells.length === 0, `Drag churn regression: stale tiles remained on reloaded opponent board at ${stale.staleCells.join(', ')}`);
  assert(stale.boardLetters.every(ch => ch === ''), `Drag churn regression: stale board letters remained after rack return (${JSON.stringify(stale.boardLetters)})`);

  console.log('✓ Drag churn regression scenario passed');
}

async function runTests() {
  console.log('=== Multiplayer Session Sync Resilience Suite ===');

  const server = await startStaticServer(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const launchOptions = {
    // Default to headed mode for MP socket/reload realism. Set TEST_HEADLESS=1 to override.
    headless: process.env.TEST_HEADLESS === '1',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  if (process.env.TEST_CHROME_PATH) {
    launchOptions.executablePath = process.env.TEST_CHROME_PATH;
  }

  const browser = await chromium.launch(launchOptions);

  let contextA;
  let contextB;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const errors = [];
    const isIgnorableRequestFailure = (url) => {
      // Analytics requests are non-critical for gameplay/sync correctness in test runs.
      return url.includes('google-analytics.com/g/collect');
    };

    pageA.on('pageerror', err => { console.error('A pageerror:', err.message); errors.push(`A pageerror: ${err.message}`); });
    pageB.on('pageerror', err => { console.error('B pageerror:', err.message); errors.push(`B pageerror: ${err.message}`); });
    pageA.on('requestfailed', req => {
      const url = req.url();
      if (isIgnorableRequestFailure(url)) return;
      errors.push(`A requestfailed: ${url} ${req.failure().errorText}`);
    });
    pageB.on('requestfailed', req => {
      const url = req.url();
      if (isIgnorableRequestFailure(url)) return;
      errors.push(`B requestfailed: ${url} ${req.failure().errorText}`);
    });

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nameA = `SyncA_${suffix}`;
    const nameB = `SyncB_${suffix}`;
    const idA = `sync_user_a_${suffix}`;
    const idB = `sync_user_b_${suffix}`;

    await pageA.addInitScript(({ uid, pname }) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
    }, { uid: idA, pname: nameA });
    await pageB.addInitScript(({ uid, pname }) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
    }, { uid: idB, pname: nameB });

    await Promise.all([
      pageA.goto(baseUrl, { waitUntil: 'commit' }),
      pageB.goto(baseUrl, { waitUntil: 'commit' })
    ]);

    await Promise.all([
      waitForAppReady(pageA),
      waitForAppReady(pageB)
    ]);

    const boardClassesBeforeMp = await Promise.all([
      pageA.$eval('#board', el => el.className),
      pageB.$eval('#board', el => el.className)
    ]);
    assert(boardClassesBeforeMp[0] === 'sp', `Expected Player A board class sp before MP, got ${boardClassesBeforeMp[0]}`);
    assert(boardClassesBeforeMp[1] === 'sp', `Expected Player B board class sp before MP, got ${boardClassesBeforeMp[1]}`);

    await bootstrapMultiplayerViaInvite({
      pageA,
      pageB,
      nameA,
      nameB,
      ids: { idA, idB }
    });

    const gameIds = await Promise.all([
      pageA.evaluate(() => g_gameId),
      pageB.evaluate(() => g_gameId)
    ]);
    console.log(`MP handshake completed. gameId=${gameIds[0]}`);

    await scenarioReloadPlayer({
      pageA,
      pageB,
      reloader: pageA,
      other: pageB,
      scenarioName: 'Scenario: Player 1 reload',
      useManualReload: true,
      previewCellId: 'c7_7'
    });

    await scenarioReloadPlayer({
      pageA,
      pageB,
      reloader: pageB,
      other: pageA,
      scenarioName: 'Scenario: Player 2 reload',
      useManualReload: true,
      previewCellId: 'c8_7'
    });

    await scenarioBothReload({
      pageA,
      pageB,
      previewCellId: 'c9_7'
    });

    await scenarioDragChurnReturnThenReload({
      pageA,
      pageB
    });

    assert(errors.length === 0, `Unexpected browser errors:\n${errors.join('\n')}`);

    console.log('\n=== ALL SESSION SYNC TESTS PASSED ===');
  } finally {
    try {
      if (contextA) await contextA.close();
      if (contextB) await contextB.close();
    } catch (err) {
      // Ignore cleanup errors.
    }
    await browser.close();
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n=== SESSION SYNC TEST FAILED ===');
  console.error(err.stack || err.message || err);
  process.exit(1);
});
