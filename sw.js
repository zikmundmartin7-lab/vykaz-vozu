// Service worker: aplikace funguje bez signálu.
// Malé soubory aplikace: ze zásoby hned, na pozadí se obnoví (při vydání zvýšit CACHE).
// Velké soubory (neuronové sítě, ONNX runtime): jednou stáhnout a držet ve vlastní zásobě MODELS,
// aby se při každém vydání aplikace nestahovalo znovu 25 MB. Při změně modelu zvýšit MODELS.

const CACHE = 'vykaz-v11';
const MODELS = 'vykaz-modely-v1';

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/model.js', 'js/db.js', 'js/ui.js', 'js/ocr.js', 'js/ort.js', 'js/brake.js', 'js/xlsx.js', 'js/fields.js', 'js/light.js', 'js/series.js', 'js/frame.js', 'data/rady.json',
  'js/views/home.js', 'js/views/report.js', 'js/views/entry.js', 'js/views/scanner.js',
  'js/views/output.js', 'js/views/data.js', 'js/views/trainer.js',
  'vendor/preact-htm.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const BIG = ['vendor/ort/ort.wasm.min.mjs', 'vendor/ort/ort-wasm-simd-threaded.mjs',
  'vendor/ort/ort-wasm-simd-threaded.wasm', 'models/det.onnx', 'models/rec.onnx', 'models/rec_dict.txt'];

const isBig = (url) => url.pathname.includes('/models/') || url.pathname.includes('/vendor/ort/');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(CACHE)).addAll(SHELL);
    // Sítě se stáhnou hned při instalaci; když to nevyjde (slabý signál), stáhnou se při prvním použití.
    const models = await caches.open(MODELS);
    await Promise.all(BIG.map(async (p) => { if (!(await models.match(p))) await models.add(p).catch(() => {}); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== MODELS) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  if (isBig(url) && !url.pathname.endsWith('brzdy.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(MODELS);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok) cache.put(request, res.clone());
      return res;
    })());
    return;
  }

  // brzdy.json (seznam natrénovaných sítí) a vše ostatní: ze zásoby, na pozadí obnovit.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    }).catch(() => null);
    if (hit) {
      event.waitUntil(fresh);
      return hit;
    }
    return (await fresh) ?? new Response('Bez připojení', { status: 503 });
  })());
});

// Aplikace se může zeptat na verzi (zobrazí se v patičce).
self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ version: CACHE });
});
