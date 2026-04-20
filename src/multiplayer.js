// Supabase integration for Vietboard Multiplayer

// Supabase details
const SUPABASE_URL = 'https://awolvbshyvcrsqwrbjxe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Oju2rh1kaNFcvlPfnssF7A_4YpvQKCH'; // Note: publishable key, safe for client-side
const SUPABASE_HIGHSCORES_TABLE = 'highscores';
const SUPABASE_HIGHSCORES_ID = 'vietboard';

// We will load the Supabase client via unpkg in index.html
window.supabaseClient = null;

// Multiplayer state variables
let g_isMultiplayer = false;
let g_gameId = null;
let g_isMyTurn = false;
let g_opponentId = null;
let g_opponentName = null;
let g_lobbyUserId = localStorage.getItem('lobby_user_id');
if (!g_lobbyUserId) {
  g_lobbyUserId = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('lobby_user_id', g_lobbyUserId);
}
let g_myName = localStorage.getItem('player_name');
if (!g_myName) {
  g_myName = t('Generating...'); // Set temporary state

  // Custom Google Apps Script Random Username Generator
  async function generateNickname() {
    // Basic randInt implementation since we might not have access to the UI one directly if it's not global yet, but engine.js has randInt? Wait, randInt is in ui.js which is loaded later.
    // We will just use Math.random here.
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const sRandInt = (+new Date() + '').slice(-randInt(2, 4));
    let response = Object.create(null);
    let sNickname;

    try {
      response = await fetch('https://script.google.com/macros/s/AKfycbzc_I5SM9gf6CRONek7lxF7-B4XFD8o1Y7P_50TdIKMSZMIq0gToAt0L_dQ44ufbshk1A/exec');
    } catch (err) {
      // Suppress error
    }

    if (response.ok) {
      sNickname = await response.text() + sRandInt;
    } else { // Fallback
      console.warn(t('Failed to generate nickname.'), response.status || '', '\n' + t('Using fallback method...'));
      sNickname = t('Player') + '_' + sRandInt;
    }

    g_myName = sNickname;
    localStorage.setItem('player_name', g_myName);

    // Update input field if it's already rendered
    var nameInput = document.getElementById('lobby-name');
    if (nameInput) nameInput.value = g_myName;
  }

  generateNickname();
}
let g_channel = null; // Either lobby or game channel
let g_explicitLeftUsers = new Set();
let g_opponentPresenceState = false;
let g_dragThrottleTimer = null;
let g_dragGhost = null;
let g_dragSeq = 0;
let g_lastRemoteDragSeq = -1;
let g_stateVersion = 0;
let g_isGameOver = false;
let g_opponentDisconnectSeconds = 0;
let g_reconnectTimer = null;
let g_lastMoveAt = 0;
let g_broadcastPipeline = [];
let g_broadcastPipelineTimer = null;
const BROADCAST_PIPELINE_DEBOUNCE_MS = 100;

// Timer state
let g_idleTimer = null;
let g_idleSeconds = 0;

function initSupabase() {
  if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error(t('Supabase library not loaded.'));
  }
}
initSupabase();

function normalizeHighScorePlayerName(name) {
  if (typeof name !== 'string') return '';
  var match = name.match(/^You \((.+)\)$/);
  if (match) return match[1];
  return name;
}

async function mergeGlobalHighScores(remoteScores) {
  if (typeof remoteScores !== 'object') return false;
  var scoresToMerge = remoteScores || {};

  // Ensure we have a local highscores object to work with
  if (typeof g_highscores === 'undefined') {
    window.g_highscores = localStorage['highscores'] ? JSON.parse(localStorage['highscores']) : {};
  }
  var localHighScores = g_highscores || {};
  var merged = {};
  var keys = {};
  var hasLocalOnlyScores = false;

  for (var key in localHighScores) keys[key] = true;
  for (var key in scoresToMerge) keys[key] = true;

  for (var key in keys) {
    var localList = Array.isArray(localHighScores[key]) ? localHighScores[key] : [];
    var remoteList = Array.isArray(scoresToMerge[key]) ? scoresToMerge[key] : [];

    // Track remote scores to detect if we have something new locally
    var remoteScoresSet = {};
    for (var j = 0; j < remoteList.length; ++j) {
      var r = remoteList[j];
      var rId = r.playerId || '';
      var rName = normalizeHighScorePlayerName(r.player || '');
      // Migration: assign 'computer' ID if name matches
      if (!rId && (rName === 'Computer' || (typeof t === 'function' && rName === t('Computer')))) {
        rId = 'computer';
      }
      remoteScoresSet[(rId || rName) + '|' + Number(r.score)] = true;
    }

    var combined = localList.concat(remoteList);
    var seen = {};
    var unique = [];

    for (var i = 0; i < combined.length; ++i) {
      var item = combined[i];
      if (!item || typeof item.score === 'undefined') continue;
      var score = Number(item.score);
      if (!(score > 0)) continue;
      var playerId = item.playerId || '';
      var rawName = normalizeHighScorePlayerName(item.player || '');

      // Migration: assign 'computer' ID if name matches
      if (!playerId && (rawName === 'Computer' || (typeof t === 'function' && rawName === t('Computer')))) {
        playerId = 'computer';
      }

      var dedupeKey = (playerId || rawName) + '|' + score;

      // Check if this local score is missing from remote
      if (i < localList.length && !remoteScoresSet[dedupeKey]) {
        hasLocalOnlyScores = true;
        if (DEBUG) console.log('Detected local-only high score:', dedupeKey, 'in', key);
      }

      if (seen[dedupeKey]) {
        // If we already saw this score, but the new one has a session and the old one didn't,
        // update the existing entry to include the session (allows viewing local matches).
        if (item.session) {
          for (var j = 0; j < unique.length; j++) {
            if (((unique[j].playerId || unique[j].player) + '|' + unique[j].score) === dedupeKey) {
              if (!unique[j].session) unique[j].session = item.session;
              break;
            }
          }
        }
        continue;
      }

      seen[dedupeKey] = true;
      unique.push({
        player: rawName,
        playerId: playerId,
        score: score,
        session: item.session || ''
      });
    }

    unique.sort(typeof gCompareScores === 'function' ? gCompareScores : function(a, b) {
      var nA = a ? a.score : -99;
      var nB = b ? b.score : -99;
      return (nA > nB) ? -1 : ((nA < nB) ? 1 : 0);
    });
    if (unique.length > 0) merged[key] = unique;
  }

  window.g_highscores = merged;
  localStorage['highscores'] = JSON.stringify(g_highscores);
  return hasLocalOnlyScores;
}

async function loadGlobalHighScores() {
  if (DEBUG) console.log('Loading global high scores from Supabase...');
  if (!window.supabaseClient) {
    initSupabase();
    if (!window.supabaseClient) {
      console.warn('Supabase client not available.');
      return;
    }
  }

  try {
    var { data, error } = await window.supabaseClient
      .from(SUPABASE_HIGHSCORES_TABLE)
      .select('scores')
      .eq('id', SUPABASE_HIGHSCORES_ID)
      .single();

    if (error) {
      // If record doesn't exist (PGRST116), trigger initial sync
      if (error.code === 'PGRST116') {
        if (DEBUG) console.log('No global high scores record found. Syncing local scores...');
        await saveGlobalHighScores();
      } else {
        console.warn('Failed to load global high scores:', error.message || error, error);
      }
      return;
    }

    if (data && typeof data.scores === 'object') {
      var hasNewLocalData = await mergeGlobalHighScores(data.scores);
      if (hasNewLocalData) {
        if (DEBUG) console.log('New local high scores detected. Syncing to global...');
        await saveGlobalHighScores();
      } else {
        if (DEBUG) console.log('No new local high scores to sync.');
      }
    } else {
      if (DEBUG) console.log('Global high scores record is empty or invalid. Syncing local scores...');
      await saveGlobalHighScores();
    }
  } catch (err) {
    console.warn('Unexpected error loading global high scores:', err);
  }
}

