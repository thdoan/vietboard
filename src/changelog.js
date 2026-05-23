const VER = '3.20';

function showWhatsNew() {
  g_bui.prompt(
    '<h3>What\'s New</h3>' +
    '<ul>' +
    '<li>Added multiplayer!</li>' +
    '<li>Implemented global high scores</li>' +
    '<li>Implemented official end game rules</li>' +
    '<li>Implemented coin flip for SP and MP games</li>' +
    '<li>Improved high score syncing (v3.02)</li>' +
    '<li>Improved game balance (v3.20)</li>' +
    '<li>Removed unnecessary page reloads</li>' +
    '<li>Revamped button icons</li>' +
    '<li>Fixed broken word lookup</li>' +
    '<li>Fixed broken high score links (v3.02)</li>' +
    '<li>Fixed high score sync regressions (v3.04)</li>' +
    '<li>Fixed modal height issue (v3.05)</li>' +
    '</ul>'
  );
}

document.addEventListener('appReady', function() {
  if (VER > localStorage['ver'] || !localStorage['ver']) {
    showWhatsNew();
    localStorage['ver'] = VER;
  }
});
