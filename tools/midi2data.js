'use strict';
/* 把 /tmp/summer.mid 转成内嵌紧凑数据：
   每音 "bar,tickInBar,pitch,durTick,vel"，bar 从 1 起；tick 单位 1/256 拍 */
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2] || '/tmp/summer.mid');
let p = 0;
const u32 = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
const u16 = () => { const v = buf.readUInt16BE(p); p += 2; return v; };
const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
p += 4; const hlen = u32(); u16(); const ntr = u16(); const div = u16(); p = 8 + hlen;

let all = [];
for (let ti = 0; ti < ntr; ti++) {
  p += 4; const len = u32(); const end = p + len; let tick = 0, running = 0; const open = {};
  while (p < end) {
    const dt = vlq(); tick += dt; let st = buf[p];
    if (st < 0x80) { st = running; } else { p++; running = st; }
    const hi = st & 0xf0;
    if (st === 0xff) { p++; const l = vlq(); p += l; continue; }
    if (st === 0xf0 || st === 0xf7) { const l = vlq(); p += l; continue; }
    if (hi === 0x90 || hi === 0x80) {
      const n = buf[p++], v = buf[p++];
      if (hi === 0x90 && v > 0) open[n] = { tick, v };
      else if (open[n]) { all.push({ t: open[n].tick, d: Math.max(32, tick - open[n].tick), n, v: open[n].v }); delete open[n]; }
    }
    else if (hi === 0xc0 || hi === 0xd0) { p += 1; }
    else { p += 2; }
  }
  p = end;
}
all.sort((a, b) => a.t - b.t || a.n - b.n);

const perBar = div * 4;
const rows = [];
for (const x of all) {
  const bar = Math.floor(x.t / perBar) + 1;
  const tk = x.t - (bar - 1) * perBar;
  rows.push([bar, tk, x.n, x.d, x.v].join(','));
}
const data = rows.join(';');
fs.writeFileSync('/tmp/summer-data.txt', data);
console.log('notes', all.length, 'bytes', data.length);

/* 校验：音域、按小节分布 */
const bars = {};
all.forEach(x => { const b = Math.floor(x.t / perBar) + 1; bars[b] = (bars[b] || 0) + 1; });
console.log('bars', Object.keys(bars).length);
console.log('pitch', Math.min(...all.map(x => x.n)), '..', Math.max(...all.map(x => x.n)));
/* 每秒音符数（120BPM 缩放后：1 小节 2s） */
for (let b = 1; b <= 47; b += 4) console.log('bar', b, 'notes', bars[b] || 0);
