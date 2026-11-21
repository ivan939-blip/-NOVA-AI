const CACHE='nova-v7';
// Vite fingerprints the manifest and icon at build time. Cache the stable shell
// here; fetched fingerprinted assets are cached by the network-first handler.
const ASSETS=['./','./index.html'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || url.pathname.includes('/api/')) return;

  // Always prefer the newest deployed app files. Cache is fallback only.
  event.respondWith(
    fetch(event.request).then(response=>{
      if(response && response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      }
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached || caches.match('./index.html')))
  );
});
