//------------------------------------------------------------------------------
// Assumptions
// 1. g_bui exists and has the interface for interacting wih the board UI
//    (redips-drag based UI creates g_bui in ui.js)
// 2. g_letters exists and contains the letter distribution and points
//    (defined in xx_letters.js, where xx is the language code)
// 3. g_letrange - the regular expression for the alphabet range of the
//    given language. Defined in xx-letters.js
// 4. t() defined in translate_xx.js and returns the translated text
//    of a string.
//------------------------------------------------------------------------------

const DEBUG = true;

// Configuration
var g_boardwidth = 15;          // How many tiles horizontally
var g_boardheight = 15;         // How many tiles vertically
var g_racksize = 8;             // Max number of letters on racks
var g_animation = 0;            // Animation speed (lower = faster)
var g_wait = 500;               // Wait time in between moves (in ms)

// Don't touch settings below
var g_board;                    // Letters on board
var g_boardpoints;              // Points on board
var g_boardtypes;               // Tile type (1=player, 2=computer)
var g_boardmults;               // Board bonus multipliers (DL, TL, DW, TW)
var g_letpool;                  // Letter pool
var g_letscore;                 // Score for each letter
var g_matches_cache;            // To speed up regex matches
var g_pscore;                   // Player score
var g_oscore;                   // Opponent (computer) score
var g_passes;                   // Number of consecutive passes
var g_board_empty;              // First move flag
var g_opponent_has_joker;       // Optimization flag if computer has joker tile

var g_maxpasses = 3;            // Maximum number of consecutive passes
var g_lmults = [1, 2, 3, 1, 1]; // Letter multipliers by index
var g_wmults = [1, 1, 1, 2, 3]; // Word multipliers by index
var g_allLettersBonus = 50;     // Bonus when all letters in rack are played

// Computer play level
var g_playlevel = g_bui.getPlayLevel();

// Maximum word score for each level
var g_maxwpoints = [10, 20, 30, 40, 50, 75, 100, 125, 250, 500];

// Words grouped by length
var g_wstr = [];
(function() {
  // Build g_wstr list
  var g_wstr_arr = [];
  for (var i in g_wordmap) {
    if (i.length > 15) continue;
    if (!g_wstr_arr[i.length - 2]) g_wstr_arr[i.length - 2] = [];
    g_wstr_arr[i.length - 2].push(i);
  }
  for (var i = 0; i < g_wstr_arr.length; ++i) {
    if (!g_wstr_arr[i]) continue;
    g_wstr.push('_' + g_wstr_arr[i].join('_') + '_');
  }
})();

// Used to store word definition retrieved from the internet
var g_def;

// Words played
var g_history;

// High scores
var g_highscores = localStorage['highscores'] ? JSON.parse(localStorage['highscores']) : {};
var gCompareScores = function(a, b) {
  var nA = a ? a.score : -99;
  var nB = b ? b.score : -99;
  return (nA > nB) ? -1 : ((nA < nB) ? 1 : 0);
};

// Cached elements
var g_cache;

var gCloneFunc = (typeof Object.create === 'function') ? Object.create :
  function(obj) {
    var cl = {};
    for (var i in obj) {
      cl[i] = obj[i];
    }
    return cl;
  };

var gErrPrefix = function() {
  var aPrefixes = [
    'Oops',
    'Sorry',
    'Whoops'
  ];
  return (localStorage['lang'] === 'vi') ? t('Sorry, ') : aPrefixes[randInt(0, aPrefixes.length - 1)] + ', ';
};

//------------------------------------------------------------------------------
function init(iddiv) {
  // Reset
  g_board = [];
  g_boardpoints = [];
  g_boardtypes = [];
  g_letpool = [];
  g_letscore = {};
  g_matches_cache = {};
  g_pscore = 0;
  g_oscore = 0;
  g_passes = 0;
  g_board_empty = true;
  g_history = [];

  // Put all the letters in the pool
  var numalpha = g_letters.length;
  for (var i = 0; i < numalpha; ++i) {
    var letinfo = g_letters[i];
    var whichlt = letinfo[0];
    var lpoints = letinfo[1];
    var numlets = letinfo[2];
    g_letscore[whichlt] = lpoints;
    for (var j = 0; j < numlets; ++j) {
      g_letpool.push(whichlt);
    }
  }

  shufflePool();

  g_bui.create(iddiv, g_boardwidth, g_boardheight, g_letscore, g_racksize, localStorage['layout']);

  g_bui.setOpponentRack(takeLetters(''));
  //g_bui.setOpponentRack(takeLetters('bcdghklm'));
  g_bui.setPlayerRack(takeLetters(''));
  //g_bui.setPlayerRack(takeLetters('qẵễỗệộỵv'));
  g_bui.setTilesLeft(g_letpool.length);
  g_bui.makeTilesFixed();
}

