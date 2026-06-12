import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message, error.stack));

  try {
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0', timeout: 10000 });
  } catch (err) {
    console.log('GOTO ERROR:', err);
  }
  
  await browser.close();
})();
