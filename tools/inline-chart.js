/* 把 tools/chartgen.js 内联进 index.html 的占位区 */
'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const idxPath=path.join(root,'index.html');
let idx=fs.readFileSync(idxPath,'utf8');
const cg=fs.readFileSync(path.join(root,'tools','chartgen.js'),'utf8');
const BEGIN='/*<<<CHARTGEN>>>*/', END='/*<<<END_CHARTGEN>>>*/';
const re=new RegExp('/\\*<<<CHARTGEN>>>\\*/[\\s\\S]*?/\\*<<<END_CHARTGEN>>>\\*/');
if(!re.test(idx)){console.error('未找到占位区');process.exit(1);}
idx=idx.replace(re,()=>BEGIN+'\n'+cg.trim()+'\n'+END);
fs.writeFileSync(idxPath,idx);
console.log('已内联 chartgen.js（'+cg.split('\n').length+' 行）');