//------------------------------------------------------------------------------
function announceWinner() {
  //console.log('announceWinner');
  var oleft = g_bui.getOpponentRack();
  var pleft = g_bui.getPlayerRack();

  var odeduct = 0;
  for (var i = 0; i < oleft.length; ++i) {
    odeduct += g_letscore[oleft.charAt(i)];
  }

  var pdeduct = 0;
  for (var i = 0; i < pleft.length; ++i) {
    pdeduct += g_letscore[pleft.charAt(i)];
  }

  g_oscore -= odeduct;
  g_pscore -= pdeduct;

  var html = '<table id="gameover" class="centered"><tr>';
  var text = 'GAMEOVER';
  for (var i = 0; i < text.length; ++i) {
    html += '<td class="tile"><div class="drag t' + randInt(1, 2) + '">' + text[i] + '</div></td>';
  }
  html += '</tr></table><ul><li>';
  html += t('You') + ': <strong>' + g_pscore + '</strong></li><li>' + t('Computer') + ': <strong>' + g_oscore + '</strong></li></ul>';
  var msg = '<h3>' + t('It&rsquo;s a tie!');
  if (g_oscore > g_pscore) msg = '<h3 class="opponent">' + t('Computer wins.');
  else if (g_oscore < g_pscore) msg = '<h3 class="player">' + t('You win!');
  html += msg + '</h3>';
  g_bui.prompt(html, '<button class="button" onclick="hideModal();g_bui.restart()">' + t('Play Again') + '</button>', 'gameover wide');
  var timer = setInterval(function() {
    var tile = el('#gameover td:not(.on)');
    if (tile) el('#gameover td:not(.on)').classList.add('on');
    else clearInterval(timer);
  }, 100);

  // Update total scores
  el('oscore').textContent = g_oscore;
  el('pscore').textContent = g_pscore;
  el('score-opponent').textContent = g_oscore;
  el('score-player').textContent = g_pscore;

  // Update high scores table if applicable
  var sHighScoresKey = g_layout + ' ' + g_bui.level;
  var sHighScoresSession = getSession();
  if (!g_highscores[sHighScoresKey]) g_highscores[sHighScoresKey] = [];
  g_highscores[sHighScoresKey].push({
    'player': 'Computer',
    'score': g_oscore,
    'session': sHighScoresSession
  });
  g_highscores[sHighScoresKey].push({
    'player': 'You',
    'score': g_pscore,
    'session': sHighScoresSession
  });
  g_highscores[sHighScoresKey].sort(gCompareScores);
  g_highscores[sHighScoresKey].length = 10;
  localStorage['highscores'] = JSON.stringify(g_highscores);

  // Clear session
  localStorage.removeItem('session');

  // GA
  gtag('event', 'Game Over', {
    'event_category': 'Gameplay - Lvl ' + (g_playlevel + 1),
    'event_label': 'Player=' + g_pscore + ', Computer=' + g_oscore,
    'value': g_letpool.length
  });

}

//------------------------------------------------------------------------------
function checkValidPlacement(placement) {
  if (placement.length === 0) return {
    'played': '',
    'msg': t('no letters were placed.')
  };

  var isplacement = {};
  var worderrs = '';

  var lplayed = '';
  var minx = placement[0].x;
  var miny = placement[0].y;
  var maxx = minx;
  var maxy = miny;
  var dx = 0;
  var dy = 0;

  // In case of first placecement
  var sp = g_bui.getStartXY();
  var onStar = false;

  var x, y, xy;

  for (var i = 0; i < placement.length; ++i) {
    var pl = placement[i];
    if (pl.lsc === 0) lplayed += '*';
    else lplayed += pl.ltr;
    x = pl.x;
    y = pl.y;

    if (x === sp.x && y === sp.y) onStar = true;

    xy = x + '_' + y;
    isplacement[xy] = pl;

    if (minx > x) minx = x;
    if (maxx < x) maxx = x;
    if (miny > y) miny = y;
    if (maxy < y) maxy = y;
  }

  if (miny < maxy) dy = 1;
  if (minx < maxx) dx = 1;

  if (dx === 1 && dy === 1) return {
    'played': '',
    'msg': t('word must be horizontal or vertical.')
  };
  if (g_board_empty && !onStar) return {
    'played': '',
    'msg': t('the first word must be on the purple star in the center.')
  };

  var mbx = g_board.length;
  var mby = mbx;

  if (dx === 0 && dy === 0) {
    // Only one letter was placed
    if ((minx > 0 && g_board[minx - 1][miny] !== '') || (minx < mbx - 1 && g_board[minx + 1][miny] !== '')) {
      dx = 1;
    } else if ((miny > 0 && g_board[minx][miny - 1] !== '') || (miny < mby - 1 && g_board[minx][miny + 1] !== '')) {
      dy = 1;
    } else {
      if (lplayed === ' ') lplayed = '<em>space</em>';
      else if (lplayed === '*') lplayed = '<em>blank</em>';
      else lplayed = lplayed.toUpperCase();
      lplayed = '<strong>' + lplayed + '</strong>';
      var msg = lplayed + t(' is not connected to a word.');
      return {
        'played': '',
        'msg': msg
      };
    }
  }

  var numl = (dx === 1) ? maxx - minx + 1 : maxy - miny + 1;
  var px = minx - dx;
  var py = miny - dy;
  var word = '';

  var wordmult = 1;
  var wscore = 0; // Word score
  var oscore = 0; // Score from orthogonal created words
  var ltr;
  var words = []; // Array of word and orthogonal words created

  for (var i = 0; i < numl; ++i) {
    x = px + dx;
    y = py + dy;

    ltr = g_board[x][y];
    // Spaces in the middle of the word?
    if (ltr === '') return {
      'played': '',
      'msg': t('you have to place tiles next to each other.')
    };

    xy = x + '_' + y;
    if (xy in isplacement) {
      // Check if orthogonal word created
      var pinfo = isplacement[xy];
      var bonus = g_boardmults[x][y];
      var lscr = pinfo.lsc;

      var orthinfo = getOrthWordScore(ltr, lscr, x, y, dx, dy);

      // Add score of newly placed tile
      lscr *= g_lmults[bonus];
      wscore += lscr;
      wordmult *= g_wmults[bonus];

      if (orthinfo.score === -1) {
        if (worderrs !== '') worderrs += ', ';
        worderrs += orthinfo.word.toUpperCase();
      }

      if (orthinfo.score > 0) {
        oscore += orthinfo.score;
        words.push(orthinfo.word);
      }
      //console.log('Orthword: ' + orthinfo.word, 'Score: ' + orthinfo.score);
    } else {
      // Add score of existing tile on board
      wscore += g_boardpoints[x][y];
    }

    word += ltr;
    px += dx;
    py += dy;
  }

  // Add letters from board before placement
  var xpre = minx - dx;
  var ypre = miny - dy;
  while (xpre >= 0 && ypre >= 0 && g_board[xpre][ypre] !== '') {
    ltr = g_board[xpre][ypre];
    wscore += g_boardpoints[xpre][ypre];
    word = ltr + word;
    xpre -= dx;
    ypre -= dy;
  }

  var xpst = maxx + dx;
  var ypst = maxy + dy;
  while (xpst < mbx && ypst < mby && g_board[xpst][ypst] !== '') {
    ltr = g_board[xpst][ypst];
    wscore += g_boardpoints[xpst][ypst];
    word += ltr;
    xpst += dx;
    ypst += dy;
  }

  if (!(word in g_wordmap)) {
    if (worderrs !== '') worderrs += ', ';
    worderrs += word.toUpperCase();
  }

  if (worderrs !== '') {
    // GA
    gtag('event', 'Word Not Found', {
      'event_category': 'Gameplay - Lvl ' + (g_playlevel + 1),
      'event_label': worderrs
    });

    worderrs = '<strong>' + worderrs + '</strong>';
    worderrs += t(' not found in dictionary.');
    return {
      'played': '',
      'msg': worderrs
    };
  }

  if (!g_board_empty && oscore === 0 && word.length === placement.length) {
    // No orthogonal words created and no extension to existing word created;
    // this means that the new word isn't connected to anything.
    return {
      'played': '',
      'msg': t('word is not connected.')
    };
  }

  //console.log('Created word is: ' + word);
  words.push(word);

  return {
    'played': lplayed,
    'score': (wscore * wordmult) + oscore,
    'words': words
  };
}

