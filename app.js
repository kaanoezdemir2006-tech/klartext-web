/* Klartext Web – Diktat auf dem iPhone ohne App-Installation.
   Aufnahme im Browser → Groq Whisper → Qwen räumt auf (gemeinsamer Kern: klartext-core.js, wie Windows-App und CalTrack). */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const LS='kt_web_v1',HS='kt_web_hist_v1';
const DEF={key:'',name:'Kaan',style:'casual',lang:'de',dict:'Klartext, CalTrack, Claude',snips:'by the way = BTW',rules:'',cleanup:true,nonsense:true,auto:true,fast:false};
function rd(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch(e){return f}}
function wr(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
let S=Object.assign({},DEF,rd(LS,{}));
let H=rd(HS,[]);
let mode='idle',rec=null,chunks=[],stream=null,actx=null,analyser=null,raf=0,t0=0,spoke=false,quietAt=0,mime='',lastText='';

/* ---------- kleine Helfer ---------- */
function toast(t,ms){const e=$('toast');e.textContent=t;e.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>e.classList.remove('show'),ms||1800)}
function status(t,err){const e=$('status');e.textContent=t;e.classList.toggle('err',!!err)}
function setMode(m){
  mode=m;const b=$('mic');b.classList.toggle('rec',m==='rec');b.classList.toggle('busy',m==='busy');
  b.setAttribute('aria-label',m==='rec'?'Aufnahme beenden':'Aufnehmen');
}
function hasKey(){return !!(S.key||'').trim()}

/* ---------- Aufnahme ---------- */
const bars=()=>$('mic').querySelectorAll('.bars i');
function level(){
  if(!analyser)return;
  const buf=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(buf);
  let s=0;for(let i=0;i<buf.length;i++){const v=(buf[i]-128)/128;s+=v*v}
  const rms=Math.sqrt(s/buf.length),lv=Math.min(1,rms*5),now=performance.now();
  const bs=bars(),n=bs.length;
  bs.forEach((el,i)=>{const env=Math.sin(Math.PI*(i+.5)/n),wob=.55+.45*Math.sin(now/90+i*1.7);el.style.height=(6+44*Math.min(1,lv*1.15)*env*wob)+'px'});
  if(rms>.012){spoke=true;quietAt=now}
  if(S.auto&&mode==='rec'){
    if((spoke&&now-quietAt>1800)||(!spoke&&now-t0>15000)||now-t0>180000){stop(false);return}
  }
  raf=requestAnimationFrame(level);
}
async function start(){
  if(!hasKey()){openSettings();status('Trag erst deinen Groq-Key ein.',true);return}
  if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder)){status('Dieses Gerät kann hier nicht aufnehmen.',true);return}
  KT.warm(S.key.trim());
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  }catch(e){
    status(e&&e.name==='NotAllowedError'?'Mikrofon nicht erlaubt: Einstellungen → Safari → Mikrofon → Erlauben.':'Kein Mikrofon gefunden.',true);return;
  }
  const types=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
  mime=types.find(t=>{try{return MediaRecorder.isTypeSupported(t)}catch(e){return false}})||'';
  chunks=[];rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
  rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  rec.start(250);
  try{
    const AC=window.AudioContext||window.webkitAudioContext;actx=new AC();
    analyser=actx.createAnalyser();analyser.fftSize=512;actx.createMediaStreamSource(stream).connect(analyser);
  }catch(e){analyser=null}
  spoke=false;t0=quietAt=performance.now();
  setMode('rec');status(S.auto?'Ich höre zu. Pause beendet automatisch.':'Ich höre zu. Tippe zum Beenden.');
  $('result').classList.remove('show');
  raf=requestAnimationFrame(level);
}
function cleanupAudio(){
  cancelAnimationFrame(raf);
  if(stream)stream.getTracks().forEach(t=>t.stop());
  if(actx)actx.close().catch(()=>{});
  stream=null;actx=null;analyser=null;
}
/* gesture=true: Aufruf durch Tippen → die Zwischenablage darf noch während der Verarbeitung beschrieben werden (iOS) */
function stop(gesture){
  if(mode!=='rec'||!rec)return;
  setMode('busy');status('Schreibe …');
  let resolve,reject;const textP=new Promise((a,b)=>{resolve=a;reject=b});
  textP.catch(()=>{});
  let clipOk=false;
  if(gesture&&navigator.clipboard&&window.ClipboardItem){
    try{
      navigator.clipboard.write([new ClipboardItem({'text/plain':textP.then(t=>new Blob([t],{type:'text/plain'}))})]).then(()=>{clipOk=true},()=>{});
    }catch(e){}
  }
  const r=rec;rec=null;
  r.onstop=async()=>{
    const blob=new Blob(chunks,{type:r.mimeType||mime||'audio/mp4'});
    cleanupAudio();
    try{
      const out=await process(blob);
      lastText=out.text;resolve(out.text);
      showResult(out.text);
      addHistory(out);
      setMode('idle');
      if(gesture){status(clipOk||await waitClip(()=>clipOk)?'Fertig und kopiert. Jetzt in der Ziel-App einsetzen.':'Fertig. Tippe auf Kopieren.')}
      else status('Fertig. Tippe auf Kopieren.');
    }catch(e){
      reject(e);setMode('idle');
      status(e&&e.message?e.message:String(e),true);
    }
  };
  try{r.stop()}catch(e){r.onstop()}
}
function waitClip(f){return new Promise(res=>setTimeout(()=>res(f()),250))}

