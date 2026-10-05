import { branding } from './brand.js?v=20261005-branding-v1';
import { cadreQualityCategory } from './cadre-quality.js?v=20261005-story-quality';

const dateLabel=value=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date(value));
const integerLabel=value=>value.toLocaleString('id-ID');

function validateQuality(quality){
  if(!quality||quality.max_score!==50||quality.period_months!==6||!Number.isSafeInteger(quality.assessed_count)||quality.assessed_count<0
    ||!Number.isSafeInteger(quality.report_count)||quality.report_count<quality.assessed_count||!quality.components)throw new Error('Penilaian belum lengkap.');
  const values=[[quality.performance_score,50],[quality.components.information,20],[quality.components.completeness,15],[quality.components.timeliness,15]];
  if(values.some(([value,max])=>quality.assessed_count===0?value!==null:typeof value!=='number'||!Number.isFinite(value)||value<0||value>max))throw new Error('Penilaian belum lengkap.');
  return {...quality,components:{...quality.components}};
}

function validateStatistics(data){
  const counts=data?.counts,period=data?.period;
  if(!counts||!['total','reviewed','incident_source_reports','incidents'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0)
    ||counts.reviewed>counts.total||counts.incident_source_reports>counts.total||counts.incidents>counts.incident_source_reports
    ||period?.months!==6||!Number.isFinite(Date.parse(period.start))||!Number.isFinite(Date.parse(period.end))||Date.parse(period.start)>Date.parse(period.end)){
    throw new Error('Statistik belum lengkap. Coba perbarui kembali.');
  }
  return {counts:{...counts},period:{...period},quality:validateQuality(data.quality)};
}