async function saveGlobalHighScores() {
  if (!window.supabaseClient) {
    if (DEBUG) console.log('Supabase client not available for saving.');
    return;
  }
  try {
    var scoresToSave = g_highscores || {};
    // Clone and strip huge session data before saving to DB
    var strippedHighScores = JSON.parse(JSON.stringify(scoresToSave));
    var hasScores = false;
    for (var key in strippedHighScores) {
      if (Array.isArray(strippedHighScores[key])) {
        if (strippedHighScores[key].length > 0) hasScores = true;
        strippedHighScores[key].forEach(function(item) {
          delete item.session;
        });
      }
    }

    if (!hasScores && (!scoresToSave || Object.keys(scoresToSave).length === 0)) {
       if (DEBUG) console.log('No high scores to save.');
       return;
    }

    if (DEBUG) console.log('Upserting high scores to Supabase:', strippedHighScores);
    var { error } = await window.supabaseClient
      .from(SUPABASE_HIGHSCORES_TABLE)
      .upsert({
        id: SUPABASE_HIGHSCORES_ID,
        scores: strippedHighScores
      }, { onConflict: 'id' });

    if (error) {
      console.warn('Failed to save global high scores:', error.message || error, error);
    } else {
      if (DEBUG) console.log('Global high scores synced successfully.');
    }
  } catch (err) {
    console.warn('Unexpected error saving global high scores:', err);
  }
}

if (document.readyState === 'complete' && document.documentElement.classList.contains('loaded')) {
  loadGlobalHighScores();
} else {
  document.addEventListener('appReady', loadGlobalHighScores);
}

// -----------------------------------------------------------------------------
// LOBBY & MATCHMAKING
// -----------------------------------------------------------------------------

window.showLobby = function() {
  // Save name
  localStorage.setItem('player_name', g_myName);

  const html = `
<h2>${t('Multiplayer Lobby')}</h2>
<table>
  <tr class="header">
    <td><label for="lobby-name">${t('Your name')}</label></td>
    <td class="input"><input id="lobby-name" value="${g_myName}"></td>
  </tr>
</table>
<p><strong>${t('Click a player to start a game:')}</strong></p>
<div id="lobby-players">
  <em>${t('Loading...')}</em>
</div>
`;

  g_bui.prompt(html, `<button class="button" onclick="leaveLobby();hideModal()">${t('Close')}</button>`, 'lobby-modal wide');

  const lobbyNameInput = document.getElementById('lobby-name');
  if (lobbyNameInput) {
    lobbyNameInput.addEventListener('keyup', function(event) {
      if (event.key === 'Enter') {
        updatePlayerName(this.value);
      }
    });

    lobbyNameInput.addEventListener('blur', function() {
      if (this.value !== g_myName) {
        updatePlayerName(this.value);
      }
    });
  }

  // Ensure clean state - leave any existing channel before joining lobby
  leaveLobby().then(() => joinLobbyChannel());
}

window.updatePlayerName = async function(newName) {
  g_myName = newName || (t('Player') + '_' + Math.floor(Math.random() * 10000));
  localStorage.setItem('player_name', g_myName);
  if (DEBUG) console.log('updatePlayerName: setting to', g_myName);

  // Sync name changes to all high score entries with my ID
  if (g_lobbyUserId) {
    var changed = false;
    for (var key in g_highscores) {
      if (Array.isArray(g_highscores[key])) {
        g_highscores[key].forEach(function(item) {
          if (item.playerId === g_lobbyUserId) {
            item.player = g_myName;
            changed = true;
          }
        });
      }
    }
    if (changed) {
      localStorage['highscores'] = JSON.stringify(g_highscores);
      if (typeof saveGlobalHighScores === 'function') saveGlobalHighScores();
    }
  }

  // Update input field value
  var inp = document.getElementById('lobby-name');
  if (inp) inp.value = g_myName;
  // Retrack lobby presence to update name on all clients
  if (g_channel && g_lobbyUserId) {
    try {
      await g_channel.track({
        name: g_myName,
        lookingForGame: true,
        id: g_lobbyUserId
      });
      if (DEBUG) console.log('Presence tracked for:', g_lobbyUserId, 'name:', g_myName);
      // Immediately update the lobby display for feedback
      var state = g_channel.presenceState();
      if (DEBUG) console.log('Current presence state:', state);
      renderLobbyPlayers(state);
    } catch (err) {
      console.error('Failed to update presence:', err);
    }
  }
  // Refresh high scores modal if visible (updated "You" name)
  var highscoresModal = document.getElementById('modal-container');
  if (highscoresModal && highscoresModal.classList.contains('highscores') && highscoresModal.style.display !== 'none') {
    var layoutSelect = document.getElementById('highscores-layout');
    var levelSelect = document.getElementById('highscores-level');
    if (layoutSelect && levelSelect) {
      document.getElementById('highscores-data').innerHTML = g_bui.renderHighScoreRows(layoutSelect.value + ' ' + levelSelect.value);
      setModalHeight();
    }
  }
}

function joinLobbyChannel() {
  if (g_channel) g_channel.unsubscribe();

  g_channel = window.supabaseClient.channel('lobby', {
    config: {
      presence: {
        key: g_lobbyUserId,
      },
    },
  });

  function filterExplicitLeft(state) {
    const filtered = Object.assign({}, state);
    for (const id of g_explicitLeftUsers) {
      delete filtered[id];
    }
    return filtered;
  }

  g_channel
    .on('presence', { event: 'sync' }, () => {
      if (DEBUG) console.log('Presence sync event received');
      const state = g_channel.presenceState();
      if (DEBUG) console.log('Presence state:', state);
      renderLobbyPlayers(filterExplicitLeft(state));
    })
    .on('presence', { event: 'join' }, (payload) => {
      if (DEBUG) console.log('Presence join event received:', payload);
      if (payload && payload.key) g_explicitLeftUsers.delete(payload.key);
      renderLobbyPlayers(filterExplicitLeft(g_channel.presenceState()));
    })
    .on('presence', { event: 'update' }, (payload) => {
      if (DEBUG) console.log('Presence update event received:', payload);
      renderLobbyPlayers(filterExplicitLeft(g_channel.presenceState()));
    })
    .on('presence', { event: 'leave' }, (payload) => {
      if (DEBUG) console.log('Presence leave event received:', payload);
      renderLobbyPlayers(filterExplicitLeft(g_channel.presenceState()));
    })
    .on('broadcast', { event: 'lobby_leave' }, ({ payload }) => {
      if (DEBUG) console.log('Broadcast lobby_leave received:', payload);
      if (payload && payload.id) g_explicitLeftUsers.add(payload.id);
      renderLobbyPlayers(filterExplicitLeft(g_channel ? g_channel.presenceState() : {}));
    })
    .on('broadcast', { event: 'invite' }, (payload) => {
      if (payload.payload.to === g_lobbyUserId) {
        if (DEBUG) console.log('Received invite!', payload);
        g_opponentId = payload.payload.fromId || null;
        startMultiplayerGame(payload.payload.gameId, payload.payload.fromName, false);
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await g_channel.track({ name: g_myName, lookingForGame: true, id: g_lobbyUserId });
      }
    });
}

