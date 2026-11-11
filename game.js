const COLS=15, ROWS=13, N=COLS*ROWS, T=40, FLAME=0.45, FUSE=2.6, TRAP=4.5, BASE_SPEED=4;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const DIRMAP={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const $=id=>document.getElementById(id);
const cv=$('cv'), ctx=cv.getContext('2d');

let tiles=new Uint8Array(N), items=new Array(N).fill(0), bal=new Array(N).fill(null), flames=new Float32Array(N), itemT=new Float32Array(N);
let santa=null, santaT=10, drops=[], texts=[];
let balloons=[], ents=[], parts=[], player=null;
let state='menu', endT=0, stage=1, best=0, clock=0, frameNo=0, mode='solo', mySeat=0;
try{ best=+localStorage.getItem('bn-best')||0 }catch(e){}
/* betting: play-money only. bet is set while a bots-only match you wagered on is running */
let matchT=0, rainT=0, rainOn=false;   /* match clock; balloons rain down once it passes RAIN_AT */
const RAIN_AT=210, RAIN_AT_BET=45;
let autoPlay=false;   /* the bot brain drives your own character; e.auto is separate from e.bot so win rules still count you as a person */
let bet=null, coins=100, betPick=0, betStake=10;
try{ const c=localStorage.getItem('bn-coin'); if(c!==null) coins=+c||0 }catch(e){}

/* ---------- sound ---------- */
let ac=null, muted=false;
function tone(f,d,type,v,slide){
  if(!ac||muted) return;
  try{
    const o=ac.createOscillator(), g=ac.createGain(), t=ac.currentTime;
    o.type=type||'sine'; o.frequency.setValueAtTime(f,t);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,f+slide),t+d);
    g.gain.setValueAtTime(v||0.07,t); g.gain.exponentialRampToValueAtTime(0.001,t+d);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+d);
  }catch(e){}
}
const sfx={
  place:()=>tone(420,0.09,'triangle',0.06,-180),
  boom:()=>{tone(170,0.28,'sawtooth',0.07,-130); tone(90,0.3,'square',0.04,-50)},
  pick:()=>{tone(660,0.08,'triangle',0.06); setTimeout(()=>tone(990,0.1,'triangle',0.06),70)},
  trap:()=>tone(300,0.3,'sine',0.08,300),
  pop:()=>tone(700,0.2,'square',0.05,-600),
  bell:()=>[1319,1568,1319,1568,2093].forEach((f,i)=>setTimeout(()=>tone(f,0.14,'triangle',0.06),i*120)),
  win:()=>[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,0.16,'triangle',0.07),i*110)),
  lose:()=>[392,330,262].forEach((f,i)=>setTimeout(()=>tone(f,0.22,'triangle',0.07),i*150)),
};

/* ---------- world ---------- */
const idx=(c,r)=>r*COLS+c;
const MID=idx(COLS>>1,ROWS>>1);
const cellOf=e=>idx(Math.round(e.x),Math.round(e.y));
const inb=(c,r)=>c>=0&&r>=0&&c<COLS&&r<ROWS;
const solid=(c,r)=>!inb(c,r)||tiles[idx(c,r)]!==0||!!bal[idx(c,r)];

function mk(name,color,dark,c,r,bot){
  return {name,color,dark,x:c,y:r,alive:true,trapped:false,trap:0,inv:0,cap:1,active:0,range:1,
    speed:bot?3.2+Math.min(1.2,((mode==='solo'?stage:2)-1)*0.25):BASE_SPEED, needles:bot?0:1, bot, goal:-1, wait:0.4+Math.random()*0.6,
    face:[0,1], moving:false};
}
function newWorld(names){
  names=names||['Bạn'];
  tiles.fill(0); items.fill(0); bal.fill(null); flames.fill(0); itemT.fill(0); balloons=[]; parts=[]; santa=null; santaT=10; drops=[]; texts=[]; matchT=0; rainT=0; rainOn=false;
  const keep=new Set();
  for(const [c,r] of [[0,0],[COLS-1,0],[0,ROWS-1],[COLS-1,ROWS-1]]){
    const sx=c?-1:1, sy=r?-1:1;
    [[0,0],[1,0],[2,0],[0,1],[0,2]].forEach(([a,b])=>keep.add(idx(c+a*sx,r+b*sy)));
  }
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const i=idx(c,r);
    if(c%2===1&&r%2===1) tiles[i]=1;
    else if(!keep.has(i)&&Math.random()<0.78) tiles[i]=2;
  }
  /* centrepiece: a giant golden tree fills the middle 3x3; one power-up waits on each of its four sides */
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) tiles[MID+dr*COLS+dc]=1;
  for(const d of [-2,2,-2*COLS,2*COLS]){ const p=Math.random(); tiles[MID+d]=0; items[MID+d]=p<0.35?'b':p<0.7?'r':p<0.92?'s':'n'; }
  makeEnts(names,names.length);
}
const SEATS=[['p_pink','#ff5fa2','#c42f73','Mèo',0,0],['p_green','#58c96e','#2c8f43','Bơ',COLS-1,0],['p_purple','#9a6bff','#6238c9','Mận',0,ROWS-1],['p_blue','#2f7df0','#1b4fb0','Bạc Hà',COLS-1,ROWS-1]];
function makeEnts(names,humans){
  ents=SEATS.map((s,k)=>{ const e=mk(names[k]||s[3],s[1],s[2],s[4],s[5],k>=humans); e.kind=s[0]; e.x0=k; e.tx=e.x; e.ty=e.y; return e; });
  player=ents[mySeat]||ents[0]; player.auto=autoPlay;
  buildChips(); hudKey='';
}

/* ---------- movement with corner assist ---------- */
function step(e,dx,dy,dist){
  const a=dx?'x':'y', b=dx?'y':'x', s=dx||dy;
  const blk=(av,bv)=>a==='x'?solid(av,bv):solid(bv,av);
  let lane=Math.round(e[b]); const off=e[b]-lane, ca=Math.round(e[a]);
  if(Math.abs(off)>1e-4){
    let t=lane;
    if(blk(ca+s,lane)){
      const o=off>0?lane+1:lane-1;
      if(!blk(ca+s,o)&&!blk(ca,o)) t=o; else return;
    }
    const d=Math.min(dist,Math.abs(t-e[b]));
    e[b]+=Math.sign(t-e[b])*d; dist-=d;
    if(Math.abs(t-e[b])>1e-4) return;
    e[b]=t; lane=t; if(dist<=0) return;
  } else e[b]=lane;
  let n=e[a]+s*dist;
  if(blk(ca+s,lane)) n=s>0?Math.max(e[a],Math.min(n,ca)):Math.min(e[a],Math.max(n,ca));
  e[a]=n;
}

/* ---------- balloons ---------- */
function place(e){
  if(!e.alive||e.trapped||e.active>=e.cap) return false;
  const i=cellOf(e); if(bal[i]) return false;
  const b={i,c:i%COLS,r:(i/COLS)|0,owner:e,range:e.range,t:FUSE};
  bal[i]=b; balloons.push(b); e.active++; sfx.place(); return true;
}
function burst(x,y,color,n){
  for(let k=0;k<n;k++){
    const a=Math.random()*6.283, v=40+Math.random()*120;
    parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-30,life:0.35+Math.random()*0.3,color,size:2+Math.random()*3});
  }
}
function explode(b){
  bal[b.i]=null; b.done=true; b.owner.active=Math.max(0,b.owner.active-1);
  flames[b.i]=FLAME; items[b.i]=0;
  for(const [dx,dy] of DIRS){
    for(let k=1;k<=b.range;k++){
      const c=b.c+dx*k, r=b.r+dy*k; if(!inb(c,r)) break;
      const i=idx(c,r);
      if(tiles[i]===1) break;
      if(tiles[i]===2){
        tiles[i]=0; flames[i]=FLAME;
        burst((c+.5)*T,(r+.5)*T,'#ffb199',7);
        if(Math.random()<0.4){ const p=Math.random(); items[i]=p<0.35?'b':p<0.7?'r':p<0.92?'s':'n'; itemT[i]=clock; }
        break;
      }
      if(bal[i]){ bal[i].t=Math.min(bal[i].t,0.07); break; }
      flames[i]=FLAME; items[i]=0;
    }
  }
  sfx.boom();
}
function blast(c,r,range,out){
  out[idx(c,r)]=1;
  for(const [dx,dy] of DIRS) for(let k=1;k<=range;k++){
    const cc=c+dx*k, rr=r+dy*k; if(!inb(cc,rr)) break;
    const i=idx(cc,rr); if(tiles[i]===1) break;
    out[i]=1; if(tiles[i]===2||bal[i]) break;
  }
}

