/*MODEL-BEGIN*/
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const vadd=(a,b)=>a.map((x,i)=>x+b[i]);
const vsc=(a,k)=>a.map(x=>x*k);
const vmax=a=>Math.max(...a);
const vclip=a=>a.map(x=>clamp(x,0,1));
const vdiff=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function hexRgb(h){h=String(h||'#808080').replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16)||0;return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];}
function rgbHex(a){return '#'+a.map(x=>Math.round(clamp(x,0,1)*255).toString(16).padStart(2,'0')).join('');}
function mixHex(a,b,t){const A=hexRgb(a),B=hexRgb(b);return rgbHex(A.map((x,i)=>lerp(x,B[i],t)));}
function darken(hex,k){return mixHex(hex,'#000000',k);}

/* spectral bands: [UV 365, blue, green, red, NIR 850] */
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function reflOf(hex,fl,nir){const [r,g,b]=hexRgb(hex).map(c=>Math.pow(c,2.2));const lum=.25*r+.6*g+.15*b;
  const n=nir!=null?nir:lerp(.06,.45+.2*Math.sqrt(lum),smooth(.003,.018,lum));
  return[.08+(fl||0),b,g,r,n];}
const QE_M=[.25,.6,.72,.62,.3];
const QE_C=[[0,.01,.05,.55,.02],[.01,.08,.6,.06,.01],[.04,.55,.08,.01,.01]]; // R,G,B pixels (with IR-cut)
const WB=[1/.443,1/.706,1/.527];
const AMB=[.03,.8,1,.8,.6];      // plant light: fluorescent + daylight
const EMIT=[0,.7,.5,.1,0];       // fluorescence emission (blue-white)
function lnorm(L){let s=0;for(const v of L)s+=v;return s*.65;}
function sense(refl,E,N,color){
  if(!color){let s=0;for(let i=0;i<5;i++)s+=E[i]*refl[i]*QE_M[i];return[s/N];}
  return QE_C.map((q,ch)=>{let s=0;for(let i=0;i<5;i++)s+=E[i]*refl[i]*q[i];return s*WB[ch]*1.64/N;});
}

