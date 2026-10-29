const { chromium } = require('playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 970, height: 600 } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 300)); });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.__done === true, null, { timeout: 600000, polling: 1000 });
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