/* ---------- bots ---------- */
const dm=new Uint8Array(N); let dmFrame=-1;
function danger(){
  if(dmFrame===frameNo) return dm;
  dmFrame=frameNo; dm.fill(0);
  for(const b of balloons) blast(b.c,b.r,b.range,dm);
  for(let i=0;i<N;i++) if(flames[i]>0) dm[i]=2;
  return dm;
}
const A1={dist:new Int16Array(N),prev:new Int16Array(N),q:new Int16Array(N)};
const A2={dist:new Int16Array(N),prev:new Int16Array(N),q:new Int16Array(N)};
function bfs(start,pass,maxD,A){
  A.dist.fill(-1); let h=0,t=0; A.q[t++]=start; A.dist[start]=0; A.prev[start]=-1;
  while(h<t){
    const i=A.q[h++], d=A.dist[i]; if(d>=maxD) continue;
    const c=i%COLS, r=(i/COLS)|0;
    for(const [dx,dy] of DIRS){
      const nc=c+dx, nr=r+dy; if(!inb(nc,nr)) continue;
      const j=nr*COLS+nc; if(A.dist[j]>=0||!pass(j)) continue;
      A.dist[j]=d+1; A.prev[j]=i; A.q[t++]=j;
    }
  }
  return t;
}
function firstStep(A,start,target){
  let i=target; if(i===start) return start;
  while(A.prev[i]!==start&&A.prev[i]!==-1) i=A.prev[i];
  return i;
}
const hyp=new Uint8Array(N);
function canEscape(i,b,d){
  hyp.fill(0); blast(i%COLS,(i/COLS)|0,b.range,hyp);
  const n=bfs(i,j=>tiles[j]===0&&!bal[j]&&d[j]!==2,5,A2);
  for(let k=0;k<n;k++){ const j=A2.q[k]; if(!hyp[j]&&d[j]===0) return true; }
  return false;
}
function bombValue(i,b){
  const c=i%COLS, r=(i/COLS)|0; let v=0;
  for(const [dx,dy] of DIRS) for(let k=1;k<=b.range;k++){
    const cc=c+dx*k, rr=r+dy*k; if(!inb(cc,rr)) break;
    const j=idx(cc,rr); if(tiles[j]===1||bal[j]) break;
    if(tiles[j]===2){ v+=1; break; }
    for(const o of ents) if(o!==b&&o.alive&&!o.trapped&&cellOf(o)===j) v+=10;
  }
  return v;
}
function think(b){
  const d=danger(), c0=cellOf(b);
  if(d[c0]){
    const n=bfs(c0,j=>tiles[j]===0&&!bal[j]&&d[j]!==2,12,A1);
    for(let k=0;k<n;k++){ const j=A1.q[k]; if(d[j]===0) return firstStep(A1,c0,j); }
    return c0;
  }
  const n=bfs(c0,j=>tiles[j]===0&&!bal[j]&&d[j]===0,40,A1);
  let bestI=-1, bestS=1e9, kind='';
  for(let k=0;k<n;k++){
    const i=A1.q[k], dist=A1.dist[i];
    for(const o of ents) if(o!==b&&o.alive&&o.trapped&&cellOf(o)===i&&dist-30<bestS){ bestS=dist-30; bestI=i; kind='hunt'; }
    if(items[i]&&dist-2<bestS){ bestS=dist-2; bestI=i; kind='item'; }
    if(b.active<b.cap&&dist<=10){
      const v=bombValue(i,b);
      if(v>0){
        const s=dist+(v>=10?-6:1.5)-Math.min(v,3)*0.4;
        if(s<bestS&&canEscape(i,b,d)){ bestS=s; bestI=i; kind='bomb'; }
      }
    }
  }
  if(bestI<0){
    let tgt=c0, bd=1e9;
    for(let k=0;k<n;k++){
      const i=A1.q[k], c=i%COLS, r=(i/COLS)|0;
      for(const o of ents) if(o!==b&&o.alive){
        const m=Math.abs(o.x-c)+Math.abs(o.y-r)+A1.dist[i]*0.05;
        if(m<bd){ bd=m; tgt=i; }
      }
    }
    return firstStep(A1,c0,tgt);
  }
  if(kind==='bomb'&&bestI===c0){ place(b); return c0; }
  return firstStep(A1,c0,bestI);
}
function updateBot(b,dt){
  if(b.trapped){ b.moving=false; if(b.needles>0&&b.trap<TRAP-1.2) useNeedle(b); return; }
  b.wait-=dt;
  const here=cellOf(b);
  if(b.goal<0) b.goal=here;
  let gc=b.goal%COLS, gr=(b.goal/COLS)|0;
  if(Math.abs(b.x-gc)<1e-3&&Math.abs(b.y-gr)<1e-3){
    b.x=gc; b.y=gr;
    if(b.wait<=0||danger()[here]){
      const g=think(b);
      if(g===here) b.wait=0.12;
      b.goal=g; gc=g%COLS; gr=(g/COLS)|0;
    }
  } else if(b.goal!==here&&(tiles[b.goal]||bal[b.goal]||flames[b.goal]>0)){
    b.goal=here; gc=here%COLS; gr=(here/COLS)|0;
  }
  const ddx=gc-b.x, ddy=gr-b.y, mv=b.speed*dt;
  b.moving=false;
  if(Math.abs(ddx)>1e-3){ b.x+=Math.sign(ddx)*Math.min(mv,Math.abs(ddx)); b.face=[Math.sign(ddx),0]; b.moving=true; }
  else if(Math.abs(ddy)>1e-3){ b.y+=Math.sign(ddy)*Math.min(mv,Math.abs(ddy)); b.face=[0,Math.sign(ddy)]; b.moving=true; }
}

