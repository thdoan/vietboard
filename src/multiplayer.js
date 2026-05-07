// Supabase integration for Vietboard Multiplayer

// Supabase details
const SUPABASE_URL = 'https://awolvbshyvcrsqwrbjxe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Oju2rh1kaNFcvlPfnssF7A_4YpvQKCH'; // Note: publishable key, safe for client-side
const SUPABASE_HIGHSCORES_TABLE = 'highscores';
const SUPABASE_HIGHSCORES_ID = 'vietboard';

const DRAG_TRANSITION_MS = 200; // Standard transition for all drag gestures

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
var g_isHost = false;
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
  g_myName = generateUniquePlayerName();
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
      if (DEBUG) console.warn(t('Failed to generate nickname.'), response.status || '', '\n' + t('Using fallback method...'));
      sNickname = t('Player') + '_' + sRandInt;
    }

    var oldName = g_myName;
    g_myName = generateUniquePlayerName();
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
let g_opponentPresenceState = false;
let g_dragThrottleTimer = null;
let g_dragGhost = null;
let g_dragSeq = 0;
let g_lastRemotePositionSeq = -1; // Only tracks position broadcasts; commands (preview/clear/end) are ungated
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
let g_rematchState = 'idle'; // 'idle' | 'waiting' | 'received' | 'executing'
let g_rematchTimer = null;
let g_rematchFallbackTimer = null;
let g_lastEmojiSentAt = 0;
var g_mpGameEndReason = '';
let g_mpAutoSaveTimer = null;
let g_dbVersion = 0; // DB-as-SSOT: tracks games.version for optimistic concurrency
let g_lastDBGameState = null; // Last game state snapshot written to DB (centralized dedup)
let g_dbWriteInProgress = false; // Guard to prevent syncGameStateFromDB from clobbering in-flight writes
let g_deferredDBSync = false;    // Set when a DB sync is skipped due to active drag
let g_deferredDbState = null;
let g_lastLocalRackChange = 0;   // Timestamp of last local rack modification (drag)

// Remote drag guard
const REMOTE_DRAG_TIMEOUT_MS = 5000;
const REMOTE_DRAG_COOLDOWN_MS = 400;
let g_remoteDragging = false;
let g_remoteDragToken = null;
let g_remoteDragTimeout = null;
let g_remoteDragCooldown = null;

// Debug stats
let g_deferredDbSyncs = 0;
let g_remoteDragTimeoutUnlocks = 0;
let g_remoteDragCooldownFlushes = 0;
let g_overlayReapplies = 0;

let g_resumeToast = null;
let g_connectingToast = null;
let g_isResuming = false;
let g_channelSubscribed = false;
let g_resumeConnectionTimer = null;
let g_resumeFailTimer = null;
let g_lobbySubscribedAt = 0;
let g_lobbyFirstSubscribed = false;
let g_lobbyJustLoaded = false;
let g_lobbyReconnectTimer = null;
let g_lobbyRejoining = false;
let g_lastLobbyTrackAt = 0;
let g_lastForceRejoinAt = 0;
let g_lastReconnectAt = 0;
let g_lobbyRenderTimer = null;

let g_playersInGames = new Set();      // player IDs with started/accepted invites (DB source of truth)
let g_lobbyRefreshTimer = null;
let g_lastSyncKeys = new Set();        // keys from previous presence sync (true-delta join toasts)
let g_lastLobbyRefreshAt = 0;          // throttle refreshPlayersInGames in background heartbeat

let g_cachedInitPayload = null;        // host caches init state for idempotent re-send
let g_seenInitIds = new Set();

let g_initRetryCount = 0;
let g_initRetryTimer = null;
const MAX_INIT_RETRIES = 3;
const INIT_RETRY_DELAY_MS = 5000;

let g_connectingInvites = new Set();   // gameIds in "connecting" state after accept
let g_lastCleanupAt = 0;               // throttle cleanupStaleInvites()

// Channel lifecycle guards
let g_activeChannelType = null;   // 'lobby' | 'game'
let g_activeGameId = null;        // current gameId when type==='game'
let g_channelSubscribing = false; // true while subscribe handshake is in flight
let g_lastAppliedMoveTimestamp = 0;

// Invite queue (lobby only, backed by Supabase Realtime)
let g_inviteSub = null;      // Realtime subscription for invites to me
let g_myInviteSub = null;    // Realtime subscription for my outgoing invites
let g_pendingInvites = {};   // gameId -> {from_id, from_name, created_at}
let g_myInvites = {};        // gameId -> {to_id, to_name, sent_at}

// Hybrid heartbeat for reliable lobby lists on mobile
var g_lobbyHeartbeats = {};  // opponentId -> {name, lastPing}
let g_lobbyHeartbeatTimer = null;
const LOBBY_HEARTBEAT_INTERVAL_MS = 30000;
const LOBBY_HEARTBEAT_STALE_MS = 60000;

function isReservedPlayerName(name) {
  if (!name || typeof name !== 'string') return true;
  var lower = name.trim().toLowerCase();
  // Block "Computer" in all supported languages + common variants
  var reserved = ['computer', 'máy tính', 'máy', 'tính', 'bot', 'ai', 'cpu'];
  for (var i = 0; i < reserved.length; ++i) {
    if (lower === reserved[i]) return true;
  }
  return false;
}

function getKnownPlayerNames() {
  var names = {};

  // 1. Local high scores (all entries ever recorded locally)
  if (typeof g_highscores === 'object' && g_highscores) {
    for (var key in g_highscores) {
      if (Array.isArray(g_highscores[key])) {
        g_highscores[key].forEach(function(item) {
          if (item && item.player) {
            var raw = item.player;
            // Strip "You (name)" wrapper to get the real name
            var match = raw.match(/^You \((.+)\)$/);
            var realName = match ? match[1] : raw;
            if (realName && realName !== 'You' && realName !== t('You')) {
              names[realName.toLowerCase()] = true;
            }
          }
        });
      }
    }
  }

  // 2. Currently online players (presence)
  if (g_channel && g_activeChannelType === 'lobby') {
    var pstate = g_channel.presenceState();
    for (var id in pstate) {
      if (id === g_lobbyUserId) continue;
      var metas = pstate[id];
      var user = metas.length > 0 ? metas[metas.length - 1] : null;
      if (user && user.name) names[user.name.toLowerCase()] = true;
    }
  }

  // 3. Heartbeat cache
  var now = Date.now();
  for (var id in g_lobbyHeartbeats) {
    if (id === g_lobbyUserId) continue;
    var hb = g_lobbyHeartbeats[id];
    if (now - hb.lastPing > LOBBY_HEARTBEAT_STALE_MS) continue;
    if (hb.name) names[hb.name.toLowerCase()] = true;
  }

  return names;
}

function sanitizePlayerName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().replace(/ {2,}/g, ' ').substring(0, 32);
}

var g_validNameRegex = /^[\p{L}\p{N}_\-. ]+$/u;

function validatePlayerName(desiredName) {
  var name = sanitizePlayerName(desiredName);
  if (!name) {
    return { valid: false, reason: 'empty' };
  }
  if (!g_validNameRegex.test(name)) {
    return { valid: false, reason: 'invalid' };
  }
  if (isReservedPlayerName(name)) {
    return { valid: false, reason: 'reserved' };
  }
  var existing = getKnownPlayerNames();
  var lower = name.toLowerCase();
  // Allow keeping your own current name
  if (g_myName && lower === g_myName.toLowerCase()) {
    return { valid: true };
  }
  if (existing[lower]) {
    return { valid: false, reason: 'taken' };
  }
  return { valid: true };
}

function generateUniquePlayerName() {
  var base = t('Player') + '_' + Math.floor(Math.random() * 10000);
  var existing = getKnownPlayerNames();
  var lower = base.toLowerCase();
  if (!existing[lower]) return base;
  var suffix = 2;
  var candidate = base + ' (' + suffix + ')';
  while (existing[candidate.toLowerCase()] && suffix < 1000) {
    suffix++;
    candidate = base + ' (' + suffix + ')';
  }
  return candidate.substring(0, 32);
}

function initSupabase() {
  if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    if (DEBUG) console.error(t('Supabase library not loaded.'));
  }
}
initSupabase();

function mpLog(category, level, msg, data) {
  if (!DEBUG) return;
  var prefix = '[' + category + ']';
  if (data) console[level](prefix, msg, data);
  else console[level](prefix, msg);
}

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
      var sessionDedupeKey = item.sessionId ? (item.sessionId + '|' + score) : null;
      var currentUserId = (typeof g_lobbyUserId !== 'undefined' && g_lobbyUserId) ? String(g_lobbyUserId).trim() : '';

      // Check if this local score is missing from remote
      if (i < localList.length && !remoteScoresSet[dedupeKey]) {
        hasLocalOnlyScores = true;
        if (DEBUG) console.log('Detected local-only high score:', dedupeKey, 'in', key);
      }

      var duplicateIndex = -1;
      if (seen[dedupeKey]) {
        for (var j = 0; j < unique.length; j++) {
          if (((unique[j].playerId || unique[j].player) + '|' + unique[j].score) === dedupeKey) {
            duplicateIndex = j;
            break;
          }
        }
      } else if (sessionDedupeKey && seen[sessionDedupeKey]) {
        for (var j = 0; j < unique.length; j++) {
          if ((unique[j].sessionId || 'nosess') + '|' + unique[j].score === sessionDedupeKey) {
            // Only merge if it's the same player (same playerId or same name)
            var samePlayer = (playerId && unique[j].playerId && playerId === unique[j].playerId) ||
                              (!playerId && !unique[j].playerId && rawName && unique[j].player === rawName);
            if (samePlayer) {
              duplicateIndex = j;
              break;
            }
          }
        }
      }

      if (duplicateIndex !== -1) {
        var existing = unique[duplicateIndex];
        // Merge session data preferring whichever has it
        if (!existing.session && item.session) existing.session = item.session;
        if (!existing.sessionId && item.sessionId) existing.sessionId = item.sessionId;
        if (!existing.date && item.date) existing.date = item.date;

        // Propagate playerId and name updates
        if (playerId && !existing.playerId) {
          existing.playerId = playerId;
          if (rawName) existing.player = rawName;
        } else if (playerId && existing.playerId && playerId === existing.playerId && rawName && existing.player !== rawName) {
          // Same known player, different name. Prefer remote (i >= localList.length) unless it's the current user.
          if (playerId !== currentUserId && i >= localList.length) {
            existing.player = rawName;
          }
        } else if (!playerId && !existing.playerId && item.sessionId && existing.sessionId === item.sessionId && rawName && existing.player !== rawName) {
          // Same session, no IDs. Prefer remote name.
          if (i >= localList.length) {
            existing.player = rawName;
          }
        }
        continue;
      }

      seen[dedupeKey] = true;
      if (sessionDedupeKey) seen[sessionDedupeKey] = true;
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
          } catch (err) {
            if (DEBUG) console.warn('Failed to repair session:', item.sessionId, err);
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
      if (DEBUG) console.warn('Supabase client not available.');
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
        if (DEBUG) console.warn('Failed to load global high scores:', error.message || error, error);
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
    if (DEBUG) console.warn('Unexpected error loading global high scores:', err);
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
    if (DEBUG) console.warn('Failed to load session from cloud:', err);
    return null;
  }
}

