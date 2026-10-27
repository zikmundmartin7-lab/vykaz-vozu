// Úložiště v telefonu (IndexedDB): výkazy, údaje vozů podle čísla a fotky pro trénink sítí.
// Nic se zatím neposílá na server – data jsou jen v tomto prohlížeči, ven se dostanou exportem.

const DB_NAME = 'vykaz-vozu';
const VERSION = 1;

let opening = null;
function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('reports', { keyPath: 'id' });
      db.createObjectStore('wagons', { keyPath: 'number' });
      db.createObjectStore('samples', { keyPath: 'id' }).createIndex('created_at', 'created_at');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
const all = (store) => run(store, 'readonly', (s) => s.getAll());
const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

export const db = {
  reports: async () => (await all('reports')).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  report: (id) => get('reports', id),
  saveReport: (r) => put('reports', { ...r, updated_at: new Date().toISOString() }),
  deleteReport: (id) => del('reports', id),

  wagon: (number) => get('wagons', number),
  wagons: () => all('wagons'),
  saveWagon: (w) => put('wagons', w),

  /** sample: { id, kind: 'cislo' | 'napis' | klíč z SWITCHES, label, blob, wagon, created_at, predicted?, exported_at? } */
  addSample: (s) => put('samples', s),
  sample: (id) => get('samples', id),
  samples: () => all('samples'),
  updateSample: (s) => put('samples', s),
  deleteSample: (id) => del('samples', id),
};

/** Požádá prohlížeč, aby data nemazal při nedostatku místa (hlavně kvůli fotkám pro trénink). */
export const persist = () => navigator.storage?.persist?.().catch(() => false);
