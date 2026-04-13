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
let g_myName = localStorage.getItem('vietboard_player_name');
if (!g_myName) {
  fetch('https://randomuser.me/api/?inc=login')
    .then(r => r.json())
    .then(d => {
        g_myName = d.results[0].login.username;
        localStorage.setItem('vietboard_player_name', g_myName);
        var nameInput = document.getElementById('playerNameInput');
        if (nameInput) nameInput.value = g_myName;
    })
    .catch(e => { g_myName = 'Player_' + Math.floor(Math.random() * 10000); });
}
let g_channel = null; // Either lobby or game channel

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

window.addEventListener('load', function() {
  initSupabase();
});

// -----------------------------------------------------------------------------
// LOBBY & MATCHMAKING
// -----------------------------------------------------------------------------

window.showLobby = function() {
  // Save name
  localStorage.setItem('vietboard_player_name', g_myName);

  var html = '<div id="lobby" style="text-align:center;">';
  html += '<h2>Multiplayer Lobby</h2>';
  html += '<div style="margin-bottom: 10px;">';
  html += '<label>Your Name: </label>';
  html += '<input type="text" id="playerNameInput" value="' + g_myName + '" onchange="updatePlayerName(this.value)" />';
  html += '</div>';
  html += '<p>Click a player to start a game:</p>';
  html += '<div id="lobbyPlayers" style="min-height: 100px; border: 1px solid #ccc; padding: 10px; background: #fff;"><i>Loading...</i></div>';
  html += '</div>';

  g_bui.prompt(html, '<button class="button secondary" onclick="leaveLobby(); hideModal()">' + t('Close') + '</button>', 'lobby-modal wide');

  joinLobbyChannel();
}

window.updatePlayerName = function(newName) {
  g_myName = newName || 'Player_' + Math.floor(Math.random() * 10000);
  localStorage.setItem('vietboard_player_name', g_myName);
  // Rejoin to update presence name
  if (g_channel) {
    g_channel.track({ name: g_myName, lookingForGame: true });
  }
}

function joinLobbyChannel() {
  if (g_channel) g_channel.unsubscribe();

  const myUserId = 'user_' + Math.random().toString(36).substr(2, 9);

  g_channel = window.supabaseClient.channel('lobby', {
    config: {
      presence: {
        key: myUserId,
      },
    },
  });

  g_channel
    .on('presence', { event: 'sync' }, () => {
      const state = g_channel.presenceState();
      renderLobbyPlayers(state);
    })
    .on('broadcast', { event: 'invite' }, (payload) => {
      if (payload.payload.to === myUserId) {
         console.log('Received invite!', payload);
         startMultiplayerGame(payload.payload.gameId, payload.payload.fromName, false);
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await g_channel.track({ name: g_myName, lookingForGame: true, id: myUserId });
      }
    });
}

function renderLobbyPlayers(state) {
  const container = document.getElementById('lobbyPlayers');
  if (!container) return; // Modal closed

  let html = '';
  let count = 0;
  for (const id in state) {
    const user = state[id][0];
    // Don't show self
    if (user.name === g_myName) continue;
    if (!user.lookingForGame) continue;

    html += '<div style="padding:5px; margin: 5px 0; background: #eee; cursor: pointer; border-radius: 4px;" ';
    html += 'onclick="invitePlayer(\'' + id + '\', \'' + user.name.replace(/'/g, "\\'") + '\')">';
    html += '<strong>' + user.name + '</strong>';
    html += '</div>';
    count++;
  }

  if (count === 0) {
    html = '<p><i>No other players waiting.</i></p>';
  }
  container.innerHTML = html;
}

window.leaveLobby = function() {
  if (g_channel) {
    g_channel.unsubscribe();
    g_channel = null;
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
      // Use presence to detect disconnects and idle handling
    })
    .on('broadcast', { event: 'gamestate' }, (payload) => {
      handleGameStateBroadcast(payload.payload);
    })
    .on('broadcast', { event: 'move' }, (payload) => {
      handleMoveBroadcast(payload.payload);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await g_channel.track({ name: g_myName, isHost });
        if (isHost) {
          // Initialize game state and send it out
          setTimeout(() => initializeHostGame(), 500); // short delay to ensure opponent is connected
        }
      }
    });
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
    broadcastGameState({
      type: 'init',
      letpool: g_letpool,
      myRack: g_bui.getOpponentRack(), // What is opponent rack to us is their rack
      oppRack: g_bui.getPlayerRack(),
      hostGoesFirst: hostGoesFirst
    });
    updateTurnIndicator();
  }, 100);
}

function broadcastGameState(payload) {
  if (g_channel) {
    g_channel.send({
      type: 'broadcast',
      event: 'gamestate',
      payload: payload
    });
  }
}

function handleGameStateBroadcast(payload) {
  if (payload.type === 'init') {
    // Apply init state from host
    g_letpool = payload.letpool;
    g_bui.setPlayerRack(payload.myRack);
    g_bui.setOpponentRack(payload.oppRack);
    g_bui.setTilesLeft(g_letpool.length);
    g_isMyTurn = !payload.hostGoesFirst;
    updateTurnIndicator();
  }
}

function updateTurnIndicator() {
  // Add a visual indicator in the UI
  var playerDiv = document.getElementById('pscore').parentNode;
  var oppDiv = document.getElementById('oscore').parentNode;

  if (g_isMyTurn) {
    playerDiv.style.border = '2px solid green';
    oppDiv.style.border = 'none';
  } else {
    playerDiv.style.border = 'none';
    oppDiv.style.border = '2px solid red';
  }

  // Show opponent name if multiplayer
  if (g_isMultiplayer && g_opponentName) {
     var scoreOpponentName = document.querySelector('.score .score-opponent') || document.querySelector('.score-label-opponent');
     if (scoreOpponentName) scoreOpponentName.textContent = g_opponentName;
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
    rackAfter: g_bui.getPlayerRack(),
    letpool: g_letpool,
    boardEmpty: g_board_empty
  };

  g_isMyTurn = false;
  updateTurnIndicator();
  broadcastGameState(moveData);

  saveMultiplayerSession();
}

