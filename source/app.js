/* ================= app ================= */
(function(){
const $=s=>document.querySelector(s);
function h(tag,attrs,...kids){
  const el=document.createElement(tag);
  if(attrs)for(const[k,v]of Object.entries(attrs)){
    if(v==null||v===false)continue;
    if(k==='class')el.className=v;else if(k==='html')el.innerHTML=v;else if(k.startsWith('on'))el.addEventListener(k.slice(2),v);
    else if(k==='style'&&typeof v==='object')Object.assign(el.style,v);else el.setAttribute(k,v===true?'':v);
  }
  for(const k of kids.flat()){if(k==null||k===false)continue;el.append(k.nodeType?k:document.createTextNode(k));}
  return el;
}
const fmt=f1;
const mm=v=>`${fmt(v)} mm`;
const STAR='<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>';
function starsEl(n,big){const s=h('span',{class:'stars'+(big?' lg':''),'aria-label':`${n} of 3 stars`});for(let i=0;i<3;i++)s.append(h('span',{class:i<n?'on':'off',html:STAR}));return s;}
const CHEV='<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3l5 5-5 5"/></svg>';
const LOCK='<svg class="lock" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
const TECH_ICON={
  ring:'<svg viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="10" y="19" width="14" height="3" fill="currentColor" stroke="none"/><path d="M14 1h6v5h-6z"/><ellipse cx="17" cy="8" rx="10" ry="2.2"/><path d="M8 10l5 8M26 10l-5 8" stroke-dasharray="2 2"/></svg>',
  dome:'<svg viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="11" y="19" width="12" height="3" fill="currentColor" stroke="none"/><path d="M4 21A13 13 0 0 1 30 21"/><path d="M15 1h4v7h-4z"/><path d="M8 14l4 4M26 14l-4 4M17 11v6" stroke-dasharray="2 2"/></svg>',
  coax:'<svg viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="10" y="19" width="14" height="3" fill="currentColor" stroke="none"/><rect x="10" y="4" width="14" height="10"/><path d="M10 14L24 4"/><path d="M3 9h7M17 14v4" stroke-dasharray="2 2"/></svg>',
  darkfield:'<svg viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="11" y="19" width="12" height="3" fill="currentColor" stroke="none"/><path d="M3 14h5v6H3zM26 14h5v6h-5z"/><path d="M8 17l6 2M26 17l-6 2" stroke-dasharray="2 2"/><path d="M15 1h4v6h-4z"/></svg>',
  bar:'<svg viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="11" y="19" width="12" height="3" fill="currentColor" stroke="none"/><path d="M2 6l5-3 2 3-5 3zM32 6l-5-3-2 3 5 3z"/><path d="M8 8l6 10M26 8l-6 10" stroke-dasharray="2 2"/></svg>',
  back:'<svg viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="12" y="14" width="10" height="3" fill="currentColor" stroke="none"/><rect x="4" y="19" width="26" height="3"/><path d="M8 17V8M26 17V8M17 12V4" stroke-dasharray="2 2"/></svg>',
};
const DEF_ICON={
  scratch:'<path d="M3 15L17 5"/>',crack:'<path d="M3 14l4-3 2 2 3-5 2 1 3-4"/>',dent:'<circle cx="10" cy="10" r="6" stroke-dasharray="2 2"/><circle cx="10" cy="10" r="2"/>',
  stain:'<path d="M5 8c2-4 8-5 10-1s1 8-4 8-8-3-6-7z" fill="currentColor" fill-opacity=".35"/>',oil:'<path d="M10 3c3 4 5 7 5 9a5 5 0 01-10 0c0-2 2-5 5-9z"/>',
  debris:'<circle cx="10" cy="10" r="2.6" fill="currentColor"/>',bubble:'<circle cx="10" cy="10" r="5"/><circle cx="8" cy="8" r="1"/>',
  print:'<path d="M3 13c4-3 9 1 14-4" stroke-width="3"/>',chip:'<path d="M3 4h14v12H3z"/><path d="M11 4a3 3 0 006 3" fill="currentColor"/>',
  burr:'<path d="M3 4h12v12H3z"/><path d="M15 8l3 1-3 2" fill="currentColor"/>',missing:'<path d="M3 4h14v12H3z"/><circle cx="10" cy="10" r="3" stroke-dasharray="1.5 1.5"/>',
};
const defIcon=t=>`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${DEF_ICON[t]}</svg>`;
const DIFF={c1:1,c2:2,c3:2,c4:3,c5:3,c6:3,c7:4,c8:5,c9:4,c10:2,c11:3,c12:3,c13:4,c14:4};
const RANKS=[[0,'Trainee'],[4,'Technician'],[9,'Applications engineer'],[15,'Vision specialist'],[21,'Senior vision specialist'],[26,'Principal vision engineer']];
const SWATCH=['#f1f1ec','#1b1b1b','#8a8f96','#cdd1d6','#c62f2f','#2456b5','#1f6b3a','#e8c21c','#d98a2b','#2d2f33'];
const AMB_TXT={low:'Low (enclosed)',medium:'Medium (factory lights)',high:'High (daylight)'};
const SETUP={cam:'imx273',colorCam:false,lens:'f16',wd:400,N:4,spacer:false,tech:'ring',lcolor:'white',lsize:100,intensity:60,barAngle:30,strobe:false,filter:'none',pol:false,shroud:false,expo:5,gain:0};
const APERTURES=[1.8,2,2.4,2.8,4,5.6,8,11,16];

/* ---------- storage (this browser only) ---------- */
const KEY='vision-bench-v1';
let store={stars:{},best:{},assisted:{},unlockAll:false,free:null,theme:null};
try{const raw=localStorage.getItem(KEY);if(raw)store=Object.assign(store,JSON.parse(raw));}catch(e){}
let saveT=0;
function save(){clearTimeout(saveT);saveT=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(store));}catch(e){}},250);}

/* ---------- state ---------- */
let uid=1;
function mkDefect(t,o){const D=DEFS[t];return Object.assign({id:uid++,type:t,u:.5,v:.5,w:D.w,l:D.l,ang:0,color:D.colored&&D.autoDark==null?D.color:undefined},o||{});}
function jobState(c){
  const P=PARTS[c.part];
  const S={...SETUP,part:c.part,material:c.material,color:c.color,speed:c.speed,ppm:c.ppm,depth:c.depth,ambient:c.ambient,budget:c.budget,requireColor:!!c.requireColor,
    defects:c.defects.map(d=>mkDefect(d.t,{u:d.u,v:d.v,w:d.w??DEFS[d.t].w,l:d.l??DEFS[d.t].l,ang:d.ang||0,color:d.color||(DEFS[d.t].autoDark==null&&DEFS[d.t].colored?DEFS[d.t].color:undefined)}))};
  S.lsize=pickSize(S.tech,P);
  return S;
}
function freeState(){
  const P=PARTS.cap;
  const S={...SETUP,part:'cap',material:'matte',color:P.color,speed:0,ppm:30,depth:P.depth,ambient:'medium',budget:5000,requireColor:false,
    defects:[mkDefect('scratch',{u:.35,v:.35,w:.1,l:6,ang:25}),mkDefect('stain',{u:.62,v:.62,w:3,l:2.5})]};
  S.lsize=pickSize('ring',P);
  return S;
}
const app={mode:'job',job:CHALLENGES[0],S:null,E:null,sel:-1,armed:null,captured:null,changed:true,revealed:false};
function job(){return app.job;}
function jobIndex(){return CHALLENGES.indexOf(app.job);}
function unlocked(i){return store.unlockAll||i===0||(store.stars[CHALLENGES[i-1].id]||0)>=1;}
function totalStars(){return CHALLENGES.reduce((a,c)=>a+(store.stars[c.id]||0),0);}
function rankName(n){let r=RANKS[0][1];for(const[k,v]of RANKS)if(n>=k)r=v;return r;}
function showVerdicts(){return app.mode==='free'||(app.captured&&!app.changed);}

/* ---------- toast ---------- */
let toastT=0;
function toast(msg){let t=$('.toast');if(!t){t=h('div',{class:'toast',role:'status'});document.body.append(t);}t.textContent=msg;t.classList.remove('hide');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.add('hide'),2600);}

/* ---------- recompute & render ---------- */
let rafQ=0,benchT=0;
function changed(opts){
  app.changed=true;
  if(app.mode==='free'){store.free=app.S;save();}
  if(!rafQ)rafQ=requestAnimationFrame(()=>{rafQ=0;flush(opts);});
}
function flush(opts){
  try{flushInner(opts);}catch(err){console.error(err);toast('Something went wrong with that change; the last good setup is still loaded.');}
}
function flushInner(opts){
  const S=app.S;
  if(LENS[S.lens].tele)S.wd=LENS[S.lens].wd;
  app.E=evaluate(S);
  syncControls();
  renderSensor();
  renderLive();
  renderHeader();
  clearTimeout(benchT);
  benchT=setTimeout(()=>{if(benchOK)Bench.update(app.S,app.E);},opts&&opts.fast?160:30);
}

