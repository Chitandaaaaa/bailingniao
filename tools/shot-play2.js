/* 截演奏中画面：node tools/shot-play2.js [out.png] [diffId] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9362;
const OUT = process.argv[2] || path.join(ROOT, 'tools', 'shots', 'play-check.png');
const DIFF = process.argv[3] || 'nightmare';
const FILE = 'file://' + path.join(ROOT, 'index.html');

function findBrowser() {
  return [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean).find(p => fs.existsSync(p));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const CHROME = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-sp-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1200,800',
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
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('!!window.__game')) break; }
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('__game.Sound.ready')) break; }
  await ev(`document.querySelector('.diff-card[data-diff="${DIFF}"]').click()`);
  await sleep(600);
  await ev(`document.getElementById('btn-start').click()`);
  let playing = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await ev(`__game.G.state==='PLAYING'`)) { playing = true; break; }
  }
  console.log('playing:', playing);
  await sleep(4000);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', OUT);
  ws.close(); chrome.kill(); process.exit(0);
})();