//------------------------------------------------------------------------------
function findBestMove(opponent_rack) {
  var letters = opponent_rack.split('');

  var board_best_score = -1;
  var board_best_word = null;

  for (var ax = 0; ax < g_board.length; ++ax) {
    for (var ay = 0; ay < g_board[ax].length; ++ay) {
      if (g_board[ax][ay] !== '') continue;
      //console.log('Scanning: ' + ax + ',' + ay);
      // Find the best possible word for board placement at coordinates
      // ax,ay given the current set of letters
      var word = findBestWord(letters, ax, ay);
      if (DEBUG && word.score > -1) console.log('Found word: ' + word.word + ' (' + word.score + ')');
      if (word.score > board_best_score) {
        // If this is better than all the board placements so far,
        // update the best word information
        board_best_score = word.score;
        board_best_word = word;
      }
    }
  }

  if (DEBUG) console.log('Best move:', board_best_word);
  return board_best_word;
}

//------------------------------------------------------------------------------
function findBestWord(letters, ax, ay, dirs) {
  var bestscore = -1;
  var bestword = {
    'score': -1
  };
  if (!dirs) dirs = (Math.random() < 0.5) ? ['x', 'y'] : ['y', 'x'];
  for (var dir in dirs) {
    // Introduce some randomness so computer is more human
    var threshold = randFloat(95, 100, 16);
    if (DEBUG) console.log('Computer has ' + (100 - threshold) + '% chance to skip findBestWord iteration: letters=' + letters.join('') + ', x=' + ax + ', y=' + ay + ', dir=' + dirs[dir]);
    if (Math.random() > threshold / 100) {
      if (DEBUG) console.log('findBestWord skipped for the iteration above');
      continue;
    }
    var xy = dirs[dir];
    var regex = getRegex(xy, ax, ay, letters.join(''));
    if (DEBUG && regex && regex.rgx) console.log('Match pattern: ' + regex.rgx);
    if (regex !== null) {
      var word = getBestScore(regex, letters, ax, ay);
      if (word.score > bestscore) {
        bestscore = word.score;
        bestword = word;
        if (DEBUG) console.log('Best word candidate: ' + word.word + ' (score=' + word.score + ', x=' + word.ax + ', y=' + word.ay + ', dir=' + word.xy + ')');
      }
    }
  }
  return bestword;
}

//------------------------------------------------------------------------------
function findFirstMove(opponent_rack, mid) {
  // Try to find the best move horizontally or vertically along the star axis
  var letters;
  var anchor;
  var alet;
  var aletscr;
  var best_word = { 'score': -1 };
  var selword = { 'score': -1 };
  // Try starting from every position along the x star axis
  var scanX = function() {
    for (var j = 0, x; j < mid + 1; ++j) {
      x = j;
      // Simulate a first letter already existing on the board
      g_board[x][mid] = alet;
      g_boardpoints[x][mid] = aletscr;
      // Find best move along the star axis
      selword = findBestWord(letters, x + 1, mid, ['x']);
      if (selword['score'] > best_word['score'] && selword['ps'] + selword['word'].length > mid) {
        best_word = selword;
        best_word['aletscr'] = aletscr;
      }
      // Remove traces from board for next candidate
      g_board[x][mid] = '';
      g_boardpoints[x][mid] = 0;
    }
  };
  // Try starting from every position along the y star axis
  var scanY = function() {
    for (var j = 0, y; j < mid + 1; ++j) {
      y = j;
      // Simulate a first letter already existing on the board
      g_board[mid][y] = alet;
      g_boardpoints[mid][y] = aletscr;
      // Find best move along the star axis
      selword = findBestWord(letters, mid, y + 1, ['y']);
      if (selword['score'] > best_word['score'] && selword['ps'] + selword['word'].length > mid) {
        best_word = selword;
        best_word['aletscr'] = aletscr;
      }
      // Remove traces from board for next candidate
      g_board[mid][y] = '';
      g_boardpoints[mid][y] = 0;
    }
  };

  // Place each letter on the star to find the best word
  for (var i = 0; i < opponent_rack.length; ++i) {
    letters = opponent_rack.split('');
    anchor = i;
    alet = letters[anchor];
    aletscr = g_letscore[alet];
    // The new rack is what is left after we remove the candidate letter from
    // the starting rack and place it on the board.
    letters.splice(anchor, 1);
    // Find best word along x and y axis
    if (Math.random() < 0.5) {
      scanX();
      scanY();
    } else {
      scanY();
      scanX();
    }
  }

  // No word found
  if (best_word['score'] === -1) return null;

  // Adjust properties for the first move only
  best_word[best_word['xy'] === 'x' ? 'ax' : 'ay'] = best_word['ps'];
  best_word['lscrs'].unshift(best_word['aletscr']);
  best_word['prec'] = '';

  // In the case of the first move, the sequence of played letters and the
  // word played are identical.
  best_word['seq'] = best_word['word'];

  //g_bui.opponentPlay(7, 7, alet, aletscr);
  //console.log('findFirstMove', best_word);
  return best_word;
}