function renderLobbyPlayers(state) {
  const container = document.getElementById('lobby-players');
  if (!container) return; // Modal closed

  if (DEBUG) console.log('renderLobbyPlayers called with state:', state, 'g_lobbyUserId:', g_lobbyUserId);
  let html = '';
  let count = 0;
  for (const id in state) {
    const metas = state[id] || [];
    const user = metas.length > 0 ? metas[metas.length - 1] : null;
    if (!user) continue; // Skip if user data is undefined/null
    if (DEBUG) console.log('Checking user id:', id, 'user:', user);
    // Don't show self. User name can change, so rely on presence key.
    if (id === g_lobbyUserId || user.id === g_lobbyUserId) {
      if (DEBUG) console.log('Skipping self:', id);
      continue;
    }
    if (!user.lookingForGame) continue;

    const displayName = String(user.name || t('Player'));
    const safeName = displayName.replace(/'/g, "\\'");
    html += `
<div class="lobby-player" onclick="invitePlayer('${id}','${safeName}')">
  <strong>${displayName}</strong>
</div>
`;
    count++;
  }

  if (count === 0) html = '<em>' + t('No other players waiting.') + '</em>';
  container.innerHTML = html;
}

window.leaveLobby = async function() {
  g_explicitLeftUsers.clear();
  if (g_channel) {
    // Broadcast explicit leave so other clients remove us immediately,
    // independent of presence propagation timing
    try {
      await g_channel.send({
        type: 'broadcast',
        event: 'lobby_leave',
        payload: { id: g_lobbyUserId }
      });
      // Wait briefly to ensure broadcast propagates before untracking/unsubscribing
      await new Promise(res => setTimeout(res, 120));
    } catch (err) {
      if (DEBUG) console.warn('Failed to broadcast lobby_leave:', err);
    }
    try {
      if (typeof g_channel.untrack === 'function') {
        await g_channel.untrack();
      }
    } catch (err) {
      if (DEBUG) console.warn('Failed to untrack lobby presence:', err);
    }
    await g_channel.unsubscribe();
    g_channel = null;
  }
  if (g_dragGhost) {
    g_dragGhost.remove();
    g_dragGhost = null;
  }
}

window.invitePlayer = function(opponentId, opponentName) {
  if (!g_channel) return;

  const state = g_channel.presenceState();
  const metas = state[opponentId] || [];
  const user = metas.length > 0 ? metas[metas.length - 1] : null;

  if (!user || !user.lookingForGame) {
    renderLobbyPlayers(state);
    g_bui.prompt(t('This player is no longer available.'));
    return;
  }

  // To keep it simple, we just start a game instantly using a deterministic game ID based on the two IDs.
  // Actually, random UUID is safer. We will broadcast a "start_game" message to the lobby.
  const newGameId = 'game_' + Math.random().toString(36).substr(2, 9);

  // We send a directed broadcast to that user in the lobby
  g_channel.send({
    type: 'broadcast',
    event: 'invite',
    payload: {
      to: opponentId,
      fromId: g_lobbyUserId,
      fromName: g_myName,
      gameId: newGameId
    }
  });

  // And start our side
  g_opponentId = opponentId;
  startMultiplayerGame(newGameId, opponentId, opponentName, true);
}

// Listen for invites in the lobby
function setupLobbyInviteListener() {
  // We need to attach this when joining the lobby
}

// Mock translation function fallback if not defined
if (typeof t !== 'function') {
  window.t = function(str) { return str; };
}

async function startMultiplayerGame(gameId, opponentId, opponentName, isHost) {
  g_isGameOver = false;
  g_opponentDisconnectSeconds = 0;
  g_gameId = gameId;
  g_opponentId = opponentId || null;
  g_opponentName = opponentName;
  g_isMultiplayer = true;
  localStorage['session_mode'] = 'mp';

  await leaveLobby();
  hideModal();

  // Connect to game channel
  joinGameChannel(gameId, isHost);
}

function joinGameChannel(gameId, isHost) {
  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }

  g_channel = window.supabaseClient.channel('game:' + gameId, {
    config: {
      presence: {
        key: g_lobbyUserId,
      },
    },
  });

  g_channel
    .on('presence', { event: 'sync' }, () => {
      const state = g_channel.presenceState();
      let opponentFound = false;
      let opponentId = null;
      let opponentName = null;
      for (const id in state) {
        if (id === g_lobbyUserId) continue;
        opponentFound = true;
        opponentId = id;
        const metas = Array.isArray(state[id]) ? state[id] : [];
        if (metas.length > 0 && typeof metas[0].name === 'string') {
          opponentName = metas[0].name;
        }
      }
      g_opponentPresenceState = opponentFound;
      if (opponentFound) {
        g_opponentDisconnectSeconds = 0;
        g_opponentId = opponentId || g_opponentId;
        if (opponentName) g_opponentName = opponentName;
      }
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (DEBUG) console.log('Opponent left presence', leftPresences);
    })
    .on('broadcast', { event: 'gamestate' }, (payload) => {
      handleGameStateBroadcast(payload.payload);
    })
    .on('broadcast', { event: 'move' }, (payload) => {
      handleMoveBroadcast(payload.payload);
    })
    .on('broadcast', { event: 'drag' }, (payload) => {
      handleDragBroadcast(payload.payload);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        if (g_reconnectTimer) {
          clearTimeout(g_reconnectTimer);
          g_reconnectTimer = null;
        }
        await g_channel.track({ name: g_myName, id: g_lobbyUserId, isHost });
        startIdleTimer();
        if (isHost) {
          // Initialize game state and send it out
          setTimeout(() => initializeHostGame(), 500); // short delay to ensure opponent is connected
        }
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') && g_isMultiplayer && !g_isGameOver) {
        if (!g_reconnectTimer) {
          g_reconnectTimer = setTimeout(function() {
            g_reconnectTimer = null;
            if (g_isMultiplayer && g_gameId && !g_isGameOver) {
              joinGameChannel(g_gameId, false);
            }
          }, 1500);
        }
      }
    });
}

function getNextMultiplayerStateVersion() {
  g_stateVersion += 1;
  return g_stateVersion;
}
window.getNextMultiplayerStateVersion = getNextMultiplayerStateVersion;

function applyNonGameButtonPolicy() {
  var hsBtn = document.getElementById('highscores');
  if (hsBtn) hsBtn.disabled = false;

  var lobbyBtn = document.getElementById('lobby');
  if (lobbyBtn) {
    lobbyBtn.disabled = false;
    lobbyBtn.title = t('Lobby');
  }

  var restartBtn = document.getElementById('restart');
  if (restartBtn) restartBtn.disabled = false;
}

function cleanupMultiplayerSession() {
  if (g_idleTimer) {
    clearInterval(g_idleTimer);
    g_idleTimer = null;
  }
  if (g_reconnectTimer) {
    clearTimeout(g_reconnectTimer);
    g_reconnectTimer = null;
  }
  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }

  localStorage.removeItem('session_mp');
  localStorage['session_mode'] = 'sp';

  g_isMultiplayer = false;
  g_isMyTurn = true;
  g_gameId = null;
  g_opponentName = null;
  g_opponentPresenceState = false;
  g_opponentDisconnectSeconds = 0;
  g_stateVersion = 0;
  g_lastMoveAt = 0;
  g_lastRemoteDragSeq = -1;
  g_dragSeq = 0;

  applyNonGameButtonPolicy();
  updateGameInfoLabels();
}