const CAMERAS=[
  {id:'vga',name:'VGA 0.3 MP',sensor:'Sony ICX424',px:[640,480],pix:7.4,fmt:'1/3"',fps:120,shutter:'global',cost:600},
  {id:'imx273',name:'1.6 MP',sensor:'Sony IMX273',px:[1440,1080],pix:3.45,fmt:'1/2.9"',fps:227,shutter:'global',cost:750},
  {id:'imx174',name:'2.3 MP',sensor:'Sony IMX174',px:[1920,1200],pix:5.86,fmt:'1/1.2"',fps:164,shutter:'global',cost:1150},
  {id:'imx264',name:'5 MP',sensor:'Sony IMX264',px:[2448,2048],pix:3.45,fmt:'2/3"',fps:35,shutter:'global',cost:1350},
  {id:'imx304',name:'12 MP',sensor:'Sony IMX304',px:[4096,3000],pix:3.45,fmt:'1.1"',fps:23,shutter:'global',cost:2700},
  {id:'imx183',name:'20 MP',sensor:'Sony IMX183',px:[5472,3648],pix:2.4,fmt:'1"',fps:18,shutter:'rolling',cost:1500},
];
const LENSES=[
  {id:'f8',name:'8 mm',f:8,minN:1.8,mod:100,circle:11,cost:320},
  {id:'f12',name:'12 mm',f:12,minN:1.8,mod:100,circle:11,cost:320},
  {id:'f16',name:'16 mm',f:16,minN:1.8,mod:100,circle:17.6,cost:520},
  {id:'f25',name:'25 mm',f:25,minN:1.8,mod:150,circle:17.6,cost:520},
  {id:'f35',name:'35 mm',f:35,minN:2,mod:200,circle:17.6,cost:560},
  {id:'f50',name:'50 mm',f:50,minN:2.4,mod:250,circle:17.6,cost:620},
  {id:'f75',name:'75 mm',f:75,minN:2.8,mod:400,circle:17.6,cost:780},
  {id:'tc05',name:'Telecentric 0.5×',tele:true,mag:.5,wd:110,N:8,circle:11,cost:1650},
  {id:'tc016',name:'Telecentric 0.16×',tele:true,mag:.16,wd:190,N:8,circle:17.6,cost:2600},
];
const LIGHTS={
  ring:{name:'Ring light',short:'Direct, bright field',sizes:[50,100,150,200],base:180,rate:2.5,cover:.8},
  dome:{name:'Dome',short:'Diffuse, shadow-free',sizes:[100,150,250,400],base:350,rate:5,cover:.55},
  coax:{name:'Coaxial',short:'On-axis diffuse',sizes:[30,50,80,100],base:450,rate:12,cover:.85},
  darkfield:{name:'Dark field',short:'Low-angle ring',sizes:[50,100,150,200],base:250,rate:3.2,cover:.8},
  bar:{name:'Bar lights',short:'Angled pair',sizes:[100,200,300,600],base:300,rate:1.6,cover:.9},
  back:{name:'Backlight',short:'Silhouette',sizes:[50,100,200,300,400],base:150,rate:3,cover:.95},
};
const TECH_EFF={dome:.8,ring:1,coax:.45,darkfield:.7,bar:.9,back:1.1};
const STAGE_BG={dome:.7,ring:.8,coax:.45,darkfield:.06,bar:.5};
const LCOL={
  white:{name:'White',short:'White',spec:[0,.8,1,.7,.02],css:'#f3f5ff',disp:'#ffffff',lam:.55},
  red:{name:'Red 625 nm',short:'Red',spec:[0,0,.03,1,0],css:'#ff4133',disp:'#ff2a1a',lam:.625},
  green:{name:'Green 525 nm',short:'Green',spec:[0,.08,1,.05,0],css:'#2fd05a',disp:'#20ff50',lam:.525},
  blue:{name:'Blue 470 nm',short:'Blue',spec:[.02,1,.1,0,0],css:'#3478ff',disp:'#2a6cff',lam:.47},
  ir:{name:'Infrared 850 nm',short:'IR',spec:[0,0,0,.02,1],css:'#6d1426',disp:'#5a0818',lam:.85},
  uv:{name:'UV 365 nm',short:'UV',spec:[1,.004,0,0,0],css:'#8b54ff',disp:'#7a3cff',lam:.365},
};
const FILT={
  none:{name:'No filter',t:[1,1,1,1,1],cost:0,tint:null},
  red:{name:'Red bandpass 635 nm',t:[0,0,.02,.9,.03],cost:95,tint:'#ff3020'},
  green:{name:'Green bandpass 525 nm',t:[0,.03,.9,.03,0],cost:95,tint:'#20d050'},
  blue:{name:'Blue bandpass 470 nm',t:[.02,.9,.05,0,0],cost:95,tint:'#3070ff'},
  ir:{name:'IR longpass 780 nm',t:[0,0,0,.06,.92],cost:95,tint:'#200008'},
  vis:{name:'UV/IR cut (visible only)',t:[0,.9,.92,.9,.02],cost:80,tint:'#d8e0ff'},
};
const MATS={
  matte:{name:'Matte plastic',surf:'matte',tex:.08,t3:{metal:0,rough:.7},hint:'Scatters light evenly. Color and shading carry most of the information.'},
  glossy:{name:'Glossy plastic or coating',surf:'specular',tex:.03,t3:{metal:0,rough:.18},hint:'Mirror-like reflections: direct lights show up as hot spots.'},
  machined:{name:'Machined or plated metal',surf:'specular',tex:.05,metal:true,t3:{metal:.95,rough:.22},hint:'Very specular. Where the light reflects decides what you see.'},
  brushed:{name:'Brushed or cast metal',surf:'textured',tex:.4,metal:true,t3:{metal:.9,rough:.5},hint:'Grain and texture compete with real defects.'},
  rubber:{name:'Rubber',surf:'matte',tex:.12,nir:.05,t3:{metal:0,rough:.95},hint:'Dark and diffuse. Little light comes back.'},
  anodized:{name:'Anodized metal',surf:'specular',tex:.06,metal:true,t3:{metal:.7,rough:.35},hint:'Colored, semi-specular metal.'},
  paper:{name:'Paper or label stock',surf:'matte',tex:.14,fluor:.5,t3:{metal:0,rough:.95},hint:'Diffuse; paper brighteners glow under UV.'},
  clear:{name:'Clear glass or film',surf:'transparent',tex:.02,t3:{metal:0,rough:.05,clear:true},hint:'Most light passes straight through.'},
};
const PRINT_COLOR='#141414';const BELT='#2a2c30';
const PRINT_BLOCKS=[{x:-12,y:8,w:56,h:20,bars:true},{x:-26,y:-18,w:36,h:4,text:true},{x:-30,y:-11,w:28,h:3,text:true},{x:26,y:-15,w:26,h:14,box:true}];
const PARTS={
  cap:{name:'Bottle cap',sub:'HDPE, Ø38 mm',shape:'circle',w:38,h:38,t:12,mat:'matte',color:'#f1f1ec',depth:1.5,feats:[{k:'ring',r:15.5},{k:'ring',r:10},{k:'ticks',r:12.8}]},
  bracket:{name:'Machined bracket',sub:'Aluminum, 80×50 mm',shape:'rect',w:80,h:50,t:8,mat:'machined',color:'#cdd1d6',depth:.5,holes:[[-30,-16,3.5],[30,-16,3.5],[-30,16,3.5],[30,16,3.5],[0,0,7]]},
  washer:{name:'Stamped washer',sub:'Steel, Ø30 mm',shape:'ring',w:30,h:30,t:2,inner:6.5,mat:'machined',color:'#b9bdc3',depth:.3},
  oring:{name:'Rubber gasket',sub:'EPDM, Ø40 mm',shape:'ring',w:40,h:40,t:4,inner:14,mat:'rubber',color:'#1b1b1b',depth:2},
  pcb:{name:'PCB assembly',sub:'FR-4, 70×45 mm',shape:'rect',w:70,h:45,t:1.6,mat:'glossy',color:'#1f6b3a',depth:3,sleeve:null,
    holes:[[-31,-18.5,1.6],[31,-18.5,1.6],[-31,18.5,1.6],[31,18.5,1.6]],
    comps:[{x:-15,y:-4,w:14,h:14,c:'#1a1a1a',hgt:1.5,k:'ic'},{x:10,y:-10,w:4,h:2,c:'#c8a060',hgt:.6},{x:10,y:-5,w:4,h:2,c:'#c8a060',hgt:.6},{x:18,y:-8,w:3.2,h:1.6,c:'#3a3a3a',hgt:.6},{x:16,y:9,w:9,h:6,c:'#dcdcdc',hgt:2.6,k:'conn'},{x:-1,y:13,w:6,h:4,c:'#b8bcc0',hgt:2,k:'xtal'},{x:27,y:1,w:3,h:3,c:'#e03030',hgt:.8}]},
  label:{name:'Carton label',sub:'Paper, 100×70 mm',shape:'rect',w:100,h:70,t:.5,mat:'paper',color:'#f5f5f0',depth:2,carton:true,print:true},
  glass:{name:'Cover glass',sub:'Clear, 50×40 mm',shape:'rect',w:50,h:40,t:1.1,mat:'clear',color:'#e4f0f0',depth:.2},
  cell:{name:'Cylindrical cell top',sub:'21700, Ø21 mm',shape:'circle',w:21,h:21,t:70,mat:'machined',color:'#c8cacc',depth:1,sleeve:'#2a62b8',feats:[{k:'ring',r:9.6},{k:'ring',r:6.2},{k:'vent'}]},
  housing:{name:'Molded housing',sub:'PC/ABS, 60×40 mm',shape:'rect',w:60,h:40,t:15,mat:'matte',color:'#2d2f33',depth:3,holes:[[-22,0,3],[22,0,3]],feats:[{k:'ribs'}]},
  plate:{name:'Brushed plate',sub:'Titanium, 90×60 mm',shape:'rect',w:90,h:60,t:5,mat:'brushed',color:'#aeb2b8',depth:.3,holes:[[-38,-23,3],[38,-23,3],[-38,23,3],[38,23,3]]},
};
const DEFS={
  scratch:{name:'Scratch',aff:{dome:.45,ring:.85,coax:1,darkfield:1.1,bar:.95},kind:'surface',shape:'line',topo:.9,w:.08,l:6,wr:[.02,1.5],lr:[.5,40],about:'Shallow groove. Changes surface slope, not color.'},
  crack:{name:'Hairline crack',aff:{dome:.5,ring:.8,coax:1,darkfield:1,bar:.85},kind:'surface',shape:'crack',topo:1,colored:true,autoDark:.4,w:.05,l:4,wr:[.02,.5],lr:[.5,30],about:'Very narrow break; traps dirt and scatters light.'},
  dent:{name:'Dent',aff:{dome:.25,ring:.5,coax:.85,darkfield:.35,bar:1.15},kind:'surface',shape:'dent',topo:.6,round:true,w:1.5,l:1.5,wr:[.2,10],about:'Gentle depression. Only slope changes.'},
  stain:{name:'Stain',kind:'surface',shape:'blob',topo:0,colored:true,color:'#7b4f26',w:3,l:4,wr:[.3,20],lr:[.3,30],about:'Color or reflectance change with no height.'},
  oil:{name:'Oil or glue residue',kind:'surface',shape:'blob',topo:.05,colored:true,autoDark:.1,fluor:true,w:5,l:4,wr:[.5,20],lr:[.5,30],about:'Nearly invisible film. Often fluoresces under UV.'},
  debris:{name:'Particle',aff:{dome:.6,darkfield:1.1},kind:'surface',shape:'dot',topo:.8,colored:true,color:'#2f2f2f',round:true,w:.3,l:.3,wr:[.05,3],about:'Raised foreign particle with its own color.'},
  bubble:{name:'Bubble or void',aff:{dome:.5,darkfield:1,back:1.1},kind:'surface',shape:'bubble',topo:.85,round:true,w:.4,l:.4,wr:[.05,4],about:'Trapped air. Bends light at its edges.'},
  print:{name:'Print smear',nir:.05,kind:'surface',shape:'smear',topo:0,colored:true,color:'#161616',w:.6,l:6,wr:[.1,4],lr:[.5,40],about:'Stray ink. Pure color contrast.'},
  chip:{name:'Edge chip',kind:'edge',shape:'chip',topo:.5,w:1,l:2,wr:[.2,5],lr:[.3,10],about:'Material missing from the outline.'},
  burr:{name:'Burr or flash',kind:'edge',shape:'burr',topo:.6,w:.5,l:3,wr:[.1,5],lr:[.3,12],about:'Extra material sticking out of the outline.'},
  missing:{name:'Missing feature',kind:'feature',shape:'missing',topo:.5,w:3,l:3,about:'A hole, component or print block that is absent. Snaps to the nearest feature.'},
};
const CHALLENGES=[
 {id:'c1',title:'Clean caps only',client:'Northgate Pharma',industry:'Pharmaceutical packaging',part:'cap',material:'matte',color:'#f1f1ec',speed:150,ppm:240,depth:1.5,ambient:'medium',budget:3200,
  brief:'White HDPE caps ride a slow conveyor. Reject caps with brown stains, dark particles, or a chipped rim before they reach the capper.',
  defects:[{t:'stain',u:.34,v:.38,w:2.2,l:3,color:'#c49a6c',ang:30},{t:'debris',u:.64,v:.6,w:.25},{t:'chip',u:.98,v:.55,w:1,l:2.2}],
  tip:'A brown stain absorbs blue light strongly while white plastic reflects it.'},
 {id:'c2',title:'Mirror finish',client:'Keel Automotive',industry:'Powertrain machining',part:'bracket',material:'machined',color:'#cdd1d6',speed:0,ppm:20,depth:.5,ambient:'medium',budget:4800,
  brief:'Freshly machined aluminum brackets are indexed under the camera. Tooling scratches down to 0.06 mm wide and handling dents must be caught on the sealing face.',
  defects:[{t:'scratch',u:.3,v:.28,w:.08,l:7,ang:18},{t:'scratch',u:.58,v:.76,w:.06,l:5,ang:-35},{t:'dent',u:.72,v:.62,w:1.2}],
  tip:'On a flat mirror-like face, light that arrives straight down comes straight back.'},
 {id:'c3',title:'Gasket flash',client:'Borealis Seals',industry:'Rubber molding',part:'oring',material:'rubber',color:'#1b1b1b',speed:0,ppm:40,depth:2,ambient:'high',budget:3000,
  brief:'Black EPDM gaskets come off the press with occasional flash on the outer edge, knife cuts, and white lint. The cell sits beside a loading dock with daylight.',
  defects:[{t:'burr',u:.99,v:.4,w:.6,l:3.5},{t:'chip',u:.05,v:.7,w:.8,l:1.6},{t:'debris',u:.5,v:.12,w:.3,color:'#d9d9d9'}],
  tip:'Outline defects on a black part show best as a silhouette, but lint is not part of the outline.'},
 {id:'c4',title:'Board check',client:'Circuitline EMS',industry:'Electronics assembly',part:'pcb',material:'glossy',color:'#1f6b3a',speed:100,ppm:120,depth:3,ambient:'medium',budget:4200,
  brief:'After reflow, confirm every part is placed and flag amber flux residue and stray solder balls. Components stand up to 3 mm tall.',
  defects:[{t:'missing',u:.61,v:.39},{t:'stain',u:.3,v:.78,w:3,l:2.2,color:'#c9902e'},{t:'debris',u:.78,v:.72,w:.3,color:'#c9c9c9'}],
  tip:'Amber on green: pick a light color the residue reflects and the board absorbs.'},
 {id:'c5',title:'Crystal clear',client:'Lumen Optics',industry:'Optical components',part:'glass',material:'clear',color:'#e4f0f0',speed:0,ppm:15,depth:.2,ambient:'low',budget:5200,
  brief:'Cover glass for camera modules. Particles, bubbles and hairline scratches as small as 0.03 mm must be rejected.',
  defects:[{t:'debris',u:.3,v:.35,w:.1,color:'#333333'},{t:'bubble',u:.66,v:.58,w:.15},{t:'scratch',u:.45,v:.75,w:.03,l:4,ang:10}],
  tip:'Clear parts are easier to judge by the light that passes through them, or by light scattered at a low angle.'},
 {id:'c6',title:'Moving target',client:'Portage Logistics',industry:'Distribution center',part:'label',material:'paper',color:'#f5f5f0',speed:1500,ppm:90,depth:20,ambient:'high',budget:4000,
  brief:'Cartons fly past at 1.5 m/s. Catch smeared print and water stains on the shipping label. Carton heights vary by 20 mm.',
  defects:[{t:'print',u:.5,v:.62,w:.6,l:9,ang:-8},{t:'stain',u:.78,v:.3,w:6,l:5,color:'#bba27a'}],
  tip:'Motion blur and depth of field are the hard parts here, not contrast.'},
 {id:'c7',title:'Cell top',client:'Voltline Cells',industry:'Battery manufacturing',part:'cell',material:'machined',color:'#c8cacc',speed:300,ppm:600,depth:1,ambient:'medium',budget:4600,
  brief:'Nickel-plated 21700 cell tops pass at 10 cells per second. Find dents, fine scratches and dark particles on the cap.',
  defects:[{t:'dent',u:.35,v:.4,w:.8},{t:'scratch',u:.6,v:.62,w:.05,l:3,ang:40},{t:'debris',u:.62,v:.3,w:.2,color:'#444444'}],
  tip:'The cap is small, shiny, and fast. Check the camera frame rate.'},
 {id:'c8',title:'Titanium cracks',client:'Aerion Aerospace',industry:'Aerospace fasteners',part:'plate',material:'brushed',color:'#aeb2b8',speed:0,ppm:6,depth:.3,ambient:'low',budget:6500,
  brief:'Brushed titanium plates. Hairline cracks of 0.04 mm hide in the grain; corrosion spots and chipped edges also reject.',
  defects:[{t:'crack',u:.4,v:.45,w:.04,l:5,ang:60},{t:'chip',u:.72,v:.01,w:.6,l:1.4},{t:'stain',u:.25,v:.75,w:3,l:3,color:'#7a5230'}],
  tip:'Lighting that makes the brushed grain glow will bury the crack.'},
 {id:'c9',title:'Glue check',client:'Kinetic Mold',industry:'Injection molding',part:'housing',material:'matte',color:'#2d2f33',speed:0,ppm:30,depth:3,ambient:'medium',budget:3800,
  brief:'Dark housings get a clear adhesive bead. Flag glue smeared on the cosmetic face, stray particles, and molding flash on the edge.',
  defects:[{t:'oil',u:.52,v:.3,w:5,l:4},{t:'debris',u:.3,v:.7,w:.8,color:'#b0b0b0'},{t:'burr',u:.99,v:.35,w:1.2,l:5}],
  tip:'Clear glue on dark plastic is close to invisible under normal light. Many adhesives carry a tracer that glows.'},
  {id:'c10',title:'Washer edges',client:'Fabrite Stamping',industry:'Metal stamping',part:'washer',material:'machined',color:'#b9bdc3',speed:0,ppm:45,depth:.3,ambient:'medium',budget:5200,
  brief:'Stamped steel washers are checked for rolled burrs on the outer edge and nicks in the bore. Only the outline matters: a burr of 0.12 mm is a reject.',
  defects:[{t:'burr',u:.99,v:.42,w:.12,l:1.2},{t:'chip',u:.03,v:.62,w:.25,l:.8}],
  tip:'If only the outline matters, stop lighting the surface and light the background instead.'},
 {id:'c11',title:'Anodized color',client:'Riverline Anodizing',industry:'Surface finishing',part:'bracket',material:'anodized',color:'#7a1f2b',speed:0,ppm:25,depth:.5,ambient:'medium',budget:5400,requireColor:true,
  brief:'Red anodized brackets must match the color standard, so the customer needs the shade verified as well as the defects: faded patches and scratches that expose bare aluminum.',
  defects:[{t:'stain',u:.3,v:.35,w:5,l:4,color:'#b06a52'},{t:'scratch',u:.62,v:.66,w:.12,l:6,ang:-25,color:'#d8dade'}],
  tip:'A color judgment rules out narrowband light, and a semi-specular finish punishes anything direct.'},
 {id:'c12',title:'Daylight glare',client:'Harbour Beverage',industry:'Beverage packaging',part:'cap',material:'glossy',color:'#123a7a',speed:200,ppm:300,depth:1.5,ambient:'high',budget:3600,
  brief:'Glossy blue closures run past a bay door on a sunny line. Scuffs and stray debris on the top face are missed whenever the sun moves.',
  defects:[{t:'scratch',u:.42,v:.38,w:.12,l:5,ang:15},{t:'debris',u:.6,v:.64,w:.3,color:'#c0c0c0'}],
  tip:'You cannot remove the sun, but you can make your own light win: keep the exposure short and pulse the LED hard, then shield or filter what is left.'},
 {id:'c13',title:'Deep pockets',client:'Lakeshore Molding',industry:'Injection molding',part:'housing',material:'matte',color:'#8a8f96',speed:0,ppm:20,depth:12,ambient:'low',budget:4400,
  brief:'Grey housings sit 12 mm deeper at the pocket floor than at the rim. Scratches and dark specks must be caught on both levels in a single image.',
  defects:[{t:'scratch',u:.35,v:.35,w:.06,l:4,ang:35},{t:'debris',u:.66,v:.62,w:.18,color:'#2b2b2b'},{t:'stain',u:.5,v:.78,w:3,l:2.5,color:'#5a5f66'}],
  tip:'Closing the aperture buys depth of field until diffraction starts costing you more than it gives.'},
 {id:'c14',title:'Piano black',client:'Crestview Devices',industry:'Consumer electronics',part:'housing',material:'glossy',color:'#14161a',speed:0,ppm:30,depth:2,ambient:'medium',budget:5000,
  brief:'High-gloss black covers are a cosmetic surface. Fine scratches and a shallow dent have to be caught without the light itself showing up as a reflection.',
  defects:[{t:'scratch',u:.36,v:.4,w:.08,l:6,ang:20},{t:'scratch',u:.64,v:.58,w:.05,l:4,ang:-50},{t:'dent',u:.48,v:.72,w:1.5}],
  tip:'On a mirror, the camera sees the light fixture, not the part. Either fill the whole reflection or keep the light out of it.'},
];
const byId=a=>Object.fromEntries(a.map(x=>[x.id,x]));
const CAM=byId(CAMERAS), LENS=byId(LENSES);