//------------------------------------------------------------------------------
function getBestScore(regex, letters, ax, ay) {
  //console.log('getBestScore', regex, 'letters=' + letters.join(''), 'ax=' + ax, 'ay=' + ay);
  var rletmap = {};
  var numjokers = 0;
  for (var i = 0; i < letters.length; ++i) {
    var ltr = letters[i];
    // Joker
    if (ltr === '*') ++numjokers;
    else if (!(ltr in rletmap)) rletmap[ltr] = 1;
    else ++rletmap[ltr];
  }

  var bestscore = -1;
  var bestword = {
    'score': -1
  };

  if (regex.max - 1 >= g_wstr.length) return bestword;

  var regexp = new RegExp(regex.rgx, 'g');
  var match, matches;
  var req_seq, word;

  for (var wlc = regex.min - 2; wlc < regex.max - 1; ++wlc) {
    var id = regex.rgx + wlc;
    if (id in g_matches_cache) {
      matches = g_matches_cache[id];
    } else {
      matches = [];
      while ((match = regexp.exec(g_wstr[wlc])) !== null) {
        // Go over all matching regex groups for this word
        // (g_wstr[wlc]) and save the required letters
        req_seq = '';
        for (var i = 1; i < match.length; ++i) {
          // Ignore the groups with 'undefined'
          if (match[i]) req_seq += match[i];
        }
        // Save the word and the missing letters
        var mseq = match[0];
        // Remove the marker symbols for the regex match
        word = mseq.substr(1, mseq.length - 2);
        matches.push({
          'word': word,
          'reqs': req_seq
        });
      }

      // Cache the regexp word match and required letters
      g_matches_cache[id] = matches;
    }

    for (var j = 0; j < matches.length; ++j) {

      // We have a word that matches the required regular expression check
      // if we have matching letters for the sequence of missing letters
      // found in the regular expression for this word.

      // Create a count of the letters available to play
      var seq_lscrs = [];

      req_seq = matches[j].reqs;
      word = matches[j].word;

      var letmap = gCloneFunc(rletmap);

      // Check if the letters we have can create the word
      var ok = true;
      var jokers = numjokers;

      for (var i = 0; i < req_seq.length; ++i) {
        var rlet = req_seq.charAt(i);
        //if (rlet in letmap && letmap[rlet]>0 ) {
        // The above is not necessary due to regex optimizations
        if (letmap[rlet] > 0) {
          --letmap[rlet];
          seq_lscrs.push(g_letscore[rlet]);
        } else {
          // We don't have a letter required for this word or we don't
          // have enough of this type of letter
          if (jokers === 0) {
            // And no jokers either - can't create this word
            ok = false;
            break;
          }
          // A joker is required
          --jokers;
          seq_lscrs.push(0); // No points for joker
        }
      }

      // Continue to the next one if can't create this word
      if (!ok) continue;

      // We have all the letters required to create this word
      var wordinfo = {
        'word': word,
        'ax': ax,
        'ay': ay
      };
      wordinfo.seq = req_seq;     // Sequence to put on board
      wordinfo.lscrs = seq_lscrs; // Sequence letter scores
      wordinfo.ps = regex.ps;     // Index of word start
      wordinfo.xy = regex.xy;     // Direction of scan
      wordinfo.prec = regex.prec; // Letters before anchor

      // getWordScore will return the total score of all the orthogonal
      // created words from placing this word. It will also populate
      // wordinfo with a new field words, which will contain the array of
      // the valid created orthogonal words (if score>0).
      var score = getWordScore(wordinfo);

      if (score <= g_maxwpoints[g_playlevel] && bestscore < score) {
        bestscore = score;
        bestword = wordinfo;
        bestword.score = score;
      }
    }
  }
  return bestword;
}

//------------------------------------------------------------------------------
function getOrthWordScore(lseq, lscr, x, y, dx, dy) {
  //console.log('getOrthWordScore', lseq, lscr);
  var wordmult = 1;

  var score = 0;
  var wx = x;
  var wy = y;

  var xmax = g_board.length;
  var ymax = g_board[x].length;

  // If not already there, pretend we've placed the orthogonal anchor on the
  // board so we can include it when scanning the orthogonal word
  var lsave = g_board[wx][wy];
  var ssave = g_boardpoints[wx][wy];

  var bonus = g_boardmults[wx][wy];
  wordmult *= g_wmults[bonus];
  lscr *= g_lmults[bonus];

  g_board[wx][wy] = lseq;
  g_boardpoints[wx][wy] = lscr;

  //console.log('Checking orth: ' + [lseq, x, y]);
  while (x >= 0 && y >= 0 && g_board[x][y] !== '') {
    x -= dy;
    y -= dx;
  }
  if (x < 0 || y < 0 || g_board[x][y] === '') {
    x += dy;
    y += dx;
  }
  var orthword = '';
  while (x < xmax && y < ymax && g_board[x][y] !== '') {
    var letter = g_board[x][y];
    score += g_boardpoints[x][y];
    orthword += letter;
    x += dy;
    y += dx;
  }

  // Orthogonal word built - we can now go back to the previous value on the
  // board in the position of the orthogonal anchor
  g_board[wx][wy] = lsave;
  g_boardpoints[wx][wy] = ssave;

  // The letter does not form an orthogonal word?
  if (orthword.length === 1) return {
    'score': 0,
    'word': orthword
  };

  if (!(orthword in g_wordmap)) return {
    'score': -1,
    'word': orthword
  };

  score *= wordmult;

  //console.log('Orth word: ' + orthword, 'Score: ' + score);
  return {
    'score': score,
    'word': orthword
  };
}