/* ---------- header, brief ---------- */
function renderHeader(){
  const jl=$('#jobline');jl.replaceChildren();
  if(app.mode==='job'){const i=jobIndex();jl.append(h('span',{class:'jt'},`Job ${i+1}: ${job().title}`),h('span',{class:'jc'},`${job().client}, ${job().industry.toLowerCase()}`));}
  else jl.append(h('span',{class:'jt'},'Free bench'),h('span',{class:'jc'},'Change anything, including the part and the line'));
  jl.append(h('button',{class:'btn ghost',onclick:openHome},'All jobs'));
  const r=$('#rank');r.replaceChildren();const n=totalStars();
  r.append(starsEl(1),h('b',null,`${n}/${CHALLENGES.length*3}`),h('span',{class:'t'},rankName(n)));
}
function renderBrief(){
  const b=$('#brief');b.replaceChildren();const S=app.S,P=PARTS[S.part];
  const facts=[['Part',`${P.name}, ${P.w}×${P.h} mm`],['Material',MATS[S.material].name],['Line',S.speed>0?`${S.speed} mm/s continuous`:'Indexed, part stops'],['Rate',`${S.ppm} parts/min`],['Height variation',mm(S.depth)],['Plant lighting',AMB_TXT[S.ambient]],['Budget',money(S.budget)]];
  if(app.mode==='job'){
    const c=job();
    const tipBtn=h('button',{class:'btn',onclick:()=>{tip.classList.toggle('hide');}},'Hint');
    const tip=h('p',{class:'hide',style:{gridColumn:'1/-1',color:'var(--ink)'}},c.tip);
    b.append(h('div',null,h('h3',{style:{fontSize:'17px',marginBottom:'4px'}},`${c.client} needs a vision check`),h('p',null,c.brief)),tipBtn,tip);
  }else b.append(h('div',null,h('h3',{style:{fontSize:'17px',marginBottom:'4px'}},'Free bench'),h('p',null,'Build any inspection: choose the part, material and line, place defects on the part, then find the hardware that shows them.')));
  b.append(h('div',{class:'facts'},facts.map(([k,v])=>h('span',null,`${k} `,h('b',null,v)))));
}

/* ---------- controls ---------- */
const binds=[];
function bind(el,k,parse,after){el.dataset.k=k;binds.push({el,k});el.addEventListener('input',()=>{const S=app.S;S[k]=parse?parse(el):el.type==='checkbox'?el.checked:el.value;if(after)after(S);changed({fast:el.type==='range'});});return el;}
const num=el=>+el.value;
function section(id,title,open){
  const d=h('details',{class:'sec',id,open:open?true:null});
  const sum=h('span',{class:'sum'});
  d.append(h('summary',null,h('h2',null,title),sum,h('span',{html:CHEV,style:{display:'contents'}})));
  const body=h('div',{class:'body'});d.append(body);d._sum=sum;d._body=body;return d;
}
function field(label,ctrl,outId){return h('div',{class:'field'},h('label',null,h('span',null,label),outId?h('output',{id:outId}):null),ctrl);}
function tog(label,sub,input){return h('label',{class:'tog'},h('span',null,label,sub?h('small',null,sub):null),input);}
function sel(opts){return h('select',{class:'sel'},opts.map(([v,t])=>h('option',{value:v},t)));}
function logSlider(min,max){const el=h('input',{type:'range',min:0,max:1000,step:1});el._min=min;el._max=max;return el;}
const logGet=el=>+(el._min*Math.pow(el._max/el._min,el.value/1000)).toPrecision(3);
const logSet=(el,v)=>{el.value=Math.round(Math.log(v/el._min)/Math.log(el._max/el._min)*1000);};

