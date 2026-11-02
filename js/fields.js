// Údaje, které vozmistr snímá kamerou při obchůzce vozu, a jejich hledání v přečteném textu.
// Zatím pravidla (jednotka + rozsah hodnot + klíčová slova); potvrzené příklady z tréninku
// poslouží k natrénování sítě, která pozná, který nápis je který údaj.

import { numberCandidates, digitsOnly, formatNumber, isCompleteNumber, BLOCKS, LOAD_POSITIONS } from './model.js';
import { buffersAround, hull, revisionCells } from './frame.js';

/**
 * Barva rámečku hodnoty v tunách pod vlastní hmotností (ukládá se barva, ne význam).
 * Předpis čl. 562: červený rámeček = brzdicí váha pořádací brzdy, jinak ruční brzdy; čl. 529: pořádací brzda
 * se ovládá ručním kolem z boku vozu ze země, čl. 528: ruční (vřetenová) z plošiny. Rozhoduje jen to, zda je
 * rámeček červený – jakákoli jiná barva (černá, bílá…) znamená ovládání z plošiny.
 */
export const HAND_BRAKE = [['cerveny', 'Červený'], ['jiny', 'Jiná barva'], ['nema', 'Nemá']];
export const HAND_BRAKE_MEANING = {
  cerveny: 'pořádací brzda, ovládaná ze země',
  jiny: 'ruční brzda, ovládaná z plošiny',
  nema: 'bez ruční brzdy',
};
/** Starší hodnoty: verze 10 ukládala význam s obráceným výkladem (plošina = červený), verze 11 „černý“. */
export const HAND_BRAKE_OLD = { plosina: 'cerveny', zeme: 'jiny', cerny: 'jiny' };

/** Síla zajišťovací brzdy (t) – snímá se v jednom kroku s hmotností (bývá ve stejném rámečku pod ní). */
export const HAND_T = { key: 'hand_t', title: 'Síla zajišťovací brzdy', type: 'qty', unit: 't', wagonKey: 'hand_bw_t' };

/**
 * Kroky tréninku ve výchozím pořadí obchůzky (vozmistr si ho může přetažením změnit, viz trainer.js).
 * type: number = číslo vozu, qty = číslo s jednotkou, switch = volba tlačítkem (přestavovače, nápravy, špalíky),
 * text = volný text, weight = hmotnost + ruční brzda z jednoho rámečku,
 * loadbrake = poloha přestavovače prázdný/ložený tlačítkem + brzdicí váhy a přestavná hmotnost z nápisu,
 * force = zajišťovací síla (jeden údaj, nebo Min / Max a n/N), revision = revize (roky, datum, prodloužení).
 * wagonKey = kam se hodnota uloží k vozu (numeric = jako číslo), default = předvolená volba, bad = volba červeně,
 * derived = údaj nemá vlastní krok ani snímek: odvodí se z jiného kroku a vozmistr ho potvrdí v něm.
 * optional = údaj na voze může chybět – krok má tlačítko „Na voze není“ (ostatní se musí vyplnit).
 */