//------------------------------------------------------------------------------
// Get regular expression that matches all the words that qualify being in the
// set of words that place the first letter on the board at anchor position
// ax,ay in direction dir using at most numlets number of letters.
function getRegex(dir, ax, ay, rack) {
  //console.log('getRegex', dir, ax, ay, rack);
  // deX........ => /de[a-z]{1,7}/g
  // ..eX.m..... => /e[a-z]{2}m[a-z]{0,3}/g
  // ...X.m..p.. => /e[a-z]m[a-z]{2}p[a-z]{0,2}/g

  //r = new RegExp("de[a-z]{1,7}", "g")
  //word.match(r); // Returns null if nothing found
  var letrange = '[' + rack + ']';
  if (g_opponent_has_joker) letrange = g_letrange;

  var numlets = rack.length;

  // There's already a letter on the board here?
  if (g_board[ax][ay] !== '') return null;

  var xdir = dir === 'x';

  var ap = xdir ? ax : ay;

  var max = xdir ? g_board.length : g_board[ax].length;

  var dx = xdir ? 1 : 0;
  var dy = 1 - dx;

  //--------------------------------------------------------------------------
  // Check that there is some letter on the board that we can connect to
  var ok = false;

  var l_x = ax - dx; // Board position to left of x
  var a_y = ay - dy; // Board position above y

  // Either placement to left of x or above y has a letter on board?
  if (ap > 0 && g_board[l_x][a_y] !== '') ok = true;

  // Start scanning for letters on board from parallel lines staring at
  // position ax+1,ay or ax,ay+1
  var sc = ap; // sc: short for scan
  var scx = ax + dx;
  var scy = ay + dy;

  // By default, set the minimum location of the first letter found in the
  // parallel line search to be higher than any possible minimum found when
  // building the regex, so that if no minimum is found in the parallel scan,
  // the minimum from the regex creation will be used.
  var sminpos = max;
  var empty;

  if (!ok) empty = 0;

  // No board letters to the left or above anchor, check if lines parallel to
  // direction have letters in them.
  while (sc < max - 1) {
    if (g_board[scx][scy] !== '') {
      ok = true;
      break;
    } else {
      ++empty;
    }

    // Stop if we can't get further than this point with the number of
    // letters that we have
    if (empty > numlets) break;

    a_y = scy - dx;     // x line above y
    l_x = scx - dy;     // y line left of x
    var b_y = scy + dx; // x line below y
    var r_x = scx + dy; // y line right of x
    if (l_x >= 0 && a_y >= 0 && g_board[l_x][a_y] !== '' || r_x < max && b_y < max && g_board[r_x][b_y] !== '') {
      // Found a board letter to the left or above the scanned line
      sminpos = sc + 1;
      ok = true;
      break;
    }

    scx += dx;
    scy += dy;
    ++sc;
  }

  // No letters that we can connect to from ax,ay?
  if (!ok) return null;

  //--------------------------------------------------------------------------
  // Find any letters immediately preceeding the first placement location

  var ps = ap - 1;
  var xs = ax - dx;
  var ys = ay - dy;
  while (ps >= 0 && g_board[xs][ys] !== '') {
    xs -= dx;
    ys -= dy;
    --ps;
  }

  if (ps < 0) {
    ps = 0;
    if (xs < 0) xs = 0;
    else if (ys < 0) ys = 0;
  }

  var prev = '';
  for (var i = ps; i < ap; ++i) {
    prev += g_board[xs][ys];
    xs += dx;
    ys += dy;
  }
  // prev now contains the sequence of letters that immediatly preceede the
  // anchor position (either above it or to it's left, depending on the
  // direction context).

  //--------------------------------------------------------------------------
  // Generate the regular expression for the possible words starting at ax,ay
  // using direction dir. Also calculate minimum word size, maximum word size,
  // and word starting position.

  var x = ax; // x anchor coordinate
  var y = ay; // y anchor coordinate
  var p = ap; // Either ax or ay, depending on the context

  var mws = '_'; //'^'; // Marker for word start
  var mwe = '_'; //'$'; // Marker for word end
  var regex = mws + prev; // regexp match
  var regex2 = ''; // Another possible match
  var letters = 0;
  var blanks = 0;

  var minl = 0; // Minimum word length that can be created
  var minplay = 1; // No letters were played yet

  var countpost; // Flag to include letters in line for minl count

  var prevlen = prev.length;

  var flpos = ap;
  var l;
  // Iterate over word letters
  while (p < max) {
    // l is the letter at position x,y on the board
    l = g_board[x][y];
    if (l === '') {
      // There is no letter at board position x,y
      if (p === ap && prevlen > 0) {
        minl = prevlen + 1;
        // Start adding additional board letters to minimum word length
        countpost = true;
      } else {
        // Stop adding additional board letters to minimum word length
        countpost = false;
      }

      ++blanks;
      if (letters === numlets - 1) break;
      ++letters;
    } else {
      if (blanks > 0) {
        if (regex.indexOf('(') > 0) regex2 += '|' + regex + mwe;
        regex += '(' + letrange;
        if (blanks > 1) {
          // If there are two or more free spaces, we can add another
          // match for a shorter word without the connecting to
          // additional letters in same line on board. For example,
          //
          // ..ad..sing (two blanks after d)
          //
          // should make it possible to find ..adD.sing and also
          // ..adVIsing, so the search should match _ad([a-z]{1})_ or
          // _ad([a-z]{2})sing_
          if (p === ap + blanks) {
            if (prev !== '') regex2 += '|' + regex + (blanks > 2 ? '{1,' + (blanks - 1) + '}' : '') + ')' + mwe;
          } else {
            regex2 += '|' + regex;
            if (blanks > 2) regex2 += '{1,' + (blanks - 1) + '}';
            regex2 += ')' + mwe;
          }
          regex += '{' + blanks + '}';
        }
        regex += ')'; // Close group capture
        if (minl === 0) {
          minl = prevlen + blanks;
          // Start adding additional board letters to minimum word
          // length
          countpost = true;
        }
        // Save 1st letter position?
        if (countpost && flpos === ap) flpos = p;
        blanks = 0;
      }
      regex += l;
      if (countpost) ++minl;
      minplay = 0; // Letters were played
    }
    x += dx;
    y += dy;
    ++p;
  }

  if (blanks > 0) {
    // Last place was a blank
    regex += '(' + letrange;
    if (p === max) {
      // And it was the end of the board
      regex += '{' + minplay + ',' + blanks + '}';
    } else {
      // Used all the letters before reaching the end of the board;
      // check the next board space
      if (g_board[x][y] === '') {
        regex += '{' + minplay + ',' + blanks + '}';
      } else {
        regex += '{' + blanks + '}';
        for (var i = p + 1; i < max; ++i) {
          l = g_board[x][y];
          if (l === '') break;
          regex += l;
          x += dx;
          y += dy;
        }
      }
    }
    regex += ')'; // Close group capture
  }

  // flpos - position of first letter that was found when generating the regex
  // sminpos - first letter found in parallel line scan
  //console.log('flpos=' + flpos, 'sminpos=' + sminpos);
  if (flpos === ap) {
    // No first letter was found in the regex scan

    // Are there any letters before the anchor ?
    // If yes, then the minimum is one more
    if (prev !== '') minl = prevlen + 1;
    // If no, then set the minimum word length to be the distance to the
    // first letter found in the parallel line scan
    else minl = sminpos - ap + 1;
  } else {
    var mindiff = flpos - sminpos;
    // If the regex scan first letter position is at a distance of two or
    // more further from the parallel scan first letter position, then the
    // minimum word length is the distance from the anchor to the first
    // letter found in the parallel scan.
    if (mindiff > 1) minl -= mindiff;
  }

  var s = ap - prev.length;

  // If there was another possible match, then add it
  regex += mwe + regex2;

  // Example: { rgx: '^am[a-z]{2}t$', xs: 0, min: 3, max: 5, prf: 'am' }
  // will be returned for |am*.t|
  // TODO: optimize by eliminating length 4 in this case
  var res = {
    'min': minl,
    'max': p - s,
    'prec': prev,
    'ps': s,
    'rgx': regex,
    'xy': dir
  };

  return res;
}

