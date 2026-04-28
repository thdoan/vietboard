// Assumptions:
// 1. redipsdrag.js has already been included
// 2. g_boardm exists and its init method returns the bonus layout (defined in bonuses.js)

// Debounce window resizing
function debounce(fn) {
  var nTimer;
  return function() {
    var that = this,
      aArgs = arguments,
      delayed = function() {
        fn.apply(that, aArgs);
        this['debounced'] = undefined;
      };
    clearTimeout(nTimer);
    nTimer = setTimeout(delayed, 100);
    if (this['debounced']) {
      clearTimeout(nTimer);
      fn.apply(this, aArgs);
      this['debounced'] = undefined;
    } else {
      this['debounced'] = true;
    }
  };
}

// Get element
function el(id) {
  return document.getElementById(id) || document.querySelector(id);
}

// Native JavaScript JSONP implementation
function getJsonp(sUrl, callback) {
  // Insert script tag to load external JS containing padded JSON
  var oJson,
    nTimestamp = Date.now(),
    sCallback = 'handleJsonp' + nTimestamp,
    sId = 'getjson-' + nTimestamp,
    cleanUp = function() {
      el(sId).remove();
      delete window[sCallback];
    },
    js = document.createElement('script');
  js.id = sId;
  js.src = sUrl.replace(/=\?/, '=' + sCallback);
  js.onload = function() {
    if (typeof callback === 'function') callback(oJson);
    cleanUp();
  };
  js.onerror = function() {
    console.warn('Error retrieving data from ' + sUrl);
    cleanUp();
  };
  window[sCallback] = function(o) {
    oJson = o;
  };
  document.head.appendChild(js);
}

// Return a random float between nMin and nMax with nDecimals (inclusive)
function randFloat(nMin, nMax, nDecimals) {
  return parseFloat(Math.min(nMin + (Math.random() * (nMax - nMin)), nMax).toFixed(nDecimals || 0));
}

// Return a random integer between nMin and nMax (inclusive)
function randInt(nMin, nMax) {
  return Math.floor(Math.random() * (nMax - nMin + 1) + nMin);
}

// Set language
function setLang(sLang) {
  if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && typeof saveMultiplayerSession === 'function') {
    saveMultiplayerSession();
    localStorage['session_mode'] = 'mp';
  } else if (typeof getSession === 'function') {
    localStorage['session'] = getSession();
    localStorage['session_mode'] = 'sp';
  }

  localStorage['lang'] = sLang;
  // GA
  gtag('event', sLang, {
    'event_category': 'Language'
  });
  location.reload();
}

// Set bonuses layout
function setLayout(elSelect) {
  g_layout = elSelect.value;
  localStorage['layout'] = elSelect.value;

  if (typeof g_board_empty !== 'undefined' && g_board_empty) {
    // Pre-first-move: apply live without reload (both SP and MP)
    if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer) {
      if (typeof broadcastGameState === 'function') {
        broadcastGameState({ type: 'layout', layout: g_layout, fromId: g_lobbyUserId });
      }
      if (typeof saveMultiplayerSession === 'function') {
        saveMultiplayerSession();
        localStorage['session_mode'] = 'mp';
      }
    } else if (typeof getSession === 'function') {
      localStorage['session'] = getSession();
      localStorage['session_mode'] = 'sp';
    }
    if (typeof applyLayout === 'function') applyLayout(g_layout);
  } else {
    // Post-first-move: reload required
    if (typeof saveMultiplayerSession === 'function') {
      saveMultiplayerSession();
      localStorage['session_mode'] = 'mp';
    } else if (typeof getSession === 'function') {
      localStorage['session'] = getSession();
      localStorage['session_mode'] = 'sp';
    }
    location.reload();
  }
  if (g_isMobile) hideGameInfo();

  // GA
  gtag('event', elSelect.value, {
    'event_category': 'Bonuses Layout'
  });
}

// Apply a new bonus layout to the existing board without reload
function applyLayout(layout) {
  if (typeof g_boardm === 'undefined' || !g_boardm.init) return;

  // Regenerate bonus multipliers (updates g_boardmults globally)
  g_boardm.init(g_boardwidth, g_boardheight, layout);

  // Keep g_bui's reference in sync
  if (g_bui) g_bui.boardm = g_boardm.boardm;

  var mults = ['', 'DL', 'TL', 'DW', 'TW'];
  var st = g_bui ? g_bui.getStartXY() : { x: Math.floor(g_boardwidth / 2), y: Math.floor(g_boardheight / 2) };

  for (var i = 0; i < g_boardheight; ++i) {
    for (var j = 0; j < g_boardwidth; ++j) {
      var cell = el('c' + j + '_' + i);
      if (!cell || (cell.holds && cell.holds !== '')) continue; // Skip occupied cells

      var mult = (j === st.x && i === st.y) ? 'ST' : mults[g_boardmults[j][i]] || '';
      cell.className = mult;
    }
  }

  // Update <select> element to reflect new selection
  var sel = el('bonuseslayout');
  if (sel) {
    var sLayout = g_layouts.indexOf(layout) > -1 ? layout : t('Default');
    var html = '<option' + (sLayout === t('Default') ? ' value="default"' : '') + '>' + sLayout + '</option>';
    if (sLayout !== t('Default')) html += '<option value="default">' + t('Default') + '</option>';
    for (var i = 0; i < g_layouts.length; ++i) {
      if (g_layouts[i] === sLayout) continue;
      html += '<option>' + g_layouts[i] + '</option>';
    }
    sel.innerHTML = html;
    sel.title = sLayout;
  }
}

// Set tileset
function setTileset(elSelect) {
  g_tileset = elSelect.value;
  localStorage['tileset'] = elSelect.value;

  if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && typeof saveMultiplayerSession === 'function') {
    saveMultiplayerSession();
    localStorage['session_mode'] = 'mp';
  } else if (typeof getSession === 'function') {
    localStorage['session'] = getSession();
    localStorage['session_mode'] = 'sp';
  }
  // GA
  gtag('event', elSelect.value, {
    'event_category': 'Tileset'
  });

  // Apply new font without reloading
  var sFamily = g_tilesets.indexOf(g_tileset) > -1 ? g_tileset : 'Maven+Pro:wght@500';
  var link = document.getElementById('tileset-font-link');
  var style = document.getElementById('tileset-font-style');
  if (link) link.href = 'https://fonts.googleapis.com/css2?family=' + sFamily + '&display=swap';
  if (style) style.textContent = '.drag{font-family:\'' + (sFamily.indexOf('Maven')===0 ? 'Maven Pro' : sFamily) + '\', Arial, sans-serif}';

  if (g_isMobile) hideGameInfo();
}

// Toggle game info screen on mobile
function showGameInfo() {
  document.documentElement.classList.add('gameinfo');
}
function hideGameInfo() {
  document.documentElement.classList.remove('gameinfo');
}

// Modal functions
function showModal(sHtml, sClass) {
  if (g_bui && g_bui.hideBusy) g_bui.hideBusy();
  if (sClass) g_cache['modalContainer'].className = sClass;
  g_cache['modalContent'].innerHTML = sHtml;
  g_cache['modalMask'].style.display = 'block';
  g_cache['modalContainer'].style.display = 'block';
  setModalHeight();
  setTimeout(function() {
    // Autofocus on first input or button
    var elControl = g_cache['modalContent'].querySelector('input, button');
    if (elControl) elControl.focus();
    g_cache['modalMask'].classList.add('on');
    g_cache['modalContainer'].classList.add('on');
  }, 0);
  // Set focus trap
  [].forEach.call(g_cache['app'].querySelectorAll('a[href], button'), function(el) {
    el.tabIndex = -1;
  });
}
function hideModal() {
  if (g_bui && g_bui.hideBusy) g_bui.hideBusy();
  g_cache['modalContainer'].classList.remove('on');
  g_cache['modalMask'].classList.remove('on');
  g_bui.timer = setTimeout(function() {
    g_cache['modalContainer'].style.display = 'none';
    g_cache['modalMask'].style.display = 'none';
    g_cache['modalContent'].style.height = '';
    g_cache['modalContainer'].removeAttribute('class');
  }, 300); // Sync with transition time
  // Remove focus trap
  [].forEach.call(g_cache['app'].querySelectorAll('a[href], button'), function(el) {
    el.tabIndex = 0;
  });
}

function getToastContainer() {
  if (!g_cache) return null;
  if (!g_cache['toastContainer']) {
    var container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    g_cache['toastContainer'] = container;
  }
  return g_cache['toastContainer'];
}

function setModalHeight() {
  if (!g_cache['modalContainer'].offsetHeight) return;
  setTimeout(function() {
    g_cache['modalContent'].style.height = '';
    g_cache['modalContent'].style.height = g_cache['modalContainer'].clientHeight + 'px';
  }, 50);
}

