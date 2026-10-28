/* 验收：真实鼠标点暂停 / 真实键盘空格命中 / 音频电平 / 事件音高核对 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const FILE = 'file://' + path.join(ROOT, 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bln-v-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (m.params.exceptionDetails.exception?.description || ''));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description } : { value: r.result?.result?.value }; };
  const ok = (n, c, d) => console.log((c ? '  ✅ ' : '  ❌ ') + n + (d ? '  — ' + d : ''));

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(3000);

  console.log('\n=== 1. 曲目数据 ===');
  const meta = await ev(`(function(){var g=window.__game;
    var ev=g.Sound.events||[];
    var S=g.Sound.ctx.sampleRate;
    var n=ev.length, first=ev.slice(0,6).map(function(e){return e.t.toFixed(2)+':'+e.k+'@'+e.g.toFixed(2)});
    var last=ev[ev.length-1];
    return JSON.stringify({events:n,lastT:+last.t.toFixed(2),bankKeys:Object.keys(g.Sound.bank).length,first:first});})()`);
  console.log('  ' + (meta.value || meta.error));
  const m = JSON.parse(meta.value || '{}');
  ok('钢琴事件已生成', m.events > 2000, 'events=' + m.events);
  ok('末音落在曲长内', m.lastT <= 216 && m.lastT > 205, 'lastT=' + m.lastT);
  ok('采样库覆盖全音域', m.bankKeys > 40, 'bank=' + m.bankKeys);

  console.log('\n=== 2. 音频电平（渲染 24s）===');
  const lv = await ev(`(async function(){var S=window.__game.Sound,ev=S.events,sr=22050,dur=24;
    var off=new OfflineAudioContext(1,Math.ceil(sr*dur),sr);
    var out=off.createGain();out.gain.value=1;out.connect(off.destination);
    ev.filter(function(e){return e.t<dur-3;}).forEach(function(e){
      var b=S.bank[e.k];if(!b)return;var s=off.createBufferSource(),g=off.createGain();
      s.buffer=b;g.gain.value=e.g;s.connect(g).connect(out);s.start(1.8+e.t);});
    var r=await off.startRendering();var d=r.getChannelData(0);
    var peak=0,sum=0,clip=0;
    for(var i=0;i<d.length;i++){var a=Math.abs(d[i]);if(a>peak)peak=a;sum+=d[i]*d[i];if(a>0.999)clip++;}
    return JSON.stringify({peak:+peak.toFixed(3),rms:+Math.sqrt(sum/d.length).toFixed(4),clip:clip});})()`);
  console.log('  ' + (lv.value || lv.error));
  const L = JSON.parse(lv.value || '{}');
  ok('无削波', L.clip === 0, 'clip=' + L.clip + ' peak=' + L.peak);
  ok('响度合理', L.rms > 0.03 && L.rms < 0.35, 'rms=' + L.rms);

  console.log('\n=== 3. 真实鼠标点击暂停 ===');
  await ev(`document.querySelector('[data-diff="easy"]').click();document.querySelector('#btn-start').click();`);
  await sleep(500);
  await ev(`(function(){var g=window.__game;g.G.seenTutorial=true;g.G.countdownDur=800;g.G.countdownStart=performance.now()-3000;g.G.tutNotes=[];})()`);
  await sleep(1400);
  const st0 = (await ev('window.__game.G.state')).value;
  ok('进入游戏', st0 === 'PLAYING', 'state=' + st0);
  const rect = JSON.parse((await ev(`(function(){var r=document.querySelector('#hud-pause').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`)).value);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  }
  await sleep(400);
  const st1 = (await ev('window.__game.G.state')).value;
  ok('鼠标点暂停生效', st1 === 'PAUSED', 'state=' + st1);
  // 恢复：暂停面板上的「继续」
  await sleep(300);
  const rr = JSON.parse((await ev(`(function(){var r=document.querySelector('#btn-resume').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`)).value);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: Math.round(rr.x), y: Math.round(rr.y), button: 'left', clickCount: 1 });
  }
  await sleep(500);
  const st2 = (await ev('window.__game.G.state')).value;
  ok('鼠标点继续生效', st2 === 'PLAYING', 'state=' + st2);

  console.log('\n=== 4. 真实键盘空格命中 ===');
  await ev(`(function(){
    // 把游戏时钟挪到最近音符前 0.15s，模拟玩家踩点
    var g=window.__game,G=g.G;
    var t=g.Sound.chartTime();
    var n=null,bd=9;for(var i=0;i<G.notes.length;i++){if(!G.notes[i].judged){var d=Math.abs(G.notes[i].t-t);if(d<bd){bd=d;n=G.notes[i];}}}
    G.combo=0;G.counts={perfect:0,good:0,miss:0};
  })()`);
  // 等待最近的音符接近判定线
  let hit = null;
  for (let i = 0; i < 40; i++) {
    const info = JSON.parse((await ev(`(function(){var g=window.__game,G=g.G;var t=g.Sound.chartTime();
      var n=null,bd=9;for(var i=0;i<G.notes.length;i++){if(!G.notes[i].judged){var d=Math.abs(G.notes[i].t-t);if(d<bd){bd=d;n=G.notes[i];}}}
      return JSON.stringify({dt:n?n.t-t:9,lane:n?n.lane:-1});})()`)).value);
    if (info.dt > -0.02 && info.dt < 0.06) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      await sleep(120);
      hit = JSON.parse((await ev(`JSON.stringify({cnt:window.__game.G.counts,combo:window.__game.G.combo})`)).value);
      break;
    }
    await sleep(30);
  }
  ok('空格命中音符', hit && (hit.cnt.perfect + hit.cnt.good) > 0, JSON.stringify(hit));

  const audio = JSON.parse((await ev(`JSON.stringify({state:window.__game.Sound.ctx.state,t:window.__game.Sound.ctx.currentTime})`)).value);
  ok('音频上下文在运行', audio.state === 'running', JSON.stringify(audio));

  console.log('\n=== 5. 运行期异常 ===');
  const exc = logs.filter(l => l.startsWith('[EXC]'));
  ok('无异常', exc.length === 0, exc.join(' | '));
  console.log('\n  logs: ' + logs.slice(-6).join('\n         '));
  chrome.kill();
}
main().catch(e => { console.error(e); process.exit(1); });