export const FIELDS = [
  { key: 'cislo', title: 'Číslo vozu', short: 'Číslo vozu', hint: '12místné číslo na boku vozu', type: 'number' },
  // počet náprav z řady vozu (5.–8. číslice, js/series.js) – potvrzuje se spolu s číslem; celý vůz se nefotí
  { key: 'axles', title: 'Počet náprav', short: 'Nápravy', type: 'switch', derived: 'cislo',
    options: [['2', '2'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8']], wagonKey: 'axles', numeric: true },
  { key: 'tare', title: 'Hmotnost a ruční brzda', short: 'Hmotnost + RB', type: 'weight', unit: 'kg', wagonKey: 'tare_kg',
    hint: 'rámeček s vlastní hmotností (kg) a pod ní síla zajišťovací brzdy (t)' },
  // jeden údaj „20,2 kN“, nebo „Min … kN (Max … kN)“ s počtem náprav n/N (předpis čl. 562); k vozu viz forceToWagon
  { key: 'hand_kn', title: 'Zajišťovací síla', short: 'Zaj. síla (kN)', type: 'force', unit: 'kN', optional: true,
    hint: 'v kN: jeden údaj (20,2 kN), nebo „Min … kN (Max … kN)“ a drobně n/N' },
  { key: 'length', title: 'Délka přes nárazníky', short: 'Délka', hint: 'v metrech, např. 15,74 m', type: 'qty', unit: 'm', wagonKey: 'length_m' },
  { key: 'speed', title: 'Nejvyšší dovolená rychlost', short: 'Rychlost', hint: 'v km/h, např. 100 nebo 120 (S / SS v tabulce zatížení)',
    type: 'qty', unit: 'km/h', wagonKey: 'max_speed' },
  { key: 'blocks', title: 'Druh brzdových špalíků', short: 'Špalíky', hint: 'K, L, LL nekovové · D kotoučová brzda · F litinové', type: 'switch',
    options: BLOCKS.map(([v, l]) => [v, l]), wagonKey: 'blocks' },
  { key: 'rezim', title: 'Přestavovač G/P', short: 'G/P', hint: 'páka režimu brzdění', type: 'switch', options: [['G', 'G'], ['P', 'P']], default: 'P',
    optional: true },
  { key: 'naklad', title: 'Přestavovač prázdný / ložený', short: 'Prázdný/ložený', type: 'loadbrake',
    hint: 'štítek u páky: nahoře brzdicí váhy, dole přestavná hmotnost; samočinný: „MAX … t“',
    options: LOAD_POSITIONS, default: 'prazdny' },
  // vypínací ústrojí brzdy (čl. 571): červená rukojeť svisle dolů = zapnuto, přibližně vodorovně = vypnuto
  { key: 'kohout', title: 'Páka vypnutí brzdy', short: 'Vypnutí brzdy', type: 'switch',
    hint: 'červená rukojeť: svisle dolů = zapnuto, vodorovně = vypnuto',
    options: [['zapnuta', 'Zapnuta'], ['vypnuta', 'Vypnuta']], default: 'zapnuta', bad: ['vypnuta'] },
  { key: 'revize', title: 'Revize', short: 'Revize', type: 'revision', wagonKey: 'revision',
    hint: '1. rámeček = počet let, poslední rámeček = datum, případně volně „+3 M“' },
];
export const FIELD = Object.fromEntries([...FIELDS, HAND_T].map((f) => [f.key, f]));

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
  // bez snímku (nebo když symboly nárazníků nejsou vidět) nejdelší „m“ na voze; kratší (např. 7,00 m mezi
  // otočnými čepy) ustoupí. Délka mezi symboly nárazníků má přednost vždy (viz extractField).
  length: (q) => (q.unit === 'm' && q.v >= 8 && q.v <= 40 ? 1 + (q.decimals ? 2 : 0) + q.v / 100 : 0),
  speed: (q) => (q.unit === 'km/h' && q.v >= 10 && q.v <= 200 ? 3 : 0),
};

const REV = /\bREV\b|R[EÉ]V[\s.:]/i;
const DATE = /\b\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4}\b/;

/** Délka přes nárazníky je na voze vždy mezi symboly nárazníků „⊢— 12,04 m —⊣“ (hledají se v obraze, js/frame.js). */
function betweenBuffers(q, lines, canvas) {
  if (!canvas || q.unit !== 'm' || q.v < 5 || q.v > 40) return false;
  const ls = q.li.map((i) => lines[i]);
  const tilted = ls.find((l) => l.angle != null);
  const b = buffersAround(canvas, { ...hull(ls), ...(tilted ? { angle: tilted.angle } : {}), ...(ls.length === 1 && ls[0].th ? { th: ls[0].th } : {}) });
  return b.left && b.right;
}

// Řádek tabulky zatížení: „S“ = do 100 km/h, „SS“ = do 120 km/h, za ním hodnoty v t („37,0“, „00,0“).
const LOAD_ROW = /^(SS|S)(?![A-Za-zÀ-ž])\s*(.*)$/;
const LOAD_VALUE = /\d{1,3}[.,]\d/g;

/**
 * Rychlost z tabulky zatížení (nápis „km/h“ na vozech skoro nebývá). Řádek platí, jen když je v něm aspoň jedna
 * nenulová hodnota (s desetinnou částí, v textu řádku nebo v rámečcích vpravo ve stejné výšce) – samotné písmeno S
 * bývá i jinde na voze, řádek s nulami neplatí. Platný SS → 120, jinak platný S → 100. Vůz se 120 má i řádek S
 * (SS je pod ním): když je pod řádkem S málo místa do kraje snímku, SS mohl být mimo záběr → partial (mimo krok
 * rychlosti se nebere). table: hodnota je z tabulky.
 */
function loadTableSpeed(lines, canvas) {
  const valid = {};
  for (const [i, l] of lines.entries()) {
    const m = l.text.trim().match(LOAD_ROW);
    if (!m) continue;
    const cy = l.y + l.h / 2;
    const right = lines.map((o, j) => [o, j]).filter(([o]) => o !== l && Math.abs(o.y + o.h / 2 - cy) < l.h * 0.6
      && o.x > l.x && o.x - (l.x + l.w) < l.h * 15);
    const values = [m[2], ...right.map(([o]) => o.text)].flatMap((t) => zeros(t).match(LOAD_VALUE) ?? []);
    if (!values.some((v) => Number(v.replace(',', '.')) > 0)) continue;
    valid[m[1]] ??= { l, lines: [i, ...right.map(([, j]) => j)] };
  }
  if (valid.SS) return { value: '120', lines: valid.SS.lines, score: 1, table: true };
  if (!valid.S) return null;
  const { l } = valid.S;
  const partial = Boolean(canvas) && canvas.height - (l.y + l.h) < l.h * 1.5;
  return { value: '100', lines: valid.S.lines, score: 1, table: true, partial };
}

/**
 * Nejlepší odhad hodnoty údaje z přečtených řádků; canvas = snímek, ze kterého jsou (u délky symboly nárazníků).
 * Vrací { value (text k potvrzení), lines (indexy řádků, odkud je), buffers (délka mezi nárazníky) } nebo null.
 */
export function extractField(field, lines, canvas = null) {
  if (field.type === 'number') {
    const cands = numberCandidates(lines);
    const c = cands.find((x) => x.sure) ?? cands.find((x) => x.valid);
    return c ? { value: c.number, lines: c.lines, sure: c.sure } : null;
  }
  if (field.type === 'qty' || field.type === 'weight') {
    let best = null;
    for (const q0 of quantities(lines)) {
      // symbol nárazníku „⊢“ se občas přečte jako 1 („117,0m“ = ⊢ 17,0 m) – bez té 1 se bere jen mezi nárazníky
      const k = Math.floor(Math.log10(q0.v));
      const alt = field.key === 'length' && q0.unit === 'm' && q0.v > 40 && Math.floor(q0.v / 10 ** k) === 1
        ? { ...q0, v: Math.round((q0.v - 10 ** k) * 100) / 100, alt: true } : null;
      for (const q of alt ? [q0, alt] : [q0]) {
        const buffers = field.key === 'length' && betweenBuffers(q, lines, canvas);
        const score = buffers ? 10 + q.v / 100 : q.alt ? 0 : RULES[field.key](q);
        if (score > 0 && (!best || score > best.score)) best = { value: String(inUnit(q, field.unit)), lines: q.li, score, buffers };
      }
    }
    if (!best && field.key === 'speed') best = loadTableSpeed(lines, canvas);
    return best;
  }
  // označení špalíků bývá samostatné písmeno u brzdy (LL, K, L)
  if (field.key === 'blocks') {
    const li = lines.findIndex((l) => /^(LL|K|L)$/.test(l.text.trim()));
    return li < 0 ? null : { value: lines[li].text.trim(), lines: [li] };
  }
  if (field.key === 'revize') return extractRevision(lines, canvas);
  if (field.type === 'force') return extractHandForce(lines);
  return null;
}

// ───── Zajišťovací síla ruční brzdy (předpis čl. 562, 427) ─────
// Starší vozy: jeden údaj „20,2 kN“ (maximální zajišťovací síla). Novější: „Min 18,0 kN“, pod ním nebo za ním
// „( Max 36,0 kN )“ a drobně „n/N“ – n náprav, na které působí ruční brzda, z N náprav vozu; bývá i jen Min.
// Hodnota se ukládá jako text: jeden údaj „20.2“, jinak „Min|Max|n/N“ („18|36|2/4“, jen Min „14||2/2“).

// i Min jen s kN – „R min 35 m“ (nejmenší poloměr oblouku) na voze bývá taky
const MIN_KN = /\bM[il1|]n\b\.?\s*[:=]?\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*k?\s?N\b/i;
// Max jen s kN – „MAX: 58 t“ je brzdicí váha samočinného brzdění, „MAX: 2,5 %“ sklon u ruční brzdy (TSI WAG)
const MAX_KN = /\bMax\b\.?\s*[:=]?\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*k?\s?N\b/i;
const N_OF_N = /(?<![\d.,])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d.,])/;
// drobné lomítko síť čte jako 1 nebo l: „kN )2/4“ → „KN)214“, samotné „2/4“ → „214“
const N_OF_N_SLASH1 = /^\)?\s*(\d)\s*[1lI|]\s*(\d{1,2})$/;
const FORCE_RANGE = (v) => v >= 3 && v <= 200;

