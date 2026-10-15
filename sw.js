/* Klartext Web – Service Worker: legt das App-Gerüst beim ersten Besuch ab, danach startet alles sofort (auch offline).
   Groq-Anfragen laufen immer direkt ins Netz. Die Versionsnummer setzt build.js. */
const V='klartext-web-be5acaa2';
const ASSETS=['./','index.html','app.js','klartext-core.js','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('klartext-web-')&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)));
});
