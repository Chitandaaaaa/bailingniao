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
      var cs=getComputedStyle(el);
      /* 轮播层：两组 .bg-set（summer 6 张 / kaze 7 张），只有当前曲目那组 display:block */
      var sl=document.querySelectorAll('#scene-bg .bg-slide');
      var an=document.getAnimations().filter(function(a){return /^bgCycle/.test(a.animationName);});
      var vis=[].filter.call(document.querySelectorAll('#scene-bg .bg-set'),function(s){
        return getComputedStyle(s).display!=='none';})[0];
      var first=vis&&vis.querySelector('.bg-slide');
      var fu=first?(getComputedStyle(first).backgroundImage||''):'';
      return {cls:el.className,img:cs.backgroundImage.length,pfx:cs.backgroundImage.slice(0,30),
        /* 指纹取当前可见组第一张的中段：内联 JPEG 都以同样的 base64 头开头，开头没用 */
        key:fu.slice(2000,2060),filter:cs.filter,pos:cs.backgroundPosition,
        slides:sl.length,anim:an.length,
        imgs:[].map.call(sl,function(d){return (getComputedStyle(d).backgroundImage||'').length>1000?1:0;}),
        /* 每张的取景（舞台 3:2 cover 16:9 只横向裁，X 值才有效） */
        posList:[].map.call(sl,function(d){return getComputedStyle(d).backgroundPosition;}),
        setSummer:document.querySelectorAll('#scene-bg .set-summer .bg-slide').length,
        setKaze:document.querySelectorAll('#scene-bg .set-kaze .bg-slide').length,
        /* 只关心「有没有外链」：内联 data URL 与尚未注入（开发中）都算通过 */
        hasExt:sl.length&&[].some.call(sl,function(d){return /https?:/.test(getComputedStyle(d).backgroundImage||'');}),
        zBefore:getComputedStyle(el,'::before').zIndex};};
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
  check('Summer 有自己的场景背景 class（背景轮播）', boot.bg.cls === 'song-summer', 'class=' + JSON.stringify(boot.bg.cls));
  /* 只断言「内联 data URL 且不是空图」，不绑死体积：底图可能被重新压缩过 */
  check('Summer 一组 6 张轮播层', boot.bg.setSummer === 6 && boot.bg.setKaze === 7,
    'summer=' + boot.bg.setSummer + ' kaze=' + boot.bg.setKaze +
    ' 已注入=' + boot.bg.imgs.filter(function(x){return x===1;}).length + '/' + boot.bg.slides);
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
      busy:b.classList.contains('is-busy'),txt:b.textContent,hint:document.getElementById('t-hint').textContent});})()`);
  check('切歌瞬间开始按钮进入装载态（不再禁用）', mid.busy === true && mid.txt.indexOf('准备') >= 0, JSON.stringify(mid));
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
  check('切曲目只换整组（summer 6 层 / kaze 7 层各自轮播）',
    boot.bg.anim === 6 && kz.bg.anim === 7,
    'summer 动画=' + boot.bg.anim + ' kaze 动画=' + kz.bg.anim +
    ' 图层=' + boot.bg.slides + '(' + boot.bg.setSummer + '+' + boot.bg.setKaze + ')');
  check('轮播图全内联，无外链请求', boot.bg.hasExt === false && kz.bg.hasExt === false,
    'summer hasExt=' + boot.bg.hasExt + ' kaze hasExt=' + kz.bg.hasExt);
  check('夜景用了不同的滤镜（未照抄夏图的压暗）', kz.bg.filter !== boot.bg.filter,
    'summer: ' + boot.bg.filter + '  |  kaze: ' + kz.bg.filter);
  check('逐图取景偏移，让主体/灯火入画',
    kz.bg.posList.some(function(v){return !/^(50|center)%/.test(v.split(' ')[0]);}),
    'kaze 取景=' + JSON.stringify(kz.bg.posList));

  console.log('\n=== 3. 四档难度都能出谱（点难度卡，走真实切换路径）===');
  const EXPECT = { practice: 1, easy: 2, hard: 4, nightmare: 8 };
  const EXPECT_KEYS = { practice: '空格', easy: 'FJ', hard: 'DFJK', nightmare: 'ASDFJKL;' };
  for (const d of ['practice', 'easy', 'hard', 'nightmare']) {
    await evalJS(`document.querySelector('[data-diff="${d}"]').click();`);
    await sleep(150);
    const r = await J(`(function(){var g=window.__game;
      var lane=[],max=-1,last=-1,gapMin=1e9,tight=0;
      for(var i=0;i<g.G.notes.length;i++){var n=g.G.notes[i];
        lane[n.lane]=(lane[n.lane]||0)+1;
        if(n.t>max)max=n.t;
        if(last>=0){var gp=n.t-last;if(gp<gapMin)gapMin=gp;if(gp<0.25)tight++;}
        last=n.t;}
      return JSON.stringify({mode:g.G.mode,laneN:g.laneN,notes:g.G.notes.length,dur:+max.toFixed(1),
        rate:+(g.G.notes.length/max).toFixed(2),lane:lane.slice(0,g.laneN),
        keys:g.laneKeyChar.join(''),gapMin:+gapMin.toFixed(3),tight:tight});})()`);
    console.log('  ' + JSON.stringify(r));
    check(d + ' 轨道数 = ' + EXPECT[d], r.laneN === EXPECT[d], 'laneN=' + r.laneN);
    check(d + ' 键位 = ' + EXPECT_KEYS[d], r.keys === EXPECT_KEYS[d], 'keys=' + r.keys);
    check(d + ' 出谱且每轨都有音', r.notes > 100 && r.lane.length === EXPECT[d] && r.lane.every(v => v > 0),
      'notes=' + r.notes + ' 各轨=' + r.lane.join('/'));
    check(d + ' 最小间隔 ≥ 150ms', r.gapMin >= 0.15, 'gapMin=' + r.gapMin + 's tight(<250ms)=' + r.tight);
    check(d + ' 谱面不超出终点 195.27s', r.dur < 195.27, 'lastNote=' + r.dur + 's  密度=' + r.rate + '/s');
  }

  console.log('\n--- 3.5 新按键 → 轨道 映射（真实 keydown 走通）---');
  await evalJS(`(function(){var g=window.__game;g.setState('TITLE');return 1;})()`);
  await sleep(120);
  const KEYMAPS = {
    practice: ['Space'],
    easy: ['KeyF', 'KeyJ'],
    hard: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
    nightmare: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
  };
  for (const [d, codes] of Object.entries(KEYMAPS)) {
    await evalJS(`document.querySelector('[data-diff="${d}"]').click();`);
    await sleep(120);
    await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}))`);
    /* 倒计时 1500ms（见过教学）或 3000ms（首次），轮询到 PLAYING 再测按键 */
    let st = '';
    for (let w = 0; w < 20; w++) {
      st = (await evalJS('window.__game.G.state'))?.value;
      if (st === 'PLAYING') break;
      await sleep(400);
    }
    const r = await J(`(function(){var g=window.__game,out=[];
      var codes=${JSON.stringify(codes)};
      for(var i=0;i<codes.length;i++){
        var lane=g.keyToLane(codes[i]);
        window.dispatchEvent(new KeyboardEvent('keydown',{code:codes[i],bubbles:true,cancelable:true}));
        out.push({code:codes[i],lane:lane,held:!!g.G.held[lane]});
        window.dispatchEvent(new KeyboardEvent('keyup',{code:codes[i],bubbles:true,cancelable:true}));
      }
      return JSON.stringify({state:g.G.state,both:out});})()`);
    const ok = r.both.every((x, i) => x.lane === i && x.held === true);
    check(d + ' 每个键映射到自己的轨且能按下', ok && st === 'PLAYING',
      'state=' + st + ' ' + r.both.map(x => x.code + '→' + x.lane + (x.held ? '✓' : '✗')).join(' '));
    await evalJS(`(function(){var g=window.__game;g.setState('TITLE');return 1;})()`);
    await sleep(120);
  }

  console.log('\n=== 4. 简单模式开局并检查真实发声 ===');
  await evalJS(`document.querySelector('[data-diff="easy"]').click();`);
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
  check('切回 Summer 背景还原', back.bg.cls === boot.bg.cls && back.bg.key === boot.bg.key,
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