/** Uložený text zajišťovací síly → { single } nebo { min, max, n, N } (chybějící = null). */
export function parseForce(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!s.includes('|')) return Number.isFinite(Number(s)) ? { single: Number(s) } : null;
  const [a, b, nn] = s.split('|');
  const [n, N] = (nn ?? '').split('/').map((x) => (x ? Number(x) : null));
  return { min: a ? Number(a) : null, max: b ? Number(b) : null, n: n ?? null, N: N ?? null };
}

export function formatForce(f) {
  if (!f) return '';
  if (f.single != null) return String(f.single);
  return `${f.min ?? ''}|${f.max ?? ''}|${f.n != null && f.N != null ? `${f.n}/${f.N}` : ''}`;
}

const kn = (v) => `${Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} kN`;
/** „20,2 kN“, „Min 18 kN · Max 36 kN · n/N 2/4“. */
export function describeForce(f) {
  if (!f) return '';
  if (f.single != null) return kn(f.single);
  return [f.min != null && `Min ${kn(f.min)}`, f.max != null && `Max ${kn(f.max)}`, f.n != null && f.N != null && `n/N ${f.n}/${f.N}`]
    .filter(Boolean).join(' · ');
}

/** Zajišťovací síla z nápisu → údaje vozu (co nápis neříká, zůstane z paměti: n/N u jednoho údaje). */
export function forceToWagon(f, old = {}) {
  if (!f) return {};
  if (f.single != null) return { hand_force_kn: f.single, hand_force_min_kn: null, hand_force_max_kn: null };
  return {
    hand_force_kn: null, hand_force_min_kn: f.min, hand_force_max_kn: f.max,
    hand_n: f.n ?? old.hand_n ?? null, hand_N: f.N ?? old.hand_N ?? null,
  };
}

/** Údaje vozu → zajišťovací síla jako na nápisu (null, když ji vůz nemá). */
export function wagonForce(w) {
  if (!w) return null;
  if (w.hand_force_min_kn != null || w.hand_force_max_kn != null) {
    return { min: w.hand_force_min_kn ?? null, max: w.hand_force_max_kn ?? null, n: w.hand_n ?? null, N: w.hand_N ?? null };
  }
  return w.hand_force_kn != null ? { single: w.hand_force_kn } : null;
}

const validNN = (n, N) => n >= 1 && N >= 2 && N <= 12 && n <= N;

// Text nápisu i s navazujícími rámečky vpravo ve stejné výšce. Síť dělí nápis na víc rámečků a pořadí řádků
// na nakloněném snímku nebo s brzdovým symbolem vedle bývá nejisté („kN | 18,0 | Min“), proto podle polohy.
function chainRight(lines, i) {
  const li = [i];
  let cur = lines[i];
  for (;;) {
    const h = cur.th ?? cur.h;
    const next = lines.map((l, j) => [l, j]).filter(([l, j]) => !li.includes(j)
      && l.x > cur.x + cur.w * 0.5 && l.x - (cur.x + cur.w) < h * 1.5
      && Math.abs(l.y + l.h / 2 - (cur.y + cur.h / 2)) < Math.max(h, l.th ?? l.h) * 0.5)
      .sort((a, b) => a[0].x - b[0].x)[0];
    if (!next) break;
    li.push(next[1]);
    cur = next[0];
  }
  return { text: li.map((j) => lines[j].text).join(' '), li };
}

const decimal = (s) => Number(s.replace(',', '.'));

/** n/N v textu nápisu (i s lomítkem přečteným jako 1 za závorkou nebo v samostatném drobném nápisu). */
function nOfN(text, alone) {
  const t = zeros(text);
  let m = t.match(N_OF_N);
  if (!m) m = t.match(/\)\s*(\d)\s*[1lI|]\s*(\d{1,2})(?![\d.,])/) ?? (alone ? t.trim().match(N_OF_N_SLASH1) : null);
  return m && validNN(Number(m[1]), Number(m[2])) ? { n: Number(m[1]), N: Number(m[2]) } : null;
}

