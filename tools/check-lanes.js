/* 轨道/难度自检：node tools/check-lanes.js
   逐档切换难度，打印轨道几何、键位、谱面分布，并捕获任何 JS 报错 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 9339;
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-lane-'));
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
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[console] ' + (m.params.args || []).map(a => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(6000);
  await ev('window.__game.Sound.readyPromise');

  console.log('=== 各档难度 ===');
  for (const d of ['practice', 'easy', 'hard', 'nightmare']) {
    const r = JSON.parse(await ev(`(function(){
      var g=window.__game;
      document.querySelector('[data-diff="${d}"]').click();
      var lane=new Array(8).fill(0),minX=1e9,maxX=-1e9,gapMinX=1e9;
      var xs=[];
      for(var i=0;i<g.G.notes.length;i++){lane[g.G.notes[i].lane]++;}
      var L=g.laneN||0;
      for(var i=0;i<g.G.notes.length;i++){}
      return JSON.stringify({id:'${d}',n:L,notes:g.G.notes.length,
        lane:lane.slice(0,L),mode:g.G.mode,diff:g.G.diff,
        cards:g.DIFFS['${d}'].lanes.length});})()`));
    const geo = JSON.parse(await ev(`(function(){var g=window.__game;
      var xs=g.laneX.slice();
      var c=(xs[0]+xs[xs.length-1])/2;
      var gaps=[];for(var i=1;i<xs.length;i++)gaps.push(+(xs[i]-xs[i-1]).toFixed(1));
      var o={n:g.laneN,keys:g.laneKeyChar,x:xs,center:c,gaps:gaps,pad:g.LANE_PAD_W};return JSON.stringify(o);})()`));
    console.log(`  ${d.padEnd(10)} 轨数=${geo.n} 键=${JSON.stringify(geo.keys)} 中心=${geo.center} X=${JSON.stringify(geo.x)} 间距=${JSON.stringify(geo.gaps)} 垫宽=${JSON.stringify(geo.pad)}`);
    console.log(`             音符=${r.notes} 各轨=${r.lane.join('/')}`);
  }

  console.log('\n=== 控制台（末 20 条）===');
  logs.slice(-20).forEach(l => console.log('  ' + l));
  const errs = logs.filter(l => l.startsWith('[EXCEPTION]'));
  console.log(errs.length ? '\n❌ 有 ' + errs.length + ' 个异常' : '\n✅ 无 JS 异常');
  ws.close(); chrome.kill();
  process.exit(0);
})();
