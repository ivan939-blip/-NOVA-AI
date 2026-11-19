const CACHE='nova-v1';
const ASSETS=['/','/index.html','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(response=>{
    if (new URL(e.request.url).origin === location.origin && response.ok) {
      caches.open(CACHE).then(cache=>cache.put(e.request, response.clone()));
    }
    return response;
  })));
});