window.confirmRestartMultiplayer = function() {
  g_bui.prompt(
    t('Restarting will forfeit this game.'),
    '<button class="button secondary" onclick="hideModal()">' + t('Cancel') + '</button>'
      + '&nbsp;&nbsp;<button class="button" onclick="hideModal();finalizeMultiplayerGame(\'forfeit\', true);g_bui.restart()">' + t('Forfeit &amp; Restart') + '</button>'
  );
};

function finalizeMultiplayerGame(reason, skipLocalAnnounce) {
  if (!g_isMultiplayer || g_isGameOver) return;
  g_isGameOver = true;

  broadcastGameState({
    type: 'game_ended',
    reason: reason || 'ended',
    stateVersion: g_stateVersion
  });

  if (!skipLocalAnnounce) {
    announceWinner();
  } else if (typeof finalizeGameScores === 'function') {
    finalizeGameScores();
  }
  cleanupMultiplayerSession();
}

function shuffleRackString(rack) {
  var arr = String(rack || '').split('');
  for (var i = arr.length - 1; i > 0; --i) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.join('');
}

function normalizeBoardMatrix(matrix, fallbackValue) {
  var normalized = [];
  var defaultValue = typeof fallbackValue === 'undefined' ? '' : fallbackValue;
  for (var x = 0; x < g_boardwidth; ++x) {
    var sourceCol = Array.isArray(matrix) && Array.isArray(matrix[x]) ? matrix[x] : [];
    normalized[x] = [];
    for (var y = 0; y < g_boardheight; ++y) {
      var value = sourceCol[y];
      normalized[x][y] = (typeof value === 'undefined' || value === null) ? defaultValue : value;
    }
  }
  return normalized;
}

function initializeHostGame() {
  // Coin flip for turn
  const hostGoesFirst = Math.random() < 0.5;
  g_isMyTurn = hostGoesFirst;

  // Set up board empty, etc. (done by init('board'))
  // But we need to sync g_letpool and the initial racks

  // Call restart without prompting
  g_bui.restart(true);
  g_isMultiplayer = true;

  // Wait a tick for letpool to be built, then sync it
  setTimeout(() => {
    var rawMyRack = g_bui.getPlayerRack();
    var rawOppRack = g_bui.getOpponentRack();

    // Hide opponent rack first, then reshuffle both racks.
    g_bui.setOpponentRack(rawOppRack);

    var myRack = shuffleRackString(rawMyRack);
    var oppRack = shuffleRackString(rawOppRack);
    g_bui.setPlayerRack(myRack);
    g_bui.setOpponentRack(oppRack);
    g_bui.makeTilesFixed();
    g_stateVersion = 1;

    broadcastGameState({
      type: 'init',
      letpool: g_letpool,
      myRack: oppRack, // What is opponent rack to us is their rack
      oppRack: myRack,
      hostGoesFirst: hostGoesFirst,
      stateVersion: g_stateVersion
    });
    g_lastMoveAt = Date.now();
    saveMultiplayerSession();
    updateTurnIndicator();
    updateGameInfoLabels();
  }, 100);
}

function sendBroadcastNow(event, payload) {
  if (!g_channel) return;
  g_channel.send({
    type: 'broadcast',
    event: event,
    payload: payload
  });
}

function processBroadcastPipeline() {
  if (!g_channel || !g_broadcastPipeline.length) return;
  var pipeline = g_broadcastPipeline;
  g_broadcastPipeline = [];
  g_broadcastPipelineTimer = null;

  var lastCollapsibleIndex = {};

  for (var i = 0; i < pipeline.length; ++i) {
    var item = pipeline[i];
    if (!item.options || !item.options.collapse) continue;
    var key = item.event + '|' + (item.options.collapseKey || 'all');
    lastCollapsibleIndex[key] = i;
  }

  for (var j = 0; j < pipeline.length; ++j) {
    var queued = pipeline[j];
    if (!queued) continue;
    if (queued.options && queued.options.collapse) {
      var key = queued.event + '|' + (queued.options.collapseKey || 'all');
      if (lastCollapsibleIndex[key] !== j) continue;
    }
    sendBroadcastNow(queued.event, queued.payload);
  }
}

function enqueueBroadcast(event, payload, options) {
  if (!g_channel) return;
  var opts = options || {};
  if (!opts.collapse) {
    sendBroadcastNow(event, payload);
    return;
  }

  g_broadcastPipeline.push({ event: event, payload: payload, options: opts });
  if (g_broadcastPipelineTimer) clearTimeout(g_broadcastPipelineTimer);
  g_broadcastPipelineTimer = setTimeout(processBroadcastPipeline, opts.delay || BROADCAST_PIPELINE_DEBOUNCE_MS);
}

function broadcastGameState(payload) {
  if (!g_channel) return;
  const eventName = (payload && payload.type === 'move') ? 'move' : 'gamestate';
  const shouldCollapse = payload && payload.type === 'highscores_sync';
  if (shouldCollapse) {
    enqueueBroadcast(eventName, payload, {
      collapse: true,
      collapseKey: payload.type || 'gamestate'
    });
  } else {
    sendBroadcastNow(eventName, payload);
  }
}

function sendDragPosition(x, y, sourceId, sourceCenter) {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;
  if (g_dragThrottleTimer) return;

  g_dragThrottleTimer = setTimeout(function() {
    g_dragThrottleTimer = null;
  }, 50);

  var payload = {
    seq: ++g_dragSeq,
    x: x,
    y: y
  };
  if (sourceId) payload.sourceId = sourceId;
  if (sourceCenter && typeof sourceCenter.sourceCenterX === 'number' && typeof sourceCenter.sourceCenterY === 'number') {
    payload.sourceCenterX = sourceCenter.sourceCenterX;
    payload.sourceCenterY = sourceCenter.sourceCenterY;
  }

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: payload
  });
}

function mapRemoteRackCellId(remoteId) {
  if (typeof remoteId !== 'string') return remoteId;
  if (remoteId.startsWith('pl') || remoteId.startsWith('op')) {
    var prefix = remoteId.slice(0, 2);
    var index = parseInt(remoteId.slice(2), 10);
    if (isNaN(index)) return remoteId;

    var reversedIndex = index;
    if (typeof g_racksize === 'number' && g_racksize > 0) {
      reversedIndex = (g_racksize - 1) - index;
    }

    if (prefix === 'pl') return 'op' + reversedIndex;
    if (prefix === 'op') return 'pl' + reversedIndex;
  } else if (remoteId.startsWith('c') && remoteId.indexOf('_') > -1) {
    var parts = remoteId.slice(1).split('_');
    var x = parseInt(parts[0], 10);
    var y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y)) return remoteId;

    var mirroredX = (g_boardwidth - 1) - x;
    var mirroredY = (g_boardheight - 1) - y;
    return 'c' + mirroredX + '_' + mirroredY;
  }
  return remoteId;
}

function localizeDragPosition(payload) {
  if (!payload || typeof payload.x !== 'number' || typeof payload.y !== 'number') return null;

  var x = payload.x;
  var y = payload.y;
  var sourceId = payload.sourceId;

  if (typeof sourceId === 'string' && (sourceId.startsWith('pl') || sourceId.startsWith('op') || sourceId.charAt(0) === 'c')) {
    var localSourceId = mapRemoteRackCellId(sourceId);
    var localSourceCell = el(localSourceId);
    if (localSourceCell && typeof payload.sourceCenterX === 'number' && typeof payload.sourceCenterY === 'number') {
      var localRect = localSourceCell.getBoundingClientRect();
      var offsetX = payload.x - payload.sourceCenterX;
      var offsetY = payload.y - payload.sourceCenterY;
      x = localRect.left + localRect.width / 2 - offsetX;
      y = localRect.top + localRect.height / 2 - offsetY;
    } else {
      var dragArea = el('drag');
      if (dragArea) {
        var dragRect = dragArea.getBoundingClientRect();
        x = dragRect.left + dragRect.width - (payload.x - dragRect.left);
        y = dragRect.top + dragRect.height - (payload.y - dragRect.top);
      }
    }
  }

  return { x: x, y: y };
}

