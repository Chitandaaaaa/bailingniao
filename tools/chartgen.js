/* ============================================================
 * 《百灵鸟在五线谱上飞行》 谱面生成器 chartgen.js
 * 逻辑坐标系 1200x800 / 判定线 560 / noteSpeed 340 px/s
 * 依据：interaction-spec.md §6.1 §6.3 §6.4 (C1–C14)
 * 纯函数、无依赖，node 与浏览器通用
 *
 * 架构：两阶段
 *   Phase 1  planChart()  → 生成 onset 计划（时间 + 组大小），音符总数由构造保证精确
 *   Phase 2  assignLanes() → 为每个 onset 分配轨道，满足 C1–C14 + 比例目标
 *   Phase 3  assignTypes() → 分配 标准/强音/hold（C10/C11/C12）
 * ============================================================ */
'use strict';

var CFG = {
  LANES: 5,
  BEAT: 0.6,          // 100 BPM（《Summer》原曲速度）
  BAR_BEATS: 4,
  BAR: 2.4,           // 1 小节 = 2.4s
  SLOT: 0.3,          // 八分音符栅格：1 slot = 300ms
  SLOTS: 8,           // 每小节 8 个 slot
  BUCKET: 0.6,        // 1 拍 = 600ms（峰值密度统计桶）
  NOTE_END: 214.8,    // 音符时间轴终点（最后 2s 为尾奏）
  TOTAL_NOTES: 422,
  LANE_SHARE: [0.19, 0.20, 0.22, 0.20, 0.19],
  TYPE_SHARE: { std: 0.82, accent: 0.12, hold: 0.06 },
  JUMP_TARGET: { same: 0.30, adj: 0.52, far: 0.18 }
};

/* §6.3 七段细分表。bar1=89：第 90 小节(178~180s) 为尾奏，无音符。 */
var SEGMENTS = [
  { id: 1, name: '序曲·主题动机', bar0: 1,  bar1: 6,  notes: 12,  minGap: 500, dblCap: 0.00, triples: 0, maxChord: 1, spanMax: 1, peak: 1, perBar: null },
  { id: 2, name: '展开',         bar0: 7,  bar1: 20, notes: 42,  minGap: 375, dblCap: 0.05, triples: 0, maxChord: 2, spanMax: 2, peak: 2, perBar: null },
  { id: 3, name: '蓄力',         bar0: 21, bar1: 45, notes: 100, minGap: 300, dblCap: 0.12, triples: 0, maxChord: 2, spanMax: 2, peak: 2, perBar: null },
  { id: 4, name: '加速',         bar0: 46, bar1: 58, notes: 65,  minGap: 220, dblCap: 0.20, triples: 1, maxChord: 3, spanMax: 3, peak: 3, perBar: null },
  { id: 5, name: '临近',         bar0: 59, bar1: 71, notes: 78,  minGap: 190, dblCap: 0.22, triples: 1, maxChord: 3, spanMax: 3, peak: 3, perBar: null },
  { id: 6, name: '终章',         bar0: 72, bar1: 85, notes: 105, minGap: 160, dblCap: 0.25, triples: 4, maxChord: 3, spanMax: 4, peak: 4, perBar: null },
  { id: 7, name: '收束·华彩',    bar0: 86, bar1: 89, notes: 20,  minGap: 300, dblCap: 0.16, triples: 1, maxChord: 3, spanMax: 3, peak: 3, perBar: [6, 6, 4, 4] }
];

/* 练习模式：终章替换为简化版（§5.4：125 → 78 音，chord ≤ 2） */
function segmentsForMode(mode) {
  var segs = SEGMENTS.map(function (s) {
    return Object.assign({}, s, { perBar: s.perBar ? s.perBar.slice() : null });
  });
  if (mode === 'practice') {
    segs[5].notes = 58; segs[5].triples = 0; segs[5].maxChord = 2; segs[5].dblCap = 0.18;
    segs[6].triples = 0; segs[6].maxChord = 2; segs[6].notes = 20; segs[6].dblCap = 0.10;
  }
  return segs;
}