/* ---------- geometry helpers ---------- */
function featureList(P){
  const f=[];
  (P.holes||[]).forEach(h=>f.push({kind:'hole',x:h[0],y:h[1],r:h[2],w:h[2]*2,h:h[2]*2}));
  (P.comps||[]).forEach(c=>f.push({kind:'comp',x:c.x,y:c.y,w:c.w,h:c.h,c:c.c,src:c}));
  if(P.print)PRINT_BLOCKS.forEach(b=>f.push({kind:'print',x:b.x,y:b.y,w:b.w,h:b.h,src:b}));
  return f;
}
function nearestFeature(P,x,y,fl){fl=fl||featureList(P);let bi=-1,bd=1e9;fl.forEach((f,i)=>{const d=Math.hypot(f.x-x,f.y-y)-Math.max(f.w,f.h)*.3;if(d<bd){bd=d;bi=i;}});return bi;}
function edgeAnchor(P,x,y){
  if(P.shape==='rect'){const hw=P.w/2,hh=P.h/2;const d=[hw-x,x+hw,hh-y,y+hh];const i=d.indexOf(Math.min(...d));
    if(i===0)return{x:hw,y:clamp(y,-hh+1,hh-1),nx:1,ny:0};if(i===1)return{x:-hw,y:clamp(y,-hh+1,hh-1),nx:-1,ny:0};
    if(i===2)return{x:clamp(x,-hw+1,hw-1),y:hh,nx:0,ny:1};return{x:clamp(x,-hw+1,hw-1),y:-hh,nx:0,ny:-1};}
  const R=P.w/2,a=Math.atan2(y,x);return{x:R*Math.cos(a),y:R*Math.sin(a),nx:Math.cos(a),ny:Math.sin(a)};
}
function inShape(P,x,y){
  if(P.shape==='rect'){if(Math.abs(x)>P.w/2||Math.abs(y)>P.h/2)return false;}
  else{const r=Math.hypot(x,y);if(r>P.w/2)return false;if(P.shape==='ring'&&r<P.inner)return false;}
  for(const h of(P.holes||[]))if(Math.hypot(x-h[0],y-h[1])<h[2])return false;
  return true;
}
function defGeom(S,d){
  const P=PARTS[S.part],D=DEFS[d.type];
  const x=(d.u-.5)*P.w,y=(d.v-.5)*P.h,w=d.w,l=D.round?d.w:d.l;
  if(D.kind==='edge'){const a=edgeAnchor(P,x,y);return{x:a.x,y:a.y,w,l,a};}
  if(D.kind==='feature'){const fl=featureList(P);if(!fl.length)return{x,y,w:.01,l:.01,feat:null,fi:-1};
    const i=nearestFeature(P,x,y,fl),f=fl[i];return{x:f.x,y:f.y,w:Math.min(f.w,f.h),l:Math.max(f.w,f.h),feat:f,fi:i};}
  return{x,y,w,l};
}
function defRefl(S,d){const D=DEFS[d.type];const c=defColor(S,d);const r=reflOf(c,0,D.nir!=null?D.nir:(!d.color&&D.autoDark!=null?reflOf(S.color,0,MATS[S.material].nir)[4]*(1-D.autoDark*.3):null));return(!d.color&&D.autoDark!=null)?metalUV(r,MATS[S.material]):r;}
function metalUV(r,M){if(M&&M.metal)r[0]=.85*(r[1]+r[2]+r[3])/3;return r;}
function defColor(S,d){const D=DEFS[d.type];return d.color||(D.autoDark!=null?darken(S.color,D.autoDark):D.color||'#444444');}
function missingSet(S){const P=PARTS[S.part];const s=new Set();S.defects.forEach(d=>{if(d.type==='missing'){const g=defGeom(S,d);if(g.fi>=0)s.add(g.fi);}});return s;}