//------------------------------------------------------------------------------
function getWordScore(wordinfo) {
  //console.log('getWordScore', wordinfo);
  var xdir = (wordinfo.xy === 'x');
  var ax = wordinfo.ax;
  var ay = wordinfo.ay;
  var max = xdir ? g_board.length : g_board[ax].length;

  var dx = xdir ? 1 : 0;
  var dy = 1 - dx;
  var ps = wordinfo.ps;
  var seq = wordinfo.seq;
  var seqc = 0;
  var x;
  var y;

  //console.log('Checking orthogonals for: ' + wordinfo.word, 'Direction: ' + wordinfo.xy, wordinfo);

  if (xdir) {
    x = ps;
    y = ay;
  } else {
    x = ax;
    y = ps;
  }

  var owords = []; // List of valid orthogonal words created with this move
  var wscore = 0;  // Word score
  var oscore = 0;  // Orthogonal created words score

  var lcount = 0;
  var lscores = wordinfo.lscrs;
  var wordmult = 1;
  var bonus, lscr, lseq, ows;

  while (ps < max) {
    // Bonus of newly placed tile
    bonus = g_boardmults[x][y];
    wordmult *= g_wmults[bonus];
    if (g_board[x][y] === '') {
      lscr = lscores[seqc];      // Score of letter in sequence
      lseq = seq.charAt(seqc++); // The letter itself

      // Calculate the orthogonal word score
      ows = getOrthWordScore(lseq, lscr, x, y, dx, dy);

      // An invalid orthogonal word was created?
      if (ows.score === -1) return -1;

      if (ows.score > 0) owords.push(ows.word);

      lscr *= g_lmults[bonus];
      wscore += lscr;
      oscore += ows.score;

      //console.log('***', ows.word, 'x=' + x, 'y=' + y, 'wordmult=' + wordmult, 'lscr=' + lscr, 'wscore=' + wscore, 'oscore=' + oscore, 'seq=' + seq, 'seqc=' + seqc, 'lcount=' + lcount);
    } else {
      // Add score of existing tile on board
      //console.log('*** Existing', g_board[x][y], wscore + ' + (' + g_boardpoints[x][y] + ' * ' + g_lmults[bonus] + ')');
      wscore += g_boardpoints[x][y] * g_lmults[bonus];
    }
    x += dx;
    y += dy;
    ++ps;

    // All letters and possible created words have been checked?
    if (++lcount === wordinfo.word.length) break;
  }

  //console.log('*** End loop', 'wordmult=' + wordmult, 'lscr=' + lscr, 'wscore=' + wscore, 'oscore=' + oscore, 'seq=' + seq, 'seqc=' + seqc, 'lcount=' + lcount);

  //console.log('Word: ' + wordinfo.word, 'Mult: ' + wordmult);
  wscore *= wordmult;

  if (seq.length === g_racksize) wscore += g_allLettersBonus;

  wordinfo.owords = owords;
  return wscore + oscore;
}

