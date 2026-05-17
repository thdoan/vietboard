const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

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
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const server = await startStaticServer(ROOT, PORT);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log(`[PAGE] ${msg.type().toUpperCase()}: ${msg.text()}`));

    const userId = `user_owner_${Date.now()}`;
    const otherId = `user_other_${Date.now()}`;
    const currentName = `Owner_${Date.now()}`;
    const newName = `${currentName}_renamed`;
    const scoreKey = 'default 5';

    await page.evaluateOnNewDocument((uid, pname) => {
      localStorage.setItem('lobby_user_id', uid);
      localStorage.setItem('player_name', pname);
      localStorage.setItem('has_seen_tutorial', 'true');
    }, userId, currentName);

    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof window.updatePlayerName === 'function' && !!window.g_bui, { timeout: 20000 });

    const before = await page.evaluate(async ({ scoreKey, userId, otherId, currentName, newName }) => {
      window.__realSaveGlobalHighScores = window.__realSaveGlobalHighScores || window.saveGlobalHighScores;
      window.saveGlobalHighScoresCalls = 0;
      window.saveGlobalHighScores = async function() {
        window.saveGlobalHighScoresCalls += 1;
        return true;
      };
      window.g_channel = null;
      window.g_highscores = {};
      window.g_highscores[scoreKey] = [
        { playerId: userId, player: currentName, score: 100, date: '2026-05-17T00:00:00.000Z' },
        { playerId: otherId, player: currentName, score: 90, date: '2026-05-17T00:00:00.000Z' },
        { playerId: otherId, player: 'Rival', score: 80, date: '2026-05-17T00:00:00.000Z' }
      ];
      localStorage.setItem('highscores', JSON.stringify(window.g_highscores));

      const html = window.g_bui.renderHighScoreRows(scoreKey);
      await window.updatePlayerName(newName);

      return {
        html,
        rows: window.g_highscores[scoreKey].map(item => ({ playerId: item.playerId, player: item.player, score: item.score })),
        saveCalls: window.saveGlobalHighScoresCalls
      };
    }, { scoreKey, userId, otherId, currentName, newName });

    if (!before.html.includes(`${currentName} (You)`)) {
      throw new Error(`Expected owner row to render as current user. HTML: ${before.html}`);
    }
    if (before.html.includes(`>${currentName} (You)</td><td><a class="link"`) && before.html.indexOf(`${currentName} (You)`) !== before.html.lastIndexOf(`${currentName} (You)`)) {
      throw new Error(`Expected exactly one current-user badge, but HTML was: ${before.html}`);
    }

    const ownerRow = before.rows.find(row => row.playerId === userId);
    const otherSameNameRow = before.rows.find(row => row.playerId === otherId && row.score === 90);
    if (!ownerRow || ownerRow.player !== newName) {
      throw new Error(`Expected owner row to be renamed to ${newName}. Rows: ${JSON.stringify(before.rows)}`);
    }
    if (!otherSameNameRow || otherSameNameRow.player !== currentName) {
      throw new Error(`Expected other player's same-name row to remain ${currentName}. Rows: ${JSON.stringify(before.rows)}`);
    }
    if (before.saveCalls !== 1) {
      throw new Error(`Expected exactly one saveGlobalHighScores call, got ${before.saveCalls}`);
    }

    const collision = await page.evaluate(async ({ scoreKey, userId, otherId }) => {
      window.fetchCalls = 0;
      window.fetch = async function(url) {
        window.fetchCalls += 1;
        return {
          ok: true,
          text: async function() { return 'GasName'; }
        };
      };
      window.g_channel = null;
      g_lobbyUserId = userId;
      g_myName = 'ConflictedName';
      localStorage.setItem('player_name', g_myName);
      window.g_highscores = {};
      window.g_highscores[scoreKey] = [
        { playerId: otherId, player: 'ConflictedName', score: 70, date: '2026-05-17T00:00:00.000Z' }
      ];
      localStorage.setItem('highscores', JSON.stringify(window.g_highscores));

      await window.mergeGlobalHighScores(window.g_highscores);

      return {
        playerName: localStorage.getItem('player_name'),
        fetchCalls: window.fetchCalls
      };
    }, { scoreKey, userId, otherId });

    if (!collision.playerName || !collision.playerName.startsWith('GasName')) {
      throw new Error(`Expected collision recovery to use GAS-generated name, got ${collision.playerName}`);
    }
    if (collision.fetchCalls !== 1) {
      throw new Error(`Expected collision recovery to fetch one GAS nickname, got ${collision.fetchCalls}`);
    }

    const legacy = await page.evaluate(({ scoreKey, userId }) => {
      g_lobbyUserId = userId;
      g_myName = 'FreshDevName';
      window.g_highscores = {};
      window.g_highscores[scoreKey] = [
        { player: 'You', score: 55, date: '2026-05-17T00:00:00.000Z' }
      ];
      return window.g_bui.renderHighScoreRows(scoreKey);
    }, { scoreKey, userId });

    if (!legacy.includes('>You</td>')) {
      throw new Error(`Expected legacy ownerless row to stay plain You. HTML: ${legacy}`);
    }
    if (legacy.includes('FreshDevName (You)')) {
      throw new Error(`Legacy ownerless row should not adopt current local name. HTML: ${legacy}`);
    }

    const legacyNamed = await page.evaluate(({ scoreKey, userId }) => {
      g_lobbyUserId = userId;
      g_myName = 'AnotherFreshName';
      window.g_highscores = {};
      window.g_highscores[scoreKey] = [
        { player: 'You (Quan)', score: 56, date: '2026-05-17T00:00:00.000Z' }
      ];
      return window.g_bui.renderHighScoreRows(scoreKey);
    }, { scoreKey, userId });

    if (!legacyNamed.includes('>Quan</td>')) {
      throw new Error(`Expected legacy ownerless wrapped row to recover embedded name. HTML: ${legacyNamed}`);
    }
    if (legacyNamed.includes('AnotherFreshName (You)') || legacyNamed.includes('>You</td>')) {
      throw new Error(`Legacy wrapped row should show embedded name only. HTML: ${legacyNamed}`);
    }

    const scrubbed = await page.evaluate(async ({ scoreKey, userId }) => {
      g_lobbyUserId = userId;
      g_myName = 'CanonName';
      if (window.__realSaveGlobalHighScores) {
        window.saveGlobalHighScores = window.__realSaveGlobalHighScores;
      }
      window.__capturedScores = null;
      window.supabaseClient = {
        rpc: async function(name, payload) {
          window.__capturedScores = payload.p_scores;
          return { error: null };
        }
      };
      window.g_highscores = {};
      window.g_highscores[scoreKey] = [
        { player: 'You', score: 11, date: '' },
        { player: 'You (Quan)', score: 12, date: '' },
        { playerId: userId, player: 'You', score: 13, date: '2026-05-17T00:00:00.000Z' }
      ];

      var saveResult = await window.saveGlobalHighScores();

      return {
        saveResult,
        local: window.g_highscores[scoreKey],
        remoteAll: window.__capturedScores,
        remote: window.__capturedScores && window.__capturedScores[scoreKey]
      };
    }, { scoreKey, userId });

    if (scrubbed.local.length !== 2 || scrubbed.remote.length !== 2) {
      throw new Error(`Expected ownerless plain You row to be dropped during save scrub. Result: ${JSON.stringify(scrubbed)}`);
    }
    if (scrubbed.remote.some(row => row.player === 'You')) {
      throw new Error(`Canonical save should not write plain You rows. Remote: ${JSON.stringify(scrubbed.remote)}`);
    }
    if (!scrubbed.remote.some(row => row.player === 'Quan') || !scrubbed.remote.some(row => row.player === 'CanonName')) {
      throw new Error(`Expected wrapped legacy name recovery and owned-row rewrite during save scrub. Remote: ${JSON.stringify(scrubbed.remote)}`);
    }

    const localNameFallback = await page.evaluate(() => {
      localStorage.removeItem('player_name');
      g_myName = '';
      var names = window.getHighScoreNames();
      return {
        player: names.player,
        stored: localStorage.getItem('player_name')
      };
    });

    if (!localNameFallback.player || localNameFallback.player === 'You') {
      throw new Error(`Expected getHighScoreNames to generate a non-contextual fallback player name. Result: ${JSON.stringify(localNameFallback)}`);
    }
    if (localNameFallback.player !== localNameFallback.stored) {
      throw new Error(`Expected generated fallback player name to persist to localStorage. Result: ${JSON.stringify(localNameFallback)}`);
    }

    const startupScrub = await page.evaluate(() => {
      localStorage.setItem('highscores', JSON.stringify({
        'default 5': [
          { player: 'You', score: 41, date: '' },
          { player: 'You (Recovered)', score: 42, date: '' }
        ]
      }));
      window.g_highscores = JSON.parse(localStorage.getItem('highscores'));
      sanitizeLocalHighScoresCache();
      return JSON.parse(localStorage.getItem('highscores'));
    });

    if (!startupScrub['default 5'] || startupScrub['default 5'].length !== 1 || startupScrub['default 5'][0].player !== 'Recovered') {
      throw new Error(`Expected startup scrub to drop plain You rows and normalize wrapped names. Result: ${JSON.stringify(startupScrub)}`);
    }

    console.log('High-score name ownership regression test passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('Test suite failed:');
  console.error(err);
  process.exit(1);
});
