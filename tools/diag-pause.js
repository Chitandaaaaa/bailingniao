/* 诊断暂停/继续  node tools/diag-pause.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 9371;
const FILE = 'file://' + path.join(ROOT, 'index.html');
function findBrowser() {
  return [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(p => fs.existsSync(p));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-pz-'));
  const chrome = spawn(findBrowser(), ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1200,800',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let target = null;
  for (let i = 0; i < 60; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (target) break; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EX] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('!!window.__game')) break; }
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('__game.Sound.ready')) break; }
  await ev(`document.getElementById('btn-start').click()`);
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`__game.G.state==='PLAYING'`)) break; }
  console.log('进入演奏:', await ev('__game.G.state'));
  await sleep(2500);
  console.log('点暂停:', await ev(`document.getElementById('hud-pause').click(); __game.G.state`));
  console.log('暂停面板可见:', await ev(`document.getElementById('pause-screen').classList.contains('on')`));
  console.log('点继续:', await ev(`document.getElementById('btn-resume').click(); __game.G.state`));
  await sleep(500);
  console.log('500ms后 state:', await ev('__game.G.state'), 'ctx:', await ev('__game.Sound.ctx.state'));
  console.log('面板仍可见?', await ev(`document.getElementById('pause-screen').classList.contains('on')`));
  // 再试 重新开始（带确认）
  console.log('--- 重新开始（二次确认）---');
  console.log('--- 暂停中重新开始（二次确认）---');
  console.log('点暂停:', await ev(`document.getElementById('hud-pause').click(); __game.G.state`));
  console.log('第一次点:', await ev(`document.getElementById('btn-restart').click(); __game.G.state`));
  console.log('第二次点:', await ev(`document.getElementById('btn-restart').click(); __game.G.state`));
  await sleep(600);
  console.log('600ms后 state:', await ev('__game.G.state'),
    '暂停面板:', await ev(`document.getElementById('pause-screen').classList.contains('on')`),
    '倒计时:', await ev(`document.getElementById('countdown').classList.contains('on')`));
  logs.forEach(l => console.log(l));
  ws.close(); chrome.kill(); process.exit(0);
})();
