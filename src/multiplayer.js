// Supabase integration for Vietboard Multiplayer

// Supabase details
const SUPABASE_URL = 'https://awolvbshyvcrsqwrbjxe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Oju2rh1kaNFcvlPfnssF7A_4YpvQKCH'; // Note: publishable key, safe for client-side

// We will load the Supabase client via unpkg in index.html
window.supabaseClient = null;

// Multiplayer state variables
let g_isMultiplayer = false;
let g_gameId = null;
let g_isMyTurn = false;
let g_opponentId = null;
let g_opponentName = null;
let g_lobbyUserId = null;
let g_myName = localStorage.getItem('player_name');
if (!g_myName) {
  g_myName = 'Generating...'; // Set temporary state

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
      console.warn('Failed to generate nickname.', response.status || '', '\nUsing fallback method...');
      sNickname = 'Player_' + sRandInt;
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
let g_opponentPresenceState = false;
let g_dragThrottleTimer = null;
let g_dragGhost = null;

// Timer state
let g_idleTimer = null;
let g_idleSeconds = 0;

function initSupabase() {
  if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error('Supabase library not loaded.');
  }
}

// Call init once the script loads, assuming supabase-js is loaded first.
// We will move this call or ensure script order in index.html.
window.addEventListener('load', initSupabase);

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
    <td class="input"><input id="lobby-name" value="${g_myName}" onchange="updatePlayerName(this.value)" onkeypress="if(event.key==='Enter') updatePlayerName(this.value)"></td>
  </tr>
</table>
<p><strong>${t('Click a player to start a game:')}</strong></p>
<div id="lobby-players">
  <em>${t('Loading...')}</em>
</div>
`;

  g_bui.prompt(html, `<button class="button" onclick="leaveLobby();hideModal()">${t('Close')}</button>`, 'lobby-modal wide');

  joinLobbyChannel();
}

window.updatePlayerName = async function(newName) {
  g_myName = newName || 'Player_' + Math.floor(Math.random() * 10000);
  localStorage.setItem('player_name', g_myName);
  if (DEBUG) console.log('updatePlayerName: setting to', g_myName);
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

  g_lobbyUserId = 'user_' + Math.random().toString(36).substr(2, 9);

  g_channel = window.supabaseClient.channel('lobby', {
    config: {
      presence: {
        key: g_lobbyUserId,
      },
    },
  });

  g_channel
    .on('presence', { event: 'sync' }, () => {
      if (DEBUG) console.log('Presence sync event received');
      const state = g_channel.presenceState();
      if (DEBUG) console.log('Presence state:', state);
      renderLobbyPlayers(state);
    })
    .on('presence', { event: 'join' }, (payload) => {
      if (DEBUG) console.log('Presence join event received:', payload);
      const state = g_channel.presenceState();
      renderLobbyPlayers(state);
    })
    .on('presence', { event: 'update' }, (payload) => {
      if (DEBUG) console.log('Presence update event received:', payload);
      const state = g_channel.presenceState();
      renderLobbyPlayers(state);
    })
    .on('presence', { event: 'leave' }, (payload) => {
      if (DEBUG) console.log('Presence leave event received:', payload);
      const state = g_channel.presenceState();
      renderLobbyPlayers(state);
    })
    .on('broadcast', { event: 'invite' }, (payload) => {
      if (payload.payload.to === g_lobbyUserId) {
        if (DEBUG) console.log('Received invite!', payload);
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
    const user = state[id][0];
    if (!user) continue; // Skip if user data is undefined/null
    if (DEBUG) console.log('Checking user id:', id, 'user:', user);
    // Don't show self. User name can change, so rely on presence key.
    if (id === g_lobbyUserId || user.id === g_lobbyUserId) {
      if (DEBUG) console.log('Skipping self:', id);
      continue;
    }
    if (!user.lookingForGame) continue;

    const safeName = user.name.replace(/'/g, "\\'");
    html += `
<div class="lobby-player" onclick="invitePlayer('${id}','${safeName}')">
  <strong>${user.name}</strong>