/* ---------- optics ---------- */
function optics(S){
  const cam=CAM[S.cam],lens=LENS[S.lens];
  const sw=cam.px[0]*cam.pix/1000,sh=cam.px[1]*cam.pix/1000,sd=Math.hypot(sw,sh);
  let m,focusErr=0,mod=0,maxWd=Infinity;
  const N=lens.tele?lens.N:Math.max(S.N,lens.minN);
  if(lens.tele){m=lens.mag;const dd=Math.abs(S.wd-lens.wd);if(dd>4)focusErr=dd-4;mod=lens.wd-4;maxWd=lens.wd+4;}
  else{const wd=Math.max(S.wd,lens.f*1.6);m=lens.f/(wd-lens.f);
    mod=S.spacer?lens.mod*.35:lens.mod;maxWd=S.spacer?lens.mod*1.3:Infinity;
    if(S.wd<mod)focusErr=mod-S.wd;else if(S.wd>maxWd)focusErr=S.wd-maxWd;}
  const fovW=sw/m,fovH=sh/m,mmpp=fovW/cam.px[0];
  const eff=mmpp*(S.colorCam?1.4:1);
  const defocus=S.depth/2+focusErr;
  const blurDof=defocus*m*m/(N*(1+m));
  const dofPx=blurDof*1000/cam.pix;
  const lam=LCOL[S.lcolor].lam;
  const diffPx=1.22*lam*N*(1+m)/cam.pix;
  const c=2*cam.pix/1000;const dof=2*N*(1+m)*c/(m*m);
  const motionPx=S.speed*S.expo/1000/mmpp;
  const blurPx=Math.hypot(dofPx,diffPx,motionPx);
  const vignette=sd>lens.circle*1.02?clamp((sd-lens.circle)/lens.circle,0,1):0;
  return{cam,lens,sw,sh,sd,m,N,fovW,fovH,mmpp,eff,dof,dofPx,diffPx,motionPx,blurPx,focusErr,mod,maxWd,vignette};
}
function lightClearance(S){const s=S.lsize;return{ring:25,dome:s/2+10,coax:s+15,darkfield:20,bar:0,back:0}[S.tech];}
function lightCost(S){const L=LIGHTS[S.tech];return Math.round((L.base+L.rate*S.lsize)*({uv:1.5,ir:1.2}[S.lcolor]||1));}
function costParts(S){
  const c=CAM[S.cam],l=LENS[S.lens];
  const rows=[['Camera',c.cost+(S.colorCam?120:0)],['Lens',l.cost],['Light',lightCost(S)],['Mounting and cables',250]];
  if(S.strobe)rows.push(['Strobe controller',380]);
  if(S.filter!=='none')rows.push(['Filter',FILT[S.filter].cost]);
  if(S.pol)rows.push(['Polarizer kit',180]);
  if(S.shroud)rows.push(['Light shroud',260]);
  if(S.spacer)rows.push(['Spacer ring',45]);
  return rows;
}
function costOf(S){return costParts(S).reduce((a,r)=>a+r[1],0);}