/* ---------- rules ---------- */
function useNeedle(e){
  if(!e.alive||!e.trapped||e.needles<=0) return;
  e.needles--; e.trapped=false; e.inv=1.5; e.goal=-1;
  e.x=Math.round(e.x); e.y=Math.round(e.y);
  burst((e.x+.5)*T,(e.y+.5)*T,'#d6f4ff',10); sfx.pick();
}
function kill(e){
  e.alive=false; e.trapped=false;
  burst((e.x+.5)*T,(e.y+.5)*T,e.color,18); burst((e.x+.5)*T,(e.y+.5)*T,'#ffffff',8); sfx.pop();
}
const LABEL={b:'+1 bóng',r:'+1 tầm nổ',s:'+ tốc độ',n:'+1 kim'};
const SANTA_Y=6.5*T;
function updateSanta(dt){
  for(const d of drops){
    d.p+=dt/0.85;
    if(d.p>=1){
      d.done=true;
      if(tiles[d.i]===0&&!bal[d.i]){ items[d.i]=d.type; itemT[d.i]=clock-0.2; burst((d.i%COLS+.5)*T,(((d.i/COLS)|0)+.5)*T,'#ffffff',6); }
    }
  }
  drops=drops.filter(d=>!d.done);
  if(!santa){
    santaT-=dt;
    if(santaT<=0&&state==='play'){
      santa={x:-130,k:0,xs:Array.from({length:10},(_,k)=>40+k*56+Math.random()*20)};
      sfx.bell();
    }
    return;
  }
  santa.x+=150*dt;
  while(santa.k<10&&santa.x>=santa.xs[santa.k]){
    const free=[];
    for(let i=0;i<N;i++) if(tiles[i]===0&&!items[i]&&!bal[i]&&!drops.some(d=>d.i===i)) free.push(i);
    if(free.length){
      const q=Math.random();
      drops.push({i:free[Math.random()*free.length|0],type:q<0.32?'b':q<0.64?'r':q<0.88?'s':'n',fx:santa.xs[santa.k],fy:SANTA_Y-6,p:0});
    }
    santa.k++;
  }
  if(santa.x>COLS*T+150){ santa=null; santaT=28; }
}
const held=[]; let wantDrop=false;
function update(dt){
  clock+=dt; frameNo++;
  for(let i=0;i<N;i++) if(flames[i]>0) flames[i]=Math.max(0,flames[i]-dt);
  for(const b of balloons) b.t-=dt;
  for(const b of balloons.slice()) if(!b.done&&b.t<=0) explode(b);
  balloons=balloons.filter(b=>!b.done);

  for(const e of ents){
    if(!e.alive) continue;
    if(e.bot||e.auto){ updateBot(e,dt); continue; }
    let dir=null, drop=false;
    if(e===player){ dir=held.length?DIRMAP[held[held.length-1]]:null; drop=wantDrop; }
    else if(e.net){
      dir=NDIR[e.net.d]||null; drop=e.net.drop; e.net.drop=false;
      if(e.net.pin){ e.net.pin=false; useNeedle(e); }
    }
    if(drop) place(e);
    e.moving=false;
    if(dir){
      const ox=e.x, oy=e.y;
      step(e,dir[0],dir[1],(e.trapped?0.9:e.speed)*dt);
      e.face=dir; e.moving=ox!==e.x||oy!==e.y;
    }
  }
  wantDrop=false;

  for(const e of ents){
    if(!e.alive) continue;
    if(e.inv>0) e.inv-=dt;
    const i=cellOf(e);
    if(e.trapped){
      e.trap-=dt;
      if(e.trap<=0){ kill(e); continue; }
      for(const o of ents) if(o!==e&&o.alive&&!o.trapped&&Math.hypot(o.x-e.x,o.y-e.y)<0.75){ kill(e); break; }
      continue;
    }
    if(flames[i]>0&&e.inv<=0){ e.trapped=true; e.trap=TRAP; if(e===player||state==='play') sfx.trap(); continue; }
    const it=items[i];
    if(it){
      items[i]=0;
      if(it==='b') e.cap=Math.min(6,e.cap+1);
      else if(it==='r') e.range=Math.min(7,e.range+1);
      else if(it==='s') e.speed=Math.min(e.bot?5.6:6.7,e.speed+0.45);
      else e.needles=Math.min(3,e.needles+1);
      burst((e.x+.5)*T,(e.y+.5)*T,ITEM_COL[it][1],8);
      if(e===player){ sfx.pick(); texts.push({x:(e.x+.5)*T,y:e.y*T-10,txt:LABEL[it],life:1.1}); }
    }
  }
  for(const p of parts){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=260*dt; p.life-=dt; }
  parts=parts.filter(p=>p.life>0);
  for(const t of texts){ t.y-=22*dt; t.life-=dt; }
  texts=texts.filter(t=>t.life>0);
  updateSanta(dt);

  /* a match that drags on gets a rain of balloons on random free cells, faster and wider over time, so everyone has to run.
     bet matches start it early: bots left alone can dodge each other forever */
  const r0=bet?RAIN_AT_BET:RAIN_AT;
  if(state==='play'&&(matchT+=dt)>r0&&(rainT-=dt)<=0){
    if(!rainOn){ rainOn=true; texts.push({x:COLS*T/2,y:ROWS*T/2-70,txt:'Mưa bóng nước!',life:2.5}); sfx.bell(); }
    rainT=Math.max(0.2,1.2-(matchT-r0)*0.02);
    const free=[]; for(let i=0;i<N;i++) if(tiles[i]===0&&!bal[i]) free.push(i);
    if(free.length){ const i=free[Math.random()*free.length|0], b={i,c:i%COLS,r:(i/COLS)|0,owner:{active:0},range:2+((matchT-r0)/20|0),t:FUSE}; bal[i]=b; balloons.push(b); }
  }
  if(state==='play'){
    const alive=ents.filter(e=>e.alive);
    const done=bet?(!player.alive||alive.length<=1||matchT>150):mode==='solo'?(!player.alive||!alive.some(e=>e.bot)):(alive.length<=1||!alive.some(e=>!e.bot));
    if(done){ state='ending'; endT=1.2; }
  } else if(state==='ending'){
    endT-=dt; if(endT<=0) finish();
  }
}
function finish(){
  if(mode!=='solo'){ finishOnline(); return; }
  if(bet){ finishBet(); return; }
  state='over';
  const won=player.alive;
  if(won){
    sfx.win();
    if(stage>best){ best=stage; try{ localStorage.setItem('bn-best',best) }catch(e){} }
    $('ovTitle').textContent='Bạn thắng màn '+stage;
    $('ovText').textContent='Cả ba đối thủ đã bị loại. Ở màn sau họ chạy nhanh hơn.';
    $('go').textContent='Màn tiếp theo'; stage++;
  } else {
    sfx.lose();
    $('ovTitle').textContent='Bạn bị loại';
    $('ovText').textContent='Bạn dừng ở màn '+stage+'. Mẹo: đặt bóng xong hãy rẽ vào góc khuất, đừng chạy thẳng theo hàng.';
    $('go').textContent='Chơi lại'; stage=1;
  }
  view('main'); $('go').focus();
}
function initAudio(){
  if(!ac){ try{ ac=new (window.AudioContext||window.webkitAudioContext)() }catch(e){} }
  if(ac&&ac.state==='suspended') ac.resume();
}
function startGame(){
  initAudio();
  mode='solo'; mySeat=0; bet=null; newWorld(); state='play'; held.length=0; wantDrop=false;
  view(null);
}
function showBet(){
  if(betStake>coins) betStake=10;
  $('betCoins').textContent='Bạn có '+coins+' xu. Chọn nhân vật bạn tin sẽ thắng; đoán đúng được thêm gấp 3 tiền cược.';
  [...$('betPicks').children].forEach((b,k)=>b.setAttribute('aria-pressed',k===betPick));
  [...$('betStakes').children].forEach(b=>{ b.disabled=+b.dataset.v>coins; b.setAttribute('aria-pressed',+b.dataset.v===betStake); });
  view('bet');
}
function startBet(){
  initAudio();
  mode='solo'; mySeat=betPick; bet={stake:betStake}; newWorld([]); state='play'; held.length=0; wantDrop=false;
  view(null);
}
function finishBet(){
  state='over';
  const draw=player.alive&&ents.filter(e=>e.alive).length>1;   /* ran out of time */
  const d=draw?0:player.alive?bet.stake*3:-bet.stake;
  coins+=d; let more=draw?'Trận kéo dài quá lâu nên trả lại tiền cược.':'';
  if(coins<=0){ coins=50; more='Bạn hết xu rồi, tặng bạn 50 xu để chơi tiếp.'; }
  try{ localStorage.setItem('bn-coin',coins) }catch(e){}
  if(d>0) sfx.win(); else sfx.lose();
  head(draw?'Hòa, hết giờ':d>0?player.name+' thắng! +'+d+' xu':player.name+' bị loại, −'+bet.stake+' xu',more);
  bet=null; hudKey=''; showBet();
}