let secJob,secDef,secLight,secOpt,secExp;
function buildControls(){
  const root=$('#controls');root.replaceChildren();binds.length=0;
  /* job */
  secJob=section('secJob','Part and line',false);
  const partSel=bind(sel(Object.entries(PARTS).map(([k,p])=>[k,`${p.name} (${p.sub.split(', ')[1]})`])),'part',null,S=>{const P=PARTS[S.part];S.material=P.mat;S.color=P.color;S.depth=P.depth;S.lsize=pickSize(S.tech,P);S.wd=fitWd(S);});
  const matSel=bind(sel(Object.entries(MATS).map(([k,m])=>[k,m.name])),'material');
  const colIn=bind(h('input',{type:'color','aria-label':'Part color'}),'color');
  const sw=h('div',{class:'swatches'},SWATCH.map(c=>h('button',{style:{background:c},'aria-label':`Color ${c}`,onclick:()=>{app.S.color=c;changed();}})));
  const spd=bind(h('input',{type:'range',min:0,max:2000,step:50}),'speed',num);
  const ppm=bind(h('input',{type:'range',min:1,max:1200,step:1}),'ppm',num);
  const dep=bind(h('input',{type:'range',min:0,max:30,step:.1}),'depth',num);
  const amb=bind(sel(Object.entries(AMB_TXT)),'ambient');
  const bud=bind(h('input',{type:'range',min:1000,max:15000,step:100}),'budget',num);
  const rc=bind(h('input',{type:'checkbox'}),'requireColor');
  secJob._lockNote=h('p',{class:'locked-note'},'The customer fixed the part and the line for this job. Your job is the hardware.');
  secJob._edit=h('div',{style:{display:'grid',gap:'12px'}},
    field('Part',partSel),field('Material',matSel),h('p',{class:'hint',id:'matHint'}),
    h('div',{class:'field'},h('label',null,h('span',null,'Part color')),h('div',{class:'row'},colIn,sw)),
    field('Line speed',spd,'o_speed'),field('Parts per minute',ppm,'o_ppm'),field('Surface height variation',dep,'o_depth'),
    field('Plant lighting',amb),field('Budget',bud,'o_budget'),tog('Color check required','Customer must verify color',rc));
  secJob._body.append(secJob._lockNote,secJob._edit);
  /* defects */
  secDef=section('secDef','Defects',true);
  secDef._pal=h('div',{class:'dpal'},Object.entries(DEFS).map(([k,D])=>h('button',{'data-t':k,'aria-pressed':'false',title:D.about,onclick:()=>arm(app.armed===k?null:k)},h('span',{html:defIcon(k),style:{display:'contents'}}),D.name)));
  secDef._palWrap=h('div',{style:{display:'grid',gap:'8px'}},h('p',{class:'hint'},'Choose a defect, then click the part in the 3D view or the camera image. Drag markers in the camera image to move them.'),secDef._pal);
  secDef._list=h('div',{class:'dlist'});
  secDef._body.append(secDef._palWrap,secDef._list);
  /* lighting */
  secLight=section('secLight','Lighting',true);
  secLight._seg=h('div',{class:'seg',role:'group','aria-label':'Lighting technique'},Object.entries(LIGHTS).map(([k,L])=>h('button',{'data-v':k,onclick:()=>{const S=app.S;S.tech=k;S.lsize=pickSize(k,PARTS[S.part]);S.wd=Math.max(S.wd,lightClearance(S));if(k==='back')S.pol=false;changed();}},h('span',{html:TECH_ICON[k],style:{display:'contents'}}),L.name.replace(' lights',''))));
  const lsz=bind(sel([]),'lsize',num);secLight._size=lsz;
  const ang=bind(h('input',{type:'range',min:10,max:80,step:5}),'barAngle',num);
  secLight._ang=field('Bar angle above the part',ang,'o_ang');
  secLight._chips=h('div',{class:'chips',role:'group','aria-label':'LED color'},Object.entries(LCOL).map(([k,c])=>h('button',{class:'chip','data-v':k,onclick:()=>{app.S.lcolor=k;changed();}},h('i',{style:{background:c.css}}),c.short)));
  const inten=bind(h('input',{type:'range',min:1,max:100,step:1}),'intensity',num);
  const filt=bind(sel(Object.entries(FILT).map(([k,f])=>[k,f.name])),'filter');
  const strobe=bind(h('input',{type:'checkbox'}),'strobe');
  const pol=bind(h('input',{type:'checkbox'}),'pol');secLight._pol=pol;
  const shroud=bind(h('input',{type:'checkbox'}),'shroud');
  secLight._body.append(secLight._seg,h('p',{class:'hint',id:'techHint'}),field('Light size',lsz),secLight._ang,
    h('div',{class:'field'},h('span',{class:'lbl'},'LED color'),secLight._chips),field('Intensity',inten,'o_int'),field('Lens filter',filt),
    tog('Strobe','Overdrive the LED in short pulses',strobe),tog('Polarizers','Crossed on light and lens, cuts glare',pol),tog('Shroud','Blocks plant lighting',shroud));
  /* optics */
  secOpt=section('secOpt','Camera and lens',true);
  const camSel=bind(sel(CAMERAS.map(c=>[c.id,`${c.name}, ${c.sensor}, ${c.fps} fps${c.shutter==='rolling'?', rolling shutter':''}, ${money(c.cost)}`])),'cam',null,S=>{});
  secOpt._mono=h('div',{class:'seg',style:{gridTemplateColumns:'1fr 1fr'},role:'group','aria-label':'Sensor type'},
    h('button',{'data-v':'mono',onclick:()=>{app.S.colorCam=false;changed();}},'Mono'),h('button',{'data-v':'color',onclick:()=>{app.S.colorCam=true;changed();}},'Color'));
  const lensSel=bind(sel(LENSES.map(l=>[l.id,`${l.name}${l.tele?` (fixed ${l.wd} mm)`:`, f/${l.minN}, focuses from ${l.mod} mm`}, ${money(l.cost)}`])),'lens',null,S=>{const L=LENS[S.lens];if(L.tele){S.wd=L.wd;S.spacer=false;}else S.wd=fitWd(S);});
  const wd=bind(h('input',{type:'range',min:40,max:1200,step:5}),'wd',num);secOpt._wd=wd;
  const fit=h('button',{class:'btn',onclick:()=>{app.S.wd=fitWd(app.S);changed();}},'Fit part to image');
  const ap=bind(sel(APERTURES.map(n=>[n,`f/${n}`])),'N',num);secOpt._ap=ap;
  const spacer=bind(h('input',{type:'checkbox'}),'spacer');secOpt._spacer=spacer;
  secOpt._ro=h('dl',{class:'readout'});
  secOpt._body.append(field('Camera',camSel),secOpt._mono,field('Lens',lensSel),
    h('div',{class:'field'},h('label',null,h('span',null,'Working distance'),h('output',{id:'o_wd'})),wd,h('div',{class:'row'},fit)),
    field('Aperture',ap),tog('Spacer ring','Lets the lens focus closer',spacer),secOpt._ro);
  /* exposure */
  secExp=section('secExp','Exposure',true);
  const ex=logSlider(.005,50);ex.dataset.k='expo';binds.push({el:ex,k:'expo',log:true});ex.addEventListener('input',()=>{app.S.expo=logGet(ex);changed({fast:true});});
  const gain=bind(h('input',{type:'range',min:0,max:24,step:.5}),'gain',num);
  secExp._ro=h('dl',{class:'readout'});
  secExp._body.append(field('Exposure time',ex,'o_expo'),field('Gain',gain,'o_gain'),
    h('div',{class:'row'},h('button',{class:'btn',onclick:()=>{autoExpose(app.S);changed();toast('Exposure set for the brightest surface');}},'Auto exposure')),secExp._ro);
  root.append(secJob,secDef,secLight,secOpt,secExp);
}
function setPressed(container,val){container.querySelectorAll('[data-v]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===String(val))));}
function ro(dl,rows){dl.replaceChildren();rows.forEach(([k,v,c])=>dl.append(h('dt',null,k),h('dd',{class:c||''},v)));}
function syncControls(){
  const S=app.S,E=app.E,O=E.O,P=PARTS[S.part],free=app.mode==='free';
  for(const b of binds){const el=b.el;if(document.activeElement===el&&el.type==='range')continue;
    if(b.log)logSet(el,S[b.k]);else if(el.type==='checkbox')el.checked=!!S[b.k];else el.value=S[b.k];}
  // job section
  secJob._lockNote.classList.toggle('hide',free);secJob._edit.classList.toggle('hide',!free);
  secJob._sum.textContent=P.name;
  $('#matHint').textContent=MATS[S.material].hint;
  secJob.querySelectorAll('.swatches button').forEach(b=>b.setAttribute('aria-pressed',String(b.style.background&&hexOf(b.style.background)===S.color.toLowerCase())));
  $('#o_speed').textContent=S.speed>0?`${S.speed} mm/s`:'Stopped';$('#o_ppm').textContent=S.ppm;$('#o_depth').textContent=mm(S.depth);$('#o_budget').textContent=money(S.budget);
  // defects
  secDef._palWrap.classList.toggle('hide',!free);
  secDef._pal.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.t===app.armed)));
  secDef._sum.textContent=`${S.defects.length} placed`;
  renderDefList();
  // lighting
  setPressed(secLight._seg,S.tech);setPressed(secLight._chips,S.lcolor);
  $('#techHint').textContent=`${LIGHTS[S.tech].short}. ${TECH_WHY[S.tech]}`;
  const L=LIGHTS[S.tech];
  if(secLight._size._t!==S.tech){secLight._size.replaceChildren(...L.sizes.map(z=>h('option',{value:z},`${z} mm${S.tech==='bar'?' long':S.tech==='back'?' panel':' diameter'}`)));secLight._size._t=S.tech;}
  secLight._size.value=S.lsize;
  secLight._ang.classList.toggle('hide',S.tech!=='bar');$('#o_ang').textContent=`${S.barAngle}°`;
  $('#o_int').textContent=`${S.intensity}%`;
  secLight._pol.disabled=S.tech==='back';
  secLight._sum.textContent=`${L.name.replace(' lights','')}, ${LCOL[S.lcolor].short}`;
  // optics
  setPressed(secOpt._mono,S.colorCam?'color':'mono');
  const lens=LENS[S.lens];
  secOpt._wd.disabled=!!lens.tele;secOpt._ap.disabled=!!lens.tele;secOpt._spacer.disabled=!!lens.tele;
  [...secOpt._ap.options].forEach(o=>o.disabled=!lens.tele&&+o.value<lens.minN);
  if(!lens.tele&&S.N<lens.minN){S.N=lens.minN;secOpt._ap.value=S.N;}
  if(lens.tele)secOpt._ap.value=lens.N;
  $('#o_wd').textContent=`${S.wd} mm`;
  secOpt._sum.textContent=`${O.cam.name}, ${lens.name}`;
  const small=E.defs.filter(x=>x.G.feat!==null).sort((a,b)=>a.G.w-b.G.w)[0];
  const need=S.ppm/60;
  const fOK=P.w<=O.fovW&&P.h<=O.fovH;
  ro(secOpt._ro,[
    ['Field of view',`${fmt(O.fovW)} × ${fmt(O.fovH)} mm`,fOK?'':'bad'],
    ['Pixel size on part',`${fmt(O.mmpp)} mm${S.colorCam?` (${fmt(O.eff)} effective)`:''}`],
    ['Smallest defect',small?`${fmt(small.wpx)} px across`:'None placed',small?(small.wpx<.5?'bad':small.wpx<1.5?'meh':'ok'):''],
    ['Depth of field',`${fmt(O.dof)} mm (need ${fmt(S.depth)})`,O.dof<S.depth?'meh':''],
    ['Focus',O.focusErr>0?'Out of focus':'In focus',O.focusErr>0?'bad':'ok'],
    ['Optical blur',`${fmt(Math.hypot(O.dofPx,O.diffPx))} px`,Math.hypot(O.dofPx,O.diffPx)>2?'meh':''],
    ['Frame rate',`${O.cam.fps} fps (need ${fmt(need*1.2)})`,O.cam.fps<need*1.2?'bad':''],
  ]);
  // exposure
  $('#o_expo').textContent=`${fmt(S.expo)} ms`;$('#o_gain').textContent=`${fmt(S.gain)} dB`;
  const pv=vmax(vclip(E.partV)),bright=Math.max(pv,E.X.back?vmax(vclip(E.stageV)):0);
  ro(secExp._ro,[
    ['Brightest surface',`${Math.round(bright*100)}%`,bright<.2?'bad':bright>=.99?'meh':''],
    ['Motion blur',S.speed>0?`${fmt(O.motionPx)} px`:'None, part stopped',O.motionPx>3?'bad':O.motionPx>1?'meh':''],
    ['Noise',`${fmt((E.noiseA+E.noiseB*.7)*100)}%`,S.gain>12?'meh':''],
  ]);
  secExp._sum.textContent=`${fmt(S.expo)} ms`;
}
function hexOf(rgb){const m=rgb.match(/\d+/g);return m?'#'+m.slice(0,3).map(x=>(+x).toString(16).padStart(2,'0')).join(''):'';}