//------------------------------------------------------------------------------
function onPlayerClear() {
  g_bui.cancelPlayerPlacement();
}

//------------------------------------------------------------------------------
function onPlayerMove() {
  //console.log('onPlayerMove');
  var passed = self.passed;
  if (passed) {
    ++g_passes; // Increase consecutive opponent passes
    if (g_passes >= g_maxpasses) {
      announceWinner();
      return;
    }
  }

  var boardinfo = g_bui.getBoard();
  //console.log('onPlayerMove', boardinfo);
  g_board = boardinfo.board;
  g_boardpoints = boardinfo.boardp;
  g_boardtypes = boardinfo.boardt;

  if (!passed) {
    var pinfo = checkValidPlacement(g_bui.getPlayerPlacement());
    var pstr = pinfo.played;

    if (pstr === '') {
      g_bui.prompt(gErrPrefix() + pinfo.msg);
      return;
    }

    //console.log('Player placement chars: ' + pstr);
    g_bui.acceptPlayerPlacement();
    // Placement made
    if (g_board_empty) {
      g_board_empty = false;
      el('a.link.up').classList.add('disabled');
      el('a.link.down').classList.add('disabled');
      el('bonuseslayout').disabled = true;
    }
    // Reset consecutive passes
    g_passes = 0;

    if (pstr.length === g_racksize) g_pscore += g_allLettersBonus;

    g_pscore += pinfo.score;
    g_bui.setPlayerScore(pinfo.score, g_pscore);

    g_bui.addToHistory(pinfo.words, 1);
    //console.log('Removing player chars: ' + pstr);
    g_bui.removeFromPlayerRack(pstr);
    var pletters = g_bui.getPlayerRack();
    //console.log('Left on player rack: ' + pletters);
    pletters = takeLetters(pletters);
    if (pletters === '') {
      // All tiles were played and nothing left in the tile pool
      announceWinner();
      return;
    }
    //console.log('Setting player rack to: ' + pletters);
    g_bui.setPlayerRack(pletters);
    g_bui.setTilesLeft(g_letpool.length);
  } else {
    // Put back whatever was placed on the board
    g_bui.cancelPlayerPlacement();
    //console.log('After cancel, left on player rack: ' + g_bui.getPlayerRack());
  }

  var ostr = g_bui.getOpponentRack();
  g_opponent_has_joker = ostr.search('\\*') !== -1;
  g_playlevel = g_bui.getPlayLevel();

  if (DEBUG) console.log('Opponent rack has: ' + ostr);

  var play_word;
  if (g_board_empty) {
    var start = g_bui.getStartXY();
    play_word = findFirstMove(ostr, start.y);
  } else {
    play_word = findBestMove(ostr);
  }

  //console.log('Opponent word is: ' + play_word.word);

  var animCallback = function() {
    g_bui.makeTilesFixed();
    // Create the array of word and created orthogonal words created by
    // opponent move.
    var words = play_word.owords;
    words.push(play_word.word);

    // And send it to the played history window
    g_bui.addToHistory(words, 2);

    var score = play_word.score;
    g_oscore += score;
    if (play_word.seq.length === g_racksize) g_oscore += g_allLettersBonus;
    g_bui.setOpponentScore(score, g_oscore);

    var played = play_word.seq;

    var letters_used = '';
    for (var i = 0; i < played.length; ++i) {
      var pltr = played.charAt(i);
      if (ostr.search(pltr) > -1) letters_used += pltr;
      else letters_used += '*';
    }
    g_bui.removeFromOpponenentRack(letters_used);

    // Get letters from pool as number of missing letters
    if (DEBUG) console.log('Opponent rack left with: ' + g_bui.getOpponentRack());
    var newLetters = takeLetters(g_bui.getOpponentRack());
    if (newLetters === '') {
      // All tiles taken, nothing left in tile pool
      announceWinner();
      return;
    }
    if (DEBUG) console.log('After taking letters, opponent rack is: ' + newLetters);
    g_bui.setOpponentRack(newLetters);
    g_bui.setTilesLeft(g_letpool.length);
    el('pass').disabled = false;
    // Save session
    localStorage['session'] = getSession();
  };

  if (play_word !== null) {
    placeOnBoard(play_word, animCallback);
    g_passes = 0; // Reset consecutive opponent passes
  } else {
    // GA
    gtag('event', 'Computer ' + (g_letpool.length === 0 ? 'Pass' : 'Swap'), {
      'event_category': 'Gameplay - Lvl ' + (g_playlevel + 1),
      'event_label': '[' + g_bui.getOpponentRack() + ']',
      'value': g_letpool.length
    });

    ++g_passes; // Increase consecutive opponent passes

    if (g_passes >= g_maxpasses) {
      announceWinner();
    } else {
      // Swap up to four random tiles
      g_bui.makeTilesFixed();
      if (g_letpool.length > 0) {
        var tilesToSwap = Math.min(Math.ceil(g_racksize / 2), ostr.length, g_letpool.length);
        // Shuffle rack
        var _a = ostr.split('');
        var _tmp;
        var letpts = [];
        for (var i = _a.length - 1, j; i > 0; --i) {
          j = Math.floor(Math.random() * (i + 1));
          _tmp = _a[i];
          _a[i] = _a[j];
          _a[j] = _tmp;
          letpts.push([_a[i], g_letscore[_a[i]]]);
        }
        // Reorder rack by points to swap letters with most points
        letpts.sort(function(a, b) {
          return b[1] - a[1];
        });
        letpts = letpts.map(function(v) {
          return v[0];
        });
        ostr = letpts.join('');
        var keep = ostr.slice(tilesToSwap);
        var swap = ostr.substr(0, tilesToSwap);
        // Put swapped letters back into the bag
        for (var i = 0; i < swap.length; ++i) {
          g_letpool.push(swap.charAt(i));
        }
        // Shake the bag
        shufflePool();
        g_bui.setOpponentRack(takeLetters(keep));
        g_bui.prompt(t('I swap, your turn.'));
        if (DEBUG) console.log('Opponent swapped ' + swap + ' for ' + g_bui.getOpponentRack().slice(-1 * tilesToSwap));
      } else {
        g_bui.prompt(t('I pass, your turn.'));
      }
      el('pass').disabled = false;
      // Save session
      localStorage['session'] = getSession();
    }

    return;
  }

}