function sendDragEnd() {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: {
      seq: ++g_dragSeq,
      end: true
    }
  });
}

function sendDragPreview(fromId, toId, holds) {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: {
      seq: ++g_dragSeq,
      action: 'preview',
      fromId: fromId,
      toId: toId,
      letter: holds && holds.letter ? holds.letter : '',
      points: holds && typeof holds.points !== 'undefined' ? holds.points : ''
    }
  });
}

function sendDragSourceClear(sourceId) {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: {
      seq: ++g_dragSeq,
      action: 'clear',
      sourceId: sourceId
    }
  });
}

function renderOpponentRackTileBack(cell) {
  if (!cell) return;
  cell.innerHTML = '<div class="drag t2">&nbsp;&nbsp;</div>';
}

function renderOpponentBoardTile(cell, letter, points) {
  if (!cell) return;
  var displayLetter = letter;
  if (displayLetter === '*') displayLetter = '&nbsp;&nbsp;';
  else displayLetter = String(displayLetter || '').toUpperCase();
  var pointsHtml = (typeof points !== 'undefined' && points !== '' && points !== null)
    ? '<sub>' + points + '</sub>'
    : '';
  cell.innerHTML = '<div class="drag t2">' + displayLetter + pointsHtml + '</div>';
}

function applyDragPreview(payload) {
  if (!payload || !payload.toId) return;

  var toId = mapRemoteRackCellId(payload.toId);
  var toCell = el(toId);

  if (!toCell) return;

  // Clear source cell if provided (extra safety)
  if (payload.fromId) {
    var fromId = mapRemoteRackCellId(payload.fromId);
    if (fromId !== toId) {
      var fromCell = el(fromId);
      if (fromCell) fromCell.innerHTML = '';
    }
  }

  if (toId && (toId.charAt(0) === 'c' || toId.startsWith('op'))) {
    renderOpponentRackTileBack(toCell);
  }
}

function applyDragSourceClear(payload) {
  if (!payload || !payload.sourceId) return;
  var id = payload.sourceId;
  if (id.charAt(0) !== 'c' && !id.startsWith('pl') && !id.startsWith('op')) return;

  var sourceId = mapRemoteRackCellId(id);
  var sourceCell = el(sourceId);
  if (sourceCell) sourceCell.innerHTML = '';
}

function handleDragBroadcast(payload) {
  if (!g_isMultiplayer || !payload) return;

  if (typeof payload.seq === 'number') {
    if (payload.seq <= g_lastRemoteDragSeq) return;
    g_lastRemoteDragSeq = payload.seq;
  }

  if (payload.action === 'preview') {
    applyDragPreview(payload);
    return;
  }

  if (payload.action === 'clear') {
    applyDragSourceClear(payload);
    return;
  }

  if (payload.end) {
    if (g_dragGhost) {
      g_dragGhost.remove();
      g_dragGhost = null;
    }
    return;
  }

  if (!g_dragGhost) {
    g_dragGhost = document.createElement('div');
    g_dragGhost.id = 'mp-drag-ghost';
    g_dragGhost.className = 'drag t2 mp-ghost';
    document.body.appendChild(g_dragGhost);
  }

  g_dragGhost.innerHTML = '&nbsp;&nbsp;';
  var localPos = localizeDragPosition(payload);
  if (localPos) {
    g_dragGhost.style.left = localPos.x + 'px';
    g_dragGhost.style.top = localPos.y + 'px';
  }
}

function handleGameStateBroadcast(payload) {
  if (payload.type === 'init') {
    // Apply init state from host
    g_letpool = payload.letpool;
    g_bui.setPlayerRack(payload.myRack);
    g_bui.setOpponentRack(payload.oppRack);
    g_bui.setTilesLeft(g_letpool.length);
    g_bui.makeTilesFixed();
    g_stateVersion = payload.stateVersion || g_stateVersion;
    g_isGameOver = false;
    g_isMyTurn = !payload.hostGoesFirst;
    localStorage['session_mode'] = 'mp';
    saveMultiplayerSession();
    updateTurnIndicator();
    updateGameInfoLabels();
  } else if (payload.type === 'shuffle') {
    // Phase 5: Apply opponent shuffle with visible transition
    animateRackShuffle('op', payload.rack || '', function() {
      g_bui.setOpponentRack(payload.rack || '');
    });
  } else if (payload.type === 'highscores_sync') {
    if (payload.highscores) {
      mergeGlobalHighScores(payload.highscores).then(function() {
        var highscoresModal = document.getElementById('modal-container');
        if (highscoresModal && highscoresModal.classList.contains('highscores') && highscoresModal.style.display !== 'none') {
          var layoutSelect = document.getElementById('highscores-layout');
          var levelSelect = document.getElementById('highscores-level');
          if (layoutSelect && levelSelect) {
            document.getElementById('highscores-data').innerHTML = g_bui.renderHighScoreRows(layoutSelect.value + ' ' + levelSelect.value);
            setModalHeight();
          }
        }
      });
    }
  }
}

function updateTurnIndicator() {
  // Phase 4: Explicit button gating policy
  // Move-action controls: turn-gated (Play, Clear/Shuffle, Swap, Pass)
  const moveButtons = ['play', 'clear', 'swap', 'pass'];
  const moveButtonIds = moveButtons.map(b => document.getElementById(b)).filter(Boolean);
  moveButtonIds.forEach(btn => {
    btn.disabled = !g_isMyTurn;
  });

  // Enforce turn-based tile interaction: when it is not your turn,
  // disable dragging from your rack to prevent local unsent moves.
  if (g_isMultiplayer && g_bui) {
    if (g_isMyTurn) g_bui.makeTilesFixed();
    else g_bui.fixPlayerTiles();
  }

  // High Scores: always enabled during multiplayer
  const hsBtn = document.getElementById('highscores');
  if (hsBtn) {
    hsBtn.disabled = false;
  }

  // Restart: disabled once game starts
  const restartBtn = document.getElementById('restart');
  if (restartBtn) {
    restartBtn.disabled = g_isMultiplayer && !g_board_empty;
  }

  // Lobby: disabled once game starts
  const lobbyBtn = document.getElementById('lobby');
  if (lobbyBtn) {
    if (g_isMultiplayer && !g_board_empty) {
      lobbyBtn.disabled = true;
      lobbyBtn.title = t('Finish the current game before joining the lobby');
    } else {
      lobbyBtn.disabled = false;
      lobbyBtn.title = t('Lobby');
    }
  }
}

// -----------------------------------------------------------------------------
// GAMEPLAY SYNC
// -----------------------------------------------------------------------------

