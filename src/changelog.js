const VER = '3.40';

function showWhatsNew() {
  g_bui.prompt(`
<h3>What&rsquo;s new in v${VER}</h3>
<ul>
  <li>Improved changelog modal</li>
  <li>Fixed player names in old sessions</li>
</ul>
<hr>
<h4>Changelog</h4>
<h5>v3.30</h5>
<ul>
  <li>Added words: ly, ởn, nhò, báp, nhữ, nhự, dũ, nhũi, ngừ, khần, tọe, ầu, hin</li>
  <li>Removed words: hộn, đin, den, ghệch</li>
</ul>
<h5>v3.20</h5>
<ul>
  <li>Improved game balance</li>
</ul>
<h5>v3.05</h5>
<ul>
  <li>Fixed modal height issue</li>
</ul>
<h5>v3.04</h5>
<ul>
  <li>Fixed high score sync regressions</li>
</ul>
<h5>v3.02</h5>
<ul>
  <li>Improved high score syncing</li>
  <li>Fixed broken high score links</li>
</ul>
<h5>v3.00</h5>
<ul>
  <li>Added multiplayer!</li>
  <li>Implemented global high scores</li>
  <li>Implemented official end game rules</li>
  <li>Implemented coin flip for SP and MP games</li>
  <li>Removed unnecessary page reloads</li>
  <li>Revamped button icons</li>
  <li>Fixed broken word lookup</li>
</ul>
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
