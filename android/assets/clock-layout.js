// Movable clock overlay; standalone so the original wallpaper and weather remain unchanged.
'use strict';
window.ClockLayout = (() => {
  const defaults = {hero:{on:true,x:50,y:6,size:100},tower:{on:false,x:72,y:26,size:100}};
  const saved = (() => {try{return JSON.parse(localStorage.getItem('clockLayout'))||{};}catch(e){return {};}})();
  const data = {};
  for(const kind of ['hero','tower']) data[kind] = Object.assign({}, defaults[kind], saved[kind] || {});
  let paint=()=>{}, stage=0;
  const stages=[['hero','position'],['hero','size'],['tower','position'],['tower','size']];
  const lim=(n,a,b)=>Math.max(a,Math.min(b,n));
  const save=()=>{try{localStorage.setItem('clockLayout',JSON.stringify(data));}catch(e){}};
  function apply(){
    const h=data.hero,t=data.tower,clock=document.getElementById('clock');
    clock.style.display=h.on?'':'none';
    clock.style.fontSize=(29*h.size/100)+'vh';
    clock.style.top=(h.y+3.6)+'vh';
    clock.style.transform=`translateX(${h.x-50}vw) scaleY(1.22)`;
    const cv=document.getElementById('clockCv');cv.style.display=h.on?'':'none';
    const el=document.getElementById('towerClock');
    el.style.display=t.on?'block':'none';
    el.style.left=t.x+'vw';el.style.top=t.y+'vh';
    el.style.width=(5*t.size/100)+'vh';el.style.height=(5*t.size/100)+'vh';
    paint();
  }
  function tick(d){
    const min=d.getMinutes()+d.getSeconds()/60;
    document.getElementById('towerHour').setAttribute('transform',`rotate(${(d.getHours()%12+min/60)*30} 50 50)`);
    document.getElementById('towerMinute').setAttribute('transform',`rotate(${min*6} 50 50)`);
  }
  function hint(){
    const [kind,what]=stages[stage], v=data[kind];
    document.getElementById('clockLayoutHint').textContent=`${kind==='hero'?'Digital':'Tower'} · ${what==='size'?'← → SIZE':'ARROWS MOVE'} · OK next · 0 show/hide · Back save · ${v.size}%`;
  }
  function key(k){
    const [kind,what]=stages[stage],v=data[kind];
    if(k==='Enter') stage=(stage+1)%stages.length;
    else if(k==='0'||k==='Digit0') v.on=!v.on;
    else if(what==='position') {
      if(k==='ArrowLeft')v.x=lim(v.x-1,0,100);
      else if(k==='ArrowRight')v.x=lim(v.x+1,0,100);
      else if(k==='ArrowUp')v.y=lim(v.y-1,0,100);
      else if(k==='ArrowDown')v.y=lim(v.y+1,0,100);
    } else if(k==='ArrowLeft'||k==='ArrowDown')v.size=lim(v.size-5,25,200);
    else if(k==='ArrowRight'||k==='ArrowUp')v.size=lim(v.size+5,25,200);
    apply();hint();save();
  }
  function init(callback){
    paint=callback;
    document.getElementById('towerClock').innerHTML=`<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="47" fill="#eee5cf" stroke="#574f40" stroke-width="5"/>
      <circle cx="50" cy="50" r="39" fill="none" stroke="#82735d" stroke-width="1.5"/>
      <g id="towerMarks" stroke="#443b31" stroke-width="2"/>
      <line id="towerHour" x1="50" y1="50" x2="50" y2="29" stroke="#25221f" stroke-width="4" stroke-linecap="round"/>
      <line id="towerMinute" x1="50" y1="50" x2="50" y2="17" stroke="#25221f" stroke-width="2.8" stroke-linecap="round"/>
      <circle cx="50" cy="50" r="3.3" fill="#25221f"/></svg>`;
    const marks=document.getElementById('towerMarks');
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6, r=i%3===0?32:35, line=document.createElementNS('http://www.w3.org/2000/svg','line');
      for(const [key,value] of Object.entries({x1:50+Math.sin(a)*r,y1:50-Math.cos(a)*r,x2:50+Math.sin(a)*39,y2:50-Math.cos(a)*39}))line.setAttribute(key,value);
      marks.append(line);
    }
    apply();tick(new Date());
  }
  return {hero:data.hero,tower:data.tower,init,tick,begin:()=>{stage=0;hint();},key,finish:save};
})();