/* ------------------------------------------------------------ */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function barStart(bar) { return (bar - 1) * CFG.BAR; }
function bucketOf(t) { return Math.floor(t / CFG.BUCKET + 1e-9); }

/* 每小节内 groups 个 onset 的候选 slot 组合（八分栅格） */
var SLOT_PATTERNS = {
  1: [[0]],
  2: [[0, 4], [0, 2], [0, 4]],
  3: [[0, 3, 6], [0, 2, 4], [0, 4, 6]],
  4: [[0, 2, 4, 6], [0, 1, 3, 5], [0, 2, 3, 6]],
  5: [[0, 1, 3, 4, 6], [0, 2, 3, 5, 6], [0, 1, 2, 4, 6]],
  6: [[0, 1, 2, 4, 5, 6], [0, 1, 3, 4, 5, 6], [0, 2, 3, 4, 5, 6]],
  7: [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 7], [0, 1, 2, 3, 4, 6, 7]],
  8: [[0, 1, 2, 3, 4, 5, 6, 7]]
};

function distribute(total, n) {
  var out = [], base = Math.floor(total / n), rem = total - base * n;
  for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

/* ------------------------------------------------------------
 * Phase 1 —— onset 计划
 * ---------------------------------------------------------- */
function allocChords(kArr, D, T, rng) {
  var n = kArr.length;
  var plan = [];
  for (var i = 0; i < n; i++) plan.push({ d: 0, t: 0 });
  /* 容量：2*(d+t) + t <= k  ⇔  组数 o = k-d-2t >= d+t 且 o>=1 */
  function fits(i, dd, tt) {
    var d = plan[i].d + dd, t = plan[i].t + tt;
    return 2 * (d + t) + t <= kArr[i];
  }
  function place(pool, want, isTriple) {
    for (var c = 0; c < want; c++) {
      if (!pool.length) return;
      var idx = pool[Math.min(pool.length - 1, Math.floor((c + 0.5) * pool.length / want))];
      var done = false;
      if (fits(idx, isTriple ? 0 : 1, isTriple ? 1 : 0)) {
        if (isTriple) plan[idx].t++; else plan[idx].d++;
        done = true;
      }
      if (!done) {
        for (var j = 0; j < pool.length; j++) {
          var i2 = pool[(idx + j) % pool.length];
          if (fits(i2, isTriple ? 0 : 1, isTriple ? 1 : 0)) {
            if (isTriple) plan[i2].t++; else plan[i2].d++;
            done = true; break;
          }
        }
      }
      if (!done) return;
    }
  }
  var tc = [], dc = [];
  for (var i3 = 0; i3 < n; i3++) {
    if (kArr[i3] >= 3) tc.push(i3);
    if (kArr[i3] >= 2) dc.push(i3);
  }
  place(tc, T, true);
  place(dc, D, false);
  return plan;
}

function planChart(segs, rng) {
  var plan = [];
  for (var si = 0; si < segs.length; si++) {
    var seg = segs[si];
    var nBars = seg.bar1 - seg.bar0 + 1;
    var kArr = (seg.perBar && seg.perBar.length === nBars)
      ? seg.perBar.slice()
      : distribute(seg.notes, nBars);
    var D = Math.floor(seg.dblCap * seg.notes / 2);
    if (seg.id === 2 && D < 1) D = 1;   // 编排意图：seg2 首次出现 2 连押
    if (seg.id === 7 && D > 1) D = 1;
    var T = seg.triples;
    var cp = allocChords(kArr, D, T, rng);

    for (var bi = 0; bi < nBars; bi++) {
      var bar = seg.bar0 + bi;
      var k = kArr[bi];
      var d = cp[bi].d, t = cp[bi].t;
      var o = k - d - 2 * t;
      if (o < Math.max(1, d + t)) { t = 0; o = k - d; }
      if (o < 1) { d = 0; o = k; }
      if (o > CFG.SLOTS) { o = CFG.SLOTS; }

      var pats = SLOT_PATTERNS[o] || SLOT_PATTERNS[8];
      var slots = pats[Math.floor(rng() * pats.length)].slice(0, o);
      slots.sort(function (a, b) { return a - b; });

      /* 组大小：把 chord 放到尽量不挤占峰值桶的 slot 上（音符总数由构造保证精确） */
      var sizes = new Array(o);
      for (var i = 0; i < o; i++) sizes[i] = 1;
      var bucketLoad = {};   // 该段内每个拍桶的音符数
      var segPlan = plan.filter(function (g) { return g.seg === seg.id; });
      for (var q = 0; q < segPlan.length; q++) {
        var bk = bucketOf(segPlan[q].t);
        bucketLoad[bk] = (bucketLoad[bk] || 0) + segPlan[q].size;
      }
      var chordIdx = [];
      for (var c = 0; c < t; c++) chordIdx.push(3);
      for (var c2 = 0; c2 < d; c2++) chordIdx.push(2);
      /* 先把本小节所有 slot 的单音基线计入桶负载，再放 chord */
      for (var bi2 = 0; bi2 < o; bi2++) {
        var bkB = bucketOf(barStart(bar) + slots[bi2] * CFG.SLOT);
        bucketLoad[bkB] = (bucketLoad[bkB] || 0) + 1;
      }
      chordIdx.sort(function (a, b) { return b - a; });
      /* 按「桶占用最少」排序 slot，再加随机扰动 —— 天然压低峰值密度 */
      var order = slots.map(function (s, idx) { return idx; });
      order.sort(function (a, b) {
        var ba = bucketOf(barStart(bar) + slots[a] * CFG.SLOT);
        var bb = bucketOf(barStart(bar) + slots[b] * CFG.SLOT);
        return (bucketLoad[ba] || 0) - (bucketLoad[bb] || 0) + (rng() - 0.5) * 0.9;
      });
      for (var ci = 0; ci < chordIdx.length; ci++) {
        var size = chordIdx[ci];
        var pick = -1, pickLoad = Infinity;
        for (var oi = 0; oi < order.length; oi++) {
          var sIdx = order[oi];
          var bkT = bucketOf(barStart(bar) + slots[sIdx] * CFG.SLOT);
          var ld = bucketLoad[bkT] || 0;
          if (ld + size - 1 <= seg.peak) { pick = sIdx; pickLoad = ld; break; }   /* 优先不超峰值 */
          if (ld < pickLoad) { pickLoad = ld; pick = sIdx; }                        /* 兜底：最空桶 */
        }
        if (pick < 0) break;
        order.splice(order.indexOf(pick), 1);
        sizes[pick] = size;
        var bk2 = bucketOf(barStart(bar) + slots[pick] * CFG.SLOT);
        bucketLoad[bk2] = (bucketLoad[bk2] || 0) + size - 1;
      }

      for (var gi = 0; gi < o; gi++) {
        plan.push({
          t: barStart(bar) + slots[gi] * CFG.SLOT,
          size: sizes[gi],
          seg: seg.id, bar: bar, slot: slots[gi],
          beat: slots[gi] / 2
        });
      }
    }
  }
  plan.sort(function (a, b) { return a.t - b.t; });
  return plan;
}

/* ------------------------------------------------------------
 * Phase 2 —— 轨道分配
 * ---------------------------------------------------------- */
function assignLanes(plan, segs, rng) {
  var notes = [];
  var laneTimes = [[], [], [], [], []];
  var laneLastSeg = [0, 0, 0, 0, 0];
  var laneCount = [0, 0, 0, 0, 0];
  var laneTarget = CFG.LANE_SHARE.map(function (s) { return s * CFG.TOTAL_NOTES; });
  var catCount = { same: 0, adj: 0, far: 0 };
  var farRun = 0, lastPrimary = -1;
  var segMinGap = {};
  for (var s = 0; s < segs.length; s++) segMinGap[segs[s].id] = segs[s].minGap / 1000;

  function gapOK(lane, t, segId) {
    var arr = laneTimes[lane];
    if (!arr.length) return true;
    var last = arr[arr.length - 1];
    /* 硬底线 125ms，并取当前段与上一音所属段 minGap 的较大者 */
    var need = Math.max(125 / 1000, segMinGap[segId], segMinGap[laneLastSeg[lane]]);
    return (t - last) >= need - 1e-6;
  }
  function windowOK(lane, t) {
    var arr = laneTimes[lane], c = 0;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (t - arr[i] < CFG.BEAT * 3 - 1e-6) c++; else break;
    }
    return c <= 1;    /* C2：加入本音后同轨 3 拍内 ≤2 */
  }

  function classify(d) { return d === 0 ? 'same' : (d === 1 ? 'adj' : 'far'); }
  function deficit(cat) {
    var T = catCount.same + catCount.adj + catCount.far + 1;
    return CFG.JUMP_TARGET[cat] * T - catCount[cat];
  }

  for (var gi = 0; gi < plan.length; gi++) {
    var g = plan[gi];
    var t = g.t, size = g.size, segId = g.seg;
    var minGap = segMinGap[segId];
    var cand = [];
    for (var p = 0; p < CFG.LANES; p++) {
      if (!gapOK(p, t, segId)) continue;
      if (!windowOK(p, t)) continue;
      var cat = lastPrimary < 0 ? null : classify(Math.abs(p - lastPrimary));
      if (cat === 'far' && farRun >= 2) continue;     /* C5 */
      cand.push({ p: p, cat: cat });
    }
    if (!cand.length) {
      for (var p2 = 0; p2 < CFG.LANES; p2++) {
        if (!gapOK(p2, t, segId)) continue;
        cand.push({ p: p2, cat: lastPrimary < 0 ? null : classify(Math.abs(p2 - lastPrimary)) });
      }
    }
    if (!cand.length) {
      /* 兜底：取该轨最久未使用者 */
      var best = 0, bestT = -1;
      for (var p3 = 0; p3 < CFG.LANES; p3++) {
        var lt = laneTimes[p3].length ? laneTimes[p3][laneTimes[p3].length - 1] : -99;
        if (lt > bestT) { bestT = lt; best = p3; }
      }
      cand.push({ p: best, cat: lastPrimary < 0 ? null : classify(Math.abs(best - lastPrimary)) });
    }

    var scored = cand.map(function (c) {
      var s = 0;
      if (c.cat) s += 3.0 * deficit(c.cat);
      s -= 3.6 * ((laneCount[c.p] + 0.5) / laneTarget[c.p]);
      if (c.cat === 'adj') s += 1.1;
      s += rng() * 1.0;
      return { p: c.p, cat: c.cat, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
    var chosen = scored[0];
    var lanes = [chosen.p];

    if (size >= 2) {
      var sec = [];
      var offs = [1, -1, 2, -2];
      for (var oi = 0; oi < offs.length; oi++) {
        var q = chosen.p + offs[oi];
        if (q < 0 || q >= CFG.LANES) continue;
        if (!gapOK(q, t, segId) || !windowOK(q, t)) continue;
        var ps = -3.6 * ((laneCount[q] + 0.5) / laneTarget[q]);
        if (Math.abs(offs[oi]) === 1) ps += 0.8;
        ps += rng() * 0.8;
        sec.push({ q: q, s: ps });
      }
      if (!sec.length) {
        for (var oi2 = 0; oi2 < offs.length; oi2++) {
          var q2 = chosen.p + offs[oi2];
          if (q2 < 0 || q2 >= CFG.LANES) continue;
          sec.push({ q: q2, s: 0 });
        }
      }
      if (!sec.length) { size = 1; }
      else { sec.sort(function (a, b) { return b.s - a.s; }); lanes.push(sec[0].q); }
    }
    if (size >= 3) {
      var win = null;
      for (var w = 0; w < 3; w++) {
        var cd = [w, w + 1, w + 2];
        var ok = true;
        for (var ci = 0; ci < 3; ci++) {
          if (!gapOK(cd[ci], t, segId) || !windowOK(cd[ci], t)) { ok = false; break; }
        }
        if (!ok) continue;
        var ps2 = 0;
        for (var cj = 0; cj < 3; cj++) ps2 -= 3.6 * ((laneCount[cd[cj]] + 0.5) / laneTarget[cd[cj]]);
        ps2 += rng() * 1.0;
        if (!win || ps2 > win.s) win = { lanes: cd, s: ps2 };
      }
      if (!win) { size = 2; }
      else { lanes = win.lanes.slice(); }
    }

    lanes.sort(function (a, b) { return a - b; });
    for (var li = 0; li < lanes.length; li++) {
      var lane = lanes[li];
      notes.push({ t: t, lane: lane, type: 'std', holdBeats: 0, seg: segId, bar: g.bar, beat: g.beat });
      laneTimes[lane].push(t);
      laneLastSeg[lane] = segId;
      laneCount[lane]++;
    }
    if (chosen.cat) catCount[chosen.cat]++;
    farRun = (chosen.cat === 'far') ? farRun + 1 : 0;
    lastPrimary = chosen.p;
    g.lanes = lanes;
    g.size = lanes.length;
  }
  return { notes: notes, laneCount: laneCount, catCount: catCount };
}

/* ------------------------------------------------------------
 * Phase 3 —— 强度变体（C10 / C11 / C12）
 * ---------------------------------------------------------- */
function assignTypes(chart, segs) {
  var notes = chart.notes;
  var total = notes.length;
  var accentBudget = Math.round(total * CFG.TYPE_SHARE.accent);
  var holdBudget = Math.round(total * CFG.TYPE_SHARE.hold);

  /* hold：非强拍、每小节 ≤1、长度 ≤2 拍 */
  var holdBarUsed = {};
  var holdCand = [];
  var seenG = {};
  for (var i = 0; i < chart.groups.length; i++) {
    var g = chart.groups[i];
    if (g.size !== 1) continue;
    if (Math.abs(g.t - barStart(g.bar)) < 1e-6) continue;
    if (g.seg === 6) continue;
    if (holdBarUsed[g.bar]) continue;
    holdCand.push(g);
  }
  var picks = [];
  var stride = Math.max(1, Math.floor(holdCand.length / Math.max(1, holdBudget)));
  for (var k = 0; k < holdCand.length && picks.length < holdBudget; k += stride) picks.push(holdCand[k]);
  var idx = 0;
  while (picks.length < holdBudget && idx < holdCand.length) {
    var g2 = holdCand[idx++];
    if (picks.indexOf(g2) < 0 && !holdBarUsed[g2.bar]) picks.push(g2);
  }
  for (var h = 0; h < picks.length; h++) {
    var gh = picks[h];
    holdBarUsed[gh.bar] = true;
    for (var m = 0; m < notes.length; m++) {
      if (Math.abs(notes[m].t - gh.t) < 1e-6 && notes[m].lane === gh.lanes[0]) {
        notes[m].type = 'hold';
        notes[m].holdBeats = (h % 3 === 0) ? 2 : 1;
      }
    }
  }

  /* accent：只在强拍（第 1 拍），终章（第 6 段）不用 */
  var accentCand = [];
  for (var n = 0; n < notes.length; n++) {
    var nt = notes[n];
    if (nt.type !== 'std') continue;
    if (nt.seg === 6) continue;
    if (Math.abs(nt.t - barStart(nt.bar)) > 1e-6) continue;
    accentCand.push(nt);
  }
  var chosen = [];
  var step = Math.max(1, Math.floor(accentCand.length / Math.max(1, accentBudget)));
  for (var a = 0; a < accentCand.length && chosen.length < accentBudget; a += step) chosen.push(accentCand[a]);
  var ci = accentCand.length - 1;
  while (chosen.length < accentBudget && ci >= 0) {
    var c2 = accentCand[ci--];
    if (chosen.indexOf(c2) < 0) chosen.push(c2);
  }
  for (var c3 = 0; c3 < chosen.length; c3++) chosen[c3].type = 'accent';
  return chart;
}

/* ------------------------------------------------------------
 * 校验器
 * ---------------------------------------------------------- */
function validateChart(chart, segs, mode) {
  var errs = [], warns = [];
  var notes = chart.notes.slice().sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
  var groups = [], cur = null;
  for (var i = 0; i < notes.length; i++) {
    if (!cur || Math.abs(cur.t - notes[i].t) > 1e-6) {
      cur = { t: notes[i].t, notes: [], seg: notes[i].seg, bar: notes[i].bar };
      groups.push(cur);
    }
    cur.notes.push(notes[i]);
  }
  var expected = mode === 'practice' ? 375 : 422;
  if (notes.length !== expected) errs.push('音符总数 ' + notes.length + ' ≠ ' + expected);

  for (var i2 = 0; i2 < notes.length; i2++) {
    if (notes[i2].t < -1e-6 || notes[i2].t > CFG.NOTE_END + 1e-6) {
      errs.push('音符时间越界 t=' + notes[i2].t.toFixed(3)); break;
    }
  }

  /* C1 / C14 */
  var lastByLane = [-99, -99, -99, -99, -99], lastSeg = [0, 0, 0, 0, 0];
  for (var i3 = 0; i3 < notes.length; i3++) {
    var n = notes[i3], sg = segs[n.seg - 1];
    var gapMs = (n.t - lastByLane[n.lane]) * 1000;
    var need = Math.max(125, sg.minGap, segs[lastSeg[n.lane] - 1] ? segs[lastSeg[n.lane] - 1].minGap : 0);
    if (lastByLane[n.lane] > -50 && gapMs < need - 0.5) {
      errs.push('C1 同轨间隔 lane' + n.lane + ' ' + gapMs.toFixed(1) + 'ms < ' + need + 'ms @' + n.t.toFixed(2));
    }
    if (lastByLane[n.lane] > -50 && gapMs < 160 - 0.5) errs.push('C14 视觉间距 ' + gapMs.toFixed(1) + 'ms');
    lastByLane[n.lane] = n.t; lastSeg[n.lane] = n.seg;
  }

  /* C2 */
  var perLane = [[], [], [], [], []];
  for (var i4 = 0; i4 < notes.length; i4++) perLane[notes[i4].lane].push(notes[i4].t);
  for (var l = 0; l < 5; l++) {
    var arr = perLane[l];
    for (var a2 = 0; a2 < arr.length; a2++) {
      var c = 0;
      for (var b2 = a2 + 1; b2 < arr.length; b2++) { if (arr[b2] - arr[a2] < CFG.BEAT * 3 - 1e-6) c++; else break; }
      if (c > 1) { errs.push('C2 lane' + l + ' 3拍内 ' + (c + 1) + ' 音 @' + arr[a2].toFixed(2)); break; }
    }
  }

  /* C3 */
  var tIdx = [];
  for (var g2 = 0; g2 < groups.length; g2++) if (groups[g2].notes.length === 3) tIdx.push(g2);
  var consec = 0;
  for (var g3 = 0; g3 < tIdx.length; g3++) {
    if (g3 > 0) {
      var db = (groups[tIdx[g3]].t - groups[tIdx[g3 - 1]].t) / CFG.BEAT;
      if (db < 2 - 1e-6) errs.push('C3 三押间隔 ' + db.toFixed(2) + ' 拍');
      consec = (groups[tIdx[g3]].bar === groups[tIdx[g3 - 1]].bar) ? consec + 1 : 1;
      if (consec > 2) errs.push('C3 连续三押 >2');
    } else consec = 1;
  }

  /* C4 */
  for (var g4 = 0; g4 < groups.length; g4++) if (groups[g4].notes.length > 3) errs.push('C4 同拍 >3 音');

  /* C5 / C6 / C7 / C8 */
  var prim = groups.map(function (g) { return g.notes[0].lane; });
  var run = 0;
  for (var p = 1; p < prim.length; p++) {
    var dl = Math.abs(prim[p] - prim[p - 1]);
    if (dl >= 3) { run++; if (run > 2) { errs.push('C5 连续远跳 >2 @' + groups[p].t.toFixed(2)); break; } }
    else run = 0;
  }
  var same = 0, adj = 0, far = 0;
  for (var p2 = 1; p2 < prim.length; p2++) {
    var d2 = Math.abs(prim[p2] - prim[p2 - 1]);
    if (d2 === 0) same++; else if (d2 === 1) adj++; else far++;
  }
  var TT = same + adj + far;
  var rSame = same / TT, rAdj = adj / TT, rFar = far / TT;
  if (rSame > 0.35 + 1e-9) errs.push('C6 同轨连续 ' + (rSame * 100).toFixed(1) + '% > 35%');
  if (rAdj < 0.45 - 1e-9 || rAdj > 0.55 + 1e-9) errs.push('C7 相邻轨 ' + (rAdj * 100).toFixed(1) + '% ∉ [45,55]');
  if (rFar > 0.20 + 1e-9) errs.push('C8 远跳 ' + (rFar * 100).toFixed(1) + '% > 20%');

  /* C9 */
  var lc = [0, 0, 0, 0, 0];
  for (var i5 = 0; i5 < notes.length; i5++) lc[notes[i5].lane]++;
  var laneShare = lc.map(function (c) { return c / notes.length; });
  for (var l2 = 0; l2 < 5; l2++) {
    if (Math.abs(laneShare[l2] - CFG.LANE_SHARE[l2]) > 0.02) {
      errs.push('C9 轨道' + l2 + ' ' + (laneShare[l2] * 100).toFixed(1) + '% 偏离 ' + (CFG.LANE_SHARE[l2] * 100) + '%');
    }
  }

  /* C10 */
  var tc = { std: 0, accent: 0, hold: 0 };
  for (var i6 = 0; i6 < notes.length; i6++) tc[notes[i6].type]++;
  var ts = { std: tc.std / notes.length, accent: tc.accent / notes.length, hold: tc.hold / notes.length };
  if (Math.abs(ts.std - 0.82) > 0.02) errs.push('C10 标准 ' + (ts.std * 100).toFixed(1) + '%');
  if (Math.abs(ts.accent - 0.12) > 0.02) errs.push('C10 强音 ' + (ts.accent * 100).toFixed(1) + '%');
  if (Math.abs(ts.hold - 0.06) > 0.02) errs.push('C10 hold ' + (ts.hold * 100).toFixed(1) + '%');

  /* C11 */
  var holdBars = {};
  for (var i7 = 0; i7 < notes.length; i7++) {
    var hn = notes[i7];
    if (hn.type !== 'hold') continue;
    if (holdBars[hn.bar]) errs.push('C11 小节 ' + hn.bar + ' 多 hold');
    holdBars[hn.bar] = 1;
    if (hn.holdBeats > 2) errs.push('C11 hold 长度 >2 拍');
  }

  /* C12 */
  for (var i8 = 0; i8 < notes.length; i8++) {
    var an = notes[i8];
    if (an.type !== 'accent') continue;
    if (Math.abs(an.t - barStart(an.bar)) > 1e-6) errs.push('C12 强音不在强拍 @' + an.t.toFixed(2));
    if (an.seg === 6) errs.push('C12 终章出现强音');
  }

  /* C13 */
  for (var g5 = 0; g5 < groups.length; g5++) {
    var gn = groups[g5].notes;
    for (var x = 0; x < gn.length; x++) for (var y = x + 1; y < gn.length; y++) {
      if (Math.abs(gn[x].lane - gn[y].lane) > 2) errs.push('C13 同拍 Δlane=' + Math.abs(gn[x].lane - gn[y].lane));
    }
  }

  /* 分段统计 */
  var segStats = [];
  for (var s = 0; s < segs.length; s++) {
    var sg2 = segs[s];
    var sn = notes.filter(function (x) { return x.seg === sg2.id; });
    var beats = (sg2.bar1 - sg2.bar0 + 1) * CFG.BAR_BEATS;
    var bl = {};
    for (var bi = 0; bi < sn.length; bi++) { var bk = bucketOf(sn[bi].t); bl[bk] = (bl[bk] || 0) + 1; }
    var peak = 0;
    for (var bkk in bl) if (+bkk !== 0) peak = Math.max(peak, bl[bkk]);
    var segGroups = groups.filter(function (g) { return g.seg === sg2.id; });
    var maxChord = segGroups.reduce(function (m, g) { return Math.max(m, g.notes.length); }, 0);
    segStats.push({
      id: sg2.id, name: sg2.name, bars: sg2.bar1 - sg2.bar0 + 1,
      notes: sn.length, target: sg2.notes,
      perBar: +(sn.length / (sg2.bar1 - sg2.bar0 + 1)).toFixed(2),
      notesPerBeat: +(sn.length / beats).toFixed(2),
      peak: peak, peakTarget: sg2.peak, maxChord: maxChord, minGap: sg2.minGap
    });
    if (sn.length !== sg2.notes) errs.push('段' + sg2.id + ' 音符数 ' + sn.length + ' ≠ ' + sg2.notes);
  }

  var chordDist = { 1: 0, 2: 0, 3: 0 };
  var dblN = 0, triN = 0;
  for (var g6 = 0; g6 < groups.length; g6++) {
    chordDist[groups[g6].notes.length] = (chordDist[groups[g6].notes.length] || 0) + 1;
    if (groups[g6].notes.length === 2) dblN += 2;
    if (groups[g6].notes.length === 3) triN += 3;
  }
  var stats = {
    total: notes.length, onsets: groups.length,
    segs: segStats,
    chordGroups: chordDist,
    dblShare: +(dblN / notes.length).toFixed(4),
    triShare: +(triN / notes.length).toFixed(4),
    laneCounts: lc,
    laneShare: laneShare.map(function (x) { return +(x * 100).toFixed(1); }),
    typeCounts: tc,
    typeShare: { std: +(ts.std * 100).toFixed(1), accent: +(ts.accent * 100).toFixed(1), hold: +(ts.hold * 100).toFixed(1) },
    jump: { same: same, adj: adj, far: far, samePct: +(rSame * 100).toFixed(1), adjPct: +(rAdj * 100).toFixed(1), farPct: +(rFar * 100).toFixed(1) }
  };
  return { ok: errs.length === 0, errors: errs, warnings: warns, stats: stats };
}

/* ------------------------------------------------------------ */
function generateChart(opts) {
  opts = opts || {};
  var mode = opts.mode === 'practice' ? 'practice' : 'standard';
  var segs = segmentsForMode(mode);
  var baseSeed = (opts.seed === undefined ? 20250101 : opts.seed) | 0;
  var best = null;
  for (var attempt = 0; attempt < 300; attempt++) {
    var rng = mulberry32(baseSeed + attempt * 7919);
    var plan = planChart(segs, rng);
    var res = assignLanes(plan, segs, rng);
    var chart = { notes: res.notes, groups: plan, laneCount: res.laneCount };
    assignTypes(chart, segs);
    var v = validateChart(chart, segs, mode);
    if (v.ok) {
      chart.stats = v.stats; chart.stats.attempts = attempt + 1; chart.stats.mode = mode;
      return chart;
    }
    if (!best || v.errors.length < best.v.errors.length) best = { chart: chart, v: v };
  }
  best.chart.stats = best.v.stats;
  best.chart.stats.attempts = 300;
  best.chart.stats.mode = mode;
  best.chart.stats.relaxed = true;
  best.chart.stats.errors = best.v.errors;
  return best.chart;
}

var ChartGen = {
  CFG: CFG, SEGMENTS: SEGMENTS,
  generateChart: generateChart,
  validateChart: validateChart,
  segmentsForMode: segmentsForMode,
  mulberry32: mulberry32
};
if (typeof module !== 'undefined' && module.exports) module.exports = ChartGen;
if (typeof window !== 'undefined') window.ChartGen = ChartGen;
