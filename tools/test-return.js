/* 回归：从高连击（噩梦+作弊 tier5）返回标题后，画面必须干净
   旧 bug：body 上的 tier5 类没清 → 全屏合成层（光芒/棱镜/等离子/火雨）留在主界面继续转 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });

  /* 把连击钉在 400+ 让 tier5 生效，并制造一批存活粒子 */
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__pin = setInterval(() => { G.combo = 420; G.maxCombo = 420; window.__game.bumpCombo(); }, 40);
  });
  await page.waitForTimeout(1600);

  console.log('=== 1. 返回前：tier5 确实生效 ===');
  const before = await page.evaluate(() => ({
    bodyCls: document.body.className,
    tier: window.__game.G.tier,
    live: window.__game.G.parts.filter(p => p.live).length,
    rings: window.__game.G.rings.length,
    cfOpacity: parseFloat(getComputedStyle(document.querySelector('#combo-full')).opacity)
  }));
  ok('body 带 tier5', /\btier5\b/.test(before.bodyCls), before.bodyCls);
  ok('#combo-full 已全亮', before.cfOpacity > 0.9, before.cfOpacity);
  ok('场上有存活粒子', before.live > 0, before.live);

  /* 模拟结算后回到主界面 */
  await page.evaluate(() => { clearInterval(window.__pin); window.__game.toTitle(); });
  await page.waitForTimeout(900);

  console.log('=== 2. 返回后：主界面必须干净 ===');
  const after = await page.evaluate(() => {
    const G = window.__game.G;
    const cf = document.querySelector('#combo-full');
    return {
      state: G.state,
      bodyCls: document.body.className,
      tier: G.tier, tierS: G.tierS, combo: G.combo,
      live: G.parts.filter(p => p.live).length,
      rings: G.rings.length, flashes: G.flashes.length,
      msFx: !!G.msFx,
      cfOpacity: parseFloat(getComputedStyle(cf).opacity),
      hudCls: document.querySelector('#hud-combo').className,
      cfHit: parseFloat(document.querySelector('#cf-hit').style.opacity || '0'),
      stageTransform: document.querySelector('#stage').style.transform || '',
      overlayOn: document.querySelector('#title-screen').classList.contains('on')
    };
  });
  ok('状态回到 TITLE', after.state === 'TITLE');
  ok('标题层已显示', after.overlayOn);
  ok('body 不再带任何 tier 类', !/\btier[1-5]\b/.test(after.bodyCls), after.bodyCls);
  ok('G.tier / tierS / combo 归零', after.tier === 0 && after.tierS === 0 && after.combo === 0,
    { tier: after.tier, tierS: after.tierS, combo: after.combo });
  ok('#combo-full 已淡出至 0', after.cfOpacity < 0.02, after.cfOpacity);
  ok('粒子池已清空', after.live === 0, after.live);
  ok('光环/闪白队列已清空', after.rings === 0 && after.flashes === 0, { rings: after.rings, flashes: after.flashes });
  ok('里程碑大字已清', !after.msFx);
  ok('#hud-combo 的 tier 类已清', !/tier[1-5]/.test(after.hudCls), after.hudCls);
  ok('#cf-hit 命中闪光归零', after.cfHit === 0, after.cfHit);
  ok('舞台震屏变换已复位', after.stageTransform === '', after.stageTransform);

  console.log('=== 3. 静置 1.2s：特效不能自己长回来 ===');
  await page.waitForTimeout(1200);
  const later = await page.evaluate(() => ({
    bodyCls: document.body.className,
    live: window.__game.G.parts.filter(p => p.live).length,
    cfOpacity: parseFloat(getComputedStyle(document.querySelector('#combo-full')).opacity),
    cvFxBlank: (function () {
      const c = document.querySelector('#cv-fx');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
      return true;
    })()
  }));
  ok('body 仍然干净', !/\btier[1-5]\b/.test(later.bodyCls), later.bodyCls);
  ok('没有新的连击粒子被喷出来', later.live === 0, later.live);
  ok('#combo-full 仍然隐藏', later.cfOpacity < 0.02, later.cfOpacity);
  ok('特效画布全透明（无残留像素）', later.cvFxBlank);

  console.log('=== 4. 能正常再开一局 ===');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => ['COUNTDOWN', 'PLAYING'].includes(window.__game.G.state), { timeout: 10000 });
  const re = await page.evaluate(() => ({ state: window.__game.G.state, tier: window.__game.G.tier, combo: window.__game.G.combo }));
  ok('重新开局进入倒计时/游玩', re.state === 'COUNTDOWN' || re.state === 'PLAYING', re.state);
  ok('新局从未连击状态起步', re.tier === 0 && re.combo === 0, re);

  ok('无页面异常', errs.length === 0, errs);
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
