// Movable, resizable digital clock and its on-screen editor; standalone so wallpaper and weather stay untouched.
// The editor: a glowing frame follows the clock, a glass capsule says which step (move / size) and which keys.
'use strict';
window.ClockLayout = (() => {
  const defaults = {x:50,y:6,size:100};
  const saved = (() => {try{return (JSON.parse(localStorage.getItem('clockLayout'))||{}).hero||{};}catch(e){return {};}})();
  const h = Object.assign({}, defaults, saved, {on:true});   // 1.1.x also had a tower clock and on/off: gone
  let paint=()=>{}, stage=0, snap=null;
  const $=id=>document.getElementById(id);
  const lim=(n,a,b)=>Math.max(a,Math.min(b,n));
  const save=()=>{try{localStorage.setItem('clockLayout',JSON.stringify({hero:h}));}catch(e){}};
  const STAGES=['move','size'];

  function apply(){
    const clock=$('clock');
    clock.style.fontSize=(29*h.size/100)+'vh';
    clock.style.top=(h.y+3.6)+'vh';
    clock.style.transform=`translateX(${h.x-50}vw) scaleY(1.22)`;
    paint();
  }
  // frame around the clock, from the same numbers paintClock uses
  function frame(){
    const f=$('clockFrame'), vh=innerHeight/100, pad=1.6, s=h.size/100, c=document.createElement('canvas').getContext('2d');
    c.font=`extra-condensed 640 ${36*s*vh}px Clock`;
    const m=c.measureText($('clock').textContent||'00:00'), asc=(m.actualBoundingBoxAscent||27*s*vh)*1.06/vh;
    const w=m.width/vh+2*pad, t=h.y+34.5*s-asc-pad, hh=asc+2*pad, l=h.x*innerWidth/100/vh-w/2;
    f.style.cssText=`left:${l}vh;top:${t}vh;width:${w}vh;height:${hh}vh`;
    f.className=STAGES[stage];
  }
  function hint(){
    const what=STAGES[stage];
    $('clkName').textContent=T('clock');
    $('clkStep').textContent=`${stage+1}/2`;
    $('clkSeg').className='seg '+what;
    $('clkMove').textContent='✥ '+T('move'); $('clkSize').textContent='⤢ '+T('size');
    $('clkPct').textContent=h.size+' %';
    $('clkKeys').textContent=[T(what==='size'?'keysSize':'keysMove'),T('okNext'),T('backDone')].join('  ·  ');
    frame();
  }
  const bump=(id,cls)=>{const e=$(id);e.classList.remove(cls);void e.offsetWidth;e.classList.add(cls);};
  function key(k,repeat){
    const step=repeat?2:1;   // held arrow: moves faster
    if(k==='Enter'){stage=(stage+1)%2; bump('clockLayoutHint','pop');}
    else if(STAGES[stage]==='move'){
      const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[k]; if(!d) return;
      h.x=lim(h.x+d[0]*step,0,100); h.y=lim(h.y+d[1]*step,0,100);
      bump('clockFrame','n'+k.slice(5).toLowerCase());
    } else {
      const d={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[k]; if(!d) return;
      h.size=lim(h.size+d*5,25,200); bump('clkPct','pop');
    }
    apply();hint();
  }
  return {hero:h, init(cb){paint=cb;apply();},
    begin(){stage=0;snap=Object.assign({},h);hint();},
    key, save,
    cancel(){if(snap)Object.assign(h,snap);apply();},
    reset(){Object.assign(h,defaults);save();apply();}};
})();
