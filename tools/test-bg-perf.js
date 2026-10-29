/* 帧率 A/B：node tools/test-bg-perf.js
   同一 PLAYING 状态下对比 4 种背景配置，判断新夜景是否拖慢渲染 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 9338;
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-perf-'));
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
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(6000);
  await ev('window.__game.Sound.readyPromise');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}))`);
  await sleep(8000);
  console.log('状态=' + await ev('window.__game.G.state'));

  const measure = async () => JSON.parse(await ev(`(function(){return new Promise(function(res){
    var n=0,t0=performance.now();
    function tick(){n++;var t=performance.now();
      if(t-t0<3000){requestAnimationFrame(tick);}else{res(JSON.stringify({fps:+(n/((t-t0)/1000)).toFixed(1)}));}}
    requestAnimationFrame(tick);});})()`));

  const cases = [
    ['A 夏图+夏滤镜（当前线上的样子）', `var e=document.getElementById('scene-bg');e.className='';e.style.filter='';e.style.display='';`],
    ['B 夜景+本曲专属滤镜', `var e=document.getElementById('scene-bg');e.className='song-kaze';e.style.filter='';e.style.display='';`],
    ['C 夜景图但套夏图的强模糊', `var e=document.getElementById('scene-bg');e.className='song-kaze';e.style.filter='brightness(.62) saturate(.78) blur(1.6px)';e.style.display='';`],
    ['D 完全不画背景（理论上限）', `var e=document.getElementById('scene-bg');e.style.display='none';`]
  ];
  for (const [name, setup] of cases) {
    await ev(`(function(){${setup} return 1;})()`);
    await sleep(900);
    const a = await measure(), b = await measure();
    console.log('  ' + name.padEnd(28, ' ') + ' ' + String(a.fps).padStart(5) + '  ' + String(b.fps).padStart(5) + ' fps');
  }
  ws.close(); chrome.kill();
  process.exit(0);
})();