// Draw the preview and the exported file from the same canvas. All artwork is
// local, so downloading works without third-party images or extra services.
export function createContributionCard(data,name=''){
  const {counts,period,quality}=validateStatistics(data);
  const category=cadreQualityCategory(quality);
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Kartu belum dapat dibuat di perangkat ini.');
  const text=(value,x,y,size,color='#46334b',weight=500,maxWidth=856)=>{
    ctx.font=`${weight} ${size}px Arial, sans-serif`;
    while(ctx.measureText(value).width>maxWidth&&size>24){size-=1;ctx.font=`${weight} ${size}px Arial, sans-serif`;}
    // Names remain readable even when an account has an unusually long name.
    while(ctx.measureText(value).width>maxWidth&&value.length>1)value=value.slice(0,-2).trimEnd()+'…';
    ctx.fillStyle=color;ctx.fillText(value,x,y);
  };
  const pill=(value,x,y,w,angle,fill='#fff9f1',color='#743864')=>{
    ctx.save();ctx.translate(x+w/2,y+52);ctx.rotate(angle);
    ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(-w/2,-52,w,104,52);ctx.fill();
    text(value,-w/2+38,-20,35,color,650,w-76);ctx.restore();
  };
  const star=(x,y,r,color)=>{
    ctx.save();ctx.translate(x,y);ctx.fillStyle=color;ctx.beginPath();
    ctx.moveTo(0,-r);ctx.quadraticCurveTo(r*.16,-r*.16,r,0);ctx.quadraticCurveTo(r*.16,r*.16,0,r);
    ctx.quadraticCurveTo(-r*.16,r*.16,-r,0);ctx.quadraticCurveTo(-r*.16,-r*.16,0,-r);ctx.fill();ctx.restore();
  };
  ctx.textBaseline='top';
  const background=ctx.createLinearGradient(0,0,1080,1920);background.addColorStop(0,'#f9e9e2');background.addColorStop(.5,'#f8edf1');background.addColorStop(1,'#ece6f5');
  ctx.fillStyle=background;ctx.fillRect(0,0,1080,1920);
  // Loose washes, curved strokes and floating stickers replace the old grid.
  ctx.fillStyle='#f2d1df';ctx.beginPath();ctx.ellipse(1050,310,260,450,-.6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff9ed';ctx.beginPath();ctx.ellipse(100,1130,480,620,.2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#e5d9f0';ctx.beginPath();ctx.ellipse(990,1805,620,330,-.3,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#cd86ac';ctx.lineWidth=5;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(-40,160);ctx.bezierCurveTo(140,65,200,150,100,195);ctx.bezierCurveTo(-30,250,10,330,85,345);ctx.stroke();
  ctx.beginPath();ctx.moveTo(1080,1430);ctx.bezierCurveTo(940,1410,990,1540,1100,1590);ctx.stroke();
  star(903,531,42,'#b6749e');star(68,1060,22,'#df947d');star(963,1071,21,'#b6749e');
  // Key content fits between y=220 and y=1700, with room for Story overlays.
  ctx.font='italic 40px Georgia, serif';ctx.fillStyle='#80536d';ctx.fillText('catatan kecilku',116,226);
  pill('6 bulan terakhir',658,216,300,.06,'#efe1f1');
  text('Ikut peduli,',108,325,90,'#57324f',750);
  text('ikut menjaga.',108,426,90,'#57324f',750);
  ctx.strokeStyle='#c882a6';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(116,538);ctx.quadraticCurveTo(424,560,697,535);ctx.stroke();
  const hero=ctx.createLinearGradient(150,570,920,910);hero.addColorStop(0,'#813866');hero.addColorStop(1,'#a55192');
  ctx.fillStyle=hero;ctx.beginPath();ctx.moveTo(238,581);
  ctx.bezierCurveTo(430,553,740,553,896,642);ctx.bezierCurveTo(1005,711,938,852,807,891);
  ctx.bezierCurveTo(582,940,249,905,163,827);ctx.bezierCurveTo(73,742,91,604,238,581);ctx.fill();
  ctx.save();ctx.translate(540,730);ctx.rotate(-.045);ctx.textAlign='center';
  text(integerLabel(counts.total),0,-115,218,'#fffaf0',750,750);
  text('laporan aku kirim',0,115,43,'#fffaf0',600,750);ctx.restore();
  // A small hand-drawn heart adds warmth without implying clinical outcomes.
  ctx.save();ctx.translate(901,617);ctx.rotate(.16);ctx.fillStyle='#eab591';ctx.beginPath();
  ctx.moveTo(0,54);ctx.bezierCurveTo(-99,-5,-25,-91,0,-41);ctx.bezierCurveTo(25,-91,99,-5,0,54);ctx.fill();ctx.restore();
  const checked=counts.reviewed?`${integerLabel(counts.reviewed)} sudah selesai dicek`:counts.total?'Belum ada yang selesai dicek':'Mulai dari kepedulian';
  pill(checked,195,910,690,-.055,'#fffdf5');
  ctx.save();ctx.translate(110,1047);ctx.rotate(.02);
  ctx.font='italic 32px Georgia, serif';ctx.fillStyle='#80536d';ctx.fillText(counts.total?'Dari kabar yang aku bagikan…':'Mulai dari yang dekat…',0,0);
  if(counts.incident_source_reports){
    text(`${integerLabel(counts.incident_source_reports)} laporanku ikut membantu`,0,50,36,'#57324f',600,830);
    text(`memastikan ${integerLabel(counts.incidents)} kejadian.`,0,98,36,'#57324f',600,830);
  }else{
    text(counts.total?'Belum ada kejadian yang dipastikan':'Aku siap ikut peduli,',0,50,36,'#57324f',600,830);
    text(counts.total?'lewat laporanku.':'mulai dari lingkungan sekitar.',0,98,36,'#57324f',600,830);
  }
  ctx.restore();
  // A softly shaped note keeps the quality category prominent and its actual
  // component averages readable, without reintroducing a dashboard grid.
  ctx.fillStyle='#fffaf3';ctx.beginPath();ctx.moveTo(137,1220);
  ctx.bezierCurveTo(341,1200,749,1213,939,1220);ctx.quadraticCurveTo(986,1223,974,1277);
  ctx.lineTo(974,1538);ctx.quadraticCurveTo(984,1581,932,1590);ctx.bezierCurveTo(687,1600,347,1577,136,1590);
  ctx.quadraticCurveTo(87,1598,99,1536);ctx.lineTo(99,1265);ctx.quadraticCurveTo(96,1223,137,1220);ctx.fill();
  text('Kualitas laporanku',133,1246,31,'#80536d',550,814);
  text(category.label,130,1290,58,'#57324f',750,817);
  const average=category.known?`Rata-rata ${integerLabel(quality.performance_score)}/50 · ${integerLabel(quality.assessed_count)} laporan dinilai`:'Menunggu penilaian lengkap dari petugas.';
  text(average,133,1362,27,'#80536d',500,814);
  for(const [index,key,label,max] of [[0,'information','Kualitas informasi',20],[1,'completeness','Kelengkapan',15],[2,'timeliness','Ketepatan waktu',15]]){
    text(label,133,1417+index*50,32,'#57324f',500,545);
    ctx.save();ctx.textAlign='right';text(category.known?`${integerLabel(quality.components[key])}/${max}`:'Belum dinilai',947,1417+index*50,32,'#743864',650,255);ctx.restore();
  }
  const identity=String(name||'').replace(/\s+/g,' ').trim().slice(0,120);
  if(identity)text(`— ${identity}`,116,1618,30,'#80536d',550,830);
  text([branding.shortName, branding.locationLabel].filter(Boolean).join(' · '),116,1668,25,'#80536d',600,355);
  text(`${dateLabel(period.start)} – ${dateLabel(period.end)}`,530,1668,25,'#80536d',500,428);
  // The outer edge is decorative only, including the space under Story replies.
  star(137,1790,36,'#b6749e');star(807,1855,18,'#b6749e');
  return canvas.toDataURL('image/png');
}

export function mountCadreStatistics(root,{name,load}){
  const status=root.querySelector('[data-statistics-status]'),content=root.querySelector('[data-statistics-content]');
  const image=root.querySelector('[data-statistics-image]'),download=root.querySelector('[data-statistics-download]');
  const includeName=root.querySelector('[data-statistics-name]'),refreshButton=root.querySelector('[data-statistics-refresh]');
  const countList=root.querySelector('[data-statistics-counts]'),periodLabel=root.querySelector('[data-statistics-period]');
  let statistics=null,revision=0,renderedSignature='',imageReady=false;
  const setDownloadReady=ready=>{
    imageReady=ready;download.hidden=!ready;
  };
  const render=(data=statistics)=>{
    const {counts,period,quality}=data;
    const periodText=`${dateLabel(period.start)} – ${dateLabel(period.end)}`;
    const cardName=includeName.checked?(typeof name==='function'?name():name):'';
    const signature=JSON.stringify([counts,periodText,cardName,quality]);
    const png=signature!==renderedSignature||!imageReady?createContributionCard(data,cardName):null;
    periodLabel.textContent=`${periodText} · 6 bulan terakhir`;
    countList.replaceChildren();
    for(const [key,label] of [['total','Laporan dikirim'],['reviewed','Selesai ditinjau'],['incident_source_reports','Laporan sumber kejadian'],['incidents','Kejadian terverifikasi']]){
      const row=document.createElement('div'),term=document.createElement('dt'),value=document.createElement('dd');
      term.textContent=label;value.textContent=integerLabel(counts[key]);row.append(term,value);countList.append(row);
    }
    if(png){
      setDownloadReady(false);
      image.onload=()=>setDownloadReady(true);
      image.onerror=()=>{setDownloadReady(false);status.textContent='Pratinjau kartu belum dapat dimuat. Coba perbarui statistik.';};
      const category=cadreQualityCategory(quality);
      const qualityDescription=category.known?`Rata-rata ${integerLabel(quality.performance_score)} dari 50, dari ${quality.assessed_count} laporan dinilai. Kualitas informasi ${integerLabel(quality.components.information)} dari 20, kelengkapan ${integerLabel(quality.components.completeness)} dari 15, ketepatan waktu ${integerLabel(quality.components.timeliness)} dari 15.`:'Menunggu penilaian lengkap; komponen belum dihitung sebagai nol.';
      image.alt=`Story kepedulian${cardName?' '+cardName:''}. Ikut peduli, ikut menjaga. ${periodText}. ${counts.total} laporan aku kirim, ${counts.reviewed} sudah selesai dicek. ${counts.incident_source_reports} laporanku ikut membantu memastikan ${counts.incidents} kejadian. Kualitas laporanku: ${category.label}. ${qualityDescription}`;
      image.src=png;download.href=png;
      download.download=`story-kader-${period.end.slice(0,10)}.png`;
      renderedSignature=signature;
    }
    content.hidden=false;
  };
  const refresh=async()=>{
    const current=++revision;
    root.setAttribute('aria-busy','true');refreshButton.disabled=true;
    status.textContent='Memperbarui statistik Anda…';
    try{
      const data=validateStatistics(await load());
      if(!root.isConnected||current!==revision)return;
      render(data);statistics=data;
      status.textContent='Statistik terbaru sudah dimuat.';
    }catch(error){
      if(!root.isConnected||current!==revision)return;
      status.textContent=statistics?'Pembaruan belum dapat dimuat. Kartu masih memakai statistik dari pemuatan terakhir.':'Statistik belum dapat dimuat. Gunakan Perbarui statistik untuk mencoba lagi.';
    }finally{
      if(current===revision){root.setAttribute('aria-busy','false');refreshButton.disabled=false;}
    }
  };
  includeName.addEventListener('change',()=>{if(statistics)try{render();}catch{status.textContent='Kartu belum dapat dibuat. Coba perbarui statistik.';setDownloadReady(false);}});
  refreshButton.addEventListener('click',()=>void refresh());
  download.addEventListener('click',event=>{if(!imageReady){event.preventDefault();return;}status.textContent='Unduhan kartu PNG dimulai. Di ponsel, kartu dapat dibuka untuk disimpan.';});
  return {refresh};
}
