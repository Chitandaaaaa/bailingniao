/* 诊断：点「开始演奏」是否有反应  node tools/diag-start.js [songId] [diffId] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9351;
const SONG = process.argv[2] || 'summer';
const DIFF = process.argv[3] || 'easy';
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-diag-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1500,950',
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
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push('[console] ' + (m.params.args || []).map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
  const J = async e => JSON.parse(await ev(e) || 'null');
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('!!window.__game')) break; }
  console.log('game ready:', await ev('!!window.__game'));

  console.log('--- 初始状态 ---');
  console.log(await J(`JSON.stringify({
    state: __game.G.state, diff: __game.G.diff, mode: __game.G.mode,
    soundReady: __game.Sound.ready,
    hasReadyPromise: !!__game.Sound.readyPromise,
    startRect: (function(){var b=document.getElementById('btn-start');var r=b.getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height,vis:getComputedStyle(b).visibility,disp:getComputedStyle(b).display};})(),
    atPoint: (function(){var b=document.getElementById('btn-start');var r=b.getBoundingClientRect();
      var el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el?el.tagName+'#'+el.id+'.'+el.className:null;})()
  })`));

  if (SONG !== 'summer') {
    await ev(`document.querySelector('.song-card[data-song="${SONG}"]').click()`);
    await sleep(2500);
    console.log('切换曲目后 soundReady:', await ev('__game.Sound.ready'));
  }
  if (DIFF !== 'easy') {
    await ev(`document.querySelector('.diff-card[data-diff="${DIFF}"]').click()`);
    await sleep(400);
  }
  console.log('--- 点击开始 ---');
  const before = await ev('__game.G.state');
  await ev(`document.getElementById('btn-start').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  for (let i = 0; i < 12; i++) {
    await sleep(300);
    const s = await ev('__game.G.state');
    console.log(' t+' + ((i + 1) * 300) + 'ms  state=' + s + '  hint=' + await ev(`(document.getElementById('hint')||{}).textContent||''`));
    if (s !== before && s !== 'TITLE') break;
  }
  console.log('\n--- 控制台 ---');
  logs.slice(-25).forEach(l => console.log(' ' + l));
  ws.close(); chrome.kill();
  process.exit(0);
})();