/* ---------- drawing ---------- */
let SC=2;
function fit(){
  const w=cv.clientWidth||600, dpr=Math.min(3,window.devicePixelRatio||1);
  const W=Math.max(600,Math.min(2400,Math.round(w*dpr)));
  if(cv.width!==W){ cv.width=W; cv.height=Math.round(W*ROWS/COLS); }
  SC=cv.width/(COLS*T);
}
function rr(x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
const INK='#12305a';
/* sprites cut from anh.png live in assets/; spr() fits one into a w*h box, centred on cx, standing on by */
const IMG={};
for(const n of ['tree1','tree2','tree3','tree4','tree5','tree6','gift1','gift2','gift3','gift4','gift5','gift6','block_snow','block_ice','block_brick','snowman','santa_rider','tree_gold','p_pink','p_green','p_purple','p_blue']){ IMG[n]=new Image(); IMG[n].src='assets/'+n+'.png'; }
function spr(n,cx,by,w,h,flip){
  const im=IMG[n]; if(!im||!im.naturalWidth) return;
  const k=Math.min(w/im.naturalWidth,h/im.naturalHeight), dw=im.naturalWidth*k, dh=im.naturalHeight*k;
  if(flip){ ctx.save(); ctx.translate(cx,0); ctx.scale(-1,1); ctx.drawImage(im,-dw/2,by-dh,dw,dh); ctx.restore(); }
  else ctx.drawImage(im,cx-dw/2,by-dh,dw,dh);
}
function E(cx,cy,rx,ry,stroke,rot){ ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,rot||0,0,6.283); ctx.fill(); if(stroke) ctx.stroke(); }
function star(cx,cy,R,r2,n,rot){
  ctx.beginPath();
  for(let k=0;k<n*2;k++){ const a=rot+k*Math.PI/n, q=k%2?r2:R; ctx.lineTo(cx+Math.cos(a)*q,cy+Math.sin(a)*q); }
  ctx.closePath();
}
const ITEM_COL={b:['#8cc8ff','#2d6fe0'],r:['#ffb37a','#e8502a'],s:['#ffe98a','#f0a400'],n:['#ffb3d3','#e0468a']};
function drawItem(c,r,type){
  const px=(c+.5)*T, y0=(r+.5)*T, a=Math.min(1,(clock-itemT[idx(c,r)])/0.35)-1;
  const k=Math.max(0.05,1+2.7*a*a*a+1.7*a*a);
  ctx.fillStyle='rgba(18,48,90,.18)'; E(px,y0+15,10*k,3*k);
  drawBadge(px,y0-2+Math.sin(clock*4+c)*2,type,1.06*k,c*2+r);
}
function drawBadge(px,py,type,k,seed){
  const col=ITEM_COL[type], x=0, y=0, c=seed, r=seed;
  ctx.save(); ctx.translate(px,py); ctx.scale(k,k);
  ctx.lineJoin='round'; ctx.lineCap='round';
  ctx.fillStyle=col[1]; ctx.globalAlpha=0.17;
  for(let q=0;q<8;q++){
    const an=(calm?0:clock*0.8)+q*0.7854;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(an-.17)*21,Math.sin(an-.17)*21); ctx.lineTo(Math.cos(an+.17)*21,Math.sin(an+.17)*21); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha=0.2+Math.sin(clock*5+r)*0.08; E(0,0,17,17); ctx.globalAlpha=1;
  ctx.fillStyle='rgba(18,48,90,.25)'; rr(-13,-11,26,26,9); ctx.fill();
  const g=ctx.createRadialGradient(x-4,y-6,2,x,y,17); g.addColorStop(0,col[0]); g.addColorStop(1,col[1]);
  ctx.fillStyle=g; ctx.strokeStyle=INK; ctx.lineWidth=2; rr(x-13,y-13,26,26,9); ctx.fill(); ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,.75)'; ctx.lineWidth=1.5; rr(x-10.5,y-10.5,21,21,6.5); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.35)'; E(x-3,y-7.5,6.5,2.6,0,-0.25);
  ctx.strokeStyle=INK;
  if(type==='b'){
    ctx.lineWidth=1.6; ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.moveTo(x-2.2,y+8.5); ctx.lineTo(x+2.2,y+8.5); ctx.lineTo(x,y+5); ctx.closePath(); ctx.fill(); ctx.stroke();
    E(x,y,6.5,7,1);
    ctx.fillStyle='#8cc8ff'; E(x-2.2,y-2.5,1.8,2.6,0,-0.4);
  } else if(type==='r'){
    for(let pass=0;pass<2;pass++){
      ctx.strokeStyle=pass?'#fff':INK; ctx.fillStyle=pass?'#fff':INK; ctx.lineWidth=pass?2.6:5.2;
      for(const [dx,dy] of DIRS){
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+dx*5.5,y+dy*5.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+dx*9.2,y+dy*9.2); ctx.lineTo(x+dx*5+dy*3.2,y+dy*5+dx*3.2); ctx.lineTo(x+dx*5-dy*3.2,y+dy*5-dx*3.2); ctx.closePath();
        if(pass) ctx.fill(); else { ctx.lineWidth=2.6; ctx.stroke(); ctx.fill(); ctx.lineWidth=5.2; }
      }
    }
    ctx.strokeStyle=INK;
  } else if(type==='s'){
    ctx.lineWidth=1.6; ctx.fillStyle='#e5484d';
    ctx.beginPath(); ctx.moveTo(x-3,y-5); ctx.lineTo(x+3,y-5); ctx.lineTo(x+3,y+1);
    ctx.quadraticCurveTo(x+9,y+1,x+9,y+5.5); ctx.lineTo(x+9,y+8); ctx.lineTo(x-3,y+8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#fff'; rr(x-4.5,y-8.5,9,4.5,2); ctx.fill(); ctx.stroke();
    ctx.lineWidth=1.8; ctx.beginPath();
    ctx.moveTo(x-10,y-1); ctx.lineTo(x-6,y-1); ctx.moveTo(x-10.5,y+3); ctx.lineTo(x-6.5,y+3); ctx.moveTo(x-10,y+7); ctx.lineTo(x-6,y+7); ctx.stroke();
  } else {
    ctx.strokeStyle=INK; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x-7,y+7); ctx.lineTo(x+3.5,y-3.5); ctx.stroke();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2.4; ctx.beginPath(); ctx.moveTo(x-7,y+7); ctx.lineTo(x+3.5,y-3.5); ctx.stroke();
    ctx.strokeStyle=INK; ctx.lineWidth=1.6; ctx.fillStyle='#ffd34d'; E(x+5.5,y-5.5,3.6,3.6,1);
    ctx.fillStyle=col[1]; E(x+5.5,y-5.5,1.3,1.3);
  }
  const tw=0.5+Math.abs(Math.sin(clock*3+c*2+r));
  ctx.fillStyle='#fff'; ctx.strokeStyle=INK; ctx.lineWidth=0.8; star(x+11,y-11,3.6*tw,1.2*tw,4,clock); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawDrops(){
  for(const d of drops){
    const tx=(d.i%COLS+.5)*T, ty=(((d.i/COLS)|0)+.5)*T, p=d.p, q=1.4-p*0.4;
    ctx.strokeStyle=ITEM_COL[d.type][1]; ctx.lineWidth=2; ctx.globalAlpha=0.35+0.45*p;
    ctx.beginPath(); ctx.ellipse(tx,ty+13,12*q,4*q,0,0,6.283); ctx.stroke(); ctx.globalAlpha=1;
    drawBadge(d.fx+(tx-d.fx)*p,d.fy+(ty-2-d.fy)*p-Math.sin(Math.PI*p)*46,d.type,0.55+0.5*p,d.i);
  }
}
function drawSanta(){
  if(!santa) return;
  const sx=santa.x, sy=SANTA_Y-12+Math.sin(clock*4)*4;
  ctx.fillStyle='rgba(18,48,90,.14)'; E(sx,SANTA_Y+30,20,5);
  ctx.strokeStyle=INK; ctx.lineJoin='round';
  for(let q=0;q<6;q++){
    const tw=(0.5+Math.abs(Math.sin(clock*6+q*1.7)))*(1-q*0.12);
    ctx.fillStyle=q%2?'#ffd34d':'#fff'; ctx.lineWidth=0.8;
    star(sx-26-q*13,sy+6+Math.sin(clock*5+q)*7,4*tw,1.3*tw,4,clock+q); ctx.fill(); ctx.stroke();
  }
  /* santa_rider.png = santa.png stacked on reindeer.png; rocks like a gallop */
  ctx.save(); ctx.translate(sx,sy+38); ctx.rotate(calm?0:Math.sin(clock*9)*0.07+0.05);
  spr('santa_rider',0,0,60,112);
  ctx.restore();
}
function drawTexts(){
  ctx.textAlign='center'; ctx.lineJoin='round';
  ctx.font='800 13px "Baloo 2","Trebuchet MS",sans-serif';
  for(const t of texts){
    ctx.globalAlpha=Math.min(1,t.life*2.5); ctx.lineWidth=4; ctx.strokeStyle='#fff'; ctx.strokeText(t.txt,t.x,t.y);
    ctx.fillStyle=INK; ctx.fillText(t.txt,t.x,t.y);
  }
  ctx.globalAlpha=1;
  if(santa&&santa.x<COLS*T*0.62){
    ctx.font='800 18px "Baloo 2","Trebuchet MS",sans-serif';
    ctx.lineWidth=5; ctx.strokeStyle='#fff'; ctx.strokeText('Ông già Noel thả quà!',COLS*T/2,38);
    ctx.fillStyle='#c0312f'; ctx.fillText('Ông già Noel thả quà!',COLS*T/2,38);
  }
}
const TREES=['tree1','tree2','tree3','tree4','tree5','tree6'];
const BOXES=['gift1','gift2','gift3','gift4','gift5','gift6','block_snow','block_ice'];
/* twinkle points scattered over the tree's cone, relative to the middle of its base */
const TWINK=Array.from({length:18},()=>{ const y=-14-Math.random()*84, hw=5+(y+100)*0.42; return {x:(Math.random()*2-1)*hw,y,ph:Math.random()*6.28,sp:2.2+Math.random()*2.6}; });
function drawBigTree(){
  const cx=(COLS/2)*T, by=((ROWS>>1)+1.5)*T-3, pulse=calm?0.5:0.5+Math.sin(clock*2.4)*0.5;
  ctx.fillStyle='rgba(18,48,90,.16)'; E(cx,by-1,46,7);
  const g=ctx.createRadialGradient(cx,by-58,8,cx,by-58,74);
  g.addColorStop(0,'rgba(255,224,110,'+(0.42+pulse*0.25)+')'); g.addColorStop(1,'rgba(255,224,110,0)');
  ctx.fillStyle=g; E(cx,by-58,74,74);
  spr('tree_gold',cx,by,116,122);
  ctx.lineJoin='round'; ctx.lineWidth=0.7; ctx.strokeStyle='rgba(214,150,20,.9)';
  for(const t of TWINK){
    const k=calm?0.6:Math.sin(clock*t.sp+t.ph); if(k<=0) continue;
    ctx.globalAlpha=Math.min(1,k*1.4); ctx.fillStyle='#fff';
    star(cx+t.x,by+t.y,6.5*k,1.7*k,4,0); ctx.fill(); ctx.stroke();
    ctx.globalAlpha=k*0.35; ctx.fillStyle='#fff3b0'; E(cx+t.x,by+t.y,6*k,6*k);
  }
  ctx.globalAlpha=1;
}
function drawSolid(x,y,c,r){
  const dc=c-(COLS>>1), dr=r-(ROWS>>1);
  if(Math.abs(dc)<2&&Math.abs(dr)<2){ if(dc===1&&dr===1) drawBigTree(); return; }   /* last cell of the block paints the whole tree */
  const h=(c*3+r*5)%7;
  if(h===0) spr('snowman',x+20,y+39,40,48);
  else if(h===1) spr('block_brick',x+20,y+40,40,40);
  else spr(TREES[((c>>1)+(r>>1)*5)%6],x+20,y+39,42,50);
}
function drawBox(x,y,c,r){
  ctx.fillStyle='rgba(18,48,90,.16)'; E(x+20,y+37.5,17,2.8);
  spr(BOXES[(c*7+r*13)%8],x+20,y+39,39,42);
}
const flakes=Array.from({length:36},()=>({x:Math.random()*COLS*T,y:Math.random()*ROWS*T,s:1+Math.random()*1.8,v:14+Math.random()*22,p:Math.random()*6.28}));
const calm=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function drawFestive(dt){
  ctx.lineWidth=1.5; ctx.strokeStyle='#1c6b45'; ctx.beginPath(); ctx.moveTo(0,1);
  for(let k=0;k<COLS;k++) ctx.quadraticCurveTo(k*T+20,10,k*T+40,1);
  ctx.stroke();
  const cols=['#ff5a5a','#ffd34d','#3ddc84','#6fd3ff'], ph=calm?0:Math.floor(clock*2);
  ctx.strokeStyle=INK; ctx.lineWidth=1;
  for(let k=0;k<COLS*2;k++){
    const bx=k*20+10, lit=(k+ph)%3!==0;
    ctx.fillStyle=cols[k%4];
    if(lit){ ctx.globalAlpha=0.3; E(bx,7.5,6,6); }
    ctx.globalAlpha=lit?1:0.5; E(bx,7.5,2.6,3.6,1); ctx.globalAlpha=1;
  }
  ctx.fillStyle='#fff'; ctx.strokeStyle='rgba(110,150,205,.55)'; ctx.lineWidth=0.8;
  for(const f of flakes){
    if(!calm){ f.y+=f.v*dt; if(f.y>ROWS*T+4){ f.y=-4; f.x=Math.random()*COLS*T; } }
    E(f.x+Math.sin(clock*1.3+f.p)*6,f.y,f.s,f.s,1);
  }
}
function drawEnt(e){
  if(e.inv>0&&Math.floor(clock*12)%2) return;
  const x=(e.x+.5)*T, yb=(e.y+.5)*T;
  /* one pose per sprite, so life comes from the transform: hop + waddle + squash when walking, breathing when idle, wobble in the bubble */
  const ph=e.x0*1.7, walking=e.moving&&!e.trapped;
  const s=walking?Math.sin(clock*13+ph):0, hop=Math.abs(s);
  const bob=e.trapped?Math.sin(clock*5)*2.5-4:-hop*4.5;
  const y=yb+bob, k=e.trapped?0.8:1;
  if(e.face[0]) e.flip=e.face[0]<0;
  const sy=e.trapped?1:walking?0.9+hop*0.18:calm?1:1+Math.sin(clock*3.2+ph)*0.035;
  const lean=e.trapped?Math.sin(clock*3+ph)*0.16:walking?s*0.11+e.face[0]*0.09:calm?0:Math.sin(clock*1.6+ph)*0.03;
  ctx.fillStyle='rgba(18,48,90,.18)'; E(x,yb+16,11-hop*2.5,4-hop);
  ctx.save(); ctx.translate(x,y+18*k); ctx.rotate(lean); ctx.scale(k*(2-sy),k*sy);
  spr(e.kind,0,0,36,44,e.flip);
  ctx.restore();
  if(e.trapped){
    const w=1+Math.sin(clock*7)*0.04;
    ctx.fillStyle='rgba(150,225,255,.45)'; ctx.strokeStyle='#4aa8e8'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x,y-3,21*w,21/w,0,0,6.283); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(x,y-3,16,-2.5,-1.7); ctx.stroke();
  }
  if(e===player){
    const ty=y-27+Math.sin(clock*5)*1.5;
    ctx.fillStyle='#fff'; ctx.strokeStyle='#12305a'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(x-5,ty-6); ctx.lineTo(x+5,ty-6); ctx.lineTo(x,ty); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}