function renderDefList(){
  const S=app.S,E=app.E,list=secDef._list,free=app.mode==='free';
  list.replaceChildren();
  if(!S.defects.length){list.append(h('p',{class:'empty'},'No defects yet. Pick one above and click the part.'));return;}
  S.defects.forEach((d,i)=>{
    const D=DEFS[d.type],x=E.defs[i],isSel=app.sel===i;
    const size=D.kind==='feature'?(x&&x.G.feat?`${x.G.feat.kind==='hole'?'hole':x.G.feat.kind==='print'?'print block':'component'}`:'no feature'):D.round?mm(d.w):`${fmt(d.w)} × ${fmt(d.l)} mm`;
    const dot=h('span',{class:'dot'+(showVerdicts()&&x?' '+x.verdict:'')});
    const it=h('div',{class:'ditem'+(isSel?' on':'')},
      h('button',{class:'dh','aria-expanded':String(isSel),onclick:()=>{app.sel=isSel?-1:i;renderDefList();drawOverlay();}},dot,h('span',null,D.name),h('span',{class:'dsz'},size)));
    if(isSel){
      const body=h('div',{class:'dbody'},h('p',{class:'hint'},D.about));
      if(x)body.append(h('p',{class:'hint'},`In this image: ${fmt(x.wpx)} px wide${D.round?'':`, ${fmt(x.lpx)} px long`}.`+(showVerdicts()?` Contrast to noise ${fmt(x.cnr)}.`:'')));
      if(free&&D.kind!=='feature'){
        const upd=()=>changed({fast:true});
        if(D.wr){const s=logSlider(D.wr[0],D.wr[1]);logSet(s,d.w);s.addEventListener('input',()=>{d.w=logGet(s);ow.textContent=mm(d.w);upd();});const ow=h('output',null,mm(d.w));
          body.append(h('div',{class:'field'},h('label',null,h('span',null,D.round?'Diameter':D.kind==='edge'?'Depth':'Width'),ow),s));}
        if(!D.round&&D.lr){const s=logSlider(D.lr[0],D.lr[1]);logSet(s,d.l);const ol=h('output',null,mm(d.l));s.addEventListener('input',()=>{d.l=logGet(s);ol.textContent=mm(d.l);upd();});
          body.append(h('div',{class:'field'},h('label',null,h('span',null,'Length'),ol),s));}
        if(D.kind==='surface'&&!D.round){const s=h('input',{type:'range',min:-90,max:90,step:5,value:d.ang||0});const oa=h('output',null,`${d.ang||0}°`);s.addEventListener('input',()=>{d.ang=+s.value;oa.textContent=`${d.ang}°`;upd();});
          body.append(h('div',{class:'field'},h('label',null,h('span',null,'Angle'),oa),s));}
        if(D.colored&&D.kind==='surface'&&D.autoDark==null){const c=h('input',{type:'color',value:d.color||D.color});c.addEventListener('input',()=>{d.color=c.value;upd();});body.append(h('div',{class:'row'},h('span',{class:'lbl grow'},'Defect color'),c));}
      }
      if(free)body.append(h('div',{class:'row'},h('button',{class:'btn',onclick:()=>{S.defects.splice(i,1);app.sel=-1;changed();}},'Remove defect')));
      it.append(body);
    }
    list.append(it);
  });
}

/* ---------- placing defects ---------- */
function arm(t){
  app.armed=t;
  const tip=$('#armedTip');
  if(t){tip.textContent=`Click the part to place a ${DEFS[t].name.toLowerCase()}`;tip.classList.remove('hide');}
  else tip.classList.add('hide');
  $('#sensorBox').classList.toggle('armed',!!t);
  if(benchOK)Bench.setArmed(!!t);
  if(app.E)syncControls();
}
function placeAt(u,v){
  const S=app.S,P=PARTS[S.part],t=app.armed;if(!t)return false;
  const D=DEFS[t],x=(u-.5)*P.w,y=(v-.5)*P.h;
  if(D.kind==='surface'&&!inShape(P,x,y)){toast('Surface defects go on the part surface. Click inside the outline.');return false;}
  if(D.kind==='feature'&&!featureList(P).length){toast(`The ${P.name.toLowerCase()} has no holes, components or print to leave out.`);return false;}
  S.defects.push(mkDefect(t,{u,v,ang:D.round?0:Math.round((Math.random()*120-60)/5)*5}));
  app.sel=S.defects.length-1;
  arm(null);
  changed();
  return true;
}

