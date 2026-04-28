// Supabase integration for Vietboard Multiplayer

// Supabase details
const SUPABASE_URL = 'https://awolvbshyvcrsqwrbjxe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Oju2rh1kaNFcvlPfnssF7A_4YpvQKCH'; // Note: publishable key, safe for client-side
const SUPABASE_HIGHSCORES_TABLE = 'highscores';
const SUPABASE_HIGHSCORES_ID = 'vietboard';

// Obfuscated app key for Supabase RLS (xor 0xAB)
const _hk = '\xdd\xc9\xf4\xca\xdb\xdb\xc0\xce\xd2\xf4\x9c\xc0\x92\xc6\x99\xdb\xf3\xda\xe7\x9f\xc5\xf9\x93\xdc\xff\x9e\xc1\xf2\x98\xdd\xe9\x9d\xc8\xe3\x9a\xca\xed\x9b\xcf\xee';
function _dk(s) {
  var k = 0xAB;
  var r = '';
  for (var i = 0; i < s.length; i++) r += String.fromCharCode(s.charCodeAt(i) ^ k);
  return r;
}

// Defensive fallback: ensure t() exists before translation script loads
if (typeof t !== 'function') {
  window.t = function(str) { return str; };
}

// We will load the Supabase client via unpkg in index.html
window.supabaseClient = null;

// Multiplayer state variables
var g_isMultiplayer = false;
var g_gameId = null;
var g_isMyTurn = false;
var g_opponentId = null;
var g_opponentName = null;
let g_lobbyUserId = localStorage.getItem('lobby_user_id');
if (!g_lobbyUserId) {
  g_lobbyUserId = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('lobby_user_id', g_lobbyUserId);
}
let g_myName = localStorage.getItem('player_name');
if (!g_myName) {
  // Real fallback stored immediately — never expose "Generating..." to high scores
  var fallback = t('Player') + '_' + Math.floor(Math.random() * 10000);
  g_myName = fallback.substring(0, 32);
  localStorage.setItem('player_name', g_myName);
  if (DEBUG) console.log('Generated fallback player_name:', g_myName);

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

    var oldName = g_myName;
    g_myName = sNickname.substring(0, 32);
    localStorage.setItem('player_name', g_myName);

    // Rename any local high scores that used the old fallback name and re-sync
    if (oldName !== g_myName) {
      for (var key in g_highscores) {
        if (Array.isArray(g_highscores[key])) {
          g_highscores[key].forEach(function(item) {
            if (item.player === oldName) item.player = g_myName;
          });
        }
      }
      localStorage['highscores'] = JSON.stringify(g_highscores);
      if (typeof saveGlobalHighScores === 'function') saveGlobalHighScores();
    }

    // Update input field if it's already rendered
    var nameInput = document.getElementById('lobby-name');
    if (nameInput) nameInput.value = g_myName;
  }

  generateNickname();
}
var g_channel = null; // Either lobby or game channel
let g_explicitLeftUsers = new Set();
let g_opponentPresenceState = false;
let g_dragThrottleTimer = null;
let g_dragGhost = null;
let g_dragSeq = 0;
let g_lastRemoteDragSeq = -1;
let g_stateVersion = 0;
let g_opponentDisconnectSeconds = 0;
let g_reconnectTimer = null;
let g_lastMoveAt = 0;
let g_broadcastPipeline = [];
let g_broadcastPipelineTimer = null;
const BROADCAST_PIPELINE_DEBOUNCE_MS = 100;

// Timer state
let g_idleTimer = null;
let g_idleSeconds = 0;
let g_postGameTimer = null;
let g_myRematchGameId = null;
let g_lastEmojiSentAt = 0;
let g_mpGameEndReason = '';

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
        if (item.session || item.sessionId || item.date) {
          for (var j = 0; j < unique.length; j++) {
            if (((unique[j].playerId || unique[j].player) + '|' + unique[j].score) === dedupeKey) {
              if (!unique[j].session && item.session) unique[j].session = item.session;
              if (!unique[j].sessionId && item.sessionId) unique[j].sessionId = item.sessionId;
              if (!unique[j].date && item.date) unique[j].date = item.date;
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
        session: item.session || undefined,
        sessionId: item.sessionId || '',
        date: item.date || ''
      });
    }

    unique.sort(typeof gCompareScores === 'function' ? gCompareScores : function(a, b) {
      var nA = a ? a.score : -99;
      var nB = b ? b.score : -99;
      return (nA > nB) ? -1 : ((nA < nB) ? 1 : 0);
    });
    if (unique.length > 100) unique = unique.slice(0, 100);
    if (unique.length > 0) merged[key] = unique;
  }

  window.g_highscores = merged;
  localStorage['highscores'] = JSON.stringify(g_highscores);
  return hasLocalOnlyScores;
}

