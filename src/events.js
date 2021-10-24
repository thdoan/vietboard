/**
 * EVENTS
 */

// Close the modal properly
function closeModal() {
  if (el('swaptable')) {
    g_bui.onSwap(true);
  } else if (el('letters')) {
    // Clear Blank tile if closing modal without selecting a letter
    g_bui.cancelPlayerPlacement(g_bui.onSelLetter('*'));
  } else {
    var elButton = g_cache['modalContent'].querySelector('.button');
    if (elButton) elButton.click();
    else hideModal();
  }
}

// Handle modal interactions
function handleHideModal(e) {
  if (e.target && e.target.id === 'modal-inner') closeModal();
}

// Handle keyboard shortcuts
function handleKeyDown(e) {
  // Close modal on Escape
  if (e.key === 'Escape') closeModal();
}

// Cycle through icon/logo colors
function spinColors(elImg) {
  var nTick = 0;
  var nTimer = setInterval(function() {
    elImg.style.filter = 'hue-rotate(' + randInt(0, 360) + 'deg)';
    if (++nTick === 20) {
      clearInterval(nTimer);
      [].forEach.call(document.querySelectorAll('img[alt="Vietboard"]'), function(_el) {
        if (_el === elImg) return;
        _el.style.filter = elImg.style.filter;
      });
    }
  }, 100);
}

// Activate marquee in status
function startMarquee(elStatus) {
  if (elStatus.classList.contains('marquee')) return;
  elStatus.classList.toggle('marquee', elStatus.offsetWidth < elStatus.scrollWidth);
  clearTimeout(elStatus['marqueeTimeout']);
  elStatus['marqueeTimeout'] = setTimeout(function() {
    elStatus.classList.remove('marquee');
  }, 4000); // Animation time
}

// Toggle mobile layout
function toggleMobile() {
  if (document.documentElement.className === 'loaded error') return;
  g_isMobile = window.outerWidth < window.outerHeight;
  document.documentElement.classList.toggle('mobile', g_isMobile);
  var elPlayerButtons = el('#drag .player td.mark');
  if (g_isMobile) {
    var elOpponentButtons = el('#drag .opponent td.mark');
    if (elOpponentButtons) {
      // Remove desktop logo
      elOpponentButtons.remove();
      // Move player rack down
      var elRow = document.createElement('tr');
      elPlayerButtons.setAttribute('colspan', g_racksize);
      elRow.appendChild(elPlayerButtons);
      el('#drag .player tbody').appendChild(elRow);
    }
  } else {
    if (el('#drag .player td.mark:first-child')) {
      // Insert desktop logo
      var elCell = document.createElement('td');
      elCell.className = 'mark';
      elCell.innerHTML = g_cache['html'].h1;
      el('#drag .opponent tr').insertBefore(elCell, el('op0'));
      // Move player rack up
      el('#drag .player tr:first-child').appendChild(elPlayerButtons);
      elPlayerButtons.removeAttribute('colspan');
      el('#drag .player tr:last-child').remove();
    }
  }
  // Adjust modal position
  setModalHeight();
}

window.onload = function() {
  // Cache elements
  g_cache = {
    'app': el('app'),
    'modalMask': el('modal-mask'),
    'modalContainer': el('modal-container'),
    'modalInner': el('modal-inner'),
    'modalContent': el('modal-content'),
    'sound': el('sound'),
    'html': {}
  };
  // Check browser support
  if (g_isSupported) {
    // If there is a saved session, load it; otherwise initialize a new board
    if (localStorage['session']) load(localStorage['session']);
    else init('board');
    // Close modal by clicking on its shadow
    g_cache['modalMask'].addEventListener('click', closeModal);
    g_cache['modalInner'].addEventListener('click', handleHideModal);
    // Fade in
    document.documentElement.classList.replace('loading', 'loaded');
    document.dispatchEvent(new Event('appReady'));
  } else {
    // Sad faces to randomly show
    var aEmojis = [
      '&#9785;',   // Frowning
      '&#128530;', // Unamused
      '&#128546;', // Crying
      '&#128528;', // Neutral
      '&#128527;', // Smirking
      '&#128529;', // Expressionless
      '&#128532;', // Pensive
      '&#128533;', // Confused
      '&#128542;', // Disappointed
      '&#128543;', // Worried
      '&#128550;', // Frowning with open mouth
      '&#128551;'  // Anguished
    ];
    //document.documentElement.className = 'error';
    g_cache['app'].innerHTML = '<p><strong>' + aEmojis[randInt(0, aEmojis.length - 1)] + '</strong><br><br>' +
      gErrPrefix() + t('this browser is not supported. Please upgrade to a modern browser.') + '</p>';
    document.documentElement.className = 'loaded error';
    // GA
    gtag('event', navigator.userAgent, {
      'event_category': 'Unsupported Browser'
    });
  }
};

if (g_isSupported) {
  window.addEventListener('resize', debounce(toggleMobile));
  document.addEventListener('keydown', handleKeyDown);
}
