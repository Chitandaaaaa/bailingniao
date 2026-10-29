/* 背景轮播校对：node tools/shot-bg-slides.js [song] [outDir]
   把当前曲目的轮播动画暂停在每张「完全显示」的时刻逐张截图，
   确认构图 / 裁切 / 压暗都正常，并顺便验证整轮不露底、不闪黑。 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 9341;
const FILE = 'file://' + path.join(ROOT, 'index.html');
const SONG = process.argv[2] || 'summer';
const DIR = process.argv[3] || path.join(ROOT, '_tmp', 'slides', SONG);

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-slides-'));
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
  await ev('window.__game.Sound.readyPromise');
  if (SONG !== 'summer') {
    await ev(`document.querySelector('[data-song="${SONG}"]').click()`);
    await sleep(2500);
    await ev('window.__game.Sound.readyPromise');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  const meta = await ev(`(function(){
    var an = document.getAnimations().filter(function(a){return /^bgCycle/.test(a.animationName);});
    var set = document.querySelector('#scene-bg .bg-set');
    return JSON.stringify({
      cls: document.getElementById('scene-bg').className,
      n: an.length,
      name: an[0] ? an[0].animationName : '',
      dur: an[0] ? an[0].effect.getTiming().duration : 0,
      visibleSets: [].filter.call(document.querySelectorAll('#scene-bg .bg-set'), function(s){
        return getComputedStyle(s).display !== 'none'; }).map(function(s){return s.className;}),
      layers: document.querySelectorAll('#scene-bg .bg-slide').length
    });
  })()`);
  const M = JSON.parse(meta);
  console.log(`  #scene-bg class="${M.cls}"  可见组=[${M.visibleSets}]  图层总数=${M.layers}`);
  console.log(`  轮播动画 ${M.n} 个（${M.name}，一轮 ${M.dur / 1000}s）`);
  if (!M.n) { console.log('  !! 没有 bgCycle 动画，检查 .song-* 类与 @keyframes 名'); }

  const step = M.dur / (M.n || 1);
  /* 第 i 张的稳定显示中心：延迟 i*step，淡入后约 0.3*step 处最稳 */
  const at = i => Math.round(i * step + step * 0.55);

  /* 只统计「可见组」的图层：隐藏组是 display:none，浏览器仍会报出动画值，
     但那些值不参与渲染，混进来会把不透明度和算成 2。 */
  const freeze = t => ev(`(function(){
    document.getAnimations().forEach(function(a){
      if (/^bgCycle/.test(a.animationName)) { a.pause(); a.currentTime = ${t}; }
    });
    var set = [].filter.call(document.querySelectorAll('#scene-bg .bg-set'), function(s){
      return getComputedStyle(s).display !== 'none'; })[0];
    if (!set) return '';
    return [].map.call(set.querySelectorAll('.bg-slide'), function(d){
      return +getComputedStyle(d).opacity; }).join(',');
  })()`);

  for (let i = 0; i < M.n; i++) {
    const op = await freeze(at(i));
    await sleep(220);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(DIR, `slide-${i + 1}.png`);
    if (r.result?.data) fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log(`  slide-${i + 1}  t=${(at(i) / 1000).toFixed(1)}s  opacity=[${op}]`);
  }

  /* 交叉区抽查：相邻两张应该同时半亮，且「可见层不透明度之和」不为 0 */
  for (const frac of [0, 0.05, 0.3, 0.5, 0.8, 0.98]) {
    const t = Math.round(M.dur * frac);
    const op = await freeze(t);
    const sum = op.split(',').reduce((a, b) => a + (+b), 0);
    console.log(`  t=${(t / 1000).toFixed(1)}s (${(frac * 100).toFixed(0)}%)  opacity=[${op}]  和=${sum.toFixed(2)}`);
  }

  /* 游戏进行中（压暗）来一张 */
  await freeze(at(0));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}))`);
  await sleep(9000);
  console.log('  状态=' + await ev('window.__game.G.state'));
  const r2 = await send('Page.captureScreenshot', { format: 'png' });
  if (r2.result?.data) {
    const p = path.join(DIR, 'slide-play.png');
    fs.writeFileSync(p, Buffer.from(r2.result.data, 'base64'));
    console.log('  游戏中（压暗）→ ' + p);
  }

  ws.close(); chrome.kill();
  process.exit(0);
})();