async function repairMissingSessions() {
  if (!window.supabaseClient) return;
  var repaired = localStorage['repaired_sessions'] ? JSON.parse(localStorage['repaired_sessions']) : {};
  var needsSave = false;
  for (var key in g_highscores) {
    if (Array.isArray(g_highscores[key])) {
      for (var i = 0; i < g_highscores[key].length; ++i) {
        var item = g_highscores[key][i];
        if (item.session && item.sessionId && !repaired[item.sessionId]) {
          try {
            await window.supabaseClient.from('sessions').upsert({
              id: item.sessionId,
              session_data: item.session,
              app_key: _dk(_hk)
            });
            repaired[item.sessionId] = true;
            needsSave = true;
            if (DEBUG) console.log('Repaired session to Supabase:', item.sessionId);
          } catch (e) {
            console.warn('Failed to repair session:', item.sessionId, e);
          }
        }
      }
    }
  }
  if (needsSave) {
    localStorage['repaired_sessions'] = JSON.stringify(repaired);
  }
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

    // Always run repair in case previous syncs missed sessions
    await repairMissingSessions();
  } catch (err) {
    console.warn('Unexpected error loading global high scores:', err);
  }
}

async function loadSessionFromCloud(sessionId) {
  if (!window.supabaseClient || !sessionId) return null;
  try {
    var { data, error } = await window.supabaseClient
      .from('sessions')
      .select('session_data')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return data ? data.session_data : null;
  } catch (err) {
    console.warn('Failed to load session from cloud:', err);
    return null;
  }
}