/**
 * Zajišťovací síla z přečtených řádků. Vrací { value (text jako parseForce), force, lines } nebo null.
 * Nápis s Min: Max a n/N se hledají v jeho okolí (pod ním a vpravo); bez Min jeden údaj s kN (ne u Max).
 */
export function extractHandForce(lines) {
  let min = null;
  for (const [i, l] of lines.entries()) {
    if (!/\bM[il1|]n\b/i.test(l.text)) continue;
    const c = chainRight(lines, i);
    const m = zeros(c.text).match(MIN_KN);
    if (m && FORCE_RANGE(decimal(m[1]))) { min = { v: decimal(m[1]), li: c.li, line: l }; break; }
  }
  // okolí nápisu Min: Max bývá pod ním (menším písmem) nebo za ním, n/N vpravo dole
  const near = (l) => {
    if (!min) return true;
    const r = min.line;
    const h = r.th ?? r.h;
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    return cx > r.x - h * 2 && cx < r.x + r.w + h * 14 && cy > r.y - h * 0.5 && cy < r.y + r.h + h * 2.5;
  };
  let max = null;
  for (const [i, l] of lines.entries()) {
    if (!/\bMax\b/i.test(l.text) || !near(l)) continue;
    const c = chainRight(lines, i);
    const m = zeros(c.text).match(MAX_KN);
    if (m && FORCE_RANGE(decimal(m[1]))) { max = { v: decimal(m[1]), li: c.li, text: c.text }; break; }
  }
  // Max bez přečteného slova Min: Min je číslo s kN nad Max nebo před ním
  if (!min && max) {
    const q = quantities(lines).find((x) => x.unit === 'kN' && !x.li.some((i) => max.li.includes(i)) && !/\bMax\b/i.test(x.text) && FORCE_RANGE(x.v));
    if (q) min = { v: q.v, li: q.li, line: lines[q.li[0]] };
  }
  if (min) {
    const used = new Set([...min.li, ...(max?.li ?? [])]);
    let nn = nOfN(max?.text ?? '', false) ?? nOfN(chainRight(lines, min.li[0]).text, false);
    let nnLi = nn ? (max?.li ?? min.li) : [];
    if (!nn) {
      for (const [i, l] of lines.entries()) {
        if (used.has(i) || !near(l)) continue;
        nn = nOfN(l.text, true);
        if (nn) { nnLi = [i]; break; }
      }
    }
    const force = { min: min.v, max: max?.v ?? null, n: nn?.n ?? null, N: nn?.N ?? null };
    return { value: formatForce(force), force, lines: [...new Set([...min.li, ...(max?.li ?? []), ...nnLi])] };
  }
  // jeden údaj: číslo s kN mimo nápisy s Max
  const q = quantities(lines).find((x) => x.unit === 'kN' && FORCE_RANGE(x.v) && !/\bMax\b/i.test(x.text));
  if (!q) return null;
  const force = { single: q.v };
  return { value: formatForce(force), force, lines: q.li };
}

/** Ťuknutý nápis → co z něj jde do polí zajišťovací síly: { kind, a, b, nN } (jen přečtené části). */
export function forceFromLine(lines, i) {
  const c = chainRight(lines, i);
  const t = zeros(c.text);
  const out = {};
  const mi = t.match(MIN_KN);
  const ma = t.match(MAX_KN);
  if (mi) Object.assign(out, { kind: 'min', a: mi[1].replace('.', ',') });
  if (ma) Object.assign(out, { kind: 'min', b: ma[1].replace('.', ',') });
  const nn = nOfN(t, true);
  if (nn) out.nN = `${nn.n}/${nn.N}`;
  if (!mi && !ma && !nn) {
    const q = quantities(lines).find((x) => x.li.includes(i) && x.unit === 'kN');
    const n = q ? String(q.v) : t.match(/\d+(?:[,.]\d+)?/)?.[0];
    if (n) out.a = n.replace('.', ',');
  }
  return out;
}

// ───── Revize: [roky] … [datum] +M ─────
// V prvním rámečku je počet let platnosti, v posledním datum revize; písmena mezi nimi (dílna) nejsou potřeba.
// Volně za rámečky může být „+3 M“ = prodloužení o 3 měsíce. Platí do = datum + roky + měsíce.
// Hodnota se ukládá jako „roky|datum|měsíce“ (např. „6|13.03.24|3“).

const EXT = /\+\s*(\d{1,2})\s*M/i;

export function parseRevision(v) {
  const [years, date, ext] = String(v ?? '').includes('|') ? String(v).split('|') : ['', String(v ?? '').match(DATE)?.[0] ?? '', ''];
  return { years: years ? Number(years) : null, date: (date ?? '').replace(/\s/g, ''), ext: ext ? Number(ext) : 0 };
}

export const formatRevision = ({ years, date, ext }) => `${years ?? ''}|${date ?? ''}|${ext || 0}`;

/** Datum revize „dd.mm.rr“ nebo „dd.mm.rrrr“ → Date (null, když nedává smysl). */
export function parseRevDate(text) {
  const m = String(text ?? '').match(/(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y < 80 ? 2000 : 1900;
  const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]) ? d : null;
}

/**
 * Ruční psaní data „dd.mm.rr“: tečky se doplní samy (iPhone v češtině má u číselné klávesnice jen čárku).
 * Po dvou číslicích dne a měsíce se tečka přidá hned, při mazání ne (jinak by nešla smazat). Čárka nebo
 * tečka napsaná dřív ukončí den / měsíc s jednou číslicí („1,3,24“ → „1.3.24“).
 */
