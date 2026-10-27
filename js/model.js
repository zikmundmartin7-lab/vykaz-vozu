// Pravidla aplikace: čísla vozů, hledání čísla v přečteném textu, přestavovače, brzdicí procenta.

// ───── Číslo vozu: 12 číslic, zobrazení "XX XX XXXX XXX-X" (stejně jako v Závadách vozů) ─────

export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

export function formatNumber(n) {
  const d = digitsOnly(n).slice(0, 12);
  const head = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8), d.slice(8, 11)].filter(Boolean).join(' ');
  return d.length > 11 ? `${head}-${d[11]}` : head;
}

// Kontrolní číslice UIC (Luhnův algoritmus): číslice střídavě ×2 a ×1 zleva,
// sečtou se ciferné součty, kontrolní číslice doplní součet do násobku 10.
export function checkDigit(number) {
  const d = digitsOnly(number);
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const p = Number(d[i]) * (i % 2 === 0 ? 2 : 1);
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

export const isCompleteNumber = (n) => /^\d{12}$/.test(digitsOnly(n));
export const isValidCheckDigit = (n) =>
  isCompleteNumber(n) && checkDigit(n) === Number(digitsOnly(n)[11]);

// Kódy států (3. a 4. číslice) – jen pro řazení kandidátů, neznámý stát číslo neodmítne.
const COUNTRIES = new Set([10, 20, 21, 22, 23, 24, 25, 26, 27, 28, 41, 44, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 65, 66, 67, 68, 70, 71, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 94]);

// Znaky, které síť u číslic plete s písmeny (jen v „převážně číselných“ slovech).
const LOOKALIKE = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2',
  S: '5', s: '5', B: '8', G: '6', b: '6', g: '9', q: '9' };

// Přečtené řádky → číselná slova v pořadí čtení. Slovo s většinou číslic se opraví (O→0, I→1 …),
// slova z písmen (RIV, TEN, D-DB, PL-FPL …) se přeskočí – na novějších vozech bývají mezi částmi čísla.
function digitTokens(lines) {
  const tokens = [];
  for (const l of lines) {
    for (const word of l.text.split(/[^0-9A-Za-z|!]+/)) {
      const digits = word.replace(/\D/g, '').length;
      if (!digits || digits / word.length < 0.6) continue;
      const d = [...word].map((c) => (/\d/.test(c) ? c : LOOKALIKE[c] ?? '')).join('');
      tokens.push({ d, row: l.row ?? 0, h: l.h ?? 1, conf: l.conf ?? 0 });
    }
  }
  return tokens;
}

// Čísla na voze bývají rozdělená 2-2-4-3-1 (nebo po řádcích 2 / 2 / 4 3-1).
const GROUP_ENDS = new Set([2, 4, 8, 11, 12]);

/**
 * Najde v přečtených řádcích (výstup readText) možná čísla vozů – i rozdělená do více řádků.
 * Vrací [{ number, valid, sure, score }] od nejpravděpodobnějšího; valid = sedí kontrolní číslice.
 */