/* ---------- lighting context ---------- */
function lightCtx(S,O){
  const P=PARTS[S.part],M=MATS[S.material],surf=M.surf,back=S.tech==='back',opaque=surf!=='transparent';
  let r;
  if(S.tech==='bar'){const T=RESP[surf],a=S.barAngle;const [A,B,t]=a<=45?[T.darkfield,T.bar,(a-10)/35]:[T.bar,T.ring,(a-45)/35];const tt=clamp(t,0,1);r={};
    for(const k of['bg','glare','col','tex'])r[k]=lerp(A[k],B[k],tt);
    const near=tt<.5?A:B;r.topo=Math.sign(near.topo)*lerp(Math.abs(A.topo),Math.abs(B.topo),tt);}
  else r={...RESP[surf][S.tech]};
  if(back&&opaque)r={bg:0,glare:0,topo:0,col:0,tex:0};
  if(S.pol){r.glare*=.12;if(M.metal){r.bg*=.4;r.topo*=.5;}else if(surf==='specular'){r.topo*=.7;}}
  const L=LCOL[S.lcolor].spec,F=FILT[S.filter].t;
  const E=L.map((v,i)=>v*F[i]),Nn=lnorm(L),color=!!S.colorCam;
  const sn=refl=>sense(refl,E,Nn,color);
  const cam=O.cam,gainLin=Math.pow(10,S.gain/20);
  const expoF=(S.expo/5)*Math.pow(4/O.N,2)*Math.pow(cam.pix/3.45,2)*gainLin*(color?.6:1)*(S.pol?.35:1);
  const K=(S.intensity/60)*(S.strobe?3:1)*expoF*TECH_EFF[S.tech];
  const ambLvl={low:.015,medium:.07,high:.22}[S.ambient]*(S.shroud?.07:1);
  const Ea=AMB.map((v,i)=>v*F[i]),Na=lnorm(AMB),ambK=ambLvl*expoF;
  const ambOf=refl=>vsc(sense(refl,Ea,Na,color),ambK*(opaque?.7:.3));
  const white=[1,1,1,1,1],whiteV=sn(white);
  const zero=whiteV.map(()=>0);
  const partRefl=metalUV(reflOf(S.color,0,M.nir),M);
  const isUV=S.lcolor==='uv';
  const emV=isUV?sense(white,EMIT.map((v,i)=>v*F[i]),Nn,color):zero;
  const partFl=(isUV&&M.fluor&&!(back&&opaque))?vsc(emV,M.fluor*Math.max(r.bg,.3)):zero;
  const partRaw=vadd(vsc(sn(partRefl),r.bg),partFl);
  const beltRefl=reflOf(BELT,0,.05);
  const stageRaw=back?whiteV.slice():vsc(sn(beltRefl),STAGE_BG[S.tech]);
  const stageAmb=back?zero:ambOf(beltRefl);
  const topoScale={matte:.6,specular:1,textured:.8,transparent:1}[surf];
  const topoV=surf==='matte'?vadd(vsc(whiteV,.5),vsc(sn(partRefl),.5)):whiteV;
  const clutter=K*M.tex*r.tex*.35*vmax(whiteV);
  const Ld=LIGHTS[S.tech],diag=Math.hypot(P.w,P.h);
  let unif=clamp(S.lsize*Ld.cover/diag,0,1);if(S.tech==='darkfield')unif*=unif;unif=Math.max(unif,.15);
  return{P,M,surf,back,opaque,r,E,Nn,sn,K,ambK,ambLvl,ambOf,whiteV,zero,partRefl,emV,isUV,partFl,partRaw,partAmb:ambOf(partRefl),stageRaw,stageAmb,topoScale,topoV,clutter,unif,gainLin,color};
}
const ZR={bg:0,glare:0,topo:0,col:0,tex:0};
const RESP={
  matte:{dome:{bg:.78,glare:0,topo:.12,col:1,tex:.25},ring:{bg:.85,glare:.04,topo:.3,col:.95,tex:.45},coax:{bg:.6,glare:0,topo:.22,col:.85,tex:.3},darkfield:{bg:.1,glare:0,topo:.85,col:.25,tex:.8},bar:{bg:.62,glare:.03,topo:-.55,col:.8,tex:.7},back:ZR},
  specular:{dome:{bg:.72,glare:.06,topo:.1,col:.9,tex:.15},ring:{bg:.45,glare:.85,topo:.45,col:.55,tex:.55},coax:{bg:.92,glare:0,topo:-.9,col:.6,tex:.3},darkfield:{bg:.05,glare:0,topo:.95,col:.15,tex:.45},bar:{bg:.25,glare:.55,topo:.6,col:.45,tex:.6},back:ZR},
  textured:{dome:{bg:.66,glare:.02,topo:.18,col:.9,tex:.2},ring:{bg:.6,glare:.45,topo:.3,col:.6,tex:.85},coax:{bg:.55,glare:.1,topo:-.5,col:.6,tex:.95},darkfield:{bg:.28,glare:0,topo:.6,col:.2,tex:1},bar:{bg:.5,glare:.2,topo:.45,col:.6,tex:.9},back:ZR},
  transparent:{dome:{bg:.25,glare:.15,topo:.2,col:.35,tex:.1},ring:{bg:.2,glare:.7,topo:.35,col:.3,tex:.2},coax:{bg:.3,glare:.3,topo:-.4,col:.3,tex:.15},darkfield:{bg:.04,glare:0,topo:.9,col:.2,tex:.2},bar:{bg:.15,glare:.4,topo:.5,col:.3,tex:.2},back:{bg:.88,glare:0,topo:-.85,col:.7,tex:.1}},
};
function glareAt(S,X,x,y){
  const g=X.r.glare;if(g<=0)return 0;
  const P=X.P,rx=x/(P.w/2),ry=y/(P.h/2),rho=Math.hypot(rx,ry);let v;
  if(S.tech==='ring')v=Math.exp(-Math.pow((rho-.42)/.13,2));
  else if(S.tech==='bar')v=Math.exp(-Math.pow((ry+.15)/.25,2));
  else v=Math.exp(-Math.pow(rho/.35,2));
  return g*v;
}
function surfaceV(X,hex,K,nir){const refl=reflOf(hex,0,nir);return vadd(vsc(vadd(vsc(X.sn(refl),X.r.col),vsc(X.sn(X.partRefl),1-X.r.col)),X.r.bg*K),X.ambOf(refl));}
function defectLevels(S,X,d,G,illum,gl){
  const D=DEFS[d.type],r=X.r,K=X.K*illum;
  const glV=vsc(X.whiteV,X.K*gl*1.6);
  const partV=vadd(vadd(vsc(X.partRaw,K),X.partAmb),glV);
  let exp,act,unit=vmax(X.partRaw);
  if(D.kind!=='surface'){
    const stage=vadd(vsc(X.stageRaw,K),X.stageAmb);
    const glint=X.back?X.zero:vsc(X.topoV,K*D.topo*Math.abs(r.topo)*X.topoScale*.5);
    if(X.back)unit=Math.max(unit,vmax(X.stageRaw));
    if(d.type==='chip'){exp=partV;act=vadd(stage,glint);}
    else if(d.type==='burr'){exp=stage;act=vadd(partV,glint);}
    else{const f=G.feat;
      if(!f){exp=partV;act=partV;}
      else if(f.kind==='hole'){exp=X.back?stage:vadd(vsc(partV,.12),glint);act=partV;}
      else{const col=f.kind==='print'?PRINT_COLOR:f.c;exp=vadd(surfaceV(X,col,K,f.kind==='print'?.05:null),glV);act=partV;}}
  }else{
    const cr=D.colored?defRefl(S,d):null;
    let base=cr?vadd(vsc(X.sn(cr),r.col*r.bg),vsc(X.sn(X.partRefl),(1-r.col)*r.bg)):vsc(X.sn(X.partRefl),r.bg);
    base=vadd(base,vsc(X.partFl,cr?.4:1));
    if(X.isUV&&D.fluor&&!(X.back&&X.opaque))base=vadd(base,vsc(X.emV,1.1));
    const aff=(D.aff&&D.aff[S.tech]!=null)?D.aff[S.tech]:1;
    const topo=vsc(X.topoV,Math.sign(r.topo)*D.topo*aff*Math.abs(r.topo)*X.topoScale);
    const raw=vadd(base,topo);unit=Math.max(unit,vmax(raw));
    act=vadd(vadd(vsc(raw,K),cr?X.ambOf(cr):X.partAmb),glV);
    exp=partV;
  }
  return{exp,act,unit};
}

