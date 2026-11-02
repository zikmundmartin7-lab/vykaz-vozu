// Společné prvky obrazovek: ikony, horní lišta, přepínače, číselná pole, hlášky, výběr fotky.

import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { formatNumber, isCompleteNumber, isValidCheckDigit, digitsOnly } from './model.js';

const PATHS = {
  back: 'M15 18l-6-6 6-6',
  plus: 'M12 5v14M5 12h14',
  camera: 'M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  download: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  swap: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  text: 'M4 6h16M4 12h10M4 18h7',
  brain: 'M12 4a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1 5 3 3 0 0 0 5 2 3 3 0 0 0 5-2 3 3 0 0 0 1-5 3 3 0 0 0-3-3 3 3 0 0 0-3-3zM12 4v16',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
};

export function Icon({ name, size = 22 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name]} /></svg>`;
}

export function Topbar({ title, back, children }) {
  return html`<header class="topbar">
    ${back && html`<a class="iconbtn" href=${back} aria-label="Zpět"><${Icon} name="back" /></a>`}
    <h1>${title}</h1>
    ${children}
  </header>`;
}

/** Číslo vozu s tučným posledním čtyřčíslím (XXX-X), jak se vozy hledají. */
export function WagonNumber({ number }) {
  const f = formatNumber(number);
  return html`<span class="number">${f.slice(0, -5)}<b>${f.slice(-5)}</b></span>`;
}

// ───── Hledání vozu podle posledního čtyřčíslí (jako v Závadách vozů) ─────
// Píše se jen 4 číslice, pomlčka před kontrolní číslicí je pevně předvyplněná: [0][1][7]-[4].
// Skutečné pole je průhledné přes políčka, takže na telefonu funguje běžná číselná klávesnice.

/** Do 4 číslic se hledá podle posledního čtyřčíslí (XXX-X), při delším zadání kdekoli v čísle. */
export const matchesLastFour = (number, q) => !q || (q.length <= 4 ? digitsOnly(number).slice(-4).startsWith(q) : digitsOnly(number).includes(q));

export function LastFourSearch({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef();
  const q = value ?? '';

  function onInput(e) {
    const d = digitsOnly(e.currentTarget.value);
    // vložené celé číslo vozu → poslední čtyřčíslí; pátá napsaná číslice se nebere
    const next = d.length > 5 ? d.slice(-4) : d.slice(0, 4);
    e.currentTarget.value = next;
    onChange(next);
  }
  function clear(e) {
    e.preventDefault();
    onChange('');
    inputRef.current?.focus();
  }

  const active = focused && q.length < 4 ? q.length : -1;
  const box = (i) => html`<span class=${`code-box ${i === active ? 'active' : ''}`}>${q[i] ?? ''}</span>`;
  return html`<label class="search-box code-search">
    <${Icon} name="search" />
    <span class="code" aria-hidden="true">${box(0)}${box(1)}${box(2)}<span class="code-dash">-</span>${box(3)}</span>
    <span class="code-hint">${q ? '' : 'poslední 4 číslice vozu'}</span>
    <input ref=${inputRef} class="code-input" type="text" inputmode="numeric" pattern="[0-9]*"
      autocomplete="off" enterkeyhint="search" aria-label="Hledat vůz podle posledních 4 číslic"
      value=${q} onInput=${onInput} onFocus=${() => setFocused(true)} onBlur=${() => setFocused(false)} />
    ${q && html`<button class="iconbtn clear" onClick=${clear} aria-label="Vymazat"><${Icon} name="close" size=${18} /></button>`}
  </label>`;
}

/** Přepínač s velkými tlačítky. options: [[hodnota, popisek]]; bad = hodnoty zvýrazněné červeně. */
export function Seg({ value, options, onChange, bad = [] }) {
  return html`<div class="seg" role="radiogroup">
    ${options.map(([v, label]) => html`<button type="button" role="radio" aria-checked=${value === v}
      class=${`${value === v ? 'on' : ''} ${bad.includes(v) ? 'bad' : ''}`} onClick=${() => onChange(v)}>${label}</button>`)}
  </div>`;
}

// Text v číselném poli → číslo (desetinná čárka i tečka, mezery mezi tisíci „23 500“); prázdné nebo nesmysl = null.
const parseNum = (text) => {
  const v = String(text ?? '').replace(',', '.').replace(/\s/g, '');
  return v === '' || Number.isNaN(Number(v)) ? null : Number(v);
};
const numText = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));

/**
 * Číselné pole s jednotkou; prázdné = null. Desetinná čárka i tečka.
 * Pole drží rozepsaný text: kdyby se po každé klávese vypsalo číslo, zmizela by čárka („15,“ → 15)
 * a z 15,74 by bylo 1574. Z hodnoty se text přepíše, jen když se změní zvenku (vyplnění z nápisu).
 * bad = neobvyklá hodnota (červený rámeček; vysvětlení vypisuje obrazovka pod poli).
 */
export function NumField({ label, unit, value, onChange, onFocus, bad, step = 'any' }) {
  const [text, setText] = useState(() => numText(value));
  useEffect(() => { if (parseNum(text) !== (value ?? null)) setText(numText(value)); }, [value]);
  return html`<label class="field"><span>${label}</span>
    <div class="input-unit">
      <input class=${`input ${bad ? 'bad' : ''}`} type="text" inputmode="decimal" value=${text} step=${step} onFocus=${onFocus}
        onInput=${(e) => { setText(e.target.value); onChange(parseNum(e.target.value)); }} />
      ${unit && html`<em>${unit}</em>`}
    </div>
  </label>`;
}

/** Pole pro ruční zadání čísla vozu ve tvaru XX XX XXXX XXX-X s kontrolou kontrolní číslice. */
export function NumberInput({ value, onChange, autoFocus }) {
  const ref = useRef();
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, []);
  const d = digitsOnly(value);
  return html`<label class="field"><span>Číslo vozu</span>
    <input ref=${ref} class="input number" inputmode="numeric" autocomplete="off" placeholder="33 54 6955 012-3"
      value=${formatNumber(d)} onInput=${(e) => onChange(digitsOnly(e.target.value).slice(0, 12))} />
    ${isCompleteNumber(d) && (isValidCheckDigit(d)
      ? html`<div class="hint okc">Kontrolní číslice sedí.</div>`
      : html`<div class="hint err">Kontrolní číslice nesedí – zkontrolujte číslo.</div>`)}
  </label>`;
}

/** Tlačítko, které otevře fotoaparát telefonu (nebo výběr souboru na počítači) a vrátí File. */
export function PhotoButton({ onPhoto, children, class: cls = 'btn', disabled }) {
  const ref = useRef();
  return html`<button type="button" class=${cls} disabled=${disabled} onClick=${() => ref.current.click()}>
    ${children}
    <input ref=${ref} type="file" accept="image/*" capture="environment" hidden
      onChange=${(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPhoto(f); }} />
  </button>`;
}

/** Náhled fotky z IndexedDB (Blob). */
export function BlobImg({ blob, alt = '' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) return undefined;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? html`<img src=${url} alt=${alt} />` : null;
}

// ───── krátké hlášky dole ─────

let showToast = () => {};
export const toast = (text) => showToast(text);

export function Toasts() {
  const [text, setText] = useState(null);
  useEffect(() => {
    let timer;
    showToast = (t) => { setText(t); clearTimeout(timer); timer = setTimeout(() => setText(null), 3200); };
  }, []);
  return text && html`<div class="toast" role="status">${text}</div>`;
}

export const go = (hash, replace = false) => {
  if (replace) location.replace(hash);
  else location.hash = hash;
};

export const vibrate = (ms = 60) => navigator.vibrate?.(ms);

// ───── Nová verze aplikace (stejně jako Závady vozů) ─────

/** Verze, kterou má service worker stažená (sw.js → CACHE 'vykaz-vNN'); 0 = nevíme. */
export function swVersion(worker = navigator.serviceWorker?.controller) {
  if (!worker) return Promise.resolve(0);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(Number(String(e.data ?? '').replace(/^vykaz-v/, '')) || 0);
    worker.postMessage({ type: 'version' }, [ch.port2]);
    setTimeout(() => resolve(0), 3000);
  });
}

/**
 * Znovunačtení aplikace (nová verze): nové razítko v adresách souborů (viz index.html), jinak by iPhone
 * spustil znovu staré skripty ze své paměti, dokud se aplikace úplně nezavře.
 */
export function reloadApp() {
  try { localStorage.setItem('app-reload', String(Date.now())); } catch {}
  location.reload();
}

/**
 * Aktualizace bez zavírání aplikace: zeptá se webu na novou verzi, počká, až se stáhne, a aplikaci
 * načte znovu. Vrací 'reload' (načítá se nová verze), 'latest' (novější není), 'offline' nebo 'error'.
 */
export async function updateApp(current) {
  if (!navigator.onLine) return 'offline';
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'latest';
  try {
    await reg.update();
    const sw = reg.installing ?? reg.waiting;
    if (sw) {
      await new Promise((resolve, reject) => {
        const check = () => {
          if (sw.state === 'activated') resolve();
          else if (sw.state === 'redundant') reject(new Error('Stažení nové verze selhalo.'));
        };
        sw.addEventListener('statechange', check);
        check();
        setTimeout(() => reject(new Error('Stažení nové verze trvá příliš dlouho.')), 60000);
      });
    }
  } catch {
    return 'error';
  }
  if ((await swVersion(reg.active)) > current) {
    reloadApp();
    return 'reload';
  }
  return 'latest';
}

/** Lišta „Je k dispozici nová verze“ – ukáže se, když service worker na pozadí stáhl novou verzi. */
export function UpdateBanner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(true);
    addEventListener('app-updated', on);
    return () => removeEventListener('app-updated', on);
  }, []);
  return shown && html`<button type="button" class="update-banner" onClick=${reloadApp}>
    <b>Je k dispozici nová verze aplikace</b><span>Klepněte sem pro načtení.</span></button>`;
}