function draw(){
  ctx.setTransform(SC,0,0,SC,0,0);
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    ctx.fillStyle=(c+r)%2?'#eef5fd':'#dfebf9'; ctx.fillRect(c*T,r*T,T,T);
    if((c*5+r*3)%4===0){ ctx.fillStyle='#c3d7ef'; E(c*T+9,r*T+12,1.6,1.1); E(c*T+28,r*T+27,2.2,1.3); E(c*T+31,r*T+9,1.1,0.8); }
  }
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const i=idx(c,r), x=c*T, y=r*T, t=tiles[i];
    if(t===1) drawSolid(x,y,c,r);
    else if(t===2) drawBox(x,y,c,r);
    else if(items[i]) drawItem(c,r,items[i]);
  }
  for(const b of balloons){
    const x=(b.c+.5)*T, y=(b.r+.5)*T, s=1+Math.sin(clock*(b.t<0.8?22:9))*0.07;
    ctx.fillStyle='rgba(18,48,90,.18)'; ctx.beginPath(); ctx.ellipse(x,y+14,11,4,0,0,6.283); ctx.fill();
    ctx.fillStyle='#3d8bff'; ctx.strokeStyle='#12305a'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x,y+1,14*s,14/s,0,0,6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#12305a'; ctx.beginPath(); ctx.arc(x,y-14/s,2.5,0,6.283); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.8)'; ctx.beginPath(); ctx.ellipse(x-5,y-4,3.5,5,-0.5,0,6.283); ctx.fill();
  }
  for(let pass=0;pass<2;pass++){
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const f=flames[idx(c,r)]; if(f<=0) continue;
      const k=Math.min(1,f/FLAME*2), x=c*T, y=r*T;
      const on=(cc,rc)=>inb(cc,rc)&&flames[idx(cc,rc)]>0;
      const l=on(c-1,r), ri=on(c+1,r), u=on(c,r-1), d=on(c,r+1);
      const th=(pass?12:28)*k, m=(T-th)/2, cap=pass?12:5;
      ctx.fillStyle=pass?'#d9f3ff':'#3aa0f5';
      if(l||ri||!(u||d)){ rr(x+(l?-1:cap),y+m,T-(l?-1:cap)-(ri?-1:cap),th,Math.min(th/2,9)); ctx.fill(); }
      if(u||d){ rr(x+m,y+(u?-1:cap),th,T-(u?-1:cap)-(d?-1:cap),Math.min(th/2,9)); ctx.fill(); }
    }
  }
  ents.filter(e=>e.alive).sort((a,b)=>a.y-b.y).forEach(drawEnt);
  for(const p of parts){
    ctx.globalAlpha=Math.min(1,p.life*3); ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,6.283); ctx.fill();
  }
  ctx.globalAlpha=1;
  drawDrops(); drawSanta();
  const vg=ctx.createLinearGradient(0,0,0,ROWS*T); vg.addColorStop(0,'rgba(255,255,255,.10)'); vg.addColorStop(0.45,'rgba(255,255,255,0)'); vg.addColorStop(1,'rgba(18,48,90,.10)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,COLS*T,ROWS*T);
  drawFestive(lastDt); drawTexts(); drawSays(lastDt);
}

/* ---------- HUD ---------- */
let hudKey='';
function buildChips(){
  const box=$('chips'); box.textContent='';
  ents.forEach((e,i)=>{
    const chip=document.createElement('div'), dot=document.createElement('i'), w=document.createElement('div'), b=document.createElement('b'), sp=document.createElement('span');
    chip.className='chip'; chip.id='chip'+i; dot.style.background='url(assets/'+e.kind+'.png) center/contain no-repeat'; b.textContent=e.name;
    w.append(b,sp); chip.append(dot,w); box.append(chip);
  });
}
function hud(){
  const key=ents.map(e=>e.alive?(e.trapped?'t':'a'):'x').join('')+ents.map(e=>e.none?1:0).join('')+[player.cap,player.range,player.speed,player.needles,stage,best,mode,roomCode,bet?coins:''].join(',');
  if(key===hudKey) return; hudKey=key;
  ents.forEach((e,i)=>{
    const el=$('chip'+i); if(!el) return;
    el.hidden=!!e.none;
    el.className='chip'+(e.alive?(e.trapped?' trap':''):' out');
    el.querySelector('span').textContent=e.alive?(e.trapped?'bị nhốt':'đang chơi'):'bị loại';
  });
  $('sCap').textContent=player.cap; $('sRange').textContent=player.range;
  $('sSpeed').textContent=Math.round((player.speed-BASE_SPEED)/0.45)+1;
  $('sPin').textContent=player.needles; $('btnPin').textContent='Kim '+player.needles;
  $('stage').textContent=bet?'Đặt cược':mode==='solo'?'Màn '+stage:'Phòng '+roomCode.toUpperCase(); $('best').textContent=bet?'Xu '+coins:'Kỷ lục '+best;
}

/* ---------- input ---------- */
const KEYS={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
function press(d){ const k=held.indexOf(d); if(k>=0) held.splice(k,1); held.push(d); }
function release(d){ const k=held.indexOf(d); if(k>=0) held.splice(k,1); }
window.addEventListener('keydown',ev=>{
  if(ev.target.tagName==='INPUT') return;
  if(ev.code==='Enter'&&ev.target.tagName!=='BUTTON'){ $('chatIn').focus(); ev.preventDefault(); return; }
  if(state==='menu'||state==='over') return;
  const d=KEYS[ev.code];
  if(d){ press(d); ev.preventDefault(); }
  else if(ev.code==='Space'){ if(!ev.repeat) wantDrop=true; ev.preventDefault(); }
  else if(ev.code==='KeyE'){ doNeedle(); }
});
window.addEventListener('keyup',ev=>{ const d=KEYS[ev.code]; if(d) release(d); });
window.addEventListener('blur',()=>{ held.length=0; });
document.querySelectorAll('[data-dir]').forEach(btn=>{
  const d=btn.dataset.dir;
  const up=()=>{ release(d); btn.classList.remove('on'); };
  btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); press(d); btn.classList.add('on'); });
  ['pointerup','pointercancel','pointerleave'].forEach(n=>btn.addEventListener(n,up));
});
$('btnDrop').addEventListener('pointerdown',ev=>{ ev.preventDefault(); if(state==='play'||state==='ending') wantDrop=true; });
$('btnPin').addEventListener('pointerdown',ev=>{ ev.preventDefault(); doNeedle(); });
window.addEventListener('touchstart',()=>document.body.classList.add('touch'),{once:true,passive:true});
document.addEventListener('contextmenu',ev=>{ if(ev.target.closest('.pad')) ev.preventDefault(); });
$('go').addEventListener('click',startGame);
$('auto').addEventListener('click',()=>{
  autoPlay=!autoPlay; $('auto').textContent='Tự chơi: '+(autoPlay?'bật':'tắt'); $('auto').setAttribute('aria-pressed',autoPlay);
  if(player){ player.auto=autoPlay; player.goal=-1; player.wait=0; }
  $('auto').blur();
});
SEATS.forEach((s,k)=>{
  const b=document.createElement('button'); b.type='button';
  b.append(Object.assign(new Image(),{src:'assets/'+s[0]+'.png',alt:''}),s[3]);
  b.addEventListener('click',()=>{ betPick=k; showBet(); }); $('betPicks').append(b);
});
[10,20,50].forEach(v=>{
  const b=document.createElement('button'); b.type='button'; b.className='btn2'; b.dataset.v=v; b.textContent=v+' xu';
  b.addEventListener('click',()=>{ betStake=v; showBet(); }); $('betStakes').append(b);
});
$('goBet').addEventListener('click',()=>{ head('Đặt cược','Bốn máy tự đấu với nhau, bạn chỉ ngồi xem.'); showBet(); });
$('betGo').addEventListener('click',startBet);
$('betBack').addEventListener('click',()=>{ head(HOME_TITLE,HOME_TEXT); view('main'); });
$('mute').addEventListener('click',()=>{ muted=!muted; $('mute').textContent='Âm thanh: '+(muted?'tắt':'bật'); });

