const VER = '2.00';

function showWhatsNew() {
  g_bui.prompt(
    '<h3>What\'s New</h3>' +
    '<ul>' +
    '<li>Added high scores table</li>' +
    '<li>Fixed ability to drag opponent\'s tile</li>' +
    '<li>Non-draggable tiles no longer have "move" cursor</li>' +
    '</ul>'
  );
}

document.addEventListener('appReady', function() {
  if (VER > localStorage['ver'] || !localStorage['ver']) {
    showWhatsNew();
    localStorage['ver'] = VER;
  }
});