export function maskDate(text, deleting = false) {
  const parts = [''];
  for (const ch of String(text ?? '')) {
    const last = parts.length - 1;
    if (/\d/.test(ch)) {
      if (last < 2 && parts[last].length === 2) parts.push(ch);
      else if (last < 2 || parts[last].length < 4) parts[last] += ch;
    } else if (/[.,/-]/.test(ch) && parts[last] && last < 2) parts.push('');
  }
  if (!deleting && parts.length < 3 && parts.at(-1).length === 2) parts.push('');
  return parts.join('.');
}

/** Platnost revize: { until: Date | null, expired, soon } (soon = vyprší do 30 dnů). */
export function revisionStatus(rev) {
  const r = typeof rev === 'string' ? parseRevision(rev) : rev;
  const d = parseRevDate(r?.date);
  if (!d || !r.years) return { until: null, expired: false, soon: false };
  const until = new Date(d.getFullYear() + r.years, d.getMonth() + (r.ext || 0), d.getDate());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { until, expired: until < today, soon: until >= today && until - today < 30 * 86400000 };
}

export const formatDay = (d) => (d ? `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}` : '');

const YEARS = /^\d{1,2}\s*[JjLlRr]?$/;
const yearsIn = (l) => YEARS.test(l.text.trim()) && Number(l.text.match(/\d+/)[0]) >= 1 && Number(l.text.match(/\d+/)[0]) <= 12;
const YEARS_REV = /^(\d{1,2})\s*REV/i;   // roky slité se slovem REV v horní buňce obdélníku pod sebou („4 REV“)
// slovo REV i slité s roky nebo dílnou („6REV“, „REVUL“), ne uvnitř jiného slova
const REV_WORD = /(^|[^A-Za-zÀ-ž])R[EÉ]V/i;
const YEARS_AT_REV = /(?:^|\D)(\d{1,2})\s*R[EÉ]V/i;

/**
 * Revize bez nalezených čar obdélníku (rozmazaná, šikmá, useknutá): bere se jen datum přímo u slova REV – za ním
 * ve stejném řádku („6 REV UL 16.08.21“, i REV jako samostatný rámeček vlevo), nebo pod ním (obdélník pod sebou
 * „4 REV“ / dílna / datum). Jiná data na voze ne. Roky = číslo před REV (nebo samostatné číslo těsně vlevo od REV).
 */
function revisionAtWord(lines) {
  const items = lines.map((l, i) => [l, i]);
  for (const [dl, di] of items) {
    const t = zeros(dl.text);
    const m = t.match(DATE);
    if (!m) continue;
    const rev = t.slice(0, m.index).search(REV_WORD) >= 0 ? [dl, di]
      : items.find(([x]) => x !== dl && x.row === dl.row && REV_WORD.test(x.text)
        && x.x + x.w <= dl.x + dl.h * 0.5 && dl.x - (x.x + x.w) < dl.h * 8)
      ?? items.find(([x]) => x !== dl && REV_WORD.test(x.text) && x.y + x.h <= dl.y + dl.h * 0.3
        && dl.y - (x.y + x.h) < dl.h * 3 && x.x < dl.x + dl.w && x.x + x.w > dl.x);
    if (!rev) continue;
    const [rl, ri] = rev;
    const own = (rl === dl ? t.slice(0, m.index) : rl.text).match(YEARS_AT_REV);
    const left = own ? null : items.find(([x]) => x !== rl && x.row === rl.row && yearsIn(x)
      && x.x < rl.x && rl.x - (x.x + x.w) < rl.h * 3);
    const years = own ? Number(own[1]) : left ? Number(left[0].text.match(/\d+/)[0]) : null;
    const right = items.filter(([l]) => l.x > dl.x + dl.w * 0.5 && Math.abs(l.y + l.h / 2 - (dl.y + dl.h / 2)) < dl.h * 1.2);
    const extHit = t.slice(m.index).match(EXT) ?? right.map(([l]) => l.text).join(' ').match(EXT);
    const r = { years: years >= 1 && years <= 12 ? years : null, date: m[0].replace(/\s/g, ''), ext: extHit ? Number(extHit[1]) : 0 };
    return {
      value: formatRevision(r), rev: r, yearsBox: null, cells: 0, stacked: false, byWord: true,
      lines: [...new Set([left?.[1], ri, di].filter((i) => i != null))],
    };
  }
  return null;
}

/**
 * Revize je obdélník rozdělený na buňky: v 1. buňce roky platnosti, v poslední datum, mezi nimi dílna – vedle sebe,
 * nebo pod sebou („4 REV“ / dílna / datum). Bere se datum v takovém obdélníku (čáry hledá v obraze revisionCells
 * z frame.js): vedle sebe musí být vlevo od data aspoň jedna buňka, pod sebou nad datem další buňka. Když čáry
 * vidět nejsou, jen datum přímo u slova REV (revisionAtWord). Jiná data na voze (lhůty v tabulce, data na štítcích)
 * se neberou.
 * Roky = číslo 1–12 v 1. buňce (pod sebou v buňkách nad datem, i „4 REV“); když ho detektor přehlédne, dočte se
 * celá 1. buňka. Datum = text dd.mm.rr, „+N M“ za ním. yearsBox = kde dočíst roky (readRevisionYears),
 * cells = počet buněk vedle sebe, stacked = obdélník pod sebou.
 */