function onMultiplayerMove() {
  if (!g_isMyTurn) {
    g_bui.prompt(t('It is not your turn!'));
    g_bui.cancelPlayerPlacement();
    return;
  }

  var passed = self.passed; // self is window here basically, referring to the passed flag in engine.js

  var boardinfo = g_bui.getBoard();
  var newBoard = boardinfo.board;
  var newBoardP = boardinfo.boardp;
  var newBoardT = boardinfo.boardt;

  var pinfo = null;
  var pstr = '';
  var scoreEarned = 0;
  var rackBefore = g_bui.getPlayerRack();
  var rackAfter = rackBefore;

  if (!passed) {
    var placement = g_bui.getPlayerPlacement();
    pinfo = checkValidPlacement(placement);
    pstr = pinfo.played;

    // Keep global board state in sync with current UI state after validation.
    // checkValidPlacement reads from g_board / g_boardpoints / g_boardtypes.
    g_board = normalizeBoardMatrix(newBoard, '');
    g_boardpoints = normalizeBoardMatrix(newBoardP, 0);
    g_boardtypes = normalizeBoardMatrix(newBoardT, 0);

    if (pstr === '') {
      g_bui.prompt(gErrPrefix() + pinfo.msg);
      return;
    }

    g_bui.acceptPlayerPlacement();
    if (g_board_empty) {
      g_board_empty = false;
      var elUp = el('a.link.up');
      var elDown = el('a.link.down');
      if (elUp) elUp.classList.add('disabled');
      if (elDown) elDown.classList.add('disabled');
      var elLayout = el('bonuseslayout');
      if (elLayout) elLayout.disabled = true;
    }

    if (pstr.length === g_racksize) scoreEarned += g_allLettersBonus;
    scoreEarned += pinfo.score;

    // Take new letters
    var pletters = g_bui.getPlayerRack() + takeLetters(pstr.replace(/\*/g, ''));
    g_bui.setPlayerRack(pletters);
    rackAfter = pletters;
    g_bui.setTilesLeft(g_letpool.length);
  } else {
    g_bui.cancelPlayerPlacement();
  }

  // We made a valid move. Now broadcast it to the opponent!
  g_pscore += scoreEarned;
  g_bui.setPlayerScore(scoreEarned, g_pscore);

  if (pinfo && pinfo.words && pinfo.words.length > 0) {
    var words = [];
    for (var i = 0; i < pinfo.words.length; ++i) {
      words.push('<a href="javascript:g_bui.wordInfo(\'' + pinfo.words[i][0] + '\')">' + pinfo.words[i][0] + '</a>');
    }
    var elStatus = el('status');
    elStatus.innerHTML = t('You') + ' ' + t('scored ') + scoreEarned + ' ' + t(' points for ') + words.join(', ').toUpperCase();
  }

  var moveData = {
    type: 'move',
    passed: passed,
    swapped: false, // Handle swap later
    pstr: pstr,
    score: scoreEarned,
    board: newBoard,
    boardp: newBoardP,
    boardt: newBoardT,
    rackBefore: rackBefore,
    rackAfter: rackAfter,
    letpool: g_letpool,
    boardEmpty: g_board_empty,
    stateVersion: getNextMultiplayerStateVersion()
  };

  g_isMyTurn = false;
  updateTurnIndicator();
  updateGameInfoLabels();
  broadcastGameState(moveData);

  g_lastMoveAt = Date.now();
  saveMultiplayerSession();
}

function handleMoveBroadcast(payload) {
  if (payload.type === 'move') {
    if (payload.stateVersion && payload.stateVersion <= g_stateVersion) return;
    g_stateVersion = Math.max(g_stateVersion, payload.stateVersion || 0);

    // Apply opponent's move
    if (!payload.passed) {
      // Diff against previous board before applying the new payload board
      var prevBoard = Array.isArray(g_board) ? g_board : [];
      var nextBoard = Array.isArray(payload.board) ? payload.board : [];

      var diffWord = [];
      for (var x = 0; x < g_boardwidth; ++x) {
        for (var y = 0; y < g_boardheight; ++y) {
          var charBefore = prevBoard[x][y] || ' ';
          var charAfter = nextBoard[x][y] || ' ';
          if (charAfter !== ' ' && charBefore === ' ') {
            var ltr = (charAfter === charAfter.toLowerCase() && charAfter !== ' ') ? '*' : charAfter;
            diffWord.push({
              'x': x,
              'y': y,
              'ltr': charAfter,
              'lscr': g_letscore[ltr] || 0
            });
          }
        }
      }

      var mirroredBoard = [];
      var mirroredBoardP = [];
      var mirroredBoardT = [];

      for (var x = 0; x < g_boardwidth; ++x) {
        mirroredBoard[x] = [];
        mirroredBoardP[x] = [];
        mirroredBoardT[x] = [];
        for (var y = 0; y < g_boardheight; ++y) {
          var mx = (g_boardwidth - 1) - x;
          var my = (g_boardheight - 1) - y;
          mirroredBoard[x][y] = nextBoard[mx][my];
          mirroredBoardP[x][y] = payload.boardp[mx][my];
          mirroredBoardT[x][y] = payload.boardt[mx][my];
        }
      }

      g_board = normalizeBoardMatrix(mirroredBoard, '');
      g_boardpoints = normalizeBoardMatrix(mirroredBoardP, 0);
      g_boardtypes = normalizeBoardMatrix(mirroredBoardT, 0);
      g_board_empty = payload.boardEmpty;

      if (diffWord.length > 0) {
        // Mirrored diffWord for the UI animation
        var mirroredDiffWord = [];
        for (var i = 0; i < diffWord.length; i++) {
          var dw = diffWord[i];
          mirroredDiffWord.push({
            'x': (g_boardwidth - 1) - dw.x,
            'y': (g_boardheight - 1) - dw.y,
            'ltr': dw.ltr,
            'lscr': dw.lscr
          });
        }

        // We need to restore the opponent rack temporarily so placeOnBoard can steal tiles from it
        g_bui.setOpponentRack(payload.rackBefore || '');

        placeOnBoard(mirroredDiffWord, function() {
          g_bui.setOpponentRack(payload.rackAfter);
          g_oscore += payload.score;
          g_bui.setOpponentScore(payload.score, g_oscore);
          g_letpool = payload.letpool;
          g_bui.setTilesLeft(g_letpool.length);

          var elStatus = el('status');
          elStatus.innerHTML = t('Opponent') + ' ' + t('scored ') + payload.score;

          g_isMyTurn = true;
          updateTurnIndicator();
          updateGameInfoLabels();

          if (payload.rackAfter === '' && g_letpool.length === 0) {
            g_isGameOver = true;
            announceWinner();
            cleanupMultiplayerSession();
            return;
          }
          g_lastMoveAt = Date.now();
          saveMultiplayerSession();
        });

        // Skip the rest of the synchronous updates because they are handled in the callback
        return;
      } else {
        for (var x = 0; x < g_boardwidth; ++x) {
          var boardColumn = g_board[x];
          var boardTypeColumn = g_boardtypes[x];
          if (!Array.isArray(boardColumn) || !Array.isArray(boardTypeColumn)) continue;

          for (var y = 0; y < g_boardheight; ++y) {
            var cell = el('c' + x + '_' + y);
            var char = boardColumn[y];
            if (char && char !== ' ' && cell && cell.innerHTML === '') {
              var ltr = char === char.toLowerCase() ? '*' : char;
              var displayChar = (ltr === ' ' || ltr === '*') ? '&nbsp;&nbsp;' : ltr.toUpperCase();
              var tClass = boardTypeColumn[y] === 1 ? 't2' : 't1';
              var points = g_letscore[ltr] || 0;
              var html = '<div class="drag ' + tClass + '">' + displayChar + '<sub>' + points + '</sub></div>';
              cell.innerHTML = html;
            }
          }
        }
        g_bui.makeTilesFixed();
      }

    }

    g_oscore += payload.score;
    g_bui.setOpponentScore(payload.score, g_oscore);
    g_bui.setOpponentRack(payload.rackAfter);
    g_letpool = Array.isArray(payload.letpool) ? payload.letpool : (Array.isArray(g_letpool) ? g_letpool : []);
    g_bui.setTilesLeft((g_letpool || []).length);

    if (!payload.passed) {
      var elStatus = el('status');
      elStatus.innerHTML = t('Opponent') + ' ' + t('scored ') + payload.score;
    }

    g_isMyTurn = true;
    updateTurnIndicator();
    updateGameInfoLabels();

    if (payload.passed) {
      g_bui.toast(payload.swapped ? t('Opponent swapped') : t('Opponent passed'));
    }

    // Check if game over
    if (payload.rackAfter === '' && g_letpool.length === 0) {
      g_isGameOver = true;
      announceWinner();
      cleanupMultiplayerSession();
      return;
    }

    g_lastMoveAt = Date.now();
    saveMultiplayerSession();
  }
}

