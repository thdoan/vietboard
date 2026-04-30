const { chromium } = require('playwright');

(async () => {
  console.log('WSL Dry-Run Test');
  console.log('DISPLAY:', process.env.DISPLAY);
  console.log('Launching headed Chromium...');

  try {
    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox']
    });

    console.log('SUCCESS: Browser launched!');
    console.log('Browser version:', await browser.version());

    const page = await browser.newPage();
    await page.goto('http://localhost:8080');
    const title = await page.title();
    console.log('SUCCESS: Page loaded, title:', title);

    await browser.close();
    console.log('SUCCESS: Browser closed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
})();