export function extractRevision(lines, canvas = null) {
  const boxed = !canvas ? [] : lines.map((l, i) => [l, i]).filter(([l]) => DATE.test(zeros(l.text)))
    .map(([l, i]) => [l, i, revisionCells(canvas, l)])
    .filter(([, , g]) => g && (g.stacked || g.dateCell >= 1));   // datum v 1. buňce = obdélník nepatří k revizi
  if (!boxed.length) return revisionAtWord(lines);
  // přednost má datum v řádku se slovem REV, pak datum v poslední buňce
  const pick = boxed.find(([l]) => lines.some((x) => x.row === l.row && REV.test(x.text)))
    ?? boxed.find(([, , g]) => g.dateCell === g.cells.length - 1) ?? boxed[0];
  const [dl, di, cells] = pick;
  const date = zeros(dl.text).match(DATE)[0].replace(/\s/g, '');
  const above = cells.stacked ? lines.map((l, i) => [l, i]).filter(([l]) => cells.above(l)).sort((p, q) => p[0].x - q[0].x) : [];
  const yearsHit = cells.stacked
    ? above.find(([l]) => yearsIn(l) || yearsIn({ text: l.text.match(YEARS_REV)?.[1] ?? '' }))
    : lines.map((l, i) => [l, i]).find(([l]) => cells.cellOf(l) === 0 && yearsIn(l));
  // „+3 M“ bývá hned za datem, někdy jako samostatné rámečky „+3“ a „M“
  const right = lines.map((l, i) => [l, i]).filter(([l]) => l.x > dl.x + dl.w * 0.5
    && Math.abs(l.y + l.h / 2 - (dl.y + dl.h / 2)) < dl.h * 1.2);
  const tail = right.map(([l]) => l.text).join(' ');
  const extHit = tail.match(EXT) ?? dl.text.match(EXT);
  const rev = { years: yearsHit ? Number(yearsHit[0].text.match(/\d+/)[0]) : null, date, ext: extHit ? Number(extHit[1]) : 0 };
  // kde dočíst roky, když je síť nepřečetla (samotnou číslici v rámečku detektor přehlíží): 1. buňka;
  // pod sebou místo od levého okraje obdélníku před „REV“ (buňka s roky bývá zhruba čtvercová)
  const rev1 = above.find(([l]) => REV.test(l.text) && l.x > cells.frameLeft)?.[0];
  const yearsBox = yearsHit ? null
    : cells.stacked ? rev1 && { x: cells.frameLeft + rev1.h * 0.15, y: rev1.y, w: Math.min(rev1.x - cells.frameLeft - rev1.h * 0.3, rev1.h * 1.1), h: rev1.h }
      : cells.cells[0];
  return {
    value: formatRevision(rev), rev, yearsBox, cells: cells.cells.length, stacked: Boolean(cells.stacked),
    lines: [yearsHit?.[1], di, ...(extHit ? right.filter(([l]) => /\+|M/i.test(l.text)).map(([, i]) => i) : [])].filter((i) => i != null),
  };
}

/** Roky z místa 1. rámečku přečtené přímo (bez hledání nápisů); readLine = čtení jednoho řádku z ocr.js. */
export async function readRevisionYears(found, src, readLine) {
  if (!found?.yearsBox || found.yearsBox.w < 8) return found;
  const { text } = await readLine(src, found.yearsBox).catch(() => ({ text: '' }));
  // kolem číslice nanejvýš zbytky čar („|6“, „6)“), ne písmena – „AM9“ je kód dílny, ne 9 let
  const n = Number(text.trim().match(/^[^\p{L}\d]{0,2}(\d{1,2})\s*[JjLlRr]?[^\p{L}\d]{0,2}$/u)?.[1]);
  if (!(n >= 1 && n <= 12)) return found;
  const rev = { ...found.rev, years: n };
  return { ...found, rev, value: formatRevision(rev) };
}

/**
 * Síla zajišťovací brzdy (t): v rámečku s hmotností je přímo pod ní (překrývá se vodorovně a leží
 * do dvou výšek řádku níž). Když tam není, nejlepší „t“ podle obecného pravidla. Vrací jako extractField.
 */
export function extractHandT(lines, tare) {
  const qs = quantities(lines).filter((q) => q.unit === 't' && q.v >= 3 && q.v <= 60);
  const top = tare?.lines?.map((i) => lines[i]).filter(Boolean) ?? [];
  if (top.length) {
    const x0 = Math.min(...top.map((l) => l.x));
    const x1 = Math.max(...top.map((l) => l.x + l.w));
    const y1 = Math.max(...top.map((l) => l.y + l.h));
    const h = Math.max(...top.map((l) => l.h));
    const below = qs.find((q) => q.li.some((i) => {
      const l = lines[i];
      return l.y >= y1 - h * 0.6 && l.y <= y1 + h * 1.5 && Math.min(x1, l.x + l.w) - Math.max(x0, l.x) > 0;
    }));
    if (below) return { value: String(below.v), lines: below.li, below: true };
  }
  return extractField(HAND_T, lines);
}

// ───── Brzdicí váhy u přestavovače prázdný / ložený (předpis příl. 2, čl. 285, 288, 562, 567) ─────
// Ruční přestavovač P-L a P-½L-L: štítek u páky, nahoře v okénkách brzdicí váhy u poloh kliky (zleva prázdný,
// ½ ložený, ložený), pod nimi „BRZDÍCÍ VÁHA“ / „Bremsgewicht“, dole mezi polohami přestavná hmotnost
// („PŘESTAV. 30 HMOT.“, „Umstell 44 Gewicht“; u P-½L-L dvě). Čísla jsou bez jednotky (t).
// Samočinný přestavovač P-L: nápis na skříni „00 t  00 t“ (prázdný, ložený), pod nimi „00 t“ (přestavná hmotnost).
// Samočinné brzdění podle nákladu: „KE-GP-A  MAX: 58 t“ = nejvyšší brzdicí váha pro G i P.

/** Údaje u přestavovače: brzdicí váhy prázdný / ½ ložený / ložený, přestavné hmotnosti, MAX (vše v t). */
export const LOAD_KEYS = ['empty', 'half', 'loaded', 'change', 'change2', 'max'];
export const LOAD_LABELS = {
  empty: 'BV prázdný', half: 'BV ½ ložený', loaded: 'BV ložený', change: 'přestavná hmotnost', change2: 'přestavná ½ → ložený', max: 'BV MAX',
};