function saveMultiplayerSession() {
  if (g_isMultiplayer) {
    var now = Date.now();
    var inferredLastMoveAt = g_lastMoveAt || 0;
    var previousSnapshot = null;

    try {
      previousSnapshot = JSON.parse(localStorage['session_mp'] || '{}');
    } catch (err) {
      previousSnapshot = null;
    }

    if (!inferredLastMoveAt && previousSnapshot && typeof previousSnapshot.lastMoveAt === 'number') {
      inferredLastMoveAt = previousSnapshot.lastMoveAt;
    }

    if (!inferredLastMoveAt) inferredLastMoveAt = now;

    localStorage['session_mode'] = 'mp';
    localStorage['session_mp'] = JSON.stringify({
      gameId: g_gameId,
      opponentName: g_opponentName,
      isMyTurn: g_isMyTurn,
      letpool: g_letpool,
      pscore: g_pscore,
      oscore: g_oscore,
      myRack: g_bui.getPlayerRack(),
      oppRack: g_bui.getOpponentRack(),
      board: g_board,
      boardp: g_boardpoints,
      boardt: g_boardtypes,
      boardEmpty: g_board_empty,
      stateVersion: g_stateVersion,
      isGameOver: g_isGameOver,
      savedAt: now,
      lastMoveAt: inferredLastMoveAt
    });
  }
}

document.addEventListener('appReady', function() {
  // Check if we have a multiplayer session to resume
  if (localStorage['session_mp']) {
    try {
      var mpData = JSON.parse(localStorage['session_mp']);
      var now = Date.now();
      var MAX_RESUME_AGE_MS = 30 * 60 * 1000; // 30 minutes
      var hasRecentSnapshot = mpData && typeof mpData.savedAt === 'number' && (now - mpData.savedAt) <= MAX_RESUME_AGE_MS;
      var hasRecentMove = mpData && typeof mpData.lastMoveAt === 'number' && (now - mpData.lastMoveAt) <= MAX_RESUME_AGE_MS;
      var hasUsableState = mpData &&
        typeof mpData.gameId === 'string' && mpData.gameId !== '' &&
        typeof mpData.stateVersion === 'number' && mpData.stateVersion > 0 &&
        typeof mpData.myRack === 'string' &&
        typeof mpData.oppRack === 'string' &&
        Array.isArray(mpData.letpool);

      // Resume only with a recent, valid in-game snapshot.
      if (hasUsableState && (hasRecentSnapshot || hasRecentMove)) {
        if (DEBUG) console.log('Resuming multiplayer session...');

        g_gameId = mpData.gameId;
        g_opponentName = mpData.opponentName;
        g_isMultiplayer = true;
        g_isMyTurn = mpData.isMyTurn;
        g_letpool = Array.isArray(mpData.letpool) ? mpData.letpool : (Array.isArray(g_letpool) ? g_letpool : []);
        g_pscore = typeof mpData.pscore === 'number' ? mpData.pscore : g_pscore;
        g_oscore = typeof mpData.oscore === 'number' ? mpData.oscore : g_oscore;
        g_board = normalizeBoardMatrix(mpData.board, '');
        g_boardpoints = normalizeBoardMatrix(mpData.boardp, 0);
        g_boardtypes = normalizeBoardMatrix(mpData.boardt, 0);
        g_board_empty = mpData.boardEmpty;
        g_stateVersion = mpData.stateVersion || 0;
        g_isGameOver = !!mpData.isGameOver;

        // Apply board
        setTimeout(() => {
          g_bui.setPlayerRack(String(mpData.myRack || ''));
          g_bui.setOpponentRack(String(mpData.oppRack || ''));
          g_bui.setPlayerScore(0, g_pscore);
          g_bui.setOpponentScore(0, g_oscore);
          g_bui.setTilesLeft((g_letpool || []).length);

          if (Array.isArray(g_board) && Array.isArray(g_boardtypes)) {
            for (var x = 0; x < g_boardwidth; ++x) {
              var boardColumn = g_board[x];
              var boardTypeColumn = g_boardtypes[x];
              if (!Array.isArray(boardColumn) || !Array.isArray(boardTypeColumn)) continue;

              for (var y = 0; y < g_boardheight; ++y) {
                var cell = el('c' + x + '_' + y);
                var char = boardColumn[y];
                if (char && char !== ' ' && typeof char !== 'undefined' && cell && cell.innerHTML === '') {
                  var ltr = char === char.toLowerCase() ? '*' : char;
                  var displayChar = (ltr === ' ' || ltr === '*') ? '&nbsp;&nbsp;' : ltr.toUpperCase();
                  var tClass = boardTypeColumn[y] === 1 ? 't1' : 't2';
                  var points = g_letscore[ltr] || 0;
                  var html = '<div class="drag ' + tClass + '">' + displayChar + '<sub>' + points + '</sub></div>';
                  cell.innerHTML = html;
                }
              }
            }
          }
          g_bui.makeTilesFixed();
          updateTurnIndicator();
          updateGameInfoLabels();

          // Rejoin channel
          joinGameChannel(g_gameId, false);

          // Request latest state just in case we missed a move while refreshing
          setTimeout(() => {
            broadcastGameState({ type: 'request_state' });
          }, 1000);
        }, 500);
      } else {
        // Prevent stale/incomplete snapshots from forcing broken reconnect attempts.
        localStorage.removeItem('session_mp');
        if (localStorage['session_mode'] === 'mp') localStorage['session_mode'] = 'sp';
      }
    } catch (e) {
      console.error(e);
    }
  }
});

