// 用法: node render.cjs <帧目录> [只渲染的帧号,逗号分隔]
const path = require('path'), fs = require('fs'), os = require('os');
const puppeteer = require('puppeteer-core');
const outDir = process.argv[2] || path.join(__dirname, 'frames');
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
const CHROME = process.env.CHROME_PATH || path.join(os.homedir(),
  '.cache/puppeteer/chrome/mac_arm-155.0.8059.79/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'index.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const frames = only || Array.from({ length: 240 }, (_, i) => i);
  for (const f of frames) {
    await page.evaluate((t, f) => window.renderAt(t, f), f / 30, f);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(outDir, String(f + 1).padStart(4, '0') + '.png'), type: 'png' });
    if (f % 30 === 0) console.log('frame', f);
  }
  await browser.close();
  console.log('DONE', frames.length);
})().catch(e => { console.error(e); process.exit(1); });
