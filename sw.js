// Service worker: rychlé spuštění z paměti telefonu a práce bez signálu. Aktualizace stejně jako v Závadách vozů:
// nová verze se stáhne celá znovu přímo z webu a otevřeným oknům se ohlásí („Je k dispozici nová verze“).
// Velké soubory (neuronové sítě, ONNX runtime) jsou ve vlastní zásobě MODELS, aby se při každé nové verzi
// aplikace nestahovalo znovu 25 MB. Při změně čtecích sítí zvýšit MODELS.

const CACHE = 'vykaz-v13'; // zvýšit spolu s APP_VERSION v js/version.js
const MODELS = 'vykaz-modely-v1';

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/version.js',
  'js/app.js', 'js/model.js', 'js/db.js', 'js/ui.js', 'js/ocr.js', 'js/ort.js', 'js/brake.js', 'js/xlsx.js',
  'js/fields.js', 'js/light.js', 'js/series.js', 'js/frame.js', 'data/rady.json',
  'js/views/home.js', 'js/views/report.js', 'js/views/entry.js', 'js/views/scanner.js',
  'js/views/output.js', 'js/views/data.js', 'js/views/trainer.js',
  'vendor/preact-htm.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const BIG = ['vendor/ort/ort.wasm.min.mjs', 'vendor/ort/ort-wasm-simd-threaded.mjs',
  'vendor/ort/ort-wasm-simd-threaded.wasm', 'models/det.onnx', 'models/rec.onnx', 'models/rec_dict.txt'];

// Soubor aplikace podle cesty → klíč v paměti; parametr v adrese se nebere v úvahu (razítko ?r=… z index.html)
const SHELL_KEYS = new Map(SHELL.map((u) => { const x = new URL(u, location.href); return [x.pathname, x.href]; }));
const isBig = (url) => (url.pathname.includes('/models/') && !url.pathname.endsWith('brzdy.json'))
  || url.pathname.includes('/vendor/ort/');

// Nová verze: stáhnout všechny soubory aplikace znovu přímo z webu. Jedinečný parametr v adrese obejde
// mezipaměť prohlížeče i serverů GitHubu – jinak by se k nové verzi mohly uložit soubory ze staré.
// Když se některý nestáhne, instalace selže, zůstane stará verze a zkusí se to příště.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const stamp = Date.now();
    const files = await Promise.all(SHELL.map(async (u) => {
      const res = await fetch(`${u}${u.includes('?') ? '&' : '?'}sw=${stamp}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${u}: ${res.status}`);
      return [u, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(files.map(([u, res]) => cache.put(u, res)));
    // Sítě se stáhnou hned při první instalaci; když to nevyjde (slabý signál), stáhnou se při prvním použití.
    const models = await caches.open(MODELS);
    await Promise.all(BIG.map(async (p) => { if (!(await models.match(p))) await models.add(p).catch(() => {}); }));
    await self.skipWaiting();
  })());
});

// Aplikace se ptá na číslo verze (úvodní obrazovka → „Verze aplikace“)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'version') e.ports[0]?.postMessage(CACHE);
});

// Po aktivaci smazat starou verzi a otevřeným oknům říct, že je k dispozici nová
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k !== CACHE && k !== MODELS);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (old.length) {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'updated' });
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Velké soubory: jednou stáhnout a pak jen z paměti telefonu
  if (isBig(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(MODELS);
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(url.origin + url.pathname, res.clone());
      return res;
    })());
    return;
  }

  // Soubory aplikace jen z paměti telefonu (rychlé spuštění): patří k této verzi a mění se jen s novou verzí
  // (install výše), na pozadí se nepřepisují. Ostatní (např. models/brzdy.json se seznamem natrénovaných sítí)
  // z paměti a na pozadí se ověří novější; co v paměti není, stáhne se ze sítě.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const own = SHELL_KEYS.has(url.pathname) && await cache.match(SHELL_KEYS.get(url.pathname));
    if (own) return own;
    const cached = await cache.match(e.request);
    const fromNetwork = fetch(e.request).then((res) => {
      if (res.ok && res.status === 200 && res.type === 'basic') cache.put(e.request, res.clone());
      return res;
    });
    if (cached) {
      e.waitUntil(fromNetwork.catch(() => {}));
      return cached;
    }
    try {
      return await fromNetwork;
    } catch {
      return (await cache.match('index.html')) ?? Response.error();
    }
  })());
});
