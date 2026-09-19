/* ================= 3D bench (three.js r128) ================= */
const Bench=(()=>{
  let T,R,scene,cam,host,envTex,partG,rigG,markG,pickMesh,beltTex,beltMesh,backPanel;
  const ob={th:.78,ph:1.02,r:700,tgt:null,goal:null};
  let lost=false;
  let S=null,E=null,cb={},beams=true,run=true,partX=0,lastT=0,flashT=0,topY=0,cartonH=0,lightMats=[],beamMats=[],sceneLights=[],markers=[];
  let armed=false,down=null,triggerCool=0;

  function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()||'#101722';}
  function disposeTree(o){o.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material){(Array.isArray(c.material)?c.material:[c.material]).forEach(m=>{if(m.map)m.map.dispose();m.dispose();});}});}
  function mat(o){return new T.MeshStandardMaterial(Object.assign({envMap:envTex,envMapIntensity:1},o));}

  function makeEnv(){
    const es=new T.Scene();
    const cv=document.createElement('canvas');cv.width=16;cv.height=256;const c=cv.getContext('2d');
    const g=c.createLinearGradient(0,0,0,256);g.addColorStop(0,'#ffffff');g.addColorStop(.45,'#9aa6b6');g.addColorStop(.55,'#4a5362');g.addColorStop(1,'#15181e');
    c.fillStyle=g;c.fillRect(0,0,16,256);
    const tx=new T.CanvasTexture(cv);
    es.add(new T.Mesh(new T.SphereGeometry(100,32,16),new T.MeshBasicMaterial({map:tx,side:T.BackSide})));
    const panel=(x,y,z,w,h)=>{const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);es.add(m);};
    panel(0,80,0,70,70);panel(80,40,30,30,60);panel(-70,30,-50,40,30);
    const pm=new T.PMREMGenerator(R);envTex=pm.fromScene(es,.02).texture;pm.dispose();
  }

  function makeBelt(){
    const cv=document.createElement('canvas');cv.width=256;cv.height=256;const c=cv.getContext('2d');
    c.fillStyle='#2a2c30';c.fillRect(0,0,256,256);
    const r=mulberry32(3);
    for(let i=0;i<2500;i++){const v=36+r()*14|0;c.fillStyle=`rgb(${v},${v},${v+2})`;c.fillRect(r()*256,r()*256,1.5,1.5);}
    c.fillStyle='rgba(255,255,255,.05)';for(let x=0;x<256;x+=64)c.fillRect(x,0,2,256);
    beltTex=new T.CanvasTexture(cv);beltTex.wrapS=beltTex.wrapT=T.RepeatWrapping;beltTex.repeat.set(1600/80,200/80);beltTex.encoding=T.sRGBEncoding;
    const g=new T.Group();
    beltMesh=new T.Mesh(new T.BoxGeometry(1600,6,200),mat({map:beltTex,roughness:.85,metalness:0}));beltMesh.position.y=-3;g.add(beltMesh);
    const railM=mat({color:0x9aa3ad,metalness:.8,roughness:.35});
    for(const z of[-108,108]){const rl=new T.Mesh(new T.BoxGeometry(1620,26,14),railM);rl.position.set(0,-8,z);g.add(rl);}
    const legM=mat({color:0x59616b,metalness:.6,roughness:.5});
    for(const x of[-700,-250,250,700])for(const z of[-108,108]){const l=new T.Mesh(new T.BoxGeometry(24,300,24),legM);l.position.set(x,-170,z);g.add(l);}
    const floor=new T.Mesh(new T.PlaneGeometry(6000,6000),new T.MeshBasicMaterial({color:new T.Color(cssVar('--scene-bg'))}));
    floor.rotation.x=-Math.PI/2;floor.position.y=-320;floor.name='floor';g.add(floor);
    const grid=new T.GridHelper(6000,60,0x3a4b63,0x3a4b63);grid.position.y=-319;grid.material.transparent=true;grid.material.opacity=.25;grid.name='grid';g.add(grid);
    // post for the camera arm
    const post=new T.Mesh(new T.CylinderGeometry(12,12,2400,20),mat({color:0xb9c0c8,metalness:.85,roughness:.3}));post.position.set(-260,880,-150);g.add(post);
    const base=new T.Mesh(new T.BoxGeometry(80,20,80),legM);base.position.set(-260,-310,-150);g.add(base);
    scene.add(g);
  }

  function init(el,callbacks){
    host=el;cb=callbacks||{};T=window.THREE;
    if(!T)return false;
    try{R=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){return false;}
    R.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    R.outputEncoding=T.sRGBEncoding;R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=1.05;
    host.prepend(R.domElement);
    R.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;if(cb.onContextLost)cb.onContextLost();});
    R.domElement.addEventListener('webglcontextrestored',()=>{lost=false;if(S)update(S,E);});
    scene=new T.Scene();scene.background=new T.Color(cssVar('--scene-bg'));
    scene.fog=new T.Fog(scene.background.getHex(),2500,6000);
    cam=new T.PerspectiveCamera(34,1,2,20000);
    ob.tgt=new T.Vector3(0,120,0);ob.goal={th:ob.th,ph:ob.ph,r:ob.r,tgt:ob.tgt.clone()};
    makeEnv();
    scene.add(new T.HemisphereLight(0xe8eef8,0x283040,.55));
    const dl=new T.DirectionalLight(0xffffff,.5);dl.position.set(400,900,500);scene.add(dl);
    makeBelt();
    partG=new T.Group();rigG=new T.Group();markG=new T.Group();scene.add(partG,rigG);partG.add(markG);
    const ro=new ResizeObserver(resize);ro.observe(host);resize();
    bindPointer();
    requestAnimationFrame(loop);
    return true;
  }
  function resize(){if(!R)return;const w=host.clientWidth||600,h=host.clientHeight||400;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
  function theme(){if(!scene)return;scene.background=new T.Color(cssVar('--scene-bg'));scene.fog.color=scene.background.clone();const f=scene.getObjectByName('floor');if(f)f.material.color=new T.Color(cssVar('--scene-bg'));}

  /* ---------- pointer: orbit, zoom, click to place ---------- */
  function bindPointer(){
    const el=R.domElement;
    el.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,moved:false,th:ob.goal.th,ph:ob.goal.ph};el.setPointerCapture(e.pointerId);});
    el.addEventListener('pointermove',e=>{
      if(!down){el.style.cursor=armed&&hitPart(e)?'crosshair':'grab';return;}
      const dx=e.clientX-down.x,dy=e.clientY-down.y;
      if(Math.hypot(dx,dy)>4)down.moved=true;
      if(down.moved){ob.userMoved=true;ob.goal.th=down.th-dx*.008;ob.goal.ph=clamp(down.ph-dy*.008,.03,1.52);el.style.cursor='grabbing';}
    });
    el.addEventListener('pointerup',e=>{
      if(down&&!down.moved){const h=hitPart(e);if(h&&cb.onPick)cb.onPick(h.u,h.v);}
      down=null;
    });
    el.addEventListener('wheel',e=>{e.preventDefault();ob.userMoved=true;ob.goal.r=clamp(ob.goal.r*Math.exp(e.deltaY*.0012),60,5000);},{passive:false});
  }
  const ray=()=>new T.Raycaster();
  function hitPart(e){
    if(!pickMesh||!S)return null;
    const rc=R.domElement.getBoundingClientRect();
    const m=new T.Vector2((e.clientX-rc.left)/rc.width*2-1,-(e.clientY-rc.top)/rc.height*2+1);
    const rr=ray();rr.setFromCamera(m,cam);
    const hit=rr.intersectObject(pickMesh)[0];if(!hit)return null;
    const p=partG.worldToLocal(hit.point.clone());
    const P=PARTS[S.part];
    const x=p.x,y=p.z;
    const edgeOK=true;
    if(!inShape(P,x,y)){
      // allow a little slack outside for edge defects
      const r=P.shape==='rect'?Math.max(Math.abs(x)-P.w/2,Math.abs(y)-P.h/2):Math.hypot(x,y)-P.w/2;
      if(!(r<3&&edgeOK))return null;
    }
    return{u:clamp(x/P.w+.5,0,1),v:clamp(y/P.h+.5,0,1)};
  }

  /* ---------- part ---------- */
  function decalCanvas(P,pad){
    const W=1400,sc=W/(P.w+pad*2),H=Math.round((P.h+pad*2)*sc);
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
    c.translate(W/2,H/2);c.scale(sc,sc);
    const miss=missingSet(S);
    const px=1/sc;
    // part-level visible features
    for(const f of(P.feats||[])){
      c.strokeStyle='rgba(0,0,0,.18)';c.lineWidth=.5;
      if(f.k==='ring'){c.beginPath();c.arc(0,0,f.r,0,6.2832);c.stroke();}
      else if(f.k==='ticks'){c.lineWidth=.35;c.beginPath();for(let k=0;k<48;k++){const a=k/48*Math.PI*2;c.moveTo(Math.cos(a)*f.r,Math.sin(a)*f.r);c.lineTo(Math.cos(a)*(f.r+1.3),Math.sin(a)*(f.r+1.3));}c.stroke();}
      else if(f.k==='vent'){c.lineWidth=.7;for(let k=0;k<4;k++){c.beginPath();c.arc(0,0,3.6,k*Math.PI/2+.25,k*Math.PI/2+1.3);c.stroke();}}
      else if(f.k==='ribs'){c.lineWidth=.9;c.strokeStyle='rgba(255,255,255,.08)';c.beginPath();for(let x=-12;x<=12;x+=6){c.moveTo(x,-12);c.lineTo(x,12);}c.stroke();}
    }
    featureList(P).forEach((f,i)=>{
      if(f.kind==='comp'&&miss.has(i)){const cc=f.src;c.fillStyle='#c8a060';const pw=Math.min(cc.w*.3,1.4);c.fillRect(cc.x-cc.w/2,cc.y-cc.h/2,pw,cc.h);c.fillRect(cc.x+cc.w/2-pw,cc.y-cc.h/2,pw,cc.h);}
      if(f.kind==='print'&&!miss.has(i)){
        const b=f.src,r=mulberry32(hashStr('print'+b.x));c.fillStyle=PRINT_COLOR;c.strokeStyle=PRINT_COLOR;const x0=b.x-b.w/2,y0=b.y-b.h/2;
        if(b.bars){let x=x0;while(x<x0+b.w){const bw=.33*(1+Math.floor(r()*3));c.fillRect(x,y0,bw,b.h*.82);x+=bw+.33*(1+Math.floor(r()*3));}}
        else if(b.text){let x=x0;while(x<x0+b.w){const cw=1.3+r()*1.2;c.fillRect(x,y0,cw,b.h);x+=cw+(r()<.18?1.8:.5);}}
        else{c.lineWidth=.6;c.strokeRect(x0,y0,b.w,b.h);const n=12,cs=(b.h-2)/n;for(let yy=0;yy<n;yy++)for(let xx=0;xx<n;xx++)if(r()<.5)c.fillRect(x0+b.w-b.h+1+xx*cs,y0+1+yy*cs,cs,cs);}
      }
    });
    if(P.shape==='rect'&&S.part==='pcb'){c.strokeStyle='rgba(210,180,90,.55)';c.lineWidth=.35;c.beginPath();c.moveTo(-8,-4);c.lineTo(8,-10);c.moveTo(-8,2);c.lineTo(16,9);c.moveTo(-22,-4);c.lineTo(-30,-12);c.stroke();}
    // defects, in the colors a person would see
    const base=S.color,dark=hexRgb(base).reduce((a,b)=>a+b,0)/3<.45;
    S.defects.forEach((d,i)=>{
      const D=DEFS[d.type],G=defGeom(S,d);const w=Math.max(G.w,1.6*px),l=G.l;
      const rng=mulberry32(hashStr(d.type)+i*7919);
      c.save();
      if(D.kind==='edge'){
        const a=G.a;c.translate(a.x+(d.type==='burr'?a.nx*G.w*.45:0),a.y+(d.type==='burr'?a.ny*G.w*.45:0));c.rotate(Math.atan2(a.ny,a.nx));
        c.fillStyle=d.type==='chip'?(dark?'#6d7178':'#2a2c30'):mixHex(base,dark?'#000000':'#ffffff',.12);
        c.beginPath();c.ellipse(0,0,d.type==='chip'?G.w:G.w*.55,G.l/2,0,0,6.2832);c.fill();c.restore();return;
      }
      if(D.kind==='feature'){c.restore();return;}
      c.translate(G.x,G.y);c.rotate((d.ang||0)*Math.PI/180);
      const dc=defColor(S,d);
      if(D.shape==='line'){c.strokeStyle=mixHex(base,dark?'#ffffff':'#ffffff',.55);c.lineWidth=w;c.lineCap='round';c.beginPath();c.moveTo(-l/2,0);c.lineTo(l/2,0);c.stroke();c.strokeStyle='rgba(0,0,0,.35)';c.lineWidth=w*.4;c.beginPath();c.moveTo(-l/2,w*.5);c.lineTo(l/2,w*.5);c.stroke();}
      else if(D.shape==='crack'){c.strokeStyle=darken(base,.7);c.lineWidth=w;c.beginPath();const n=12;for(let k=0;k<=n;k++){const x=-l/2+l*k/n,y=(k&&k<n)?(rng()-.5)*l*.09:0;k?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}
      else if(D.shape==='dent'){const g=c.createRadialGradient(-G.w*.12,-G.w*.12,0,0,0,G.w/2);g.addColorStop(0,'rgba(0,0,0,.28)');g.addColorStop(.7,'rgba(255,255,255,.18)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.beginPath();c.arc(0,0,G.w/2,0,6.2832);c.fill();}
      else if(D.shape==='blob'){c.fillStyle=D.fluor?'rgba(255,255,255,.1)':dc;c.globalAlpha=D.fluor?1:.85;c.beginPath();c.ellipse(0,0,w/2,l/2,0,0,6.2832);c.fill();if(D.fluor){c.strokeStyle='rgba(255,255,255,.18)';c.lineWidth=.2;c.stroke();}}
      else if(D.shape==='dot'){c.fillStyle=dc;c.beginPath();c.arc(0,0,w/2,0,6.2832);c.fill();}
      else if(D.shape==='bubble'){c.strokeStyle='rgba(255,255,255,.8)';c.lineWidth=Math.max(w*.15,px);c.beginPath();c.arc(0,0,w/2,0,6.2832);c.stroke();}
      else if(D.shape==='smear'){c.strokeStyle=dc;c.lineWidth=w;c.lineCap='round';c.beginPath();c.moveTo(-l/2,0);c.bezierCurveTo(-l/6,w*.8,l/6,-w*.6,l/2,w*.3);c.stroke();}
      c.restore();
    });
    const tx=new T.CanvasTexture(cv);tx.encoding=T.sRGBEncoding;tx.anisotropy=8;
    return tx;
  }
  function shapeFor(P,miss){
    const sh=new T.Shape();
    if(P.shape==='rect'){const hw=P.w/2,hh=P.h/2,r=Math.min(1.2,hw*.05);sh.moveTo(-hw+r,-hh);sh.lineTo(hw-r,-hh);sh.quadraticCurveTo(hw,-hh,hw,-hh+r);sh.lineTo(hw,hh-r);sh.quadraticCurveTo(hw,hh,hw-r,hh);sh.lineTo(-hw+r,hh);sh.quadraticCurveTo(-hw,hh,-hw,hh-r);sh.lineTo(-hw,-hh+r);sh.quadraticCurveTo(-hw,-hh,-hw+r,-hh);}
    else sh.absarc(0,0,P.w/2,0,Math.PI*2,false);
    if(P.shape==='ring'){const h=new T.Path();h.absarc(0,0,P.inner,0,Math.PI*2,true);sh.holes.push(h);}
    (P.holes||[]).forEach((h,i)=>{if(miss.has(i))return;const p=new T.Path();p.absarc(h[0],-h[1],h[2],0,Math.PI*2,true);sh.holes.push(p);});
    return sh;
  }
  function buildPart(){
    disposeTree(partG);partG.clear();markG=new T.Group();partG.add(markG);markers=[];
    const P=PARTS[S.part],M=MATS[S.material],miss=missingSet(S);
    cartonH=P.carton?90:0;
    const base=cartonH+(S.tech==='back'?4:0);
    topY=base+P.t;
    if(P.carton){const cb=new T.Mesh(new T.BoxGeometry(P.w+60,cartonH,P.h+50),mat({color:0xb28a5c,roughness:.9,metalness:0}));cb.position.y=cartonH/2;partG.add(cb);
      const tape=new T.Mesh(new T.BoxGeometry(P.w+60.2,.4,18),mat({color:0xc9a878,roughness:.4}));tape.position.set(0,cartonH+.1,-(P.h+50)/2+30);partG.add(tape);}
    const t3=M.t3,clear=!!t3.clear;
    const faceM=clear?new T.MeshPhysicalMaterial({color:S.color,metalness:0,roughness:.05,transparent:true,opacity:.28,envMap:envTex,clearcoat:1,depthWrite:false}):mat({color:S.color,metalness:t3.metal,roughness:t3.rough});
    const sideM=P.sleeve?mat({color:P.sleeve,metalness:.1,roughness:.35}):faceM;
    const geo=new T.ExtrudeGeometry(shapeFor(P,miss),{depth:P.t,bevelEnabled:false,curveSegments:72});
    geo.rotateX(-Math.PI/2);
    const mesh=new T.Mesh(geo,[faceM,sideM]);mesh.position.y=base;partG.add(mesh);
    if(S.part==='cell'){const top=new T.Mesh(new T.CylinderGeometry(P.w/2*.62,P.w/2*.62,.8,48),mat({color:S.color,metalness:t3.metal,roughness:t3.rough}));top.position.y=topY+.4;partG.add(top);}
    // components
    (P.comps||[]).forEach((c,ci)=>{
      const fi=(P.holes||[]).length+ci;if(miss.has(fi))return;
      const b=new T.Mesh(new T.BoxGeometry(c.w,c.hgt,c.h),mat({color:c.c,metalness:c.k==='xtal'?.8:.1,roughness:c.k==='xtal'?.3:.5}));
      b.position.set(c.x,topY+c.hgt/2,c.y);partG.add(b);
    });
    // decal with print and defects
    const pad=8;
    const tx=decalCanvas(P,pad);
    const dm=new T.MeshStandardMaterial({map:tx,transparent:true,roughness:clear?.1:t3.rough,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,depthWrite:false});
    const pg=new T.PlaneGeometry(P.w+pad*2,P.h+pad*2);pg.rotateX(-Math.PI/2);
    pickMesh=new T.Mesh(pg,dm);pickMesh.position.y=topY+.05;partG.add(pickMesh);
    // markers
    const vmap={};(E?E.defs:[]).forEach((x,i)=>vmap[i]=x);
    S.defects.forEach((d,i)=>{
      const G=defGeom(S,d),x=vmap[i];
      const rad=Math.max(2.2,Math.max(G.w,DEFS[d.type].round?G.w:G.l)*.6);
      const col=cb.markerColor?cb.markerColor(i,x):'#3fc1c9';
      const m=new T.Mesh(new T.RingGeometry(rad,rad+Math.max(.5,rad*.12),48),new T.MeshBasicMaterial({color:col,transparent:true,opacity:.9,side:T.DoubleSide,depthTest:false}));
      m.rotation.x=-Math.PI/2;m.position.set(G.x,topY+.6,G.y);m.renderOrder=5;m.userData.base=1;markG.add(m);markers.push(m);
    });
    markG.visible=cb.showMarkers?cb.showMarkers():true;
  }

  /* ---------- camera, lens, light ---------- */
  function lightColor(){const c=LCOL[S.lcolor];return new T.Color(S.lcolor==='ir'?'#4a0a16':c.disp);}
  function glowMat(k){const m=new T.MeshStandardMaterial({color:0x111111,emissive:lightColor(),emissiveIntensity:k,roughness:.4,side:T.DoubleSide});m.userData.k=k;lightMats.push(m);return m;}
  function beamMat(op){const bc=S.lcolor==='white'?'#ffcf5a':S.lcolor==='ir'?'#b0304a':LCOL[S.lcolor].css;const m=new T.MeshBasicMaterial({color:bc,transparent:true,opacity:op,depthWrite:false,side:T.FrontSide});m.userData.op=op;beamMats.push(m);return m;}
  function addLight(x,y,z,k){const l=new T.PointLight(lightColor(),k,0);l.position.set(x,y,z);l.userData.k=k;sceneLights.push(l);rigG.add(l);}
  function buildRig(){
    disposeTree(rigG);rigG.clear();lightMats=[];beamMats=[];sceneLights=[];
    const O=E.O,P=PARTS[S.part],lens=O.lens,camd=O.cam;
    const lf=topY+S.wd;
    const blk=mat({color:0x1b1d22,metalness:.4,roughness:.45}),silver=mat({color:0xc6ccd3,metalness:.9,roughness:.25});
    // lens
    const lr=lens.tele?(lens.mag>.3?24:36):(lens.f>=35?17:15);
    const ll=lens.tele?(lens.mag>.3?115:175):22+lens.f*.55;
    const lg=new T.Group();
    const barrel=new T.Mesh(new T.CylinderGeometry(lr,lr,ll,40),blk);barrel.position.y=ll/2;lg.add(barrel);
    for(const f of[.28,.62]){const ring=new T.Mesh(new T.CylinderGeometry(lr+.6,lr+.6,3,40),silver);ring.position.y=ll*f;lg.add(ring);}
    const glass=new T.Mesh(new T.CircleGeometry(lr*.78,40),new T.MeshStandardMaterial({color:0x162030,metalness:1,roughness:.05,envMap:envTex}));glass.rotation.x=Math.PI/2;glass.position.y=-.05;lg.add(glass);
    let stack=0;
    if(S.filter!=='none'||S.pol){
      const fc=S.filter!=='none'?FILT[S.filter].tint:'#555a60';
      const fm=new T.Mesh(new T.CylinderGeometry(lr+1.2,lr+1.2,4,40),new T.MeshStandardMaterial({color:fc,transparent:true,opacity:.75,metalness:.3,roughness:.2}));fm.position.y=-2;lg.add(fm);stack=4;
      if(S.pol){const pm=new T.Mesh(new T.CylinderGeometry(lr+1.6,lr+1.6,3,40),silver);pm.position.y=-5.5;lg.add(pm);stack=7;}
    }
    lg.position.y=lf+stack;rigG.add(lg);
    let y=lf+stack+ll;
    if(S.spacer&&!lens.tele){const sp=new T.Mesh(new T.CylinderGeometry(13,13,8,32),silver);sp.position.y=y+4;rigG.add(sp);y+=8;}
    const big=camd.px[0]>=4000;const bs=big?48:29,bl=big?58:42;
    const body=new T.Mesh(new T.BoxGeometry(bs,bl,bs),mat({color:0x2d5c9e,metalness:.55,roughness:.4}));body.position.y=y+bl/2;rigG.add(body);
    const back=new T.Mesh(new T.BoxGeometry(bs+.4,6,bs+.4),blk);back.position.y=y+bl-3;rigG.add(back);
    const led=new T.Mesh(new T.BoxGeometry(3,3,1),new T.MeshBasicMaterial({color:0x33ff88}));led.position.set(bs/4,y+bl-3,bs/2+.5);rigG.add(led);
    const cable=new T.Mesh(new T.CylinderGeometry(3,3,90,12),blk);cable.position.set(0,y+bl+45,0);rigG.add(cable);
    // arm to post
    const armY=y+bl/2;
    const arm2=new T.Mesh(new T.BoxGeometry(14,14,150),silver);arm2.position.set(-260,armY,-75);rigG.add(arm2);
    const clampM=new T.Mesh(new T.BoxGeometry(bs+10,18,bs+10),blk);clampM.position.set(0,armY,0);clampM.scale.set(1,.8,1);rigG.add(clampM);
    const arm3=new T.Mesh(new T.BoxGeometry(14,14,75),silver);arm3.position.set(0,armY,-40);rigG.add(arm3);
    const arm4=new T.Mesh(new T.BoxGeometry(260,14,14),silver);arm4.position.set(-130,armY,-75);rigG.add(arm4);

    // light fixture
    const s=S.lsize,k=(.7+S.intensity/100)*(S.lcolor==='ir'?.6:1)*1.5;
    const housing=mat({color:0x2a2e35,metalness:.5,roughness:.5});
    const beamOp=.08+.07*S.intensity/100;
    if(S.tech==='ring'){
      const ry=Math.max(lf-12,topY+25);
      const ro=s/2,ri=Math.max(lr+3,s*.22);
      const body=new T.Mesh(new T.CylinderGeometry(ro,ro,14,64,1,true),housing);body.position.y=ry+7;rigG.add(body);
      const face=new T.Mesh(new T.RingGeometry(ri,ro-1.5,64),glowMat(k));face.rotation.x=Math.PI/2;face.position.y=ry-.2;rigG.add(face);
      const topc=new T.Mesh(new T.RingGeometry(ri,ro,64),housing);topc.rotation.x=-Math.PI/2;topc.position.y=ry+14;rigG.add(topc);
      const h=ry-topY,br=Math.max(P.w,P.h)*.6;
      const cone=new T.Mesh(new T.CylinderGeometry(ro*.8,br,h,48,1,true),beamMat(beamOp));cone.position.y=topY+h/2;rigG.add(cone);
      addLight(0,ry-5,0,k*1.4);
    }else if(S.tech==='dome'){
      const r=s/2;
      const dome=new T.Mesh(new T.SphereGeometry(r,48,24,0,Math.PI*2,0,Math.PI/2),new T.MeshStandardMaterial({color:0xdddddd,emissive:lightColor(),emissiveIntensity:k*.6,transparent:true,opacity:.42,side:T.DoubleSide,depthWrite:false,roughness:.9}));
      dome.material.userData.k=k*.6;lightMats.push(dome.material);
      dome.position.y=topY-Math.min(P.t,4);rigG.add(dome);
      const shell=new T.Mesh(new T.SphereGeometry(r+2,48,24,0,Math.PI*2,0,Math.PI/2),new T.MeshStandardMaterial({color:0x30343b,transparent:true,opacity:.35,depthWrite:false,metalness:.5,roughness:.5,side:T.FrontSide}));
      shell.position.copy(dome.position);rigG.add(shell);
      const rim=new T.Mesh(new T.TorusGeometry(r+1,2.2,10,64),housing);rim.rotation.x=Math.PI/2;rim.position.copy(dome.position);rigG.add(rim);
      const port=new T.Mesh(new T.TorusGeometry(Math.max(lr*.8,8),2,8,32),housing);port.rotation.x=Math.PI/2;port.position.y=dome.position.y+r;rigG.add(port);
      addLight(0,dome.position.y+r*.6,0,k*1.2);addLight(r*.6,dome.position.y+r*.3,0,k*.5);addLight(-r*.6,dome.position.y+r*.3,0,k*.5);
    }else if(S.tech==='coax'){
      const bh=s+10,cy=lf-bh/2-1;
      const box=new T.Mesh(new T.BoxGeometry(s+12,bh,s+12),new T.MeshStandardMaterial({color:0x2a2e35,metalness:.5,roughness:.5,transparent:true,opacity:.55,depthWrite:false}));box.position.y=cy;rigG.add(box);
      const panel=new T.Mesh(new T.PlaneGeometry(s,s*.8),glowMat(k));panel.rotation.y=Math.PI/2;panel.position.set(-(s+12)/2+1,cy,0);rigG.add(panel);
      const bs2=new T.Mesh(new T.PlaneGeometry(s*1.35,s),new T.MeshStandardMaterial({color:0xaad4ff,transparent:true,opacity:.28,metalness:.9,roughness:.05,side:T.DoubleSide,depthWrite:false}));
      bs2.rotation.set(0,Math.PI/2,0);bs2.rotateX(Math.PI/4);bs2.position.y=cy;rigG.add(bs2);
      const side=new T.Mesh(new T.CylinderGeometry(s*.35,s*.35,s*.5,32,1,true),beamMat(beamOp));side.rotation.z=Math.PI/2;side.position.set(-s*.25,cy,0);rigG.add(side);
      const down=new T.Mesh(new T.CylinderGeometry(s*.35,s*.35,cy-topY,32,1,true),beamMat(beamOp));down.position.y=topY+(cy-topY)/2;rigG.add(down);
      addLight(0,cy-bh/2-2,0,k*1.1);
    }else if(S.tech==='darkfield'){
      const ry=topY+6,r=s/2;
      const ring=new T.Mesh(new T.CylinderGeometry(r,r,12,64,1,true),housing);ring.position.y=ry+6;rigG.add(ring);
      const inner=new T.Mesh(new T.CylinderGeometry(r-2,r-2,8,64,1,true),glowMat(k));inner.position.y=ry+6;rigG.add(inner);
      const skim=new T.Mesh(new T.CylinderGeometry(r-2,Math.max(P.w,P.h)*.3,10,64,1,true),beamMat(beamOp*1.4));skim.position.y=ry+2;rigG.add(skim);
      for(let i=0;i<6;i++){const a=i/6*Math.PI*2;addLight(Math.cos(a)*(r-6),ry+4,Math.sin(a)*(r-6),k*.35);}
    }else if(S.tech==='bar'){
      const a=S.barAngle*Math.PI/180,D=Math.max(Math.max(P.w,P.h)/2+50,90),by=topY+D*Math.tan(a);
      for(const sg of[-1,1]){
        const g=new T.Group();
        const bb=new T.Mesh(new T.BoxGeometry(22,16,s),housing);g.add(bb);
        const face=new T.Mesh(new T.PlaneGeometry(s-6,12),glowMat(k));face.rotation.y=-sg*Math.PI/2;face.position.x=-sg*11.1;g.add(face);
        g.position.set(sg*D,by,0);g.rotation.z=sg*a;
        rigG.add(g);
        const L=Math.hypot(D,by-topY);
        const beam=new T.Mesh(new T.BoxGeometry(L,12,s*.8),beamMat(beamOp*1.2));
        beam.position.set(sg*D/2,(by+topY)/2,0);beam.rotation.z=sg*Math.atan2(by-topY,D);
        rigG.add(beam);
        addLight(sg*D*.9,by,0,k*.9);
      }
    }else if(S.tech==='back'){
      const pan=new T.Group();
      const bx=new T.Mesh(new T.BoxGeometry(s+14,8,s+14),housing);bx.position.y=-4+4;pan.add(bx);
      const face=new T.Mesh(new T.PlaneGeometry(s,s),glowMat(k*1.1));face.rotation.x=-Math.PI/2;face.position.y=4.3;pan.add(face);
      pan.position.y=cartonH;rigG.add(pan);
      const col=new T.Mesh(new T.CylinderGeometry(Math.min(P.w,P.h)*.45,Math.min(P.w,P.h)*.45,lf-topY,32,1,true),beamMat(beamOp));col.position.y=topY+(lf-topY)/2;rigG.add(col);
      addLight(0,cartonH+30,0,k*.9);
    }
    // shroud
    if(S.shroud){
      const W=Math.max(s,P.w,P.h,O.fovW)+160,H=lf-topY+140;
      const sm=new T.MeshStandardMaterial({color:0x0a0c10,transparent:true,opacity:.09,side:T.DoubleSide,depthWrite:false,roughness:1});
      const sh=new T.Mesh(new T.BoxGeometry(W,H,W),sm);sh.position.y=topY+H/2-20;rigG.add(sh);
      const edges=new T.LineSegments(new T.EdgesGeometry(sh.geometry),new T.LineBasicMaterial({color:0x6a7a8f,transparent:true,opacity:.5}));edges.position.copy(sh.position);rigG.add(edges);
    }
    // field of view
    const fovCol=new T.Color(cssVar('--optic')||'#3fc1c9');
    const hw=O.fovW/2,hh=O.fovH/2,fy=topY+.25;
    const pts=[];
    const corners=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
    for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];pts.push(a[0],fy,a[1],b[0],fy,b[1]);}
    for(const c of corners){const top=lens.tele?[c[0],lf,c[1]]:[c[0]*.02,lf,c[1]*.02];pts.push(top[0],top[1],top[2],c[0],fy,c[1]);}
    const lg2=new T.BufferGeometry();lg2.setAttribute('position',new T.Float32BufferAttribute(pts,3));
    const fov=new T.LineSegments(lg2,new T.LineBasicMaterial({color:fovCol,transparent:true,opacity:.9,depthTest:false}));fov.renderOrder=4;rigG.add(fov);
    const plane=new T.Mesh(new T.PlaneGeometry(O.fovW,O.fovH),new T.MeshBasicMaterial({color:fovCol,transparent:true,opacity:.06,depthWrite:false,side:T.DoubleSide}));
    plane.rotation.x=-Math.PI/2;plane.position.y=fy;rigG.add(plane);
    rigG.children.forEach(c=>{if(c.material&&beamMats.includes(c.material))c.visible=beams;});
    // backlight: hide belt texture look under the panel? keep belt; conveyor visible
    ob.lf=lf;
  }

  function update(nS,nE){
    S=nS;E=nE;if(!R)return;
    buildPart();buildRig();
    if(!ob.userMoved)frame('iso',true);
  }
  function refreshMarkers(){
    if(!markers.length)return;
    markers.forEach((m,i)=>{const x=E&&E.defs[i];m.material.color=new T.Color(cb.markerColor?cb.markerColor(i,x):'#3fc1c9');});
    markG.visible=cb.showMarkers?cb.showMarkers():true;
  }
  function frame(kind,soft){
    if(!soft)ob.userMoved=kind!=='iso';
    if(!S||!R)return;
    const P=PARTS[S.part],lf=topY+S.wd,span=Math.max(P.w,P.h,E?E.O.fovW:0);
    const g=ob.goal;
    if(kind==='top'){g.th=0;g.ph=.03;g.tgt=new T.Vector3(0,topY,0);g.r=Math.max(span*1.9,70);}
    else if(kind==='side'){g.th=Math.PI/2;g.ph=1.5;g.tgt=new T.Vector3(0,topY+S.wd*.5,0);g.r=Math.max(S.wd*2.6,Math.max(S.lsize,span)*3,260);}
    else{g.th=.78;g.ph=1.08;g.tgt=new T.Vector3(0,topY+S.wd*.5,0);g.r=Math.max(S.wd*3.1+160,Math.max(S.lsize,span)*3.4,340);}
  }
  function flash(){flashT=1;}
  function trigger(){flashT=Math.max(flashT,S&&S.strobe?1:.45);if(cb.onTrigger)cb.onTrigger();}

  function loop(t){
    requestAnimationFrame(loop);
    if(!R||!S||document.hidden||lost)return;
    const dt=Math.min(.05,(t-lastT)/1000||0);lastT=t;
    // orbit easing
    const g=ob.goal,e=1-Math.pow(.001,dt);
    ob.th+=(g.th-ob.th)*e;ob.ph+=(g.ph-ob.ph)*e;ob.r+=(g.r-ob.r)*e;ob.tgt.lerp(g.tgt,e);
    const sp=Math.sin(ob.ph);
    cam.position.set(ob.tgt.x+ob.r*sp*Math.sin(ob.th),ob.tgt.y+ob.r*Math.cos(ob.ph),ob.tgt.z+ob.r*sp*Math.cos(ob.th));
    cam.lookAt(ob.tgt);
    // conveyor
    const moving=S.speed>0&&run&&!armed;
    if(moving){
      const v=clamp(S.speed*.18,40,260);const L=Math.max(420,S.wd*.8);
      const prev=partX;partX+=v*dt;if(partX>L)partX=-L;
      if(prev<0&&partX>=0)trigger();
      beltTex.offset.x-=v*dt/80;
    }else{
      partX+=(0-partX)*Math.min(1,dt*6);
      triggerCool-=dt;if(run&&triggerCool<=0&&!armed){triggerCool=2.6;trigger();}
    }
    partG.position.x=partX;
    // strobe / trigger flash
    flashT=Math.max(0,flashT-dt*3.2);
    const pulse=1+flashT*(S.strobe?2.2:.6);
    lightMats.forEach(m=>m.emissiveIntensity=m.userData.k*(S.strobe?(.35+pulse*.65):pulse*.9));
    beamMats.forEach(m=>m.opacity=m.userData.op*(S.strobe?(.25+flashT*1.6):(.85+.15*Math.sin(t/300)+flashT*.6)));
    sceneLights.forEach(l=>l.intensity=l.userData.k*.9*(S.strobe?(.35+flashT*1.3):1));
    // marker pulse
    const pz=1+.12*Math.sin(t/260);markers.forEach(m=>m.scale.setScalar(pz));
    R.render(scene,cam);
  }
  return{
    init,update,theme,frame,flash,refreshMarkers,
    setBeams(v){beams=v;if(rigG)rigG.children.forEach(c=>{if(c.material&&beamMats.includes(c.material))c.visible=v;});},
    setRun(v){run=v;},
    setArmed(v){armed=v;},
    userOrbit(){ob.userMoved=true;}
  };
})();