/* ---------- Verarbeitung (gemeinsamer Kern) ---------- */
async function process(blob){
  if(blob.size<1200)throw new Error('Nichts gehört. Nochmal versuchen.');
  const key=S.key.trim(),ext=/mp4|m4a|aac/.test(blob.type)?'m4a':/ogg/.test(blob.type)?'ogg':'webm';
  KT.sttModel=S.fast?'whisper-large-v3-turbo':'whisper-large-v3';
  const snips=KT.snips(S.snips);
  const dict=[S.dict.trim()].concat(snips.map(s=>s[0])).filter(Boolean).join(', ');
  const t1=performance.now();
  const raw=await KT.transcribe(blob,{key,lang:S.lang,dict,user:S.name.trim(),name:'aufnahme.'+ext});
  if(!raw)throw new Error('Nichts verstanden. Nochmal versuchen.');
  const t2=performance.now();
  let text=raw;
  if(S.cleanup){
    text=await KT.clean(raw,{key,dict:S.dict.trim(),name:S.name.trim(),style:S.style,app:'Nachricht auf dem iPhone',rules:S.rules.trim(),snippets:snips,nonsense:S.nonsense});
  }else{
    const rel=KT.relevant(raw,snips);text=KT.tidy(KT.expand(KT.preTokenize(raw,rel),rel));
  }
  return{raw,text,ms:Math.round(t2-t1)+'+'+Math.round(performance.now()-t2)+' ms'};
}

/* ---------- Ergebnis, Verlauf ---------- */
function showResult(t){$('text').value=t;$('result').classList.add('show');autosize()}
function autosize(){const e=$('text');e.style.height='auto';e.style.height=Math.min(e.scrollHeight,window.innerHeight*.38)+'px'}
function addHistory(o){
  H.unshift({t:Date.now(),raw:o.raw,text:o.text,ms:o.ms});H=H.slice(0,30);wr(HS,H);renderHistory();
}
function renderHistory(){
  $('hist').hidden=!H.length;const box=$('histList');box.textContent='';
  H.forEach(h=>{
    const b=document.createElement('button');
    const s=document.createElement('span');s.textContent=h.text;
    const m=document.createElement('small');m.textContent=new Date(h.t).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' · '+(h.ms||'')+' · tippen zum Kopieren';
    b.append(s,m);b.onclick=()=>{showResult(h.text);copy(h.text)};box.append(b);
  });
}
async function copy(t){
  t=t||$('text').value;
  try{await navigator.clipboard.writeText(t);toast('Kopiert')}
  catch(e){const ta=$('text');ta.focus();ta.select();try{document.execCommand('copy');toast('Kopiert')}catch(_){toast('Bitte lange tippen und Kopieren wählen',2600)}}
}

/* ---------- Einstellungen ---------- */
const FIELDS={key:'key',name:'name',style:'style',lang:'lang',dict:'dict',snips:'snips',rules:'rules'};
const SWITCH={cleanup:'cleanup',nonsense:'nonsense',auto:'auto',fast:'fast'};
function openSettings(){$('sheet').classList.add('show')}
function closeSettings(){
  $('sheet').classList.remove('show');
  if(!hasKey())status('Trag erst deinen Groq-Key ein.',true);
  else if($('status').classList.contains('err'))status('Tippe aufs Mikro und sprich.');
}
function bindSettings(){
  Object.keys(FIELDS).forEach(k=>{const e=$(FIELDS[k]);e.value=S[k];e.addEventListener('input',()=>{S[k]=e.value;wr(LS,S)})});
  Object.keys(SWITCH).forEach(k=>{const e=$(SWITCH[k]);e.checked=!!S[k];e.addEventListener('change',()=>{S[k]=e.checked;wr(LS,S)})});
  $('test').onclick=async()=>{
    const note=$('keyNote');note.textContent='Prüfe …';
    try{
      const r=await fetch(KT.base+'models',{headers:{Authorization:'Bearer '+S.key.trim()}});
      note.textContent=r.ok?'✓ Key funktioniert.':r.status===401?'Der Key ist ungültig.':'Groq-Fehler '+r.status;
    }catch(e){note.textContent='Keine Verbindung.'}
  };
  $('gear').onclick=openSettings;$('close').onclick=closeSettings;
}

/* ---------- Start ---------- */
$('mic').addEventListener('click',()=>{
  if(mode==='idle')start();else if(mode==='rec')stop(true);
});
$('copy').onclick=()=>copy();
$('share').onclick=async()=>{
  const t=$('text').value;
  if(navigator.share){try{await navigator.share({text:t})}catch(e){}}else copy(t);
};
$('text').addEventListener('input',autosize);
bindSettings();renderHistory();
if(!hasKey()){status('Willkommen! Trag zuerst deinen Groq-Key ein.');setTimeout(openSettings,400)}

/* Service Worker: App-Gerüst offline, neue Version holt sich die Seite selbst */
if('serviceWorker' in navigator){
  const hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(r=>{r.update().catch(()=>{})}).catch(()=>{});
  let reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    /* neue Version ist da → einmal neu laden (nicht mitten in einer Aufnahme) */
    if(!hadController||reloaded)return;reloaded=true;
    const go=()=>{if(mode==='idle')location.reload();else setTimeout(go,1000)};go();
  });
}
$('ver').textContent=(window.KT_VERSION||'');
/* ?go=1 → gleich aufnehmen (z. B. über einen Kurzbefehl auf „Rückseite tippen“); klappt der Mikro-Zugriff ohne Tippen nicht, bleibt der Knopf bereit */
if(new URLSearchParams(location.search).get('go')==='1'&&hasKey()){setTimeout(()=>{start().catch(()=>{})},300)}
})();