/* ---------- online: the room owner runs the match and shares it through presence ---------- */
const NDIR=[null,[0,-1],[0,1],[-1,0],[1,0]], DNAME=['','up','down','left','right'];
const HOME_TITLE='Nhốt hết đối thủ vào bong bóng';
const HOME_TEXT='Đặt bóng nước để phá hộp quà và nhốt đối thủ. Chạm vào kẻ đang bị nhốt để loại họ. Nếu chính bạn bị nhốt, dùng kim để thoát. Ông già Noel sẽ bay ngang sân và thả 10 vật phẩm.';
let roomCap=null, R=null, unsub=null, roomCode='', myPeer='', seats=[], phase='lobby', round=0, hostAt=0, sendAcc=0, tick=0, res=-1, bots=0;
let bSeq=0, kSeq=0, lastInp='', lastN=-1, cRound=-1, hadHost=false, joinTimer=0, nick='';
try{ nick=localStorage.getItem('bn-nick')||'' }catch(e){}
const capP=(window.claude&&window.claude.use)?window.claude.use('room').then(c=>{ roomCap=c; return c; }).catch(()=>null):Promise.resolve(null);

function head(t,x){ $('ovTitle').textContent=t; $('ovText').textContent=x||''; }
function view(v){
  $('overlay').hidden=!v;
  $('ovBtns').hidden=v!=='main'; $('joinView').hidden=v!=='join'; $('roomView').hidden=v!=='room'; $('betView').hidden=v!=='bet';
  $('ovText').hidden=!$('ovText').textContent;
}
function doNeedle(){ if(bet) return; if(mode==='client') kSeq++; else useNeedle(player); }
const cleanNick=s=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g,'').trim().slice(0,12);
const people=()=>R?R.peers().filter(p=>p.kind==='viewer'&&p.presence&&typeof p.presence.nick==='string'):[];
function hostPeer(){
  let h=null;
  for(const p of people()){
    if(!p.presence.host) continue;
    const a=+p.presence.hostAt||0, b=h?(+h.presence.hostAt||0):0;
    if(!h||a<b||(a===b&&p.peer<h.peer)) h=p;
  }
  return h;
}
function nickOf(peer){ const p=people().find(q=>q.peer===peer); return p?(cleanNick(p.presence.nick)||'Người chơi'):null; }
function push(p){ if(R) R.presence(p).catch(()=>{}); }
function sharedRoom(){
  return {peers:()=>roomCap.peers(), presence:p=>roomCap.presence(p), onPeers:(h,e)=>roomCap.onPeers(h,e),
    leave:()=>roomCap.presence({nick:null,host:null,hostAt:null,phase:null,seats:null,names:null,round:null,res:null,g:null,inp:null,c:null,bots:null,auto:null})};
}
async function enterRoom(code,asHost){
  nick=cleanNick($('nick').value)||'Người chơi';
  try{ localStorage.setItem('bn-nick',nick) }catch(e){}
  if(!roomCap){ $('netMsg').textContent='Đang kết nối, chờ vài giây…'; await capP; }
  if(!roomCap){ $('netMsg').textContent='Không tải được phần kết nối online. Hãy kiểm tra mạng rồi tải lại trang.'; return; }
  $('netMsg').textContent='Đang vào phòng…';
  let room=null;
  try{ room=await roomCap.join('bn-'+code); }
  catch(e){
    if(e&&e.code==='not_permitted') room=sharedRoom();
    else if(e&&(e.code==='not_granted'||e.code==='revoked')){ $('netMsg').textContent='Không vào được phòng. Hãy thử lại sau ít phút.'; return; }
    else { $('netMsg').textContent='Không vào được phòng. Hãy thử lại sau ít phút.'; return; }
  }
  R=room; roomCode=code; mode=asHost?'host':'client'; phase='lobby'; seats=[]; bots=0; lastInp=''; hadHost=false; lastN=-1; cRound=-1; res=-1; state='menu';
  hostAt=Date.now(); chatSeen.clear(); $('chatLog').textContent='';
  push(asHost?{nick,host:1,hostAt,phase,seats:[],bots,round}:{nick,inp:[0,bSeq,kSeq]});
  unsub=R.onPeers(onPeers,()=>leaveRoom('Mất kết nối với phòng.'));
  $('netMsg').textContent='';
  head('Phòng chơi online',''); renderRoom();
  clearTimeout(joinTimer);
  if(!asHost) joinTimer=setTimeout(()=>{ if(mode==='client'&&!hostPeer()) leaveRoom('Không tìm thấy phòng '+code.toUpperCase()+'. Hãy kiểm tra lại mã phòng.'); },6000);
}
function leaveRoom(msg){
  clearTimeout(joinTimer);
  if(unsub){ try{ unsub() }catch(e){} unsub=null; }
  if(R){ const r=R; R=null; try{ Promise.resolve(r.leave()).catch(()=>{}) }catch(e){} }
  mode='solo'; mySeat=0; state='menu'; stage=1; roomCode=''; newWorld();
  head(HOME_TITLE,msg||HOME_TEXT); $('go').textContent='Chơi với máy'; view('main');
}
function onPeers(){
  if(!R) return;
  const m=R.peers().find(p=>p.isMe&&p.sameTab); if(m) myPeer=m.peer;
  if(mode==='host'&&myPeer){
    const h=hostPeer();
    if(h&&h.peer!==myPeer&&phase!=='play'){
      mode='client'; state='menu'; hadHost=true;
      push({host:null,hostAt:null,phase:null,seats:null,bots:null,names:null,round:null,res:null,g:null,inp:[0,bSeq,kSeq]});
    } else if(phase!=='play'){
      const here=people().map(p=>p.peer);
      const next=[myPeer].concat(seats.filter(x=>x!==myPeer&&here.includes(x)));
      for(const x of here) if(next.length<4&&!next.includes(x)) next.push(x);
      const nb=Math.min(bots,4-next.length);
      if(next.join()!==seats.join()||nb!==bots){ seats=next; bots=nb; push({seats,bots}); }
    }
  }
  if(!$('roomView').hidden) renderRoom();
}
function renderRoom(){
  const h=mode==='host'?null:hostPeer();
  const ss=mode==='host'?seats:(h&&Array.isArray(h.presence.seats)?h.presence.seats:[]);
  const ph=mode==='host'?phase:(h?h.presence.phase:'lobby');
  const nb=mode==='host'?bots:(h?h.presence.bots|0:0);
  const ul=$('seatList'); ul.textContent='';
  for(let k=0;k<4;k++){
    const li=document.createElement('li'), dot=document.createElement('i'), sp=document.createElement('span');
    dot.style.background=SEATS[k][1];
    const nm=ss[k]?nickOf(ss[k]):null;
    sp.textContent=nm?nm+(ss[k]===myPeer?' (bạn)':'')+(k===0?' · chủ':''):k<ss.length+nb?'Máy chơi':'Trống';
    if(!nm&&k>=ss.length+nb) li.className='bot';
    li.append(dot,sp); ul.append(li);
  }
  $('roomCode').textContent=PUB.includes(roomCode)?'Phòng '+roomCode:roomCode.toUpperCase();
  $('startOnline').hidden=mode!=='host'; $('startOnline').disabled=seats.length+bots<2;
  $('botRow').hidden=mode!=='host'; $('botN').textContent='Máy: '+bots;
  $('startOnline').textContent=phase==='over'?'Ván mới':'Bắt đầu';
  const seated=ss.includes(myPeer);
  $('roomNote').textContent=mode==='host'?(PUB.includes(roomCode)?'Bạn bè sẽ thấy phòng này trong danh sách phòng':'Phòng riêng: gửi mã phòng cho bạn bè')+', hoặc tự thêm máy. Cần ít nhất 2 người chơi (tính cả máy).'
    :!h?'Đang tìm phòng…'
    :ph==='play'&&!seated?'Ván đang diễn ra. Bạn sẽ vào chơi ở ván sau.'
    :!seated&&ss.length>=4?'Phòng đã đủ 4 người.'
    :'Chờ chủ phòng bắt đầu.';
  view('room');
}
function snap(){
  let m=''; const f=[];
  for(let i=0;i<N;i++){
    m+=tiles[i]?tiles[i]:(items[i]||'0');
    if(flames[i]>0) f.push(i*64+Math.max(1,Math.min(63,Math.round(flames[i]/FLAME*63))));
  }
  return {n:++tick,m,f,w:rainOn?1:0,
    e:ents.map(e=>[Math.round(e.x*100),Math.round(e.y*100),(e.alive?1:0)|(e.trapped?2:0)|(e.moving?4:0)|(e.inv>0?8:0)|(e.bot?16:0),
      Math.max(0,DIRS.findIndex(d=>d[0]===e.face[0]&&d[1]===e.face[1])),e.cap,e.range,Math.round(e.speed*100),e.needles]),
    b:balloons.map(b=>[b.i,Math.round(b.t*100),b.range]),
    s:santa?Math.round(santa.x):null,
    d:drops.map(d=>[d.i,'brsn'.indexOf(d.type),Math.round(d.fx),Math.round(d.p*100)])};
}
function startOnline(){
  if(mode!=='host'||seats.length+bots<2) return;
  initAudio();
  const names=seats.map(x=>nickOf(x)||'Người chơi'); if(!names.length) names.push(nick);
  const ps=people();
  mySeat=0; bet=null; newWorld(names);
  for(let k=names.length+bots;k<4;k++){ ents[k].alive=false; ents[k].none=true; }   /* empty seats: nobody there */
  for(let k=1;k<names.length;k++){
    const p=ps.find(q=>q.peer===seats[k]), inp=p&&Array.isArray(p.presence.inp)?p.presence.inp:[0,0,0];
    ents[k].net={d:0,lb:inp[1],lk:inp[2],drop:false,pin:false,gone:0};
  }
  round++; phase='play'; state='play'; res=-1; held.length=0; wantDrop=false; sendAcc=0;
  push({phase,round,res,names:ents.map(e=>e.name),g:snap()});
  view(null);
}
function hostInputs(dt){
  const ps=R?R.peers():[];
  for(let k=1;k<ents.length;k++){
    const e=ents[k]; if(!e.net||e.bot) continue;
    const p=ps.find(q=>q.peer===seats[k]);
    if(!p||typeof p.presence.nick!=='string'){
      e.net.d=0; e.net.gone+=dt;
      if(e.net.gone>3){ e.bot=true; e.goal=-1; e.wait=0; e.speed=Math.min(e.speed,5.6); }
      continue;
    }
    e.net.gone=0;
    const au=!!p.presence.auto; if(au!==!!e.auto){ e.auto=au; e.goal=-1; e.wait=0; }
    const inp=p.presence.inp; if(!Array.isArray(inp)) continue;
    e.net.d=inp[0]|0;
    if(inp[1]!==e.net.lb){ e.net.lb=inp[1]; e.net.drop=true; }
    if(inp[2]!==e.net.lk){ e.net.lk=inp[2]; e.net.pin=true; }
  }
}
function showResult(r){
  const w=r>=0?ents[r]:null;
  if(w&&w===player){ sfx.win(); head('Bạn thắng!',''); }
  else { sfx.lose(); head(w?w.name+' thắng':'Hòa, không ai trụ lại',''); }
  renderRoom();
}
function finishOnline(){
  state='over'; phase='over';
  const alive=ents.filter(e=>e.alive); res=alive.length===1?ents.indexOf(alive[0]):-1;
  push({phase,res,g:snap()});
  onPeers(); showResult(res);
}
function applySnap(g,fresh){
  if(!g||typeof g.m!=='string'||g.m.length!==N||!Array.isArray(g.e)||g.e.length!==ents.length) return;
  for(let i=0;i<N;i++){
    const ch=g.m[i], nt=ch==='1'?1:ch==='2'?2:0, ni=(ch==='b'||ch==='r'||ch==='s'||ch==='n')?ch:0;
    if(!fresh&&tiles[i]===2&&nt===0) burst((i%COLS+.5)*T,(((i/COLS)|0)+.5)*T,'#ffb199',7);
    if(ni&&items[i]!==ni) itemT[i]=fresh?clock-1:clock;
    tiles[i]=nt; items[i]=ni;
  }
  let boom=false; const nf=new Float32Array(N);
  if(Array.isArray(g.f)) for(const v of g.f){ const i=v>>6; if(i>=0&&i<N){ nf[i]=(v&63)/63*FLAME; if(flames[i]<=0) boom=true; } }
  flames.set(nf); if(boom&&!fresh) sfx.boom();
  const nb=Array.isArray(g.b)?g.b.filter(b=>Array.isArray(b)&&b[0]>=0&&b[0]<N).map(b=>({i:b[0],c:b[0]%COLS,r:(b[0]/COLS)|0,t:b[1]/100,range:b[2]})):[];
  if(nb.length>balloons.length&&!fresh) sfx.place();
  balloons=nb;
  g.e.forEach((a,k)=>{
    const e=ents[k]; if(!Array.isArray(a)) return;
    const alive=!!(a[2]&1), trapped=!!(a[2]&2);
    if(fresh) e.none=!alive;
    e.tx=a[0]/100; e.ty=a[1]/100;
    if(fresh||Math.abs(e.tx-e.x)+Math.abs(e.ty-e.y)>2.5){ e.x=e.tx; e.y=e.ty; }
    if(!fresh&&e.alive&&!alive){ burst((e.x+.5)*T,(e.y+.5)*T,e.color,18); burst((e.x+.5)*T,(e.y+.5)*T,'#ffffff',8); sfx.pop(); }
    if(!fresh&&!e.trapped&&trapped&&e===player) sfx.trap();
    if(!fresh&&e===player){
      const got=a[4]>e.cap?'b':a[5]>e.range?'r':a[6]>Math.round(e.speed*100)?'s':a[7]>e.needles&&!e.trapped?'n':'';
      if(got){ sfx.pick(); texts.push({x:(e.x+.5)*T,y:e.y*T-10,txt:LABEL[got],life:1.1}); }
    }
    e.alive=alive; e.trapped=trapped; e.moving=!!(a[2]&4); e.inv=(a[2]&8)?1:0; e.bot=!!(a[2]&16);
    e.face=DIRS[a[3]]||[0,1]; e.cap=a[4]; e.range=a[5]; e.speed=a[6]/100; e.needles=a[7];
  });
  if(typeof g.s==='number'){
    if(!santa){ santa={x:g.s}; if(!fresh) sfx.bell(); }
    if(Math.abs(santa.x-g.s)>40) santa.x=g.s;
  } else santa=null;
  if(g.w&&!rainOn&&!fresh){ texts.push({x:COLS*T/2,y:ROWS*T/2-70,txt:'Mưa bóng nước!',life:2.5}); sfx.bell(); }
  rainOn=!!g.w;
  drops=Array.isArray(g.d)?g.d.filter(d=>Array.isArray(d)&&d[0]>=0&&d[0]<N&&'brsn'[d[1]]).map(d=>({i:d[0],type:'brsn'[d[1]],fx:d[2],fy:SANTA_Y-6,p:Math.min(0.99,d[3]/100)})):[];
}
function clientFrame(dt){
  clock+=dt; frameNo++;
  if(wantDrop){ bSeq++; wantDrop=false; }
  const d=held.length?DNAME.indexOf(held[held.length-1]):0, key=d+','+bSeq+','+kSeq+','+autoPlay;
  if(key!==lastInp){ lastInp=key; push({inp:[d,bSeq,kSeq],auto:autoPlay?1:null}); }
  const h=hostPeer();
  if(!h){ if(hadHost) leaveRoom('Chủ phòng đã rời phòng.'); return; }
  hadHost=true;
  const hp=h.presence, ss=Array.isArray(hp.seats)?hp.seats:[], seat=ss.indexOf(myPeer);
  if(hp.phase==='play'&&seat>=0&&hp.g){
    let fresh=false;
    if(state!=='play'||cRound!==hp.round){
      cRound=hp.round; mySeat=seat; fresh=true; state='play'; lastN=-1;
      makeEnts(Array.isArray(hp.names)?hp.names.map(cleanNick):[],4);
      parts=[]; texts=[]; santa=null; drops=[]; flames.fill(0); balloons=[]; held.length=0;
      view(null);
    }
    if(hp.g.n!==lastN){ lastN=hp.g.n; applySnap(hp.g,fresh); }
  } else if(hp.phase==='over'&&state==='play'){
    if(hp.g&&hp.g.n!==lastN){ lastN=hp.g.n; applySnap(hp.g,false); }
    state='over'; showResult(typeof hp.res==='number'?hp.res:-1);
  } else if(state==='play'){
    state='menu'; head('Phòng chơi online',''); renderRoom();
  }
  const k=Math.min(1,dt*16);
  for(const e of ents){ if(e.tx!=null){ e.x+=(e.tx-e.x)*k; e.y+=(e.ty-e.y)*k; } }
  for(let i=0;i<N;i++) if(flames[i]>0) flames[i]=Math.max(0,flames[i]-dt);
  for(const b of balloons) b.t-=dt;
  for(const p of parts){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=260*dt; p.life-=dt; }
  parts=parts.filter(p=>p.life>0);
  for(const t of texts){ t.y-=22*dt; t.life-=dt; }
  texts=texts.filter(t=>t.life>0);
  if(santa) santa.x+=150*dt;
  for(const q of drops) q.p=Math.min(0.99,q.p+dt/0.85);
}
$('goOnline').addEventListener('click',()=>{
  initAudio(); head('Chơi online','Đặt tên, rồi tạo phòng hoặc nhập mã phòng bạn bè gửi.');
  $('nick').value=nick; $('netMsg').textContent='Đang kiểm tra kết nối…'; view('join'); $('nick').focus(); $('roomList').textContent=''; $('roomsNote').textContent='Đang tìm phòng…'; peekRooms();
  capP.then(c=>{ if(!$('joinView').hidden&&!R) $('netMsg').textContent=c?'Đã sẵn sàng. Tạo phòng hoặc nhập mã phòng.':'Không tải được phần kết nối online. Hãy kiểm tra mạng rồi tải lại trang.'; });
});
/* room list. there is no server to ask "which rooms exist", so every listed room lives in one of 12 numbered slots that
   anyone can look into. creating a room takes the first empty slot; the list shows the slots that have people in them.
   entering as host is safe: if someone already hosts, onPeers() demotes us to a guest */
