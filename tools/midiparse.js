'use strict';
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2] || '/tmp/summer.mid');
let p = 0;
function u32() { const v = buf.readUInt32BE(p); p += 4; return v; }
function u16() { const v = buf.readUInt16BE(p); p += 2; return v; }
function vlq() { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; }
const magic = buf.toString('ascii', p, p + 4); p += 4;
const hlen = u32(); const fmt = u16(); const ntr = u16(); const div = u16();
console.log('fmt', fmt, 'tracks', ntr, 'division', div);
p = 8 + hlen;
const tracks = [];
let tempoMap = [[0, 120]];
for (let ti = 0; ti < ntr; ti++) {
  const mtrk = buf.toString('ascii', p, p + 4); p += 4;
  const len = u32(); const end = p + len;
  let tick = 0, running = 0;
  const notes = []; const open = {};
  const evs = [];
  while (p < end) {
    const dt = vlq(); tick += dt;
    let status = buf[p];
    if (status < 0x80) { status = running; } else { p++; running = status; }
    const hi = status & 0xf0, ch = status & 0x0f;
    if (status === 0xff) {
      const type = buf[p++]; const l = vlq(); const data = buf.slice(p, p + l); p += l;
      if (type === 0x51) { const us = (data[0] << 16) | (data[1] << 8) | data[2]; tempoMap.push([tick, 60000000 / us]); }
      if (type === 0x58) evs.push({ tick, k: 'ts', v: data[0] + '/' + Math.pow(2, data[1]) });
      continue;
    }
    if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; continue; }
    if (hi === 0x90 || hi === 0x80) {
      const n = buf[p++], vel = buf[p++];
      if (hi === 0x90 && vel > 0) open[n] = { tick, vel };
      else if (open[n]) { notes.push({ tick: open[n].tick, dur: tick - open[n].tick, n, vel: open[n].vel }); delete open[n]; }
    } else if (hi === 0xc0 || hi === 0xd0) { p += 1; }
    else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) { p += 2; }
  }
  p = end;
  notes.sort((a, b) => a.tick - b.tick);
  tracks.push({ notes, evs });
  console.log('track', ti, 'notes', notes.length, 'range', notes.length ? notes[0].tick + '..' + notes[notes.length - 1].tick : '-');
}
console.log('tempo map', tempoMap);

// 秒换算（假设单 tempo）
const tempo = tempoMap[tempoMap.length - 1][1];
const spb = 60 / tempo; // sec per beat
const T = tick => tick / div * spb;
console.log('BPM', tempo.toFixed(2), 'total sec', T(Math.max(...tracks.map(t => t.notes.length ? t.notes[t.notes.length - 1].tick : 0))).toFixed(2));
console.log('bars (4/4):', (Math.max(...tracks.map(t => t.notes.length ? t.notes[t.notes.length - 1].tick : 0)) / div / 4).toFixed(2));

// 每小节每轨音符数
const bars = Math.ceil(Math.max(...tracks.map(t => t.notes.length ? t.notes[t.notes.length - 1].tick : 0)) / div / 4);
for (let b = 0; b < Math.min(bars, 80); b++) {
  const row = tracks.map(t => t.notes.filter(nn => Math.floor(nn.tick / div / 4) === b).length);
  console.log('bar ' + String(b + 1).padStart(2) + '  notes/track: ' + row.join(' / '));
}
// 打印前 40 小节 track0 旋律（pitch 名）
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = m => NN[m % 12] + (Math.floor(m / 12) - 1);
console.log('\n--- track0 first 12 bars ---');
tracks[0].notes.filter(n => n.tick < div * 4 * 12).forEach(n => {
  const beat = n.tick / div;
  console.log(`bar ${Math.floor(beat / 4) + 1} beat ${(beat % 4).toFixed(2)}  ${name(n.n)} dur ${(n.dur / div).toFixed(2)}b vel ${n.vel}`);
});