/* ---------- evaluation ---------- */
const f1=v=>(Math.abs(v)>=100?Math.round(v):Math.abs(v)>=10?v.toFixed(1):v>=1?v.toFixed(2):v.toPrecision(2)).toString();
const money=v=>'$'+Math.round(v).toLocaleString('en-US');
function evaluate(S,opts={}){
  const ideal=!!opts.ideal;
  const O=optics(S),X=lightCtx(S,O),P=X.P;
  const out={O,X,defs:[],issues:[],score:0};
  let penalty=1;
  const addI=(sev,text,pen)=>{out.issues.push({sev,text});if(pen)penalty*=1-pen;};
  const partV=vadd(vsc(X.partRaw,X.K),X.partAmb);
  const stageV=vadd(vsc(X.stageRaw,X.K),X.stageAmb);
  let lvlUnit=vmax(X.partRaw);if(X.back)lvlUnit=Math.max(lvlUnit,vmax(X.stageRaw));
  const gN=X.gainLin,cc=X.color?1.7:1;
  const nA=.004*gN*cc,nB=.014*Math.sqrt(gN)/(O.cam.pix/3.45)*cc;
  const flick=.3*vmax(X.partAmb);
  out.noiseA=nA;out.noiseB=nB;out.flick=flick;
  const fovW=O.fovW,fovH=O.fovH;
  for(const d of S.defects){
    const D=DEFS[d.type],G=defGeom(S,d);
    const inF=Math.abs(G.x)<fovW/2&&Math.abs(G.y)<fovH/2;
    const rho=P.shape==='rect'?Math.max(Math.abs(G.x)/(P.w/2),Math.abs(G.y)/(P.h/2)):Math.hypot(G.x,G.y)/(P.w/2);
    const illum=1-(1-X.unif)*Math.pow(clamp(rho,0,1),2);
    const vr=Math.hypot(G.x/(fovW/2),G.y/(fovH/2))/Math.SQRT2;
    const vig=ideal?1:1-O.vignette*.8*Math.pow(clamp(vr,0,1),2);
    const gl=glareAt(S,X,G.x,G.y);
    const L=defectLevels(S,X,d,G,illum*vig,gl);
    lvlUnit=Math.max(lvlUnit,L.unit);
    const drawV=defectLevels(S,X,d,G,1,0).act;
    const e=vclip(L.exp),a=vclip(L.act);
    const C=G.feat===null?0:vdiff(e,a);
    const lvl=Math.max(vmax(e),vmax(a));
    const sN=nA+nB*Math.sqrt(Math.max(lvl,.02));
    const sig=Math.hypot(sN,X.clutter*illum,flick);
    const wpx=G.w/O.eff,lpx=G.l/O.eff;
    const blur=ideal?0:O.blurPx;
    const att=ideal?1:Math.pow(Math.min(1,wpx),.85)*(wpx/(wpx+.7*blur));
    const line=D.shape==='line'||D.shape==='crack'||D.shape==='smear';
    const elong=line?clamp(Math.sqrt(lpx/Math.max(wpx,1))/1.5,1,1.8):1;
    const cnr=C*att*elong/sig;
    const sizeS=ideal?1:line?clamp((lpx-2)/4,0,1)*clamp((wpx-.25)/.5,0,1):clamp((wpx-.7)/2.3,0,1);
    const cnrS=clamp((cnr-1)/7,0,1);
    let sc=100*Math.pow(cnrS,.6)*Math.pow(sizeS,.4);
    if(!inF&&!ideal)sc=0;
    out.defs.push({d,D,G,C,cnr,wpx,lpx,att,sig,score:sc,inF,exp:e,act:a,drawV,verdict:sc>=75?'pass':sc>=55?'marginal':'miss'});
  }
  out.lvlUnit=lvlUnit;
  out.partV=partV;out.stageV=stageV;
  out.cost=costOf(S);
  const sc=out.defs.map(x=>x.score);
  let base=sc.length?.6*sc.reduce((a,b)=>a+b,0)/sc.length+.4*Math.min(...sc):0;
  if(!ideal){
    const fw=P.w/fovW,fh=P.h/fovH;
    if(fw>1||fh>1)addI('fail',`The part is ${P.w}×${P.h} mm but the field of view is only ${f1(fovW)}×${f1(fovH)} mm, so part of it is cut off.`,.35);
    else if(fw>.95||fh>.95)addI('warn','The part fills the image edge to edge, leaving no margin for position variation.',.08);
    else if(Math.max(fw,fh)<.35)addI('info','The part fills less than 35% of the image. Most pixels are looking at the conveyor.');
    if(O.vignette>0)addI('warn',`The ${O.cam.fmt} sensor is larger than this lens covers (${O.lens.circle} mm image circle), so the corners go dark.`,.12);
    if(O.focusErr>0)addI('fail',O.lens.tele?`A telecentric lens only focuses at its ${O.lens.wd} mm working distance.`:(S.wd<O.mod?`The lens cannot focus closer than ${Math.round(O.mod)} mm.${S.spacer?'':' A spacer ring lets it focus closer.'}`:`With the spacer ring fitted, the lens cannot focus beyond ${Math.round(O.maxWd)} mm.`),.25);
    if(O.motionPx>1)addI(O.motionPx>3?'fail':'warn',`Motion blur is ${f1(O.motionPx)} px at ${S.speed} mm/s. Shorten the exposure; a strobe supplies the extra light.`,O.motionPx>3?.2:.06);
    if(O.cam.shutter==='rolling'&&S.speed>20){if(S.strobe&&S.shroud)addI('warn','Rolling shutter with a moving part only works because the strobe freezes motion inside a dark shroud.',.06);else addI('fail','A rolling shutter skews moving parts. Use a global shutter camera, or strobe inside a shroud.',.25);}
    const need=S.ppm/60;
    if(O.cam.fps<need*1.2)addI('fail',`The camera tops out at ${O.cam.fps} fps; the line needs ${f1(need)} images per second plus margin.`,.3);
    const mp=O.cam.px[0]*O.cam.px[1]/1e6;
    if(mp*need>60)addI('warn',`${f1(mp*need)} megapixels per second is a heavy processing load for a typical vision controller.`,.05);
    const pv=vmax(vclip(partV));
    const peak=Math.max(pv,...out.defs.map(x=>Math.max(vmax(x.exp),vmax(x.act))),X.back?vmax(vclip(stageV)):0);
    if(peak<.2)addI('warn','The image is underexposed. Raise intensity or exposure time, or open the aperture.',.12);
    if(pv>=.99&&!X.back)addI('warn','The part surface is saturated to pure white, which clips detail.',.08);
    if(S.gain>12)addI('info',`${f1(S.gain)} dB of gain adds visible noise. More light or a wider aperture is cleaner.`);
    const ambRatio=vmax(X.partAmb)/Math.max(vmax(partV),.01);
    if(ambRatio>.15)addI('warn',`Plant lighting makes up ${Math.round(ambRatio*100)}% of the part brightness. Add a shroud or a bandpass filter, or strobe with a short exposure.`,.1);
    if(X.unif<.85)addI('warn',`A ${S.lsize} mm ${LIGHTS[S.tech].name.toLowerCase()} does not light the whole part evenly.`,.1*(1-X.unif)+.04);
    const req=lightClearance(S);
    if(S.wd<req)addI('fail',`The ${LIGHTS[S.tech].name.toLowerCase()} needs at least ${Math.round(req)} mm between lens and part; the working distance is ${S.wd} mm.`,.3);
    if(S.requireColor&&!S.colorCam)addI('fail','The customer needs color verification, which a mono camera cannot provide.',.3);
    if(O.dof<S.depth)addI('warn',`Depth of field is ${f1(O.dof)} mm but the surface height varies by ${f1(S.depth)} mm. Stop down or lower the magnification.`);
    if(S.budget&&out.cost>S.budget)addI('fail',`System cost ${money(out.cost)} is over the ${money(S.budget)} budget.`,.2+Math.min(.3,(out.cost-S.budget)/S.budget));
    out.defs.forEach(x=>{if(!x.inF)addI('fail',`The ${x.D.name.toLowerCase()} is outside the field of view.`);if(x.G.feat===null)addI('info','This part has no features, so a missing-feature defect has nothing to check.');});
  }
  out.score=Math.round(clamp(base*penalty,0,100));
  out.stars=out.score>=85?3:out.score>=65?2:out.score>=40?1:0;
  return out;
}