async function saveGlobalHighScores() {
  if (!window.supabaseClient) {
    if (DEBUG) console.log('Supabase client not available for saving.');
    return;
  }
  try {
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

    if (DEBUG) {
      for (var key in strippedHighScores) {
        if (Array.isArray(strippedHighScores[key])) {
          if (DEBUG) console.log('Sending ' + strippedHighScores[key].length + ' scores for key: ' + key);
        }
      }
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
      if (DEBUG) console.warn('Failed to save global high scores:', error.message || error, error);
    } else {
      if (DEBUG) console.log('Global high scores and sessions synced successfully.');
    }
  } catch (err) {
    if (DEBUG) console.warn('Unexpected error saving global high scores:', err);
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
  var sanitized = sanitizePlayerName(newName);
  var validation = validatePlayerName(sanitized);

  if (!validation.valid) {
    // Reject the change and reset input
    var inp = document.getElementById('lobby-name');
    if (inp) inp.value = g_myName;
    if (validation.reason === 'empty') {
      // Silently reset to current name — no toast needed
    } else if (validation.reason === 'reserved') {
      g_bui.toast(`<strong>${sanitized}</strong> ${t('is reserved')}`, 3000);
    } else if (validation.reason === 'taken') {
      g_bui.toast(`<strong>${sanitized}</strong> ${t('is already taken')}`, 3000);
    } else if (validation.reason === 'invalid') {
      g_bui.toast(t('Name contains invalid characters'), 3000);
    }
    return;
  }

  var oldName = g_myName;
  g_myName = sanitized;
  localStorage.setItem('player_name', g_myName);
  if (DEBUG) console.log('updatePlayerName: setting to', g_myName);

  // Sync name changes to all high score entries with my ID or old fallback name
  var changed = false;
  for (var key in g_highscores) {
    if (Array.isArray(g_highscores[key])) {
      g_highscores[key].forEach(function(item) {
        if ((g_lobbyUserId && item.playerId === g_lobbyUserId) || item.player === oldName) {
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
      mpLog('LOBBY', 'log', 'Presence tracked', { id: g_lobbyUserId, name: g_myName });
      // Immediately update the lobby display for feedback
      var state = g_channel.presenceState();
      renderLobbyPlayers(state);
    } catch (err) {
      if (DEBUG) console.error('Failed to update presence:', err);
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
  if (g_activeChannelType === 'lobby') return;
  if (g_channelSubscribing) return;

  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }

  g_activeChannelType = 'lobby';
  g_activeGameId = null;
  g_channelSubscribed = false;
  g_channelSubscribing = true;
  g_lobbySubscribedAt = Date.now();
  g_lobbyJustLoaded = true;
  setTimeout(function() { g_lobbyJustLoaded = false; }, 5000);

  g_channel = window.supabaseClient.channel('lobby', {
    config: {
      presence: {
        key: g_lobbyUserId,
      },
    },
  });

  g_channel
    .on('presence', { event: 'sync' }, () => {
      // Track all keys currently in presence state for true-delta join toasts
      g_lastSyncKeys.clear();
      var state = g_channel.presenceState();
      for (var id in state) {
        if (id !== g_lobbyUserId) g_lastSyncKeys.add(id);
      }
      renderLobbyPlayers();
    })
    .on('presence', { event: 'join' }, (payload) => {
      renderLobbyPlayers();

      // Toast: notify when a genuinely new player comes online.
      // Skip toasts entirely during the first 5 seconds after page load.
      if (g_lobbyJustLoaded) return;
      // Only show if this key was NOT present in the last sync (true delta).
      if (payload && payload.key && payload.key !== g_lobbyUserId && !g_lastSyncKeys.has(payload.key)) {
        var newUser = payload.newPresences && payload.newPresences.length > 0
          ? payload.newPresences[payload.newPresences.length - 1]
          : null;
        if (newUser && newUser.lookingForGame && newUser.name) {
          if (typeof g_isMultiplayer === 'undefined' || !g_isMultiplayer) {
            g_bui.toast(`<strong>${newUser.name}</strong> ${t('has joined the lobby')}`, 3000);
          }
        }
        g_lastSyncKeys.add(payload.key);
      }
    })
    .on('presence', { event: 'update' }, (payload) => {
      renderLobbyPlayers();
    })
    .on('presence', { event: 'leave' }, (payload) => {
      if (payload && payload.key) g_lastSyncKeys.delete(payload.key);
      renderLobbyPlayers();
    })
    .on('broadcast', { event: 'lobby_ping' }, ({ payload }) => {
      if (!payload || !payload.id || payload.id === g_lobbyUserId) return;
      var pingName = payload.name || t('Player');
      g_lobbyHeartbeats[payload.id] = {
        name: pingName,
        lastPing: Date.now()
      };
      updateLobbyBadgeFromMergedState();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        g_channelSubscribed = true;
        g_channelSubscribing = false;
        await g_channel.track({ name: g_myName, lookingForGame: true, id: g_lobbyUserId });
        renderLobbyPlayers();
        refreshPlayersInGames();
        startLobbyHeartbeat();
        subscribeToInvites();
        subscribeToMyInvites();
        if (!g_lobbyFirstSubscribed) {
          g_lobbyFirstSubscribed = true;
          reconcileInvites();
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        g_channelSubscribed = false;
        g_channelSubscribing = false;
        g_lobbyFirstSubscribed = false;
        if (!g_lobbyReconnectTimer) {
          g_lobbyReconnectTimer = setTimeout(function() {
            g_lobbyReconnectTimer = null;
            if (!g_isMultiplayer) {
              forceRejoinLobby();
            }
          }, 2000);
        }
      }
    });
}

function forceRejoinLobby() {
  if (g_lobbyRejoining) return;
  var now = Date.now();
  if (now - g_lastForceRejoinAt < 5000) return; // Throttle rejoins to once per 5s
  g_lastForceRejoinAt = now;
  g_lastReconnectAt = now;
  g_lobbyRejoining = true;
  if (g_lobbyReconnectTimer) {
    clearTimeout(g_lobbyReconnectTimer);
    g_lobbyReconnectTimer = null;
  }
  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }
  g_activeChannelType = null;
  g_activeGameId = null;
  g_channelSubscribed = false;
  g_channelSubscribing = false;
  g_lobbySubscribedAt = 0;
  // Small delay to let the old channel's presence expire before rejoining
  setTimeout(function() {
    g_lobbyRejoining = false;
    joinLobbyChannel();
  }, 300);
}

function ensureLobbyConnection() {
  if (g_isMultiplayer) return;
  if (g_lobbyRejoining || g_channelSubscribing) return;
  if (g_activeChannelType !== 'lobby' || !g_channelSubscribed) {
    forceRejoinLobby();
    return;
  }
  if (g_channel && typeof g_channel.track === 'function') {
    var now = Date.now();
    if (now - g_lastLobbyTrackAt < 3000) return; // Throttle track to once per 3s
    g_lastLobbyTrackAt = now;
    g_channel.track({ name: g_myName, lookingForGame: true, id: g_lobbyUserId }).catch(function() {
      forceRejoinLobby();
    });
  }
}

async function refreshPlayersInGames() {
  if (!window.supabaseClient) return;
  try {
    var { data, error } = await window.supabaseClient
      .from('invites')
      .select('from_id, to_id')
      .in('status', ['started', 'accepted'])
      .eq('app_key', _dk(_hk));
    if (error) throw error;
    g_playersInGames.clear();
    if (data) {
      data.forEach(function(row) {
        if (row.from_id) g_playersInGames.add(row.from_id);
        if (row.to_id) g_playersInGames.add(row.to_id);
      });
    }
    renderLobbyPlayers();
  } catch (err) {
    if (DEBUG) console.warn('Failed to refresh players in games:', err);
  }
}

async function cleanupStalePendingInvites() {
  if (!window.supabaseClient) return;
  var gameIds = Object.keys(g_pendingInvites).concat(Object.keys(g_myInvites));
  if (!gameIds.length) return;
  try {
    var { data, error } = await window.supabaseClient
      .from('invites')
      .select('game_id, status')
      .in('game_id', gameIds)
      .eq('app_key', _dk(_hk));
    if (error) throw error;
    var foundPending = new Set();
    if (data) data.forEach(function(row) {
      if (row.status === 'pending') foundPending.add(row.game_id);
    });
    var changed = false;
    for (var gid in g_pendingInvites) {
      if (!foundPending.has(gid)) {
        delete g_pendingInvites[gid];
        changed = true;
      }
    }
    for (var gid in g_myInvites) {
      if (!foundPending.has(gid)) {
        delete g_myInvites[gid];
        changed = true;
      }
    }
    if (changed) renderLobbyPlayers();
  } catch (err) {
    if (DEBUG) console.warn('Failed to cleanup stale pending invites:', err);
  }
}

function startLobbyRefresh() {
  if (g_lobbyRefreshTimer) return; // already running
  refreshPlayersInGames();
  cleanupStalePendingInvites();
  g_lobbyRefreshTimer = setInterval(function() {
    refreshPlayersInGames();
    cleanupStalePendingInvites();
  }, 15000);
}

function stopLobbyRefresh() {
  if (g_lobbyRefreshTimer) {
    clearInterval(g_lobbyRefreshTimer);
    g_lobbyRefreshTimer = null;
  }
}

function getMergedLobbyState() {
  var merged = {};
  if (g_channel && g_activeChannelType === 'lobby') {
    var pstate = g_channel.presenceState();
    for (var id in pstate) {
      if (id === g_lobbyUserId || g_playersInGames.has(id)) continue;
      var metas = pstate[id];
      var user = metas.length > 0 ? metas[metas.length - 1] : null;
      if (user && user.lookingForGame) {
        merged[id] = { name: String(user.name || t('Player')) };
      }
    }
  }
  var now = Date.now();
  for (var id in g_lobbyHeartbeats) {
    if (id === g_lobbyUserId || g_playersInGames.has(id)) continue;
    var hb = g_lobbyHeartbeats[id];
    if (now - hb.lastPing > LOBBY_HEARTBEAT_STALE_MS) continue;
    merged[id] = { name: hb.name };
  }
  return merged;
}

function updateLobbyBadge(count) {
  if (typeof count !== 'number') {
    var state = getMergedLobbyState();
    count = 0;
    for (var id in state) {
      if (id !== g_lobbyUserId) count++;
    }
  }
  var btn = document.getElementById('lobby');
  if (!btn) return;
  btn.setAttribute('data-count', String(count));
}

function updateLobbyBadgeFromMergedState() {
  updateLobbyBadge();
}

function showConnectingToast(name) {
  g_connectingToast = g_bui.toast(t('Connecting with') + ' ' + (name || t('Player')) + '...', 0);
}

function dismissConnectingToast() {
  if (g_bui) g_bui.closeToast();
  g_connectingToast = null;
}

function renderLobbyPlayers(state) {
  if (g_lobbyRenderTimer) clearTimeout(g_lobbyRenderTimer);
  g_lobbyRenderTimer = setTimeout(function() {
    g_lobbyRenderTimer = null;
    _doRenderLobbyPlayers(getMergedLobbyState());
  }, 300);
}

function _doRenderLobbyPlayers(state) {
  var html = '';
  var count = 0;
  for (var id in state) {
    if (id === g_lobbyUserId) continue;
    var raw = state[id];
    if (!raw) continue;

    var user = null;
    if (Array.isArray(raw)) {
      // presenceState format: [{name, lookingForGame, ...}]
      user = raw.length > 0 ? raw[raw.length - 1] : null;
      if (user && user.lookingForGame === false) user = null;
    } else if (typeof raw === 'object') {
      // merged state format: {name: '...'}
      user = raw;
    }
    if (!user) continue;

    var displayName = String(user.name || t('Player'));
    var safeName = displayName.replace(/'/g, "\\'");

    // Check for incoming/outgoing invites for this player
    var incomingGameId = null;
    for (var gid in g_pendingInvites) {
      if (g_pendingInvites[gid].from_id === id) {
        incomingGameId = gid;
        break;
      }
    }
    var outgoingGameId = null;
    for (var gid in g_myInvites) {
      if (g_myInvites[gid].to_id === id) {
        outgoingGameId = gid;
        break;
      }
    }

    var actionButton = '';
    if (incomingGameId && g_connectingInvites.has(incomingGameId)) {
      actionButton = `<span class="lobby-pending">${t('Connecting...')}</span>`;
    } else if (incomingGameId) {
      actionButton = `<button class="button small primary" onclick="event.stopPropagation();acceptInvite('${incomingGameId}')">${t('Accept')}</button>`;
    } else if (outgoingGameId && g_connectingInvites.has(outgoingGameId)) {
      actionButton = `<span class="lobby-pending">${t('Connecting...')}</span>`;
    } else if (outgoingGameId) {
      actionButton = `<span class="lobby-pending">${t('Invited...')}</span>`;
    } else {
      actionButton = `<button class="button small" onclick="event.stopPropagation();sendInvite('${id}','${safeName}')">${t('Invite')}</button>`;
    }

    html += `
<div class="lobby-player">
  <strong>${displayName}</strong>
  ${actionButton}
</div>
`;
    count++;
  }

  var container = document.getElementById('lobby-players');
  if (container) {
    if (count === 0) html = '<em>' + t('No players online.') + '</em>';
    container.innerHTML = html;
  }

  updateLobbyBadge(count);
}

// -------------------------------------------------------------------------
// INVITE SYSTEM
// -------------------------------------------------------------------------

function subscribeToInvites() {
  if (!window.supabaseClient) return;
  if (g_inviteSub) {
    g_inviteSub.unsubscribe();
    g_inviteSub = null;
  }

  g_inviteSub = window.supabaseClient
    .channel('invites_to_me')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'invites',
      filter: 'to_id=eq.' + g_lobbyUserId
    }, (payload) => {
      if (!payload.new || payload.new.status !== 'pending') return;
      if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer) return;

      var isNew = !g_pendingInvites[payload.new.game_id];

      g_pendingInvites[payload.new.game_id] = {
        from_id: payload.new.from_id,
        from_name: payload.new.from_name,
        created_at: payload.new.created_at
      };

      if (isNew) {
        g_bui.toast(`<strong>${payload.new.from_name}</strong> ${t('has invited you to play! Go to lobby to accept')}`, 4000);
      }
      renderLobbyPlayers();
      updateLobbyBadgeFromMergedState();
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'invites',
      filter: 'to_id=eq.' + g_lobbyUserId
    }, (payload) => {
      if (!payload.new) return;
      if (payload.new.status !== 'pending') {
        delete g_pendingInvites[payload.new.game_id];
        renderLobbyPlayers();
      }
    })
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'invites',
      filter: 'to_id=eq.' + g_lobbyUserId
    }, (payload) => {
      var gameId = payload.old ? payload.old.game_id : null;
      if (gameId && g_pendingInvites[gameId]) {
        delete g_pendingInvites[gameId];
        renderLobbyPlayers();
      }
    })
    .subscribe();
}

function subscribeToMyInvites() {
  if (!window.supabaseClient) return;
  if (g_myInviteSub) {
    g_myInviteSub.unsubscribe();
    g_myInviteSub = null;
  }

  g_myInviteSub = window.supabaseClient
    .channel('my_invites')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'invites',
      filter: 'from_id=eq.' + g_lobbyUserId
    }, (payload) => {
      if (!payload.new || (payload.new.status !== 'accepted' && payload.new.status !== 'started')) return;
      if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer) return;

      showConnectingToast(payload.new.to_name);
      g_connectingInvites.add(payload.new.game_id);
      renderLobbyPlayers();
      delete g_myInvites[payload.new.game_id];
      startMultiplayerGame(payload.new.game_id, payload.new.to_id, payload.new.to_name || t('Player'), true);
    })
    .subscribe();
}