const PUB=Array.from({length:12},(_,k)=>String(k+1));
let peeking=null;
function peekRooms(){
  if(peeking) return peeking;
  return peeking=capP.then(cap=>cap&&cap.peek?cap.peek(PUB.map(c=>'bn-'+c)):null).catch(()=>null).then(o=>{
    peeking=null;
    const box=$('roomList'); box.textContent='';
    if(!o){ $('roomsNote').textContent='Không xem được danh sách phòng. Hãy nhập mã phòng bên dưới.'; return null; }
    for(const c of PUB){
      const r=o['bn-'+c]; if(!r) continue;
      const b=document.createElement('button'), n=document.createElement('b'), s=document.createElement('span');
      b.type='button'; n.textContent='Phòng '+c+(cleanNick(r.host)?' · '+cleanNick(r.host):''); s.textContent=(r.play?'đang chơi · ':'')+r.n+'/4 người';
      b.append(n,s); b.addEventListener('click',()=>enterRoom(c,true)); box.append(b);
    }
    $('roomsNote').textContent=box.children.length?'':'Chưa có phòng nào đang mở. Bấm "Tạo phòng" để mở phòng mới.';
    return o;
  });
}
$('refreshRooms').addEventListener('click',()=>{ $('roomsNote').textContent='Đang tìm phòng…'; peekRooms(); });
setInterval(()=>{ if(!R&&!$('overlay').hidden&&!$('joinView').hidden) peekRooms(); },6000);
$('backSolo').addEventListener('click',()=>{ head(HOME_TITLE,HOME_TEXT); view('main'); });
$('mkRoom').addEventListener('click',()=>{
  $('netMsg').textContent='Đang tạo phòng…';
  peekRooms().then(o=>{
    if(R) return;
    const free=o?PUB.find(c=>!o['bn-'+c]):null;
    if(free) enterRoom(free,true);
    else if(o) $('netMsg').textContent='Các phòng đều đang có người. Hãy vào một phòng trong danh sách.';
    else mkPrivate();
  });
});
function mkPrivate(){
  const A='abcdefghjkmnpqrstuvwxyz23456789';
  enterRoom(Array.from({length:4},()=>A[Math.random()*A.length|0]).join(''),true);
}
$('mkPrivate').addEventListener('click',mkPrivate);
$('joinRoom').addEventListener('click',()=>{
  const code=$('code').value.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,6);
  if(!code){ $('netMsg').textContent='Hãy nhập mã phòng bạn bè gửi cho bạn.'; return; }
  enterRoom(code,false);
});
$('startOnline').addEventListener('click',startOnline);
function addBots(d){
  if(mode!=='host'||phase==='play') return;
  const nb=Math.max(0,Math.min(4-seats.length,bots+d));
  if(nb!==bots){ bots=nb; push({bots}); renderRoom(); }
}
$('botMore').addEventListener('click',()=>addBots(1));
$('botLess').addEventListener('click',()=>addBots(-1));
$('leaveRoom').addEventListener('click',()=>leaveRoom());
$('copyCode').addEventListener('click',()=>{
  const b=$('copyCode'), done=()=>{ b.textContent='Đã chép'; setTimeout(()=>{ b.textContent='Chép mã'; },1500); };
  try{ navigator.clipboard.writeText(roomCode.toUpperCase()).then(done,()=>{ window.getSelection().selectAllChildren($('roomCode')); }); }
  catch(e){ window.getSelection().selectAllChildren($('roomCode')); }
});

