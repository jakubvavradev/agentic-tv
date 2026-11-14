// Movable clocks (digital + cathedral tower clock) and their on-screen editor; standalone so wallpaper and weather stay untouched.
// The editor: a glowing frame follows the clock being edited, a glass capsule says which clock, which step (move / size) and which keys.
'use strict';
window.ClockLayout = (() => {
  const defaults = {hero:{on:true,x:50,y:6,size:100},tower:{on:false,x:50,y:29,size:100}};   // tower = big cathedral face where the digital clock sits
  const saved = (() => {try{return JSON.parse(localStorage.getItem('clockLayout'))||{};}catch(e){return {};}})();
  const data = {};
  if(saved.tower&&saved.tower.x===72&&saved.tower.y===26) delete saved.tower;   // 1.1.0's tiny side clock -> new default
  for(const kind of ['hero','tower']) data[kind] = Object.assign({}, defaults[kind], saved[kind] || {});
  if(data.tower.on) data.hero.on=false;   // one clock at a time (1.1.1 had "both")
  if(!data.hero.on&&!data.tower.on) data.hero.on=true;
  const BASE=40;   // cathedral face diameter at 100 %, in vh
  let paint=()=>{}, stage=0;
  const $=id=>document.getElementById(id);
  const lim=(n,a,b)=>Math.max(a,Math.min(b,n));
  const save=()=>{try{localStorage.setItem('clockLayout',JSON.stringify(data));}catch(e){}};
  // only visible clocks are edited: [kind, 'move'|'size']
  const stages=()=>['hero','tower'].filter(k=>data[k].on).flatMap(k=>[[k,'move'],[k,'size']]);

  function apply(){
    const h=data.hero,t=data.tower,clock=$('clock');
    clock.style.display=h.on?'':'none';
    clock.style.fontSize=(29*h.size/100)+'vh';
    clock.style.top=(h.y+3.6)+'vh';
    clock.style.transform=`translateX(${h.x-50}vw) scaleY(1.22)`;
    $('clockCv').style.display=h.on?'':'none';
    const el=$('towerClock'), s=BASE*t.size/100;
    el.style.display=t.on?'block':'none';
    el.style.left=t.x+'vw';el.style.top=t.y+'vh';el.style.width=s+'vh';el.style.height=s+'vh';
    paint();
  }
  function tick(d){
    const min=d.getMinutes()+d.getSeconds()/60;
    $('towerHour').setAttribute('transform',`rotate(${(d.getHours()%12+min/60)*30} 50 50)`);
    $('towerMinute').setAttribute('transform',`rotate(${min*6} 50 50)`);
  }

  // frame around the clock being edited, in vh/vw from the same numbers paintClock uses
  function frame(){
    const st=stages()[stage]; if(!st) return;
    const [kind,what]=st, v=data[kind], f=$('clockFrame'), vh=innerHeight/100, pad=1.6;
    let l,t,w,h;
    if(kind==='hero'){
      const s=v.size/100, c=document.createElement('canvas').getContext('2d');
      c.font=`extra-condensed 640 ${36*s*vh}px Clock`;
      const m=c.measureText($('clock').textContent||'00:00'), asc=(m.actualBoundingBoxAscent||27*s*vh)*1.06/vh;
      w=m.width/vh+2*pad; t=v.y+34.5*s-asc-pad; h=asc+2*pad; l=v.x*innerWidth/100/vh-w/2;
    } else {
      const s=BASE*v.size/100; w=h=s+2*pad; l=v.x*innerWidth/100/vh-w/2; t=v.y-h/2;
    }
    f.style.cssText=`left:${l}vh;top:${t}vh;width:${w}vh;height:${h}vh`;
    f.className=what;
  }
  function hint(){
    const st=stages()[stage]; if(!st) return;
    const [kind,what]=st, v=data[kind], n=stages().length;
    $('clkName').textContent=T(kind==='hero'?'digital':'tower');
    $('clkStep').textContent=`${stage+1}/${n}`;
    $('clkSeg').className='seg '+what;
    $('clkMove').textContent='✥ '+T('move'); $('clkSize').textContent='⤢ '+T('size');
    $('clkPct').textContent=v.size+' %';
    $('clkKeys').textContent=[T(what==='size'?'keysSize':'keysMove'),T('okNext'),T('backSave')].join('  ·  ');
    frame();
  }
  const bump=(id,cls)=>{const e=$(id);e.classList.remove(cls);void e.offsetWidth;e.classList.add(cls);};
  function key(k,repeat){
    const list=stages(), st=list[stage]; if(!st) return;
    const [kind,what]=st, v=data[kind], step=repeat?2:1;   // held arrow: moves faster
    if(k==='Enter'){stage=(stage+1)%list.length; bump('clockLayoutHint','pop');}
    else if(what==='move'){
      const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[k]; if(!d) return;
      v.x=lim(v.x+d[0]*step,0,100); v.y=lim(v.y+d[1]*step,0,100);
      bump('clockFrame','n'+k.slice(5).toLowerCase());
    } else {
      const d={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[k]; if(!d) return;
      v.size=lim(v.size+d*5,25,200); bump('clkPct','pop');
    }
    apply();hint();save();
  }
  function init(callback){
    paint=callback;
    $('towerClock').innerHTML=`<svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="tcFace" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#1f3a6e"/><stop offset="1" stop-color="#0b1a38"/></radialGradient>
        <linearGradient id="tcGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#d9a93c"/><stop offset="1" stop-color="#8a5f17"/></linearGradient></defs>
      <circle cx="50" cy="50" r="49" fill="#3b3229"/>
      <circle cx="50" cy="50" r="47" fill="url(#tcGold)"/>
      <circle cx="50" cy="50" r="43.5" fill="url(#tcFace)" stroke="#6b4c16" stroke-width=".8"/>
      <circle cx="50" cy="50" r="27" fill="none" stroke="url(#tcGold)" stroke-width=".6" opacity=".7"/>
      <g id="towerMarks"/>
      <path id="towerHour" d="M48.6 54 L48.9 33 L46.2 30 L50 22.5 L53.8 30 L51.1 33 L51.4 54 Z" fill="url(#tcGold)" stroke="#5a3d0c" stroke-width=".4"/>
      <path id="towerMinute" d="M49.3 58 L49.5 14 L50 9 L50.5 14 L50.7 58 Z" fill="url(#tcGold)" stroke="#5a3d0c" stroke-width=".3"/>
      <circle cx="50" cy="50" r="3.2" fill="url(#tcGold)" stroke="#5a3d0c" stroke-width=".4"/><circle cx="50" cy="50" r="1" fill="#5a3d0c"/></svg>`;
    const marks=$('towerMarks'), NS='http://www.w3.org/2000/svg', R=["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    for(let i=0;i<60;i++){   // minute ring
      const a=i*Math.PI/30, big=i%5===0, line=document.createElementNS(NS,'line'), r1=big?39:40.6;
      for(const [key,value] of Object.entries({x1:50+Math.sin(a)*r1,y1:50-Math.cos(a)*r1,x2:50+Math.sin(a)*42,y2:50-Math.cos(a)*42,stroke:'#e9c766','stroke-width':big?1.4:.5}))line.setAttribute(key,value);
      marks.append(line);
    }
    R.forEach((n,i)=>{   // Roman numerals, upright, gilded
      const a=i*Math.PI/6, t=document.createElementNS(NS,'text');
      for(const [key,value] of Object.entries({x:50+Math.sin(a)*32.5,y:50-Math.cos(a)*32.5,'text-anchor':'middle','dominant-baseline':'central',
        'font-family':'Georgia,serif','font-size':n.length>3?5.2:6.4,'font-weight':700,fill:'url(#tcGold)'}))t.setAttribute(key,value);
      t.textContent=n; marks.append(t);
    });
    apply();tick(new Date());
  }
  const style=()=>data.tower.on?'tower':'digital';
  function setStyle(s){data.tower.on=s==='tower';data.hero.on=!data.tower.on;save();apply();}
  function reset(){   // position and size back to default, the chosen style stays
    for(const k of ['hero','tower']) Object.assign(data[k],{x:defaults[k].x,y:defaults[k].y,size:defaults[k].size});
    save();apply();
  }
  return {hero:data.hero,tower:data.tower,init,tick,begin:()=>{stage=0;hint();},key,finish:save,style,setStyle,reset};
})();