/* ---------- auto exposure ---------- */
function autoExpose(S){
  const T={...S,intensity:60,expo:5,gain:0,strobe:false};
  const O=optics(T),E=evaluate(T,{ideal:true});
  const lvl1=E.X.K*E.lvlUnit;
  if(!(lvl1>1e-6))return S;
  const f=.78/lvl1;
  const tmax=S.speed>0?clamp(.5*O.mmpp*1000/S.speed,.005,50):50;
  let t=Math.min(tmax,{low:8,medium:4,high:1.5}[S.ambient]||4);
  let I=60*f*5/t,strobe=false,gain=0;
  if(I>100){strobe=true;I/=3;}
  if(I>100){let g=I/100;I=100;const tl=Math.min(tmax,t*g);g*=t/tl;t=tl;gain=clamp(20*Math.log10(Math.max(g,1)),0,24);}
  if(I<8){t=Math.max(.005,t*I/8);I=8;}
  if(strobe&&I<30&&t*3<=tmax){strobe=false;I*=3;}
  S.intensity=Math.round(clamp(I,1,100));S.expo=+t.toPrecision(2);S.gain=Math.round(gain*2)/2;S.strobe=strobe;
  return S;
}
function fitWd(S){
  const cam=CAM[S.cam],lens=LENS[S.lens],P=PARTS[S.part];
  if(lens.tele)return lens.wd;
  const sw=cam.px[0]*cam.pix/1000,sh=cam.px[1]*cam.pix/1000;
  const m=Math.min(sw/(P.w*1.2),sh/(P.h*1.2));
  let wd=lens.f*(1+1/m);
  const mod=S.spacer?lens.mod*.35:lens.mod;
  wd=Math.max(wd,mod,lightClearance(S));
  if(S.spacer)wd=Math.min(wd,lens.mod*1.3);
  return Math.round(clamp(wd,40,1200)/5)*5;
}
function pickSize(tech,P){const L=LIGHTS[tech],diag=Math.hypot(P.w,P.h),need=tech==='darkfield'?diag*1.08:diag;for(const s of L.sizes)if(s*L.cover>=need)return s;return L.sizes[L.sizes.length-1];}

