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

/**
 * Fotka přečtená z databáze se při přepsání záznamu zapisuje jako nová kopie: Safari v iPhonu jinak po přepsání
 * záznamu tímtéž Blobem fotku ztratí (černý náhled s otazníkem) a další zápis záznamu selže. Nečitelná fotka
 * se nezapíše (blob null, broken) – údaje k ní zůstanou a v Colabu je fotka z dřívějšího exportu.
 */
async function freshBlob(s) {
  if (!s.blob) return s;
  try {
    return { ...s, blob: new Blob([await s.blob.arrayBuffer()], { type: s.blob.type || 'image/jpeg' }) };
  } catch {
    return { ...s, blob: null, broken: true };
  }
}

export const db = {
  reports: async () => (await all('reports')).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  report: (id) => get('reports', id),
  saveReport: (r) => put('reports', { ...r, updated_at: new Date().toISOString() }),
  deleteReport: (id) => del('reports', id),

  wagon: (number) => get('wagons', number),
  wagons: () => all('wagons'),
  saveWagon: (w) => put('wagons', w),

  /**
   * sample: { id, kind, label, blob, wagon, created_at, predicted?, exported_at?, exported_once?, removed?, deleted_at? }
   * Smazání = přesun do koše (deleted_at); trvale se fotka smaže až vysypáním koše.
   * fromTraining (koš u jedné fotky v detailu): fotka, která už je v Colabu (exported_once), dostane removed
   * a příští export ji nahlásí jako smazanou. Hromadné mazání vyexportovaných jen uvolňuje místo v telefonu.
   */
  addSample: (s) => put('samples', s),
  sample: (id) => get('samples', id),
  samples: () => all('samples'),
  updateSample: async (s) => put('samples', await freshBlob(s)),
  trashSample: async (s, fromTraining = false) => {
    const inColab = s.exported_once || Boolean(s.exported_at);
    return put('samples', await freshBlob({ ...s, deleted_at: new Date().toISOString(),
      ...(fromTraining && inColab ? { removed: true, exported_at: null, exported_once: true } : {}) }));
  },
  // fotka vyřazená z Colabu se po obnovení musí vyexportovat znovu
  restoreSample: async (s) => {
    const { deleted_at, removed, ...rest } = s;
    return put('samples', await freshBlob(removed ? { ...rest, exported_at: null } : rest));
  },
  purgeSample: (id) => del('samples', id),
};

/**
 * Verze 10 ukládala u ruční brzdy význam s obráceným výkladem barev (plosina = červený rámeček, zeme = jiný),
 * verze 11 „cerny“. Teď se ukládá cerveny / jiny / nema – převod je opakovatelný (mění jen staré hodnoty).
 */
export async function migrateHandBrake(old) {
  const fix = (v) => old[v] ?? v;
  for (const w of await all('wagons')) {
    if (old[w.hand_brake]) await put('wagons', { ...w, hand_brake: fix(w.hand_brake) });
  }
  for (const s of await all('samples')) {
    const changed = (s.kind === 'hand_frame' && old[s.label]) || old[s.extra?.hand_brake] || old[s.predicted?.hand_brake]
      || (s.kind === 'hand_frame' && old[s.predicted?.label]);
    if (!changed) continue;
    await put('samples', await freshBlob({
      ...s,
      label: s.kind === 'hand_frame' ? fix(s.label) : s.label,
      extra: s.extra ? { ...s.extra, hand_brake: fix(s.extra.hand_brake) } : s.extra,
      predicted: s.predicted ? { ...s.predicted, ...(s.predicted.hand_brake ? { hand_brake: fix(s.predicted.hand_brake) } : {}),
        ...(s.kind === 'hand_frame' && s.predicted.label ? { label: fix(s.predicted.label) } : {}) } : s.predicted,
    }));
  }
  for (const r of await all('reports')) {
    if (!r.entries?.some((e) => old[e.hand_brake])) continue;
    await put('reports', { ...r, entries: r.entries.map((e) => ({ ...e, hand_brake: fix(e.hand_brake) })) });
  }
}

/** Požádá prohlížeč, aby data nemazal při nedostatku místa (hlavně kvůli fotkám pro trénink). */
export const persist = () => navigator.storage?.persist?.().catch(() => false);
