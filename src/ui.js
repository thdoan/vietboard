// Assumptions:
// 1. redipsdrag.js has already been included
// 2. g_boardm exists and its init method returns the bonus layout (defined in bonuses.js)

// VDict callback function
function cb(data) {
  g_def = data.result;
}

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
  localStorage['lang'] = sLang;
  // GA
  gtag('event', sLang, {
    'event_category': 'Language'
  });
  location.reload();
}

// Set bonuses layout
function setLayout(elSelect) {
  localStorage['layout'] = elSelect.value;
  // GA
  gtag('event', elSelect.value, {
    'event_category': 'Bonuses Layout'
  });
  location.reload();
}

// Set tileset
function setTileset(elSelect) {
  localStorage['tileset'] = elSelect.value;
  // GA
  gtag('event', elSelect.value, {
    'event_category': 'Tileset'
  });
  location.reload();
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
  g_bui.create('board', g_boardwidth, g_boardheight, g_letscore, g_racksize, g_layout, isHighScore);
  g_bui.setOpponentRack(oSession['orack']);
  g_bui.setPlayerRack(oSession['prack']);
  g_matches_cache = {};
  g_board_empty = oSession['empty'];
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
function loadHighScore(sKey, nIndex) {
  if (!localStorage['session']) localStorage['session'] = getSession();
  g_bui.created = false;
  load(g_highscores[sKey][nIndex]['session'], true);
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
          elStatus.textContent = t('Computer') + ' ' + t('scored ') + el('loscore').textContent + ' ' + t(' points for ') + words.join(', ').toUpperCase();
          gtag('event', 'Computer Move', {
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
    var divs = [];
    var id;
    for (var i = 0; i < placement.length; ++i) {
      id = placement[i].id;
      if (cellId && cellId !== id) continue;
      var cell = el(id);
      divs.push(cell.firstChild);
      cell.holds = '';
      cell.innerHTML = '';
    }
    var count = 0;
    for (var i = 0; i < self.racksize; ++i) {
      id = self.plrRackId + i;
      var rcell = el(id);
      if (rcell.holds === '' && count < divs.length) {
        var div = divs[count++];
        // Joker tile - remove previously selected letter from tile?
        if (div.holds.points === 0) div.innerHTML = '&nbsp;&nbsp;';
        rcell.appendChild(div);
        rcell.holds = self.hcopy(div.holds);
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

    g_cache['html'].miscBtns =
      '<button id="highscores" class="button secondary" title="' + t('High Scores') + '" onclick="g_bui.showHighScores()"><img src="pics/highscores.svg" alt="' + t('High Scores') + '"></button>' +
      '<button id="restart" class="button secondary" title="' + t('Restart') + '" onclick="g_bui.restart();if(g_isMobile)hideGameInfo()"><img src="pics/restart.svg" alt="' + t('Restart') + '"></button>';

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
      '<a class="link up' + (isDisabled ? ' disabled' : '') + '" title="' + t('Increase difficulty') + '" aria-label="' + t('Increase difficulty') + '" onclick="g_bui.levelUp()">' + arrow + '</a>' +
      '<a class="link down' + (isDisabled ? ' disabled' : '') + '" title="' + t('Decrease difficulty') + '" aria-label="' + t('Decrease difficulty') + '" onclick="g_bui.levelDn()">' + arrow + '</a></td></tr>';

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
      '<tr class="highlight"><td>' + t('Your total score:') + '</td><td id="pscore">0</td></tr>' +
      hr +
      '<tr><td>' + t('Computer&rsquo;s last score:') + '</td><td id="loscore">0</td></tr>' +
      '<tr class="highlight"><td>' + t('Computer&rsquo;s total score:') + '</td><td id="oscore">0</td></tr>' +
      hr;
    if (DEBUG) html += '<tr><td>' + t('Tiles left:') + '</td><td id="tleft"></td></tr>' + hr;
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
    html += '<td class="mark"' + (g_isMobile ? ' colspan="8"' : '') + '>' +
      (isHighScore ? '<button class="button secondary wide" onclick="g_bui.created=false;load(localStorage[\'session\'])">' + t('Return to Game') + '</button>' :
      '<button class="button" onclick="onPlayerMoved()">' + t('Play') + '</button>' +
      '<button id="clear" class="button secondary" onclick="onPlayerShuffle()">' + t('Shuffle') + '</button>' +
      '<button class="button secondary" onclick="onPlayerSwap()">' + t('Swap') + '</button>' +
      '<button id="pass" class="button secondary" onclick="onPlayerMoved(true)">' + t('Pass') + '</button>') +
      '</td></tr></table></div>';

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
    return self.racks[1];
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

  self.initRedips = function() {
    self.rd.init();
    self.rd.dropMode = 'single';
    //self.rd.style.borderDisabled = 'solid'; // Border style for disabled element unchanged
    self.rd.animation.pause = g_animation; // Set animation loop pause

    self.rd.event.dropped = function() {
      //console.log(self.rd.obj.holds);
      var holds = self.hcopy(self.rd.obj.holds);
      self.rd.td.target.holds = holds;
      var id = self.rd.td.target.id;
      var sc = self.rd.td.source.id.charAt(0);
      if (id.charAt(0) === self.boardId) {
        // Tile dropped on playing board
        self.playSound();
        el('clear').textContent = t('Clear');
        el('clear').onclick = onPlayerClear;
        console.log(holds, self.rd.td.source, self.boardId);
        if (holds && holds.points === 0) { // Joker
          self.showLettersModal(id);
          return;
        }
        self.newplays[id] = self.hcopy(holds);
      } else if (id.charAt(0) === 'p') {
        // Tile dropped on player rack
        if (holds && holds.points === 0 // Joker
          && sc === self.boardId) {     // Taken board to rack
          // Remove selected letter from joker tile
          self.rd.obj.innerHTML = '';
          self.rd.obj.holds = {
            'letter': '',
            'points': 0
          };
        }
        if (Object.keys(self.newplays).length === 0) {
          el('clear').textContent = t('Shuffle');
          el('clear').onclick = onPlayerShuffle;
        }
      }
    };
    self.rd.event.moved = function() {
      self.rd.td.source.holds = '';
      var id = self.rd.td.source.id;
      // Tile lifted from playing board
      if (id.charAt(0) === self.boardId) delete self.newplays[id];
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
    for (var i = 0; i < placements.length; ++i) {
      var placement = placements[i];
      var l = placement.ltr;
      if (l in dlet) dlet[l].push(placement);
      else dlet[l] = [placement];
      // If letter is not on rack, then a joker is used. Put a letter in
      // the blank tile before it is animating to the board. After the
      // process below, orack will be a string of the original opponent
      // rack with all the letters used in the opponent word converted to _.
      if (orack.search(l) === -1) {
        var jpos = orack.search('\\*');
        // Replace joker symbol with a different symbol
        orack = orack.replace('*', '_');
        // Expose joker letter value in new rack
        newrack = newrack.replace('*', l);
        l = (l !== ' ') ? l.toUpperCase() : '&nbsp;&nbsp;';
        el(self.oppRackId + jpos).innerHTML = '<div class="drag t2">' + l + '</div>';
      } else {
        orack = orack.replace(l, '_');
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
    for (var i = 0; i < rack.length; ++i) {
      var rlet = rack[i];
      if (rlet in dlet && dlet[rlet].length > 0) {
        // Get the placement info for this letter
        var move = dlet[rlet][0];
        // And position of the corresponding letter on opponent's rack
        var opid = self.oppRackId + i;
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
        self.animTiles = placements.length;
        self.animCallback = callback;
        var moveinfo = {
          'obj': div,
          'target': cell,
          'callback': self.animDone
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

    // Now animate the letters to their correct position in the board by the
    // order in which they appear in the word. For this we need to sort the
    // letters to animate according to their position in the word.
    function compareByX(a, b) {
      return a.x - b.x;
    }

    function compareByY(a, b) {
      return a.y - b.y;
    }

    var totalanims = lettermoves.length;
    if (totalanims > 1) {
      if (lettermoves[0].x !== lettermoves[1].x) lettermoves.sort(compareByX);
      else lettermoves.sort(compareByY);
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
      (button || '<button class="button" onclick="hideModal()">' + t('OK') + '</button>') +
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
        delete rack[i];
        --dlet[rlet];
      }
    }

    //if (pl === 1) console.log('removeFromRack leaves: ' + rack);
    self.racks[pl] = rack.join('');
  };

  self.renderHighScoreRows = function(sKey) {
    var html = '';
    if (g_highscores[sKey]) {
      for (var i = 0; i < g_highscores[sKey].length; ++i) {
        if (!g_highscores[sKey][i]) break;
        html += '<tr><td>' + g_highscores[sKey][i]['player'] +
          '</td><td><a class="link" title="' + t('View this match') + '" onclick="loadHighScore(\'' + sKey + '\',' + i + ')" tabindex="1">' +
          g_highscores[sKey][i]['score'] + '</a></td></tr>';
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

    for (var i = 0; i < self.racksize; ++i) {
      var id = ifprfx + i;
      var rcell = el(id);
      // Remove the existing drag div?
      if (rcell.firstChild) rcell.removeChild(rcell.firstChild);
      var ltr = i < letters.length ? letters.charAt(i) : '';
      if (ltr !== '') {
        cells.push(rcell);
        var html = '<div class="drag t' + player + '">';
        var holds = {
          'letter': ltr,
          'points': self.scores[ltr]
        };
        rcell.holds = holds;
        if (ltr !== '*') {
          var char = upper.charAt(i);
          html += (char !== ' ' ? char : '&nbsp;&nbsp;') + '<sup><small>' + self.scores[ltr] + '</small></sup>';
        } else {
          html += '&nbsp;&nbsp;';
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

  self.setOpponentRack = function(letters) {
    self.setLetters(2, letters);
  };

  self.setOpponentScore = function(last, total) {
    el('loscore').textContent = last;
    el('oscore').textContent = total;
    el('score-opponent').textContent = total;
  };

  self.setTilesLeft = function(left) {
    if (!el('tleft')) return;
    el('tleft').innerHTML = '<a href="javascript:g_bui.showTilesLeft()">' + left + '</a>';
  };

  self.showBusy = function() {
    showModal(t('Computer thinking, please wait...'));
  };

  self.showHighScores = function() {
    var sLevels = '';
    for (var i = 1; i < 11; ++i) {
      sLevels += '<option' + (i == g_bui.level ? ' selected' : '') + '>' + i + '</option>';
    }
    var elBonusesLayout = el('#bonuseslayout').cloneNode(true);
    var html = '<table id="highscores"><tr class="header">' +
      '<td><select id="highscores-level" title="' + t('Select level') + '" onchange="el(\'highscores-data\').innerHTML=g_bui.renderHighScoreRows(el(\'highscores-layout\').value+\' \'+value);setModalHeight()">' + sLevels + '</select></td>' +
      '<td><select id="highscores-layout" title="' + t('Select bonuses layout') + '" onchange="el(\'highscores-data\').innerHTML=g_bui.renderHighScoreRows(value+\' \'+el(\'highscores-level\').value);setModalHeight()">' + elBonusesLayout.innerHTML + '</select></td></tr>' +
      '<tr class="highlight"><th>Player</th><th>Score</th></tr><tbody id="highscores-data">' +
      self.renderHighScoreRows(g_layout + ' ' + g_bui.level) + '</tbody></table>';
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

  self.showSwapModal = function() {
    var divs = [];
    var html = '<table id="swaptable" class="centered" title="' + t('Select the letters you want to swap') + '"><tr>';
    for (var i = 0; i < self.racksize; ++i) {
      var rcell = el(self.plrRackId + i);
      if (rcell.holds === '') continue;
      divs.push(rcell.firstChild);
      html += '<td id="swap-candidate' + i + '" class="tile" onclick="g_bui.onSwapToggle(this)"></td>';
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
      if (currentValue === ' ') currentValue = '&lt;space&gt;';
      else if (currentValue === '*') currentValue = '&lt;blank&gt;';
      accumulator[currentValue] = (accumulator[currentValue] || 0) + 1;
      return accumulator;
    }, {});
    self.prompt('<div class="debug">' + JSON.stringify(oTilesLeft).replace(/[{}"]/g, '').replace(/([:,])/g, '$1 ') + '</div>');
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
      // If it doesn't exist, look it up online
      getJsonp('https://m.vdict.com/mobile/dictjson?fromapp=1&word=' + encodeURIComponent(word) + '&dict=2', function() {
        g_def = g_def.replace('href="#"', 'title="' + t('Listen to pronunciation') + '" onclick="el(\'audio\').play()"');
        g_def = g_def.replace(' Suggestions:', '');
        g_def = g_def.replace(/">(.+?) not found/, '"><strong>$1</strong> ' + t('has no definition or may be part of a compound word'));
        self.prompt(g_def);
        // GA
        gtag('event', word, {
          'event_category': 'Definition',
          'event_label': g_def.indexOf('</strong> ' + t('not found')) < 0 ? 'Found' : 'Not Found'
        });
      });
    }
  };

}

var g_bui = new RedipsUI();