/* ---------- expert solver ---------- */
const MATCH={white:'none',red:'red',green:'green',blue:'blue',ir:'ir',uv:'vis'};
const OPT_KEYS=['cam','colorCam','lens','wd','N','spacer','tech','lcolor','lsize','intensity','barAngle','strobe','filter','pol','shroud','expo','gain'];
function lightingCandidates(B){
  const P=PARTS[B.part],out=[];
  for(const tech of Object.keys(LIGHTS))for(const lc of Object.keys(LCOL))for(const fm of['none','match'])for(const pol of[false,true])for(const ang of(tech==='bar'?[15,30,50,70]:[B.barAngle])){
    if(fm==='match'&&MATCH[lc]==='none')continue;
    if(pol&&tech==='back')continue;
    if(tech==='back'&&lc==='uv')continue;
    const S={...B,tech,lcolor:lc,filter:fm==='match'?MATCH[lc]:'none',pol,barAngle:ang,lsize:pickSize(tech,P),shroud:B.ambient!=='low',spacer:false};
    S.wd=Math.max(S.wd,lightClearance(S));
    autoExpose(S);
    const E=evaluate(S,{ideal:true});
    out.push({S,E,util:E.score-lightCost(S)*.004-(S.filter!=='none'?.3:0)-(pol?.6:0)-(lc==='uv'?4:lc==='ir'?1:0)});
  }
  out.sort((a,b)=>b.util-a.util);
  return out;
}
function opticsSearch(LB){
  const P=PARTS[LB.part],res=[];
  for(const cam of CAMERAS)for(const cc of(LB.requireColor?[true]:[false,true]))for(const lens of LENSES)for(const spacer of(lens.tele?[false]:[false,true])){
    let wd;
    const sw=cam.px[0]*cam.pix/1000,sh=cam.px[1]*cam.pix/1000;
    if(lens.tele){wd=lens.wd;}
    else{
      const m=Math.min(sw/(P.w*1.2),sh/(P.h*1.2));wd=lens.f*(1+1/m);
      const mod=spacer?lens.mod*.35:lens.mod,mx=spacer?lens.mod*1.3:1e9;
      if(spacer&&wd>=lens.mod)continue;
      if(wd<mod)wd=mod;if(wd>mx)continue;
      wd=Math.max(wd,lightClearance(LB));
      if(wd>1200)continue;
      wd=Math.round(wd/5)*5;
    }
    const Ns=lens.tele?[lens.N]:[2.8,4,5.6,8,11,16].filter(n=>n>=lens.minN);
    for(const N of Ns){
      const S={...LB,cam:cam.id,colorCam:cc,lens:lens.id,wd,N,spacer};
      autoExpose(S);
      const E=evaluate(S);
      res.push({S,E,util:E.score-E.cost*.003-S.gain*.15-(S.strobe?1:0)-(cc?.5:0)});
    }
  }
  res.sort((a,b)=>b.util-a.util);
  return res;
}
function solve(S0){
  const B={...S0};
  const LC=lightingCandidates(B);
  const seen=new Set(),tops=[];
  for(const c of LC){if(seen.has(c.S.tech))continue;seen.add(c.S.tech);tops.push(c);if(tops.length>=3)break;}
  let best=null;
  for(const c of tops){const r=opticsSearch(c.S)[0];if(r&&(!best||r.util>best.util))best=r;}
  // per technique best (ideal)
  const perTech={};
  for(const c of LC){if(!perTech[c.S.tech]||c.util>perTech[c.S.tech].util)perTech[c.S.tech]=c;}
  // per defect best technique
  const perDefect=B.defects.map((d,i)=>{let bt=null,bs=-1;for(const c of LC){const s=c.E.defs[i]?c.E.defs[i].score:0;if(s>bs){bs=s;bt=c;}}return{d,tech:bt&&bt.S.tech,lcolor:bt&&bt.S.lcolor,score:bs};});
  // secondary acquisition
  let second=null;
  const misses=best?best.E.defs.map((x,i)=>x.score<55?i:-1).filter(i=>i>=0):[];
  if(misses.length){
    let bb=null,bv=-1;
    for(const c of LC){if(c.S.tech===best.S.tech&&c.S.lcolor===best.S.lcolor)continue;const v=Math.min(...misses.map(i=>c.E.defs[i].score));if(v>bv){bv=v;bb=c;}}
    if(bb&&bv>=55)second={S:bb.S,score:bv,defects:misses.map(i=>B.defects[i])};
  }
  return{best,perTech,perDefect,second,LC};
}
const TECH_WHY={
  dome:'A dome floods the part from every direction, so glare and surface slope disappear and only reflectance differences, such as stains and color, remain.',
  ring:'A direct ring light is bright, compact and inexpensive, and works well when the surface is diffuse and the defect differs in shade or color.',
  coax:'Coaxial light arrives straight down the lens axis. A flat, shiny face reflects it straight back and looks evenly bright, while anything that tilts the surface (a scratch, dent or pit) sends the light elsewhere and turns dark.',
  darkfield:'Low-angle dark field skims across the surface. Flat areas reflect the light away from the lens and stay dark, while scratches, particles and edges scatter light upward and glow.',
  bar:'Angled bar lights create directional shading, so raised and recessed features pick up highlights and shadows.',
  back:'A backlight turns the part into a silhouette. The result depends only on the outline and on light passing through, not on color or finish.',
};
function explain(sol,S0){
  const R=sol.best;if(!R)return[];
  const S=R.S,E=R.E,O=E.O,X=E.X,P=X.P,items=[];
  const kinds={topo:0,color:0,profile:0};
  S.defects.forEach(d=>{const D=DEFS[d.type];if(D.kind!=='surface')kinds.profile++;else if(D.colored&&D.topo<.5)kinds.color++;else kinds.topo++;});
  const dom=Object.entries(kinds).sort((a,b)=>b[1]-a[1])[0][0];
  const kindTxt={topo:'Most of these defects change surface slope rather than color.',color:'Most of these defects are color or reflectance changes.',profile:'Most of these defects change the outline of the part.'}[dom];
  items.push({h:`Lighting: ${LIGHTS[S.tech].name}${S.tech==='bar'?` at ${S.barAngle}°`:''}, ${S.lsize} mm`,p:`${TECH_WHY[S.tech]} ${kindTxt} On a ${MATS[S0.material].name.toLowerCase()} surface this technique gave the best result once the camera and lens were matched to it. The ${S.lsize} mm size is the smallest that covers the ${P.w}×${P.h} mm part evenly.`});
  const lc=LCOL[S.lcolor];let cp;
  const colored=E.defs.filter(x=>x.D.colored&&x.D.kind==='surface'&&!x.D.fluor);
  if(S.lcolor==='uv')cp='The residue fluoresces under UV while the part stays dark. The visible-only filter blocks reflected UV, so only the glow reaches the sensor.';
  else if(S.lcolor==='ir')cp='In near-infrared most dyes and pigments look alike, which suppresses distracting color variation; carbon-black ink and rubber stay dark.';
  else if(colored.length&&S.lcolor!=='white'){const x=colored[0];cp=`Light the same color as a surface makes that surface bright; the opposite color makes it dark. Under ${lc.name.toLowerCase()} light the part reads ${Math.round(vmax(x.exp)*100)}% and the ${x.D.name.toLowerCase()} reads ${Math.round(vmax(x.act)*100)}%.`;}
  else if(S.lcolor==='white')cp='White light keeps every color difference available; no single wavelength gave better contrast here.';
  else cp={blue:'Short blue wavelengths scatter more strongly from fine surface damage and give a slightly sharper diffraction limit.',red:'Red LEDs are efficient and mono sensors respond well to them; red also mutes many surface colors.',green:'Green sits at the peak of the sensor response, so the most signal arrives for the least light.'}[S.lcolor];
  items.push({h:`LED color: ${lc.name}`,p:cp});
  const extras=[];
  if(S.filter!=='none')extras.push(S.filter==='vis'?'A UV/IR cut filter passes only visible light.':`A ${FILT[S.filter].name.toLowerCase()} filter passes only the LED wavelength, so changes in plant lighting barely affect the image.`);
  if(S.pol)extras.push('Crossed polarizers on the light and lens remove mirror-like glare, at the cost of about two thirds of the light.');
  if(S.shroud)extras.push('A shroud around the station blocks plant lighting.');
  if(extras.length)items.push({h:'Filters and shielding',p:extras.join(' ')});
  const small=E.defs.slice().sort((a,b)=>a.G.w-b.G.w)[0];
  const cam=O.cam;
  items.push({h:`Camera: ${cam.name}, ${cam.sensor}, ${S.colorCam?'color':'mono'}`,p:`${cam.px[0]}×${cam.px[1]} px across a ${f1(O.fovW)}×${f1(O.fovH)} mm field gives ${f1(O.mmpp)} mm per pixel${S.colorCam?' (about '+f1(O.eff)+' mm effective with the Bayer pattern)':''}. `+(small?`The smallest defect, the ${f1(small.G.w)} mm ${small.D.name.toLowerCase()}, spans ${f1(small.wpx)} px wide and ${f1(small.lpx)} px long. `:'')+'A common rule is at least 3 px across a spot defect; thin scratches can be narrower than a pixel if they are long and high in contrast. '+(S.colorCam?'Color is needed here.':'Mono gives full resolution and more sensitivity than a Bayer color sensor.')+` It runs up to ${cam.fps} fps against the ${f1(S.ppm/60)} parts per second the line needs.`});
  const lens=O.lens;
  items.push({h:`Lens: ${lens.name}${lens.tele?'':` at ${S.wd} mm`}${S.spacer?' with a spacer ring':''}`,p:(lens.tele?`Telecentric optics keep magnification constant through depth and view flat faces without perspective, at a higher price and a fixed ${f1(O.fovW)}×${f1(O.fovH)} mm field. `:`At ${S.wd} mm working distance the ${lens.f} mm lens gives a ${f1(O.fovW)}×${f1(O.fovH)} mm field for the ${P.w}×${P.h} mm part, with margin for position variation. `)+(S.spacer?'The spacer ring lets the lens focus closer than its normal minimum. ':'')+`At f/${O.N} the depth of field is about ${f1(O.dof)} mm against ${f1(S.depth)} mm of height variation. Defocus and diffraction blur add up to ${f1(Math.hypot(O.dofPx,O.diffPx))} px.`});
  items.push({h:'Exposure',p:`${f1(S.expo)} ms at ${S.intensity}% intensity${S.strobe?' in strobe overdrive':''}, ${f1(S.gain)} dB gain.`+(S0.speed>0?` At ${S0.speed} mm/s the part moves ${f1(O.motionPx)} px during the exposure.`:' The part is stationary during the shot.')});
  items.push({h:'Cost',p:`Estimated hardware cost ${money(E.cost)}${S0.budget?` against a ${money(S0.budget)} budget`:''}. Options that scored within a few points but cost more were ranked lower.`});
  return items;
}
/*MODEL-END*/
if(typeof module!=='undefined')module.exports={solve,explain,evaluate,autoExpose,fitWd,pickSize,optics,glareAt,defGeom,featureList,defColor,lightClearance,lightCost,costParts,FILT,PRINT_COLOR,PRINT_BLOCKS,CHALLENGES,PARTS,DEFS,LIGHTS,LCOL,CAMERAS,LENSES,MATS};