// Session functions
function getSession() {
  var oSession = {
    'id': 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    'board': g_board,
    'boardp': g_boardpoints,
    'boardt': g_boardtypes,
    'empty': g_board_empty,
    'hcount': g_bui.hcount,
    'history': g_history,
    'layout': g_layout,
    'letpool': g_letpool,
    'letscore': g_letscore,
    'level': g_bui.level,
    'loscore': el('loscore').textContent,
    'lpscore': el('lpscore').textContent,
    'orack': g_bui.getOpponentRack(),
    'oscore': g_oscore,
    'prack': g_bui.getPlayerRack(),
    'pscore': g_pscore,
    'passes': g_passes
  };
  return JSON.stringify(oSession);
}
function load(sSession, isHighScore) {
  var oSession = JSON.parse(sSession);
  g_board = oSession['board'];
  g_boardpoints = oSession['boardp'];
  g_boardtypes = oSession['boardt'];
  g_history = oSession['history'];
  g_layout = oSession['layout'];
  g_letpool = oSession['letpool'];
  g_letscore = oSession['letscore'];
  g_playlevel = oSession['level'] - 1;
  g_bui.level = oSession['level'];
  g_passes = oSession['passes'];
  g_board_empty = oSession['empty'];
  g_bui.create('board', g_boardwidth, g_boardheight, g_letscore, g_racksize, g_layout, isHighScore);
  g_bui.setOpponentRack(oSession['orack']);
  g_bui.setPlayerRack(oSession['prack']);
  g_matches_cache = {};
  g_opponent_has_joker = oSession['orack'].indexOf('*') > -1;
  var html = '<table>';
  for (var i = 0; i < g_history.length; ++i) {
    var entry = g_history[i];
    html += g_bui.renderWordPlayed(entry[0], entry[1]);
  }
  html += '</table>';
  el('history').innerHTML = html;
  g_bui.hlines = html;
  g_bui.hcount = oSession['hcount'];
  g_oscore = oSession['oscore'];
  g_bui.setOpponentScore(oSession['loscore'], g_oscore);
  g_pscore = oSession['pscore'];
  g_bui.setPlayerScore(oSession['lpscore'], g_pscore);
  g_bui.setTilesLeft(g_letpool.length);
  g_bui.makeTilesFixed();
  if (isHighScore) {
    g_bui.fixPlayerTiles();
    hideModal();
    if (g_isMobile) hideGameInfo();
  }
}
async function loadHighScore(sKey, nIndex) {
  if (typeof g_loadingHighScore !== 'undefined' && g_loadingHighScore) return;
  g_loadingHighScore = true;

  if (!localStorage['session']) localStorage['session'] = getSession();
  var entry = g_highscores[sKey] && g_highscores[sKey][nIndex];
  if (!entry) {
    g_loadingHighScore = false;
    return;
  }

  // Local session available
  if (entry.session) {
    g_bui.created = false;
    load(entry.session, true);
    g_loadingHighScore = false;
    return;
  }

  var sessionId = entry.sessionId;
  if (!sessionId) {
    g_bui.toast(t('Session not available'), 3000);
    g_loadingHighScore = false;
    return;
  }

  // Check local cloud cache
  var cache = localStorage['cloud_sessions'] ? JSON.parse(localStorage['cloud_sessions']) : {};
  if (cache[sessionId]) {
    entry.session = cache[sessionId];
    localStorage['highscores'] = JSON.stringify(g_highscores);
    g_bui.created = false;
    load(cache[sessionId], true);
    g_loadingHighScore = false;
    return;
  }

  // Fetch from Supabase
  var toast = g_bui.toast(t('Loading...'), 0);
  var sessionData = await loadSessionFromCloud(sessionId);

  if (sessionData) {
    toast.classList.remove('show');
    toast.classList.add('hide');
    cache[sessionId] = sessionData;
    localStorage['cloud_sessions'] = JSON.stringify(cache);
    entry.session = sessionData;
    localStorage['highscores'] = JSON.stringify(g_highscores);
    g_bui.created = false;
    load(sessionData, true);
  } else {
    // Reuse the same toast div to avoid stacking
    toast.textContent = t('Unable to load session');
    if (toast._toastTimeout) clearTimeout(toast._toastTimeout);
    toast._toastTimeout = setTimeout(function() {
      toast.classList.remove('show');
      toast.classList.add('hide');
    }, 3000);
  }
  g_loadingHighScore = false;
}

