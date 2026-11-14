// Movable clocks (digital + cathedral tower clock) and their on-screen editor; standalone so wallpaper and weather stay untouched.
// The editor: a glowing frame follows the clock being edited, a glass capsule says which clock, which step (move / size) and which keys.
'use strict';
window.ClockLayout = (() => {
  const defaults = {hero:{on:true,x:50,y:6,size:100},tower:{on:false,x:72,y:26,size:100}};
  const saved = (() => {try{return JSON.parse(localStorage.getItem('clockLayout'))||{};}catch(e){return {};}})();
  const data = {};
  for(const kind of ['hero','tower']) data[kind] = Object.assign({}, defaults[kind], saved[kind] || {});
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
    const el=$('towerClock'), s=5*t.size/100;
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
      const s=5*v.size/100; w=h=s+2*pad; l=v.x*innerWidth/100/vh-w/2; t=v.y-h/2;
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
      <circle cx="50" cy="50" r="47" fill="#eee5cf" stroke="#574f40" stroke-width="5"/>
      <circle cx="50" cy="50" r="39" fill="none" stroke="#82735d" stroke-width="1.5"/>
      <g id="towerMarks" stroke="#443b31" stroke-width="2"/>
      <line id="towerHour" x1="50" y1="50" x2="50" y2="29" stroke="#25221f" stroke-width="4" stroke-linecap="round"/>
      <line id="towerMinute" x1="50" y1="50" x2="50" y2="17" stroke="#25221f" stroke-width="2.8" stroke-linecap="round"/>
      <circle cx="50" cy="50" r="3.3" fill="#25221f"/></svg>`;
    const marks=$('towerMarks');
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6, r=i%3===0?32:35, line=document.createElementNS('http://www.w3.org/2000/svg','line');
      for(const [key,value] of Object.entries({x1:50+Math.sin(a)*r,y1:50-Math.cos(a)*r,x2:50+Math.sin(a)*39,y2:50-Math.cos(a)*39}))line.setAttribute(key,value);
      marks.append(line);
    }
    apply();tick(new Date());
  }
  const style=()=>data.hero.on&&data.tower.on?'both':data.tower.on?'tower':'digital';
  function setStyle(s){data.hero.on=s!=='tower';data.tower.on=s!=='digital';save();apply();}
  function reset(){   // position and size back to default, the chosen style stays
    for(const k of ['hero','tower']) Object.assign(data[k],{x:defaults[k].x,y:defaults[k].y,size:defaults[k].size});
    save();apply();
  }
  return {hero:data.hero,tower:data.tower,init,tick,begin:()=>{stage=0;hint();},key,finish:save,style,setStyle,reset};
})();