</div>
`;
    count++;
  }

  if (count === 0) html = '<em>No other players waiting.</em>';
  container.innerHTML = html;
}

window.leaveLobby = function() {
  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
  }
  g_lobbyUserId = null;
  if (g_dragGhost) {
    g_dragGhost.remove();
    g_dragGhost = null;
  }
}

window.invitePlayer = function(opponentId, opponentName) {
  // To keep it simple, we just start a game instantly using a deterministic game ID based on the two IDs.
  // Actually, random UUID is safer. We will broadcast a "start_game" message to the lobby.
  const newGameId = 'game_' + Math.random().toString(36).substr(2, 9);

  // We send a directed broadcast to that user in the lobby
  g_channel.send({
    type: 'broadcast',
    event: 'invite',
    payload: {
      to: opponentId,
      fromName: g_myName,
      gameId: newGameId
    }
  });

  // And start our side
  startMultiplayerGame(newGameId, opponentName, true);
}

// Listen for invites in the lobby
function setupLobbyInviteListener() {
  // We need to attach this when joining the lobby
}

// Mock translation function fallback if not defined
if (typeof t !== 'function') {
  window.t = function(str) { return str; };
}

function startMultiplayerGame(gameId, opponentName, isHost) {
  g_gameId = gameId;
  g_opponentName = opponentName;
  g_isMultiplayer = true;
  localStorage['session_mode'] = 'mp';

  leaveLobby();
  hideModal();

  // Connect to game channel
  joinGameChannel(gameId, isHost);
}

function joinGameChannel(gameId, isHost) {
  g_channel = window.supabaseClient.channel('game:' + gameId, {
    config: {
      presence: {
        key: g_myName,
      },
    },
  });

  g_channel
    .on('presence', { event: 'sync' }, () => {
      const state = g_channel.presenceState();
      let opponentFound = false;
      for (const id in state) {
        for (const p of state[id]) {
          if (p.name !== g_myName) opponentFound = true;
        }
      }
      g_opponentPresenceState = opponentFound;
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
        await g_channel.track({ name: g_myName, isHost });
        startIdleTimer();
        if (isHost) {
          // Initialize game state and send it out
          setTimeout(() => initializeHostGame(), 500); // short delay to ensure opponent is connected
        }
      }
    });
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

function initializeHostGame() {
  // Coin flip for turn
  const hostGoesFirst = Math.random() < 0.5;
  g_isMyTurn = hostGoesFirst;

  // Set up board empty, etc. (done by init('board'))
  // But we need to sync g_letpool and the initial racks

  // Call restart without prompting
  g_bui.restart(true);

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

    broadcastGameState({
      type: 'init',
      letpool: g_letpool,
      myRack: oppRack, // What is opponent rack to us is their rack
      oppRack: myRack,
      hostGoesFirst: hostGoesFirst
    });
    saveMultiplayerSession();
    updateTurnIndicator();
    updateGameInfoLabels();
  }, 100);
}

function broadcastGameState(payload) {
  if (g_channel) {
    const eventName = (payload && payload.type === 'move') ? 'move' : 'gamestate';
    g_channel.send({
      type: 'broadcast',
      event: eventName,
      payload: payload
    });
  }
}

function sendDragPosition(x, y) {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;
  if (g_dragThrottleTimer) return;

  g_dragThrottleTimer = setTimeout(function() {
    g_dragThrottleTimer = null;
  }, 50);

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: {
      x: x,
      y: y
    }
  });
}

function sendDragEnd() {
  if (!g_isMultiplayer || !g_channel || !g_isMyTurn) return;

  g_channel.send({
    type: 'broadcast',
    event: 'drag',
    payload: {
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
  var fromCell = el(payload.fromId);
  var toCell = el(payload.toId);

  if (payload.fromId && payload.fromId.charAt(0) === 'b' && fromCell) {
    fromCell.innerHTML = '';
  }

  if (!toCell) return;

  if (payload.toId && payload.toId.charAt(0) === 'b') {
    renderOpponentBoardTile(toCell, payload.letter, payload.points);
  } else if (payload.toId && payload.toId.indexOf('op') === 0) {
    renderOpponentRackTileBack(toCell);
  }
}

function applyDragSourceClear(payload) {
  if (!payload || !payload.sourceId) return;
  if (payload.sourceId.charAt(0) !== 'b') return;

  var sourceCell = el(payload.sourceId);
  if (sourceCell) sourceCell.innerHTML = '';
}

function handleDragBroadcast(payload) {
  if (!g_isMultiplayer || !payload) return;

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
  g_dragGhost.style.left = payload.x + 'px';
  g_dragGhost.style.top = payload.y + 'px';
}

function handleGameStateBroadcast(payload) {
  if (payload.type === 'init') {
    // Apply init state from host
    g_letpool = payload.letpool;
    g_bui.setPlayerRack(payload.myRack);
    g_bui.setOpponentRack(payload.oppRack);
    g_bui.setTilesLeft(g_letpool.length);
    g_isMyTurn = !payload.hostGoesFirst;
    localStorage['session_mode'] = 'mp';
    saveMultiplayerSession();
    updateTurnIndicator();
    updateGameInfoLabels();
  } else if (payload.type === 'shuffle') {
    g_bui.setOpponentRack(payload.rack || '');
  } else if (payload.type === 'highscores_sync') {
    if (payload.highscores) {
      g_highscores = payload.highscores;
      localStorage['highscores'] = JSON.stringify(g_highscores);
    }
  }
}

function updateTurnIndicator() {
  // Disable game buttons (Play, Clear, Swap, Pass) when opponent's turn
  document.querySelectorAll('#drag .button').forEach((button) => {
    button.disabled = !g_isMyTurn;
  });

  // Disable lobby when in multiplayer game, enable when not
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
    pinfo = checkValidPlacement(g_bui.getPlayerPlacement());
    pstr = pinfo.played;

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
    boardEmpty: g_board_empty
  };

  g_isMyTurn = false;
  updateTurnIndicator();
  updateGameInfoLabels();
  broadcastGameState(moveData);

  saveMultiplayerSession();
}

function handleMoveBroadcast(payload) {
  if (payload.type === 'move') {
    // Apply opponent's move
    if (!payload.passed) {
      // Diff against previous board before applying the new payload board
      var prevBoard = g_board;

      var diffWord = [];
      for (var y = 0; y < g_boardheight; ++y) {
        for (var x = 0; x < g_boardwidth; ++x) {
          var charBefore = prevBoard[y][x];
          var charAfter = payload.board[y][x];
          if (charAfter !== ' ' && charBefore === ' ') {
            var ltr = charAfter === charAfter.toLowerCase() ? '*' : charAfter;
            diffWord.push([y, x, charAfter, g_letscore[ltr]]);
          }
        }
      }

      g_board = payload.board;
      g_boardpoints = payload.boardp;
      g_boardtypes = payload.boardt;
      g_board_empty = payload.boardEmpty;

      if (diffWord.length > 0) {
        // We need to restore the opponent rack temporarily so placeOnBoard can steal tiles from it
        g_bui.setOpponentRack(payload.rackBefore || '');

        placeOnBoard(diffWord, function() {
          g_bui.setOpponentRack(payload.rackAfter);
          g_oscore += payload.score;
          g_bui.setOpponentScore(payload.score, g_oscore);
          g_letpool = payload.letpool;
          g_bui.setTilesLeft(g_letpool.length);

          var elStatus = el('status');
          elStatus.innerHTML = t('Opponent') + ' ' + t('scored ') + payload.score;

          g_isMyTurn = true;
          updateTurnIndicator();

          if (payload.rackAfter === '' && g_letpool.length === 0) {
            announceWinner();
          }
          saveMultiplayerSession();
        });

        // Skip the rest of the synchronous updates because they are handled in the callback
        return;
      } else {
        for (var y = 0; y < g_boardheight; ++y) {
          for (var x = 0; x < g_boardwidth; ++x) {
            var cell = el('b' + y + '_' + x);
            var char = g_board[y][x];
            if (char !== ' ' && cell && cell.innerHTML === '') {
              var ltr = char === char.toLowerCase() ? '*' : char;
              var tClass = g_boardtypes[y][x] === 1 ? 't2' : 't1';
              var html = '<div class="drag ' + tClass + '">' + ltr + '<sub>' + g_letscore[ltr] + '</sub></div>';
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
    g_letpool = payload.letpool;
    g_bui.setTilesLeft(g_letpool.length);

    if (!payload.passed) {
      var elStatus = el('status');
      elStatus.innerHTML = t('Opponent') + ' ' + t('scored ') + payload.score;
    }

    g_isMyTurn = true;
    updateTurnIndicator();
    updateGameInfoLabels();

    // Check if game over
    if (payload.rackAfter === '' && g_letpool.length === 0) {
      announceWinner();
    }

    saveMultiplayerSession();
  }
}

function saveMultiplayerSession() {
  if (g_isMultiplayer) {
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
      boardEmpty: g_board_empty
    });
  }
}

window.addEventListener('appReady', function() {
  // Check if we have a multiplayer session to resume
  if (localStorage['session_mp']) {
    try {
      var mpData = JSON.parse(localStorage['session_mp']);
      if (mpData && mpData.gameId) {
        if (DEBUG) console.log('Resuming multiplayer session...');

        g_gameId = mpData.gameId;
        g_opponentName = mpData.opponentName;
        g_isMultiplayer = true;
        g_isMyTurn = mpData.isMyTurn;
        g_letpool = mpData.letpool;
        g_pscore = mpData.pscore;
        g_oscore = mpData.oscore;
        g_board = mpData.board;
        g_boardpoints = mpData.boardp;
        g_boardtypes = mpData.boardt;
        g_board_empty = mpData.boardEmpty;

        // Apply board
        setTimeout(() => {
          g_bui.setPlayerRack(mpData.myRack);
          g_bui.setOpponentRack(mpData.oppRack);
          g_bui.setPlayerScore(0, g_pscore);
          g_bui.setOpponentScore(0, g_oscore);
          g_bui.setTilesLeft(g_letpool.length);

          for (var y = 0; y < g_boardheight; ++y) {
            for (var x = 0; x < g_boardwidth; ++x) {
              var cell = el('b' + y + '_' + x);
              var char = g_board[y][x];
              if (char !== ' ' && cell && cell.innerHTML === '') {
                var ltr = char === char.toLowerCase() ? '*' : char;
                var tClass = g_boardtypes[y][x] === 1 ? 't1' : 't2';
                var html = '<div class="drag ' + tClass + '">' + ltr + '<sub>' + g_letscore[ltr] + '</sub></div>';
                cell.innerHTML = html;
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
      isMyTurn: !g_isMyTurn
    });
  } else if (payload.type === 'state_sync') {
    // We received a sync from the other player
    g_board = payload.board;
    g_boardpoints = payload.boardp;
    g_boardtypes = payload.boardt;
    g_board_empty = payload.boardEmpty;
    g_pscore = payload.pscore;
    g_oscore = payload.oscore;
    g_letpool = payload.letpool;
    g_isMyTurn = payload.isMyTurn;

    g_bui.setPlayerRack(payload.myRack);
    g_bui.setOpponentRack(payload.oppRack);
    g_bui.setPlayerScore(0, g_pscore);
    g_bui.setOpponentScore(0, g_oscore);
    g_bui.setTilesLeft(g_letpool.length);

    for (var y = 0; y < g_boardheight; ++y) {
      for (var x = 0; x < g_boardwidth; ++x) {
        var cell = el('b' + y + '_' + x);
        var char = g_board[y][x];
        if (char !== ' ' && cell && cell.innerHTML === '') {
          var ltr = char === char.toLowerCase() ? '*' : char;
          var tClass = g_boardtypes[y][x] === 1 ? 't2' : 't1';
          var html = '<div class="drag ' + tClass + '">' + ltr + '<sub>' + g_letscore[ltr] + '</sub></div>';
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

  let opponentDisconnectSeconds = 0;

  g_idleTimer = setInterval(() => {
    if (!g_isMultiplayer) return;

    // Check if opponent is missing
    if (!g_opponentPresenceState && g_opponentName) {
      opponentDisconnectSeconds++;
    } else {
      opponentDisconnectSeconds = 0;
    }

    // If opponent is missing for 5 minutes, forfeit game
    if (opponentDisconnectSeconds === 240) {
      g_bui.prompt(t('WARNING: Opponent disconnected. Game will forfeit in 1 minute.'));
    }

    if (opponentDisconnectSeconds >= 290 && opponentDisconnectSeconds <= 300) {
      var timeLeft = 300 - opponentDisconnectSeconds;
      var statusEl = document.getElementById('status');
      if (statusEl) statusEl.innerHTML = '<span style="color:red">Opponent forfeits in ' + timeLeft + 's...</span>';
    }

    if (opponentDisconnectSeconds >= 300) {
      clearInterval(g_idleTimer);
      g_bui.prompt(t('Opponent forfeited due to disconnection.'));
      announceWinner();
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
      if (statusEl) statusEl.innerHTML = '<span style="color:red">Game ends in ' + timeLeft + 's...</span>';
    }

    if (g_idleSeconds >= 300) {
      clearInterval(g_idleTimer);
      announceWinner();
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
  broadcastGameState({
    type: 'highscores_sync',
    highscores: g_highscores
  });
}
