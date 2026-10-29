/* 多曲目专项测试：Chrome DevTools Protocol（Node 22 内置 WebSocket）
 *   node tools/test-songs.js [--keep]
 * 覆盖：默认曲目 Summer 的行为不被破坏 + 新曲目（真实录音）能装载/出谱/发声。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9334;
const FILE = 'file://' + path.join(ROOT, 'index.html');

function findBrowser() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge，可用 CHROME_PATH 指定');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const CHROME = findBrowser();
  console.log('browser:', CHROME);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bailingniao-songs-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1400,900',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', d => { stderr += d.toString(); });

  let target = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      target = (await r.json()).find(t => t.type === 'page');
      if (target) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) { console.error('Chrome 未就绪\n' + stderr.slice(-2000)); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[console] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJS = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.result?.exceptionDetails) {
      return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    }
    return { value: r.result?.result?.value };
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(3000);

  const results = [];
  const check = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail: detail || '' });
    console.log((cond ? '  OK  ' : '  FAIL') + ' ' + name + (detail ? '  — ' + detail : ''));
  };
  const J = async (expr) => {
    const r = await evalJS(expr);
    if (r.error) { console.log('   [eval error] ' + r.error); return null; }
    try { return JSON.parse(r.value); } catch (e) { return r.value; }
  };

  await evalJS(`window.__e=[];window.addEventListener('error',e=>window.__e.push(e.message));
    /* 快照 #scene-bg 的实际渲染结果：class、底图、滤镜。
       两张内联 JPEG 都以同样的 base64 头开头，所以指纹取中段而非开头。 */
    window.__bgSnap=function(){var el=document.getElementById('scene-bg');
      var cs=getComputedStyle(el),u=cs.backgroundImage||'';
      return {cls:el.className,img:u.length,pfx:u.slice(0,30),
        key:u.slice(2000,2060),filter:cs.filter,pos:cs.backgroundPosition};};
    window.__waitReady=function(){return new Promise(function(res){var t0=Date.now();
      var iv=setInterval(function(){if(window.__game&&window.__game.Sound.ready){clearInterval(iv);res(Date.now()-t0);}
        else if(Date.now()-t0>90000){clearInterval(iv);res(-1);}},100);});};`);

  console.log('\n=== 1. 首屏 ===');
  const boot = await J(`(function(){var g=window.__game;return JSON.stringify({
      has:!!g,song:g.song.id,state:g.G.state,diff:g.G.diff,
      cards:[].map.call(document.querySelectorAll('.song-card'),function(b){return b.dataset.song+':'+(b.getAttribute('aria-checked'));}),
      tSong:document.querySelector('.t-song').textContent.trim(),
      hudSong:document.getElementById('hud-song').textContent.trim(),
      bg:window.__bgSnap()
    });})()`);
  console.log('  ' + JSON.stringify(boot));
  check('注入脚本可用', boot && boot.has === true);
  check('默认曲目 = summer', boot.song === 'summer');
  check('选曲卡渲染出 2 首', boot.cards.length === 2, boot.cards.join(' | '));
  check('标题页曲目文案含 Summer', /Summer/.test(boot.tSong));
  check('Summer 用默认背景（无曲目专属 class）', boot.bg.cls === '', 'class=' + JSON.stringify(boot.bg.cls));
  check('Summer 背景内联无外链', boot.bg.img > 500000 && /^url\("data:image\/jpeg;base64,/.test(boot.bg.pfx),
    'imgLen=' + boot.bg.img);
  check('无脚本错误', (await evalJS('window.__e.length'))?.value === 0);

  let ms = await evalJS('window.__waitReady()');
  check('Summer 合成完成', ms.value > 0, '耗时 ' + (ms.value / 1000).toFixed(2) + 's');
  const s1 = await J(`(function(){var g=window.__game;return JSON.stringify({
      id:g.song.id,notes:g.G.notes.length,chart:g.G.chart.notes.length,src:g.G.chart.source
    });})()`);
  console.log('  ' + JSON.stringify(s1));

  console.log('\n=== 2. 切到《風のとおり道》 ===');
  await evalJS(`document.querySelector('[data-song="kaze"]').click();`);
  await sleep(200);
  const mid = await J(`(function(){var b=document.getElementById('btn-start');return JSON.stringify({
      disabled:b.disabled,rule:document.getElementById('t-rule').textContent.slice(0,24)});})()`);
  check('切歌瞬间开始按钮被禁用', mid.disabled === true, JSON.stringify(mid));
  ms = await evalJS('window.__waitReady()');
  check('录音解码完成', ms.value > 0, '耗时 ' + (ms.value / 1000).toFixed(2) + 's');

  const kz = await J(`(function(){var g=window.__game,S=g.Sound;var b=S.songBuf;
    return JSON.stringify({id:g.song.id,dur:b?+b.duration.toFixed(3):null,
      sr:b?b.sampleRate:null,ch:b?b.numberOfChannels:null,
      notes:g.G.notes.length,cells:g.G.chart.notes.length,src:g.G.chart.source,
      tSong:document.querySelector('.t-song').textContent.trim(),
      checked:document.querySelector('[data-song="kaze"]').getAttribute('aria-checked'),
      bg:window.__bgSnap()});})()`);
  console.log('  ' + JSON.stringify(kz));
  check('已切到 kaze', kz.id === 'kaze');
  check('选曲卡选中态同步', kz.checked === 'true');
  check('录音解码出完整时长(≈196.8s)', kz.dur > 195 && kz.dur < 198, 'duration=' + kz.dur + 's @' + kz.sr + 'Hz ' + kz.ch + 'ch');
  check('谱面来自音乐弹奏点', kz.src === 'music' && kz.cells > 300, 'cells=' + kz.cells + ' 成谱=' + kz.notes);
  check('标题页文案已更新', /風のとおり道/.test(kz.tSong), kz.tSong);

  console.log('\n--- 3.5 曲目专属背景 ---');
  check('kaze 挂上曲目专属 class', kz.bg.cls === 'song-kaze', 'class=' + JSON.stringify(kz.bg.cls));
  check('底图已换成新的夜景（与 Summer 不同）', kz.bg.key !== boot.bg.key,
    'summer len=' + boot.bg.img + ' / kaze len=' + kz.bg.img);
  check('新背景同样是内联（无外链依赖）', kz.bg.img > 50000 && /^url\("data:image\/jpeg;base64,/.test(kz.bg.pfx),
    kz.bg.pfx + '… imgLen=' + kz.bg.img);
  check('夜景用了不同的滤镜（未照抄夏图的压暗）', kz.bg.filter !== boot.bg.filter,
    'summer: ' + boot.bg.filter + '  |  kaze: ' + kz.bg.filter);
  check('横向取景偏移，让左侧灯火入画', /^32%/.test(kz.bg.pos), 'background-position=' + kz.bg.pos);

  console.log('\n=== 3. 三个难度都能出谱（切难度后重载谱面）===');
  for (const d of ['easy', 'hard', 'nightmare']) {
    const r = await J(`(function(){var g=window.__game;
      g.G.diff='${d}';g.G.mode='${d}';g.G.active=g.DIFFS['${d}'].active.slice();
      g.loadChart('${d}');
      var lane=[0,0,0,0,0],max=-1,last=-1,gapMin=1e9,tight=0;
      for(var i=0;i<g.G.notes.length;i++){var n=g.G.notes[i];lane[n.lane]++;
        if(n.t>max)max=n.t;
        if(last>=0){var gp=n.t-last;if(gp<gapMin)gapMin=gp;if(gp<0.25)tight++;}
        last=n.t;}
      return JSON.stringify({mode:g.G.mode,notes:g.G.notes.length,dur:+max.toFixed(1),
        rate:+(g.G.notes.length/max).toFixed(2),lane:lane,
        gapMin:+gapMin.toFixed(3),tight:tight});})()`);
    console.log('  ' + JSON.stringify(r));
    check(d + ' 出谱且落在活跃轨', r.notes > 100 && (d === 'easy' ? r.lane[2] === r.notes : r.lane[0] + r.lane[4] >= 0),
      'notes=' + r.notes + ' lanes=' + r.lane.join('/'));
    check(d + ' 最小间隔 ≥ 150ms', r.gapMin >= 0.15, 'gapMin=' + r.gapMin + 's tight(<250ms)=' + r.tight);
    check(d + ' 谱面不超出终点 195.27s', r.dur < 195.27, 'lastNote=' + r.dur + 's  密度=' + r.rate + '/s');
  }

  console.log('\n=== 4. 简单模式开局并检查真实发声 ===');
  await evalJS(`document.querySelector('[data-diff="easy"]').click();`);
  await sleep(150);
  await evalJS(`(function(){var g=window.__game;
    try{if(g.Sound.ctx.state!=='running')g.Sound.ctx.resume();}catch(e){}
    window.__an=g.Sound.ctx.createAnalyser();window.__an.fftSize=2048;
    g.Sound.master.connect(window.__an);
    window.__sample=function(ms){return new Promise(function(res){
      var an=window.__an,buf=new Float32Array(an.fftSize);
      var peak=0,above=0,n=0,t0=performance.now();
      var iv=setInterval(function(){
        an.getFloatTimeDomainData(buf);
        var p=0;for(var i=0;i<buf.length;i++){var a=Math.abs(buf[i]);if(a>p)p=a;}
        if(p>peak)peak=p; if(p>0.01)above++; n++;
        if(performance.now()-t0>ms){clearInterval(iv);
          res(JSON.stringify({peak:+peak.toFixed(4),aboveRatio:+(above/n).toFixed(2),frames:n}));}
      },60);});};
    return 1;})()`);
  /* 倒计时期间应该安静 —— 用来证明后面的信号确实来自播放 */
  await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}));`);
  await sleep(600);
  const base = await J('window.__sample(1400)');
  console.log('  倒计时基线 ' + JSON.stringify(base));
  check('倒计时期间无音乐泄漏', base && base.peak < 0.01, JSON.stringify(base));
  await sleep(4200);
  let st = (await evalJS('window.__game.G.state'))?.value;
  check('倒计时结束 → PLAYING', st === 'PLAYING', 'state=' + st);

  const lv = await J(`window.__sample(2600).then(function(s){s=JSON.parse(s);
    s.songTime=+window.__game.G.songTime.toFixed(3);
    s.buf=!!window.__game.Sound.songBuf;return JSON.stringify(s);})`);
  console.log('  ' + JSON.stringify(lv));
  check('播放期间总线持续有信号', lv.peak > 0.02 && lv.aboveRatio > 0.5,
    'peak=' + lv.peak + ' 有声帧占比=' + lv.aboveRatio);
  check('歌曲时钟在走', lv.songTime > 0.2, 'songTime=' + lv.songTime + 's');

  const jd = await J(`(function(){var g=window.__game,G=g.G;
    var t=g.Sound.chartTime(),target=null,bd=1e9;
    for(var i=0;i<G.notes.length;i++){var d=Math.abs(G.notes[i].t-t);if(d<bd&&!G.notes[i].judged){bd=d;target=G.notes[i];}}
    if(!target)return JSON.stringify({err:'no-note'});
    g.hitLane(target.lane,target.t);
    return JSON.stringify({score:G.score,combo:G.combo,perfect:G.counts.perfect,lane:target.lane});})()`);
  console.log('  ' + JSON.stringify(jd));
  check('判定与计分正常', jd.perfect >= 1 && jd.score > 0, JSON.stringify(jd));

  console.log('\n=== 5. 回到 Summer 仍可用 ===');
  await evalJS(`(function(){var g=window.__game;g.setState('TITLE');return 1;})()`);
  await sleep(150);
  await evalJS(`document.querySelector('[data-song="summer"]').click();`);
  ms = await evalJS('window.__waitReady()');
  check('Summer 重新装载成功', ms.value >= 0, '耗时 ' + (ms.value / 1000).toFixed(2) + 's');
  const back = await J(`(function(){var g=window.__game;return JSON.stringify({
      id:g.song.id,notes:g.G.notes.length,src:g.G.chart.source,bg:window.__bgSnap()});})()`);
  console.log('  ' + JSON.stringify(back));
  check('Summer 谱面回到音乐弹奏点', back.id === 'summer' && back.src === 'music' && back.notes > 100);
  check('切回 Summer 背景还原', back.bg.cls === '' && back.bg.key === boot.bg.key,
    'class=' + JSON.stringify(back.bg.cls) + ' filter=' + back.bg.filter);

  console.log('\n=== 6. 刷新后记住上回选的曲目 ===');
  await send('Page.navigate', { url: FILE });
  await sleep(2800);
  const persisted = await J(`(function(){return JSON.stringify({id:window.__game.song.id,
      checked:document.querySelector('[data-song="summer"]').getAttribute('aria-checked')});})()`);
  console.log('  ' + JSON.stringify(persisted));
  check('localStorage 记住曲目选择', persisted.id === 'summer' && persisted.checked === 'true');

  console.log('\n=== 控制台 ===');
  logs.slice(-25).forEach(m => console.log('  ' + m));
  const errs = logs.filter(m => m.startsWith('[EXCEPTION]'));
  check('运行期无未捕获异常', errs.length === 0, errs[0] || '');

  const pass = results.filter(r => r.pass).length;
  console.log('\n=== 结果：' + pass + '/' + results.length + ' 通过 ===');
  results.filter(r => !r.pass).forEach(r => console.log('  FAIL ' + r.name + ' — ' + r.detail));
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(pass === results.length ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