async function saveGlobalHighScores() {
  if (!window.supabaseClient) {
    if (DEBUG) console.log('Supabase client not available for saving.');
    return;
  }
  try {
    // Backfill missing sessionId for legacy scores (one-time migration)
    var needsLocalSave = false;
    for (var key in g_highscores) {
      if (Array.isArray(g_highscores[key])) {
        g_highscores[key].forEach(function(item) {
          if (item.session && !item.sessionId) {
            try {
              var sessionObj = JSON.parse(item.session);
              var newId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              sessionObj.id = newId;
              item.session = JSON.stringify(sessionObj);
              item.sessionId = newId;
              needsLocalSave = true;
              if (window.supabaseClient) {
                window.supabaseClient.from('sessions').upsert({
                  id: newId,
                  session_data: item.session,
                  app_key: _dk(_hk)
                }).catch(function(e) {
                  console.warn('Failed to backfill session to Supabase:', e);
                });
              }
            } catch (e) {
              // Skip malformed session JSON
            }
          }
        });
      }
    }
    if (needsLocalSave) {
      localStorage['highscores'] = JSON.stringify(g_highscores);
    }

    // One-time repair: ensure all local sessions with sessionId exist in Supabase
    await repairMissingSessions();

    // Enforce max 100 scored entries per Layout-Level combo
    var needsTrimSave = false;
    for (var key in g_highscores) {
      if (Array.isArray(g_highscores[key]) && g_highscores[key].length > 100) {
        g_highscores[key].sort(typeof gCompareScores === 'function' ? gCompareScores : function(a, b) {
          var nA = a ? a.score : -99;
          var nB = b ? b.score : -99;
          return (nA > nB) ? -1 : ((nA < nB) ? 1 : 0);
        });
        g_highscores[key] = g_highscores[key].slice(0, 100);
        needsTrimSave = true;
      }
    }
    if (needsTrimSave) {
      localStorage['highscores'] = JSON.stringify(g_highscores);
    }

    var scoresToSave = g_highscores || {};
    var sessionsPayload = [];
    var activeSessionIds = [];
    var seenSessionIds = {};

    for (var key in scoresToSave) {
      if (Array.isArray(scoresToSave[key])) {
        scoresToSave[key].forEach(function(item) {
          if (item.sessionId && item.session && !seenSessionIds[item.sessionId]) {
            seenSessionIds[item.sessionId] = true;
            sessionsPayload.push({
              id: item.sessionId,
              session_data: item.session
            });
          }
          if (item.sessionId) {
            activeSessionIds.push(item.sessionId);
          }
        });
      }
    }

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

    if (DEBUG) console.log('Syncing high scores and sessions to Supabase...');
    var { error } = await window.supabaseClient
      .rpc('sync_highscores_and_sessions', {
        p_id: SUPABASE_HIGHSCORES_ID,
        p_scores: strippedHighScores,
        p_sessions: sessionsPayload,
        p_active_session_ids: activeSessionIds,
        p_app_key: _dk(_hk)
      });

    if (error) {
      console.warn('Failed to save global high scores:', error.message || error, error);
    } else {
      if (DEBUG) console.log('Global high scores and sessions synced successfully.');
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

window.updatePlayerName = async function(newName) {
  var trimmed = (newName || (t('Player') + '_' + Math.floor(Math.random() * 10000))).substring(0, 32);
  g_myName = trimmed;
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
        startMultiplayerGame(payload.payload.gameId, payload.payload.fromId, payload.payload.fromName, false);
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
  g_myRematchGameId = null;
  g_lastEmojiSentAt = 0;
  localStorage['session_mode'] = 'mp';

  await leaveLobby();
  hideModal();
  if (g_isMobile) hideGameInfo();

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
    .on('broadcast', { event: 'rematch' }, ({ payload }) => {
      if (!payload || payload.fromId === g_lobbyUserId) return;
      leavePostGameState();
      if (g_myRematchGameId && g_myRematchGameId < payload.gameId) {
        return;
      }
      startMultiplayerGame(payload.gameId, g_opponentId, g_opponentName, false);
    })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => {
      handleReactionBroadcast(payload);
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
    lobbyBtn.title = t('Multiplayer Lobby');
  }

  var restartBtn = document.getElementById('restart');
  if (restartBtn) restartBtn.disabled = false;
}

function sendEmojiReaction(emoji) {
  if (!g_isMultiplayer || !g_channel) return;
  var now = Date.now();
  if (now - g_lastEmojiSentAt < 5000) {
    var wait = Math.ceil((5000 - (now - g_lastEmojiSentAt)) / 1000);
    g_bui.toast(t('Please wait') + ' ' + wait + 's...', 2000);
    return;
  }
  g_lastEmojiSentAt = now;
  if (g_bui && g_bui.hideEmojiPicker) g_bui.hideEmojiPicker();
  if (g_bui && g_bui.displayEmojiReaction) g_bui.displayEmojiReaction(emoji, true);
  sendBroadcastNow('reaction', {
    emoji: emoji,
    fromId: g_lobbyUserId,
    fromName: g_myName
  });
}

function handleReactionBroadcast(payload) {
  if (!payload || payload.fromId === g_lobbyUserId) return;
  if (g_bui && g_bui.displayEmojiReaction) {
    g_bui.displayEmojiReaction(payload.emoji, false);
  }
}

function enterPostGameState() {
  if (g_idleTimer) {
    clearInterval(g_idleTimer);
    g_idleTimer = null;
  }
  if (g_reconnectTimer) {
    clearTimeout(g_reconnectTimer);
    g_reconnectTimer = null;
  }
  if (g_postGameTimer) clearTimeout(g_postGameTimer);
  if (g_bui && g_bui.hideEmojiPicker) g_bui.hideEmojiPicker();
  g_postGameTimer = setTimeout(function() {
    cleanupMultiplayerSession();
  }, typeof g_wait_mp_rematch !== 'undefined' ? g_wait_mp_rematch : 60000);
}

function leavePostGameState() {
  if (g_postGameTimer) {
    clearTimeout(g_postGameTimer);
    g_postGameTimer = null;
  }
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
  if (g_postGameTimer) {
    clearTimeout(g_postGameTimer);
    g_postGameTimer = null;
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
  g_myRematchGameId = null;
  g_lastEmojiSentAt = 0;
  g_mpGameEndReason = '';

  if (g_bui && g_bui.hideEmojiPicker) g_bui.hideEmojiPicker();
  applyNonGameButtonPolicy();
  updateGameInfoLabels();
}

window.confirmRestartMultiplayer = function() {
  g_bui.prompt(
    t('Restarting will forfeit this game.'),
    '<button class="button secondary" onclick="hideModal()">' + t('Cancel') + '</button>'
      + '&nbsp;&nbsp;<button class="button" onclick="hideModal();finalizeMultiplayerGame(\'forfeit\', true);g_bui.restart();if (g_isMobile) hideGameInfo()">' + t('Forfeit &amp; Restart') + '</button>'
  );
};

window.initiateRematch = function() {
  if (!g_isGameOver) return;

  // If opponent is gone (forfeit / disconnect), fall back to single-player
  if (!g_isMultiplayer) {
    g_bui.restart();
    return;
  }

  var newGameId = 'game_' + Math.random().toString(36).substr(2, 9);
  g_myRematchGameId = newGameId;
  leavePostGameState();
  sendBroadcastNow('rematch', {
    gameId: newGameId,
    fromId: g_lobbyUserId,
    fromName: g_myName
  });
  startMultiplayerGame(newGameId, g_opponentId, g_opponentName, true);
};

function finalizeMultiplayerGame(reason, skipLocalAnnounce) {
  if (!g_isMultiplayer || g_isGameOver) return;
  g_isGameOver = true;
  g_mpGameEndReason = reason || '';

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

  if (reason === 'passes' || reason === 'ended') {
    enterPostGameState();
  } else {
    cleanupMultiplayerSession();
  }
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
  if (g_isMobile) hideGameInfo();
  g_isMultiplayer = true;

  // Wait a tick for letpool to be built, then sync it
  setTimeout(() => {
    // Reset pool
    if (typeof g_origletpool !== 'undefined') {
      g_letpool = g_origletpool.slice();
      shufflePool();
      if (g_letpool.length > g_tiles_in_bag) {
        g_letpool = g_letpool.slice(0, g_tiles_in_bag);
      }
      shufflePool();
    }

    var rawMyRack = takeLetters('');
    var rawOppRack = takeLetters('');

    var myRack = shuffleRackString(rawMyRack);
    var oppRack = shuffleRackString(rawOppRack);
    g_bui.setPlayerRack(myRack);
    g_bui.setOpponentRack(oppRack);
    g_bui.setTilesLeft(g_letpool.length);
    g_bui.makeTilesFixed();
    updateTurnIndicator(); // Ensure UI reflects turn state
    updateGameInfoLabels();
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
  // Supabase send() returns a promise. We don't wait for it here to keep UI responsive,
  // but we should handle the case where it might fail or fallback.
  g_channel.send({
    type: 'broadcast',
    event: event,
    payload: payload
  }).catch(err => {
    if (DEBUG) console.warn('Broadcast send failed:', err);
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

var g_dragLastSentX = 0;
var g_dragLastSentY = 0;
var g_dragLastSentTime = 0;
var g_cachedBoardRect = null;
var g_cachedLocalSourceRect = null;

function sendDragPosition(x, y, sourceId, sourceCenter) {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;
  if (g_dragThrottleTimer) return;

  g_dragThrottleTimer = setTimeout(function() {
    g_dragThrottleTimer = null;
  }, 50);

  // Convert to relative coordinates based on #board for maximum stability
  if (!g_cachedBoardRect) {
    var board = el('board');
    if (board) g_cachedBoardRect = board.getBoundingClientRect();
  }

  var bx = 0, by = 0;
  if (g_cachedBoardRect) {
    bx = (x - g_cachedBoardRect.left) / g_cachedBoardRect.width;
    by = (y - g_cachedBoardRect.top) / g_cachedBoardRect.height;
  }

  var payload = {
    seq: ++g_dragSeq,
    bx: bx, // Board-relative X
    by: by, // Board-relative Y
    x: x,   // Fallback
    y: y
  };
  if (sourceId) payload.sourceId = sourceId;
  if (sourceCenter && typeof sourceCenter.sourceCenterX === 'number' && typeof sourceCenter.sourceCenterY === 'number') {
    // Also relativize source center
    if (g_cachedBoardRect) {
        payload.bsX = (sourceCenter.sourceCenterX - g_cachedBoardRect.left) / g_cachedBoardRect.width;
        payload.bsY = (sourceCenter.sourceCenterY - g_cachedBoardRect.top) / g_cachedBoardRect.height;
    }
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

  // Scrabble/Vietboard rack indices are 0 to g_racksize - 1.
  // When players 'face each other', their racks are horizontally mirrored.
  // Leftmost (0) for one is Rightmost (g_racksize - 1) for the other.
  if (remoteId.startsWith('pl') || remoteId.startsWith('op')) {
    var prefix = remoteId.startsWith('pl') ? 'op' : 'pl';
    var index = parseInt(remoteId.slice(2));
    if (!isNaN(index)) {
      var mirroredIndex = (g_racksize - 1) - index;
      return prefix + mirroredIndex;
    }
  }

  return remoteId;
}

function localizeDragPosition(payload) {
  if (!payload) return null;

  if (!g_cachedBoardRect) {
    var board = el('board');
    if (board) g_cachedBoardRect = board.getBoundingClientRect();
  }

  // Use board-relative coordinates for resolution independence
  var x = (typeof payload.bx === 'number' && g_cachedBoardRect) ? (g_cachedBoardRect.left + payload.bx * g_cachedBoardRect.width) : payload.x;
  var y = (typeof payload.by === 'number' && g_cachedBoardRect) ? (g_cachedBoardRect.top + payload.by * g_cachedBoardRect.height) : payload.y;
  var sX = (typeof payload.bsX === 'number' && g_cachedBoardRect) ? (g_cachedBoardRect.left + payload.bsX * g_cachedBoardRect.width) : payload.sourceCenterX;
  var sY = (typeof payload.bsY === 'number' && g_cachedBoardRect) ? (g_cachedBoardRect.top + payload.bsY * g_cachedBoardRect.height) : payload.sourceCenterY;

  var sourceId = payload.sourceId;

  if (typeof sourceId === 'string') {
    if (!g_cachedLocalSourceRect) {
      // Rack IDs are mirrored for face-to-face; board IDs (absolute) are not.
      var localSourceId = (sourceId.startsWith('pl') || sourceId.startsWith('op')) ? mapRemoteRackCellId(sourceId) : sourceId;
      var localSourceCell = el(localSourceId);
      if (localSourceCell) g_cachedLocalSourceRect = localSourceCell.getBoundingClientRect();
    }

    if (g_cachedLocalSourceRect && (sourceId.startsWith('pl') || sourceId.startsWith('op')) && typeof sX === 'number' && typeof sY === 'number') {
      // We want the ghost to start at the LOCAL mapped rack center
      var startX_local = g_cachedLocalSourceRect.left + g_cachedLocalSourceRect.width / 2;
      var startY_local = g_cachedLocalSourceRect.top + g_cachedLocalSourceRect.height / 2;

      // Decay the error as the tile moves away from the source (vertically)
      // Use a tight transition (1 cell height) to snap to absolute board position
      var dy_moved = Math.abs(y - sY);
      var transitionDist = g_cachedLocalSourceRect.height;
      var fade = Math.max(0, 1 - dy_moved / transitionDist);

      if (fade > 0) {
          // At the rack, we mirror the offset relative to the local mapped cell center.
          var offsetX = x - sX;
          var offsetY = y - sY;

          var x_at_rack = startX_local - offsetX;
          var y_at_rack = startY_local - offsetY;

          // Interpolate between mirrored rack position and absolute board position
          x = x + (x_at_rack - x) * fade;
          y = y + (y_at_rack - y) * fade;
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

  // Clear local sender-side cache
  g_cachedBoardRect = null;
  g_cachedLocalSourceRect = null;
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

function cleanupDragGhosts() {
  if (g_dragGhost) {
    g_dragGhost.remove();
    g_dragGhost = null;
  }
  // Also sweep for any orphaned ghosts that may have lost their reference
  var orphans = document.querySelectorAll('.mp-ghost');
  for (var i = 0; i < orphans.length; ++i) {
    orphans[i].remove();
  }
  // Clear any stuck drop-target highlights on the board
  var stuckCells = document.querySelectorAll('#board td');
  for (var j = 0; j < stuckCells.length; ++j) {
    var s = stuckCells[j].style;
    if (s.backgroundColor === 'rgb(131, 191, 231)' || s.backgroundColor === '#83bfe7') {
      s.backgroundColor = '';
      s.border = '';
    }
  }
}

function renderOpponentRackTileBack(cell) {
  if (!cell) return;
  cell.innerHTML = '<div class="drag t2">&nbsp;&nbsp;</div>';
}

function renderOpponentBoardTile(cell, letter, points) {
  if (!cell) return;
  var displayLetter = letter;
  if (displayLetter === '*' || displayLetter === ' ') displayLetter = '&nbsp;&nbsp;';
  else displayLetter = String(displayLetter || '').toUpperCase();
  var p = parseInt(points);
  var pointsHtml = (p > 0) ? '<sup><small>' + p + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';
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

  if (toId && toId.charAt(0) === 'c') {
    // Board cell: render the real letter so the opponent sees what was placed
    var p = (typeof payload.points === 'number') ? payload.points : (g_letscore[payload.letter] || 0);
    renderOpponentBoardTile(toCell, payload.letter || '', p);
  } else if (toId && toId.startsWith('op')) {
    // Opponent rack cell: still show blank back
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
    cleanupDragGhosts();
    // Reset receiver-side cache
    g_cachedBoardRect = null;
    g_cachedLocalSourceRect = null;
    return;
  }

  if (!g_dragGhost) {
    g_dragGhost = document.createElement('div');
    g_dragGhost.id = 'mp-drag-ghost';
    g_dragGhost.className = 'drag t2 mp-ghost';

    // Core styling for translate3d efficiency
    g_dragGhost.style.position = 'fixed';
    g_dragGhost.style.left = '0';
    g_dragGhost.style.top = '0';
    g_dragGhost.style.zIndex = '10000';
    g_dragGhost.style.pointerEvents = 'none';
    g_dragGhost.style.transition = 'none'; // Disable transitions to prevent trailing lag

    document.body.appendChild(g_dragGhost);
  }

  g_dragGhost.innerHTML = '&nbsp;&nbsp;';
  var localPos = localizeDragPosition(payload);
  if (localPos) {
    var gw = 50;
    var gh = 50;
    if (g_cachedLocalSourceRect) {
        gw = g_cachedLocalSourceRect.width;
        gh = g_cachedLocalSourceRect.height;
    } else if (g_cachedBoardRect) {
        gw = g_cachedBoardRect.width / g_boardwidth;
        gh = g_cachedBoardRect.height / g_boardheight;
    }

    // Set size to match original tile
    g_dragGhost.style.width = gw + 'px';
    g_dragGhost.style.height = gh + 'px';

    // Center using translate(-50%, -50%) combined with absolute position
    g_dragGhost.style.transform = 'translate3d(' + localPos.x + 'px, ' + localPos.y + 'px, 0) translate(-50%, -50%)';
  }
}

function handleGameStateBroadcast(payload) {
  if (payload.type === 'init') {
    // Phase 4: Ensure board is fresh for both players
    if (g_bui) g_bui.restart();
    if (g_isMobile) hideGameInfo();
    g_isMultiplayer = true; // g_bui.restart() might have cleared it via cleanup

    setTimeout(() => {
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
    }, 100);
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
    // Buttons are disabled if it is NOT our turn OR if we are currently shuffling
    btn.disabled = !g_isMyTurn || (typeof g_isShuffling !== 'undefined' && g_isShuffling);
  });

  // Enforce turn-based tile interaction: when it is not your turn,
  // disable dragging from your rack to prevent local unsent moves.
  if (g_isMultiplayer && g_bui) {
    if (g_isMyTurn) g_bui.makeTilesFixed();
    else {
      // Disable ALL tiles (board + rack) when it is not our turn.
      // setPlayerRack()->setLetters()->rd.init() can re-enable dragging
      // on board tiles, so we must explicitly shut everything down.
      g_bui.rd.enableDrag(false, '#drag div');
    }
  }

  // High Scores: always enabled during multiplayer
  const hsBtn = document.getElementById('highscores');
  if (hsBtn) {
    hsBtn.disabled = false;
  }

  // Restart: always enabled to allow recovery from corrupted sessions
  const restartBtn = document.getElementById('restart');
  if (restartBtn) {
    restartBtn.disabled = false;
  }

  // Lobby: disabled once game starts
  const lobbyBtn = document.getElementById('lobby');
  if (lobbyBtn) {
    if (g_isMultiplayer && !g_board_empty) {
      lobbyBtn.disabled = true;
      lobbyBtn.title = t('Finish the current game before joining the lobby');
    } else {
      lobbyBtn.disabled = false;
      lobbyBtn.title = t('Multiplayer Lobby');
    }
  }
}

// -----------------------------------------------------------------------------
// GAMEPLAY SYNC
// -----------------------------------------------------------------------------

function onMultiplayerMove(passed) {
  if (!g_isMyTurn || g_isGameOver) return;

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
    // Keep global board state in sync with current UI state before validation.
    // checkValidPlacement reads from g_board / g_boardpoints / g_boardtypes.
    var prevBoardObj = JSON.parse(JSON.stringify(g_board));
    var prevBoardP = JSON.stringify(g_boardpoints);
    var prevBoardT = JSON.stringify(g_boardtypes);

    g_board = normalizeBoardMatrix(newBoard, '');
    g_boardpoints = normalizeBoardMatrix(newBoardP, 0);
    g_boardtypes = normalizeBoardMatrix(newBoardT, 0);

    var placement = g_bui.getPlayerPlacement();
    pinfo = checkValidPlacement(placement);
    pstr = pinfo.played;

    if (pstr === '') {
      // Revert board state on invalid move
      g_board = prevBoardObj;
      g_boardpoints = JSON.parse(prevBoardP);
      g_boardtypes = JSON.parse(prevBoardT);

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

    // Reset consecutive passes
    g_passes = 0;

    if (pstr.length === g_racksize) scoreEarned += g_allLettersBonus;
    scoreEarned += pinfo.score;

    g_bui.addToHistory(pinfo.words, 1);
    var pletters = g_bui.getPlayerRack();
    pletters = takeLetters(pletters);
    g_bui.setPlayerRack(pletters);
    rackAfter = pletters;
    g_bui.setTilesLeft(g_letpool.length);
  } else {
    g_bui.cancelPlayerPlacement();
    ++g_passes;
    if (g_passes >= g_maxpasses) {
      finalizeMultiplayerGame('passes');
      // No return here, we still want to broadcast the move that ended the game
    }
  }

  // We made a valid move. Now broadcast it to the opponent!
  g_pscore += scoreEarned;
  g_bui.setPlayerScore(scoreEarned, g_pscore);

  if (pinfo && pinfo.words && pinfo.words.length > 0) {
    var words = [];
    for (var i = 0; i < pinfo.words.length; ++i) {
      words.push('<a href="javascript:g_bui.wordInfo(\'' + pinfo.words[i] + '\')">' + pinfo.words[i] + '</a>');
    }
    var elStatus = el('status');
    elStatus.innerHTML = t('You') + ' ' + t('scored ') + scoreEarned + ' ' + t(' points for ') + words.join(', ').toUpperCase();
  }

  var moveData = {
    type: 'move',
    passed: passed,
    swapped: false, // Handle swap later
    pstr: pstr,
    words: pinfo ? pinfo.words : [],
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

  if (!passed && rackAfter.replace(/\./g, '') === '' && g_letpool.length === 0) {
    g_rackEmptiedBy = 'player';
    g_isGameOver = true;
    announceWinner();
    enterPostGameState();
    return;
  }
}

function handleMoveBroadcast(payload) {
  if (g_isGameOver) return;
  if (payload.type === 'move') {
    if (payload.stateVersion && payload.stateVersion <= g_stateVersion) return;
    g_stateVersion = Math.max(g_stateVersion, payload.stateVersion || 0);

    // Clean up any stray ghost tiles before applying the move
    cleanupDragGhosts();

    // Apply opponent's move
    if (!payload.passed) {
      // Diff against previous board before applying the new payload board
      var prevBoard = Array.isArray(g_board) ? g_board : [];
      var nextBoard = Array.isArray(payload.board) ? payload.board : [];

      var diffWord = [];
      for (var x = 0; x < g_boardwidth; ++x) {
        for (var y = 0; y < g_boardheight; ++y) {
          var charBefore = (prevBoard[x] && prevBoard[x][y]) || '';
          var charAfter = (nextBoard[x] && nextBoard[x][y]) || '';
          if (charAfter !== '' && charBefore === '') {
            var ltr = (charAfter === charAfter.toLowerCase() && charAfter !== '') ? '*' : charAfter;
            diffWord.push({
              'x': x,
              'y': y,
              'ltr': charAfter,
              'lscr': g_letscore[ltr] || 0
            });
          }
        }
      }

      g_board = normalizeBoardMatrix(nextBoard, '');
      g_boardpoints = normalizeBoardMatrix(payload.boardp, 0);
      // Do NOT apply payload.boardt wholesale — g_boardtypes is perspective-
      // relative (1 = my tiles, 2 = opponent tiles).  The receiver already
      // has its own correct perspective for tiles played so far.
      g_board_empty = payload.boardEmpty;
      if (!g_board_empty) {
        var elUp = el('a.link.up');
        var elDown = el('a.link.down');
        if (elUp) elUp.classList.add('disabled');
        if (elDown) elDown.classList.add('disabled');
        var elLayout = el('bonuseslayout');
        if (elLayout) elLayout.disabled = true;
      }
      g_passes = 0; // Reset consecutive passes on valid move

      // Mark every newly-placed tile as belonging to the opponent (type 2)
      // from the receiver's perspective.
      for (var i = 0; i < diffWord.length; ++i) {
        var dp = diffWord[i];
        g_boardtypes[dp.x][dp.y] = 2;
      }

      // Clear any board cell that currently shows a "preview" tile (no holds data).
      // This handles clearing stray previews and prepares cells for the new move.
      for (var x = 0; x < g_boardwidth; ++x) {
        for (var y = 0; y < g_boardheight; ++y) {
          var cellId = 'c' + x + '_' + y;
          var cellObj = el(cellId);
          if (cellObj && cellObj.innerHTML !== '' && !cellObj.holds) {
            cellObj.innerHTML = '';
          }
        }
      }

      var syncBoardUI = function() {
        for (var x = 0; x < g_boardwidth; ++x) {
          var boardColumn = g_board[x];
          var boardTypeColumn = g_boardtypes[x];
          if (!Array.isArray(boardColumn) || !Array.isArray(boardTypeColumn)) continue;

          for (var y = 0; y < g_boardheight; ++y) {
            var cell = el('c' + x + '_' + y);
            var char = boardColumn[y];
            if (char && char !== '' && cell) {
              var displayChar = char.toUpperCase();
              // Direct mapping: type 1 → t1 (green, my tiles), type 2 → t2 (red, opponent tiles)
              var tClass = 't' + (boardTypeColumn[y] || 2);
              var points = (g_boardpoints[x] && g_boardpoints[x][y]) || 0;
              var p = parseInt(points);
              var pointsHtml = (p > 0) ? '<sup><small>' + p + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';
              var html = '<div class="drag ' + tClass + '">' + (char !== ' ' ? displayChar : '&nbsp;&nbsp;') + pointsHtml + '</div>';
              cell.innerHTML = html;
              var holdsObj = { 'letter': char, 'points': p };
              cell.holds = holdsObj;
              if (cell.firstChild) cell.firstChild.holds = holdsObj;
            } else if (cell && (!char || char === '')) {
              cell.holds = '';
              cell.innerHTML = '';
            }
          }
        }
        g_bui.makeTilesFixed();
      };

      function onOpponentMoveDone() {
        g_bui.setOpponentRack(payload.rackAfter);
        g_oscore += payload.score;
        g_bui.setOpponentScore(payload.score, g_oscore);
        g_letpool = payload.letpool;
        g_bui.setTilesLeft(g_letpool.length);

        if (payload.words && payload.words.length > 0) {
          g_bui.addToHistory(payload.words, 2);
        }

        var elStatus = el('status');
        elStatus.innerHTML = t('Opponent') + ' ' + t('scored ') + payload.score;

        // Ensure board UI is perfectly in sync
        syncBoardUI();

        if (payload.rackAfter.replace(/\./g, '') === '' && g_letpool.length === 0) {
          g_rackEmptiedBy = 'opponent';
          g_isGameOver = true;
          announceWinner();
          enterPostGameState();
          return;
        }

        // Game is still ongoing — hand turn back to local player
        g_isMyTurn = true;
        updateTurnIndicator();
        updateGameInfoLabels();

        g_lastMoveAt = Date.now();
        saveMultiplayerSession();
      }

      if (diffWord.length > 0) {
        if (g_isMultiplayer) {
          // In multiplayer the opponent already placed tiles on their screen.
          // Skip the rack-to-board animation (which is SP-only) and render directly.
          hideModal();
          onOpponentMoveDone();
          // Skip the rest of the synchronous updates
          return;
        }

        // Single-player: restore opponent rack so placeOnBoard can animate tiles from it
        g_bui.setOpponentRack(payload.rackBefore || '');
        placeOnBoard(diffWord, onOpponentMoveDone);

        // Skip the rest of the synchronous updates because they are handled in the callback
        return;
      } else {
        syncBoardUI();
        if (payload.words && payload.words.length > 0) {
          g_bui.addToHistory(payload.words, 2);
        }
      }
    }

    // Extra safety: clear any ghost tiles that survived the move processing
    cleanupDragGhosts();

    g_oscore += payload.score;
    g_bui.setOpponentScore(payload.score, g_oscore);
    g_bui.setOpponentRack(payload.rackAfter);
    g_letpool = Array.isArray(payload.letpool) ? payload.letpool : (Array.isArray(g_letpool) ? g_letpool : []);
    g_bui.setTilesLeft((g_letpool || []).length);

    if (!payload.passed) {
      var elStatus = el('status');
      elStatus.innerHTML = t('Opponent') + ' ' + t('scored ') + payload.score;
    }

    if (payload.passed) {
      g_bui.toast(payload.swapped ? t('Opponent swapped') : t('Opponent passed'));
      if (!payload.swapped) {
        ++g_passes;
        if (g_passes >= g_maxpasses) {
          g_isGameOver = true;
          announceWinner();
          enterPostGameState();
          return;
        }
      } else {
        g_passes = 0; // Reset if they swapped (some rules vary, but usually swap resets it)
      }
    }

    // Check if game over
    if (payload.rackAfter.replace(/\./g, '') === '' && g_letpool.length === 0) {
      g_rackEmptiedBy = 'opponent';
      g_isGameOver = true;
      announceWinner();
      enterPostGameState();
      return;
    }

    // Game is still ongoing — hand turn back to local player
    g_isMyTurn = true;
    updateTurnIndicator();
    updateGameInfoLabels();

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
      history: g_history,
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
        if (mpData.isGameOver) {
          localStorage.removeItem('session_mp');
          cleanupMultiplayerSession();
          return;
        }
        if (DEBUG) console.log('Resuming multiplayer session for game:', mpData.gameId);

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

        // Restore words-played history
        g_history = Array.isArray(mpData.history) ? mpData.history : [];
        var histHtml = '<table>';
        for (var i = 0; i < g_history.length; ++i) {
          var entry = g_history[i];
          histHtml += g_bui.renderWordPlayed(entry[0], entry[1]);
        }
        histHtml += '</table>';
        el('history').innerHTML = histHtml;
        g_bui.hlines = histHtml;
        g_bui.hcount = g_history.length;

        // Apply restored rack and board state immediately
        if (DEBUG) console.log('Applying restored rack and board state...');
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
              if (char && char !== '' && typeof char !== 'undefined' && cell && cell.innerHTML === '') {
                var displayChar = char.toUpperCase();
                var tClass = boardTypeColumn[y] === 1 ? 't1' : 't2';
                var points = (g_boardpoints[x] && g_boardpoints[x][y]) || 0;
                var p = parseInt(points);
                var pointsHtml = (p > 0) ? '<sup><small>' + p + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';
                var html = '<div class="drag ' + tClass + '">' + (char !== ' ' ? displayChar : '&nbsp;&nbsp;') + pointsHtml + '</div>';
                cell.innerHTML = html;
                var holdsObj = { 'letter': char, 'points': p };
                cell.holds = holdsObj;
                if (cell.firstChild) cell.firstChild.holds = holdsObj;
              } else if (cell && (!char || char === '')) {
                cell.holds = '';
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
        broadcastGameState({ type: 'request_state' });
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
    g_mpGameEndReason = payload.reason || '';
    if (payload.reason === 'forfeit') {
      g_bui.prompt(t('Opponent has left the game.'));
    }
    announceWinner();
    if (payload.reason === 'passes' || payload.reason === 'ended') {
      enterPostGameState();
    } else {
      cleanupMultiplayerSession();
    }
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
      myRack: g_bui.racks[2] || '', // Use committed opponent rack (which is their player rack)
      oppRack: g_bui.racks[1] || '', // Use committed player rack (which is their opponent rack)
      letpool: g_letpool,
      isMyTurn: !g_isMyTurn,
      stateVersion: g_stateVersion,
      lastMoveAt: g_lastMoveAt || Date.now()
    });
  } else if (payload.type === 'state_sync') {
    if (payload.stateVersion && payload.stateVersion < g_stateVersion) return;

    // We received a sync from the other player
    g_board = normalizeBoardMatrix(payload.board, '');
    g_boardpoints = normalizeBoardMatrix(payload.boardp, 0);
    g_boardtypes = normalizeBoardMatrix(payload.boardt, 0);
    g_board_empty = payload.boardEmpty;
    if (!g_board_empty) {
      var elUp = el('a.link.up');
      var elDown = el('a.link.down');
      if (elUp) elUp.classList.add('disabled');
      if (elDown) elDown.classList.add('disabled');
      var elLayout = el('bonuseslayout');
      if (elLayout) elLayout.disabled = true;
    }
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
        if (char && char !== '' && typeof char !== 'undefined') {
          var displayChar = char.toUpperCase();
          var tClass = boardTypeColumn[y] === 1 ? 't2' : 't1';
          var points = (g_boardpoints[x] && g_boardpoints[x][y]) || 0;
          var p = parseInt(points);
          var pointsHtml = (p > 0) ? '<sup><small>' + p + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';
          var html = '<div class="drag ' + tClass + '">' + (char !== ' ' ? displayChar : '&nbsp;&nbsp;') + pointsHtml + '</div>';
          cell.innerHTML = html;
          var holdsObj = { 'letter': char, 'points': p };
          cell.holds = holdsObj;
          if (cell.firstChild) cell.firstChild.holds = holdsObj;
        } else {
          cell.holds = '';
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
    var idleLimit = Math.floor((typeof g_wait_mp_idle !== 'undefined' ? g_wait_mp_idle : 3600000) / 1000);
    g_idleSeconds++;

    if (g_idleSeconds === idleLimit - 60) {
      g_bui.prompt(t('WARNING: Game will end in 1 minute due to inactivity.'));
    }

    if (g_idleSeconds >= idleLimit - 10 && g_idleSeconds <= idleLimit) {
      var timeLeft = idleLimit - g_idleSeconds;
      var statusEl = document.getElementById('status');
      if (statusEl) statusEl.innerHTML = '<span style="color:red">' + t('Game ends in ') + timeLeft + t('s...') + '</span>';
    }

    if (g_idleSeconds >= idleLimit) {
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

  // Level is only relevant in single-player; disable controls in multiplayer
  var levelRow = document.querySelector('tr.level');
  if (levelRow) {
    var levelControls = levelRow.querySelectorAll('a, select');
    for (var i = 0; i < levelControls.length; ++i) {
      var ctrl = levelControls[i];
      if (g_isMultiplayer) {
        ctrl.classList.add('disabled');
        ctrl.setAttribute('aria-disabled', 'true');
        if (ctrl.tagName === 'SELECT') ctrl.disabled = true;
      } else {
        ctrl.classList.remove('disabled');
        ctrl.removeAttribute('aria-disabled');
        if (ctrl.tagName === 'SELECT') ctrl.disabled = false;
      }
    }
  }

  // Emoji reaction button enabled only in multiplayer
  var reactBtns = document.querySelectorAll('#react');
  for (var i = 0; i < reactBtns.length; ++i) {
    reactBtns[i].disabled = !g_isMultiplayer;
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