/* ---------- camera image ---------- */
const sCv=$('#sensor'),sCtx=sCv.getContext('2d');
const box=$('#sensorBox');
const ov=h('canvas',{style:{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'}});box.append(ov);
const ovCtx=ov.getContext('2d');
let fd=null,noisy=null,hover=null,drag=null;
function renderSensor(){
  fd=Sensor.frame(app.S,app.E,720);
  if(sCv.width!==fd.rw||sCv.height!==fd.rh){sCv.width=fd.rw;sCv.height=fd.rh;}
  noisy=new ImageData(fd.rw,fd.rh);
  paintSensor();drawHisto();
  const O=app.E.O;
  $('#sensorMeta').textContent=`${O.cam.px[0]}×${O.cam.px[1]} px, ${app.S.colorCam?'color':'mono'}`;
  $('#sensorHint').textContent=fd.native?'Shown at full sensor resolution':'Scaled down; the loupe shows real pixels';
  drawOverlay();
}
function paintSensor(){
  if(!fd||!noisy)return;
  Sensor.addNoise(fd.img,noisy,app.E,app.S,performance.now()/1000);
  if($('#clipTog').checked){
    const d=noisy.data,c=fd.img.data,w=noisy.width,h=noisy.height;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;
      if(c[i]>=250&&c[i+1]>=250&&c[i+2]>=250){if(((x+y)&7)<4){d[i]=255;d[i+1]=60;d[i+2]=60;}}
      else if(c[i]<=1&&c[i+1]<=1&&c[i+2]<=1&&((x-y)&7)<4){d[i]=40;d[i+1]=90;d[i+2]=255;}}
  }
  sCtx.putImageData(noisy,0,0);
}
function drawHisto(){
  const cv=$('#histo'),c=cv.getContext('2d');c.clearRect(0,0,cv.width,cv.height);
  if(!fd)return;
  const bins=new Float32Array(64),d=fd.img.data;
  for(let i=0;i<d.length;i+=4){const v=app.S.colorCam?(d[i]*.3+d[i+1]*.6+d[i+2]*.1):d[i];bins[Math.min(63,v/4|0)]++;}
  let mx=0;for(let i=0;i<64;i++){bins[i]=Math.log10(1+bins[i]);if(bins[i]>mx)mx=bins[i];}
  const st=getComputedStyle(document.documentElement),W=cv.width,H=cv.height,bw=W/64;
  for(let i=0;i<64;i++){
    const hgt=mx?bins[i]/mx*(H-8):0;
    c.fillStyle=i===63?(st.getPropertyValue('--fail').trim()||'#f55'):i===0?(st.getPropertyValue('--optic').trim()||'#3fc1c9'):(st.getPropertyValue('--mute').trim()||'#889');
    c.fillRect(i*bw+.5,H-hgt,bw-1,hgt);
  }
}
setInterval(()=>{if(!fd||document.hidden||document.body.dataset.tab==='setup')return;paintSensor();},110);
function defPos(x){const O=app.E.O;return[(x.G.x/O.fovW+.5)*ov.width,(x.G.y/O.fovH+.5)*ov.height];}
function drawOverlay(){
  const dpr=Math.min(window.devicePixelRatio||1,2),W=Math.round(box.clientWidth*dpr),H=Math.round(box.clientHeight*dpr);
  if(ov.width!==W||ov.height!==H){ov.width=W;ov.height=H;}
  const c=ovCtx;c.clearRect(0,0,W,H);if(!app.E)return;
  const O=app.E.O,k=W/O.fovW,st=getComputedStyle(document.documentElement);
  const colV={pass:st.getPropertyValue('--pass'),marginal:st.getPropertyValue('--warn'),miss:st.getPropertyValue('--fail')},optic=st.getPropertyValue('--optic').trim()||'#3fc1c9';
  c.font=`${12*dpr}px Barlow, sans-serif`;c.textBaseline='middle';
  if($('#overlayTog').checked){
    const boxes=[];
    app.E.defs.forEach((x,i)=>{
      if(x.G.feat===null)return;
      const[px,py]=defPos(x);
      const size=Math.max(x.G.w,x.D.round?x.G.w:x.G.l)*k;
      const r=Math.max(11*dpr,size*.62+5*dpr);
      const col=showVerdicts()?colV[x.verdict].trim():optic;
      c.strokeStyle=col;c.lineWidth=(app.sel===i?2.6:1.5)*dpr;c.setLineDash(app.sel===i?[]:[5*dpr,4*dpr]);
      c.beginPath();c.arc(px,py,r,0,6.2832);c.stroke();c.setLineDash([]);
      const label=x.D.name+(showVerdicts()?` ${x.verdict==='pass'?'found':x.verdict==='marginal'?'unreliable':'missed'}`:'');
      const tw=c.measureText(label).width+10*dpr,lx=clamp(px-tw/2,2,W-tw-2);let ly=py+r+11*dpr>H-4?py-r-11*dpr:py+r+11*dpr;
      for(let g=0;g<6;g++){const hit=boxes.find(b=>lx<b[0]+b[2]&&lx+tw>b[0]&&Math.abs(ly-b[1])<18*dpr);if(!hit)break;ly=hit[1]+(ly>=hit[1]?19:-19)*dpr;}
      ly=clamp(ly,10*dpr,H-10*dpr);boxes.push([lx,ly,tw]);
      c.fillStyle='rgba(8,12,18,.72)';c.fillRect(lx,ly-9*dpr,tw,18*dpr);c.fillStyle=col;c.fillText(label,lx+5*dpr,ly);
    });
  }
  // scale bar
  const target=O.fovW*.2,nice=[.1,.2,.5,1,2,5,10,20,50,100,200,500].reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a);
  const bw=nice*k,bx=12*dpr,by=H-14*dpr;
  c.fillStyle='rgba(8,12,18,.6)';c.fillRect(bx-6*dpr,by-16*dpr,bw+12*dpr+c.measureText(`${nice} mm`).width+8*dpr,26*dpr);
  c.fillStyle='#fff';c.fillRect(bx,by-2*dpr,bw,4*dpr);c.fillText(`${nice} mm`,bx+bw+8*dpr,by);
  if(app.armed&&hover){c.strokeStyle=optic;c.lineWidth=1*dpr;c.beginPath();c.moveTo(hover.px-14*dpr,hover.py);c.lineTo(hover.px+14*dpr,hover.py);c.moveTo(hover.px,hover.py-14*dpr);c.lineTo(hover.px,hover.py+14*dpr);c.stroke();}
}
function evtMm(e){
  const rc=box.getBoundingClientRect(),O=app.E.O;
  const fx=(e.clientX-rc.left)/rc.width,fy=(e.clientY-rc.top)/rc.height;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  return{x:(fx-.5)*O.fovW,y:(fy-.5)*O.fovH,px:fx*ov.width,py:fy*ov.height,cx:e.clientX-rc.left,cy:e.clientY-rc.top,rw:rc.width,rh:rc.height,dpr};
}
function nearestDef(p){
  let bi=-1,bd=1e9;app.E.defs.forEach((x,i)=>{if(x.G.feat===null)return;const[px,py]=defPos(x);const d=Math.hypot(px-p.px,py-p.py);if(d<bd){bd=d;bi=i;}});
  return bd<26*p.dpr?bi:-1;
}
const loupeEl=$('#loupe'),lCv=$('#loupeCv'),lCtx=lCv.getContext('2d');let lq=0;
function updLoupe(p){
  if(!$('#loupeTog').checked||!p){loupeEl.classList.add('hide');return;}
  loupeEl.classList.remove('hide');
  const sz=150,off=18;
  let lx=p.cx+off,ly=p.cy-sz-off;if(lx+sz>p.rw)lx=p.cx-sz-off;if(ly<0)ly=p.cy+off;
  loupeEl.style.left=lx+'px';loupeEl.style.top=ly+'px';
  if(lq)return;
  lq=requestAnimationFrame(()=>{lq=0;const n=36;const img=Sensor.loupe(app.S,app.E,p.x,p.y,n);const out=new ImageData(n,n);Sensor.addNoise(img,out,app.E,app.S,performance.now()/1000);
    if(lCv.width!==n){lCv.width=n;lCv.height=n;}lCtx.putImageData(out,0,0);
    $('#loupeTxt').textContent=`${n} px = ${fmt(app.E.O.mmpp*n)} mm`;});
}
box.addEventListener('pointermove',e=>{
  if(!app.E)return;const p=evtMm(e);hover=p;
  if(drag){const P=PARTS[app.S.part],d=app.S.defects[drag.i];d.u=clamp(p.x/P.w+.5,0,1);d.v=clamp(p.y/P.h+.5,0,1);changed({fast:true});}
  else box.style.cursor=app.armed?'crosshair':nearestDef(p)>=0?(app.mode==='free'?'grab':'pointer'):'crosshair';
  updLoupe(p);drawOverlay();
});
box.addEventListener('pointerleave',()=>{hover=null;updLoupe(null);drawOverlay();});
box.addEventListener('pointerdown',e=>{
  if(!app.E)return;const p=evtMm(e),P=PARTS[app.S.part];
  if(app.armed){placeAt(clamp(p.x/P.w+.5,0,1),clamp(p.y/P.h+.5,0,1));return;}
  const i=nearestDef(p);
  if(i>=0){app.sel=i;secDef.open=true;renderDefList();if(app.mode==='free'&&DEFS[app.S.defects[i].type].kind!=='feature'){drag={i};box.setPointerCapture(e.pointerId);}drawOverlay();}
});
box.addEventListener('pointerup',()=>{drag=null;});
$('#overlayTog').addEventListener('change',()=>{drawOverlay();if(benchOK)Bench.refreshMarkers();});
$('#loupeTog').addEventListener('change',()=>updLoupe(null));
$('#clipTog').addEventListener('change',paintSensor);
new ResizeObserver(()=>drawOverlay()).observe(box);

/* ---------- live panel ---------- */
function renderLive(){
  const S=app.S,E=app.E,el=$('#live');el.replaceChildren();
  // cost
  const cost=$('#cost');cost.replaceChildren();
  const over=E.cost>S.budget;
  cost.append(h('div',{class:'row'},h('span',{class:'grow'},'System cost'),h('b',{style:{color:over?'var(--fail)':''}},`${money(E.cost)} of ${money(S.budget)}`)),
    h('div',{class:'bar'+(over?' over':'')},h('i',{style:{width:`${clamp(E.cost/S.budget*100,2,100)}%`}})));
  const issues=E.issues;
  if(app.mode==='free'){
    el.append(h('div',{class:'scorebig'},h('b',null,E.score),starsEl(E.stars),h('span',{class:'hint'},'Live grade')));
    el.append(defTable(E));
  }else if(app.captured&&!app.changed){
    el.append(h('div',{class:'scorebig'},h('b',null,app.captured.score),starsEl(app.captured.stars),h('span',{class:'hint'},'Last capture')));
    el.append(defTable(app.captured));
  }else{
    el.append(h('h3',null,'Grade hidden until you capture'),h('p',{class:'hint'},'Look at the camera image and the loupe. When you think every defect stands out from the surface, capture and grade it.'));
    if(app.captured)el.append(h('p',{class:'hint'},`Last capture scored ${app.captured.score}. You have changed the setup since.`));
  }
  el.append(h('h3',null,'Setup checks'));
  if(!issues.length)el.append(h('p',{class:'empty'},'No hardware problems found.'));
  else el.append(h('ul',{class:'issues'},issues.map(i=>h('li',{class:i.sev},i.text))));
}
function defTable(E){
  return h('div',{class:'scroll-x'},h('table',{class:'t'},h('thead',null,h('tr',null,h('th',null,'Defect'),h('th',{class:'num'},'Pixels'),h('th',{class:'num'},'Contrast to noise'),h('th',null,'Result'))),
    h('tbody',null,E.defs.map(x=>h('tr',null,h('td',null,x.D.name),h('td',{class:'num'},x.G.feat===null?'n/a':fmt(x.wpx)),h('td',{class:'num'},fmt(x.cnr)),h('td',null,h('span',{class:'tag-v '+x.verdict},x.verdict==='pass'?'Found':x.verdict==='marginal'?'Unreliable':'Missed')))))));
}

/* ---------- capture ---------- */
function flashAll(){for(const f of[$('#flashS'),$('#flash3d')]){f.classList.remove('go');void f.offsetWidth;f.classList.add('go');}if(benchOK)Bench.flash();}
function capture(){
  flashAll();
  const E=evaluate(app.S);
  app.captured=E;app.changed=false;
  let improved=false,prevStars=0;
  if(app.mode==='job'){
    const id=job().id;prevStars=store.stars[id]||0;
    if(E.score>(store.best[id]||0))store.best[id]=E.score;
    if(E.stars>prevStars){store.stars[id]=E.stars;improved=true;if(app.revealed)store.assisted[id]=true;}
    save();
  }
  renderLive();renderHeader();renderDefList();drawOverlay();if(benchOK)Bench.refreshMarkers();
  setTimeout(()=>showResult(E,improved,prevStars),380);
}

/* ---------- modals ---------- */
const mroot=$('#modalRoot');let lastFocus=null;
function closeModal(){mroot.replaceChildren();if(lastFocus&&lastFocus.focus)lastFocus.focus();}
function modal(content,opts){
  lastFocus=document.activeElement;
  const m=h('div',{class:'modal'+(opts&&opts.wide?' wide':'')+(opts&&opts.cls?' '+opts.cls:''),role:'dialog','aria-modal':'true'},content);
  const scrim=h('div',{class:'scrim',onclick:e=>{if(e.target===scrim&&!(opts&&opts.sticky))closeModal();}},m);
  mroot.replaceChildren(scrim);
  setTimeout(()=>{const f=m.querySelector('[data-focus]')||m.querySelector('button');if(f)f.focus();},30);
  return m;
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mroot.firstChild){if(!mroot.querySelector('.home')||app.S)closeModal();}});