async function reconcileInvites() {
  if (!window.supabaseClient || g_isMultiplayer) return;

  try {
    // Purge any stale started/accepted/cancelled invites for this user first
    await cleanupStaleInvites(null);

    // Fetch pending invites sent to me
    var { data: incoming } = await window.supabaseClient
      .from('invites')
      .select('*')
      .eq('to_id', g_lobbyUserId)
      .eq('status', 'pending');

    if (incoming) {
      var now = Date.now();
      var staleThresholdMs = 24 * 60 * 60 * 1000;
      incoming.forEach(function(inv) {
        var ageMs = now - new Date(inv.created_at).getTime();
        if (ageMs > staleThresholdMs) return;
        g_pendingInvites[inv.game_id] = {
          from_id: inv.from_id,
          from_name: inv.from_name,
          created_at: inv.created_at
        };
      });
    }

    // Fetch pending invites sent by me
    var { data: outgoing } = await window.supabaseClient
      .from('invites')
      .select('*')
      .eq('from_id', g_lobbyUserId)
      .eq('status', 'pending');

    if (outgoing) {
      var now2 = Date.now();
      var staleThresholdMs2 = 24 * 60 * 60 * 1000;
      outgoing.forEach(function(inv) {
        var ageMs = now2 - new Date(inv.created_at).getTime();
        if (ageMs > staleThresholdMs2) return;
        g_myInvites[inv.game_id] = {
          to_id: inv.to_id,
          to_name: inv.to_name || t('Player'),
          sent_at: inv.created_at
        };
      });
    }

    // Fetch accepted invites sent by me (e.g. opponent accepted while I was offline)
    var { data: acceptedOutgoing } = await window.supabaseClient
      .from('invites')
      .select('*')
      .eq('from_id', g_lobbyUserId)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (acceptedOutgoing) {
      // Opponent accepted while we were offline/reloading — auto-start as host
      // Guard: only auto-start if accepted within last 5 minutes (stale invites from
      // abandoned games should not trigger auto-start on every lobby rejoin).
      var acceptedAgeMs = Date.now() - new Date(acceptedOutgoing.created_at).getTime();
      if (acceptedAgeMs < 5 * 60 * 1000 && typeof g_isMultiplayer !== 'undefined' && !g_isMultiplayer) {
        startMultiplayerGame(acceptedOutgoing.game_id, acceptedOutgoing.to_id, acceptedOutgoing.to_name || t('Player'), true);
        return; // startMultiplayerGame handles its own cleanup
      }
    }

    renderLobbyPlayers();
  } catch (err) {
    if (DEBUG) console.warn('Failed to reconcile invites:', err);
  }
}

window.sendInvite = async function(opponentId, opponentName) {
  if (!window.supabaseClient) return;

  // Check if we already have a pending invite to this player
  try {
    var { data: existing } = await window.supabaseClient
      .from('invites')
      .select('game_id')
      .eq('from_id', g_lobbyUserId)
      .eq('to_id', opponentId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      // Already invited this player
      return;
    }
  } catch (err) {
    // Continue anyway
  }

  var newGameId = 'game_' + Math.random().toString(36).substr(2, 9);

  try {
    await window.supabaseClient.from('invites').upsert({
      from_id: g_lobbyUserId,
      to_id: opponentId,
      game_id: newGameId,
      from_name: g_myName,
      to_name: opponentName,
      status: 'pending',
      app_key: _dk(_hk)
    });

    g_myInvites[newGameId] = {
      to_id: opponentId,
      to_name: opponentName,
      sent_at: Date.now()
    };

    renderLobbyPlayers();
  } catch (err) {
    if (DEBUG) console.warn('Failed to send invite:', err);
  }
}

window.acceptInvite = async function(gameId) {
  var invite = null;

  try {
    // Verify invite is still pending using DB as source of truth
    var { data: dbInvite, error } = await window.supabaseClient
      .from('invites')
      .select('*')
      .eq('game_id', gameId)
      .eq('to_id', g_lobbyUserId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) throw error;
    if (!dbInvite) {
      delete g_pendingInvites[gameId];
      renderLobbyPlayers();
      return;
    }

    invite = dbInvite;

    var { data: updated, error: updateError } = await window.supabaseClient.from('invites')
      .update({ status: 'accepted' })
      .eq('game_id', gameId)
      .eq('to_id', g_lobbyUserId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      delete g_pendingInvites[gameId];
      renderLobbyPlayers();
      return;
    }
  } catch (err) {
    if (DEBUG) console.warn('Failed to accept invite:', err);
    return;
  }

  g_connectingInvites.add(gameId);
  renderLobbyPlayers();
  delete g_pendingInvites[gameId];
  showConnectingToast(invite.from_name);
  startMultiplayerGame(gameId, invite.from_id, invite.from_name, false);
}

window.cancelMyInvites = async function() {
  if (!window.supabaseClient) return;

  try {
    await window.supabaseClient.from('invites')
      .delete()
      .eq('from_id', g_lobbyUserId)
      .eq('status', 'pending')
      .eq('app_key', _dk(_hk));

    g_myInvites = {};
    renderLobbyPlayers();
  } catch (err) {
    if (DEBUG) console.warn('Failed to cancel invites:', err);
  }
}

window.leaveLobby = async function() {
  g_pendingInvites = {};
  g_myInvites = {};
  g_lobbySubscribedAt = 0;
  g_lobbyFirstSubscribed = false;
  g_lastSyncKeys.clear();
  stopLobbyRefresh();
  stopLobbyHeartbeat();
  if (g_inviteSub) {
    g_inviteSub.unsubscribe();
    g_inviteSub = null;
  }
  if (g_myInviteSub) {
    g_myInviteSub.unsubscribe();
    g_myInviteSub = null;
  }
  stopLobbyHeartbeat();
  if (g_channel) {
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
  g_activeChannelType = null;
  g_activeGameId = null;
  if (g_dragGhost) {
    g_dragGhost.remove();
    g_dragGhost = null;
  }
}

window.closeLobbyModal = function() {
  stopLobbyRefresh();
  hideModal();
};



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
  g_isHost = isHost;
  g_isResuming = false;
  g_myRematchGameId = null;
  clearRematchState();
  g_lastEmojiSentAt = 0;
  localStorage['session_mode'] = 'mp';

  // If we're starting a game (either as host or joining), cancel any pending invites we sent
  if (typeof cancelMyInvites === 'function') {
    await cancelMyInvites();
  }

  // Purge any stale started/accepted/cancelled invites for this user (rematch,
  // crash recovery, or accumulated cancelled rows) before creating a new one.
  await cleanupStaleInvites(gameId);

  await leaveLobby();
  hideModal();
  if (g_isMobile) hideGameInfo();

  // Mark the invite row as started so reconcileInvites() never re-triggers it
  if (window.supabaseClient && gameId) {
    window.supabaseClient.from('invites')
      .update({ status: 'started' })
      .eq('game_id', gameId)
      .then(function() {
        if (DEBUG) console.log('Marked invite as started for game:', gameId);
      })
      .catch(function(err) {
        if (DEBUG) console.warn('Failed to mark invite as started:', err);
      });
  }

  // Connect to game channel
  joinGameChannel(gameId, isHost);

  // Start periodic auto-save
  startMpAutoSaveTimer();
}

async function deleteGameInvite(gameId) {
  if (!window.supabaseClient || !gameId) return;
  try {
    await window.supabaseClient.from('invites')
      .delete()
      .eq('game_id', gameId)
      .eq('app_key', _dk(_hk));
    if (DEBUG) console.log('Deleted invite for game:', gameId);
  } catch (err) {
    if (DEBUG) console.warn('Failed to delete invite:', err);
  }
}

async function cleanupStaleInvites(currentGameId) {
  if (!window.supabaseClient) return;
  var now = Date.now();
  if (now - g_lastCleanupAt < 30000) return; // Throttle to once per 30s
  g_lastCleanupAt = now;
  try {
    var query = window.supabaseClient.from('invites')
      .delete()
      .eq('app_key', _dk(_hk))
      .in('status', ['started', 'accepted', 'cancelled'])
      .or('from_id.eq.' + g_lobbyUserId + ',to_id.eq.' + g_lobbyUserId);
    if (currentGameId) {
      query = query.neq('game_id', currentGameId);
    }
    var { error } = await query;
    if (error) throw error;
  } catch (err) {
    if (DEBUG) console.warn('Failed to clean up stale invites:', err);
  }
}

function scheduleInitRetry() {
  if (g_initRetryTimer) clearTimeout(g_initRetryTimer);
  if (g_initRetryCount >= MAX_INIT_RETRIES) {
    g_initRetryTimer = null;
    g_bui.toast(t('Connection failed'), 4000);
    sendBroadcastNow('connection_failed', { gameId: g_gameId, fromId: g_lobbyUserId });
    deleteGameInvite(g_gameId);
    cleanupMultiplayerSession();
    return;
  }
  g_initRetryTimer = setTimeout(function() {
    if (g_cachedInitPayload) return; // success
    sendBroadcastNow('request_init', { gameId: g_gameId, fromId: g_lobbyUserId });
    g_initRetryCount++;
    if (g_initRetryCount >= MAX_INIT_RETRIES) {
      g_bui.toast(t('Connection failed'), 4000);
      sendBroadcastNow('connection_failed', { gameId: g_gameId, fromId: g_lobbyUserId });
      deleteGameInvite(g_gameId);
      cleanupMultiplayerSession();
    } else {
      scheduleInitRetry();
    }
  }, INIT_RETRY_DELAY_MS);
}