function handleMoveBroadcast(payload) {
  if (payload.type === 'move') {
    // Apply opponent's move
    if (!payload.passed) {
       // Render the board
       g_board = payload.board;
       g_boardpoints = payload.boardp;
       g_boardtypes = payload.boardt;
       g_board_empty = payload.boardEmpty;

       // Force redraw of board
       for (var y = 0; y < g_boardheight; ++y) {
         for (var x = 0; x < g_boardwidth; ++x) {
            var cell = el('b' + y + '_' + x);
            var char = g_board[y][x];
            if (char !== ' ' && cell.innerHTML === '') {
                var ltr = char === char.toLowerCase() ? '*' : char;
                var html = '<div class="drag t2">' + ltr + '<sub>' + g_letscore[ltr] + '</sub></div>';
                cell.innerHTML = html;
            }
         }
       }
       g_bui.makeTilesFixed();
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

    // Check if game over
    if (payload.rackAfter === '' && g_letpool.length === 0) {
      announceWinner();
    }

    saveMultiplayerSession();
  }
}


function saveMultiplayerSession() {
  if (g_isMultiplayer) {
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

// Broadcast cursor / tile drag
function hookRedipsDrag() {
  if (!g_bui || !g_bui.rd) return;

  const originalMoved = g_bui.rd.myhandler_moved;
  const originalDropped = g_bui.rd.myhandler_dropped;

  g_bui.rd.myhandler_moved = function(obj) {
    if (originalMoved) originalMoved(obj);

    if (g_isMultiplayer && g_isMyTurn) {
       // We don't send the real letter, just a face-down tile indicator.
       broadcastGameState({
         type: 'drag_start',
         id: obj.id || 'tile'
       });
    }
  };

  g_bui.rd.myhandler_dropped = function(targetCell) {
    if (originalDropped) originalDropped(targetCell);

    if (g_isMultiplayer && g_isMyTurn) {
       // Actually dropped isn't enough, we might want to sync the opponent's "face down" tile position
       // so they see the tile move into a square.
       var id = g_bui.rd.obj.id;
       var r = targetCell.parentNode.rowIndex;
       var c = targetCell.cellIndex;
       var isBoard = targetCell.id.startsWith('b');

       broadcastGameState({
         type: 'drag_drop',
         id: id,
         isBoard: isBoard,
         r: r,
         c: c
       });
    }
  };
}

// Add to handleGameStateBroadcast
const originalHandleMoveBroadcast = handleGameStateBroadcast;
handleGameStateBroadcast = function(payload) {
  originalHandleMoveBroadcast(payload);

  if (payload.type === 'drag_start') {
    // Show a face down tile moving or flashing
    var oppRack = document.getElementById('drag').querySelector('.opponent');
    if (oppRack) oppRack.style.opacity = '0.5';
  } else if (payload.type === 'drag_drop') {
    var oppRack = document.getElementById('drag').querySelector('.opponent');
    if (oppRack) oppRack.style.opacity = '1.0';

    if (payload.isBoard) {
       var cellId = 'b' + payload.r + '_' + payload.c;
       var cell = document.getElementById(cellId);
       if (cell && cell.innerHTML === '') {
           // Show a temporary face down tile on the board
           cell.innerHTML = '<div class="drag opponent-face-down" style="background:#555; width:100%; height:100%; border-radius:5px;"></div>';
       }
    }
  } else if (payload.type === 'move') {
    // Remove all face down temporary tiles before applying real move
    var boardDiv = document.getElementById('board');
    if (boardDiv) {
       var tempTiles = boardDiv.querySelectorAll('.opponent-face-down');
       tempTiles.forEach(t => t.remove());
    }
    handleMoveBroadcast(payload);
  }
};

window.addEventListener('appReady', function() {
   setTimeout(hookRedipsDrag, 500);
});

window.addEventListener('appReady', function() {
   // Check if we have a multiplayer session to resume
   if (localStorage['session_mp']) {
      try {
        var mpData = JSON.parse(localStorage['session_mp']);
        if (mpData && mpData.gameId) {
           console.log('Resuming multiplayer session...');

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
      g_bui.prompt(t('Warning: Opponent disconnected. Game will forfeit in 1 minute.'));
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
      g_bui.prompt(t('Warning: Game will end in 1 minute due to inactivity.'));
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

// Start the timer when game starts
const originalJoinGameChannel = joinGameChannel;
joinGameChannel = function(gameId, isHost) {
  originalJoinGameChannel(gameId, isHost);

  // Setup presence to detect if opponent leaves
  g_channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
     // If the opponent leaves, we start a stricter timer or rely on the idle timer
     console.log('Opponent left presence', leftPresences);
  });

  startIdleTimer();
};


// Add logic to track opponent presence
let g_opponentPresenceState = false;

// Modify the presence event listener inside joinGameChannel
const originalJoinGameChannel2 = joinGameChannel;
joinGameChannel = function(gameId, isHost) {
  originalJoinGameChannel2(gameId, isHost);

  g_channel.on('presence', { event: 'sync' }, () => {
     const state = g_channel.presenceState();

     let opponentFound = false;
     for (const id in state) {
       for (const p of state[id]) {
         if (p.name !== g_myName) opponentFound = true;
       }
     }

     g_opponentPresenceState = opponentFound;
  });
};