//------------------------------------------------------------------------------
function onPlayerMoved(passed, swapped) {
  //console.log('onPlayerMoved', passed, swapped);
  if (passed) {
    el('pass').disabled = true;
    g_bui.cancelPlayerPlacement();
    g_bui.showBusy();
  }
  self.passed = passed;
  clearTimeout(g_bui.timer); // Clear hideModal() 300ms delay
  setTimeout(onPlayerMove, 100);

  if (passed) {
    // GA
    gtag('event', 'Player ' + (swapped ? 'Swap' : 'Pass'), {
      'event_category': 'Gameplay - Lvl ' + (g_playlevel + 1),
      'event_label': '[' + g_bui.getPlayerRack() + ']',
      'value': g_letpool.length
    });
  }
}

//------------------------------------------------------------------------------
function onPlayerShuffle() {
  var elClear = el('clear');
  elClear.disabled = true;
  document.documentElement.classList.add('shuffling');
  var indexes = [];
  var totalanims = 0;
  var animDone = function() {
    if (++totalanims === g_racksize / 2) {
      elClear.disabled = false;
      document.documentElement.classList.remove('shuffling');
    }
  };
  for (var i = 0; i < g_racksize; ++i) {
    indexes.push(i);
  }
  var rnd, i, j;
  while (indexes.length > 0) {
    rnd = Math.floor(Math.random() * indexes.length);
    i = indexes[rnd];
    indexes.splice(rnd, 1);
    rnd = Math.floor(Math.random() * indexes.length);
    j = indexes[rnd];
    indexes.splice(rnd, 1);
    g_bui.rd.moveObject({
      'obj': el('pl' + i).firstChild,
      'target': el('pl' + j)
    });
    g_bui.rd.moveObject({
      'obj': el('pl' + j).firstChild,
      'target': el('pl' + i),
      'callback': animDone
    });
  }
}

//------------------------------------------------------------------------------
function onPlayerSwap() {
  if (g_letpool.length === 0) {
    g_bui.prompt(gErrPrefix() + t('no tiles left to swap.'));
    return;
  }
  // If there were any tiles from the player's rack on the board, put them
  // back on the rack.
  g_bui.cancelPlayerPlacement();
  g_bui.showSwapModal();
}

//------------------------------------------------------------------------------
function onPlayerSwapped(keep, swap) {
  //console.log('onPlayerSwapped', keep, swap);
  if (swap.length === 0) {
    g_bui.setPlayerRack(keep);
    // Initialize REDISP again
    g_bui.makeTilesFixed();
    return;
  }
  // Put swapped letters back into the bag
  for (var i = 0; i < swap.length; ++i) {
    g_letpool.push(swap.charAt(i));
  }
  // Shake the bag
  shufflePool();
  g_bui.setPlayerRack(takeLetters(keep));
  onPlayerMoved(true, true);
}

//------------------------------------------------------------------------------
function placeOnBoard(word, animCallback) {
  //console.log('placeOnBoard', word);
  var lcount = 0;
  var seqlen = word.seq.length;
  var dx = 1;
  var dy = 0;
  if (word.xy === 'y') {
    dx = 0;
    dy = 1;
  }
  var x = word.ax;
  var y = word.ay;
  var placements = [];
  var ltr, lscr;
  while (lcount < seqlen) {
    if (g_board[x][y] === '') {
      ltr = word.seq.charAt(lcount);
      lscr = word.lscrs[lcount++];
      placements.push({
        'x': x,
        'y': y,
        'ltr': ltr,
        'lscr': lscr
      });
      //g_bui.opponentPlay(x, y, ltr, lscr);
      //console.log('placeOnBoard', ltr, lscr);
      g_board[x][y] = ltr;
      g_boardpoints[x][y] = lscr;
      g_boardtypes[x][y] = 2;
    }
    x += dx;
    y += dy;
  }
  hideModal();
  g_bui.playOpponentMove(placements, animCallback);
  if (g_board_empty) {
    g_board_empty = false;
    el('a.link.up').classList.add('disabled');
    el('a.link.down').classList.add('disabled');
    el('bonuseslayout').disabled = true;
  }
}

//------------------------------------------------------------------------------
function shufflePool() {
  var total = g_letpool.length;
  var rnd, c;
  for (var i = 0; i < total; ++i) {
    rnd = Math.floor(Math.random() * total);
    c = g_letpool[i];
    g_letpool[i] = g_letpool[rnd];
    g_letpool[rnd] = c;
  }
}

//------------------------------------------------------------------------------
function takeLetters(existing) {
  var poolsize = g_letpool.length;
  if (poolsize === 0) return existing;
  var needed = Math.min(g_racksize - existing.length, poolsize);
  var letters = g_letpool.splice(0, needed).join('');
  return existing + letters;
}

window['init'] = init;