function joinGameChannel(gameId, isHost, onSubscribed, skipInitRetry) {
  if (g_activeChannelType === 'game' && g_activeGameId === gameId && (g_channelSubscribed || g_channelSubscribing)) {
    return;
  }

  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }

  g_activeChannelType = 'game';
  g_activeGameId = gameId;
  g_channelSubscribed = false;
  g_channelSubscribing = true;

  // Clear old init state for this new game channel
  g_cachedInitPayload = null;
  g_seenInitIds.clear();

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
      var wasDisconnected = !g_opponentPresenceState && g_opponentDisconnectSeconds > 0;
      g_opponentPresenceState = opponentFound;
      if (opponentFound) {
        g_opponentDisconnectSeconds = 0;
        g_opponentId = opponentId || g_opponentId;
        if (opponentName) g_opponentName = opponentName;
        if (wasDisconnected) {
          g_lastRemotePositionSeq = -1; // reset drag tracking after reconnect
        }
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
      showConnectingToast(payload.fromName || t('Opponent'));
      g_myRematchGameId = payload.gameId;

      // Create invite row so both players can resume on reload via checkActiveInvite()
      if (window.supabaseClient) {
        window.supabaseClient.from('invites').upsert({
          from_id: payload.fromId,
          to_id: g_lobbyUserId,
          game_id: payload.gameId,
          from_name: payload.fromName || t('Opponent'),
          to_name: g_myName,
          status: 'started',
          app_key: _dk(_hk)
        }, { onConflict: 'from_id,to_id,game_id' }).then(null, function(e) {
          if (DEBUG) console.warn('Failed to create rematch invite row:', e);
        });
      }

      startMultiplayerGame(payload.gameId, g_opponentId, g_opponentName, false);
    })
    .on('broadcast', { event: 'rematch_request' }, ({ payload }) => {
      if (!payload || payload.fromId === g_lobbyUserId) return;
      if (!g_isGameOver) return;

      if (g_rematchState === 'waiting') {
        tryStartRematch();
      } else if (g_rematchState === 'idle') {
        g_rematchState = 'received';
        updateRematchButton('received');
      }
    })
    .on('broadcast', { event: 'rematch_cancel' }, ({ payload }) => {
      if (!payload || payload.fromId === g_lobbyUserId) return;
      if (!g_isGameOver) return;

      if (g_rematchState === 'waiting') {
        clearRematchState();
        updateRematchButton('idle');
        g_bui.toast(t('Opponent has left'), 4000);
      } else if (g_rematchState === 'received') {
        clearRematchState();
        updateRematchButton('idle');
      }
    })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => {
      handleReactionBroadcast(payload);
    })
    .on('broadcast', { event: 'hello' }, ({ payload }) => {
      if (payload && payload.gameId === g_gameId && payload.fromId !== g_lobbyUserId) {
        // If the peer is resuming, do NOT send init or re-initialize.
        if (payload.resuming) return;
        // Host initializes on guest hello, but only if game hasn't started yet
        if (isHost && g_stateVersion <= 1) initializeHostGame();
      }
    })
    .on('broadcast', { event: 'request_init' }, ({ payload }) => {
      // Host re-sends cached init, or initializes on-demand if not yet done
      if (isHost && payload && payload.gameId === g_gameId && payload.fromId !== g_lobbyUserId) {
        // If the peer is resuming, do NOT send init.
        if (payload.resuming) return;
        if (!g_cachedInitPayload && g_stateVersion <= 1) {
          initializeHostGame();
        } else if (g_cachedInitPayload) {
          broadcastGameState(g_cachedInitPayload);
        }
      }
    })
    .on('broadcast', { event: 'init_ack' }, ({ payload }) => {
      // Host receives ACK (for logging/debugging)
      if (isHost && payload && payload.gameId === g_gameId) {
        if (DEBUG) console.log('Guest ACKed init:', payload.initId);
      }
    })
    .on('broadcast', { event: 'connection_failed' }, ({ payload }) => {
      if (payload && payload.gameId === g_gameId && payload.fromId !== g_lobbyUserId) {
        g_bui.toast(t('Connection failed'), 4000);
        g_connectingInvites.delete(g_gameId);
        deleteGameInvite(g_gameId);
        cleanupMultiplayerSession();
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        g_channelSubscribed = true;
        g_channelSubscribing = false;
        if (g_reconnectTimer) {
          clearTimeout(g_reconnectTimer);
          g_reconnectTimer = null;
        }
        if (g_resumeConnectionTimer) {
          clearTimeout(g_resumeConnectionTimer);
          g_resumeConnectionTimer = null;
        }
        if (g_resumeFailTimer) {
          clearTimeout(g_resumeFailTimer);
          g_resumeFailTimer = null;
        }
        await g_channel.track({ name: g_myName, id: g_lobbyUserId, isHost });
        startIdleTimer();

        // Both host and guest announce presence
        sendBroadcastNow('hello', { gameId: g_gameId, fromId: g_lobbyUserId, role: isHost ? 'host' : 'guest', resuming: g_isResuming });

        if (typeof onSubscribed === 'function') {
          onSubscribed();
        }

        if (!isHost && !g_isResuming && g_stateVersion <= 1 && !skipInitRetry) {
          // Guest: start retry timer for init (only on first join, not resume/reconnect)
          g_initRetryCount = 0;
          scheduleInitRetry();
        }
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') && g_isMultiplayer && !g_isGameOver) {
        g_channelSubscribed = false;
        g_channelSubscribing = false;
        if (!g_reconnectTimer) {
          g_reconnectTimer = setTimeout(function() {
            g_reconnectTimer = null;
            if (g_isMultiplayer && g_gameId && !g_isGameOver) {
              joinGameChannel(g_gameId, g_isHost, null, true);
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
    lobbyBtn.parentElement.title = t('Multiplayer Lobby');
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
  stopMpAutoSaveTimer();
  // Prevent reload from re-entering MP mode with no session data
  localStorage['session_mode'] = 'sp';
}

function leavePostGameState() {
  if (g_postGameTimer) {
    clearTimeout(g_postGameTimer);
    g_postGameTimer = null;
  }
}

function resetInitHandshakeState() {
  g_stateVersion = 0;
  g_dbVersion = 0;
  g_lastDBWriteAt = 0;
  g_lastMoveAt = 0;
  g_lastRemotePositionSeq = -1;
  g_dragSeq = 0;
  g_myRematchGameId = null;
  g_lastEmojiSentAt = 0;
  g_mpGameEndReason = '';
  g_cachedInitPayload = null;
  g_seenInitIds.clear();
  if (g_initRetryTimer) {
    clearTimeout(g_initRetryTimer);
    g_initRetryTimer = null;
  }
  g_initRetryCount = 0;
}

function clearRematchState() {
  g_rematchState = 'idle';
  if (g_rematchTimer) {
    clearTimeout(g_rematchTimer);
    g_rematchTimer = null;
  }
  if (g_rematchFallbackTimer) {
    clearTimeout(g_rematchFallbackTimer);
    g_rematchFallbackTimer = null;
  }
}

function cleanupMultiplayerSession() {
  clearRematchState();
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
  stopMpAutoSaveTimer();
  if (g_resumeConnectionTimer) {
    clearTimeout(g_resumeConnectionTimer);
    g_resumeConnectionTimer = null;
  }
  if (g_resumeFailTimer) {
    clearTimeout(g_resumeFailTimer);
    g_resumeFailTimer = null;
  }
  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }
  unsubscribeFromGameStateChanges();

  localStorage.removeItem('session_mp');
  localStorage['session_mode'] = 'sp';

  // Purge the invite row and game state for this game so it can never cause stale-state issues
  var endedGameId = g_gameId;
  if (endedGameId) {
    deleteGameInvite(endedGameId);
    deleteGameStateFromDB(endedGameId);
  }

  g_isMultiplayer = false;
  g_isHost = false;
  g_isMyTurn = true;
  g_isResuming = false;
  g_gameId = null;
  g_opponentName = null;
  g_opponentPresenceState = false;
  g_opponentDisconnectSeconds = 0;
  resetInitHandshakeState();
  g_connectingInvites.clear();

  g_activeChannelType = null;
  g_activeGameId = null;

  g_remoteDragging = false;
  g_remoteDragToken = null;
  if (g_remoteDragTimeout) {
    clearTimeout(g_remoteDragTimeout);
    g_remoteDragTimeout = null;
  }
  if (g_remoteDragCooldown) {
    clearTimeout(g_remoteDragCooldown);
    g_remoteDragCooldown = null;
  }

  if (g_bui && g_bui.hideEmojiPicker) g_bui.hideEmojiPicker();
  applyNonGameButtonPolicy();
  updateGameInfoLabels();

  // Rejoin lobby so the player is discoverable for new games
  if (typeof joinLobbyChannel === 'function' && window.supabaseClient) {
    joinLobbyChannel();
  }
}

function updateRematchButton(state) {
  var btn = document.getElementById('btn-rematch');
  if (!btn) return;
  if (state === 'waiting') {
    btn.disabled = true;
    btn.classList.remove('pulse');
    btn.textContent = t('Waiting for opponent...');
  } else if (state === 'received') {
    btn.disabled = false;
    btn.classList.add('pulse');
    btn.textContent = t('Opponent wants a rematch!');
  } else {
    btn.disabled = false;
    btn.classList.remove('pulse');
    btn.textContent = t('Rematch');
  }
}

function tryStartRematch() {
  if (g_rematchState === 'executing') return;
  if (!g_opponentPresenceState) {
    clearRematchState();
    updateRematchButton('idle');
    g_bui.toast(t('Opponent has left'), 4000);
    return;
  }
  g_rematchState = 'executing';
  if (g_rematchTimer) {
    clearTimeout(g_rematchTimer);
    g_rematchTimer = null;
  }

  hideModal();
  dismissConnectingToast();
  g_connectingToast = g_bui.toast(t('Starting rematch...'), 0);

  leavePostGameState();

  var oldGameId = g_gameId;
  if (oldGameId) {
    deleteGameStateFromDB(oldGameId);
  }

  resetInitHandshakeState();

  // Notify opponent we're starting (idempotent — wakes them up if they're waiting)
  sendBroadcastNow('rematch_request', { gameId: g_gameId, fromId: g_lobbyUserId });

  var isHost = g_lobbyUserId < g_opponentId;

  if (isHost) {
    var newGameId = 'game_' + Math.random().toString(36).substr(2, 9);
    g_myRematchGameId = newGameId;

    if (window.supabaseClient) {
      window.supabaseClient.from('invites').upsert({
        from_id: g_lobbyUserId,
        to_id: g_opponentId,
        game_id: newGameId,
        from_name: g_myName,
        to_name: g_opponentName,
        status: 'started',
        app_key: _dk(_hk)
      }, { onConflict: 'from_id,to_id,game_id' }).then(null, function(e) {
        if (DEBUG) console.warn('Failed to create rematch invite row:', e);
      });
    }

    sendBroadcastNow('rematch', {
      gameId: newGameId,
      fromId: g_lobbyUserId,
      fromName: g_myName
    });
    startMultiplayerGame(newGameId, g_opponentId, g_opponentName, true);
  } else {
    if (g_myRematchGameId) {
      startMultiplayerGame(g_myRematchGameId, g_opponentId, g_opponentName, false);
    } else {
      // Non-host without a gameId yet — wait for host's rematch broadcast.
      // Set a safety fallback to dismiss the toast if host never responds.
      if (g_rematchFallbackTimer) clearTimeout(g_rematchFallbackTimer);
      g_rematchFallbackTimer = setTimeout(function() {
        if (g_rematchState === 'executing') {
          clearRematchState();
          updateRematchButton('idle');
          g_bui.closeToast();
          g_bui.toast(t('No response from opponent'), 4000);
        }
      }, 15000);
    }
  }
}

window.onGameOverPlayComputer = function() {
  hideModal();
  if (g_rematchState === 'waiting') {
    sendBroadcastNow('rematch_cancel', { gameId: g_gameId, fromId: g_lobbyUserId });
  }
  clearRematchState();
  g_bui.restart();
};

window.initiateRematch = function() {
  if (!g_isGameOver) return;

  if (!g_isMultiplayer) {
    g_bui.restart();
    return;
  }

  if (g_rematchState === 'received') {
    tryStartRematch();
    return;
  }

  if (g_rematchState === 'waiting') return;

  if (!g_opponentPresenceState) {
    g_bui.toast(t('Opponent has left'), 4000);
    return;
  }

  g_rematchState = 'waiting';
  updateRematchButton('waiting');
  sendBroadcastNow('rematch_request', { gameId: g_gameId, fromId: g_lobbyUserId });

  if (g_rematchTimer) clearTimeout(g_rematchTimer);
  g_rematchTimer = setTimeout(function() {
    if (g_rematchState === 'waiting') {
      sendBroadcastNow('rematch_cancel', { gameId: g_gameId, fromId: g_lobbyUserId });
      clearRematchState();
      updateRematchButton('idle');
      g_bui.toast(t('No response from opponent'), 4000);
    }
  }, 60000);
};

window.confirmRestartMultiplayer = function() {
  g_bui.prompt(
    t('Restarting will forfeit this game.'),
    '<button class="button secondary" onclick="hideModal()">' + t('Cancel') + '</button>' + SPACER +
    '<button class="button" onclick="hideModal();finalizeMultiplayerGame(\'forfeit\', true);g_bui.restart()">' + t('Forfeit &amp; Restart') + '</button>'
  );
};

function finalizeMultiplayerGame(reason, skipLocalAnnounce) {
  if (!g_isMultiplayer || g_isGameOver) return;
  g_isGameOver = true;
  g_mpGameEndReason = reason || '';

  // When skipLocalAnnounce is true (mover side), the receiver will detect
  // the game end and broadcast game_ended with authoritative scores.
  if (!skipLocalAnnounce) {
    broadcastGameState({
      type: 'game_ended',
      reason: reason || 'ended',
      stateVersion: g_stateVersion
    });
  }

  // Purge invite row and game state immediately on game end so it can never cause stale-state issues
  if (g_gameId) {
    deleteGameInvite(g_gameId);
    deleteGameStateFromDB(g_gameId);
  }

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

  // Fallback: if receiver's game_ended broadcast is lost, compute locally after 5s
  if (skipLocalAnnounce) {
    setTimeout(function() {
      if (g_isGameOver && !g_finalScoresApplied) {
        finalizeGameScores();
        announceWinner();
      }
    }, 5000);
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

function resetMultiplayerGameState() {
  g_pscore = 0;
  g_oscore = 0;
  g_playerLastScore = 0;
  g_opponentLastScore = 0;
  g_passes = 0;
  g_stateVersion = 0;
  g_board_empty = true;
  g_isGameOver = false;
}

function initializeHostGame() {
  // Guard: never re-initialize during a resume/reconnect.
  if (g_isResuming) return;

  // Guard: only initialize once per game. Subsequent ready broadcasts
  // from guest will re-send the cached init payload.
  if (g_cachedInitPayload) {
    broadcastGameState(g_cachedInitPayload);
    return;
  }

  // Coin flip for turn
  const hostGoesFirst = Math.random() < 0.5;
  g_isMyTurn = hostGoesFirst;

  // Set up board empty, etc. (done by init('board'))
  // But we need to sync g_letpool and the initial racks

  // Reset board state for a fresh MP game WITHOUT calling cleanupMultiplayerSession().
  // g_bui.restart() would tear down the active game channel because it sees g_isMultiplayer === true.
  localStorage.removeItem('session');
  g_bui = new RedipsUI();
  init('board');
  g_isMultiplayer = true;
  resetMultiplayerGameState();

  // Build state synchronously (no setTimeout)
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

  // Build and cache init payload for idempotent re-send
  g_cachedInitPayload = {
    type: 'init',
    gameId: g_gameId,
    initId: 'init_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    letpool: g_letpool,
    myRack: oppRack, // What is opponent rack to us is their rack
    oppRack: myRack,
    hostGoesFirst: hostGoesFirst,
    stateVersion: g_stateVersion
  };

  broadcastGameState(g_cachedInitPayload);
  g_lastMoveAt = Date.now();
  saveMultiplayerSession();

  // Write initial state to DB and subscribe to changes
  createGameStateInDB().then(function() {
    subscribeToGameStateChanges();
  });

  updateTurnIndicator();
  updateGameInfoLabels();
  dismissConnectingToast();
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


function sendDragPosition(x, y, sourceId, sourceCenter, targetId) {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;
  if (g_dragThrottleTimer) return;

  g_dragThrottleTimer = setTimeout(function() {
    g_dragThrottleTimer = null;
  }, 50);

  var cx = 0.5, cy = 0.5;

  // Compute cx/cy relative to the target element if available
  if (targetId) {
    var targetEl = el(targetId);
    if (targetEl) {
      var tRect = targetEl.getBoundingClientRect();
      cx = (x - tRect.left) / tRect.width;
      cy = (y - tRect.top) / tRect.height;
    } else {
      // Target not found locally; fall back to board-based sub-cell position
      var board = el('board');
      if (board) {
        var bRect = board.getBoundingClientRect();
        var cellW = bRect.width / g_boardwidth;
        var cellH = bRect.height / g_boardheight;
        cx = ((x - bRect.left) % cellW) / cellW;
        cy = ((y - bRect.top) % cellH) / cellH;
      }
    }
  }

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: {
      seq: ++g_dragSeq,
      targetId: targetId,
      cx: cx,
      cy: cy,
      sourceId: sourceId || undefined
    }
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

function resolveLocalTarget(targetId) {
  if (typeof targetId !== 'string' || !targetId) return null;
  var mappedId = mapRemoteRackCellId(targetId);
  return el(mappedId) || null;
}

function localizeDragPosition(payload) {
  if (!payload) return null;

  // Primary path: targetId-based resolution (resolution-independent)
  if (typeof payload.targetId === 'string' && payload.targetId) {
    var targetEl = resolveLocalTarget(payload.targetId);
    if (targetEl) {
      var rect = targetEl.getBoundingClientRect();
      var cx = (typeof payload.cx === 'number') ? payload.cx : 0.5;
      var cy = (typeof payload.cy === 'number') ? payload.cy : 0.5;
      return {
        x: rect.left + cx * rect.width,
        y: rect.top + cy * rect.height
      };
    }
  }

  // Fallback: legacy col/row reconstruction
  var board = el('board');
  if (board) g_cachedBoardRect = board.getBoundingClientRect();

  var cellW, cellH;
  if (g_cachedBoardRect) {
    cellW = g_cachedBoardRect.width / g_boardwidth;
    cellH = g_cachedBoardRect.height / g_boardheight;
  }

  var x, y;
  if (typeof payload.col === 'number' && typeof payload.row === 'number' &&
      payload.col >= 0 && payload.row >= 0 && g_cachedBoardRect) {
    x = g_cachedBoardRect.left + payload.col * cellW + (payload.cx || 0.5) * cellW;
    y = g_cachedBoardRect.top  + payload.row * cellH + (payload.cy || 0.5) * cellH;
  } else {
    x = payload.x;
    y = payload.y;
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
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) {
    if (DEBUG) console.log('[DRAG] sendDragPreview skipped: mp=' + g_isMultiplayer + ' ch=' + !!g_channel + ' turn=' + g_isMyTurn);
    return;
  }

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

function cleanupOpponentPreviews() {
  for (var x = 0; x < g_boardwidth; ++x) {
    for (var y = 0; y < g_boardheight; ++y) {
      var cell = el('c' + x + '_' + y);
      if (cell && cell.innerHTML !== '' && !cell.holds) {
        cell.innerHTML = '';
      }
    }
  }
}

function clearOpponentPreviewCache() {
  if (g_bui) g_bui.oppNewplays = {};
}

function renderOpponentRackTileBack(cell) {
  if (!cell) return;
  cell.innerHTML = '<div class="drag t2">' + SPACER + '</div>';
}

function renderOpponentBoardTile(cell, letter, points) {
  renderTile(cell, letter, points, 't2');
}

function renderTile(cell, letter, points, tileClass) {
  if (!cell) return;
  var displayLetter = (letter === '*' || letter === ' ') ? SPACER : String(letter || '').toUpperCase();
  var p = parseInt(points) || 0;
  var pointsHtml = (p > 0) ? '<sup><small>' + p + '</small></sup>' : '<sup><small>&nbsp;</small></sup>';
  cell.innerHTML = '<div class="drag ' + (tileClass || 't1') + '">' + displayLetter + pointsHtml + '</div>';
  var holdsObj = { 'letter': letter || '', 'points': p };
  cell.holds = holdsObj;
  if (cell.firstChild) cell.firstChild.holds = holdsObj;
}

function clearTile(cell) {
  if (!cell) return;
  cell.innerHTML = '';
  cell.holds = '';
}

function renderCommittedBoard() {
  if (!Array.isArray(g_board) || !Array.isArray(g_boardtypes)) return;
  for (var x = 0; x < g_boardwidth; ++x) {
    var boardColumn = g_board[x];
    var boardTypeColumn = g_boardtypes[x];
    if (!Array.isArray(boardColumn) || !Array.isArray(boardTypeColumn)) continue;
    for (var y = 0; y < g_boardheight; ++y) {
      var cellId = 'c' + x + '_' + y;
      var cell = el(cellId);
      if (!cell) continue;
      
      // Safety: check if this cell has a preview tile
      var hasLocalPreview = g_bui && g_bui.newplays && g_bui.newplays[cellId];
      var hasOpponentPreview = g_bui && g_bui.oppNewplays && g_bui.oppNewplays[cellId];
      
      var char = boardColumn[y];
      if (char && char !== '' && typeof char !== 'undefined') {
        var tClass = boardTypeColumn[y] === 1 ? 't1' : 't2';
        var points = (g_boardpoints[x] && g_boardpoints[x][y]) || 0;
        renderTile(cell, char, points, tClass);
      } else if (!hasLocalPreview && !hasOpponentPreview) {
        // Only clear if no committed tile AND no preview tile exists
        clearTile(cell);
      } else if (DEBUG) {
        // mpLog('JOKER', 'log', 'renderCommittedBoard preserving preview', { cell: cellId });
      }
    }
  }
}

function applyDragPreview(payload) {
  if (!payload || !payload.toId) {
    if (DEBUG) console.log('[DRAG] applyDragPreview skipped: missing payload or toId');
    return;
  }

  var toId = mapRemoteRackCellId(payload.toId);
  var toCell = el(toId);

  if (!toCell) {
    if (DEBUG) console.log('[DRAG] applyDragPreview skipped: cell not found for', toId);
    return;
  }

  if (DEBUG) console.log('[DRAG] applyDragPreview rendering at', toId, 'letter:', payload.letter);

  // Clear source cell if provided (extra safety)
  if (payload.fromId) {
    var fromId = mapRemoteRackCellId(payload.fromId);
    if (fromId !== toId) {
      var fromCell = el(fromId);
      if (fromCell) {
        fromCell.innerHTML = '';
        fromCell.holds = '';
      }
    }
  }

  if (toId && toId.charAt(0) === 'c') {
    // Board cell: render the real letter so the opponent sees what was placed
    var p = (typeof payload.points === 'number') ? payload.points : (g_letscore[payload.letter] || 0);
    renderOpponentBoardTile(toCell, payload.letter || '', p);
    // previews are purely visual — do NOT mutate committed g_board state
    if (g_bui) {
      g_bui.oppNewplays = g_bui.oppNewplays || {};
      g_bui.oppNewplays[toId] = { 'letter': payload.letter || '', 'points': p };
    }
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
  // previews are purely visual — do NOT mutate committed g_board state
  if (g_bui && g_bui.oppNewplays) {
    delete g_bui.oppNewplays[sourceId];
  }
}

function onRemoteDragStart(payload) {
  g_remoteDragging = true;
  g_remoteDragToken = payload.seq;
  if (g_remoteDragTimeout) clearTimeout(g_remoteDragTimeout);
  g_remoteDragTimeout = setTimeout(function() {
    g_remoteDragging = false;
    g_remoteDragToken = null;
    g_remoteDragTimeout = null;
    g_remoteDragTimeoutUnlocks++;
    mpLog('DRAG', 'log', 'Guard: dragging → idle (timeout expired)');
  }, REMOTE_DRAG_TIMEOUT_MS);
  mpLog('DRAG', 'log', 'Guard: idle → dragging', { token: payload.seq });
}

function onRemoteDragEnd(payload) {
  if (g_remoteDragToken !== null && payload.seq !== g_remoteDragToken) {
    mpLog('DRAG', 'log', 'Guard: drag end token mismatch, ignoring');
    return;
  }
  g_remoteDragging = false;
  g_remoteDragToken = null;
  if (g_remoteDragTimeout) {
    clearTimeout(g_remoteDragTimeout);
    g_remoteDragTimeout = null;
  }
  g_remoteDragCooldown = setTimeout(function() {
    g_remoteDragCooldown = null;
    g_remoteDragCooldownFlushes++;
    mpLog('DRAG', 'log', 'Guard: cooldown → idle, flushing deferred sync');
    flushDeferredDbSync();
  }, REMOTE_DRAG_COOLDOWN_MS);
  mpLog('DRAG', 'log', 'Guard: dragging → cooldown');
}

function flushDeferredDbSync() {
  mpLog('SYNC', 'log', 'Flushing deferred DB sync');
  syncGameStateFromDB().then(function() {
    renderTransientOverlays();
  });
}

function renderTransientOverlays() {
  if (!g_bui) return;
  
  // 1. Render local player previews (newplays)
  if (g_bui.newplays) {
    for (var cellId in g_bui.newplays) {
      var cell = el(cellId);
      if (!cell) continue;
      var ph = g_bui.newplays[cellId];
      var pts = (typeof ph.points === 'number') ? ph.points : (g_letscore[ph.letter] || 0);
      renderTile(cell, ph.letter || '', pts, 't1');
      
      // Re-open letter picker if restored preview is an unresolved joker
      if (ph.letter === '*' && typeof g_bui.showLettersModal === 'function') {
        g_bui.showLettersModal(cellId);
      }
    }
  }

  // 2. Render opponent previews (oppNewplays)
  if (g_bui.oppNewplays) {
    for (var cellId in g_bui.oppNewplays) {
      var cell = el(cellId);
      if (!cell) continue;
      var ph = g_bui.oppNewplays[cellId];
      var pts = (typeof ph.points === 'number') ? ph.points : (g_letscore[ph.letter] || 0);
      renderOpponentBoardTile(cell, ph.letter || '', pts);
    }
  }

  g_overlayReapplies++;
  mpLog('OVERLAY', 'log', 'Re-applied transient overlays', { 
    local: g_bui.newplays ? Object.keys(g_bui.newplays).length : 0,
    opponent: g_bui.oppNewplays ? Object.keys(g_bui.oppNewplays).length : 0 
  });
}

function logDebugStats() {
  if (!DEBUG) return;
  mpLog('STATS', 'log', 'Debug counters', {
    deferredDbSyncs: g_deferredDbSyncs,
    dragTimeoutUnlocks: g_remoteDragTimeoutUnlocks,
    cooldownFlushes: g_remoteDragCooldownFlushes,
    overlayReapplies: g_overlayReapplies
  });
}

function handleDragBroadcast(payload) {
  if (!g_isMultiplayer || !payload) {
    if (DEBUG) console.log('[DRAG] handleDragBroadcast skipped: mp=' + g_isMultiplayer);
    return;
  }

  if (payload.action === 'preview' || payload.action === 'clear') {
    onRemoteDragStart(payload);
  } else if (payload.end) {
    onRemoteDragEnd(payload);
  }

  // Commands (preview, clear, end) execute unconditionally — they are idempotent one-shots
  if (payload.action === 'preview') {
    if (DEBUG) console.log('[DRAG] Received preview broadcast:', payload.fromId, '->', payload.toId, 'letter:', payload.letter);
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

  // Position broadcasts only: seq-gate to prevent stale out-of-order positions,
  // with reload detection (sender reset causes seq to drop significantly)
  if (typeof payload.seq === 'number') {
    if (g_lastRemotePositionSeq > 0 && payload.seq < g_lastRemotePositionSeq - 10) {
      if (DEBUG) console.log('[DRAG] Position seq reset detected, accepting new sequence');
      g_lastRemotePositionSeq = -1;
    }
    if (payload.seq <= g_lastRemotePositionSeq) return;
    g_lastRemotePositionSeq = payload.seq;
  }

  // Compute position BEFORE creating/appending ghost so initial placement is correct (Bug 1 fix)
  var localPos = localizeDragPosition(payload);

  // Size based on local mapped target cell
  var gw = 50;
  var gh = 50;
  var targetEl = (typeof payload.targetId === 'string' && payload.targetId)
    ? resolveLocalTarget(payload.targetId)
    : null;
  if (targetEl) {
    var tRect = targetEl.getBoundingClientRect();
    gw = tRect.width;
    gh = tRect.height;
  } else if (g_cachedBoardRect) {
    gw = g_cachedBoardRect.width / g_boardwidth;
    gh = g_cachedBoardRect.height / g_boardheight;
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
    g_dragGhost.style.transition = 'none'; // No transition on creation — snap instantly to first position

    g_dragGhost.innerHTML = SPACER;
    g_dragGhost.style.width = gw + 'px';
    g_dragGhost.style.height = gh + 'px';

    // Set initial position BEFORE appending so browser never sees it at (0,0)
    if (localPos) {
      g_dragGhost.style.transform = 'translate3d(' + localPos.x + 'px, ' + localPos.y + 'px, 0) translate(-50%, -50%)';
    }

    document.body.appendChild(g_dragGhost);

    // Enable transition AFTER element is in DOM at correct position
    g_dragGhost.style.transition = 'transform ' + (DRAG_TRANSITION_MS / 1000) + 's ease-out';
  } else {
    g_dragGhost.innerHTML = SPACER;
    g_dragGhost.style.width = gw + 'px';
    g_dragGhost.style.height = gh + 'px';

    if (localPos) {
      g_dragGhost.style.transform = 'translate3d(' + localPos.x + 'px, ' + localPos.y + 'px, 0) translate(-50%, -50%)';
    }
  }
}

function handleGameStateBroadcast(payload) {
  if (payload.type === 'init') {
    // Validate gameId and dedupe initId
    if (payload.gameId !== g_gameId) return;
    // During a resume/reconnect we ignore init broadcasts and rely on DB sync only.
    if (g_isResuming) return;
    if (payload.initId && g_seenInitIds.has(payload.initId)) return;
    if (payload.initId) g_seenInitIds.add(payload.initId);

    // Clear guest init retry state
    if (g_initRetryTimer) {
      clearTimeout(g_initRetryTimer);
      g_initRetryTimer = null;
    }
    g_initRetryCount = 0;

    // Clear connecting state now that handshake succeeded
    g_connectingInvites.delete(g_gameId);

    // Send ACK back to host
    sendBroadcastNow('init_ack', { gameId: g_gameId, initId: payload.initId });

    // Ensure board is fresh for both players
    // g_bui.restart() would call cleanupMultiplayerSession() which tears down the game channel
    localStorage.removeItem('session');
    g_bui = new RedipsUI();
    init('board');
    g_isMultiplayer = true; // init() clears this, re-enable it
    resetMultiplayerGameState();

    // Apply init state from host synchronously (no setTimeout)
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

    // Initialize DB game state tracking for guest (host does this in createGameStateInDB)
    g_lastDBGameState = JSON.stringify(buildGameStateSnapshot());

    // Subscribe to DB state changes for this game
    subscribeToGameStateChanges();

    updateTurnIndicator();
    updateGameInfoLabels();
    dismissConnectingToast();
  } else if (payload.type === 'shuffle') {
    // Apply opponent shuffle with visible transition
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
  } else if (payload.type === 'layout') {
    if (typeof g_board_empty !== 'undefined' && g_board_empty && payload.layout) {
      g_layout = payload.layout;
      localStorage['layout'] = payload.layout;
      if (typeof applyLayout === 'function') applyLayout(payload.layout);
      if (typeof saveMultiplayerSession === 'function') saveMultiplayerSession();

      // Show toast only if change came from opponent
      if (payload.fromId && payload.fromId !== g_lobbyUserId) {
        g_bui.toast(t('Opponent') + ' ' + t('changed bonuses layout to') + ' ' + (payload.layout === 'default' ? 'Default' : payload.layout));
      }
    }
  } else if (payload.type === 'game_ended') {
    var alreadyEnded = g_isGameOver;
    if (!alreadyEnded) {
      g_isGameOver = true;
    }
    g_mpGameEndReason = payload.reason || '';
    if (payload.reason === 'forfeit') {
      g_bui.prompt(t('Opponent has left the game.'));
    }
    // Apply authoritative final scores from the receiver
    if (typeof payload.finalPScore === 'number' && typeof payload.finalOScore === 'number') {
      g_pscore = payload.finalPScore;
      g_oscore = payload.finalOScore;
      g_finalScoresApplied = true;
      if (g_bui) {
        g_bui.setPlayerScore(g_playerLastScore || 0, g_pscore);
        g_bui.setOpponentScore(g_opponentLastScore || 0, g_oscore);
      }
    }
    // Always call announceWinner; it's idempotent for UI and finalizeGameScores is guarded
    announceWinner();
    if (payload.reason === 'passes' || payload.reason === 'ended') {
      enterPostGameState();
    } else {
      cleanupMultiplayerSession();
    }
  }

  // Any broadcast from opponent indicates activity — reset idle timer
  resetIdleTimer();
}

function updateTurnIndicator() {
  // Explicit button gating policy
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
    if (g_isMultiplayer) {
      lobbyBtn.disabled = true;
      lobbyBtn.parentElement.title = t('Finish the current game before joining the lobby');
    } else {
      lobbyBtn.disabled = false;
      lobbyBtn.parentElement.title = t('Multiplayer Lobby');
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
      finalizeMultiplayerGame('passes', true);
      // No return here, we still want to broadcast the move that ended the game
    }
  }

  // We made a valid move. Now broadcast it to the opponent!
  g_pscore += scoreEarned;
  g_playerLastScore = scoreEarned;
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
  mpLog('MOVE', 'log', 'Broadcasting move', { words: moveData.words, score: moveData.score, rackAfter: moveData.rackAfter, version: moveData.stateVersion });

  g_isMyTurn = false;
  updateTurnIndicator();
  updateGameInfoLabels();
  broadcastGameState(moveData);

  // Clear cached init so it can't be re-broadcast mid-game
  g_cachedInitPayload = null;

  g_lastMoveAt = Date.now();
  clearOpponentPreviewCache();
  saveMultiplayerSession();

  if (!passed && rackAfter.replace(/\./g, '') === '' && g_letpool.length === 0) {
    g_rackEmptiedBy = 'player';
    g_isGameOver = true;
    saveMultiplayerSession();
    enterPostGameState();
    // Fallback: if receiver's game_ended broadcast is lost, compute locally after 5s
    setTimeout(function() {
      if (g_isGameOver && !g_finalScoresApplied) {
        finalizeGameScores();
        announceWinner();
      }
    }, 5000);
    return;
  }
}

function handleMoveBroadcast(payload) {
  if (g_isGameOver) return;
  if (payload.type === 'move') {
    if (payload.stateVersion && payload.stateVersion <= g_stateVersion) {
      mpLog('MOVE', 'log', 'Ignoring stale move', { payloadVersion: payload.stateVersion, localVersion: g_stateVersion });
      return;
    }
    if (payload.timestamp && typeof g_lastAppliedMoveTimestamp === 'number' && payload.timestamp <= g_lastAppliedMoveTimestamp) {
      return;
    }
    g_stateVersion = Math.max(g_stateVersion, payload.stateVersion || 0);
    g_lastAppliedMoveTimestamp = Date.now();
    mpLog('MOVE', 'log', 'Received move', { words: payload.words, score: payload.score, rackAfter: payload.rackAfter, version: payload.stateVersion });

    // Connection is alive — clear any guest init retry timer
    if (g_initRetryTimer) {
      clearTimeout(g_initRetryTimer);
      g_initRetryTimer = null;
    }
    g_initRetryCount = 0;

    // Clean up any stray ghost tiles before applying the move
    cleanupDragGhosts();

    // Helper: re-render entire board from committed g_board and sync racks
    var syncBoardUI = function() {
      renderCommittedBoard();
      g_bui.makeTilesFixed();
      // Sync racks from committed state alongside board
      g_bui.setPlayerRack(g_bui.racks[1] || '');
      g_bui.setOpponentRack(g_bui.racks[2] || '');
    };

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

      function onOpponentMoveDone() {
        g_bui.setOpponentRack(payload.rackAfter);
        g_oscore += payload.score;
        g_opponentLastScore = payload.score;
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
        clearOpponentPreviewCache();
        // Receiver skips DB write; mover already wrote authoritative state.
        // But we still need to update session_mp for reload resilience.
        if (typeof saveSessionMpOnly === 'function') saveSessionMpOnly();

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

    // Re-render board from committed g_board for both moves and passes.
    // This clears any phantom preview tiles left over from earlier drag broadcasts.
    if (typeof syncBoardUI === 'function') syncBoardUI();

    // Extra safety: clear any ghost tiles that survived the move processing
    cleanupDragGhosts();

    g_oscore += payload.score;
    g_opponentLastScore = payload.score;
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
          saveMultiplayerSession();
          finalizeGameScores();
          g_finalScoresApplied = true;
          broadcastGameState({
            type: 'game_ended',
            reason: 'passes',
            stateVersion: g_stateVersion,
            finalPScore: g_pscore,
            finalOScore: g_oscore
          });
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
      saveMultiplayerSession();
      finalizeGameScores();
      g_finalScoresApplied = true;
      broadcastGameState({
        type: 'game_ended',
        reason: 'ended',
        stateVersion: g_stateVersion,
        finalPScore: g_pscore,
        finalOScore: g_oscore
      });
      announceWinner();
      enterPostGameState();
      return;
    }

    // Game is still ongoing — hand turn back to local player
    g_isMyTurn = true;
    updateTurnIndicator();
    updateGameInfoLabels();

    g_lastMoveAt = Date.now();
    clearOpponentPreviewCache();
    // Receiver skips DB write; mover already wrote authoritative state.
    // But we still need to update session_mp for reload resilience.
    if (typeof saveSessionMpOnly === 'function') saveSessionMpOnly();
    // Update local DB tracking to prevent redundant syncs from realtime triggers
    g_dbVersion = Math.max(g_dbVersion, payload.stateVersion || 0);
    g_lastDBGameState = JSON.stringify(buildGameStateSnapshot());

    // Opponent activity resets idle timer
    resetIdleTimer();
  }
}

function saveSessionMpOnly() {
  if (!g_isMultiplayer || !g_opponentName || !g_gameId) return;
  var snapshot = {
    gameId: g_gameId,
    opponentId: g_opponentId,
    opponentName: g_opponentName,
    isMyTurn: g_isMyTurn,
    isHost: g_isHost,
    letpool: g_letpool,
    pscore: g_pscore,
    oscore: g_oscore,
    myRack: (g_bui && g_bui.racks[1]) || '',
    oppRack: (g_bui && g_bui.racks[2]) || '',
    board: g_board,
    boardp: g_boardpoints,
    boardt: g_boardtypes,
    boardEmpty: g_board_empty,
    stateVersion: g_stateVersion,
    isGameOver: g_isGameOver,
    history: g_history,
    newplays: (g_bui && g_bui.newplays) || {},
    oppNewplays: (g_bui && g_bui.oppNewplays) || {},
    savedAt: Date.now(),
    lastMoveAt: g_lastMoveAt || Date.now()
  };
  var snapshotJson = JSON.stringify(snapshot);
  if (localStorage['session_mp'] !== snapshotJson) {
    localStorage['session_mp'] = snapshotJson;
  }
}

function saveMultiplayerSession() {
  if (g_isMultiplayer) {
    // Don't save corrupted sessions (e.g. opponentName missing indicates cleanupMultiplayerSession
    // was incorrectly called during init, leaving g_isMultiplayer=true but opponentName=null)
    if (!g_opponentName || !g_gameId) {
      if (DEBUG) console.warn('Skipping save of corrupted MP session: missing opponentName or gameId');
      return;
    }

    // Write to localStorage as backup for reload resilience
    // DB is the primary SSOT, but session_mp enables instant reload
    // when DB is temporarily unavailable or stale.
    localStorage['session_mode'] = 'mp';
    saveSessionMpOnly();

    // Sync to DB, but only if game state actually changed
    if (DEBUG && g_bui && g_bui.newplays) mpLog('JOKER', 'log', 'saveMultiplayerSession newplays', g_bui.newplays);
    var currentGameState = buildGameStateSnapshot();
    var currentGameStateJson = JSON.stringify(currentGameState);
    
    // Check if turn changed (last snapshot might have had different turn)
    var lastTurnId = null;
    try {
      var last = JSON.parse(g_lastDBGameState);
      lastTurnId = last.turnPlayerId;
    } catch(e) {}
    var turnChanged = currentGameState.turnPlayerId !== lastTurnId;

    var stateChanged = (g_dbVersion > 0 && currentGameStateJson !== g_lastDBGameState) || turnChanged;
    if (DEBUG) {
      var checksum = function(s) { var h = 0; for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; };
      mpLog('DB', 'log', 'State diff check', {
        lastDBGameState: g_lastDBGameState ? checksum(g_lastDBGameState) : null,
        current: checksum(currentGameStateJson),
        changed: stateChanged
      });
    }
    if (stateChanged) {
      mpLog('DB', 'log', 'Writing to DB because state changed');
      g_dbWriteInProgress = true;
      updateGameStateInDB(g_dbVersion).then(function(success) {
        if (success) {
          g_dbVersion += 1;
          g_lastDBGameState = currentGameStateJson;
          if (DEBUG) console.log('[DB] saveMultiplayerSession synced, new version:', g_dbVersion);
        } else {
          if (DEBUG) console.warn('[DB] saveMultiplayerSession sync failed (version conflict), fetching current version and retrying...');
          // Fetch current state and retry once
          fetchGameStateFromDB().then(function(dbData) {
            if (dbData && typeof dbData.version === 'number') {
              g_dbVersion = dbData.version;
              g_lastDBGameState = JSON.stringify(dbData.state || {});
              if (DEBUG) console.log('[DB] Updated g_dbVersion to:', g_dbVersion, 'retrying write...');
              // Retry the write with updated version
              return updateGameStateInDB(g_dbVersion);
            }
            return false;
          }).then(function(retrySuccess) {
            if (retrySuccess) {
              g_dbVersion += 1;
              g_lastDBGameState = currentGameStateJson;
              if (DEBUG) console.log('[DB] Retry succeeded, new version:', g_dbVersion);
            } else {
              if (DEBUG) console.warn('[DB] Retry failed, will retry on next save');
            }
          });
        }
      }).then(function() {
        g_dbWriteInProgress = false;
      }, function() {
        g_dbWriteInProgress = false;
      });
    } else if (g_dbVersion > 0 && DEBUG) {
      if (DEBUG) console.log('[DB] Game state unchanged, skipping DB write');
    }
  }
}

// -----------------------------------------------------------------------------
// DB-as-SSOT: Game State Sync Functions
// -----------------------------------------------------------------------------

function buildGameStateSnapshot() {
  // Perspective-neutral: player1 = host, player2 = guest
  // Writer puts their own data in the correct slot based on g_isHost

  // Convert local boardTypes (1=me, 2=opponent) to neutral (1=host, 2=guest)
  var neutralBoardTypes = [];
  for (var x = 0; x < g_boardwidth; ++x) {
    neutralBoardTypes[x] = [];
    for (var y = 0; y < g_boardheight; ++y) {
      var localType = g_boardtypes[x][y];
      if (localType === 1) {
        neutralBoardTypes[x][y] = g_isHost ? 1 : 2;
      } else if (localType === 2) {
        neutralBoardTypes[x][y] = g_isHost ? 2 : 1;
      } else {
        neutralBoardTypes[x][y] = 0;
      }
    }
  }

  // Convert local history (0=me, 1=opponent) to neutral player IDs
  var neutralHistory = [];
  if (Array.isArray(g_history)) {
    for (var i = 0; i < g_history.length; ++i) {
      var entry = g_history[i];
      var localPlayer = entry[1];
      var playerId = (localPlayer === 0) ? g_lobbyUserId : g_opponentId;
      neutralHistory.push([entry[0], playerId]);
    }
  }

  // Convert local preview tiles to perspective-neutral
  var myNewplays = (g_bui && g_bui.newplays) ? g_bui.newplays : {};
  var oppNewplays = (g_bui && g_bui.oppNewplays) ? g_bui.oppNewplays : {};
  if (DEBUG) console.log('[JOKER] buildGameStateSnapshot myNewplays:', JSON.stringify(myNewplays), 'oppNewplays:', JSON.stringify(oppNewplays));
  var preview = {};
  if (g_isHost) {
    preview.player1 = myNewplays;
    preview.player2 = oppNewplays;
  } else {
    preview.player1 = oppNewplays;
    preview.player2 = myNewplays;
  }

  return {
    turnPlayerId: g_isMyTurn ? g_lobbyUserId : (g_opponentId || ''),
    board: g_board,
    boardPoints: g_boardpoints,
    boardTypes: neutralBoardTypes,
    boardEmpty: g_board_empty,
    letpool: g_letpool,
    player1Id: g_isHost ? g_lobbyUserId : (g_opponentId || ''),
    player2Id: g_isHost ? (g_opponentId || '') : g_lobbyUserId,
    player1Score: g_isHost ? g_pscore : g_oscore,
    player2Score: g_isHost ? g_oscore : g_pscore,
    player1LastScore: g_isHost ? g_playerLastScore : g_opponentLastScore,
    player2LastScore: g_isHost ? g_opponentLastScore : g_playerLastScore,
    player1Rack: (g_bui && g_bui.racks[g_isHost ? 1 : 2]) || '',
    player2Rack: (g_bui && g_bui.racks[g_isHost ? 2 : 1]) || '',
    history: neutralHistory,
    passes: g_passes,
    turnNumber: g_stateVersion,
    preview: preview
  };
}

function createGameStateInDB() {
  if (!window.supabaseClient || !g_gameId) return Promise.resolve(false);
  var state = buildGameStateSnapshot();
  return window.supabaseClient
    .rpc('create_game_state', {
      p_game_id: g_gameId,
      p_app_key: _dk(_hk),
      p_player_a_id: g_isHost ? g_lobbyUserId : (g_opponentId || ''),
      p_player_b_id: g_isHost ? (g_opponentId || '') : g_lobbyUserId,
      p_initial_state: state
    })
    .then(function(result) {
      if (result.error) {
        if (DEBUG) console.warn('[DB] create_game_state error:', result.error);
        return false;
      }
      if (result.data) {
        g_dbVersion = 1;
        g_lastDBGameState = JSON.stringify(state);
        if (DEBUG) console.log('[DB] create_game_state success, version set to:', g_dbVersion);
      }
      return result.data;
    })
    .catch(function(err) {
      if (DEBUG) console.warn('[DB] create_game_state failed:', err);
      return false;
    });
}

var g_previewSaveTimer = null;

function savePreviewToDB() {
  if (!g_isMultiplayer || !g_gameId || !window.supabaseClient) return;
  if (g_previewSaveTimer) clearTimeout(g_previewSaveTimer);
  g_previewSaveTimer = setTimeout(function() {
    g_previewSaveTimer = null;
    if (typeof saveMultiplayerSession === 'function') saveMultiplayerSession();
  }, 200);
}

function updateGameStateInDB(expectedVersion) {
  if (!window.supabaseClient || !g_gameId) return Promise.resolve(false);
  var state = buildGameStateSnapshot();
  return window.supabaseClient
    .rpc('update_game_state', {
      p_game_id: g_gameId,
      p_app_key: _dk(_hk),
      p_expected_version: expectedVersion,
      p_new_state: state
    })
    .then(function(result) {
      if (result.error) {
        if (DEBUG) console.warn('[DB] update_game_state error:', result.error);
        return false;
      }
      if (DEBUG) console.log('[DB] update_game_state result:', result.data);
      return result.data;
    })
    .catch(function(err) {
      if (DEBUG) console.warn('[DB] update_game_state failed:', err);
      return false;
    });
}

function fetchGameStateFromDB() {
  if (!window.supabaseClient || !g_gameId) return Promise.resolve(null);
  return window.supabaseClient
    .from('games')
    .select('state, version, updated_at')
    .eq('id', g_gameId)
    .single()
    .then(function(result) {
      if (result.error) {
        if (DEBUG) console.warn('[DB] fetch game state error:', result.error);
        return null;
      }
      if (DEBUG) console.log('[DB] fetched game state version:', result.data.version);
      return result.data;
    })
    .catch(function(err) {
      if (DEBUG) console.warn('[DB] fetch game state failed:', err);
      return null;
    });
}

function applyGameStateFromDB(dbState) {
  if (!dbState || !dbState.state) return;
  var s = dbState.state;

  // Apply committed state from DB
  if (s.board) g_board = normalizeBoardMatrix(s.board, '');
  if (s.boardPoints) g_boardpoints = normalizeBoardMatrix(s.boardPoints, 0);
  if (typeof s.boardEmpty === 'boolean') g_board_empty = s.boardEmpty;
  if (Array.isArray(s.letpool)) g_letpool = s.letpool;
  if (typeof s.passes === 'number') g_passes = s.passes;
  if (typeof s.turnNumber === 'number') g_stateVersion = s.turnNumber;

  // boardTypes: perspective-neutral (1=host, 2=guest) → local (1=me, 2=opponent)
  if (s.boardTypes) {
    var neutralTypes = normalizeBoardMatrix(s.boardTypes, 0);
    g_boardtypes = [];
    for (var x = 0; x < g_boardwidth; ++x) {
      g_boardtypes[x] = [];
      for (var y = 0; y < g_boardheight; ++y) {
        var neutral = (neutralTypes[x] && neutralTypes[x][y]) || 0;
        if (neutral === 0) {
          g_boardtypes[x][y] = 0;
        } else if (neutral === 1) {
          g_boardtypes[x][y] = g_isHost ? 1 : 2;
        } else {
          g_boardtypes[x][y] = g_isHost ? 2 : 1;
        }
      }
    }
  }

  // Scores (perspective-neutral: player1 = host, player2 = guest)
  if (g_isHost) {
    if (typeof s.player1Score === 'number') g_pscore = s.player1Score;
    if (typeof s.player2Score === 'number') g_oscore = s.player2Score;
    if (typeof s.player1LastScore === 'number') g_playerLastScore = s.player1LastScore;
    if (typeof s.player2LastScore === 'number') g_opponentLastScore = s.player2LastScore;
  } else {
    if (typeof s.player2Score === 'number') g_pscore = s.player2Score;
    if (typeof s.player1Score === 'number') g_oscore = s.player1Score;
    if (typeof s.player2LastScore === 'number') g_playerLastScore = s.player2LastScore;
    if (typeof s.player1LastScore === 'number') g_opponentLastScore = s.player1LastScore;
  }

  // Racks: stored in JSON state (player1Rack = host rack, player2Rack = guest rack)
  if (g_bui) {
    var myRack = g_isHost ? s.player1Rack : s.player2Rack;
    var oppRack = g_isHost ? s.player2Rack : s.player1Rack;

    // Guard: don't overwrite local rack with stale DB data.
    // If local rack has more tiles than DB, local player likely just dragged
    // a tile and their write hasn't won the version race yet.
    var localRack = (g_bui.racks[1] || '').replace(/\./g, '');
    var dbMyRack = (typeof myRack === 'string' ? myRack : '').replace(/\./g, '');
    if (typeof myRack === 'string' && myRack !== '' && dbMyRack.length >= localRack.length) {
      g_bui.setPlayerRack(myRack);
    }
    if (typeof oppRack === 'string' && oppRack !== '') {
      g_bui.setOpponentRack(oppRack);
    }
  }

  // History: neutral player IDs → local (0=me, 1=opponent)
  if (Array.isArray(s.history) && s.history.length > 0) {
    g_history = [];
    var histHtml = '<table>';
    for (var i = 0; i < s.history.length; ++i) {
      var entry = s.history[i];
      var localPlayer = (entry[1] === g_lobbyUserId) ? 0 : 1;
      g_history.push([entry[0], localPlayer]);
      histHtml += g_bui.renderWordPlayed(entry[0], localPlayer);
    }
    histHtml += '</table>';
    g_bui.hlines = histHtml;
    g_bui.hcount = g_history.length;
    var histEl = el('history');
    if (histEl) {
      histEl.innerHTML = histHtml;
      histEl.scrollTop = 9999;
    }
  }

  // Preview tiles: restore pending drag tiles from DB
  if (s.preview && g_bui) {
    g_bui.newplays    = g_isHost ? (s.preview.player1 || {}) : (s.preview.player2 || {});
    g_bui.oppNewplays = g_isHost ? (s.preview.player2 || {}) : (s.preview.player1 || {});
  }

  // Turn state
  if (s.turnPlayerId) {
    var dbIsMyTurn = (s.turnPlayerId === g_lobbyUserId);
    if (dbIsMyTurn !== g_isMyTurn) {
      mpLog('SYNC', 'log', 'Turn mismatch detected, syncing turn', { dbIsMyTurn: dbIsMyTurn });
      g_isMyTurn = dbIsMyTurn;
    }
  }

  // Re-apply board-empty UI guards after DB sync
  if (!g_board_empty) {
    var elUp = el('a.link.up');
    var elDown = el('a.link.down');
    var elLayout = el('bonuseslayout');
    if (elUp) elUp.classList.add('disabled');
    if (elDown) elDown.classList.add('disabled');
    if (elLayout) elLayout.disabled = true;
  }
}

// Subscribe to realtime updates on games table
var g_gameStateSubscription = null;

// Realtime sync debouncing
let g_realtimeSyncTimer = null;
const REALTIME_SYNC_DEBOUNCE_MS = 300;

function detectStateMismatches(dbState) {
  if (!dbState || !dbState.state) return [];
  var s = dbState.state;
  var mismatches = [];

  // Compare board
  if (s.board && JSON.stringify(s.board) !== JSON.stringify(g_board)) {
    mismatches.push('board');
  }
  // Compare scores
  if (typeof s.player1Score === 'number' && s.player1Score !== g_pscore) {
    mismatches.push('player1Score: DB=' + s.player1Score + ' local=' + g_pscore);
  }
  if (typeof s.player2Score === 'number' && s.player2Score !== g_oscore) {
    mismatches.push('player2Score: DB=' + s.player2Score + ' local=' + g_oscore);
  }
  // Compare turn
  if (s.turnPlayerId) {
    var dbIsMyTurn = (s.turnPlayerId === g_lobbyUserId);
    if (dbIsMyTurn !== g_isMyTurn) {
      mismatches.push('turn: DB=' + s.turnPlayerId + ' localMyTurn=' + g_isMyTurn);
    }
  }
  // Racks are no longer in JSON state (per-player columns are authoritative)
  // Skip rack mismatch detection

  return mismatches;
}

function subscribeToGameStateChanges() {
  if (!window.supabaseClient || !g_gameId) return;

  // Clean up stale subscription from previous game (rematch, etc.)
  if (g_gameStateSubscription) {
    unsubscribeFromGameStateChanges();
  }

  g_gameStateSubscription = window.supabaseClient
    .channel('game_state:' + g_gameId)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'games',
      filter: 'id=eq.' + g_gameId
    }, function(payload) {
      if (DEBUG) console.log('[DB] Realtime update received for game:', g_gameId);
      
      // Debounce sync to allow broadcast/local writes to settle
      if (g_realtimeSyncTimer) clearTimeout(g_realtimeSyncTimer);
      g_realtimeSyncTimer = setTimeout(function() {
        g_realtimeSyncTimer = null;
        
        var dbVersion = payload.new && typeof payload.new.version === 'number' ? payload.new.version : 0;
        var mismatches = detectStateMismatches(payload.new);

        if (dbVersion > g_dbVersion || mismatches.length > 0) {
          mpLog('SYNC', 'log', 'Realtime sync triggered', { 
            dbVersion: dbVersion, 
            localVersion: g_dbVersion,
            mismatches: mismatches
          });
          maybeSyncGameStateFromDB('realtime');
        } else if (DEBUG) {
          console.log('[DB] Realtime update skipped, state matches local');
        }
      }, REALTIME_SYNC_DEBOUNCE_MS);
    })
    .subscribe(function(status) {
      if (DEBUG) console.log('[DB] Game state subscription status:', status);
    });
}

function unsubscribeFromGameStateChanges() {
  if (g_gameStateSubscription) {
    g_gameStateSubscription.unsubscribe();
    g_gameStateSubscription = null;
  }
}

function cleanupStaleGamesFromClient(maxAgeHours) {
  if (!window.supabaseClient) return Promise.resolve(0);
  return window.supabaseClient
    .rpc('cleanup_stale_games', { p_max_age_hours: maxAgeHours || 24 })
    .then(function(result) {
      if (result.error) {
        if (DEBUG) console.warn('[DB] cleanup_stale_games error:', result.error);
        return 0;
      }
      if (DEBUG && result.data > 0) console.log('[DB] cleaned up stale games:', result.data);
      return result.data || 0;
    })
    .catch(function(err) {
      if (DEBUG) console.warn('[DB] cleanup_stale_games failed:', err);
      return 0;
    });
}

function deleteGameStateFromDB(gameId) {
  if (!window.supabaseClient || !gameId) return Promise.resolve(false);
  return window.supabaseClient
    .rpc('delete_game_state', {
      p_game_id: gameId,
      p_app_key: _dk(_hk)
    })
    .then(function(result) {
      if (result.error) {
        if (DEBUG) console.warn('[DB] delete game state error:', result.error);
        return false;
      }
      if (DEBUG) console.log('[DB] deleted game state for:', gameId);
      return result.data;
    })
    .catch(function(err) {
      if (DEBUG) console.warn('[DB] delete game state failed:', err);
      return false;
    });
}

function isDragInProgress() {
  return !!(g_bui && g_bui.rd && g_bui.rd.obj);
}

function maybeSyncGameStateFromDB(reason) {
  if (g_remoteDragging || g_remoteDragCooldown) {
    mpLog('SYNC', 'log', 'Deferring sync (remote drag/cooldown)', { reason: reason });
    g_deferredDBSync = true;
    g_deferredDbSyncs++;
    return;
  }
  if (!isDragInProgress()) {
    syncGameStateFromDB();
  } else {
    mpLog('SYNC', 'log', 'Deferring sync (local drag)', { reason: reason });
    g_deferredDBSync = true;
    g_deferredDbSyncs++;
  }
}

function syncGameStateFromDB() {
  if (!window.supabaseClient || !g_gameId || !g_isMultiplayer) return Promise.resolve(false);
  if (g_dbWriteInProgress) {
    mpLog('SYNC', 'log', 'Skipping sync, write in progress');
    return Promise.resolve(false);
  }
  mpLog('SYNC', 'log', 'Syncing from DB', { gameId: g_gameId, localVersion: g_dbVersion });

  return fetchGameStateFromDB().then(function(dbData) {
    if (!dbData || !dbData.state) {
      if (DEBUG) console.warn('[DB] No state found in DB for game:', g_gameId);
      return false;
    }

    // Update version tracking
    if (typeof dbData.version === 'number') {
      g_dbVersion = dbData.version;
    }

    // Preserve transient opponent previews before DB application may wipe them
    var savedOppNewplays = (g_bui && g_bui.oppNewplays) ? JSON.parse(JSON.stringify(g_bui.oppNewplays)) : {};

    // Apply committed state from DB
    applyGameStateFromDB(dbData);

    // Restore opponent previews that DB sync may have wiped.
    // Only fall back to local memory if DB state has no preview data.
    if (g_bui) {
      var hasDbPreviews = dbData.state && dbData.state.preview &&
        (Object.keys(dbData.state.preview.player1 || {}).length > 0 ||
         Object.keys(dbData.state.preview.player2 || {}).length > 0);
      if (!hasDbPreviews) {
        g_bui.oppNewplays = savedOppNewplays;
      }
    }
    renderTransientOverlays();

    // Update lastDBSnapshot using LOCAL snapshot format
    // (DB JSONB may have different property ordering than local objects)
    // Re-render UI
    if (g_bui) {
      g_bui.makeTilesFixed();
      // Skip re-applying local rack if it was modified recently (prevents stale DB
      // sync from overwriting a tile the player just dragged to rack)
      var rackChangedRecently = (Date.now() - g_lastLocalRackChange) < 5000;
      if (!rackChangedRecently) {
        g_bui.setPlayerRack(g_bui.racks[1] || '');
      }
      g_bui.setOpponentRack(g_bui.racks[2] || '');
      g_bui.setPlayerScore(g_playerLastScore || 0, g_pscore);
      g_bui.setOpponentScore(g_opponentLastScore || 0, g_oscore);
      g_bui.setTilesLeft((g_letpool || []).length);
    }
    updateTurnIndicator();
    updateGameInfoLabels();

    mpLog('SYNC', 'log', 'State synced from DB', { version: g_dbVersion, overlaysReapplied: Object.keys(savedOppNewplays).length });
    
    // Update g_lastDBGameState after successful sync to prevent redundant writes
    g_lastDBGameState = JSON.stringify(buildGameStateSnapshot());

    return true;
  }).catch(function(err) {
    mpLog('SYNC', 'warn', 'syncGameStateFromDB failed', err);
    return false;
  });
}

function checkActiveInvite() {
  if (!window.supabaseClient) return Promise.resolve(null);
  return window.supabaseClient
    .from('invites')
    .select('*')
    .eq('app_key', _dk(_hk))
    .in('status', ['started', 'accepted'])
    .or('from_id.eq.' + g_lobbyUserId + ',to_id.eq.' + g_lobbyUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .then(function(result) {
      if (result.error) throw result.error;
      return (result.data && result.data[0]) || null;
    })
    .catch(function(err) {
      if (DEBUG) console.warn('checkActiveInvite failed:', err);
      return null;
    });
}

function dismissResumeToast() {
  if (g_resumeToast && g_resumeToast.parentNode) {
    g_resumeToast.classList.remove('show');
    g_resumeToast.classList.add('hide');
    // Force removal if transition doesn't fire (e.g. display:none parent)
    setTimeout(function() {
      if (g_resumeToast && g_resumeToast.parentNode) {
        g_resumeToast.parentNode.removeChild(g_resumeToast);
      }
      g_resumeToast = null;
    }, 500);
  }
  g_resumeToast = null;
}

function resumeFromInvite(invite) {
  if (!invite || !invite.game_id) return;
  if (DEBUG) console.log('Resuming from invite DB:', invite.game_id);

  var isHost = invite.from_id === g_lobbyUserId;
  g_gameId = invite.game_id;
  g_opponentId = isHost ? invite.to_id : invite.from_id;
  g_opponentName = isHost ? (invite.to_name || t('Opponent')) : (invite.from_name || t('Opponent'));
  g_isMultiplayer = true;
  g_isHost = isHost;
  g_isResuming = true;

  // Show loading toast while syncing
  if (g_bui) g_resumeToast = g_bui.toast(t('Resuming game...'), 0);

  // Cold start: init empty board, then rejoin channel
  init('board', true);
  g_isMultiplayer = true; // init() resets this — restore before anything MP-related
  updateGameInfoLabels();

  joinGameChannel(g_gameId, isHost, function() {
    // Fetch authoritative state from DB instead of requesting via socket
    syncGameStateFromDB().then(function(synced) {
      if (synced) {
        if (DEBUG) console.log('[DB] resumeFromInvite synced from DB');
        subscribeToGameStateChanges();
        g_isResuming = false;
        dismissResumeToast();
      } else {
        g_bui.toast(t('Game not found'), 4000);
        cleanupMultiplayerSession();
      }
    });
    // 15s fallback: dismiss toast even if sync never completes
    setTimeout(function() {
      dismissResumeToast();
    }, 15000);
  }, true);
}

document.addEventListener('appReady', function() {
  var mpData = null;
  try {
    mpData = JSON.parse(localStorage['session_mp'] || 'null');
  } catch (err) {
    mpData = null;
  }

  var hasLocalSession = !!(mpData && mpData.gameId && !mpData.isGameOver);
  var now = Date.now();
  var idleMs = typeof g_wait_mp_idle !== 'undefined' ? g_wait_mp_idle : 3600000;
  var MAX_RESUME_AGE_MS = idleMs + 5 * 60 * 1000;

  // Fast path: localStorage resume
  if (hasLocalSession) {
    var hasRecentSnapshot = typeof mpData.savedAt === 'number' && (now - mpData.savedAt) <= MAX_RESUME_AGE_MS;
    var hasRecentMove = typeof mpData.lastMoveAt === 'number' && (now - mpData.lastMoveAt) <= MAX_RESUME_AGE_MS;
    var hasUsableState = typeof mpData.stateVersion === 'number' && mpData.stateVersion > 0 &&
      typeof mpData.myRack === 'string' && typeof mpData.oppRack === 'string' &&
      Array.isArray(mpData.letpool) && typeof mpData.opponentName === 'string' && mpData.opponentName !== '';

    if (hasUsableState && (hasRecentSnapshot || hasRecentMove) && typeof mpData.isHost === 'boolean') {
      if (DEBUG) console.log('Resuming multiplayer session for game:', mpData.gameId);
      try {
        g_gameId = mpData.gameId;
        g_opponentId = mpData.opponentId || null;
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

        g_history = Array.isArray(mpData.history) ? mpData.history : [];
        var histHtml = '<table>';
        for (var i = 0; i < g_history.length; ++i) {
          histHtml += g_bui.renderWordPlayed(g_history[i][0], g_history[i][1]);
        }
        histHtml += '</table>';
        el('history').innerHTML = histHtml;
        g_bui.hlines = histHtml;
        g_bui.hcount = g_history.length;

        if (DEBUG) console.log('[resume] restoring myRack:', JSON.stringify(mpData.myRack));
        g_bui.setPlayerRack(String(mpData.myRack || ''));
        g_bui.setOpponentRack(String(mpData.oppRack || ''));
        g_bui.setPlayerScore(0, g_pscore);
        g_bui.setOpponentScore(0, g_oscore);
        g_bui.setTilesLeft((g_letpool || []).length);

        renderCommittedBoard();
        if (DEBUG) console.log('[JOKER] localStorage restore newplays:', JSON.stringify(mpData.newplays));
        g_bui.newplays = mpData.newplays || {};
        g_bui.makeTilesFixed();
        updateTurnIndicator();
        updateGameInfoLabels();

        var resumedIsHost = !!mpData.isHost;
        g_isHost = resumedIsHost;
        g_isResuming = true;
        joinGameChannel(g_gameId, resumedIsHost, function() {
          // Fetch authoritative state from DB instead of requesting via socket
          syncGameStateFromDB().then(function(synced) {
            if (synced) {
              subscribeToGameStateChanges();
              g_isResuming = false;
              // DEFERRED removal: only remove session_mp AFTER we've successfully 
              // transitioned to DB-as-SSOT. This ensures session_mode=mp is the 
              // only signal needed for subsequent reloads.
              localStorage.removeItem('session_mp');
              if (DEBUG) console.log('[DB] Reconnected and synced from DB, purged session_mp');
            } else {
              if (DEBUG) console.warn('[DB] Sync failed during resume, keeping session_mp as backup');
              g_bui.toast(t('Game not found'), 4000);
              cleanupMultiplayerSession();
            }
          });
        }, true);

        g_resumeConnectionTimer = setTimeout(function() {
          if (!g_channelSubscribed) {
            if (g_bui) g_bui.toast(t('Reconnecting...'), 3000);
          }
        }, 5000);

        g_resumeFailTimer = setTimeout(function() {
          if (!g_channelSubscribed) {
            g_bui.prompt(
              t('Unable to reconnect to game.'),
              '<button class="button" onclick="hideModal();g_bui.restart()">' + t('Play Computer') + '</button>'
            );
          }
        }, 20000);
      } catch (err) {
        if (DEBUG) console.error('Error restoring multiplayer session:', err);
        localStorage.removeItem('session_mp');
        hasLocalSession = false;
      }
    } else {
      localStorage.removeItem('session_mp');
      if (localStorage['session_mode'] === 'mp') localStorage['session_mode'] = 'sp';
      hasLocalSession = false;
    }
  }

  // Async validation / recovery from invite DB
  if (typeof checkActiveInvite === 'function') {
    checkActiveInvite().then(function(invite) {
      if (!invite && hasLocalSession) {
        // DB says no active game, but localStorage thinks there is
        if (DEBUG) console.log('Stale session_mp, cleaning up');
        cleanupMultiplayerSession();
        init('board');
      } else if (invite && !hasLocalSession) {
        // DB found active game, but localStorage was cleared
        if (DEBUG) console.log('Recovered MP session from invite DB');
        resumeFromInvite(invite);
      }
      // Both match: nothing to do (already resumed)
      // Mismatch: trust localStorage for now
    });
  }
});



// -----------------------------------------------------------------------------
// PERIODIC AUTO-SAVE
// -----------------------------------------------------------------------------
function startMpAutoSaveTimer() {
  if (g_mpAutoSaveTimer) clearInterval(g_mpAutoSaveTimer);
  g_mpAutoSaveTimer = setInterval(function() {
    if (g_isMultiplayer && !g_isGameOver) {
      saveMultiplayerSession();
    }
  }, 30000);
}

function stopMpAutoSaveTimer() {
  if (g_mpAutoSaveTimer) {
    clearInterval(g_mpAutoSaveTimer);
    g_mpAutoSaveTimer = null;
  }
}

// -----------------------------------------------------------------------------
// LOBBY HEARTBEAT (hybrid presence for mobile reliability)
// -----------------------------------------------------------------------------
function startLobbyHeartbeat() {
  if (g_lobbyHeartbeatTimer) clearInterval(g_lobbyHeartbeatTimer);
  g_lobbyHeartbeatTimer = setInterval(function() {
    if (g_activeChannelType !== 'lobby' || !g_channel) return;
    g_channel.send({
      type: 'broadcast',
      event: 'lobby_ping',
      payload: { id: g_lobbyUserId, name: g_myName }
    }).catch(function() {});

    var now = Date.now();
    for (var id in g_lobbyHeartbeats) {
      if (now - g_lobbyHeartbeats[id].lastPing > LOBBY_HEARTBEAT_STALE_MS) {
        delete g_lobbyHeartbeats[id];
      }
    }
    if (!g_isMultiplayer && now - g_lastLobbyRefreshAt >= 60000) {
      g_lastLobbyRefreshAt = now;
      refreshPlayersInGames();
    }
    updateLobbyBadgeFromMergedState();
  }, LOBBY_HEARTBEAT_INTERVAL_MS);
}

function stopLobbyHeartbeat() {
  if (g_lobbyHeartbeatTimer) {
    clearInterval(g_lobbyHeartbeatTimer);
    g_lobbyHeartbeatTimer = null;
  }
  g_lobbyHeartbeats = {};
}

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

// Pause/resume idle timer and force-save session when app goes to background
function handleVisibilityChange() {
  if (document.hidden || document.visibilityState === 'hidden') {
    if (g_isMultiplayer) saveMultiplayerSession();
    if (g_idleTimer) {
      clearInterval(g_idleTimer);
      g_idleTimer = null;
    }
    stopMpAutoSaveTimer();
  } else {
    if (g_isMultiplayer && !g_isGameOver) {
      resetIdleTimer();
      startIdleTimer();
      startMpAutoSaveTimer();
      // Fetch authoritative state from DB when tab becomes visible
      maybeSyncGameStateFromDB('visibility');
    }
    if (!g_isMultiplayer) {
      ensureLobbyConnection();
    }
  }
}
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('pagehide', function() {
  if (g_isMultiplayer) {
    saveMultiplayerSession();
  }
  if (g_idleTimer) {
    clearInterval(g_idleTimer);
    g_idleTimer = null;
  }
  stopMpAutoSaveTimer();
});
window.addEventListener('beforeunload', function() {
  if (g_isMultiplayer) {
    saveMultiplayerSession();
  }
});

// Sync from DB when network comes back online
window.addEventListener('online', function() {
  if (g_isMultiplayer && !g_isGameOver) {
    if (DEBUG) console.log('[DB] Network came online, syncing game state...');
    maybeSyncGameStateFromDB('online');
  }
});
window.addEventListener('pageshow', function(e) {
  if (e.persisted) {
    if (g_isMultiplayer && g_gameId && !g_isGameOver) {
      setTimeout(function() {
        if (!g_channelSubscribed && !g_channelSubscribing) {
          joinGameChannel(g_gameId, g_isHost, null, true);
        }
      }, 100);
    } else {
      ensureLobbyConnection();
    }
  }
});

// Clear cached board rects on resize so drag sync stays accurate across screen changes
window.addEventListener('resize', function() {
  g_cachedBoardRect = null;
  g_cachedLocalSourceRect = null;
});

function getOpponentDisplayName() {
  return (typeof g_opponentName !== 'undefined' && g_opponentName) ? g_opponentName : t('Opponent');
}

function updateGameInfoLabels() {
  var boardEl = el('board');
  if (boardEl) boardEl.className = g_isMultiplayer ? 'mp' : 'sp';

  const lblLast = document.getElementById('label-loscore');
  const lblTotal = document.getElementById('label-oscore');
  if (g_isMultiplayer && g_opponentName) {
    var name = getOpponentDisplayName();
    if (lblLast) lblLast.innerHTML = t('Opponent&rsquo;s last score:').replace('Opponent', name).replace('đối thủ', name);
    if (lblTotal) lblTotal.innerHTML = t('Opponent&rsquo;s total score:').replace('Opponent', name).replace('đối thủ', name);
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

  // Bonuses layout must stay disabled once a move has been played
  var elLayout = el('bonuseslayout');
  if (elLayout && typeof g_board_empty !== 'undefined' && !g_board_empty) {
    elLayout.disabled = true;
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
