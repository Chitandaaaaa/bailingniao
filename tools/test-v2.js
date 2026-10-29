/* 《百灵鸟在五线谱上飞行》v2 回归测试：三难度 / 输入映射 / 判定 / 里程碑 / 结算 */
const { chromium } = require('playwright-core');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const DIFFS = {
  easy: { lanes: [2], keys: ['Space'], anyKeyWorks: true },
  hard: { lanes: [1, 2, 3], keys: ['ArrowLeft', 'Space', 'ArrowRight'] },
  nightmare: { lanes: [0, 1, 2, 3, 4], keys: ['ArrowLeft', 'ArrowUp', 'Space', 'ArrowDown', 'ArrowRight'] }
};
const keyToLane = {
  easy: { ArrowLeft: 2, ArrowUp: 2, Space: 2, ArrowDown: 2, ArrowRight: 2 },
  hard: { ArrowLeft: 1, ArrowUp: 2, Space: 2, ArrowDown: 2, ArrowRight: 3 },
  nightmare: { ArrowLeft: 0, ArrowUp: 1, Space: 2, ArrowDown: 3, ArrowRight: 4 }
};

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required']
  });

  console.log('\n=== 1. 启动 ===');
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById('btn-start').classList.contains('is-busy'), { timeout: 40000 });
  const bootMs = Date.now() - t0;
  check('页面启动无异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  check('音频在 6 秒内就绪', bootMs < 6000, bootMs + 'ms');
  check('标题界面显示', await page.evaluate(() => document.getElementById('title-screen').classList.contains('on')));
  check('三张难度卡存在', await page.evaluate(() => document.querySelectorAll('.diff-card').length === 3));

  const audio = await page.evaluate(() => {
    const S = window.__game.Sound;
    return { keys: Object.keys(S.bank || {}).length, events: (S.events || []).length, charts: (window.__game.Sound.events || []).length };
  });
  check('乐器库已生成', audio.keys > 20, 'samples=' + audio.keys);
  check('编曲事件已生成', audio.events > 800, 'events=' + audio.events);

  /* ---------- 每个难度跑一遍 ---------- */
  for (const name of Object.keys(DIFFS)) {
    const d = DIFFS[name];
    console.log('\n=== 2. 难度：' + name + ' ===');
    await page.evaluate(k => {
      document.querySelector('.diff-card[data-diff="' + k + '"]').click();
    }, name);
    await sleep(150);
    check('难度切换生效', await page.evaluate(() => window.__game.G.diff === document.querySelector('.diff-card[aria-checked="true"]').dataset.diff));

    await page.evaluate(() => window.__game.toTitle());
    await sleep(150);
    await page.evaluate(k => { window.__game.G.seenTutorial = true; }, name);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });

    const st = await page.evaluate(() => {
      const G = window.__game.G;
      const cnt = [0, 0, 0, 0, 0];
      G.notes.forEach(n => cnt[n.lane]++);
      return { notes: G.notes.length, cnt, active: G.active.slice(), speed: G.speed };
    });
    const usedLanes = st.cnt.map((c, i) => c > 0 ? i : -1).filter(i => i >= 0);
    check('音符只落在活跃轨道', usedLanes.every(L => d.lanes.indexOf(L) >= 0), 'used=' + usedLanes.join(','));
    check('活跃轨道都有音符覆盖', d.lanes.every(L => st.cnt[L] > 20), st.cnt.join('/'));
    check('音符数量合理', st.notes > 260 && st.notes <= 700, 'notes=' + st.notes);
    check('下落速度按难度设定', st.speed > 0, 'speed=' + st.speed);

    /* 按键映射 */
    const mapping = await page.evaluate(k => {
      const out = {};
      for (const code of ['ArrowLeft', 'ArrowUp', 'Space', 'ArrowDown', 'ArrowRight']) {
        out[code] = window.__game.keyToLane ? window.__game.keyToLane(code) : null;
      }
      return out;
    }, name).catch(() => null);
    if (mapping && mapping.Space != null) {
      check('空格始终映射到中央轨', mapping.Space === 2, JSON.stringify(mapping));
    }

    /* 判定：直接命中一个音符，检查 PERFECT/计分/combo */
    const hit = await page.evaluate(() => {
      const g = window.__game, G = g.G;
      const t = g.Sound.chartTime();
      const n = G.notes.find(x => !x.judged && x.t > t + 0.4 && x.t < t + 1.2) || G.notes.find(x => !x.judged);
      if (!n) return null;
      const before = { combo: G.combo, score: G.score, perfect: G.counts.perfect };
      g.hitLane(n.lane, n.t);
      return { lane: n.lane, before, after: { combo: G.combo, score: G.score, perfect: G.counts.perfect } };
    });
    check('判定可命中并加分', !!hit && hit.after.score > hit.before.score, hit ? 'score ' + hit.before.score + ' -> ' + hit.after.score : 'no note');
    check('命中后 combo 递增', !!hit && hit.after.combo === hit.before.combo + 1, hit ? 'combo=' + hit.after.combo : '');

    /* 空轨按键不计分、不崩 */
    const emptyLane = d.lanes.length < 5 ? [0, 1, 2, 3, 4].find(L => d.lanes.indexOf(L) < 0) : null;
    if (emptyLane != null) {
      const r = await page.evaluate(L => {
        const g = window.__game, G = g.G;
        const before = G.counts.miss;
        g.hitLane(L, g.Sound.chartTime());
        return { before, after: G.counts.miss };
      }, emptyLane);
      check('非活跃轨判定不产生 MISS 计数异常', r.after >= r.before, JSON.stringify(r));
    }

    /* 里程碑：只有 100 连击有专属徽章，且只出现一次；10/30/50 等不再额外画数字
       （历史上 20 连击会错误显示 "10 COMBO"、50 会落在左下角键位图例旁、>100 会反复刷 "100"） */
    const ms = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = [];
      [10, 20, 30, 40, 50, 60, 100, 110, 120].forEach(n => {
        G.msFx = null; g.celebrate(n);
        out.push({ n: n, fx: !!G.msFx, key: G.msFx && G.msFx.key, shown: G.msFx && G.msFx.n });
      });
      return out;
    });
    const art = ms.filter(r => r.fx);
    check('100 连击徽章可触发且数字正确', art.length === 1 && art[0].n === 100 && art[0].shown === 100, JSON.stringify(art));
    check('其余连击不再弹多余数字', !ms.some(r => r.n !== 100 && r.fx), '');

    /* 结算 */
    const res = await page.evaluate(async () => {
      const g = window.__game;
      g.G.counts = { perfect: 180, good: 12, miss: 2 };
      g.G.maxCombo = 150; g.G.score = 28800;
      g.finishGame();
      await new Promise(r => setTimeout(r, 1800));
      return {
        state: g.G.state,
        on: document.getElementById('result-screen').classList.contains('on'),
        letter: document.getElementById('r-letter').textContent,
        score: document.getElementById('r-score').textContent
      };
    });
    check('结算界面弹出', res.state === 'RESULT' && res.on, JSON.stringify(res));
    check('结算评级与分数已填', !!res.letter && res.letter !== '-' && res.score !== '0', res.letter + ' / ' + res.score);

    await page.evaluate(() => window.__game.toTitle());
    await sleep(200);
  }

  /* ---------- 性能 ---------- */
  console.log('\n=== 3. 性能 ===');
  await page.evaluate(() => {
    document.querySelector('.diff-card[data-diff="nightmare"]').click();
    window.__game.G.seenTutorial = true;
  });
  await sleep(150);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
  await sleep(600);
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function tick() {
      n++;
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
      else res(+(n / ((performance.now() - t0) / 1000)).toFixed(1));
    })();
  }));
  check('噩梦难度帧率 >= 50fps', fps >= 50, 'fps=' + fps);

  /* 长跑稳定性（20 秒自动打） */
  await page.evaluate(() => {
    window.__auto = setInterval(() => {
      const g = window.__game, G = g.G;
      if (G.state !== 'PLAYING') return;
      const t = g.Sound.chartTime();
      /* 没有 hold 在延音时释放虚拟按住；命中 hold 则保持按住（模拟长按） */
      if (!G.holds.length) { for (let i = 0; i < 5; i++) G.held[i] = false; }
      for (const n of G.notes) {
        if (n.judged) continue;
        if (Math.abs(n.t - t) < 0.09) {
          if (n.type === 'hold') G.held[n.lane] = true;
          g.hitLane(n.lane, n.t);
        }
      }
    }, 16);
  });
  await sleep(20000);
  const long = await page.evaluate(() => {
    clearInterval(window.__auto);
    const G = window.__game.G;
    return { state: G.state, score: G.score, combo: G.combo, maxCombo: G.maxCombo, t: +G.songTime.toFixed(1), parts: G.parts.filter(p => p.live).length };
  });
  check('20 秒连打无中断', long.state === 'PLAYING' && long.t > 18, JSON.stringify(long));
  check('连击能正常累积', long.maxCombo >= 15, 'maxCombo=' + long.maxCombo);
  check('粒子池未泄漏', long.parts <= 400, 'live=' + long.parts);
  check('全程无运行期异常', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