// Add to handleGameStateBroadcast to handle request_state
const originalHandleMoveBroadcast2 = handleGameStateBroadcast;
handleGameStateBroadcast = function(payload) {
  originalHandleMoveBroadcast2(payload);

  if (payload.type === 'game_ended') {
    if (g_isGameOver) return;
    g_isGameOver = true;
    if (payload.reason === 'forfeit') {
      g_bui.prompt(t('Opponent has left the game.'));
    }
    announceWinner();
    cleanupMultiplayerSession();
    return;
  }

  if (payload.type === 'request_state') {
    // The other player just refreshed and is asking for the authoritative state
    // Send them our current state view so they can catch up if they missed anything
    broadcastGameState({
      type: 'state_sync',
      board: g_board,
      boardp: g_boardpoints,
      boardt: g_boardtypes,
      boardEmpty: g_board_empty,
      pscore: g_oscore, // Our oscore is their pscore
      oscore: g_pscore, // Our pscore is their oscore
      myRack: g_bui.getOpponentRack(),
      oppRack: g_bui.getPlayerRack(),
      letpool: g_letpool,
      isMyTurn: !g_isMyTurn,
      stateVersion: g_stateVersion,
      lastMoveAt: g_lastMoveAt || Date.now()
    });
  } else if (payload.type === 'state_sync') {
    if (payload.stateVersion && payload.stateVersion < g_stateVersion) return;

    // We received a sync from the other player
    var incomingBoard = Array.isArray(payload.board) ? payload.board : [];
    var incomingBoardP = Array.isArray(payload.boardp) ? payload.boardp : [];
    var incomingBoardT = Array.isArray(payload.boardt) ? payload.boardt : [];

    var mirroredBoard = [];
    var mirroredBoardP = [];
    var mirroredBoardT = [];

    for (var x = 0; x < g_boardwidth; ++x) {
      mirroredBoard[x] = [];
      mirroredBoardP[x] = [];
      mirroredBoardT[x] = [];
      for (var y = 0; y < g_boardheight; ++y) {
        var mx = (g_boardwidth - 1) - x;
        var my = (g_boardheight - 1) - y;
        mirroredBoard[x][y] = (incomingBoard[mx] && incomingBoard[mx][my]) || '';
        mirroredBoardP[x][y] = (incomingBoardP[mx] && incomingBoardP[mx][my]) || 0;
        mirroredBoardT[x][y] = (incomingBoardT[mx] && incomingBoardT[mx][my]) || 0;
      }
    }

    g_board = normalizeBoardMatrix(mirroredBoard, '');
    g_boardpoints = normalizeBoardMatrix(mirroredBoardP, 0);
    g_boardtypes = normalizeBoardMatrix(mirroredBoardT, 0);
    g_board_empty = payload.boardEmpty;
    g_pscore = payload.pscore;
    g_oscore = payload.oscore;
    g_letpool = Array.isArray(payload.letpool) ? payload.letpool : (Array.isArray(g_letpool) ? g_letpool : []);
    g_isMyTurn = payload.isMyTurn;
    g_stateVersion = Math.max(g_stateVersion, payload.stateVersion || 0);
    if (typeof payload.lastMoveAt === 'number') g_lastMoveAt = payload.lastMoveAt;

    g_bui.setPlayerRack(String(payload.myRack || ''));
    g_bui.setOpponentRack(String(payload.oppRack || ''));
    g_bui.setPlayerScore(0, g_pscore);
    g_bui.setOpponentScore(0, g_oscore);
    g_bui.setTilesLeft((g_letpool || []).length);

    for (var x = 0; x < g_boardwidth; ++x) {
      var boardColumn = g_board[x];
      var boardTypeColumn = g_boardtypes[x];
      if (!Array.isArray(boardColumn) || !Array.isArray(boardTypeColumn)) continue;

      for (var y = 0; y < g_boardheight; ++y) {
        var cell = el('c' + x + '_' + y);
        if (!cell) continue;
        cell.innerHTML = '';
        var char = boardColumn[y];
        if (char && char !== ' ' && typeof char !== 'undefined') {
          var ltr = char === char.toLowerCase() ? '*' : char;
          var displayChar = (ltr === ' ' || ltr === '*') ? '&nbsp;&nbsp;' : ltr.toUpperCase();
          var tClass = boardTypeColumn[y] === 1 ? 't1' : 't2';
          var points = g_boardpoints[x][y] || 0;
          var html = '<div class="drag ' + tClass + '">' + displayChar + '<sub>' + points + '</sub></div>';
          cell.innerHTML = html;
        }
      }
    }
    g_bui.makeTilesFixed();
    updateTurnIndicator();
    updateGameInfoLabels();
    saveMultiplayerSession();
  }
};

// -----------------------------------------------------------------------------
// IDLE & DISCONNECT HANDLING
// -----------------------------------------------------------------------------

function startIdleTimer() {
  if (g_idleTimer) clearInterval(g_idleTimer);
  g_idleSeconds = 0;
  g_opponentDisconnectSeconds = 0;

  g_idleTimer = setInterval(() => {
    if (!g_isMultiplayer || g_isGameOver) return;

    // Check if opponent is missing
    if (!g_opponentPresenceState && g_opponentName) {
      g_opponentDisconnectSeconds++;
    } else {
      g_opponentDisconnectSeconds = 0;
    }

    // If opponent is missing for 5 minutes, forfeit game
    if (g_opponentDisconnectSeconds === 240) {
      g_bui.prompt(t('WARNING: Opponent disconnected. Game will forfeit in 1 minute.'));
    }

    if (g_opponentDisconnectSeconds >= 290 && g_opponentDisconnectSeconds <= 300) {
      var timeLeft = 300 - g_opponentDisconnectSeconds;
      var statusEl = document.getElementById('status');
      if (statusEl) statusEl.innerHTML = '<span style="color:red">' + t('Opponent forfeits in ') + timeLeft + t('s...') + '</span>';
    }

    if (g_opponentDisconnectSeconds >= 300) {
      clearInterval(g_idleTimer);
      g_bui.prompt(t('Opponent forfeited due to disconnection.'));
      finalizeMultiplayerGame('disconnect_forfeit');
      return;
    }

    // Original idle logic
    g_idleSeconds++;

    if (g_idleSeconds === 240) {
      g_bui.prompt(t('WARNING: Game will end in 1 minute due to inactivity.'));
    }

    if (g_idleSeconds >= 290 && g_idleSeconds <= 300) {
      var timeLeft = 300 - g_idleSeconds;
      var statusEl = document.getElementById('status');
      if (statusEl) statusEl.innerHTML = '<span style="color:red">' + t('Game ends in ') + timeLeft + t('s...') + '</span>';
    }

    if (g_idleSeconds >= 300) {
      clearInterval(g_idleTimer);
      finalizeMultiplayerGame('inactivity_timeout');
      g_bui.prompt(t('Game over due to inactivity.'));
    }
  }, 1000);
}

function resetIdleTimer() {
  g_idleSeconds = 0;
  var statusEl = document.getElementById('status');
  // Clear the countdown message if it was showing
  if (statusEl && statusEl.innerHTML.includes('Game ends in')) {
     statusEl.innerHTML = '';
  }
}

// Reset idle timer on clicks
window.addEventListener('click', resetIdleTimer);
window.addEventListener('touchstart', resetIdleTimer);

// Add to handleGameStateBroadcast to reset timer on opponent activity
const originalHandleMoveBroadcast3 = handleGameStateBroadcast;
handleGameStateBroadcast = function(payload) {
  originalHandleMoveBroadcast3(payload);
  resetIdleTimer();
};

function updateGameInfoLabels() {
  const lblLast = document.getElementById('label-loscore');
  const lblTotal = document.getElementById('label-oscore');
  if (g_isMultiplayer && g_opponentName) {
    if (lblLast) lblLast.innerHTML = t('Opponent&rsquo;s last score:');
    if (lblTotal) lblTotal.innerHTML = t('Opponent&rsquo;s total score:');
  } else {
    if (lblLast) lblLast.innerHTML = t('Computer&rsquo;s last score:');
    if (lblTotal) lblTotal.innerHTML = t('Computer&rsquo;s total score:');
  }
}

function syncHighScoresMultiplayer() {
  if (!g_isMultiplayer) return;

  // Clone and strip huge session data before broadcasting
  var strippedHighScores = JSON.parse(JSON.stringify(g_highscores));
  for (var key in strippedHighScores) {
    if (Array.isArray(strippedHighScores[key])) {
      strippedHighScores[key].forEach(function(item) {
        delete item.session;
      });
    }
  }

  broadcastGameState({
    type: 'highscores_sync',
    highscores: strippedHighScores
  });
}
