/* 谱面自检：node tools/chartgen-check.js [standard|practice] */
'use strict';
const ChartGen = require('./chartgen.js');

const mode = process.argv[2] === 'practice' ? 'practice' : 'standard';
const chart = ChartGen.generateChart({ mode, seed: 20250101 });
const segs = ChartGen.segmentsForMode(mode);
const v = ChartGen.validateChart(chart, segs, mode);
const s = v.stats;
const p = (x, n) => String(x).padStart(n);

console.log('================ 谱面自检 [' + mode + '] ================');
console.log('总音符数   : ' + s.total + '   (目标 ' + (mode === 'practice' ? 375 : 422) + ')');
console.log('onset 组数 : ' + s.onsets);
console.log('时间轴     : ' + Math.min(...chart.notes.map(n => n.t)).toFixed(2) + ' → ' + Math.max(...chart.notes.map(n => n.t)).toFixed(2) + ' s');
console.log('重试次数   : ' + (chart.stats.attempts !== undefined ? chart.stats.attempts : 'n/a') + (chart.stats.relaxed ? '   ⚠ 未完全通过（采用最优解）' : ''));
console.log('');
console.log('---- 分段（§6.3 七段细分表）----');
console.log(p('#', 3) + ' ' + p('段落', 14) + ' ' + p('小节', 5) + ' ' + p('音符', 9) + ' ' + p('音/小节', 8) + ' ' + p('音/拍', 7) + ' ' + p('峰值/拍', 8) + ' ' + p('最长chord', 9));
for (const g of s.segs) {
  console.log(p(g.id, 3) + ' ' + p(g.name, 14) + ' ' + p(g.bars, 5) + ' ' + p(g.notes + '/' + g.target, 9) + ' ' +
    p(g.perBar, 8) + ' ' + p(g.notesPerBeat, 7) + ' ' + p(g.peak + '(≤' + g.peakTarget + ')', 8) + ' ' + p(g.maxChord, 9));
}
console.log('');
console.log('---- chord 分布 ----');
console.log('单押组 ' + s.chordGroups[1] + ' / 双押组 ' + s.chordGroups[2] + ' / 三押组 ' + s.chordGroups[3]);
console.log('双押音符占比 ' + (s.dblShare * 100).toFixed(1) + '%   三押音符占比 ' + (s.triShare * 100).toFixed(1) + '%');
console.log('');
console.log('---- 轨道分布 (C9 目标 19/20/22/20/19) ----');
s.laneCounts.forEach((c, i) => console.log('  lane' + i + ' : ' + p(c, 4) + ' 音  ' + p(s.laneShare[i] + '%', 7)));
console.log('');
console.log('---- 强度变体 (C10 目标 82/12/6) ----');
console.log('  标准 ' + s.typeCounts.std + ' (' + s.typeShare.std + '%)  强音 ' + s.typeCounts.accent + ' (' + s.typeShare.accent + '%)  hold ' + s.typeCounts.hold + ' (' + s.typeShare.hold + '%)');
console.log('');
console.log('---- 轨道跳变 (C6≤35% / C7 45–55% / C8≤20%) ----');
console.log('  同轨 ' + s.jump.same + ' (' + s.jump.samePct + '%)  相邻 ' + s.jump.adj + ' (' + s.jump.adjPct + '%)  远跳 ' + s.jump.far + ' (' + s.jump.farPct + '%)');
console.log('');
if (v.errors.length) {
  console.log('❌ 校验未通过（' + v.errors.length + ' 项），前 25 条：');
  v.errors.slice(0, 25).forEach(e => console.log('   - ' + e));
  process.exitCode = 1;
} else {
  console.log('✅ 全部 C1–C14 + 分段表校验通过');
}
