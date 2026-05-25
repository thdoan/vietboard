const VER = '3.18';

function showWhatsNew() {
  g_bui.prompt(`
<h3>What&rsquo;s new in v${VER}</h3>
<ul>
  <li>Cleaned up debugging messages</li>
  <li>Optimized changelog modal</li>
  <li>Fixed incomplete changelog</li>
  <li>Fixed incorrect version numbers</li>
  <li>Fixed missing pointer cursors</li>
</ul>
<h4>
  <a href="changelog.txt" target="_changelog">Changelog &raquo;</a>
</h4>
`,
    '',
    'changelog wide'
  );
}

document.addEventListener('appReady', function() {
  if (VER > localStorage['ver'] || !localStorage['ver']) {
    showWhatsNew();
    localStorage['ver'] = VER;
  }
});
