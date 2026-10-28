/* 诊断：简单难度 + 空格链路 / 暂停按钮点击 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const FILE = 'file://' + path.join(ROOT, 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bln-diag-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push('[c] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return { value: r.result?.result?.value };
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(2500);

  // 选简单
  console.log('== 选简单难度 ==');
  console.log((await ev(`(function(){document.querySelector('[data-diff="easy"]').click();var g=window.__game;return JSON.stringify({diff:g.G.diff,mode:g.G.mode,active:g.G.active});})()`)).value);

  // 开始
  console.log('== 点开始 ==');
  console.log((await ev(`document.querySelector('#btn-start').click(), 'clicked'`)).value);
  await sleep(400);
  console.log('state', (await ev('window.__game.G.state')).value);

  // 强制跳过教学倒计时
  console.log((await ev(`(function(){var g=window.__game;g.G.seenTutorial=true;g.G.countdownDur=1000;g.G.countdownStart=performance.now()-3000;g.G.tutNotes=[];return g.G.state;})()`)).value);
  await sleep(1600);
  console.log('state after cd', (await ev('window.__game.G.state')).value);

  // 观察 6 秒：每 500ms 记录 songTime / 最近未判定音符 / state
  for (let i = 0; i < 10; i++) {
    const info = await ev(`(function(){var g=window.__game,G=g.G;
      var n=null;for(var j=0;j<G.notes.length;j++){if(!G.notes[j].judged){n=G.notes[j];break;}}
      return JSON.stringify({st:G.state,t:+G.songTime.toFixed(2),speed:G.speed,cursor:G.cursor,
        next:n?{t:+n.t.toFixed(2),lane:n.lane}:null, combo:G.combo, cnt:G.counts, held:G.held.join('')});})()`);
    console.log(i, info.value || info.error);
    await sleep(500);
  }

  // 模拟空格按键（真实 dispatch）
  console.log('\n== 按空格 20 次 ==');
  await ev(`window.__k=0;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}));
            window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',key:' ',bubbles:true,cancelable:true}));`);
  await sleep(300);
  console.log((await ev(`(function(){var G=window.__game.G;return JSON.stringify({cnt:G.counts,combo:G.combo,empty:G.emptyCount,held:G.held.join('')});})()`)).value);

  // 检查 keyToLane 本身
  console.log('keyToLane Space ->', (await ev(`window.__game.testKeyToLane?window.__game.testKeyToLane('Space'):'n/a'`)).value);

  // 暂停按钮点击
  console.log('\n== 点击暂停按钮 ==');
  console.log((await ev(`(function(){var b=document.querySelector('#hud-pause');var r=b.getBoundingClientRect();
     var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
     return JSON.stringify({rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width)],topEl:el?el.id||el.className||el.tagName:'null'});})()`)).value);
  console.log((await ev(`document.querySelector('#hud-pause').click(),'js-click'`)).value);
  await sleep(300);
  console.log('state', (await ev('window.__game.G.state')).value);

  console.log('\n== 日志 ==');
  console.log(logs.slice(-40).join('\n'));
  chrome.kill();
}
main().catch(e => { console.error(e); process.exit(1); });