const BW_WORD = /emsg|msgew|brzd|v[áa]h/i;                // „Bremsgewicht“, „BRZDÍCÍ VÁHA“ (síť čte i „remsgewicht“, „Mmsgewicht“)
const CHANGE_WORD = /umst|mstel|p[řr]est|hmot/i;          // „Umstell … Gewicht“, „PŘESTAV. … HMOT.“
const POS_WORD = /leer|^\W?.el\.?$|pr[áa]zd|lo[žz]en/i;   // polohy kliky „Leer“ / „Bel.“, „PRÁZDNÝ“ / „LOŽENÝ“
const MAX_BW = /MAX\s*[.:]?\s*(\d{2,3})\s*t/i;
const LOAD_BRAKE = /\b[A-Z][A-Za-z]{0,2}\s?-\s?[GPR]{1,3}\s?-\s?A\b/;   // KE-GP-A, DK-GP-A: samočinné brzdění podle nákladu
const BW_RANGE = (v) => v >= 5 && v <= 200;

// Celá čísla na štítku s polohou v obraze. Sousední okénka síť občas slije do jednoho slova:
// „2751“ = 27 a 51, „26158“ = 26 | 58 (svislá hrana okénka přečtená jako 1), „213060“ = 21, 30, 60.
function plateTokens(lines) {
  const out = [];
  lines.forEach((l, li) => {
    const text = zeros(l.text);
    for (const m of text.matchAll(/\d+/g)) {
      const d = m[0];
      const parts = d.length === 4 ? [d.slice(0, 2), d.slice(2)]
        : d.length === 5 && d[2] === '1' ? [d.slice(0, 2), d.slice(3)]
          : d.length === 6 ? [d.slice(0, 2), d.slice(2, 4), d.slice(4)]
            : d.length <= 3 ? [d] : [];
      parts.forEach((p, k) => {
        const at = (m.index + ((k + 0.5) * d.length) / parts.length) / text.length;
        out.push({ v: Number(p), li, x: l.x + l.w * at, cy: l.y + l.h / 2, row: l.row ?? 0 });
      });
    }
  });
  return out.filter((t) => BW_RANGE(t.v));
}

/** Čísla z jednoho nápisu (ťuknutí na rámeček): [27, 51], [44], u „MAX: 58 t“ { max: 58 }. */
export function loadNumbers(text) {
  const m = zeros(text).match(MAX_BW);
  return m ? { max: Number(m[1]) } : plateTokens([{ text, x: 0, y: 0, w: 1, h: 1 }]).map((t) => t.v);
}

// Štítek ručního přestavovače: brzdicí váhy = řada 2–3 rostoucích čísel nad nápisem „Bremsgewicht“ (nebo nad
// slovy poloh / přestavné hmotnosti), přestavná hmotnost = číslo v řádku „Umstell … Gewicht“, jinak pod nápisem.
function extractPlate(lines) {
  const words = lines.map((l, i) => [l, i]).filter(([l]) => BW_WORD.test(l.text) || CHANGE_WORD.test(l.text) || POS_WORD.test(l.text.trim()));
  if (!words.length) return null;
  const bwWord = words.find(([l]) => BW_WORD.test(l.text) && !CHANGE_WORD.test(l.text))?.[0];
  const ref = bwWord ?? hull(words.map(([l]) => l));
  const wh = Math.min(...words.map(([l]) => l.th ?? l.h));
  const top = bwWord ? bwWord.y + bwWord.h / 2 : Math.min(...words.map(([l]) => l.y + l.h / 2));
  const span = Math.max(ref.w, wh * 4) * 0.6;
  const inside = (t) => t.x > ref.x - span && t.x < ref.x + ref.w + span;
  const toks = plateTokens(lines).filter(inside);
  const out = { values: {}, at: {} };
  // brzdicí váhy: nejbližší řada nad nápisem se 2–3 rostoucími čísly (zleva prázdný, ½ ložený, ložený)
  const above = toks.filter((t) => t.cy < top - wh * 0.3 && t.cy > top - wh * 7);
  const rows = [...new Set(above.map((t) => t.row))].sort((a, b) => b - a);
  for (const r of rows) {
    const row = above.filter((t) => t.row === r).sort((a, b) => a.x - b.x);
    if (row.length < 2 || row.length > 3 || row.some((t, i) => i && t.v <= row[i - 1].v)) continue;
    const keys = row.length === 3 ? ['empty', 'half', 'loaded'] : ['empty', 'loaded'];
    keys.forEach((k, i) => { out.values[k] = row[i].v; out.at[k] = [row[i].li]; });
    break;
  }
  // přestavná hmotnost: v řádku se slovem „Umstell“ / „PŘESTAV.“, jinak pod nápisem; vyšší než brzdicí váha prázdný
  const used = new Set(Object.values(out.at).flat());
  const changeRows = new Set(words.filter(([l]) => CHANGE_WORD.test(l.text)).map(([l]) => l.row));
  const plausible = (t) => !used.has(t.li) && (out.values.empty == null || t.v > out.values.empty);
  const below = toks.filter((t) => plausible(t) && t.cy > top + wh * 0.3 && t.cy < top + wh * 9);
  const inRow = toks.filter((t) => plausible(t) && changeRows.has(t.row));
  const firstRow = Math.min(...below.map((t) => t.row));
  const cands = (inRow.length ? inRow : below.filter((t) => t.row === firstRow)).sort((a, b) => a.x - b.x);
  if (cands.length === 2 && cands[0].v < cands[1].v && (out.values.half != null || out.values.empty == null)) {
    out.values.change = cands[0].v; out.at.change = [cands[0].li];
    out.values.change2 = cands[1].v; out.at.change2 = [cands[1].li];
  } else if (cands.length) {
    // u P-L je jen jedna – uprostřed štítku
    const mid = ref.x + ref.w / 2;
    const c = cands.reduce((a, b) => (Math.abs(b.x - mid) < Math.abs(a.x - mid) ? b : a));
    out.values.change = c.v; out.at.change = [c.li];
  }
  return Object.keys(out.values).length ? out : null;
}