/* ---------- chat: each player shares their latest line through presence; everyone shows it over that player's character ---------- */
const EMOJI=['😂','😭','😡','😎','👍'], STICK=['snowman','santa_rider','gift1'];
const chatSeen=new Map(); let chatAt=-1e9;
const cleanMsg=s=>[...String(s).replace(/\s+/g,' ').trim()].slice(0,40).join('');
function say(txt){
  txt=cleanMsg(txt);
  if(!txt||performance.now()-chatAt<400) return;
  chatAt=performance.now();
  if(R) push({c:[Date.now(),txt]}); else showSay(player,player.name,txt);
}
function chatPoll(){
  const h=mode==='host'?null:hostPeer(), ss=mode==='host'?seats:(h&&Array.isArray(h.presence.seats)?h.presence.seats:[]);
  for(const p of people()){
    const c=p.presence.c, q=Array.isArray(c)?c[0]:0;
    if(!chatSeen.has(p.peer)){ chatSeen.set(p.peer,q); continue; }   /* first sight: don't replay an old line */
    if(q===chatSeen.get(p.peer)) continue;
    chatSeen.set(p.peer,q);
    const txt=q&&typeof c[1]==='string'?cleanMsg(c[1]):''; if(!txt) continue;
    showSay(ents[ss.indexOf(p.peer)],nickOf(p.peer)||'Người chơi',txt);
  }
}
function showSay(e,name,txt){
  const st=txt[0]===':'&&STICK.includes(txt.slice(1))?txt.slice(1):'';
  if(e&&(state==='play'||state==='ending')) e.say={txt,st,big:/^[\p{Extended_Pictographic}\uFE0F\u200D]{1,4}$/u.test(txt),t:3};
  const row=document.createElement('div'), b=document.createElement('b'), log=$('chatLog');
  b.textContent=name+': ';
  row.append(b,st?Object.assign(new Image(),{src:'assets/'+st+'.png',alt:'sticker'}):txt);
  log.append(row); while(log.children.length>3) log.firstChild.remove();
  tone(880,0.06,'sine',0.03);
}
function drawSays(dt){
  ctx.textAlign='center'; ctx.textBaseline='middle';
  for(const e of ents){
    const s=e.say; if(!s) continue;
    s.t-=dt; if(s.t<=0){ e.say=null; continue; }
    const pop=Math.min(1,0.3+(3-s.t)*6), x=(e.x+.5)*T, y=(e.y+.5)*T+(e.y<0.8?52:-34);   /* top row: no room above, show below */
    ctx.globalAlpha=Math.min(1,s.t*3);
    if(s.st) spr(s.st,x,y+8,44*pop,44*pop);
    else if(s.big){ ctx.fillStyle=INK; ctx.font=Math.round(30*pop)+'px sans-serif'; ctx.fillText(s.txt,x,y-10); }
    else {
      ctx.font='600 12px "Be Vietnam Pro",system-ui,sans-serif';
      const w=Math.min(200,ctx.measureText(s.txt).width)+14, bx=Math.max(2,Math.min(COLS*T-w-2,x-w/2)), by=y-24;
      ctx.fillStyle='#fff'; ctx.strokeStyle=INK; ctx.lineWidth=2; rr(bx,by,w,22,9); ctx.fill(); ctx.stroke();
      ctx.fillStyle=INK; ctx.fillText(s.txt,bx+w/2,by+12,200);
    }
  }
  ctx.globalAlpha=1; ctx.textBaseline='alphabetic';
}
EMOJI.concat(STICK.map(s=>':'+s)).forEach(m=>{
  const b=document.createElement('button'); b.type='button';
  if(m[0]===':') b.append(Object.assign(new Image(),{src:'assets/'+m.slice(1)+'.png',alt:'Sticker '+m.slice(1)})); else b.textContent=m;
  b.addEventListener('click',()=>{ say(m); b.blur(); });
  $('quick').append(b);
});
$('chatForm').addEventListener('submit',ev=>{
  ev.preventDefault(); const i=$('chatIn'); say(i.value); i.value='';
  if(state==='play'||state==='ending') i.blur();
});

/* ---------- loop ---------- */
let last=0, lastDt=0;
function frame(ts){
  const dt=Math.min(0.05,(ts-last)/1000||0); last=ts; lastDt=dt;
  if(mode==='client') clientFrame(dt);
  else if(state==='play'||state==='ending'){
    if(mode==='host') hostInputs(dt);
    update(dt);
    if(mode==='host'&&state!=='over'){ sendAcc+=dt; if(sendAcc>=0.066){ sendAcc=0; push({g:snap()}); } }
  } else clock+=dt;
  if(R) chatPoll();
  draw(); hud();
  requestAnimationFrame(frame);
}
fit(); window.addEventListener('resize',fit);
if(window.ResizeObserver) new ResizeObserver(fit).observe(cv);
newWorld(); buildChips(); hud();
requestAnimationFrame(frame);
