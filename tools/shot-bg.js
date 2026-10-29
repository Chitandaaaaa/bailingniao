/* 背景视觉校对：node tools/shot-bg.js <song|all> [outDir]
   抓两张：标题页（背景全亮无模糊）+ 游戏进行中（背景被压暗） */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 9337;
const FILE = 'file://' + path.join(ROOT, 'index.html');
const SONG = process.argv[2] || 'kaze';
const DIR = process.argv[3] || path.join(ROOT, '_tmp');

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean).find(p => fs.existsSync(p));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const CHROME = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-bg-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {}
    if (target) break;
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(6000);
  await ev('window.__game.Sound.readyPromise');          // 等音频/谱面就绪
  if (SONG !== 'summer') {
    await ev(`document.querySelector('[data-song="${SONG}"]').click()`);
    await sleep(2500);
    await ev('window.__game.Sound.readyPromise');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) {
      const p = path.join(DIR, `${SONG}-${name}.png`);
      fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
      console.log('  已保存 ' + p);
    }
  };
  await shot('title');

  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}))`);
  await sleep(9000);                                      // 倒计时 + 开局几秒
  console.log('  状态=' + await ev('window.__game.G.state') + ' songTime=' + await ev('+window.__game.G.songTime.toFixed(1)'));
  await shot('play');

  ws.close(); chrome.kill();
  process.exit(0);
})();
