// Údaje, které vozmistr snímá kamerou při obchůzce vozu, a jejich hledání v přečteném textu.
// Zatím pravidla (jednotka + rozsah hodnot + klíčová slova); potvrzené příklady z tréninku
// poslouží k natrénování sítě, která pozná, který nápis je který údaj.

import { numberCandidates, digitsOnly, formatNumber, isCompleteNumber, BLOCKS } from './model.js';

/**
 * Kroky tréninku ve výchozím pořadí obchůzky (vozmistr si ho může přetažením změnit, viz trainer.js). type: number = číslo vozu, qty = číslo s jednotkou,
 * switch = volba tlačítkem (přestavovače, nápravy, špalíky), text = volný text.
 * wagonKey = kam se hodnota uloží k vozu (numeric = jako číslo), default = předvolená volba.
 */
export const FIELDS = [
  { key: 'cislo', title: 'Číslo vozu', short: 'Číslo vozu', hint: '12místné číslo na boku vozu', type: 'number' },
  { key: 'axles', title: 'Počet náprav', short: 'Nápravy', hint: 'spočítejte nápravy (dvojkolí) vozu', type: 'switch',
    options: [['2', '2'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8']], default: '4', wagonKey: 'axles', numeric: true },
  { key: 'tare', title: 'Hmotnost vozu', short: 'Hmotnost', hint: 'vlastní hmotnost (tara), např. 23 500 kg', type: 'qty', unit: 'kg', wagonKey: 'tare_kg' },
  { key: 'hand_t', title: 'Síla zajišťovací brzdy', short: 'Zaj. brzda (t)', hint: 'brzdicí váha ruční brzdy v tunách, např. 20 t', type: 'qty', unit: 't', wagonKey: 'hand_bw_t' },
  { key: 'hand_kn', title: 'Zajišťovací síla', short: 'Zaj. síla (kN)', hint: 'v kN, např. 20,2 kN', type: 'qty', unit: 'kN', wagonKey: 'hand_force_kn' },
  { key: 'length', title: 'Délka přes nárazníky', short: 'Délka', hint: 'v metrech, např. 15,74 m', type: 'qty', unit: 'm', wagonKey: 'length_m' },
  { key: 'speed', title: 'Nejvyšší dovolená rychlost', short: 'Rychlost', hint: 'v km/h, např. 100 nebo 120 (S / SS v tabulce zatížení)',
    type: 'qty', unit: 'km/h', wagonKey: 'max_speed' },
  { key: 'blocks', title: 'Druh brzdových špalíků', short: 'Špalíky', hint: 'K, L, LL nekovové · D kotoučová brzda · F litinové', type: 'switch',
    options: BLOCKS.map(([v, l]) => [v, l]), wagonKey: 'blocks' },
  { key: 'rezim', title: 'Přestavovač G/P', short: 'G/P', hint: 'páka režimu brzdění', type: 'switch', options: [['G', 'G'], ['P', 'P']], default: 'P' },
  { key: 'naklad', title: 'Přestavovač prázdný / ložený', short: 'Prázdný/ložený', hint: 'páka prázdný – ložený', type: 'switch',
    options: [['prazdny', 'Prázdný'], ['lozeny', 'Ložený'], ['auto', 'Samočinný']], default: 'prazdny' },
  { key: 'revize', title: 'Revize', short: 'Revize', hint: 'nápis REV s dílnou a datem', type: 'text', wagonKey: 'revision' },
];
export const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Číslo s jednotkou: „23 500 kg“, „23.500 kg“, „20,0t“, „20,2 kN“, „15,74 m“, „100 km/h“.
const QTY = /(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s?(kg|kn|km\/h|t|m)(?![a-z])/gi;

// Síť někdy rozdělí jeden nápis na víc rámečků („23 500“ a „kg“). Sousední rámečky v jednom řádku
// s malou mezerou se proto spojí do jedné fráze; li = indexy řádků, ze kterých fráze vznikla.
function phrases(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const last = out.at(-1);
    const prev = last && lines[last.li.at(-1)];
    if (prev && prev.row === l.row && l.x - (prev.x + prev.w) < Math.max(prev.h, l.h) * 1.2) {
      last.text += ` ${l.text}`;
      last.li.push(i);
    } else out.push({ text: l.text, li: [i] });
  });
  return out;
}

// Síť občas čte nulu jako písmeno o („20.ot“, „12,o kN“).
const zeros = (text) => text.replace(/(\d[.,]?)([oO]+)/g, (_, a, o) => a + '0'.repeat(o.length));

function quantities(lines) {
  const out = [];
  for (const p of phrases(lines)) {
    for (const m of zeros(p.text).matchAll(QTY)) {
      const v = Number(`${m[1].replace(/[ .]/g, '')}${m[2] ? `.${m[2]}` : ''}`);
      const unit = m[3].toLowerCase() === 'kn' ? 'kN' : m[3].toLowerCase();
      if (Number.isFinite(v)) out.push({ v, unit, li: p.li, text: p.text, decimals: Boolean(m[2]), raw: m[0] });
    }
  }
  return out;
}

const numbersInLine = (text) => (zeros(text).match(/\d+(?:[,.]\d+)?/g) ?? []).length;

/** Hodnota v jednotce údaje (t ↔ kg) nebo null, když jednotka nesedí. */
function inUnit(q, unit) {
  if (q.unit === unit) return q.v;
  if (unit === 'kg' && q.unit === 't') return Math.round(q.v * 1000);
  if (unit === 't' && q.unit === 'kg') return q.v / 1000;
  return null;
}

// Pravidla pro jednotlivé údaje: [podmínka, skóre] nad nalezenými čísly s jednotkou.
const RULES = {
  // tara: v kg, v tunách jen s nápisem „Tara“ / „T =“ (jinak by se pletla se silou zajišťovací brzdy)
  tare: (q) => {
    const tara = /tara|vlastn|T\s*=/i.test(q.text);
    if (q.unit === 't' && !tara) return 0;
    const kg = inUnit(q, 'kg');
    if (kg === null || kg < 8000 || kg > 60000) return 0;
    return (q.unit === 'kg' ? 2 : 0) + (tara ? 2 : 0) + (numbersInLine(q.text) <= 2 ? 1 : 0);
  },
  // tabulka zatížení (A, B1, C … s několika hodnotami v řádku) ruční brzda není
  hand_t: (q) => (q.unit === 't' && q.v >= 3 && q.v <= 60 ? 1 + (numbersInLine(q.text) === 1 ? 2 : 0) : 0),
  hand_kn: (q) => (q.unit === 'kN' && q.v >= 3 && q.v <= 200 ? 3 : 0),
  // délka přes nárazníky je nejdelší „m“ na voze; kratší (např. 7,00 m mezi otočnými čepy) ustoupí
  length: (q) => (q.unit === 'm' && q.v >= 8 && q.v <= 40 ? 1 + (q.decimals ? 2 : 0) + q.v / 100 : 0),
  speed: (q) => (q.unit === 'km/h' && q.v >= 10 && q.v <= 200 ? 3 : 0),
};

const REV = /\bREV\b|R[EÉ]V[\s.:]/i;
const DATE = /\b\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4}\b/;

/**
 * Nejlepší odhad hodnoty údaje z přečtených řádků.
 * Vrací { value (text k potvrzení), lines (indexy řádků, odkud je) } nebo null.
 */
export function extractField(field, lines) {
  if (field.type === 'number') {
    const c = numberCandidates(lines).find((x) => x.valid);
    return c ? { value: c.number, lines: c.lines, sure: c.sure } : null;
  }
  if (field.type === 'qty') {
    let best = null;
    for (const q of quantities(lines)) {
      const score = RULES[field.key](q);
      if (score > 0 && (!best || score > best.score)) best = { value: String(inUnit(q, field.unit)), lines: q.li, score };
    }
    // rychlost bez „km/h“: řádek tabulky zatížení SS = 120 km/h, S = 100 km/h
    if (!best && field.key === 'speed') {
      const ss = lines.findIndex((l) => /(^|\s)SS(\s|$)/.test(l.text));
      const s1 = lines.findIndex((l) => /(^|\s)S(\s|$)/.test(l.text));
      if (ss >= 0) best = { value: '120', lines: [ss], score: 1 };
      else if (s1 >= 0) best = { value: '100', lines: [s1], score: 1 };
    }
    return best;
  }
  // označení špalíků bývá samostatné písmeno u brzdy (LL, K, L)
  if (field.key === 'blocks') {
    const li = lines.findIndex((l) => /^(LL|K|L)$/.test(l.text.trim()));
    return li < 0 ? null : { value: lines[li].text.trim(), lines: [li] };
  }
  if (field.key === 'revize') {
    const li = lines.findIndex((l) => REV.test(l.text));
    if (li >= 0) {
      // celý řádek nápisu (REV, dílna a datum bývají vedle sebe)
      const row = lines.map((l, i) => [l, i]).filter(([l]) => l.row === lines[li].row);
      const text = row.map(([l]) => l.text).join(' ').replace(/\s+/g, ' ').trim();
      return { value: text, lines: row.map(([, i]) => i), dated: DATE.test(text) };
    }
    // „REV“ bývá v rámečku a síť ho často nepřečte: datum a vlevo od něj kód dílny („1003 18.06.26“)
    const di = lines.findIndex((l) => DATE.test(l.text));
    if (di < 0) return null;
    const date = lines[di].text.match(DATE)[0].replace(/\s/g, '');
    const left = lines[di - 1];
    const code = left && left.row === lines[di].row && /^[A-Z0-9-]{2,6}$/i.test(left.text.trim()) ? left.text.trim().toUpperCase() : '';
    return { value: ['REV', code, date].filter(Boolean).join(' '), lines: code ? [di - 1, di] : [di], dated: true };
  }
  return null;
}

/** Hodnota z řádku i, na který vozmistr ťukl (u čísla s jednotkou i se sousedním rámečkem, např. „23 500“ + „kg“). */
export function valueFromLine(field, lines, i) {
  const line = lines[i];
  if (field.type === 'number') return digitsOnly(line.text).slice(0, 12);
  if (field.type === 'qty') {
    const q = quantities(lines).find((x) => x.li.includes(i));
    const v = q ? inUnit(q, field.unit) : null;
    if (v !== null) return String(v);
    const n = line.text.match(/\d{1,3}(?:[ .]\d{3})+(?![,.]\d)|\d+(?:[,.]\d+)?/);
    return n ? n[0].replace(/[ .](?=\d{3})/g, '').replace(',', '.') : '';
  }
  return line.text.trim();
}

/** Text zadaný vozmistrem → uložená hodnota (číslo vozu bez mezer, čísla s tečkou). */
export function normalizeValue(field, text) {
  const t = String(text ?? '').trim();
  if (field.type === 'number') return digitsOnly(t);
  if (field.type === 'qty') {
    const v = Number(t.replace(/\s/g, '').replace(',', '.'));
    return t && Number.isFinite(v) ? String(v) : '';
  }
  return t;
}

export function isValidValue(field, value) {
  if (field.type === 'number') return isCompleteNumber(value);
  return value !== '' && value !== null && value !== undefined;
}

/** Hodnota k zobrazení (číslo vozu s mezerami, desetinná čárka). */
export function displayValue(field, value) {
  if (!value) return '';
  if (field.type === 'number') return formatNumber(value);
  if (field.type === 'qty') return `${Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${field.unit}`;
  if (field.key === 'axles') return `${value} náprav${Number(value) <= 4 ? 'y' : ''}`;
  if (field.type === 'switch') return field.options.find(([v]) => v === value)?.[1] ?? value;
  return value;
}

/** Řádky, které odpovídají potvrzené hodnotě (pro trénink sítě „který nápis je který údaj“). */
export function matchingLines(field, lines, value) {
  if (!value || field.type === 'switch') return [];
  if (field.type === 'number') {
    return lines.map((l, i) => [digitsOnly(l.text), i]).filter(([d]) => d.length >= 2 && value.includes(d)).map(([, i]) => i);
  }
  if (field.type === 'qty') {
    return quantities(lines).filter((q) => Math.abs((inUnit(q, field.unit) ?? NaN) - Number(value)) < 1e-6).flatMap((q) => q.li);
  }
  return lines.map((l, i) => [l, i]).filter(([l]) => l.text.length > 2 && value.includes(l.text.trim())).map(([, i]) => i);
}
