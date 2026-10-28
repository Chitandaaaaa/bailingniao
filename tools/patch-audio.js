'use strict';
const fs = require('fs');
const HTML = '/Users/lxm/dev/workspace/github/bailingniao/index.html';
let s = fs.readFileSync(HTML, 'utf8');

const START = "  /* ---- 乐器样本库（离线渲染一次） ---- */";
const END = "  /* ---- 整曲离线渲染 ---- */";
const i = s.indexOf(START), j = s.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('marker not found', i, j); process.exit(1); }
const block = fs.readFileSync('/tmp/new-audio.js', 'utf8');
s = s.slice(0, i) + block + s.slice(j);
console.log('audio block replaced, removed', j - i, 'chars, inserted', block.length);

/* 注入 MIDI 数据 */
const data = fs.readFileSync('/tmp/summer-data.txt', 'utf8');
if (!s.includes('__SUMMER_DATA__')) { console.error('data placeholder missing'); process.exit(1); }
s = s.replace('__SUMMER_DATA__', () => data);
console.log('data injected', data.length);

fs.writeFileSync(HTML, s);
console.log('written', s.length);
