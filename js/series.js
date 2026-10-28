// Řada vozu z čísla: 5.–8. číslice → písmenné označení řady podle tabulek ERA (data/rady.json,
// převod tools/era_rady.py), z písmen počet náprav a nejvyšší rychlost.
// Zdroje: OTIF UTP Marking 2021 (kap. 11 interoperabilní kód, kap. 14 číslice 5–8, definice písmen),
// ERA Appendix 6 Part 9 (tabulky číslic) a Part 12 (písmena řady).

import { digitsOnly } from './model.js';

let table = null;
export function loadSeries() {
  table ??= fetch(new URL('../data/rady.json', import.meta.url)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return table;
}

const leadingA = (idx) => idx.match(/^a*/)[0].length;

/**
 * Počet náprav z písmen řady. Vrací { value, sure, note, bogies }: sure = lze předvyplnit, bogies = vůz má
 * podvozky (pro kontrolu s 1. číslicí čísla);
 * 8 a více náprav a nejasné případy (aa = „6 a víc“, kloubové vozy mimo S a L) se zadávají ručně.
 */
function axlesFromLetters(series) {
  const cat = series[0];
  const idx = series.slice(1);
  const a = leadingA(idx);
  const articulated = /rr/.test(idx) ? 'multiple' : /r/.test(idx) ? 'articulated' : null;

  if (cat === 'S' && articulated) {
    // kloubový (r): jednotky sdílejí podvozky; vícečlenný (rr): každá jednotka má své dva podvozky
    const units = /oo/.test(idx) ? 4 : /o/.test(idx) ? 3 : 2;
    const value = articulated === 'articulated' ? (units + 1) * 2 : units * 4;
    return { value, sure: value < 8, bogies: true,
      note: articulated === 'articulated' ? `kloubový vůz, ${units} jednotky` : `vícečlenný vůz, ${units} jednotky` };
  }
  if (articulated && cat !== 'L') return { value: null, sure: false, bogies: null, note: 'kloubový nebo vícečlenný vůz' };
  switch (cat) {
    case 'K': return { value: 2, sure: true, bogies: false };
    // L: vozy s nápravami bez podvozků; a = kloubový (2 jednotky na 3 nápravách), aa = vícečlenný (2 × 2)
    case 'L': return a >= 2 ? { value: 4, sure: true, bogies: false, note: 'vícečlenný vůz' }
      : a === 1 ? { value: 3, sure: true, bogies: false, note: 'kloubový vůz' } : { value: 2, sure: true, bogies: false };
    case 'O': return { value: a ? 3 : 2, sure: true, bogies: false };
    case 'R': return { value: 4, sure: true, bogies: true };
    case 'S':
      if (a === 3) return { value: 4, sure: true, bogies: true };
      if (a === 2) return { value: 8, sure: false, bogies: true, note: '8 a více náprav' };
      return { value: a === 1 ? 6 : 4, sure: true, bogies: true };
    default: // E, F, G, H, I, T, U, Z
      if (a >= 2) return { value: 6, sure: false, bogies: true, note: '6 a více náprav' };
      return { value: a ? 4 : 2, sure: true, bogies: Boolean(a) };
  }
}

/**
 * Údaje odvozené z čísla vozu, nebo null (číslo není nákladní vůz / řada v tabulce není).
 * { series: 'Eanos', axles: { value, sure, note }, speed: 100 | 120 | null, bogies: true | false | null }
 */
export async function seriesInfo(number) {
  const d = digitsOnly(number);
  if (d.length < 8) return null;
  const t = await loadSeries();
  const series = t[d.slice(4, 8)];
  if (!series) return null;
  const idx = series.slice(1);
  // 1. číslice: 0, 2, 4 = vůz s nápravami (bez podvozků), 1, 3, 8 = s podvozky
  const bogies = '138'.includes(d[0]) ? true : '024'.includes(d[0]) ? false : null;
  const axles = axlesFromLetters(series);
  if (axles.bogies != null && bogies !== null && bogies !== axles.bogies) {
    axles.sure = false;
    axles.note = `řada a 1. číslice si odporují (${bogies ? 'podvozky' : 'bez podvozků'})`;
  }
  return { series, axles, speed: /ss/.test(idx) ? 120 : /s/.test(idx) ? 100 : null, bogies };
}

export const axlesText = (n) => `${n} ${n >= 2 && n <= 4 ? 'nápravy' : 'náprav'}`;