export function numberCandidates(lines) {
  const tokens = digitTokens(lines);
  const found = new Map();
  const add = (number, parts, aligned) => {
    const valid = isValidCheckDigit(number);
    const country = COUNTRIES.has(Number(number.slice(2, 4)));
    let n = 0;
    const grouped = aligned && parts.every((t) => GROUP_ENDS.has((n += t.d.length)));
    const rows = parts.at(-1).row - parts[0].row;
    const score = parts.reduce((a, t) => a + t.conf, 0) / parts.length - rows * 0.3
      + (valid ? 10 : 0) + (country ? 2 : 0) + (grouped ? 2 : aligned ? 1 : 0);
    // „jisté“ číslo: sedí kontrolní číslice, kód státu i rozdělení do skupin (náhodná shoda je velmi vzácná)
    const sure = valid && country && grouped;
    const prev = found.get(number);
    if (!prev || prev.score < score) found.set(number, { number, valid, sure, score });
  };
  for (let i = 0; i < tokens.length; i++) {
    let all = '';
    const parts = [];
    for (let j = i; j < tokens.length && j < i + 8; j++) {
      const t = tokens[j];
      // části jednoho čísla: nejvýš 3 řádky pod sebou a podobně velké písmo
      if (t.row - tokens[i].row > 2) break;
      if (Math.max(t.h, tokens[i].h) / Math.min(t.h, tokens[i].h) > 1.8) continue;
      all += t.d;
      parts.push(t);
      if (all.length === 12) add(all, parts, true);
      if (all.length >= 12) {
        if (parts.length === 1) for (let k = 0; k + 12 <= all.length; k++) add(all.slice(k, k + 12), parts, false);
        else add(all.slice(0, 12), parts, false);
        break;
      }
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

// ───── Přestavovače a brzda ─────

/** Co vozmistr u vozu nastavuje/kontroluje; pořadí = pořadí na obrazovce. */
export const SWITCHES = {
  rezim: {
    title: 'Přestavovač G/P', short: 'Režim',
    options: [['G', 'G'], ['P', 'P']],
  },
  naklad: {
    title: 'Přestavovač prázdný / ložený', short: 'P/L',
    options: [['prazdny', 'Prázdný'], ['lozeny', 'Ložený'], ['auto', 'Samočinný']],
  },
  kohout: {
    title: 'Brzda (uzavírací kohout)', short: 'Brzda',
    options: [['zapnuta', 'Zapnuta'], ['vypnuta', 'Vypnuta']],
  },
  rucni: {
    title: 'Ruční brzda', short: 'Ruční',
    options: [['odbrzdena', 'Odbrzděna'], ['zabrzdena', 'Zabrzděna'], ['nema', 'Nemá']],
  },
};

export const optionLabel = (kind, value) =>
  SWITCHES[kind]?.options.find(([v]) => v === value)?.[1] ?? '';

/** Brzdicí váhy z nápisu na voze: klíč režim_náklad. */
export const BRAKE_WEIGHTS = [
  ['P_prazdny', 'P prázdný'], ['P_lozeny', 'P ložený'],
  ['G_prazdny', 'G prázdný'], ['G_lozeny', 'G ložený'],
];

/** Kolonka 51 výkazu – druh brzdových špalíků. */
export const BLOCKS = [
  ['K', 'K', 'nekovové špalíky typ K'],
  ['L', 'L', 'nekovové špalíky typ L'],
  ['LL', 'LL', 'nekovové špalíky typ LL'],
  ['D', 'D', 'kotoučová brzda'],
  ['F', 'F', 'litinové špalíky'],
];

/** Údaje z nápisů, které patří k vozu (pamatují se podle čísla) – [klíč, popis, jednotka]. */
export const WAGON_FIELDS = [
  ['axles', 'Počet náprav', ''],
  ['length_m', 'Délka přes nárazníky', 'm'],
  ['tare_kg', 'Hmotnost prázdného vozu', 'kg'],
  ['hand_force_kn', 'Zajišťovací síla', 'kN'],
  ['max_speed', 'Nejv. dovolená rychlost', 'km/h'],
];
const STATIC_KEYS = [...WAGON_FIELDS.map(([k]) => k), 'blocks'];

/**
 * Nový vůz ve výkazu: údaje z nápisů z paměti (wagon), polohy přestavovačů a stanice určení
 * jako u předchozího vozu (prev), jinak cílová stanice vlaku.
 */
export function newEntry(number, wagon, prev, toStation = '') {
  return {
    id: uid(),
    number,
    rezim: prev?.rezim ?? 'P',
    naklad: prev?.naklad ?? 'prazdny',
    kohout: 'zapnuta',
    rucni: wagon?.hand_force_kn === 0 ? 'nema' : 'odbrzdena',
    hand_checked: false,
    ...Object.fromEntries(STATIC_KEYS.map((k) => [k, wagon?.[k] ?? null])),
    bw: { ...(wagon?.bw ?? {}) },
    cargo_kg: null,
    destination: prev?.destination || toStation,
    rid_un: '',
    rid_icn: '',
    exceptional: false,
    track_class: null,
    samples: [],
    note: '',
  };
}

/** Údaje vozu, které se uloží k číslu vozu pro příště. */
export const wagonFromEntry = (e) => ({
  number: e.number,
  ...Object.fromEntries(STATIC_KEYS.map((k) => [k, e[k] ?? null])),
  bw: { ...e.bw },
  updated_at: new Date().toISOString(),
});

export const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Kolonka 52: brzdicí váha vozu (t) pro režim P nebo G podle polohy přestavovače prázdný/ložený.
 * Vypnutá brzda → null (pole se ve výkazu proškrtne). Samočinný přestavovač bere hodnotu „ložený“.
 */
export function bwFor(e, mode) {
  if (e.kohout === 'vypnuta') return null;
  const load = e.naklad === 'auto' ? 'lozeny' : e.naklad;
  return num(e.bw?.[`${mode}_${load}`]);
}

/** Brzdicí váha vozu ve vlaku (t) podle polohy přestavovače G/P; vypnutá brzda = 0. */
export const entryBrakeWeight = (e) => (e.kohout === 'vypnuta' ? 0 : bwFor(e, e.rezim));

/** Celková hmotnost vozu (kg) = prázdný vůz + náklad. */
export const entryMassKg = (e) => (num(e.tare_kg) === null ? null : num(e.tare_kg) + (num(e.cargo_kg) ?? 0));

/** Kolonka 58: traťová třída podle hmotnosti na nápravu (A ≤ 16 t, B ≤ 18 t, C ≤ 20 t, D ≤ 22,5 t). */
export function trackClass(e) {
  if (e.track_class) return e.track_class;
  const m = entryMassKg(e);
  const axles = num(e.axles);
  if (m === null || !axles) return null;
  const perAxle = m / axles / 1000;
  return perAxle <= 16 ? 'A' : perAxle <= 18 ? 'B' : perAxle <= 20 ? 'C' : perAxle <= 22.5 ? 'D' : 'E';
}

/** Kolonka 53 se vyplní jen u vozů, u nichž se ověřila činnost ruční brzdy. */
export const handForce = (e) => (e.rucni !== 'nema' && e.hand_checked ? num(e.hand_force_kn) : null);

/** Součty za vlak (řádek CELKEM a brzdicí procenta). Chybějící údaj = součet je neúplný (missing > 0). */
export function totals(entries) {
  const t = {
    wagons: entries.length, axles: 0, length: 0, cargoKg: 0, tareKg: 0, massKg: 0,
    bwP: 0, bwG: 0, bw: 0, handForce: 0, missing: 0, brakesOff: 0,
  };
  for (const e of entries) {
    const m = entryMassKg(e);
    const bw = entryBrakeWeight(e);
    if (m === null || bw === null || num(e.axles) === null || num(e.length_m) === null) t.missing++;
    t.axles += num(e.axles) ?? 0;
    t.length += num(e.length_m) ?? 0;
    t.cargoKg += num(e.cargo_kg) ?? 0;
    t.tareKg += num(e.tare_kg) ?? 0;
    t.massKg += m ?? 0;
    t.bwP += bwFor(e, 'P') ?? 0;
    t.bwG += bwFor(e, 'G') ?? 0;
    t.bw += bw ?? 0;
    t.handForce += handForce(e) ?? 0;
    if (e.kohout === 'vypnuta') t.brakesOff++;
  }
  // součty desetinných čísel bez chyb zaokrouhlení (308,87999… → 308,88)
  for (const k of ['length', 'bwP', 'bwG', 'bw', 'handForce']) t[k] = Math.round(t[k] * 100) / 100;
  t.mass = t.massKg / 1000;
  t.lambda = t.mass > 0 ? Math.floor((t.bw / t.mass) * 100) : null;
  return t;
}

/** Oranžová tabulka RID: nahoře identifikační číslo nebezpečí (33, X423), dole UN číslo (1203). */
export function ridFromLines(lines) {
  const words = lines.flatMap((l) => l.text.split(/\s+/).map((w) => ({ w: w.replace(/[^0-9X]/gi, '').toUpperCase(), y: l.y })));
  const un = words.find((x) => /^\d{4}$/.test(x.w));
  const icn = words.find((x) => /^X?\d{2,3}$/.test(x.w) && (!un || x.y < un.y));
  return { un: un?.w ?? '', icn: icn?.w ?? '' };
}

// ───── různé ─────

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const dtf = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatDateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '');
const df = new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
const tf = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' });
export const formatDate = (iso) => (iso ? df.format(new Date(iso)).replace(/\s/g, '') : '');
export const formatTime = (iso) => (iso ? tf.format(new Date(iso)) : '');

/** Datum a čas pro <input type="datetime-local"> v místním čase. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fmt = (v, digits = 1) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: digits });

export function plural(n, one, few, many) {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

/** Zmenšená kopie fotky jako JPEG (pro trénovací data a náhledy). */
export async function toJpeg(src, max = 1280, quality = 0.85) {
  const w = src.videoWidth || src.naturalWidth || src.width;
  const h = src.videoHeight || src.naturalHeight || src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}
