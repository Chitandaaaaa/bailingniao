/* 合并后的谱面实验室自检：node tools/test-lab-inline.js
   验证 index.html 单文件里，入口按钮能打开编辑台、能正常出图、能关回去，
   且编辑台的存在不影响游戏本身（无 JS 异常、无重复 id）。 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9341;
const OUT = process.argv[2] || path.join(ROOT, 'tools', 'shots', 'lab-inline.png');
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
let pass = 0, fail = 0;
const check = (name, ok, info = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (info ? '  ' + info : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const CHROME = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-lab-'));
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
  const J = async e => JSON.parse(await ev(e) || 'null');

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(6000);
  await ev('window.__game.Sound.readyPromise');

  console.log('\n=== 1. 单文件完整性 ===');
  const doc = await J(`(function(){
    var t=document.querySelectorAll('script[src],link[rel=stylesheet]');
    var ids={},dup=[];
    document.querySelectorAll('[id]').forEach(function(e){ids[e.id]=(ids[e.id]||0)+1;});
    for(var k in ids) if(ids[k]>1) dup.push(k+'×'+ids[k]);
    return JSON.stringify({ext:t.length,dup:dup,
      size:document.documentElement.outerHTML.length});})()`);
  check('无任何外链资源（script src / link）', doc.ext === 0, 'ext=' + doc.ext);
  check('没有重复 id', doc.dup.length === 0, doc.dup.join(',') || 'clean');

  const before = await J(`(function(){var b=document.getElementById('btn-lab');
    if(!b)return '{}';
    return JSON.stringify({op:+getComputedStyle(b).opacity.slice(0,4),txt:b.textContent.trim(),
      open:document.body.classList.contains('lab-open'),
      labDisplay:getComputedStyle(document.getElementById('lab-root')).display,
      labReady:typeof window.chartLabMain});})()`);
  console.log('  入口按钮 ' + JSON.stringify(before));
  check('入口存在且低调（opacity ≤ .8）', before.op <= 0.8, 'opacity=' + before.op);
  check('编辑台初始隐藏', before.labDisplay === 'none', 'display=' + before.labDisplay);
  check('未点开前编辑器未初始化（不拖慢启动）', before.labReady === 'function');

  console.log('\n=== 2. 演奏途中点入口：应先收尾回标题并静音 ===');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}))`);
  let inPlay = false;
  for (let i = 0; i < 40; i++) {
    const s = (await ev('window.__game.G.state'));
    if (s === 'PLAYING') { inPlay = true; break; }
    await sleep(200);
  }
  check('已进入演奏', inPlay, 'state=' + (await ev('window.__game.G.state')));
  await ev(`document.getElementById('btn-lab').click()`);
  await sleep(500);
  const mid = await J(`(function(){var g=window.__game;return JSON.stringify({
    state:g.G.state,open:document.body.classList.contains('lab-open'),
    buf:!!g.Sound.songBuf||g.Sound.live});})()`);
  console.log('  ' + JSON.stringify(mid));
  check('打开编辑台时自动回标题', mid.state === 'TITLE', 'state=' + mid.state);
  check('打开编辑台时伴奏已停', mid.buf !== true, 'stillPlaying=' + mid.buf);
  await ev(`window.__closeChartLab()`);
  await sleep(300);

  console.log('\n=== 3. 点开编辑台 ===');
  await ev(`document.getElementById('btn-lab').click()`);
  await sleep(2200);
  const after = await J(`(function(){
    var root=document.getElementById('lab-root');
    var roll=document.getElementById('lab-roll'), map=document.getElementById('lab-map');
    return JSON.stringify({open:document.body.classList.contains('lab-open'),
      display:getComputedStyle(root).display,
      appHidden:getComputedStyle(document.getElementById('app')).visibility,
      roll:roll?[roll.width,roll.height]:null,
      map:map?[map.width,map.height]:null,
      lab:typeof window.__lab,
      notes:window.__lab?window.__lab.notes.length:0,
      count:document.getElementById('lab-hud-count').textContent,
      keyrow:document.getElementById('lab-keyrow').children.length});})()`);
  console.log('  ' + JSON.stringify(after));
  check('面板已显示', after.open === true && after.display === 'flex');
  check('游戏舞台让位（visibility hidden）', after.appHidden === 'hidden');
  check('长卷画布有实际尺寸', after.roll && after.roll[0] > 100 && after.roll[1] > 100, JSON.stringify(after.roll));
  check('编辑器已跑起来并出谱', after.lab === 'object' && after.notes > 100, 'notes=' + after.notes);
  check('HUD 音符数与谱面一致', after.count === String(after.notes), after.count + ' vs ' + after.notes);
  check('键位图例已填充', after.keyrow > 0, after.keyrow + ' 个键');

  console.log('\n=== 4. 切曲目 / 切难度 ===');
  const sw = await J(`(function(){var L=window.__lab;
    document.querySelector('#lab-root [data-song="kaze"]').click();
    return JSON.stringify({notes:L.notes.length});})()`);
  await sleep(400);
  const sw2 = await J(`(function(){var L=window.__lab;
    document.querySelector('#lab-root [data-diff="nightmare"]').click();
    return JSON.stringify({notes:L.notes.length,lanes:L.P.lanes});})()`);
  console.log('  kaze=' + JSON.stringify(sw) + '  nightmare=' + JSON.stringify(sw2));
  check('切到風のとおり道有谱', sw.notes > 100, 'notes=' + sw.notes);
  check('切到噩梦为 8 轨', sw2.lanes === 8, 'lanes=' + sw2.lanes);
  const ghost = await J(`(function(){
    /* 编辑台内部切难度时，不能顺手把游戏标题页的难度卡点亮 */
    var root=document.getElementById('lab-root'), hit=[];
    document.querySelectorAll('[data-diff]').forEach(function(b){
      if(!root.contains(b) && b.classList.contains('on')) hit.push(b.dataset.diff);});
    var songHit=0;
    document.querySelectorAll('[data-song]').forEach(function(b){
      if(!root.contains(b) && b.classList.contains('on')) songHit++;});
    return JSON.stringify({diff:hit,song:songHit});})()`);
  check('编辑台没有误伤游戏的难度卡/选曲卡', ghost.diff.length === 0 && ghost.song === 0,
    ghost.diff.join(',') || '无越界');

  console.log('\n=== 5. 截图并可关回 ===');
  await ev(`window.__closeChartLab()`);
  await sleep(600);
  await ev(`document.getElementById('btn-lab').click()`);
  await sleep(1500);
  await ev(`document.querySelector('#lab-root [data-song="summer"]').click();
            document.querySelector('#lab-root [data-diff="hard"]').click();`);
  await sleep(900);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('  → ' + OUT);

  await ev(`document.getElementById('lab-back').click()`);
  await sleep(700);
  const back = await J(`(function(){return JSON.stringify({
    open:document.body.classList.contains('lab-open'),
    display:getComputedStyle(document.getElementById('lab-root')).display,
    app:getComputedStyle(document.getElementById('app')).visibility,
    btn:!!document.getElementById('btn-lab')});})()`);
  console.log('  ' + JSON.stringify(back));
  check('返回按钮能关掉编辑台', back.open === false && back.display === 'none');
  check('游戏舞台恢复可见', back.app === 'visible');

  console.log('\n=== 6. 关掉后游戏仍正常 ===');
  const g = await J(`(function(){var g=window.__game;return JSON.stringify({
    state:g.G.state,notes:g.G.notes.length,song:g.song.id});})()`);
  console.log('  ' + JSON.stringify(g));
  check('游戏状态正常', g.state === 'TITLE' && g.notes > 100);

  console.log('\n=== 控制台（末 12 条）===');
  logs.slice(-12).forEach(l => console.log('  ' + l.slice(0, 200)));
  const errs = logs.filter(l => l.startsWith('[EXCEPTION]'));
  check('无 JS 异常', errs.length === 0, errs.length ? errs[0].slice(0, 160) : '');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})();