function gauge(score){
  const r=64,c=2*Math.PI*r;
  const col=score>=85?'var(--pass)':score>=40?'var(--warn)':'var(--fail)';
  const g=h('div',{class:'gauge',html:`<svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="12"/><circle class="arc" cx="75" cy="75" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" style="transition:stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)"/></svg><b>0</b>`});
  requestAnimationFrame(()=>requestAnimationFrame(()=>{g.querySelector('.arc').style.strokeDashoffset=c*(1-score/100);}));
  const b=g.querySelector('b'),t0=performance.now();
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  (function step(t){const k=reduce?1:clamp((t-t0)/900,0,1);b.textContent=Math.round(score*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(step);})(t0);
  return g;
}
const VERDICT=['Not detectable yet','Needs rework','Good enough to quote','Ready for the line'];
function feedback(E){
  const worst=E.defs.slice().sort((a,b)=>a.score-b.score)[0];
  const fail=E.issues.find(i=>i.sev==='fail');
  if(fail)return fail.text;
  if(worst&&worst.score<75){
    const why=worst.wpx<1?`it covers only ${fmt(worst.wpx)} px, so more resolution would help`:worst.cnr<3?`its contrast is buried in noise and surface texture (contrast to noise ${fmt(worst.cnr)})`:`its contrast is borderline (contrast to noise ${fmt(worst.cnr)})`;
    return `The ${worst.D.name.toLowerCase()} is the weak spot: ${why}.`;
  }
  const warn=E.issues.find(i=>i.sev==='warn');
  if(warn)return warn.text;
  return 'Every defect stands out clearly and the hardware fits the line and the budget.';
}
function showResult(E,improved,prev){
  const i=jobIndex(),isJob=app.mode==='job';
  const next=isJob&&i<CHALLENGES.length-1?CHALLENGES[i+1]:null;
  const foot=h('div',{class:'mfoot'},
    h('button',{class:'btn',onclick:()=>{closeModal();openExpert();}},'Show expert setup'),
    h('button',{class:'btn'+(next&&E.stars>=1?'':' primary'),'data-focus':true,onclick:closeModal},'Keep tuning'),
    next&&E.stars>=1?h('button',{class:'btn primary',onclick:()=>{closeModal();startJob(next);}},'Next job'):null);
  const note=isJob?(improved?h('p',{class:'hint'},prev?`New best: up from ${prev} star${prev>1?'s':''}.`:'Stars saved in this browser.'):h('p',{class:'hint'},`Your best on this job: ${store.best[job().id]||E.score} points.`)):null;
  modal([
    h('div',{class:'mhead'},h('div',{class:'grow'},h('h2',null,isJob?`${job().title}: graded`:'Capture graded'),h('p',null,isJob?job().client:'Free bench')),h('button',{class:'iconbtn','aria-label':'Close',onclick:closeModal,html:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'})),
    h('div',{class:'mbody'},
      h('div',{class:'result-top'},gauge(E.score),h('div',{class:'verdict'},starsEl(E.stars,true),h('h3',null,VERDICT[E.stars]),h('p',null,feedback(E)),note)),
      defTable(E),
      E.issues.length?h('div',null,h('h3',{style:{fontSize:'15px',marginBottom:'8px'}},'Setup checks'),h('ul',{class:'issues'},E.issues.map(x=>h('li',{class:x.sev},x.text)))):null,
      h('p',{class:'hint'},'Three stars need a score of 85, two need 65, one needs 40. Defects are found at a contrast-to-noise ratio of about 8, with enough pixels across them.')),
    foot]);
}

function setupChips(S,E){
  const O=E.O,out=[`${LIGHTS[S.tech].name}${S.tech==='bar'?` at ${S.barAngle}°`:''}, ${S.lsize} mm`,LCOL[S.lcolor].name+' LED'];
  if(S.filter!=='none')out.push(FILT[S.filter].name);if(S.pol)out.push('Polarizers');if(S.shroud)out.push('Shroud');if(S.strobe)out.push('Strobe');
  out.push(`${O.cam.name} ${O.cam.sensor} ${S.colorCam?'color':'mono'}`,`${O.lens.name}${O.lens.tele?'':` at ${S.wd} mm, f/${O.N}`}`,`${fmt(S.expo)} ms, ${fmt(S.gain)} dB`,money(E.cost));
  return out;
}
function diffs(a,b){
  const out=[],name=(k,S)=>({tech:LIGHTS[S.tech].name,lcolor:LCOL[S.lcolor].name,filter:FILT[S.filter].name,cam:`${CAM[S.cam].name} camera`,lens:`${LENS[S.lens].name} lens`,colorCam:S.colorCam?'color sensor':'mono sensor'}[k]);
  for(const k of['tech','lcolor','filter','cam','colorCam','lens'])if(a[k]!==b[k])out.push(`${name(k,a)} instead of ${name(k,b)}`);
  if(a.pol!==b.pol)out.push(a.pol?'Add polarizers':'No polarizers needed');
  if(a.shroud!==b.shroud)out.push(a.shroud?'Add a shroud':'No shroud needed');
  if(a.strobe!==b.strobe)out.push(a.strobe?'Strobe the light':'No strobe needed');
  if(Math.abs(a.wd-b.wd)>10&&!LENS[a.lens].tele)out.push(`Working distance ${a.wd} mm instead of ${b.wd} mm`);
  if(a.N!==b.N&&!LENS[a.lens].tele)out.push(`f/${a.N} instead of f/${b.N}`);
  if(a.tech==='bar'&&b.tech==='bar'&&a.barAngle!==b.barAngle)out.push(`Bar angle ${a.barAngle}° instead of ${b.barAngle}°`);
  return out;
}
function openExpert(){
  if(app.mode==='job'&&!app.revealed&&!(store.assisted[job().id])){
    modal([h('div',{class:'mhead'},h('div',{class:'grow'},h('h2',null,'See the expert setup?'),h('p',null,'Stars you earn after this are marked as assisted. Stars you already have stay as they are.'))),
      h('div',{class:'mfoot'},h('button',{class:'btn','data-focus':true,onclick:closeModal},'Keep trying'),h('button',{class:'btn primary',onclick:()=>{app.revealed=true;openExpert();}},'Show it'))]);
    return;
  }
  const m=modal([h('div',{class:'mhead'},h('div',{class:'grow'},h('h2',null,'Expert setup'),h('p',null,'Working it out: every light, color, camera and lens combination'))),h('div',{class:'mbody',style:{placeItems:'center',minHeight:'200px'}},h('div',{class:'spinner'}))],{wide:true});
  setTimeout(()=>{
    const base={...app.S};
    const sol=solve(base);
    if(!sol.best){m.querySelector('.mbody').replaceChildren(h('p',null,'No setup could be scored for this job. Add at least one defect.'));return;}
    const B=sol.best,items=explain(sol,base);
    const techRows=Object.values(sol.perTech).sort((a,b)=>b.E.score-a.E.score);
    const cmp=h('div',{class:'cmp'},techRows.map((c,i)=>h('div',{class:'r'+(c.S.tech===B.S.tech?' best':'')},h('span',null,LIGHTS[c.S.tech].name,h('br'),h('small',null,LCOL[c.S.lcolor].short+(c.S.pol?', polarized':''))),h('div',{class:'bar'},h('i',{style:{width:`${Math.max(2,c.E.score)}%`}})),h('b',{style:{textAlign:'right'}},c.E.score))));
    const perD=h('table',{class:'t'},h('tbody',null,sol.perDefect.map(p=>h('tr',null,h('td',null,DEFS[p.d.type].name),h('td',null,p.tech?`${LIGHTS[p.tech].name}, ${LCOL[p.lcolor].short}`:'n/a'),h('td',{class:'num'},Math.round(p.score))))));
    const my=diffs(B.S,app.S);
    const right=h('div',{style:{display:'grid',gap:'14px',alignContent:'start'}},
      h('div',{class:'box'},h('h4',null,'Lighting techniques compared'),h('p',{class:'hint'},'Each technique with its best LED color, judged on the light alone before the camera and lens are tuned. The final pick can differ once optics are matched.'),cmp),
      h('div',{class:'box'},h('h4',null,'Best light for each defect'),perD),
      sol.second?h('div',{class:'box'},h('h4',null,'A second image would help'),h('p',{class:'hint',style:{color:'var(--ink2)'}},`No single setup catches everything well here. Many cells add a second shot: ${LIGHTS[sol.second.S.tech].name.toLowerCase()} with ${LCOL[sol.second.S.lcolor].name.toLowerCase()} light picks up the ${sol.second.defects.map(d=>DEFS[d.type].name.toLowerCase()).join(' and ')} (score ${Math.round(sol.second.score)}).`)):null,
      h('div',{class:'box'},h('h4',null,'Your setup compared'),my.length?h('ul',{class:'delta'},my.map(t=>h('li',null,t))):h('p',{class:'hint'},'Your main hardware already matches.')),
      h('div',{class:'box'},h('h4',null,'Cost breakdown'),h('table',{class:'t'},h('tbody',null,costParts(B.S).map(([k,v])=>h('tr',null,h('td',null,k),h('td',{class:'num'},money(v)))),h('tr',null,h('td',null,h('b',null,'Total')),h('td',{class:'num'},h('b',null,money(B.E.cost))))))));
    m.replaceChildren(
      h('div',{class:'mhead'},h('div',{class:'grow'},h('h2',null,'Expert setup'),h('p',null,`Scores ${B.E.score} on this job`),h('div',{style:{marginTop:'6px'}},starsEl(B.E.stars))),h('button',{class:'iconbtn','aria-label':'Close',onclick:closeModal,html:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'})),
      h('div',{class:'mbody'},h('div',{class:'xsum'},setupChips(B.S,B.E).map(t=>h('span',null,t))),
        h('div',{class:'xgrid'},h('div',{class:'why'},items.map(it=>h('div',null,h('h4',null,it.h),h('p',null,it.p)))),right)),
      h('div',{class:'mfoot'},h('button',{class:'btn',onclick:closeModal},'Close'),h('button',{class:'btn primary','data-focus':true,onclick:()=>{for(const k of OPT_KEYS)app.S[k]=B.S[k];closeModal();changed();toast('Expert setup loaded. Capture to see the grade.');}},'Load expert setup')));
  },40);
}

/* ---------- setup spec ---------- */
function specText(){
  const S=app.S,E=app.E,O=E.O,P=PARTS[S.part];
  const L=[`Vision Bench setup: ${app.mode==='job'?job().title+' ('+job().client+')':'free bench'}`,'',
   `Part: ${P.name}, ${P.w}x${P.h} mm, ${MATS[S.material].name.toLowerCase()}`,
   `Line: ${S.speed>0?S.speed+' mm/s continuous':'indexed'}, ${S.ppm} parts/min, height variation ${fmt(S.depth)} mm`,'',
   `Lighting: ${LIGHTS[S.tech].name}${S.tech==='bar'?' at '+S.barAngle+' deg':''}, ${S.lsize} mm, ${LCOL[S.lcolor].name}, ${S.intensity}% intensity`,
   `Filter: ${FILT[S.filter].name}${S.pol?' + crossed polarizers':''}${S.shroud?' + shroud':''}${S.strobe?' + strobe':''}`,
   `Camera: ${O.cam.name}, ${O.cam.sensor}, ${S.colorCam?'color':'mono'}, ${O.cam.px[0]}x${O.cam.px[1]} px, ${O.cam.fps} fps`,
   `Lens: ${O.lens.name}${O.lens.tele?'':', f/'+O.N+' at '+S.wd+' mm working distance'}${S.spacer?', spacer ring':''}`,
   `Exposure: ${fmt(S.expo)} ms, gain ${fmt(S.gain)} dB`,'',
   `Field of view: ${fmt(O.fovW)} x ${fmt(O.fovH)} mm`,
   `Resolution: ${fmt(O.mmpp)} mm per pixel`,
   `Depth of field: ${fmt(O.dof)} mm`,
   S.speed>0?`Motion blur: ${fmt(O.motionPx)} px`:null,
   `Estimated hardware cost: ${money(E.cost)}`,'',
   'Defects checked:',
   ...E.defs.map(x=>`  - ${x.D.name}: ${fmt(x.wpx)} px across, contrast to noise ${fmt(x.cnr)}, ${x.verdict==='pass'?'found':x.verdict==='marginal'?'unreliable':'missed'}`),
   E.issues.length?'':null,...(E.issues.length?['Notes:',...E.issues.map(i=>'  - '+i.text)]:[])].filter(x=>x!==null);
  return L.join('\n');
}
async function copySpec(){
  const t=specText();
  try{await navigator.clipboard.writeText(t);toast('Setup spec copied to the clipboard');}
  catch(e){
    const ta=h('textarea',{style:{position:'fixed',opacity:'0'}});ta.value=t;document.body.append(ta);ta.select();
    try{document.execCommand('copy');toast('Setup spec copied to the clipboard');}catch(e2){toast('Copying is blocked here; the spec is in the console');console.log(t);}
    ta.remove();
  }
}

/* ---------- help and shortcuts ---------- */
const KEYS=[['C','Capture and grade'],['X','Show the expert setup'],['J','Open the job board'],['1 to 6','Switch lighting technique'],['V','Cycle bench, top and side views'],['A','Auto exposure'],['F','Fit the part to the image'],['M','Toggle the defect markers'],['L','Toggle the pixel loupe'],['?','This help']];
function openHelp(){
  modal([
    h('div',{class:'mhead'},h('div',{class:'grow'},h('h2',null,'How Vision Bench works'),h('p',null,'A practice bench for choosing lighting, lenses and cameras')),h('button',{class:'iconbtn','aria-label':'Close',onclick:closeModal,html:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'})),
    h('div',{class:'mbody'},
      h('div',{class:'xgrid'},
        h('div',{class:'why'},
          h('div',null,h('h4',null,'The loop'),h('p',null,'Read the job brief, choose lighting and optics on the left, watch the camera image on the right, then capture and grade. The expert setup shows what an experienced integrator would quote and why.')),
          h('div',null,h('h4',null,'Reading the image'),h('p',null,'The image is what the sensor sees: glare, surface grain, blur, noise and all. Hover it for a loupe showing real sensor pixels, and switch on Clipping to mark pixels that have gone pure white (red) or pure black (blue).')),
          h('div',null,h('h4',null,'Placing defects'),h('p',null,'In the free bench, pick a defect type and click the part in either the 3D view or the camera image. Drag a marker in the camera image to move it, and use the sliders to change its size, angle and color.')),
          h('div',null,h('h4',null,'Scoring'),h('p',null,'A defect counts as found at a contrast-to-noise ratio of roughly 8, with enough pixels across it. Three stars need 85 points, two need 65, one needs 40. Hardware problems such as poor focus, motion blur or a blown budget cost points on top.')),
          h('div',null,h('h4',null,'How accurate is it?'),h('p',null,'Optics are real formulas: field of view, depth of field, diffraction and motion blur. Lighting is a rules-based model of how each technique behaves on each surface class, so it points to the right technique but will not predict exact contrast. Check anything important on a real bench.'))),
        h('div',{style:{display:'grid',gap:'14px',alignContent:'start'}},
          h('div',{class:'box'},h('h4',null,'Keyboard shortcuts'),h('div',{class:'keys'},KEYS.flatMap(([k,t])=>[h('kbd',null,k),h('span',null,t)]))),
          h('div',{class:'box'},h('h4',null,'Saving'),h('p',{class:'hint'},'Stars, best scores and your free-bench setup live in this browser only. Sharing the link gives everyone their own progress.')),
          h('div',{class:'box'},h('h4',null,'Take the tour again'),h('button',{class:'btn',onclick:()=>{closeModal();startTour(true);}},'Replay the quick tour'))))),
    h('div',{class:'mfoot'},h('button',{class:'btn primary','data-focus':true,onclick:closeModal},'Back to the bench'))],{wide:true});
}

/* ---------- first-run tour ---------- */
const TOUR=[
  {sel:'#stage3d',title:'The bench',text:'The camera, lens and light are shown as they would sit on the line, with the field of view drawn on the part. Drag to orbit, scroll to zoom.'},
  {sel:'#sensorBox',title:'What the camera sees',text:'This is the simulated image, with real glare, blur and noise. Hover it to open a loupe showing true sensor pixels.'},
  {sel:'#secLight .seg',title:'Choose the lighting',text:'Technique first, then color, size and angle. Watch the camera image change as you switch: this is where most inspections are won or lost.'},
  {sel:'#secOpt',title:'Camera and lens',text:'Set the working distance, aperture and sensor. The readout tells you the field of view, millimetres per pixel and depth of field.'},
  {sel:'#captureBtn',title:'Capture and grade',text:'When every defect stands out, capture. You get stars, a per-defect result, and the expert setup with the reasoning behind it.'},
];
let tourI=0,tourEls=null;
function endTour(){
  if(tourEls){tourEls.wrap.remove();tourEls.card.remove();document.querySelectorAll('.coach-on').forEach(e=>e.classList.remove('coach-on'));tourEls=null;}
  store.toured=true;save();
}
function tourStep(i){
  const st=TOUR[i];if(!st){endTour();return;}
  document.querySelectorAll('.coach-on').forEach(e=>e.classList.remove('coach-on'));
  const el=document.querySelector(st.sel);
  if(!el){tourStep(i+1);return;}
  if(document.body.dataset.tab){const col=el.closest('.benchcol')?'bench':el.closest('.inspect')?'image':'setup';setTab(col);}
  el.scrollIntoView({block:'center',behavior:'smooth'});
  el.classList.add('coach-on');
  const r=el.getBoundingClientRect(),card=tourEls.card;
  card.replaceChildren(
    h('h4',null,st.title),h('p',null,st.text),
    h('div',{class:'cfoot'},h('div',{class:'dots'},TOUR.map((_,k)=>h('i',{class:k===i?'on':''}))),
      h('button',{class:'btn ghost',onclick:endTour},'Skip'),
      h('button',{class:'btn primary','data-focus':true,onclick:()=>{tourI++;tourStep(tourI);}},i===TOUR.length-1?'Start':'Next')));
  const cw=Math.min(320,window.innerWidth-24),ch=card.offsetHeight||150;
  let left=clamp(r.left+r.width/2-cw/2,12,window.innerWidth-cw-12);
  let top=r.bottom+14;if(top+ch>window.innerHeight-12)top=Math.max(12,r.top-ch-14);
  card.style.left=left+'px';card.style.top=top+'px';
  card.querySelector('.primary').focus();
}
function startTour(force){
  if(!force&&store.toured)return;
  if(tourEls)endTour();
  const wrap=h('div',{class:'coachwrap',onclick:endTour}),card=h('div',{class:'coachcard',role:'dialog'});
  document.body.append(wrap,card);tourEls={wrap,card};tourI=0;tourStep(0);
}

/* ---------- home / job board ---------- */
let heroTimer=0;
function openHome(){
  const S=app.S;
  const hero=h('div',{class:'hero'},
    h('div',null,h('h2',null,'Can your camera see the defect?'),
      h('p',null,'Pick the light, lens and camera for real inspection jobs, place defects anywhere on the part, and check what the sensor actually captures. Every job ends with the setup an experienced vision engineer would quote, and why it works.'),
      h('div',{class:'cta'},h('button',{class:'btn primary big','data-focus':true,onclick:()=>{closeModal();const c=CHALLENGES.find((c,i)=>unlocked(i)&&!(store.stars[c.id]>=3))||CHALLENGES[0];startJob(c);}},totalStars()?'Continue jobs':'Start the first job'),
        h('button',{class:'btn big',onclick:()=>{closeModal();startFree();}},'Open the free bench'))),
    h('div',{class:'hero-art'},h('canvas',{id:'heroCv'}),h('span',{class:'tag',id:'heroTag'})));
  const n=totalStars();
  const ua=h('input',{type:'checkbox'});ua.checked=!!store.unlockAll;
  ua.addEventListener('change',()=>{store.unlockAll=ua.checked;save();closeModal();openHome();});
  const head=h('div',{class:'jobs-head'},h('h3',null,'Customer jobs'),h('span',{class:'rank'},starsEl(1),h('b',null,`${n}/${CHALLENGES.length*3}`),rankName(n)),tog('Open all jobs',null,ua));
  const jobs=h('div',{class:'jobs'},CHALLENGES.map((c,i)=>{
    const ok=unlocked(i),st=store.stars[c.id]||0;
    return h('button',{class:'job',disabled:ok?null:true,onclick:()=>{closeModal();startJob(c);}},
      ok?null:h('span',{html:LOCK,style:{display:'contents'}}),
      h('span',{class:'n'},`Job ${i+1}`),h('h4',null,c.title),h('span',{class:'cl'},`${c.client}, ${c.industry.toLowerCase()}`),
      h('span',{class:'jf'},starsEl(st),h('span',{class:'diff','aria-label':`Difficulty ${DIFF[c.id]} of 5`},[1,2,3,4,5].map(k=>h('i',{class:k<=DIFF[c.id]?'on':''})))),
      store.assisted[c.id]?h('span',{class:'assist'},'Assisted'):null,
      ok?null:h('span',{class:'hint'},'Earn a star on the previous job to open'));
  }));
  const foot=h('p',{class:'hint',style:{padding:'0 28px 22px'}},'Progress is saved in this browser only. Share the link and everyone keeps their own score.');
  modal([hero,head,jobs,foot],{cls:'home',sticky:!S});
  startHero();
}
function startHero(){
  clearInterval(heroTimer);
  const cv=$('#heroCv');if(!cv)return;
  const c=CHALLENGES[1];const base=jobState(c);
  Object.assign(base,{cam:'imx264',lens:'f25',N:4});base.wd=fitWd(base);
  const shots=[['ring','white','Ring light: the scratches hide inside the glare'],['coax','white','Coaxial light: tilted surfaces turn dark'],['darkfield','white','Dark field: scratches and dents glow'],['dome','white','Dome: diffuse light hides the damage']].map(([t,l,txt])=>{
    const S={...base,tech:t,lcolor:l};S.lsize=pickSize(t,PARTS[S.part]);S.wd=Math.max(S.wd,lightClearance(S));S.ambient='low';autoExpose(S);const E=evaluate(S);return{S,E,f:Sensor.frame(S,E,640),txt};});
  let k=0,t=0;const ctx=cv.getContext('2d');let out=null;
  const show=()=>{const s=shots[k];cv.width=s.f.rw;cv.height=s.f.rh;out=new ImageData(s.f.rw,s.f.rh);const tag=$('#heroTag');if(tag)tag.textContent=s.txt;};
  show();
  heroTimer=setInterval(()=>{if(!document.body.contains(cv)){clearInterval(heroTimer);return;}t++;if(t%28===0){k=(k+1)%shots.length;show();}const s=shots[k];Sensor.addNoise(s.f.img,out,s.E,s.S,t/10);ctx.putImageData(out,0,0);},100);
}

/* ---------- modes ---------- */
function startJob(c){
  app.mode='job';app.job=c;app.S=jobState(c);app.sel=-1;app.captured=null;app.changed=true;app.revealed=false;arm(null);
  store.lastJob=c.id;store.lastMode='job';save();
  renderBrief();if(benchOK)Bench.frame('iso');changed();
  setTimeout(()=>{if(!mroot.firstChild)startTour();},700);
}
function startFree(){
  app.mode='free';app.S=store.free&&store.free.defects?store.free:freeState();
  app.S.defects.forEach(d=>{d.id=uid++;});
  app.sel=-1;app.captured=null;app.changed=true;app.revealed=false;arm(null);
  store.lastMode='free';save();
  renderBrief();if(benchOK)Bench.frame('iso');changed();
  setTimeout(()=>{if(!mroot.firstChild)startTour();},700);
}
function resetSetup(){
  if(app.mode==='job'){const d=app.S.defects;app.S=jobState(job());app.S.defects=d;}
  else{Object.assign(app.S,SETUP);app.S.lsize=pickSize('ring',PARTS[app.S.part]);}
  changed();toast('Hardware reset');
}

/* ---------- boot ---------- */
if(store.theme)document.documentElement.dataset.theme=store.theme;
$('#themeBtn').addEventListener('click',()=>{
  const cur=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  const nx=cur==='dark'?'light':'dark';document.documentElement.dataset.theme=nx;store.theme=nx;save();
  if(benchOK){Bench.theme();Bench.update(app.S,app.E);}drawOverlay();
});
$('#homeBtn').addEventListener('click',openHome);
$('#helpBtn').addEventListener('click',openHelp);
$('#copyBtn').addEventListener('click',copySpec);
function setTab(t){document.body.dataset.tab=t;$('#tabbar').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===t)));if(t!=='setup')setTimeout(()=>{drawOverlay();},60);}
$('#tabbar').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
setTab('bench');
document.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  if(e.key==='?'||(e.key==='/'&&e.shiftKey)){e.preventDefault();openHelp();return;}
  if(mroot.firstChild||tourEls)return;
  const k=e.key.toLowerCase();
  const tech=Object.keys(LIGHTS);
  if(k>='1'&&k<='6'){const n=tech[+k-1];if(n){const S=app.S;S.tech=n;S.lsize=pickSize(n,PARTS[S.part]);S.wd=Math.max(S.wd,lightClearance(S));if(n==='back')S.pol=false;changed();}return;}
  if(k==='c'){capture();e.preventDefault();}
  else if(k==='x')openExpert();
  else if(k==='j')openHome();
  else if(k==='v'&&benchOK){const order=['iso','top','side'];app._v=((app._v||0)+1)%3;Bench.frame(order[app._v]);}
  else if(k==='a'){autoExpose(app.S);changed();toast('Exposure set for the brightest surface');}
  else if(k==='f'){app.S.wd=fitWd(app.S);changed();}
  else if(k==='m'){const c=$('#overlayTog');c.checked=!c.checked;c.dispatchEvent(new Event('change'));}
  else if(k==='l'){const c=$('#loupeTog');c.checked=!c.checked;c.dispatchEvent(new Event('change'));}
});
$('#captureBtn').addEventListener('click',capture);
$('#expertBtn').addEventListener('click',openExpert);
$('#resetBtn').addEventListener('click',resetSetup);
$('#viewIso').addEventListener('click',()=>benchOK&&Bench.frame('iso'));
$('#viewTop').addEventListener('click',()=>benchOK&&Bench.frame('top'));
$('#viewSide').addEventListener('click',()=>benchOK&&Bench.frame('side'));
$('#beamsTog').addEventListener('change',e=>benchOK&&Bench.setBeams(e.target.checked));
$('#runTog').addEventListener('change',e=>benchOK&&Bench.setRun(e.target.checked));

buildControls();
let benchOK=false;
try{
  benchOK=Bench.init($('#stage3d'),{
    onPick:(u,v)=>{if(app.armed)placeAt(u,v);},
    markerColor:(i,x)=>{const st=getComputedStyle(document.documentElement);if(showVerdicts()&&x)return(st.getPropertyValue(x.verdict==='pass'?'--pass':x.verdict==='marginal'?'--warn':'--fail').trim()||'#3fc1c9');return st.getPropertyValue('--optic').trim()||'#3fc1c9';},
    showMarkers:()=>$('#overlayTog').checked,
  });
}catch(e){console.error(e);benchOK=false;}
if(!benchOK){const m=$('#stageMsg');m.textContent='The 3D bench needs WebGL, which this browser has turned off. The camera image and grading still work.';m.classList.remove('hide');}
const lastC=CHALLENGES.find(c=>c.id===store.lastJob);
if(store.lastMode==='free')startFree();else startJob(lastC&&unlocked(CHALLENGES.indexOf(lastC))?lastC:CHALLENGES[0]);
openHome();
window.visionBench={app,startJob,startFree,openExpert,capture,changed,closeModal,startTour,openHelp,store,Bench:()=>benchOK&&Bench};
})();