// Nápis samočinného přestavovače P-L na skříni: dvě hodnoty s t vedle sebe, pod nimi jedna (přestavná hmotnost).
function extractAutoTable(lines) {
  const qs = quantities(lines).filter((q) => q.unit === 't' && BW_RANGE(q.v))
    .map((q, k) => ({ ...q, row: lines[q.li[0]].row ?? 0, x: lines[q.li[0]].x + k * 1e-3 }));
  for (const r of [...new Set(qs.map((q) => q.row))].sort((a, b) => a - b)) {
    const pair = qs.filter((q) => q.row === r).sort((a, b) => a.x - b.x);
    if (pair.length !== 2 || pair[0].v >= pair[1].v) continue;
    const out = { values: { empty: pair[0].v, loaded: pair[1].v }, at: { empty: pair[0].li, loaded: pair[1].li }, auto: true };
    const ch = qs.filter((q) => q.row > r && q.v > pair[0].v).sort((a, b) => a.row - b.row)[0];
    if (ch) { out.values.change = ch.v; out.at.change = ch.li; }
    return out;
  }
  return null;
}

/**
 * Brzdicí váhy u přestavovače prázdný / ložený z přečtených řádků.
 * Vrací { values: {empty, half, loaded, change, change2, max} (t), at: klíč → indexy řádků, lines (všechny),
 * auto (nápis samočinného přestavovače / brzdění podle nákladu) } nebo null.
 */
export function extractLoadBrake(lines) {
  let found = null;
  for (const p of phrases(lines)) {
    const m = zeros(p.text).match(MAX_BW);
    if (m && BW_RANGE(Number(m[1]))) { found = { values: { max: Number(m[1]) }, at: { max: p.li }, auto: true }; break; }
  }
  found ??= extractPlate(lines) ?? extractAutoTable(lines);
  const designation = lines.findIndex((l) => LOAD_BRAKE.test(l.text));
  if (designation >= 0) {
    found ??= { values: {}, at: {} };
    found.auto = true;
    found.at.designation = [designation];
  }
  if (!found) return null;
  return { ...found, auto: Boolean(found.auto), lines: [...new Set(Object.values(found.at).flat())] };
}

/** Přečtené údaje u přestavovače k zobrazení: „BV 27 / 51 t · přestavná 44 t“, „MAX 58 t“. */
export function formatLoad(lb) {
  if (!lb) return '';
  const n = (v) => Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
  const bw = [lb.empty, lb.half, lb.loaded].filter((v) => v != null);
  const ch = [lb.change, lb.change2].filter((v) => v != null);
  return [lb.max != null && `MAX ${n(lb.max)} t`, bw.length && `BV ${bw.map(n).join(' / ')} t`,
    ch.length && `přestavná ${ch.map(n).join(' / ')} t`].filter(Boolean).join(' · ');
}

/** Hodnota z řádku i, na který vozmistr ťukl (u čísla s jednotkou i se sousedním rámečkem, např. „23 500“ + „kg“). */
export function valueFromLine(field, lines, i) {
  const line = lines[i];
  if (field.type === 'number') return digitsOnly(line.text).slice(0, 12);
  if (field.type === 'qty' || field.type === 'weight') {
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
  if (field.type === 'qty' || field.type === 'weight') {
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
  if (field.type === 'qty' || field.type === 'weight') return `${Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${field.unit}`;
  if (field.key === 'axles') return `${value} náprav${Number(value) <= 4 ? 'y' : ''}`;
  if (field.type === 'force') return describeForce(parseForce(value)) || value;
  if (field.type === 'revision') {
    const r = parseRevision(value);
    const st = revisionStatus(r);
    const base = `${r.years ? `${r.years} r. od ` : ''}${r.date}${r.ext ? ` +${r.ext} M` : ''}`;
    return st.until ? `${base} → ${st.expired ? 'PROŠLÁ ' : 'do '}${formatDay(st.until)}` : base;
  }
  if (field.options) return field.options.find(([v]) => v === value)?.[1] ?? value;
  return value;
}

/** Řádky, které odpovídají potvrzené hodnotě (pro trénink sítě „který nápis je který údaj“). */
export function matchingLines(field, lines, value) {
  if (!value || field.type === 'switch' || field.type === 'loadbrake') return [];
  if (field.type === 'number') {
    return lines.map((l, i) => [digitsOnly(l.text), i]).filter(([d]) => d.length >= 2 && value.includes(d)).map(([, i]) => i);
  }
  if (field.type === 'qty' || field.type === 'weight') {
    return quantities(lines).filter((q) => Math.abs((inUnit(q, field.unit) ?? NaN) - Number(value)) < 1e-6).flatMap((q) => q.li);
  }
  if (field.type === 'force') {
    const found = extractHandForce(lines);
    if (found?.value === value) return found.lines;
    // opravená hodnota: řádky, ve kterých je některé z potvrzených čísel
    const f = parseForce(value) ?? {};
    const nums = [f.single, f.min, f.max].filter((v) => v != null).map((v) => String(v));
    return lines.map((l, i) => [zeros(l.text).replace(/,/g, '.'), i])
      .filter(([t]) => nums.some((n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?:\\.0+)?(?![.\\d])`).test(t))).map(([, i]) => i);
  }
  return lines.map((l, i) => [l, i]).filter(([l]) => l.text.length > 2 && value.includes(l.text.trim())).map(([, i]) => i);
}