// Main UI logic
function RedipsUI() {
  var self = this;

  self.created = false;
  //self.racksize = 7;
  self.plrRackId = 'pl';
  self.oppRackId = 'op';
  self.boardId = 'c';
  self.newplays = {};
  self.racks = [];
  self.racks[1] = [];
  self.racks[2] = [];
  self.firstrack = true;
  //self.cellbg = '#e0e0b0';
  self.level = localStorage['level'] || 1; // Playing level
  self.hlines = '';    // Play history lines
  self.hcount = 0;     // Play history count
  self.showOpRack = 1; // 0=hidden, 1=visible

  self.acceptPlayerPlacement = function() {
    self.newplays = {};
    self.makeTilesFixed();
  };

  self.addToHistory = function(words, player) {
    //console.log('addToHistory', words);
    if (player !== 1 && player !== 2) player = 1;
    player = player - 1;
    ++self.hcount;
    var html = '<table>';
    for (var i = 0; i < words.length; ++i) {
      var word = words[i];
      html += self.renderWordPlayed(word, player);
      g_history.push([word, player]);
    }
    html += '</table>';
    self.hlines += html;
    var div = el('history');
    div.innerHTML = self.hlines;
    div.scrollTop = self.hcount * 100;

    // GA and update scoreboard
    if (words.length > 0) {
      var elStatus = el('status');
      elStatus.classList.add('transition'); // 100ms
      // Delay required to get actual score
      clearTimeout(elStatus['updateTimeout']);
      elStatus['updateTimeout'] = setTimeout(function() {
        elStatus.classList.remove('marquee');
        if (player === 0) {
          elStatus.textContent = t('You') + ' ' + t('scored ') + el('lpscore').textContent + ' ' + t(' points for ') + words.join(', ').toUpperCase();
          gtag('event', 'Player Move', {
            'event_category': 'Gameplay - Lvl ' + (g_playlevel + 1),
            'event_label': words.join(', '),
            'value': +el('lpscore').textContent
          });
        } else {
          var isMP = (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer);
          var opponentNoun = isMP ? t('Opponent') : t('Computer');
          elStatus.textContent = opponentNoun + ' ' + t('scored ') + el('loscore').textContent + ' ' + t(' points for ') + words.join(', ').toUpperCase();
          gtag('event', (isMP ? 'Opponent' : 'Computer') + ' Move', {
            'event_category': 'Gameplay - Lvl ' + (g_playlevel + 1),
            'event_label': words.join(', '),
            'value': +el('loscore').textContent
          });
        }
        clearTimeout(elStatus['delayTimeout']);
        elStatus['delayTimeout'] = setTimeout(function() {
          startMarquee(elStatus);
        }, 3000);
        elStatus.classList.remove('transition');
      }, 100);
    }
  };

  self.animDone = function() {
    --self.animTiles;
    self.playSound();
    //console.log('Animations left: ' + self.animTiles);
    if (self.animTiles === 0) {
      // Last opponent tile animated to its position; return original
      // show/hide state of tiles set to visible before animation.
      /*
      if (self.showOpRack === 0) {
        for (var i = 0; i < self.displayedcells.length; ++i) {
          //self.displayedcells[i].style.display = 'none';
        }
      }
      */
      self.animCallback();
    }
  };

  self.cancelPlayerPlacement = function(cellId) {
    var placement = self.getPlayerPlacement();
    var tileInfos = [];
    var id;
    for (var i = 0; i < placement.length; ++i) {
      id = placement[i].id;
      if (cellId && cellId !== id) continue;
      var cell = el(id);
      tileInfos.push({
        div: cell.firstChild,
        sourceId: id
      });
      cell.holds = '';
      cell.innerHTML = '';

      if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && typeof sendDragSourceClear === 'function') {
        sendDragSourceClear(id);
      }
    }
    if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && typeof sendDragEnd === 'function') {
      sendDragEnd();
    }
    var count = 0;
    for (var i = 0; i < self.racksize; ++i) {
      id = self.plrRackId + i;
      var rcell = el(id);
      if (rcell.holds === '' && count < tileInfos.length) {
        var info = tileInfos[count++];
        var div = info.div;
        // Joker tile - remove previously selected letter from tile?
        if (div.holds.points === 0) div.innerHTML = '&nbsp;&nbsp;';
        rcell.appendChild(div);
        rcell.holds = self.hcopy(div.holds);

        if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer && typeof sendDragPreview === 'function') {
          sendDragPreview(info.sourceId, id, rcell.holds);
        }
      }
    }
    if (cellId) delete self.newplays[cellId];
    else self.newplays = {};
    if (Object.keys(self.newplays).length === 0) {
      el('clear').textContent = t('Shuffle');
      el('clear').onclick = onPlayerShuffle;
    }
  };

  self.create = function(iddiv, bx, by, scores, racksize, layout, isHighScore) {
    if (self.created) return;
    self.boardm = g_boardm.init(bx, by, layout);

    var arrow = '<picture><source type="image/webp" srcset="pics/arrow.webp"><img src="pics/arrow.png" width="22" height="22" alt=""></picture>';
    var hr = '<tr class="ruler"><td colspan="2"></td></tr>';

    g_cache['html'].miscBtns = `
<div class="button-container icons">
  <!-- Icons source: https://www.streamlinehq.com/ -->
  <span title="${t('Multiplayer Lobby')}">
    <button id="lobby" class="icon" onclick="g_bui.showLobby()">
      <svg fill="none" viewBox="0 0 24 24">
        <path fill="#c2f3ff" d="M18.2181 7.19451c0.0004 0.81911 -0.1606 1.63028 -0.4737 2.38719 -0.3131 0.7569 -0.7723 1.4447 -1.3511 2.0242 -0.579 0.5794 -1.2664 1.0392 -2.023 1.3531 -0.7566 0.3137 -1.5676 0.4755 -2.3868 0.4758 -1.6623 -0.0277 -3.24635 -0.7107 -4.40752 -1.9006 -1.16116 -1.1898 -1.80543 -2.79008 -1.79259 -4.45256 0.00064 -1.58962 0.62386 -3.11578 1.73613 -4.25147 1.11226 -1.13568 2.62508 -1.79056 4.21438 -1.82432 0.0899 -0.00574 0.1788 -0.00574 0.2668 -0.00574 0.816 -0.004803 1.6247 0.15198 2.3797 0.46129 0.7549 0.30932 1.4412 0.76504 2.0193 1.3409 0.578 0.57586 1.0363 1.26045 1.3484 2.0143 0.312 0.75384 0.4718 1.56201 0.47 2.37791Z" stroke-width="1"></path>
        <path fill="#66e1ff" d="M11.9835 9.97699c-1.3592 -0.01698 -2.67587 -0.47651 -3.75048 -1.30896 -1.07462 -0.83246 -1.84863 -1.99248 -2.20479 -3.30432 -0.16254 0.55947 -0.24498 1.13913 -0.24487 1.72173 -0.01182 1.66182 0.63289 3.26116 1.79395 4.45006 1.16106 1.1891 2.74449 1.8716 4.40619 1.8993 0.9672 0.0007 1.9213 -0.2239 2.7867 -0.6559 0.8654 -0.432 1.6183 -1.0595 2.1992 -1.8329 0.5808 -0.7733 0.9738 -1.67129 1.1475 -2.62277 0.1737 -0.95149 0.1236 -1.93035 -0.1466 -2.85909 -0.3731 1.29991 -1.159 2.44317 -2.239 3.25724 -1.0799 0.81407 -2.3954 1.25478 -3.7478 1.25561Z" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M18.2181 7.19451c0.0004 0.81911 -0.1606 1.63028 -0.4737 2.38719 -0.3131 0.7569 -0.7723 1.4447 -1.3511 2.0242 -0.579 0.5794 -1.2664 1.0392 -2.023 1.3531 -0.7566 0.3137 -1.5676 0.4755 -2.3868 0.4758 -1.6623 -0.0277 -3.24635 -0.7107 -4.40752 -1.9006 -1.16116 -1.1898 -1.80543 -2.79008 -1.79259 -4.45256 0.00064 -1.58962 0.62386 -3.11578 1.73613 -4.25147 1.11226 -1.13568 2.62508 -1.79056 4.21438 -1.82432 0.0899 -0.00574 0.1788 -0.00574 0.2668 -0.00574 0.816 -0.004803 1.6247 0.15198 2.3797 0.46129 0.7549 0.30932 1.4412 0.76504 2.0193 1.3409 0.578 0.57586 1.0363 1.26045 1.3484 2.0143 0.312 0.75384 0.4718 1.56201 0.47 2.37791Z" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M11.7322 1.00583c-3.2445 3.51424 -3.2445 8.09883 0 12.42417" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M12.2725 1.00583c3.2445 3.51424 3.2445 8.09787 0 12.42227" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M6.80859 10.5652H17.2289" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M6.69336 3.86966H17.2562" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M5.7832 7.21744h12.4347" stroke-width="1"></path>
        <g class="person-2">
          <path fill="#ffdda1" stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M5.01149 20.3217c1.24143 0 2.24781 -1.0063 2.24781 -2.2478 0 -1.2415 -1.00638 -2.2478 -2.24781 -2.2478 -1.24144 0 -2.24782 1.0063 -2.24782 2.2478 0 1.2415 1.00638 2.2478 2.24782 2.2478Z" stroke-width="1"></path>
          <path fill="#66e1ff" stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M1.47852 23 c0.41983,-0.5208 0.95099,-0.941 1.55449,-1.2297 0.60349,-0.2887 1.26398,-0.4386 1.93297,-0.4386 s1.32947,0.1499 1.93297,0.4386 c0.60349,0.2887 1.13465,0.7089 1.55449,1.2297" stroke-width="1"></path>
        </g>
        <g class="person-1">
          <path fill="#ffdda1" stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M12.0818 20.3217c1.2415 0 2.2478 -1.0063 2.2478 -2.2478 0 -1.2415 -1.0063 -2.2478 -2.2478 -2.2478 -1.2415 0 -2.24782 1.0063 -2.24782 2.2478 0 1.2415 1.00632 2.2478 2.24782 2.2478Z" stroke-width="1"></path>
          <path fill="#66e1ff" stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M8.45301 23 c0.43274,-0.5208 0.97486,-0.9399 1.58786,-1.2275 0.613,-0.2877 1.2818,-0.4369 1.9589,-0.4369 s1.3459,0.1492 1.959,0.4369 c0.6129,0.2876 1.155,0.7067 1.5878,1.2275" stroke-width="1"></path>
        </g>
      </svg>
    </button>
  </span>
  <span title="${t('High Scores')}">
    <button id="highscores" class="icon" onclick="g_bui.showHighScores()">
      <svg viewBox="0 0 24 24">
        <path fill="#ffef5e" d="m4.82756 17.6183 -2.21582 1.2433c-0.33406 0.193 -0.75173 -0.0479 -0.75191 -0.4337 -0.00009 -0.0661 0.01307 -0.1316 0.03847 -0.1927l0.92093 -2.1087 -1.66113 -1.6344c-0.269732 -0.2384 -0.18018 -0.6794 0.16118 -0.7938 0.05369 -0.018 0.11018 -0.0261 0.16685 -0.0238h1.91266l0.98498 -2.1184c0.17117 -0.3415 0.64794 -0.3697 0.85822 -0.0507 0.01072 0.0163 0.02054 0.0332 0.02928 0.0507l0.98507 2.1184H8.169c0.36055 -0.0121 0.59893 0.3706 0.42911 0.6889 -0.02595 0.0485 -0.0601 0.0921 -0.10109 0.1287l-1.66121 1.6344 0.92002 2.1116c0.14821 0.3561 -0.14468 0.7392 -0.52731 0.6895 -0.06558 -0.0086 -0.12883 -0.03 -0.18613 -0.0631l-2.21483 -1.2462Z" stroke-width="1"></path>
        <path fill="#ffef5e" d="m19.1588 17.6183 -2.2158 1.2433c-0.334 0.193 -0.7517 -0.0479 -0.7519 -0.4337 -0.0001 -0.0661 0.013 -0.1316 0.0385 -0.1927l0.919 -2.1116 -1.6592 -1.6343c-0.2705 -0.2364 -0.1838 -0.677 0.1561 -0.7931 0.0553 -0.0189 0.1136 -0.0272 0.1719 -0.0246h1.9127l0.985 -2.1183c0.1711 -0.3416 0.6479 -0.3698 0.8582 -0.0508 0.0107 0.0163 0.0205 0.0334 0.0293 0.0508l0.9841 2.1183h1.9126c0.3597 -0.0149 0.6006 0.3652 0.4336 0.6841 -0.0265 0.0505 -0.0619 0.0958 -0.1046 0.1336l-1.6602 1.6343 0.92 2.1116c0.1465 0.3577 -0.1492 0.7398 -0.5321 0.6878 -0.0638 -0.0087 -0.1254 -0.0295 -0.1813 -0.0614l-2.2159 -1.2433Z" stroke-width="1"></path>
        <g class="middle-star">
          <path fill="#ffef5e" d="m12.5629 5.40887 1.226 2.52565h2.3861c0.45 -0.02036 0.7534 0.45415 0.546 0.85416 -0.033 0.06361 -0.0774 0.12064 -0.131 0.16821l-2.0714 2.16421 1.1476 2.6404c0.1864 0.4439 -0.1777 0.9231 -0.6553 0.8626 -0.0829 -0.0105 -0.1628 -0.0375 -0.235 -0.0794l-2.7763 -1.5626 -2.77332 1.5627c-0.41658 0.2414 -0.93831 -0.0586 -0.93912 -0.54 -0.00018 -0.0836 0.0164 -0.1663 0.04874 -0.2433l1.1476 -2.6404 -2.07429 -2.16421c-0.33685 -0.29929 -0.22343 -0.85093 0.20415 -0.993 0.0673 -0.02234 0.13811 -0.03234 0.20901 -0.02937h2.39083l1.2289 -2.52565c0.2267 -0.43136 0.8354 -0.4556 1.0957 -0.04351 0.0089 0.01414 0.0173 0.02865 0.0251 0.04351Z" stroke-width="1"></path>
          <path fill="#fff9bf" d="M8.75905 12.7899 13.732 7.81694l-1.1686 -2.40807c-0.2233 -0.43326 -0.8318 -0.46245 -1.0954 -0.05253 -0.0109 0.01703 -0.021 0.03451 -0.0302 0.05253l-1.229 2.52564H7.81803c-0.45028 -0.01495 -0.74794 0.46317 -0.53578 0.86066 0.03262 0.06099 0.07568 0.11576 0.12739 0.16171l2.07141 2.16422 -0.722 1.6688Z" stroke-width="1"></path>
          <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="m12.5629 5.40887 1.226 2.52565h2.3861c0.45 -0.02036 0.7534 0.45415 0.546 0.85416 -0.033 0.06361 -0.0774 0.12064 -0.131 0.16821l-2.0714 2.16421 1.1476 2.6404c0.1864 0.4439 -0.1777 0.9231 -0.6553 0.8626 -0.0829 -0.0105 -0.1628 -0.0375 -0.235 -0.0794l-2.7763 -1.5626 -2.77332 1.5627c-0.41658 0.2414 -0.93831 -0.0586 -0.93912 -0.54 -0.00018 -0.0836 0.0164 -0.1663 0.04874 -0.2433l1.1476 -2.6404 -2.07429 -2.16421c-0.33685 -0.29929 -0.22343 -0.85093 0.20415 -0.993 0.0673 -0.02234 0.13811 -0.03234 0.20901 -0.02937h2.39083l1.2289 -2.52565c0.2267 -0.43136 0.8354 -0.4556 1.0957 -0.04351 0.0089 0.01414 0.0173 0.02865 0.0251 0.04351Z" stroke-width="1"></path>
        </g>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="m17.7304 13.6746 0.9849 -2.1184c0.1782 -0.347 0.6654 -0.3711 0.8769 -0.0432 0.009 0.014 0.0174 0.0284 0.025 0.0432l0.9822 2.1184h1.9126c0.3605 -0.0145 0.6013 0.3668 0.4334 0.6861 -0.026 0.0496 -0.0608 0.0941 -0.1025 0.1315l-1.6621 1.6344 0.9199 2.1125c0.1509 0.3535 -0.1376 0.7376 -0.5192 0.6914 -0.0685 -0.0082 -0.1347 -0.0308 -0.1941 -0.0659l-2.2235 -1.2499 -2.2226 1.2499c-0.3324 0.1941 -0.7504 -0.0445 -0.7523 -0.4295 -0.0004 -0.0673 0.0129 -0.1339 0.0389 -0.196l0.5269 -1.2107" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="m7.24897 17.0399 0.52218 1.1992c0.14892 0.355 -0.14226 0.7382 -0.52425 0.6897 -0.06676 -0.0084 -0.13108 -0.0303 -0.18919 -0.0642l-2.22348 -1.2499 -2.22249 1.2499c-0.33253 0.1941 -0.75056 -0.0445 -0.75245 -0.4295 -0.00027 -0.0673 0.01298 -0.1339 0.03901 -0.196l0.92093 -2.1125 -1.66113 -1.6344c-0.269732 -0.2384 -0.18018 -0.6794 0.16118 -0.7938 0.05369 -0.018 0.11018 -0.0261 0.16685 -0.0238h1.91266l0.98498 -2.1184c0.1782 -0.347 0.66533 -0.3711 0.87687 -0.0432 0.00901 0.014 0.01739 0.0284 0.02495 0.0432l0.98219 2.1184" stroke-width="1"></path>
      </svg>
    </button>
  </span>
  <span title="${t('Send reaction')}">
    <button id="react" class="icon" onclick="g_bui.showEmojiPicker()" disabled>
      <svg viewBox="0 0 24 24" class="hover-off">
        <path fill="#ffef5e" d="M12 23c6.0752 0 11 -4.9248 11 -11 0 -6.07513 -4.9248 -11 -11 -11C5.92487 1 1 5.92487 1 12c0 6.0752 4.92487 11 11 11Z" stroke-width="1"></path>
        <path fill="#fff9bf" d="M12 4.82609c2.3764 0.00018 4.6974 0.7179 6.6591 2.05922 1.9617 1.3413 3.4727 3.24359 4.3352 5.45809 0 -0.1148 0.0057 -0.2286 0.0057 -0.3434 0 -2.91738 -1.1589 -5.71528 -3.2219 -7.77818C17.7153 2.15892 14.9174 1 12 1 9.08262 1 6.28472 2.15892 4.22182 4.22182S1 9.08262 1 12c0 0.1148 0 0.2286 0.00574 0.3434 0.86246 -2.2145 2.37345 -4.11679 4.33515 -5.45809C7.30258 5.54399 9.62358 4.82627 12 4.82609Z" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M12 23c6.0752 0 11 -4.9248 11 -11 0 -6.07513 -4.9248 -11 -11 -11C5.92487 1 1 5.92487 1 12c0 6.0752 4.92487 11 11 11Z" stroke-width="1"></path>
        <path stroke="#191919" d="M6.73864 10.3261c-0.13207 0 -0.23913 -0.1071 -0.23913 -0.2392 0 -0.13203 0.10706 -0.23909 0.23913 -0.23909" stroke-width="1"></path>
        <path stroke="#191919" d="M6.73926 10.3261c0.13206 0 0.23913 -0.1071 0.23913 -0.2392 0 -0.13203 -0.10707 -0.23909 -0.23913 -0.23909" stroke-width="1"></path>
        <path stroke="#191919" d="M17.2606 10.3261c-0.1321 0 -0.2391 -0.1071 -0.2391 -0.2392 0 -0.13203 0.107 -0.23909 0.2391 -0.23909" stroke-width="1"></path>
        <path stroke="#191919" d="M17.2603 10.3261c0.132 0 0.2391 -0.1071 0.2391 -0.2392 0 -0.13203 -0.1071 -0.23909 -0.2391 -0.23909" stroke-width="1"></path>
        <path fill="#ff808c" stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M15.7046 15.3478c0.146 -0.0002 0.2901 0.033 0.4213 0.0971 0.1313 0.0641 0.246 0.1575 0.3356 0.2727 0.0895 0.1154 0.1515 0.2497 0.1811 0.3927 0.0297 0.143 0.0261 0.2909 -0.0102 0.4322 -0.2639 1.0282 -0.8623 1.9393 -1.701 2.5899 -0.8387 0.6505 -1.87 1.0037 -2.9314 1.0037 -1.0615 0 -2.09277 -0.3532 -2.93146 -1.0037 -0.83869 -0.6506 -1.43711 -1.5617 -1.70101 -2.5899 -0.03636 -0.1413 -0.03986 -0.2892 -0.01023 -0.4322 0.02963 -0.143 0.0916 -0.2773 0.18117 -0.3927 0.08956 -0.1152 0.20434 -0.2086 0.33554 -0.2727 0.13119 -0.0641 0.27532 -0.0973 0.42134 -0.0971h7.40925Z" stroke-width="1"></path>
      </svg>
      <svg viewBox="0 0 24 24" class="hover-on">
        <path fill="#ffef5e" d="M12 23c6.0752 0 11 -4.9248 11 -11 0 -6.07513 -4.9248 -11 -11 -11C5.92487 1 1 5.92487 1 12c0 6.0752 4.92487 11 11 11Z" stroke-width="1"></path>
        <path fill="#fff9bf" d="M12 4.82609c2.3764 0.00018 4.6974 0.7179 6.6591 2.05922 1.9617 1.3413 3.4727 3.24359 4.3352 5.45809 0 -0.1148 0.0057 -0.2286 0.0057 -0.3434 0 -2.91738 -1.1589 -5.71528 -3.2219 -7.77818C17.7153 2.15892 14.9174 1 12 1 9.08262 1 6.28472 2.15892 4.22182 4.22182S1 9.08262 1 12c0 0.1148 0 0.2286 0.00574 0.3434 0.86246 -2.2145 2.37345 -4.11679 4.33515 -5.45809C7.30258 5.54399 9.62358 4.82627 12 4.82609Z" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M12 23c6.0752 0 11 -4.9248 11 -11 0 -6.07513 -4.9248 -11 -11 -11C5.92487 1 1 5.92487 1 12c0 6.0752 4.92487 11 11 11Z" stroke-width="1"></path>
        <path fill="#ff808c" stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M15.7046 15.3478c0.146 -0.0002 0.2901 0.033 0.4213 0.0971 0.1313 0.0641 0.246 0.1575 0.3356 0.2727 0.0895 0.1154 0.1515 0.2497 0.1811 0.3927 0.0297 0.143 0.0261 0.2909 -0.0102 0.4322 -0.2639 1.0282 -0.8623 1.9393 -1.701 2.5899 -0.8387 0.6505 -1.87 1.0037 -2.9314 1.0037 -1.0615 0 -2.09277 -0.3532 -2.93146 -1.0037 -0.83869 -0.6506 -1.43711 -1.5617 -1.70101 -2.5899 -0.03636 -0.1413 -0.03986 -0.2892 -0.01023 -0.4322 0.02963 -0.143 0.0916 -0.2773 0.18117 -0.3927 0.08956 -0.1152 0.20434 -0.2086 0.33554 -0.2727 0.13119 -0.0641 0.27532 -0.0973 0.42134 -0.0971h7.40925Z" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M6.73926 9.60865h2.86956l-2.3913 -2.3913" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M17.2602 9.60865h-2.8696l2.3913 -2.3913" stroke-width="1"></path>
      </svg>
    </button>
  </span>
  <span title="${t('Restart')}">
    <button id="restart" class="icon" onclick="confirmRestartIfNeeded()">
      <svg viewBox="0 0 24 24">
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="m1.67773 9.56396 2.74753 4.12124 3.2054 -3.6634" stroke-width="1"></path>
        <path stroke="#191919" stroke-linecap="round" stroke-linejoin="round" d="M4.45398 13.6275c-0.41241 -2.2446 0.04262 -4.56211 1.27306 -6.48418 1.23045 -1.92207 3.14454 -3.3055 5.35556 -3.87081 2.2111 -0.56531 4.5543 -0.27032 6.5563 0.82546 2.002 1.09569 3.5134 2.91042 4.229 5.07751 0.7155 2.16712 0.5819 4.52502 -0.3739 6.59742 -0.9559 2.0723 -2.6627 3.7046 -4.7756 4.5672 -2.1129 0.8625 -4.4744 0.8909 -6.6075 0.0794 -2.13307 -0.8114 -3.87859 -2.4022 -4.88399 -4.4511" stroke-width="1"></path>
      </svg>
    </button>
  </span>
</div>
`;

    window.confirmRestartIfNeeded = function() {
      if (!g_isGameOver) {
        if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer) {
          return confirmRestartMultiplayer();
        }
        return confirmRestartLocal();
      }

      if (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer) {
        initiateRematch();
      } else {
        g_bui.restart();
      }
      if (g_isMobile) hideGameInfo();
    };

    window.confirmRestartLocal = function() {
      g_bui.prompt(
        t('Restarting will forfeit this game.'),
        '<button class="button secondary" onclick="hideModal()">' + t('Cancel') + '</button>'
          + '&nbsp;&nbsp;<button class="button" onclick="hideModal();if (typeof finalizeGameScores === \'function\') finalizeGameScores();g_bui.restart();if (g_isMobile) hideGameInfo()">' + t('Restart') + '</button>'
      );
    };

    // Gameboard
    var isDisabled = !g_board_empty || isHighScore;
    var html = '<div id="board" class="human-computer"></div>';
    // Game info
    html +=
      '<div id="score"><div class="container"><header>' +
      '<button id="back"><svg version="1.1" viewBox="0 0 414.5 414.5" xmlns="http://www.w3.org/2000/svg"><polygon points="324.7 28.238 296.37 0 89.796 207.25 296.37 414.5 324.7 386.26 146.27 207.25" fill="currentColor"/></svg></button>' +
      g_cache['html'].miscBtns +
      '<img src="pics/icon.svg" width="32" height="32" alt="Vietboard"></header>' +
      '<h2>' + t('Words Played') + '</h2>' +
      '<div id="history"></div>' +
      '<table class="gameinfo">' +
      hr +
      '<tr class="level"><td>' + t('Level:') + '</td><td>' +
      '<span id="level" title="' + t('Computer can score up to ') + g_maxwpoints[g_playlevel] + t(' points per turn') + '">' + (g_playlevel + 1) + '</span>&nbsp;' +
      '<span title="' + t('Increase difficulty') + '"><a class="link up' + (isDisabled ? ' disabled' : '') + '" aria-label="' + t('Increase difficulty') + '" onclick="g_bui.levelUp()">' + arrow + '</a></span>' +
      '<span title="' + t('Decrease difficulty') + '"><a class="link down' + (isDisabled ? ' disabled' : '') + '" aria-label="' + t('Decrease difficulty') + '" onclick="g_bui.levelDn()">' + arrow + '</a></span></td></tr>';

    var sTileset = g_tilesets.indexOf(g_tileset) > -1 ? g_tileset : t('Default');
    var sSelTileset = '<select title="' + sTileset + '" onchange="setTileset(this)"' + (isHighScore ? ' disabled' : '') + '><option>' + sTileset + '</option>';
    if (sTileset !== t('Default')) sSelTileset += '<option value="default">' + t('Default') + '</option>';
    for (var i = 0; i < g_tilesets.length; ++i) {
      if (g_tilesets[i] === sTileset) continue;
      sSelTileset += '<option>' + g_tilesets[i] + '</option>';
    }
    sSelTileset += '</select>';

    var sLayout = g_layouts.indexOf(g_layout) > -1 ? g_layout : t('Default');
    var sSelLayout = '<select id="bonuseslayout" title="' + sLayout + '" onchange="setLayout(this)"' + (isDisabled ? ' disabled' : '') + '>' +
      '<option' + (sLayout === t('Default') ? ' value="default"' : '') + '>' + sLayout + '</option>';
    if (sLayout !== t('Default')) sSelLayout += '<option value="default">' + t('Default') + '</option>';
    for (var i = 0; i < g_layouts.length; ++i) {
      if (g_layouts[i] === sLayout) continue;
      sSelLayout += '<option>' + g_layouts[i] + '</option>';
    }
    sSelLayout += '</select>';

    html +=
      '<tr><td>' + t('Tileset:') + '</td><td>' + sSelTileset + '</td></tr>' +
      '<tr><td>' + t('Bonuses layout:') + '</td><td>' + sSelLayout + '</td></tr>' +
      hr +
      '<tr><td>' + t('Your last score:') + '</td><td id="lpscore">0</td></tr>' +
      '<tr class="highlight player"><td>' + t('Your total score:') + '</td><td id="pscore">0</td></tr>' +
      hr +
      '<tr><td><span id="label-loscore">' + t('Computer&rsquo;s last score:') + '</span></td><td id="loscore">0</td></tr>' +
      '<tr class="highlight opponent"><td><span id="label-oscore">' + t('Computer&rsquo;s total score:') + '</span></td><td id="oscore">0</td></tr>' +
      hr +
      '<tr><td>' + t('Tiles left:') + '</td><td id="tleft"></td></tr>' +
      hr;
    html +=
      '</table><footer>' +
      '<a href="https://fb.me/vietboardplay" class="social" title="' + t('Visit our Facebook Page to learn more') + '"><img src="pics/fb.svg" width="32" height="32" alt="Facebook"></a>' +
      '<span onclick="showWhatsNew()">v' + VER + '</span>' +
      (localStorage['lang'] === 'vi' ?
        '<a href="javascript:setLang(\'en\')">' + t('English') + '</a> | ' + t('Vietnamese') :
        t('English') + ' | <a href="javascript:setLang(\'vi\')">' + t('Vietnamese') + '</a>') +
      '</footer></div></div>';

    g_cache['app'].innerHTML = html;

    self.scores = scores;

    self.created = true;
    self.racksize = racksize;

    self.bx = bx;
    self.by = by;

    g_cache['html'].h1 = '<h1><img src="pics/logo.svg" alt="Vietboard" onload="spinColors(this)"></h1>' + g_cache['html'].miscBtns;

    // Scoreboard
    html = '<table id="scoreboard"><tr>' +
      '<td id="score-player">0</td>' +
      '<td class="spacer"></td>' +
      '<td class="logo"><img src="pics/logo.svg" alt="Vietboard" onload="spinColors(this)"><br><small id="status" onclick="startMarquee(this)">' + t('Tap on score for game info') + '</small></td>' +
      '<td class="spacer"></td>' +
      '<td id="score-opponent">0</td></tr></table>';
    html += '<div id="drag">';

    //---------------------------
    // Opponent's rack
    html += '<table class="opponent"><tr>';
    if (!g_isMobile) {
      html += '<td class="mark">' +
        //'<button id="toggle" class="button secondary" onclick="g_bui.toggleORV()"></button>' +
        g_cache['html'].h1 +
        '</td>';
    }
    for (var i = 0; i < racksize; ++i) {
      html += '<td id="' + self.oppRackId + i + '"' + (DEBUG ? ' class="on"' : '') + '></td>';
    }
    html += '</tr></table>';

    //---------------------------
    // Playing board
    var st = self.getStartXY();
    var mults = ['', 'DL', 'TL', 'DW', 'TW'];
    var mult;
    var cellId;

    html += '<table class="board">';
    for (var i = 0; i < by; ++i) {
      html += '<tr>';
      for (var j = 0; j < bx; ++j) {
        cellId = self.boardId + j + '_' + i;
        html += '<td id="' + cellId + '" ';
        mult = (j === st.x && i === st.y) ? 'ST' : mults[self.boardm[j][i]] || '';
        if (mult !== '') mult = 'class="' + mult + '"';
        html += mult + '>';
        if (g_board[j] && g_board[j][i]) {
          html += '<div class="drag t' + g_boardtypes[j][i] + '">' +
            (g_board[j][i] === ' ' ? '&nbsp;&nbsp;' : g_board[j][i].toUpperCase()) +
            (g_boardpoints[j][i] ? '<sup><small>' + g_boardpoints[j][i] + '</small></sup>' : '') +
            '</div>';
        }
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</table>';

    //---------------------------
    // Player's rack
    html += '<table class="player"><tr>';
    for (var i = 0; i < racksize; ++i) {
      html += '<td id="' + self.plrRackId + i + '"></td>';
    }
    //---------------------------

    if (g_isMobile) html += '</tr><tr>';
    html += '<td class="mark"' + (g_isMobile ? ' colspan="8"' : '') + '><div class="button-container">' +
      (isHighScore ? '<button class="button secondary wide" onclick="g_bui.created=false;load(localStorage[\'session\'])">' + t('Return to Game') + '</button>' :
      '<button id="play" class="button" onclick="onPlayerMoved()">' + t('Play') + '</button>' +
      '<button id="clear" class="button secondary" onclick="onPlayerShuffle()">' + t('Shuffle') + '</button>' +
      '<button id="swap" class="button secondary" onclick="onPlayerSwap()">' + t('Swap') + '</button>' +
      '<button id="pass" class="button secondary" onclick="onPlayerMoved(true)">' + t('Pass') + '</button>') +
      '</div></td></tr></table></div>';

    el(iddiv).innerHTML = html;

    // Set desktop header height
    toggleMobile();

    // Initialize custom DOM "holds" property
    for (var i = 0; i < racksize; ++i) {
      var idp = self.plrRackId + i;
      var ido = self.oppRackId + i;
      el(idp).holds = '';
      el(ido).holds = '';
    }
    for (var i = 0; i < by; ++i) {
      for (var j = 0; j < bx; ++j) {
        cellId = self.boardId + j + '_' + i;
        // Populate holds from saved session?
        if (g_board[j] && g_board[j][i]) {
          var holds = {
            'letter': g_board[j][i],
            'points': g_boardpoints[j][i]
          };
          el(cellId).holds = holds;
          el(cellId).firstChild.holds = holds;
        } else {
          el(cellId).holds = '';
        }
      }
    }

    // Hide opponent's rack
    //if (DEBUG) self.toggleORV();

    // Initialize REDIPS framework
    self.rd = REDIPS.drag;
    self.initRedips();

    // Toggle game info (mobile)
    el('score-opponent').addEventListener('click', showGameInfo);
    el('score-player').addEventListener('click', showGameInfo);
    el('back').addEventListener('click', hideGameInfo);
  };

  self.displayEmojiReaction = function(emoji, isLocal) {
    var reaction = document.createElement('div');
    reaction.className = 'emoji-reaction';
    reaction.textContent = emoji;
    document.body.appendChild(reaction);

    var targetSelector = isLocal ? '#drag .player' : '#drag .opponent';
    var target = document.querySelector(targetSelector);
    if (target) {
      var rect = target.getBoundingClientRect();
      reaction.style.left = Math.round(rect.left + rect.width / 2 - reaction.offsetWidth / 2) + 'px';
      reaction.style.top = Math.round(rect.top + rect.height / 2) + 'px';
    }

    // Trigger reflow to ensure animation starts
    void reaction.offsetWidth;
    reaction.classList.add('float');

    setTimeout(function() {
      if (reaction.parentNode) reaction.parentNode.removeChild(reaction);
    }, 4600);
  };

  self.fixPlayerTiles = function() {
    for (var i = 0; i < g_racksize; ++i) {
      var idp = self.plrRackId + i;
      var divp = el(idp).firstChild;
      if (divp) self.rd.enableDrag(false, divp);
    }
  };

  self.getBoard = function() {
    var board = [];
    var boardp = [];
    var boardt = [];
    for (var x = 0; x < self.bx; ++x) {
      board[x] = [];
      boardp[x] = [];
      boardt[x] = [];
      for (var y = 0; y < self.by; ++y) {
        var id = self.boardId + x + '_' + y;
        var obj = el(id);
        var letter = '';
        var points = 0;
        var tiletype = 0;
        if (obj.holds !== '') {
          letter = obj.holds.letter;
          points = obj.holds.points;
        }
        if (obj && obj.firstChild) {
          tiletype = +obj.firstChild.classList.contains('t2') + 1;
        }
        board[x][y] = letter;
        boardp[x][y] = points;
        boardt[x][y] = tiletype;
      }
    }
    return {
      'board': board,
      'boardp': boardp,
      'boardt': boardt
    };
  };

  self.getOpponentRack = function() {
    // If visible, sync from DOM
    if (self.showOpRack) {
      var letters = '';
      var isMP = (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer);
      for (var i = 0; i < self.racksize; ++i) {
        // In multiplayer racks are mirrored horizontally; read DOM in reverse
        var domIndex = isMP ? (self.racksize - 1 - i) : i;
        var cell = document.getElementById(self.oppRackId + domIndex);
        if (cell && cell.holds && cell.holds !== '') {
          letters += (cell.holds.letter || '*');
        } else {
          letters += '.';
        }
      }
      self.racks[2] = letters;
    }
    return self.racks[2];
  };

  self.getPlayerPlacement = function() {
    var placement = [];
    var played = self.newplays;
    for (var l in played) {
      var sc = l.substr(1);
      var co = sc.split('_');
      placement.push({
        'id': l,
        'ltr': played[l].letter,
        'lsc': played[l].points,
        'x': +co[0],
        'y': +co[1]
      });
    }
    return placement;
  };

  self.getPlayerRack = function() {
    var letters = '';
    for (var i = 0; i < self.racksize; ++i) {
      var cell = document.getElementById(self.plrRackId + i);
      if (cell && cell.holds && cell.holds !== '') {
        letters += (cell.holds.letter || '*');
      } else {
        letters += '.';
      }
    }
    self.racks[1] = letters;
    return letters;
  };

  self.getPlayLevel = function() {
    return self.level - 1;
  };

  self.getStartXY = function() {
    // Starting position is center of board
    var fx = Math.round(self.bx / 2) - 1;
    var fy = Math.round(self.by / 2) - 1;
    return {
      'x': fx,
      'y': fy
    };
  };

  self.hcopy = function(pholds) {
    if (pholds === undefined || pholds === '' || pholds === null) return '';
    return {
      'letter': pholds.letter,
      'points': pholds.points
    };
  };

  self.hideBusy = function() {
    if (self.busyToast && self.busyToast.parentNode) {
      self.busyToast.classList.remove('show');
      self.busyToast.classList.add('hide');
      self.busyToast = null;
    }
  };

  self.hideEmojiPicker = function() {
    var picker = document.getElementById('emoji-picker');
    if (picker) {
      picker.remove();
    }
    if (self._emojiOutsideClick) {
      document.removeEventListener('click', self._emojiOutsideClick);
      self._emojiOutsideClick = null;
    }
  };

  self.initRedips = function() {
    self.rd.init();
    self.rd.dropMode = 'single';
    //self.rd.style.borderDisabled = 'solid'; // Border style for disabled element unchanged
    self.rd.animation.pause = g_animation; // Set animation loop pause

    var g_cachedSenderSourceRect = null;
    function stopMultiplayerDragSync() {
      if (self.dragSyncTimer) {
        clearInterval(self.dragSyncTimer);
        self.dragSyncTimer = null;
      }
      g_cachedSenderSourceRect = null;
    }

    function getMultiplayerDragSource() {
      if (!self.rd.td || !self.rd.td.source) return null;
      var sourceCell = self.rd.td.source;
      if (!g_cachedSenderSourceRect) {
        g_cachedSenderSourceRect = sourceCell.getBoundingClientRect();
      }
      return {
        sourceId: sourceCell.id,
        sourceCenterX: g_cachedSenderSourceRect.left + g_cachedSenderSourceRect.width / 2,
        sourceCenterY: g_cachedSenderSourceRect.top + g_cachedSenderSourceRect.height / 2
      };
    }

    function startMultiplayerDragSync() {
      stopMultiplayerDragSync();
      self.dragSyncTimer = setInterval(function() {
        if (typeof g_isMultiplayer === 'undefined' || !g_isMultiplayer) return;
        if (typeof g_isMyTurn === 'undefined' || !g_isMyTurn) return;
        if (typeof sendDragPosition !== 'function') return;
        if (!self.rd.obj) return;

        var rect = self.rd.obj.getBoundingClientRect();
        var dragSource = getMultiplayerDragSource();
        sendDragPosition(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          dragSource ? dragSource.sourceId : '',
          dragSource
        );
      }, 40);
    }

    self.rd.event.clicked = function() {
      startMultiplayerDragSync();
    };

    self.rd.event.dropped = function() {
      //console.log(self.rd.obj.holds);
      var holds = self.hcopy(self.rd.obj.holds);
      self.rd.td.target.holds = holds;
      var id = self.rd.td.target.id;
      var sourceId = self.rd.td.source.id;
      var sc = self.rd.td.source.id.charAt(0);
      var isJokerOnBoard = false;
      if (id.charAt(0) === self.boardId) {
        // Tile dropped on playing board
        self.playSound();
        el('clear').textContent = t('Clear');
        el('clear').onclick = onPlayerClear;
        if (holds && holds.points === 0) { // Joker
          isJokerOnBoard = true;
        } else {
          self.newplays[id] = self.hcopy(holds);
        }
      } else if (id.charAt(0) === 'p') {
        // Tile dropped on player rack
        if (holds && holds.points === 0 // Joker
          && sc === self.boardId) {     // Taken board to rack
          // Remove selected letter from joker tile
          self.rd.obj.innerHTML = '';
          self.rd.obj.holds = {
            'letter': '*',
            'points': 0
          };
        }
        if (Object.keys(self.newplays).length === 0) {
          el('clear').textContent = t('Shuffle');
          el('clear').onclick = onPlayerShuffle;
        }
      }

      if (typeof sendDragPreview === 'function') {
        sendDragPreview(sourceId, id, holds);
      }

      if (typeof sendDragEnd === 'function') sendDragEnd();
      stopMultiplayerDragSync();
      if (typeof cleanupDragGhosts === 'function') cleanupDragGhosts();

      if (isJokerOnBoard) {
        self.showLettersModal(id);
      }
    };

    self.rd.event.changed = function() {
      if (typeof g_isMultiplayer === 'undefined' || !g_isMultiplayer) return;
      if (typeof g_isMyTurn === 'undefined' || !g_isMyTurn) return;

      var dragObj = self.rd.obj;

      if (dragObj && typeof sendDragPosition === 'function') {
        var rect = dragObj.getBoundingClientRect();
        var dragSource = getMultiplayerDragSource();
        sendDragPosition(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          dragSource ? dragSource.sourceId : '',
          dragSource
        );
      }
    };

    self.rd.event.notMoved = function() {
      if (typeof sendDragEnd === 'function') sendDragEnd();
      stopMultiplayerDragSync();
      if (typeof cleanupDragGhosts === 'function') cleanupDragGhosts();
    };

    self.rd.event.moved = function() {
      var id = self.rd.td.source.id;
      if (typeof sendDragSourceClear === 'function') {
        sendDragSourceClear(id);
      }

      self.rd.td.source.holds = '';
      // Tile lifted from playing board
      if (id.charAt(0) === self.boardId) delete self.newplays[id];

      if (typeof sendDragPosition === 'function' && self.rd.obj) {
        var rect = self.rd.obj.getBoundingClientRect();
        var dragSource = getMultiplayerDragSource();
        sendDragPosition(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          dragSource ? dragSource.sourceId : '',
          dragSource
        );
      }
    };
  };

  self.levelDn = function() {
    if (!g_board_empty) return;
    if (self.level > 1) --self.level;
    el('level').textContent = self.level;
    el('level').title = t('Computer can score up to ') + g_maxwpoints[self.level - 1] + t(' points per turn');
    g_playlevel = self.level - 1;
    localStorage['level'] = self.level;
  };

  self.levelUp = function() {
    if (!g_board_empty) return;
    if (self.level < g_maxwpoints.length) ++self.level;
    el('level').textContent = self.level;
    el('level').title = t('Computer can score up to ') + g_maxwpoints[self.level - 1] + t(' points per turn');
    g_playlevel = self.level - 1;
    localStorage['level'] = self.level;
  };

  self.makeTilesFixed = function() {
    self.rd.enableDrag(false, '#drag div');
    for (var i = 0; i < g_racksize; ++i) {
      var divo = el(self.oppRackId + i).firstChild;
      if (divo) self.rd.enableDrag(false, divo);
      var divp = el(self.plrRackId + i).firstChild;
      if (divp) self.rd.enableDrag(true, divp);
    }
  };

  self.onSelLetter = function(ltr) {
    var holds = {
      'letter': ltr,
      'points': 0
    };
    self.newplays[self.bdropCellId] = holds;
    var cell = el(self.bdropCellId);
    cell.holds = self.hcopy(holds);
    var html = '';
    //html += '<div class="drag t1">';
    html += (ltr !== ' ' && ltr !== '*') ? ltr.toUpperCase() : '&nbsp;&nbsp;';
    //html += '</div>';
    //cell.innerHTML = html;
    var div = cell.firstChild;
    div.holds = self.hcopy(holds);
    div.innerHTML = html;

    // Re-broadcast the resolved joker letter so opponent sees it immediately
    if (typeof sendDragPreview === 'function') {
      sendDragPreview(self.bdropCellId, self.bdropCellId, holds);
    }
    if (typeof sendDragEnd === 'function') sendDragEnd();

    hideModal();
    return self.bdropCellId;
  };

  self.onSwap = function(cancel) {
    var keep = '';
    var swap = '';

    if (cancel) {
      keep = self.getPlayerRack();
    } else {
      for (var i = 0; ; ++i) {
        var swapc = el('swap-candidate' + i);
        if (!swapc) break;
        if (swapc.firstChild) {
          if (swapc.firstChild && swapc.classList.contains('to-swap')) swap += swapc.firstChild.holds.letter;
          else keep += swapc.firstChild.holds.letter;
        }
      }
    }

    //console.log('onSwap', keep, swap);

    // Either I'm not using REDIPS correctly or having the two tile swapping
    // tables somehow messes up its internal table monitoring mechanism.
    // Without the two lines below, that tell REDIPS to forget about the
    // swap racks and reread the board and player/opponent rack tables, the
    // move animation thinks the target table is the swap rack instead of
    // the board table, causing havoc.
    //el('swaptable').innerHTML = '';
    //self.initRedips();

    hideModal();
    onPlayerSwapped(keep, swap);
  };

  self.onSwapToggle = function(elTile) {
    if (!elTile.classList.contains('to-swap') && document.querySelectorAll('#swaptable .to-swap').length === g_letpool.length) {
      el('swaptable').title = t('No tiles left to swap');
    } else {
      elTile.classList.toggle('to-swap');
      el('swaptable').title = t('Select the letters you want to swap');
    }
  };

  /*
  self.opponentPlay = function(x, y, lt, lts) {
    // TODO: add animation, etc.
    var cell = el(self.boardId + x + '_' + y);
    cell.holds = {
      'letter': lt,
      'points': lts
    };

    var ltru = lt.toUpperCase();
    var html = '<div class="drag t2">' + ltru;

    if (lts === 0) lts = '&nbsp;';

    html += '<sup><small>' + lts + '</small></sup>';
    html += '</div>';
    cell.innerHTML = html;
    cell.style.backgroundColor = '#ff0'; // Yellow
  };
  */

  self.playOpponentMove = function(placements, callback) {
    // Placements is an array of letter placement information for the
    // opponent move. It consists of:
    //
    // ltr: the letter to place
    // lscr: the letter's score
    // x: the x board position to place the letter
    // y: the y board position to place the letter
    //
    // dlet is a dictionary of arrays, where each letter played maps to a
    // different array. The size of the array is the number of times the
    // same letter was played in a move.

    var orack = self.racks[2];
    // newrack will be oponent's rack after the value of the joker tiles has
    // been determined.
    var newrack = orack;
    var dlet = {};
    //if (DEBUG) console.log('Placements:', placements);
    var usedIndices = new Set();

    // Helper: map logical rack index to physical DOM cell id
    // In multiplayer opponent rack is mirrored horizontally.
    var isMP = (typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer);
    function getOppCellId(idx) {
      var domIdx = isMP ? (self.racksize - 1 - idx) : idx;
      return self.oppRackId + domIdx;
    }

    for (var i = 0; i < placements.length; ++i) {
      var placement = placements[i];
      var l = placement.ltr;
      if (l in dlet) dlet[l].push(placement);
      else dlet[l] = [placement];
      // If letter is not on rack, then a joker is used. Put a letter in
      // the blank tile before it is animating to the board. After the
      // process below, orack will be a string of the original opponent
      // rack with all the letters used in the opponent word converted to _.
      var lpos = -1;
      for (var j = 0; j < orack.length; j++) {
        if (orack[j] === l && !usedIndices.has(j)) {
          lpos = j;
          break;
        }
      }

      if (lpos === -1) {
        var jpos = -1;
        for (var j = 0; j < orack.length; j++) {
          if (orack[j] === '*' && !usedIndices.has(j)) {
            jpos = j;
            break;
          }
        }
        if (jpos !== -1) {
          usedIndices.add(jpos);
          // Replace joker symbol with a different symbol
          orack = orack.substr(0, jpos) + '_' + orack.substr(jpos + 1);
          // Expose joker letter value in new rack
          newrack = newrack.substr(0, jpos) + l + newrack.substr(jpos + 1);
          var ltrStr = (l !== ' ') ? l.toUpperCase() : '&nbsp;&nbsp;';
          var pVal = placement.lscr;
          var rcell = el(getOppCellId(jpos));
          if (rcell.firstChild) {
            rcell.firstChild.innerHTML = ltrStr + '<sup><small>' + (pVal > 0 ? pVal : '&nbsp;') + '</small></sup>';
          }
        }
      } else {
        usedIndices.add(lpos);
        orack = orack.substr(0, lpos) + '_' + orack.substr(lpos + 1);
        var ltrStr = (l !== ' ') ? l.toUpperCase() : '&nbsp;&nbsp;';
        var pVal = placement.lscr;
        var rcell = el(getOppCellId(lpos));
        if (rcell.firstChild) {
          rcell.firstChild.innerHTML = ltrStr + '<sup><small>' + (pVal > 0 ? pVal : '&nbsp;') + '</small></sup>';
        }
      }
    }

    //if (DEBUG) console.log('Dictionary of letter arrays:', dlet);

    // Go over each letter in the current opponent rack each time a letter
    // exists in the move dictionary (dlet), animate it to its position on
    // the board, and then decrement its count in the dictionary.
    self.displayedcells = [];
    var rack = newrack.split('');

    function moveletter(info, wait) {
      setTimeout(function() {
        self.rd.moveObject(info);
      }, wait);
    }

    self.fixPlayerTiles();
    var lettermoves = [];
    self.animTiles = 0;
    self.animCallback = callback;

    for (var i = 0; i < rack.length; ++i) {
      var rlet = rack[i];
      if (rlet in dlet && dlet[rlet].length > 0) {
        // Get the placement info for this letter
        var move = dlet[rlet][0];
        // And position of the corresponding letter on opponent's rack
        var opid = getOppCellId(i);
        // And the target cell information
        var cellId = self.boardId + move.x + '_' + move.y;
        var orcell = el(opid);
        orcell.style.display = '';
        self.displayedcells.push(orcell);
        var div = orcell.firstChild;
        var cell = el(cellId);
        div.holds = {
          'letter': move.ltr,
          'points': move.ltscr
        };
        //cell.innerHTML = "<div class='drag'></div>";
        // Update what the target cell will contain
        var moveinfo = {
          'obj': div,
          'target': cell,
          'callback': self.animDone,
          'overwrite': true
        };
        lettermoves.push({
          'info': moveinfo,
          'x': move.x,
          'y': move.y
        });
        cell.holds = {
          'letter': move.ltr,
          'points': move.lscr
        };
        // Remove the placement element for this letter
        dlet[rlet].splice(0, 1);
      }
    }

    var totalanims = lettermoves.length;
    self.animTiles = totalanims;

    // Now animate the letters to their correct position in the board by the
    // order in which they appear in the word. For this we need to sort the
    // letters to animate according to their position in the word.
    function compareByX(a, b) {
      return a.x - b.x;
    }

    function compareByY(a, b) {
      return a.y - b.y;
    }

    if (totalanims > 1) {
      if (lettermoves[0].x !== lettermoves[1].x) lettermoves.sort(compareByX);
      else lettermoves.sort(compareByY);
    }

    if (totalanims === 0 || (typeof g_animation === 'number' && g_animation === 0)) {
      // No animations to run or animations are disabled
      for (var i = 0; i < totalanims; ++i) {
        var moveinfo = lettermoves[i].info;
        moveinfo.target.innerHTML = ''; // Clear target
        moveinfo.target.appendChild(moveinfo.obj);
        if (typeof moveinfo.obj.redips === 'object' && moveinfo.obj.redips.enabled !== false) {
           self.rd.registerEvents(moveinfo.obj);
        }
      }
      if (typeof callback === 'function') callback();
      return;
    }

    var wait;
    for (var i = 0; i < totalanims; ++i) {
      // Set the the time to wait before animating this letter to its
      // position on the board
      wait = g_wait * i;
      // Create a separate instance of the letter info local to the
      // function and set the timer to move the letter by activating this
      // function
      moveletter(lettermoves[i].info, wait);
    }
  };

  self.playSound = function() {
    g_cache['sound'].play();
  };

  self.prompt = function(msg, button, sClass) {
    showModal(
      msg +
      '<div class="buttons">' +
      (button || '<button class="button" onclick="hideModal()">' + t('Close') + '</button>') +
      '</div>',
      sClass
    );
  };

  self.removeFromOpponenentRack = function(letters) {
    self.removeFromRack(2, letters);
  };

  self.removeFromPlayerRack = function(letters) {
    self.removeFromRack(1, letters);
  };

  self.removeFromRack = function(pl, letters) {
    // Remove letters from player or opponent racks
    // pl: 1=player, 2=opponent
    // letters: array of letters to remove

    var dlet = {};
    for (var i = 0; i < letters.length; ++i) {
      var l = letters.charAt(i);
      if (l in dlet) ++dlet[l];
      else dlet[l] = 1;
    }

    var rack = self.racks[pl].split('');
    for (var i = 0; i < rack.length; ++i) {
      var rlet = rack[i];
      if (rlet in dlet && dlet[rlet] > 0) {
        rack[i] = '.'; // Placeholder for empty slot
        --dlet[rlet];
      }
    }

    //if (pl === 1) console.log('removeFromRack leaves: ' + rack);
    self.racks[pl] = rack.join('');
    self.setLetters(pl, self.racks[pl]);
  };

  self.renderHighScoreRows = function(sKey) {
    var html = '';
    // In high scores view, always show player name even if not currently in a game
    var myName = (typeof g_myName !== 'undefined' && g_myName) ? String(g_myName).trim() : '';
    var youLabel = t('You');
    var playerDisplayName = (myName && myName !== youLabel && myName !== 'You') ? youLabel + ' (' + myName + ')' : youLabel;
    var opponentLabel = t('Opponent');
    var computerLabel = t('Computer');

    if (g_highscores[sKey]) {
      var currentUserName = (typeof g_myName !== 'undefined' && g_myName) ? String(g_myName).trim() : '';
      var currentUserId = (typeof g_lobbyUserId !== 'undefined' && g_lobbyUserId) ? String(g_lobbyUserId).trim() : '';
      for (var i = 0; i < g_highscores[sKey].length; ++i) {
        if (!g_highscores[sKey][i]) break;
        var score = Number(g_highscores[sKey][i]['score']);
        if (!(score > 0)) continue;
        var playerName = g_highscores[sKey][i]['player'];
        var playerId = g_highscores[sKey][i]['playerId'] || '';
        if (currentUserId && playerId === currentUserId) {
          playerName = currentUserName ? youLabel + ' (' + currentUserName + ')' : youLabel;
        } else if (currentUserName && playerName === currentUserName) {
          playerName = youLabel + ' (' + currentUserName + ')';
        } else if (playerName === youLabel || playerName === 'You' || playerName.startsWith(youLabel + ' (') || playerName.startsWith('You (')) {
          playerName = currentUserName ? youLabel + ' (' + currentUserName + ')' : youLabel;
        } else if (playerName === 'Opponent' || playerName === opponentLabel) {
          playerName = opponentLabel;
        } else if (playerName === 'Computer' || playerName === computerLabel || playerId === 'computer') {
          playerName = computerLabel;
        }
        var dateStr = '';
        if (g_highscores[sKey][i]['date']) {
          var d = new Date(g_highscores[sKey][i]['date']);
          dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        html += '<tr><td>' + (i + 1) +
          '</td><td>' + playerName +
          '</td><td><a class="link" title="' + t('View this match') + '" onclick="loadHighScore(\'' + sKey + '\',' + i + ')" tabindex="1">' +
          g_highscores[sKey][i]['score'] + '</a></td><td>' + dateStr + '</td></tr>';
      }
    }
    return html;
  };

  self.renderWordPlayed = function(word, player) {
    return '<tr class="player-' + player + '">' +
      '<td>' + word.toUpperCase() + '</td><td>' +
      '<a class="link" title="' + t('Show definition') + '" aria-label="' + t('Show definition') + '" onclick="g_bui.wordInfo(\'' + word + '\')"><img src="pics/info.svg" width="22" height="22" alt=""></a>' +
      '</td></tr>';
  };

  self.restart = function() {
    localStorage.removeItem('session');
    g_bui = new RedipsUI();
    init('board');
  };

  self.setLetters = function(player, letters) {
    //console.log('setLetters', letters);
    self.racks[player] = letters;
    var cells = [];

    // TODO: sanity checks on values of player

    var ifprfx = (player === 1) ? self.plrRackId : self.oppRackId;
    var upper = letters.toUpperCase();
    var isOpponent = (player === 2);
    var isMP = (isOpponent && typeof g_isMultiplayer !== 'undefined' && g_isMultiplayer);

    for (var i = 0; i < self.racksize; ++i) {
      // In multiplayer, opponent rack is mirrored horizontally
      var domIdx = isMP ? (self.racksize - 1 - i) : i;
      var id = ifprfx + domIdx;
      var rcell = el(id);
      // Remove the existing drag div?
      if (rcell.firstChild) rcell.removeChild(rcell.firstChild);
      var ltr = i < letters.length ? letters.charAt(i) : '';
      if (ltr !== '' && ltr !== '.') {
        cells.push(rcell);
        var html = '<div class="drag t' + player + '">';
        var hideOpponentLetter = isMP;
        var holds = {
          'letter': ltr,
          'points': self.scores[ltr] || 0
        };
        rcell.holds = holds;
        if (ltr === '*') {
          // Joker: blank face, no points
          html += '&nbsp;&nbsp;';
        } else if (ltr === ' ') {
          // Space tile: blank face with points (e.g., 10)
          if (hideOpponentLetter) {
            html += '&nbsp;&nbsp;';
          } else {
            html += '&nbsp;&nbsp;<sup><small>' + self.scores[ltr] + '</small></sup>';
          }
        } else {
          if (hideOpponentLetter) {
            html += '&nbsp;&nbsp;';
          } else {
            var char = upper.charAt(i);
            html += (char !== ' ' ? char : '&nbsp;&nbsp;') + '<sup><small>' + self.scores[ltr] + '</small></sup>';
          }
        }
        html += '</div>';
        rcell.innerHTML = html;
      } else {
        rcell.holds = '';
      }
    }

    for (i in cells) {
      var div = cells[i].firstChild;
      div.holds = self.hcopy(cells[i].holds);
      //if (player===2) self.rd.enableDrag(false, div);
    }

    if (!self.firstrack && self.rd && typeof self.rd.init === 'function') {
      self.rd.init();
    }
  };

  self.setOpponentRack = function(letters) {
    self.setLetters(2, letters);
  };

  self.setOpponentScore = function(last, total) {
    el('loscore').textContent = last;
    el('oscore').textContent = total;
    el('score-opponent').textContent = total;
  };

  self.setPlayerRack = function(letters) {
    self.setLetters(1, letters);
    if (self.firstrack) {
      self.firstrack = false;
      self.initRedips();
    }
  };

  self.setPlayerScore = function(last, total) {
    el('lpscore').textContent = last;
    el('pscore').textContent = total;
    el('score-player').textContent = total;
  };

  self.setTilesLeft = function(left) {
    if (!el('tleft')) return;
    el('tleft').innerHTML = '<a' + (DEBUG ? ' href="javascript:g_bui.showTilesLeft()"' : '') + '>' + left + '</a>';
  };

  self.showBusy = function() {
    if (typeof g_showThinking !== 'undefined' && g_showThinking) {
      self.busyToast = self.toast(t('Computer thinking, please wait...'), 0);
    }
    if (typeof DEBUG !== 'undefined' && DEBUG) {
      console.log(t('Computer thinking, please wait...'));
    }
  };

  self.showEmojiPicker = function() {
    var existing = document.getElementById('emoji-picker');
    if (existing) {
      self.hideEmojiPicker();
      return;
    }

    function renderPicker(emojis) {
      var picker = document.createElement('div');
      picker.id = 'emoji-picker';
      var grid = document.createElement('div');
      grid.className = 'emoji-grid';
      for (var i = 0; i < emojis.length; ++i) {
        var btn = document.createElement('button');
        btn.className = 'emoji-choice';
        btn.textContent = emojis[i];
        btn.onclick = (function(emoji) {
          return function() {
            if (typeof g_isMobile !== 'undefined' && g_isMobile) {
              if (!document.documentElement.classList.contains('gameinfo')) {
                if (typeof sendEmojiReaction === 'function') sendEmojiReaction(emoji);
              } else {
                var board = document.getElementById('board');
                if (board) {
                  var onTransitionEnd = function(e) {
                    board.removeEventListener('transitionend', onTransitionEnd);
                    if (typeof sendEmojiReaction === 'function') sendEmojiReaction(emoji);
                  };
                  board.addEventListener('transitionend', onTransitionEnd);
                }
                hideGameInfo();
              }
            } else {
              if (typeof sendEmojiReaction === 'function') sendEmojiReaction(emoji);
            }
          };
        })(emojis[i]);
        grid.appendChild(btn);
      }
      picker.appendChild(grid);
      document.body.appendChild(picker);

      // Position below the react button
      var reactBtn = document.getElementById('react');
      if (reactBtn) {
        var rect = reactBtn.getBoundingClientRect();
        picker.style.left = Math.round(rect.left + rect.width / 2 - picker.offsetWidth / 2) + 'px';
        picker.style.top = Math.round(rect.bottom + 6) + 'px';
      }

      // Close on outside click (ignore clicks inside the react button or its children)
      self._emojiOutsideClick = function(e) {
        var reactBtn = document.getElementById('react');
        var clickedReact = reactBtn && (reactBtn === e.target || reactBtn.contains(e.target));
        if (!picker.contains(e.target) && !clickedReact) {
          self.hideEmojiPicker();
        }
      };
      document.addEventListener('click', self._emojiOutsideClick);
    }

    if (window.g_emojis && window.g_emojis.length) {
      renderPicker(window.g_emojis);
    } else {
      fetch('lang/emojis.json')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          window.g_emojis = data.emojis || [];
          renderPicker(window.g_emojis);
        })
        .catch(function() {
          // Fallback minimal set
          window.g_emojis = ['👍', '👏', '😂', '😮', '🤔', '😢', '🔥', '🎉'];
          renderPicker(window.g_emojis);
        });
    }
  };

  self.showHighScores = async function() {
    if (typeof loadGlobalHighScores === 'function') {
      await loadGlobalHighScores();
    }
    var sLevels = '';
    for (var i = 1; i < 11; ++i) {
      sLevels += '<option' + (i == g_bui.level ? ' selected' : '') + '>' + i + '</option>';
    }
    var elBonusesLayout = el('#bonuseslayout').cloneNode(true);
    var html = '<h2>⭐ ' + t('High Scores') + ' ⭐</h2><div class="table-container"><table><tr class="header">' +
      '<td><select id="highscores-level" title="' + t('Select level') + '" onchange="el(\'highscores-data\').innerHTML=g_bui.renderHighScoreRows(el(\'highscores-layout\').value+\' \'+value);setModalHeight()">' + sLevels + '</select></td>' +
      '<td colspan="3"><select id="highscores-layout" title="' + t('Select bonuses layout') + '" onchange="el(\'highscores-data\').innerHTML=g_bui.renderHighScoreRows(value+\' \'+el(\'highscores-level\').value);setModalHeight()">' + elBonusesLayout.innerHTML + '</select></td></tr>' +
      '<tr class="highlight"><th>' + t('Rank') + '</th><th>' + t('Player') + '</th><th>' + t('Score') + '</th><th>' + t('Date') + '</th></tr><tbody id="highscores-data">' +
      self.renderHighScoreRows(g_layout + ' ' + g_bui.level) + '</tbody></table></div>';
    self.prompt(html, '', 'highscores wide');
  };

  self.showLettersModal = function(bdropCellId) {
    self.bdropCellId = bdropCellId;
    var rlen = 6;
    var llen = g_letters.length;
    var html = '';
    for (var i = 0; i < llen; ++i) {
      var ltr = g_letters[i][0];
      if (ltr !== '*') {
        html += '<button class="button secondary" onclick="g_bui.onSelLetter(\'' + ltr + '\')">';
        html += (ltr === ' ' ? '&nbsp;' : ltr.toUpperCase()) + '</button>';
      }
    }
    html = '<div id="letters">' + html + '</div>';
    showModal(html, 'center wide');
  };

  self.showLobby = function() {
    // Save name
    localStorage.setItem('player_name', g_myName);

    const html = `
<h2>${t('Multiplayer Lobby')}</h2>
<table>
  <tr class="header">
    <td><label for="lobby-name">${t('Your name')}</label></td>
    <td class="input"><input id="lobby-name" value="${g_myName}" maxlength="32"></td>
  </tr>
</table>
<p><strong>${t('Click a player to start a game:')}</strong></p>
<div id="lobby-players" class="table-container">
  <em>${t('Loading...')}</em>
</div>
`;

    self.prompt(html, `<button class="button" onclick="leaveLobby();hideModal()">${t('Close')}</button>`, 'lobby-modal wide');

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
  };

  self.showSwapModal = function() {
    var divs = [];
    var html = '<table id="swaptable" class="centered" title="' + t('Select the letters you want to swap') + '"><tr>';
    for (var i = 0; i < self.racksize; ++i) {
      var rcell = el(self.plrRackId + i);
      if (rcell.holds === '') continue;
      divs.push(rcell.firstChild);
      html += '<td id="swap-candidate' + (divs.length - 1) + '" class="tile" onclick="g_bui.onSwapToggle(this)"></td>';
    }
    html += '</tr></table>';

    // Display the HTML in the modal window
    self.prompt(html, '<button class="button" onclick="g_bui.onSwap()">' + t('Swap') + ' & ' + t('Pass') + '</button>', 'wide');

    // And then fill the DOM in the modal window with the existing letter
    // divs from the players rack
    for (var i = 0; i < divs.length; ++i) {
      self.rd.enableDrag(false, divs[i]); // Disable drag in order to select
      el('swap-candidate' + i).appendChild(divs[i]);
    }
  };

  self.showTilesLeft = function() {
    var oTilesLeft = g_letpool.sort().reduce(function(accumulator, currentValue) {
      if (currentValue === ' ') currentValue = '&lt;' + t('space') + '&gt;';
      else if (currentValue === '*') currentValue = '&lt;' + t('blank') + '&gt;';
      accumulator[currentValue] = (accumulator[currentValue] || 0) + 1;
      return accumulator;
    }, {});
    self.prompt('<div class="debug">' + JSON.stringify(oTilesLeft).replace(/[{}"]/g, '').replace(/([:,])/g, '$1 ') + '</div>', '', 'bag');
  };

  self.toast = function(msg, duration) {
    if (!msg) return;
    var container = getToastContainer();
    if (!container) return;

    // Check for existing visible toast to reuse instead of stacking
    var existing = container.querySelector('.toast-message.show');
    if (existing) {
      existing.textContent = msg;
      existing.classList.remove('hide');
      if (existing._toastTimeout) clearTimeout(existing._toastTimeout);
      if (duration !== 0) {
        existing._toastTimeout = setTimeout(function() {
          existing.classList.remove('show');
          existing.classList.add('hide');
        }, duration || 4000);
      }
      return existing;
    }

    var toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = msg;
    container.insertBefore(toast, container.firstChild);

    window.requestAnimationFrame(function() {
      toast.classList.add('show');
    });

    var timeout;
    if (duration !== 0) {
      timeout = setTimeout(function() {
        toast.classList.remove('show');
        toast.classList.add('hide');
      }, duration || 4000);
    }

    toast.addEventListener('transitionend', function(e) {
      if (e.propertyName !== 'opacity') return;
      if (toast.classList.contains('hide') && toast.parentNode) {
        toast.parentNode.removeChild(toast);
        if (timeout) clearTimeout(timeout);
      }
    });

    return toast;
  };

  // Toggle opponent rack visibility
  /*
  self.toggleORV = function() {
    if (!el('toggle')) return;
    self.showOpRack = 1 - self.showOpRack;
    el('toggle').innerHTML = self.showOpRack ? t('Hide computer&rsquo;s rack') : t('Show computer&rsquo;s rack');
    for (var i = 0; i < self.racksize; ++i) {
      el(self.oppRackId + i).classList.toggle('on', self.showOpRack);
    }
  };
  */

  self.wordInfo = function(word) {
    if (!window.g_defs) {
      alert(t('Word definitions not enabled.'));
      return;
    }
    if (word in g_defs) {
      // Try to get definition locally first
      var html = '<div id="wordresult"><div style="text-align:center"><h1>' + word + '</h1></div>';
      if (typeof g_defs[word] === 'string') {
        html += '<div class="phanloai">&nbsp;</div>' + g_defs[word];
      } else {
        for (var type in g_defs[word]) {
          html += '<div class="phanloai">' + (type || '&nbsp;') + '</div>';
          for (var i = 0, entry; i < g_defs[word][type].length; ++i) {
            entry = g_defs[word][type][i];
            html += '<ul class="list1"><li>' + entry['definition'];
            if (entry['examples']) {
              for (var j = 0; j < entry['examples'].length; ++j) {
                for (var example in entry['examples'][j]) {
                  html += '<ul class="list2"><li><span class="example-original">' + example + '</span><br>' + entry['examples'][j][example] + '</li></ul>';
                }
              }
            }
            html += '</li></ul>';
          }
        }
      }
      html += '</div>';
      self.prompt(html);
    } else {
      self.prompt('<iframe id="dict" src="https://vdict.com/' + encodeURIComponent(word) + ',2,0,0.html"></iframe>', '', 'wordinfo wide');
      gtag('event', word, {
        'event_category': 'Definition',
        'event_label': 'Found'
      });
    }
  };

}

var g_bui = new RedipsUI();
