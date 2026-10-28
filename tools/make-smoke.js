/* 无头 Chrome 冒烟测试：注入脚本 → 跑场景 → 把结果写进 DOM → --dump-dom 抓取 */
'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

const probe=`
<script>
(function(){
  window.__errs=[];
  window.addEventListener('error',function(e){window.__errs.push('ERR '+e.message+' @'+e.lineno+':'+e.colno);});
  window.addEventListener('unhandledrejection',function(e){window.__errs.push('REJ '+(e.reason&&e.reason.message||e.reason));});
  var log=[];
  function p(s){log.push(s);}
  function fire(code){
    var e=new KeyboardEvent('keydown',{code:code,key:code==='Space'?' ':code,bubbles:true,cancelable:true});
    window.dispatchEvent(e);
  }
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  (async function(){
    try{
      await wait(300);
      var g=window.__game;
      p('boot='+(g?'ok':'FAIL'));
      p('state='+g.G.state);
      p('notes='+(g.G.chart?g.G.chart.notes.length:'none'));
      p('audioCtx='+(g.Sound.ctx?g.Sound.ctx.state:'none'));
      /* 谱面自检（浏览器内再跑一次） */
      var c=g.generateChart({mode:'standard',seed:20250101});
      p('chartTotal='+c.notes.length+' segs='+c.stats.segs.map(function(s){return s.id+':'+s.notes+'/'+s.notesPerBeat;}).join(','));
      /* 开始游戏 */
      fire('Space');
      await wait(400);
      p('afterSpace='+g.G.state);
      /* 等待倒计时结束 → PLAYING */
      await wait(3200);
      p('afterCountdown='+g.G.state+' songTime='+g.G.songTime.toFixed(3));
      /* 强制命中一个音符：取当前最接近判定的音符 */
      var t=g.Sound.chartTime();
      var tgt=null,bd=1e9;
      for(var i=0;i<g.G.notes.length;i++){var d=Math.abs(g.G.notes[i].t-t);if(d<bd){bd=d;tgt=g.G.notes[i];}}
      p('nearestNote lane='+tgt.lane+' dt='+(tgt.t-t).toFixed(3)+' type='+tgt.type);
      g.hitLane(tgt.lane,tgt.t);
      await wait(120);
      p('score='+g.G.score+' combo='+g.G.combo+' counts='+JSON.stringify(g.G.counts));
      /* 里程碑 */
      g.G.combo=29;g.hitLane(tgt.lane,tgt.t+1);
      await wait(100);
      p('comboAfter='+g.G.combo+' score='+g.G.score);
      /* 粒子池 */
      p('parts='+g.G.parts.length+' live='+g.G.parts.filter(function(x){return x.live;}).length);
      /* 暂停 */
      fire('Escape');await wait(120);
      p('afterEsc='+g.G.state+' audioState='+(g.Sound.ctx?g.Sound.ctx.state:'-'));
      fire('Escape');await wait(120);
      p('afterEsc2='+g.G.state);
      /* 结算面板 */
      g.G.counts={perfect:400,good:20,miss:2};g.G.maxCombo=88;g.G.score=12345;
      g.G.songTime=200;
      await wait(300);
      p('afterEnd='+g.G.state);
      p('resultLetter='+(document.getElementById('r-letter')||{}).textContent);
      /* 对话框属性 */
      ['title-screen','pause-screen','result-screen'].forEach(function(id){
        var d=document.getElementById(id);
        p(id+':'+(d.getAttribute('role')||'-')+'/'+(d.getAttribute('aria-modal')||'-'));
      });
      p('errors='+window.__errs.length);
      window.__errs.forEach(function(e){p(e);});
    }catch(e){p('THROW '+(e&&e.message||e)+' | '+(e&&e.stack||'').split('\\n')[1]);}
    var d=document.createElement('pre');d.id='SMOKE';d.textContent=log.join('\\n');
    document.body.appendChild(d);
  })();
})();
<\/script>`;

const out=html.replace('</body>',probe+'</body>');
fs.writeFileSync('/tmp/smoke.html',out);
console.log('已生成 /tmp/smoke.html');
