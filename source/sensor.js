/* ================= simulated camera image ================= */
const Sensor=(()=>{
  const g255=x=>Math.round(clamp(x,0,1)*255);
  function css(v,a){a=a==null?1:a;if(v.length===1){const g=g255(v[0]);return `rgba(${g},${g},${g},${a})`;}return `rgba(${g255(v[0])},${g255(v[1])},${g255(v[2])},${a})`;}
  function mk(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}

  function partPath(ctx,P,skip){
    ctx.beginPath();
    if(P.shape==='rect')ctx.rect(-P.w/2,-P.h/2,P.w,P.h);
    else{ctx.moveTo(P.w/2,0);ctx.arc(0,0,P.w/2,0,Math.PI*2);if(P.shape==='ring'){ctx.moveTo(P.inner,0);ctx.arc(0,0,P.inner,0,Math.PI*2);}}
    (P.holes||[]).forEach((h,i)=>{if(skip&&skip.has(i))return;ctx.moveTo(h[0]+h[2],h[1]);ctx.arc(h[0],h[1],h[2],0,Math.PI*2);});
  }

  /* ---- surface texture (grain, lathe marks, speckle) ---- */
  function texStroke(ctx,b,pl){
    if(b>=0){ctx.globalCompositeOperation='lighter';const g=Math.round(clamp(b,0,1)*255);return `rgb(${g},${g},${g})`;}
    ctx.globalCompositeOperation='multiply';const g=Math.round(clamp(1+b/Math.max(pl,.04),.05,1)*255);return `rgb(${g},${g},${g})`;
  }
  function drawTexture(ctx,S,X,E,view){
    const M=X.M,P=X.P,amp=X.clutter*2.2;
    if(amp*255<.6||S.material==='clear')return;
    const pl=vmax(vclip(E.partV));
    const rng=mulberry32(hashStr(S.part+'|'+S.material));
    const R=()=>(rng()*2-1)*amp*1.7;
    const hw=P.w/2,hh=P.h/2;
    // visible window in mm (skip strokes outside, keeps the loupe fast)
    const vx0=view.cx-view.w/2/view.s,vx1=view.cx+view.w/2/view.s,vy0=view.cy-view.h/2/view.s,vy1=view.cy+view.h/2/view.s;
    ctx.save();
    if(S.material==='brushed'){
      ctx.lineWidth=.05;
      for(let y=-hh;y<=hh;y+=.055){const b=R();if(y<vy0-.1||y>vy1+.1)continue;ctx.strokeStyle=texStroke(ctx,b,pl);ctx.beginPath();ctx.moveTo(-hw,y);ctx.lineTo(hw,y);ctx.stroke();}
    }else if(S.material==='machined'){
      ctx.lineWidth=.06;
      const round=P.shape!=='rect';const c=round?[0,0]:[-P.w*.9,P.h*.1];
      const r0=round?(P.shape==='ring'?P.inner:0):Math.hypot(hw+P.w*.9-P.w,hh)*.2;
      const r1=round?hw:Math.hypot(P.w*1.4,hh*1.4);
      for(let r=Math.max(r0,.2);r<=r1;r+=.08){const b=R()*.8;ctx.strokeStyle=texStroke(ctx,b,pl);ctx.beginPath();ctx.arc(c[0],c[1],r,0,Math.PI*2);ctx.stroke();}
    }else if(S.material==='paper'){
      const n=Math.min(9000,P.w*P.h*1.4|0);ctx.lineWidth=.06;
      for(let i=0;i<n;i++){const x=(rng()-.5)*P.w,y=(rng()-.5)*P.h,a=rng()*Math.PI,l=.3+rng()*.8,b=R();if(x<vx0-1||x>vx1+1||y<vy0-1||y>vy1+1)continue;ctx.strokeStyle=texStroke(ctx,b,pl);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);ctx.stroke();}
    }else{
      const n=Math.min(14000,P.w*P.h*(P.shape==='rect'?2.4:3)|0);
      for(let i=0;i<n;i++){const x=(rng()-.5)*P.w,y=(rng()-.5)*P.h,r=.04+rng()*.1,b=R();if(x<vx0-1||x>vx1+1||y<vy0-1||y>vy1+1)continue;ctx.fillStyle=texStroke(ctx,b,pl);ctx.beginPath();ctx.arc(x,y,r,0,6.2832);ctx.fill();}
    }
    ctx.restore();
  }

  function blobPath(ctx,rng,a,b){
    const n=11,pts=[];
    for(let i=0;i<n;i++){const t=i/n*Math.PI*2,k=.72+rng()*.38;pts.push([Math.cos(t)*a*k,Math.sin(t)*b*k]);}
    ctx.beginPath();
    for(let i=0;i<n;i++){const p=pts[i],q=pts[(i+1)%n],m=[(p[0]+q[0])/2,(p[1]+q[1])/2];if(i===0){const z=pts[n-1];ctx.moveTo((z[0]+p[0])/2,(z[1]+p[1])/2);}ctx.quadraticCurveTo(p[0],p[1],m[0],m[1]);}
    ctx.closePath();
  }

  function drawDefect(ctx,S,x,i){
    const d=x.d,D=x.D,G=x.G,lv=vclip(x.drawV);
    const rng=mulberry32(hashStr(d.type)+i*7919+Math.round(d.u*1000)*31+Math.round(d.v*1000));
    const col=css(lv);
    ctx.save();
    if(D.kind==='edge'){
      const a=G.a,ang=Math.atan2(a.ny,a.nx);
      if(d.type==='chip'){ctx.translate(a.x,a.y);ctx.rotate(ang);ctx.fillStyle=col;blobPath(ctx,rng,G.w,G.l/2);ctx.fill();}
      else{ctx.translate(a.x+a.nx*G.w*.45,a.y+a.ny*G.w*.45);ctx.rotate(ang);ctx.fillStyle=col;blobPath(ctx,rng,G.w*.55,G.l/2);ctx.fill();}
      ctx.restore();return;
    }
    if(D.kind==='feature'){ctx.restore();return;}
    ctx.translate(G.x,G.y);ctx.rotate((d.ang||0)*Math.PI/180);
    const w=G.w,l=G.l;
    switch(D.shape){
      case 'line':{ctx.strokeStyle=col;ctx.lineWidth=w;ctx.lineCap='round';const c=l*.07*(rng()-.5);ctx.beginPath();ctx.moveTo(-l/2,0);ctx.quadraticCurveTo(0,c,l/2,c*.3);ctx.stroke();break;}
      case 'crack':{ctx.strokeStyle=col;ctx.lineWidth=w;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();const n=12;let br=null;
        for(let k=0;k<=n;k++){const px=-l/2+l*k/n,py=(k&&k<n)?(rng()-.5)*l*.09:0;k?ctx.lineTo(px,py):ctx.moveTo(px,py);if(k===5)br=[px,py];}
        ctx.stroke();if(br){ctx.lineWidth=w*.7;ctx.beginPath();ctx.moveTo(br[0],br[1]);ctx.lineTo(br[0]+l*.12,br[1]+l*.14);ctx.lineTo(br[0]+l*.2,br[1]+l*.17);ctx.stroke();}break;}
      case 'dent':{const g=ctx.createRadialGradient(0,0,0,0,0,w/2);g.addColorStop(0,css(lv,.95));g.addColorStop(.55,css(lv,.75));g.addColorStop(1,css(lv,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,w/2,0,6.2832);ctx.fill();break;}
      case 'blob':{ctx.fillStyle=css(lv,.45);blobPath(ctx,rng,w/2*1.08,l/2*1.08);ctx.fill();ctx.fillStyle=css(lv,.92);blobPath(ctx,mulberry32(hashStr(d.type)+i),w/2*.92,l/2*.92);ctx.fill();break;}
      case 'dot':{ctx.fillStyle=col;blobPath(ctx,rng,w/2,w/2);ctx.fill();break;}
      case 'bubble':{ctx.strokeStyle=col;ctx.lineWidth=Math.max(w*.2,.01);ctx.beginPath();ctx.arc(0,0,w/2*.9,0,6.2832);ctx.stroke();ctx.fillStyle=css(lv,.25);ctx.beginPath();ctx.arc(0,0,w/2*.8,0,6.2832);ctx.fill();break;}
      case 'smear':{ctx.strokeStyle=css(lv,.9);ctx.lineCap='round';ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(-l/2,0);ctx.bezierCurveTo(-l/6,w*.8,l/6,-w*.6,l/2,w*.3);ctx.stroke();ctx.lineWidth=w*.5;ctx.strokeStyle=css(lv,.6);ctx.beginPath();ctx.moveTo(-l/2+w,w*.6);ctx.lineTo(l/3,w*.9);ctx.stroke();break;}
    }
    ctx.restore();
  }

  function drawFeatures(ctx,S,X,E,miss){
    const P=X.P,K=X.K;
    const topoC=vclip(vadd(E.partV,vsc(X.topoV,K*.4*X.r.topo*X.topoScale)));
    const rimC=vclip(vadd(E.partV,vsc(X.topoV,K*.3*Math.abs(X.r.topo)*X.topoScale)));
    ctx.save();
    for(const f of(P.feats||[])){
      ctx.strokeStyle=css(topoC);
      if(f.k==='ring'){ctx.lineWidth=.6;ctx.beginPath();ctx.arc(0,0,f.r,0,6.2832);ctx.stroke();}
      else if(f.k==='ticks'){ctx.lineWidth=.35;ctx.beginPath();for(let k=0;k<48;k++){const a=k/48*Math.PI*2;ctx.moveTo(Math.cos(a)*f.r,Math.sin(a)*f.r);ctx.lineTo(Math.cos(a)*(f.r+1.3),Math.sin(a)*(f.r+1.3));}ctx.stroke();}
      else if(f.k==='vent'){ctx.lineWidth=.6;for(let k=0;k<4;k++){ctx.beginPath();ctx.arc(0,0,3.6,k*Math.PI/2+.25,k*Math.PI/2+1.3);ctx.stroke();}}
      else if(f.k==='ribs'){ctx.lineWidth=.9;ctx.beginPath();for(let x=-12;x<=12;x+=6){ctx.moveTo(x,-12);ctx.lineTo(x,12);}ctx.stroke();}
    }
    // hole rims
    ctx.strokeStyle=css(rimC);ctx.lineWidth=.35;
    (P.holes||[]).forEach((h,i)=>{if(miss.has(i))return;ctx.beginPath();ctx.arc(h[0],h[1],h[2]+.15,0,6.2832);ctx.stroke();});
    if(P.shape==='ring'){ctx.beginPath();ctx.arc(0,0,P.inner+.15,0,6.2832);ctx.stroke();}
    // components and print
    const fl=featureList(P);
    fl.forEach((f,i)=>{
      if(f.kind==='comp'){
        const c=f.src;
        if(miss.has(i)){ctx.fillStyle=css(vclip(surfaceV(X,'#c8a060',K)));const pw=Math.min(c.w*.3,1.4);ctx.fillRect(c.x-c.w/2,c.y-c.h/2,pw,c.h);ctx.fillRect(c.x+c.w/2-pw,c.y-c.h/2,pw,c.h);return;}
        ctx.fillStyle=css(vclip(surfaceV(X,c.c,K)));ctx.fillRect(c.x-c.w/2,c.y-c.h/2,c.w,c.h);
        if(c.k==='ic'){ctx.fillStyle=css(vclip(surfaceV(X,'#c0c4c8',K)));for(let k=0;k<6;k++){const y=c.y-c.h/2+1.2+k*(c.h-2.4)/5;ctx.fillRect(c.x-c.w/2-1.1,y-.25,1.1,.5);ctx.fillRect(c.x+c.w/2,y-.25,1.1,.5);}}
        ctx.strokeStyle=css(rimC,.8);ctx.lineWidth=.2;ctx.strokeRect(c.x-c.w/2,c.y-c.h/2,c.w,c.h);
      }else if(f.kind==='print'){
        if(miss.has(i))return;
        const b=f.src,pc=css(vclip(surfaceV(X,PRINT_COLOR,K,.05)));ctx.fillStyle=pc;ctx.strokeStyle=pc;
        const x0=b.x-b.w/2,y0=b.y-b.h/2;const r=mulberry32(hashStr('print'+b.x));
        if(b.bars){let x=x0;while(x<x0+b.w){const bw=.33*(1+Math.floor(r()*3));ctx.fillRect(x,y0,bw,b.h*.82);x+=bw+.33*(1+Math.floor(r()*3));}}
        else if(b.text){let x=x0;while(x<x0+b.w){const cw=1.3+r()*1.2;ctx.fillRect(x,y0,cw,b.h);x+=cw+(r()<.18?1.8:.5);}}
        else if(b.box){ctx.lineWidth=.6;ctx.strokeRect(x0,y0,b.w,b.h);const n=12,cs=(b.h-2)/n;for(let yy=0;yy<n;yy++)for(let xx=0;xx<n;xx++)if(r()<.5)ctx.fillRect(x0+b.w-b.h+1+xx*cs,y0+1+yy*cs,cs,cs);ctx.font='3px sans-serif';ctx.fillText('LOT 2604',x0+1,y0+b.h*.45);}
      }
    });
    ctx.restore();
  }

  function drawScene(ctx,S,E,view){
    const X=E.X,P=X.P,O=E.O,K=X.K,s=view.s;
    const miss=missingSet(S);
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle=css(vclip(E.stageV));ctx.fillRect(0,0,view.w,view.h);
    ctx.translate(view.w/2-view.cx*s,view.h/2-view.cy*s);ctx.scale(s,s);
    // part body
    partPath(ctx,P,miss);ctx.fillStyle=css(vclip(E.partV));ctx.fill('evenodd');
    ctx.save();partPath(ctx,P,miss);ctx.clip('evenodd');
    drawTexture(ctx,S,X,E,view);
    ctx.globalCompositeOperation='source-over';
    drawFeatures(ctx,S,X,E,miss);
    ctx.restore();
    // defects
    E.defs.forEach((x,i)=>{if(x.D.kind==='surface')drawDefect(ctx,S,x,i);});
    // illumination falloff and glare, inside the part (plus edge defects)
    ctx.save();partPath(ctx,P,miss);ctx.clip('evenodd');
    if(X.unif<.999&&!X.back){
      ctx.save();ctx.scale(P.w/2,P.h/2);ctx.globalCompositeOperation='multiply';
      const g=ctx.createRadialGradient(0,0,0,0,0,1.42);
      for(const t of[0,.25,.5,.75,1]){const v=1-(1-X.unif)*t*t;const c=Math.round(v*255);g.addColorStop(t,`rgb(${c},${c},${c})`);}
      ctx.fillStyle=g;ctx.fillRect(-1.5,-1.5,3,3);ctx.restore();
    }
    const gl=X.r.glare;
    if(gl>0){
      const gv=vsc(X.whiteV,K*gl*1.6);
      ctx.save();ctx.scale(P.w/2,P.h/2);ctx.globalCompositeOperation='lighter';
      let g;
      if(S.tech==='ring'){g=ctx.createRadialGradient(0,0,0,0,0,1.2);[[0,0],[.16,.02],[.29,.37],[.42,1],[.55,.37],[.68,.02],[.8,0],[1.2,0]].forEach(([t,a])=>g.addColorStop(t/1.2,css(gv,a)));}
      else if(S.tech==='bar'){g=ctx.createLinearGradient(0,-1.2,0,1.2);[[-1.2,0],[-.65,.02],[-.4,.37],[-.15,1],[.1,.37],[.35,.02],[1.2,0]].forEach(([y,a])=>g.addColorStop((y+1.2)/2.4,css(gv,a)));}
      else{g=ctx.createRadialGradient(0,0,0,0,0,1);[[0,1],[.2,.72],[.35,.37],[.5,.13],[.7,.02],[1,0]].forEach(([t,a])=>g.addColorStop(t,css(gv,a)));}
      ctx.fillStyle=g;ctx.fillRect(-1.5,-1.5,3,3);ctx.restore();
    }
    ctx.restore();
    // edge defects are drawn after so they are not clipped away
    E.defs.forEach((x,i)=>{if(x.D.kind==='edge')drawDefect(ctx,S,x,i);});
    // vignette (mm space, centred on the optical axis)
    if(O.vignette>0){
      const R=Math.hypot(O.fovW,O.fovH)/2;ctx.globalCompositeOperation='multiply';
      const g=ctx.createRadialGradient(0,0,0,0,0,R);
      for(const t of[0,.25,.5,.75,1]){const v=1-O.vignette*.8*t*t;const c=Math.round(v*255);g.addColorStop(t,`rgb(${c},${c},${c})`);}
      ctx.fillStyle=g;ctx.fillRect(-R*2,-R*2,R*4,R*4);
    }
    ctx.restore();
  }

  /* ---- pixel operations ---- */
  function boxH(src,dst,w,h,r){const div=2*r+1;for(let y=0;y<h;y++){for(let c=0;c<3;c++){let acc=0;const row=y*w;for(let x=-r;x<=r;x++)acc+=src[(row+clamp(x,0,w-1))*4+c];for(let x=0;x<w;x++){dst[(row+x)*4+c]=acc/div;acc+=src[(row+Math.min(x+r+1,w-1))*4+c]-src[(row+Math.max(x-r,0))*4+c];}}}}
  function boxV(src,dst,w,h,r){const div=2*r+1;for(let x=0;x<w;x++){for(let c=0;c<3;c++){let acc=0;for(let y=-r;y<=r;y++)acc+=src[(clamp(y,0,h-1)*w+x)*4+c];for(let y=0;y<h;y++){dst[(y*w+x)*4+c]=acc/div;acc+=src[(Math.min(y+r+1,h-1)*w+x)*4+c]-src[(Math.max(y-r,0)*w+x)*4+c];}}}}
  function tri(src,dst,w,h,horiz){for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;let a,b;if(horiz){a=(y*w+Math.max(x-1,0))*4;b=(y*w+Math.min(x+1,w-1))*4;}else{a=(Math.max(y-1,0)*w+x)*4;b=(Math.min(y+1,h-1)*w+x)*4;}for(let c=0;c<3;c++)dst[i+c]=.25*src[a+c]+.5*src[i+c]+.25*src[b+c];}}
  function blur(img,sigma){
    if(sigma<.25)return;
    const w=img.width,h=img.height,d=img.data,tmp=new Float32Array(d.length),buf=new Float32Array(d.length);
    for(let i=0;i<d.length;i++)buf[i]=d[i];
    if(sigma<.9){tri(buf,tmp,w,h,true);tri(tmp,buf,w,h,false);}
    else{const r=Math.max(1,Math.round((Math.sqrt(4*sigma*sigma+1)-1)/2));for(let p=0;p<3;p++){boxH(buf,tmp,w,h,r);boxV(tmp,buf,w,h,r);}}
    for(let i=0;i<d.length;i+=4){d[i]=buf[i];d[i+1]=buf[i+1];d[i+2]=buf[i+2];}
  }
  function motion(img,len){
    const r=Math.round(len/2);if(r<1)return;
    const w=img.width,h=img.height,d=img.data,buf=new Float32Array(d.length),tmp=new Float32Array(d.length);
    for(let i=0;i<d.length;i++)buf[i]=d[i];
    boxH(buf,tmp,w,h,r);
    for(let i=0;i<d.length;i+=4){d[i]=tmp[i];d[i+1]=tmp[i+1];d[i+2]=tmp[i+2];}
  }
  function blurOf(S,O){return Math.hypot(O.dofPx,O.diffPx,S.colorCam?.55:0)*.5;}

  const GT=new Float32Array(1<<16);{const r=mulberry32(7);for(let i=0;i<GT.length;i++){const u=Math.max(r(),1e-9),v=r();GT[i]=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}}
  let gi=0;
  function addNoise(src,dst,E,S,t){
    const a=E.noiseA*255,fl=E.flick*255*Math.sin(t*6.1)*.8;
    const s=src.data,o=dst.data,mono=!S.colorCam,n=s.length;
    const sq=new Float32Array(256);for(let v=0;v<256;v++)sq[v]=a+E.noiseB*255*Math.sqrt(Math.max(v/255,.02));
    for(let i=0;i<n;i+=4){
      if(mono){const v=s[i];const x=v+sq[v]*GT[gi++&65535]+fl;o[i]=o[i+1]=o[i+2]=x;}
      else{o[i]=s[i]+sq[s[i]]*GT[gi++&65535]+fl;o[i+1]=s[i+1]+sq[s[i+1]]*GT[gi++&65535]+fl;o[i+2]=s[i+2]+sq[s[i+2]]*GT[gi++&65535]+fl;}
      o[i+3]=255;
    }
    gi=(gi+(Math.random()*65536|0))&65535;
  }

  /* ---- public: full frame ---- */
  function frame(S,E,maxW){
    const O=E.O,cam=O.cam;
    const rw=Math.max(80,Math.min(maxW||720,cam.px[0])),rh=Math.max(60,Math.round(rw*O.fovH/O.fovW));
    const cv=mk(rw,rh),ctx=cv.getContext('2d');
    const s=rw/O.fovW,k=rw/cam.px[0];
    drawScene(ctx,S,E,{s,cx:0,cy:0,w:rw,h:rh});
    const img=ctx.getImageData(0,0,rw,rh);
    blur(img,blurOf(S,O)*k);
    if(O.motionPx*k>.8)motion(img,O.motionPx*k);
    return{img,rw,rh,s,k,native:rw===cam.px[0]};
  }
  /* ---- public: 1:1 sensor pixels around a point (mm) ---- */
  function loupe(S,E,mx,my,n){
    const O=E.O,ss=4,W=n*ss;
    const cv=mk(W,W),ctx=cv.getContext('2d');
    drawScene(ctx,S,E,{s:ss/O.mmpp,cx:mx,cy:my,w:W,h:W});
    const img=ctx.getImageData(0,0,W,W);
    blur(img,blurOf(S,O)*ss);
    if(O.motionPx>.2)motion(img,O.motionPx*ss);
    const out=new ImageData(n,n),d=img.data,o=out.data;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){let r=0,g=0,b=0;for(let j=0;j<ss;j++)for(let i=0;i<ss;i++){const p=((y*ss+j)*W+x*ss+i)*4;r+=d[p];g+=d[p+1];b+=d[p+2];}const q=(y*n+x)*4,m=ss*ss;o[q]=r/m;o[q+1]=g/m;o[q+2]=b/m;o[q+3]=255;}
    return out;
  }
  return{frame,loupe,addNoise,css};
})();
